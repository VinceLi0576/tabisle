// Direct Jianguoyun sync: optimistic conditional writes, explicit conflict review.
const SC=SyncCore;
let nativeLastChange=0,nativeRevision=0,syncGuard=null;
function observeNative(type,id,info={}){
  nativeLastChange=Date.now();nativeRevision++;
  if(!syncGuard)return;
  const at=syncGuard.expected.findIndex(e=>e.type===type&&(!e.id||e.id===id)&&(!e.parentId||e.parentId===info.parentId)&&(!e.title||e.title===info.title)&&(!e.url||e.url===info.url));
  if(at>=0)syncGuard.expected.splice(at,1);else syncGuard.dirty=true;
}
for(const [event,type]of [['onCreated','create'],['onChanged','update'],['onMoved','move'],['onRemoved','remove'],['onChildrenReordered','reorder']])chrome.bookmarks[event]?.addListener((id,info)=>observeNative(type,id,info));
function syncEndpoint(c){return c.url+'sync/state.json#account='+encodeURIComponent(c.username||'');}
async function syncRequest(c,method,name,body,headers={}){
  if(!/^(?:state|probe-[a-zA-Z0-9-]+)\.json$/.test(name))throw Error('同步文件路径不正确');
  let auth='';for(const b of new TextEncoder().encode(c.username+':'+c.password))auth+=String.fromCharCode(b);
  const r=await fetch(davURL(c.url).href+'sync/'+name,{method,headers:{Authorization:'Basic '+btoa(auth),...headers},body,credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok&&![404,412].includes(r.status))throw Error('坚果云同步请求失败（'+r.status+'）');return r;
}
const strongTag=r=>{const t=r.headers?.get('etag');if(!t||!/^"[^\r\n]*"$/.test(t))throw Error('服务器没有返回可用于防覆盖的强 ETag，暂不启用双向同步；云端备份仍可使用');return t;};
async function verifySync(c){
  await ensureDavDirectory({...c,url:c.url+'sync/'});
  const name='probe-'+crypto.randomUUID()+'.json',body='{"tabisle":"conditional-write-check"}';let created=false;
  try{
    const first=await syncRequest(c,'PUT',name,body,{'If-None-Match':'*','Content-Type':'application/json'});if(!first.ok)throw Error('无法创建同步验证文件');created=true;
    const read=await syncRequest(c,'GET',name);if(!read.ok)throw Error('无法读取同步验证文件');const etag=strongTag(read);
    const wrong=await syncRequest(c,'PUT',name,body,{'If-Match':'"tabisle-intentionally-wrong-'+crypto.randomUUID()+'"'});
    const duplicate=await syncRequest(c,'PUT',name,body,{'If-None-Match':'*'});
    if(wrong.status!==412||duplicate.status!==412)throw Error('坚果云当前连接未通过防覆盖验证，双向同步未开启；仍可使用独立备份');
    const correct=await syncRequest(c,'PUT',name,body,{'If-Match':etag});if(!correct.ok)throw Error('服务器拒绝有效条件写入，双向同步未开启');
    await chrome.storage.local.set({syncVerified:syncEndpoint(c)});
  }finally{
    if(created){try{const r=await syncRequest(c,'GET',name);if(r.ok)await syncRequest(c,'DELETE',name,undefined,{'If-Match':strongTag(r)});}catch{/* Own empty probe may remain; never delete a shared sync document. */}}
  }
}
async function readSync(c){
  const r=await syncRequest(c,'GET','state.json');if(r.status===404)return {snapshot:null,etag:null,revision:null};
  if(!r.ok)throw Error('无法读取云端同步文件');const etag=strongTag(r),text=await r.text();if(text.length>12e6)throw Error('云端同步文件超过 12 MB');
  const doc=JSON.parse(text);if(doc.format!=='tabisle-sync'||doc.version!==1||typeof doc.revision!=='string')throw Error('云端同步文件格式不正确，未覆盖');
  return {snapshot:BK.validate(doc.snapshot),etag,revision:doc.revision};
}
function syncContent(s){
  if(!s)return null;
  const walk=nodes=>nodes.map(n=>({uid:n.uid,title:n.title,...(n.url?{url:n.url}:{children:walk(n.children)})}));
  const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
  return JSON.stringify(sort({children:walk(s.children),meta:s.meta}));
}
async function syncConfiguration(){
  const data=await chrome.storage.local.get(['backupMode','webdav','syncVerified','syncState','syncInProgress','syncAuto','syncTombstones','restoreInProgress']);
  if(modeOf(data)!=='webdav'||!data.webdav?.enabled)throw Error('请先连接坚果云并启用 WebDAV 方案');
  if(data.restoreInProgress)throw Error('请先处理未完成的恢复，再进行同步');
  return {data,c:await davConfig()};
}
async function prepareSync(choices={},verify=false){
  const {data,c}=await syncConfiguration();
  if(data.syncVerified!==syncEndpoint(c)){if(!verify)throw Error('请先在备份页验证并预览首次同步');await verifySync(c);}
  const remote=await readSync(c),revision=nativeRevision,current=await captureSnapshot('同步预览');
  if(revision!==nativeRevision)throw Error('浏览器正在更新书签，请稍后重新预览');
  const base=!data.syncInProgress&&data.syncState?.endpoint===syncEndpoint(c)?data.syncState.base:null;
  const tombstones=data.syncState?.endpoint===syncEndpoint(c)?data.syncTombstones||[]:[];
  const merged=SC.merge(base,current,remote.snapshot,choices,tombstones),candidate=portable(merged.snapshot);
  const localPlan=BK.plan(merged.local,candidate),remotePlan=remote.snapshot?BK.plan(remote.snapshot,candidate):{changes:BK.flatten(candidate.children).map(n=>({op:'新增',path:n.path})),metaChanged:true};
  const deletions=localPlan.changes.filter(c=>c.op==='删除').length+remotePlan.changes.filter(c=>c.op==='删除').length;
  const size=BK.flatten(current.children).length+BK.flatten(remote.snapshot?.children||[]).length;
  const plan={token:crypto.randomUUID(),fingerprint:await fingerprint(current),endpoint:syncEndpoint(c),remote,candidate,conflicts:merged.conflicts,unresolved:merged.unresolved,tombstones:merged.tombstones,first:!base,recovery:!!data.syncInProgress,
    localChanges:localPlan.changes,cloudChanges:remotePlan.changes,metaChanged:localPlan.metaChanged||remotePlan.metaChanged,largeDeletion:deletions>0&&deletions/Math.max(1,size)>.2};
  await chrome.storage.session.set({syncPreview:plan});return plan;
}
function syncView(p){return {token:p.token,first:p.first,recovery:p.recovery,conflicts:p.conflicts,unresolved:p.unresolved,localChanges:p.localChanges,cloudChanges:p.cloudChanges,metaChanged:p.metaChanged,largeDeletion:p.largeDeletion};}
async function applySync(token,auto=false){
  const {syncPreview:p}=await chrome.storage.session.get('syncPreview');if(!p||p.token!==token)throw Error('请重新预览同步');
  if(p.unresolved)throw Error('请先选择冲突处理方式，再更新预览');
  if(auto&&(p.first||p.largeDeletion||p.conflicts.length||p.recovery))throw Error('同步需要你确认，请在备份页查看变化与冲突');
  const {data,c}=await syncConfiguration();if(syncEndpoint(c)!==p.endpoint)throw Error('连接已变化，请重新预览');
  const current=await captureSnapshot('同步前自动保护');if(await fingerprint(current)!==p.fingerprint)throw Error('本机数据已变化，请重新预览同步');
  const latest=await readSync(c);if(latest.etag!==p.remote.etag||latest.revision!==p.remote.revision)throw Error('云端已被另一台设备更新，请重新预览同步');
  const changed=syncContent(p.candidate)!==syncContent(latest.snapshot),localChanged=p.localChanges.length||BK.plan(current,p.candidate).metaChanged;
  if(changed||localChanged)await storeSnapshot(current);
  if(changed&&latest.snapshot){
    const protection={...latest.snapshot,id:crypto.randomUUID(),createdAt:new Date().toISOString(),reason:'同步前云端保护'};
    await storeSnapshot(protection);await uploadSnapshot(protection);
  }
  // Recheck after potentially slow backup requests, before any shared state is written.
  if(await fingerprint(await captureSnapshot())!==p.fingerprint)throw Error('备份期间本机数据发生变化，请重新预览同步');
  const operation=crypto.randomUUID();await chrome.storage.local.set({syncInProgress:{operation,endpoint:p.endpoint,startedAt:new Date().toISOString()},syncAuto:false});
  try{
    if(changed){
      const payload={format:'tabisle-sync',version:1,revision:operation,snapshot:{...p.candidate,id:operation,createdAt:new Date().toISOString(),reason:'同步版本',prefs:{},folderState:{}}};
      const response=await syncRequest(c,'PUT','state.json',JSON.stringify(payload),{'Content-Type':'application/json',...(latest.etag?{'If-Match':latest.etag}:{'If-None-Match':'*'})});
      if(response.status===412){await chrome.storage.local.remove('syncInProgress');throw Error('另一台设备刚刚更新了云端，本次未覆盖，请重新预览');}
      if(!response.ok)throw Error('云端写入失败，保留未完成标记，请重新预览');
    }
    if(await fingerprint(await captureSnapshot())!==p.fingerprint)throw Error('云端保存期间本机有新变化；已暂停同步，请重新预览合并');
    syncGuard={dirty:false,expected:[]};const identity={},originalIds=new Set(BK.flatten(current.children).map(n=>n.id));
    const savedIdentity=(await chrome.storage.local.get('bookmarkIdentity')).bookmarkIdentity||{};
    const check=()=>{if(syncGuard.dirty)throw Error('检测到浏览器或用户同时修改书签，已停止应用；请重新预览合并');};
    const api={...bookmarkAPI};
    for(const method of ['create','update','move','remove','removeTree'])api[method]=async(...args)=>{
      check();const fields=method==='create'?args[0]:args[1]||{};
      syncGuard.expected.push({type:method==='removeTree'?'remove':method,id:method==='create'?null:args[0],...(method==='create'?{parentId:fields.parentId,title:fields.title,url:fields.url}:method==='move'?{parentId:fields.parentId}:{})});
      const result=await bookmarkAPI[method](...args);check();return result;
    };
    const live=await BK.restore(api,current.barId,current,p.candidate,async(uid,n)=>{
      check();identity[n.id]={uid,dateAdded:n.dateAdded};
      // Persist each placement so an interrupted create can be identified on the next merge.
      if(!originalIds.has(n.id)){savedIdentity[n.id]=identity[n.id];await chrome.storage.local.set({bookmarkIdentity:savedIdentity});}
    });
    check();const beforeMeta=(await chrome.storage.local.get('meta')).meta||{items:{},groups:{},tags:[]};
    if(!SC.equal(beforeMeta,current.meta))throw Error('同步期间备注发生变化，请重新预览合并');
    const folderCollapsed={};
    const aligned=SC.align(current,p.candidate);for(const [uid,v]of Object.entries(aligned.folderState||{})){const n=live.get(uid);if(n)folderCollapsed[`${n.id}:${n.dateAdded||0}`]=v;}
    await chrome.storage.local.set({meta:p.candidate.meta,bookmarkIdentity:identity,folderCollapsed});
    const applied=await captureSnapshot();check();if(syncContent(applied)!==syncContent(p.candidate))throw Error('书签在应用过程中变化，请重新预览合并');
    await chrome.storage.local.set({syncState:{endpoint:p.endpoint,base:portable(applied)},syncTombstones:p.tombstones,lastSyncAt:new Date().toISOString(),syncError:'',syncAuto:auto||!!data.syncAuto});
    await chrome.storage.local.remove('syncInProgress');await chrome.storage.session.remove('syncPreview');return true;
  }catch(error){await chrome.storage.local.set({syncError:error.message,syncAuto:false});throw error;}finally{syncGuard=null;}
}
async function maybeSync(){
  const d=await chrome.storage.local.get(['syncAuto','lastSyncAt','syncInProgress','backupMode','webdav']);
  if(!d.syncAuto||d.syncInProgress||modeOf(d)!=='webdav'||!d.webdav?.enabled||Date.now()-Date.parse(d.lastSyncAt||0)<15*60e3||Date.now()-nativeLastChange<3000)return;
  try{const p=await prepareSync();await applySync(p.token,true);}catch(e){await chrome.storage.local.set({syncError:e.message,syncAuto:false});}
}
async function syncAction(message){
  switch(message.type){
    case 'SYNC_STATUS':{const d=await chrome.storage.local.get(['syncAuto','lastSyncAt','syncError','syncInProgress','syncState','webdav']);return {auto:!!d.syncAuto,lastSyncAt:d.lastSyncAt,error:d.syncError,inProgress:!!d.syncInProgress,initialized:!!d.syncState&&d.syncState.endpoint===syncEndpoint(d.webdav||DAV_DEFAULT)};}
    case 'SYNC_PREVIEW':return syncView(await prepareSync(message.choices||{},true));
    case 'SYNC_APPLY':return applySync(message.token);
    case 'SYNC_AUTO':{
      if(message.enabled){const {data,c}=await syncConfiguration();if(data.syncInProgress||data.syncState?.endpoint!==syncEndpoint(c)||data.syncVerified!==syncEndpoint(c))throw Error('请先完成一次同步');}
      await chrome.storage.local.set({syncAuto:!!message.enabled,syncError:''});return true;
    }
    default:throw Error('未知同步操作');
  }
}
