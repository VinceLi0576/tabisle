// Direct Jianguoyun sync: optimistic conditional writes, explicit conflict review.
const SC=SyncCore;
let nativeLastChange=0,nativeRevision=0,syncGuard=null;
function observeNative(type,id,info={}){
  nativeLastChange=Date.now();nativeRevision++;
  if(!syncGuard)return;
  const at=syncGuard.expected.findIndex(e=>e.type===type&&(!e.id||e.id===id)&&(!e.parentId||e.parentId===info.parentId)&&(!e.title||e.title===info.title)&&(!e.url||BK.browserUrlEqual(e.url,info.url)));
  if(at>=0)syncGuard.expected.splice(at,1);else {
    syncGuard.dirty=true;
    if(!syncGuard.diagnostic){
      const expected=syncGuard.expected.find(e=>e.type===type)||null;
      const fields=expected?['id','parentId','title','url'].filter(k=>expected[k]&&expected[k]!== (k==='id'?id:info[k])):[];
      const detail={type,expectedType:expected?.type||null,fields,remaining:syncGuard.expected.length,at:new Date().toISOString()};
      if(expected?.url&&info.url){try{detail.normalizedUrlEqual=new URL(expected.url).href===new URL(info.url).href;}catch{}}
      syncGuard.diagnostic=detail;
    }
  }
}
// 🔴 ?. 原来挡的是「这个事件不存在」，挡不住「chrome.bookmarks 整个还没就绪」——
// 扩展重载那一瞬间真的会这样（260914 实测到一次）。那一次 service worker 起来后
// 一个书签事件都监听不上，直到它下次重启，而且外面完全看不出来。
for(const [event,type]of [['onCreated','create'],['onChanged','update'],['onMoved','move'],['onRemoved','remove'],['onChildrenReordered','reorder']])chrome.bookmarks?.[event]?.addListener((id,info)=>observeNative(type,id,info));
const syncVerification=c=>syncEndpoint(c)+'|move-v1';
function syncEndpoint(c){return c.url+'sync/state.json#account='+encodeURIComponent(c.username||'');}
async function syncRequest(c,method,name,body,headers={}){
  if(!/^(?:state|(?:probe|stage)-[a-zA-Z0-9-]+)\.json$/.test(name))throw Error('同步文件路径不正确');
  let auth='';for(const b of new TextEncoder().encode(c.username+':'+c.password))auth+=String.fromCharCode(b);
  const r=await fetch(davURL(c.url).href+'sync/'+name,{method,headers:{Authorization:'Basic '+btoa(auth),...headers},body,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!r.ok&&![404,412].includes(r.status)&&!(method==='HEAD'&&r.status===405)&&!(method==='MOVE'&&r.status===409))throw Error('坚果云同步请求失败（'+r.status+'）');return r;
}
// Jianguoyun returns bare opaque tags. Use the server's exact token, after a
// real valid/stale conditional-write test; do not add quotes or accept weak tags.
const syncTag=r=>{const t=r.headers?.get('etag');if(!t||!(/^[A-Za-z0-9_-]{1,256}$/.test(t)||/^"[^\r\n]*"$/.test(t)))throw Error('服务器没有返回可用的版本标识，双向同步未开启');return t;};
async function verifySync(c){
  await ensureDavDirectory({...c,url:c.url+'sync/'});
  const source='probe-'+crypto.randomUUID()+'.json',dest='probe-'+crypto.randomUUID()+'.json';
  const body=stage=>JSON.stringify({tabisle:'conditional-write-check',stage});
  const check={endpoint:syncEndpoint(c),protocol:'move-v1',checkedAt:new Date().toISOString(),upload:false,download:false,conditionalCreate:false,conditionalUpdate:false,compatible:false,cleaned:false};
  const owned=new Set([source,dest]);
  try{
    const first=await syncRequest(c,'PUT',source,body('initial'),{'Content-Type':'application/json'});if(!first.ok)throw Error('无法创建连接测试文件');owned.add(source);check.upload=true;
    let r=await syncRequest(c,'MOVE',source,undefined,{Destination:c.url+'sync/'+dest,Overwrite:'F'});if(!r.ok)throw Error('云端不支持创建同步文件');owned.add(dest);
    r=await syncRequest(c,'GET',dest);if(!r.ok||await r.text()!==body('initial'))throw Error('测试文件读回校验失败');check.download=true;
    await syncRequest(c,'PUT',source,body('duplicate'));owned.add(source);
    const duplicate=await syncRequest(c,'MOVE',source,undefined,{Destination:c.url+'sync/'+dest,Overwrite:'F'});
    r=await syncRequest(c,'GET',dest);let tag=syncTag(r);
    check.conditionalCreate=[409,412].includes(duplicate.status)&&await r.text()===body('initial');
    const wrong=await syncRequest(c,'PUT',dest,body('wrong'),{'If-Match':'"wrong-'+crypto.randomUUID()+'"'});
    const correct=await syncRequest(c,'PUT',dest,body('updated'),{'If-Match':tag});
    r=await syncRequest(c,'GET',dest);const updated=r.ok&&await r.text()===body('updated');
    const stale=await syncRequest(c,'PUT',dest,body('stale'),{'If-Match':tag});
    r=await syncRequest(c,'GET',dest);check.conditionalUpdate=wrong.status===412&&correct.ok&&updated&&stale.status===412&&await r.text()===body('updated');
    if(!check.conditionalCreate||!check.conditionalUpdate)throw Error('上传和读取已验证；当前连接未通过双向同步防覆盖验证，同步保持关闭。');
    check.compatible=true;await chrome.storage.local.set({syncVerified:syncVerification(c),syncError:''});
  }catch(error){check.error=error.message;await chrome.storage.local.set({syncVerified:null,syncAuto:false,syncError:error.message});throw error;}
  finally{
    let clean=true;
    for(const name of owned){try{
      const r=await syncRequest(c,'GET',name);if(r.status===404)continue;
      const content=JSON.parse(await r.text());
      if(!r.ok||content.tabisle!=='conditional-write-check'){clean=false;continue;}
      const d=await syncRequest(c,'DELETE',name);if(!d.ok&&d.status!==404)clean=false;
    }catch{clean=false;}}
    check.cleaned=clean;await chrome.storage.local.set({syncCheck:check});
  }
}
async function createSyncFile(c,body,operation){
  const stage='stage-'+operation+'.json';
  try{
    const saved=await syncRequest(c,'PUT',stage,body,{'Content-Type':'application/json'});if(!saved.ok)throw Error('无法上传待同步版本');
    const r=await syncRequest(c,'MOVE',stage,undefined,{Destination:c.url+'sync/state.json',Overwrite:'F'});
    if([409,412].includes(r.status)){
      const existing=await syncRequest(c,'GET','state.json');
      if(existing.ok)return {ok:false,status:412};
      throw Error('云端同步目录发生变化，请重新预览');
    }
    return r;
  }finally{
    // Some DAV implementations keep the source after MOVE. It belongs to this operation.
    try{await syncRequest(c,'DELETE',stage);}catch{/* A uniquely named staging file is never read as shared state. */}
  }
}
async function readSync(c){
  const r=await syncRequest(c,'GET','state.json');if(r.status===404)return {snapshot:null,etag:null,revision:null};
  if(!r.ok)throw Error('无法读取云端同步文件');const etag=syncTag(r),text=await r.text();if(text.length>12e6)throw Error('云端同步文件超过 12 MB');
  const doc=JSON.parse(text);if(doc.format!=='tabisle-sync'||doc.version!==1||typeof doc.revision!=='string')throw Error('云端同步文件格式不正确，未覆盖');
  const snapshot=BK.validate(doc.snapshot),sha256=await contentHash(syncContent(snapshot));
  if(doc.sha256&&doc.sha256!==sha256)throw Error('云端同步文件读回校验失败：内容指纹不一致，未应用');
  const updatedBy=doc.updatedBy&&typeof doc.updatedBy==='object'?{id:String(doc.updatedBy.id||'').slice(0,80),name:String(doc.updatedBy.name||'').slice(0,60)}:null;
  return {snapshot,etag,revision:doc.revision,parentRevision:typeof doc.parentRevision==='string'?doc.parentRevision:null,updatedAt:doc.updatedAt||snapshot.createdAt||null,updatedBy,sha256};
}
async function readSyncHead(c){
  const r=await syncRequest(c,'HEAD','state.json');
  if(r.status===404)return {etag:null};
  if(r.status===405)return {etag:null,unsupported:true};
  if(!r.ok)throw Error('无法检查云端最新版本');
  // Jianguoyun may omit ETag on HEAD even though GET returns a usable tag.
  // Treat that response like unsupported HEAD so the caller performs a GET.
  if(!r.headers?.get('etag'))return {etag:null,unsupported:true};
  return {etag:syncTag(r)};
}
function syncContent(s){
  if(!s)return null;
  const walk=nodes=>nodes.map(n=>({uid:n.uid,title:n.title,...(n.url?{url:n.url}:{children:walk(n.children)})}));
  const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
  return JSON.stringify(sort({children:walk(s.children),meta:s.meta}));
}
async function syncConfiguration(){
  const data=await chrome.storage.local.get(['backupMode','webdav','syncVerified','syncState','syncInProgress','syncAuto','syncTombstones','restoreInProgress','syncFollowOnly']);
  if(modeOf(data)!=='webdav'||!data.webdav?.enabled)throw Error('请先连接坚果云并启用 WebDAV 方案');
  if(data.restoreInProgress)throw Error('请先处理未完成的恢复，再进行同步');
  return {data,c:await davConfig()};
}
function syncStateRemote(state,etag){
  return {snapshot:state.base,etag,revision:state.revision||null,parentRevision:state.parentRevision||null,updatedAt:state.updatedAt||state.base?.createdAt||null,updatedBy:state.updatedBy||null,sha256:state.sha256||null};
}
async function latestSyncStatus(){
  const {data,c}=await syncConfiguration(),endpoint=syncEndpoint(c),state=data.syncState?.endpoint===endpoint?data.syncState:null;
  const current=await captureSnapshot('同步状态检查'),localDirty=!state||syncContent(current)!==syncContent(state.base);
  const head=await readSyncHead(c);let remote;
  if(state&&head.etag&&state.etag===head.etag)remote=syncStateRemote(state,head.etag);
  else remote=await readSync(c);
  const cloudNew=!state||remote.etag!==state.etag||remote.revision!==state.revision;
  if(state&&!cloudNew&&(state.etag!==remote.etag||(!state.sha256&&remote.sha256))){
    await chrome.storage.local.set({syncState:{...state,etag:remote.etag,revision:remote.revision,parentRevision:remote.parentRevision,updatedAt:remote.updatedAt,updatedBy:remote.updatedBy,sha256:remote.sha256}});
  }
  return {state:localDirty&&cloudNew?'diverged':localDirty?'local-new':cloudNew?'cloud-new':'latest',checkedAt:new Date().toISOString(),localDirty,cloudNew,localRevision:state?.revision||null,remote:{revision:remote.revision,updatedAt:remote.updatedAt,updatedBy:remote.updatedBy,sha256:remote.sha256}};
}
async function prepareSync(choices={},verify=false){
  const {data,c}=await syncConfiguration();
  if(data.syncVerified!==syncVerification(c)){if(!verify)throw Error('请先在备份页验证并预览首次同步');await verifySync(c);}
  const remote=await readSync(c),revision=nativeRevision,current=await captureSnapshot('同步预览');
  if(revision!==nativeRevision)throw Error('浏览器正在更新书签，请稍后重新预览');
  const base=!data.syncInProgress&&data.syncState?.endpoint===syncEndpoint(c)?data.syncState.base:null;
  const tombstones=data.syncState?.endpoint===syncEndpoint(c)?data.syncTombstones||[]:[];
  const merged=SC.merge(base,current,remote.snapshot,choices,tombstones);
  // 「只跟随」＝这台只接收，永不上传。候选直接取云端那份，本机的改动不参与，
  // 也就没有冲突可言（云端永远赢）。🔴 它是本机偏好，🚫 不进同步内容，免得传染给别的设备。
  const followOnly=!!data.syncFollowOnly&&!!remote.snapshot;
  const candidate=portable(followOnly?remote.snapshot:merged.snapshot);
  if(followOnly){merged.conflicts=[];merged.unresolved=0;}
  const localPlan=BK.plan(merged.local,candidate),remotePlan=remote.snapshot?BK.plan(remote.snapshot,candidate):{changes:BK.flatten(candidate.children).map(n=>({op:'新增',path:n.path})),metaChanged:true};
  const deletions=localPlan.changes.filter(c=>c.op==='删除').length+remotePlan.changes.filter(c=>c.op==='删除').length;
  const size=BK.flatten(current.children).length+BK.flatten(remote.snapshot?.children||[]).length;
  const plan={token:crypto.randomUUID(),fingerprint:await fingerprint(current),endpoint:syncEndpoint(c),remote,candidate,conflicts:merged.conflicts,unresolved:merged.unresolved,tombstones:merged.tombstones,first:!base,recovery:!!data.syncInProgress,
    localChanges:localPlan.changes,cloudChanges:followOnly?[]:remotePlan.changes,metaChanged:localPlan.metaChanged||remotePlan.metaChanged,largeDeletion:deletions>0&&deletions/Math.max(1,size)>.2,
    followOnly,laggards:merged.laggards||0};
  await chrome.storage.session.set({syncPreview:plan});return plan;
}
function syncView(p){return {token:p.token,first:p.first,recovery:p.recovery,followOnly:p.followOnly,laggards:p.laggards,conflicts:p.conflicts,unresolved:p.unresolved,localChanges:p.localChanges,cloudChanges:p.cloudChanges,metaChanged:p.metaChanged,largeDeletion:p.largeDeletion};}
async function applySync(token,auto=false){
  const {syncPreview:p}=await chrome.storage.session.get('syncPreview');if(!p||p.token!==token)throw Error('请重新预览同步');
  if(p.unresolved)throw Error('请先选择冲突处理方式，再更新预览');
  if(auto&&(p.first||p.largeDeletion||p.conflicts.length||p.recovery))throw Error('同步需要你确认，请在备份页查看变化与冲突');
  const {data,c}=await syncConfiguration();if(syncEndpoint(c)!==p.endpoint)throw Error('连接已变化，请重新预览');
  const current=await captureSnapshot('同步前自动保护');if(await fingerprint(current)!==p.fingerprint)throw Error('本机数据已变化，请重新预览同步');
  const latest=await readSync(c);if(latest.etag!==p.remote.etag||latest.revision!==p.remote.revision)throw Error('云端已被另一台设备更新，请重新预览同步');
  const changed=!p.followOnly&&syncContent(p.candidate)!==syncContent(latest.snapshot),localChanged=p.localChanges.length||BK.plan(current,p.candidate).metaChanged;
  if(changed||localChanged)await storeSnapshot(current);
  if(changed&&latest.snapshot){
    const protection={...latest.snapshot,id:crypto.randomUUID(),createdAt:new Date().toISOString(),reason:'同步前云端保护'};
    await storeSnapshot(protection);await uploadSnapshot(protection);
  }
  // Recheck after potentially slow backup requests, before any shared state is written.
  if(await fingerprint(await captureSnapshot())!==p.fingerprint)throw Error('备份期间本机数据发生变化，请重新预览同步');
  const busy=await WriteLease.heldByOther('sync');
  if(busy)throw Error(`${WriteLease.NAME[busy.owner]||busy.owner}正在改书签，请等它结束或撤销后再同步`);
  const lease=(await WriteLease.acquire('sync')).lease;
  const operation=crypto.randomUUID();await chrome.storage.local.set({syncInProgress:{operation,endpoint:p.endpoint,startedAt:new Date().toISOString()},syncAuto:false});
  try{
    if(changed){
      const updatedAt=new Date().toISOString(),shared=syncContent(p.candidate);
      const payload={format:'tabisle-sync',version:1,revision:operation,parentRevision:latest.revision||null,updatedAt,updatedBy:{id:String(p.candidate.deviceId||'').slice(0,80),name:String(p.candidate.device||'').slice(0,60)},sha256:await contentHash(shared),snapshot:{...p.candidate,id:operation,createdAt:updatedAt,reason:'同步版本',prefs:{},folderState:{}}};
      const response=latest.etag?await syncRequest(c,'PUT','state.json',JSON.stringify(payload),{'Content-Type':'application/json','If-Match':latest.etag}):await createSyncFile(c,JSON.stringify(payload),operation);
      if(response.status===412){await chrome.storage.local.remove('syncInProgress');throw Error('另一台设备刚刚更新了云端，本次未覆盖，请重新预览');}
      // 🔴 服务器明确回了一个非 2xx ＝ 这次请求被它拒了、云端一个字没写 ⇒ 跟 412 一样撤掉标记。
      //    原来这里保留标记，于是坚果云抖一下 503，自动同步就再也不跑了（260914 核实官实测整条链）。
      //    真正需要保留标记的是「请求发出去了但不知道结果」——那种情况会从下面的 catch 走。
      if(!response.ok){await chrome.storage.local.remove('syncInProgress');throw Error('云端写入失败（'+response.status+'），本次没有写进云端，会自动重试');}
    }
    const verified=await readSync(c);
    if(verified.revision!==(changed?operation:latest.revision)||syncContent(verified.snapshot)!==syncContent(p.candidate))throw Error('云端读回校验不一致，自动同步已暂停，请重新预览');
    if(await fingerprint(await captureSnapshot())!==p.fingerprint)throw Error('云端保存期间本机有新变化；已暂停同步，请重新预览合并');
    syncGuard={dirty:false,expected:[]};const identity={},originalIds=new Set(BK.flatten(current.children).map(n=>n.id));
    const savedIdentity=(await chrome.storage.local.get('bookmarkIdentity')).bookmarkIdentity||{};
    const check=()=>{if(syncGuard.dirty){const d=syncGuard.diagnostic;throw Error('检测到未预期的书签事件，已停止应用；请重新预览合并。诊断：'+JSON.stringify(d));}};
    const api={...bookmarkAPI};
    for(const method of ['create','update','move','remove','removeTree'])api[method]=async(...args)=>{
      check();const fields=method==='create'?args[0]:args[1]||{};
      syncGuard.expected.push({type:method==='removeTree'?'remove':method,id:method==='create'?null:args[0],...(method==='create'?{parentId:fields.parentId,title:fields.title,url:fields.url}:method==='move'?{parentId:fields.parentId}:{})});
      const result=await bookmarkAPI[method](...args);check();return result;
    };
    const desiredByUid=new Map(BK.flatten(p.candidate.children).map(n=>[n.uid,n]));
    const live=await BK.restore(api,current.barId,current,p.candidate,async(uid,n)=>{
      check();const wanted=desiredByUid.get(uid);identity[n.id]={uid,dateAdded:n.dateAdded,...(wanted?.url&&wanted.url!==n.url&&BK.browserUrlEqual(wanted.url,n.url)?{syncUrl:wanted.url}:{})};
      // Persist each placement so an interrupted create can be identified on the next merge.
      if(!originalIds.has(n.id)){savedIdentity[n.id]=identity[n.id];await chrome.storage.local.set({bookmarkIdentity:savedIdentity});}
    });
    check();const beforeMeta=(await chrome.storage.local.get('meta')).meta||{items:{},groups:{},tags:[]};
    if(!SC.equal(beforeMeta,current.meta))throw Error('同步期间备注发生变化，请重新预览合并');
    const folderCollapsed={};
    const aligned=SC.align(current,p.candidate);for(const [uid,v]of Object.entries(aligned.folderState||{})){const n=live.get(uid);if(n)folderCollapsed[`${n.id}:${n.dateAdded||0}`]=v;}
    await chrome.storage.local.set({meta:p.candidate.meta,bookmarkIdentity:identity,folderCollapsed});
    const applied=await captureSnapshot();check();if(syncContent(applied)!==syncContent(p.candidate))throw Error('书签在应用过程中变化，请重新预览合并');
    const finalRemote=await readSync(c);check();
    if(syncContent(await captureSnapshot())!==syncContent(applied))throw Error('核验期间本机内容变化，请重新预览合并');
    if(finalRemote.revision!==verified.revision||syncContent(finalRemote.snapshot)!==syncContent(applied))throw Error('本机应用后云端已有变化，自动同步已暂停，请重新预览');
    const receipt={verifiedAt:new Date().toISOString(),revision:finalRemote.revision,sha256:await contentHash(syncContent(applied)),count:BK.flatten(applied.children).filter(n=>n.url).length,uploaded:!!changed,localApplied:!!localChanged,localChanges:p.localChanges.reduce((r,c)=>(r[c.op]=(r[c.op]||0)+1,r),{}),cloudChanges:p.cloudChanges.reduce((r,c)=>(r[c.op]=(r[c.op]||0)+1,r),{}),endpoint:p.endpoint,followOnly:!!p.followOnly,laggards:p.laggards||0};
    await chrome.storage.local.set({syncInProgress:null,lastSyncReceipt:receipt,syncState:{endpoint:p.endpoint,base:portable(applied),etag:finalRemote.etag,revision:finalRemote.revision,parentRevision:finalRemote.parentRevision,updatedAt:finalRemote.updatedAt,updatedBy:finalRemote.updatedBy,sha256:finalRemote.sha256},syncTombstones:p.tombstones,lastSyncAt:new Date().toISOString(),syncError:'',syncErrorTransient:false,syncFailStreak:0,syncRetryAfter:0,syncAuto:auto||!!data.syncAuto});
    await chrome.storage.session.remove('syncPreview');return true;
  }catch(error){await noteSyncFailure(error.message);if(syncGuard?.diagnostic)await chrome.storage.session.set({syncDiagnostic:syncGuard.diagnostic});throw error;}finally{syncGuard=null;await WriteLease.release(lease?.id);}
}
// 自动同步遇到冲突时怎么选。
// 墓碑触发的那类冲突（id 以 :return 结尾，「可能是旧同步回流，也可能是重新收藏」）本机写「保留」、云端写「移除」。
// 🔴 两种情形在合并眼里长得一模一样，但该走相反的路：
//   · 账号同步的回声（我们刚删，Chrome 账号同步几秒后又塞回来）⇒ 跟着云端删，这是 Codex 当初做墓碑的正当场景
//   · 用户有意加回来（从备份恢复、撤销、重新收藏）⇒ 必须保留，否则下一分钟就被静默删掉、墓碑还续一笔
// 260914 实撞：原来一律选云端，上午两条书签、下午的验收夹都是这么反复消失的。
// 判据三条，命中任一就保留：⓪ 它是从云端来的（别的设备有意加的，回声到不了云端）① 这个节点是我们自己建的（intentionalCreates 里有它的 id）
//                             ② 对应墓碑已经超过 10 分钟 —— 回声只会紧跟着删除发生，隔久了就是人的新意图
const ECHO_WINDOW_MS=10*60e3;
function cloudFirstChoices(conflicts,ctx={}){
  const intentional=new Set((ctx.intentionalCreates||[]).map(x=>String(x.id)));
  const idOfUid={};for(const [id,v] of Object.entries(ctx.bookmarkIdentity||{}))if(v&&v.uid)idOfUid[v.uid]=String(id);
  const tombAge=(uid,path,url)=>{const t=(ctx.tombstones||[]).find(t=>t.uid===uid||(t.path===path&&t.url===url));return t&&t.at?Date.now()-Date.parse(t.at):null;};
  return Object.fromEntries((conflicts||[]).map(c=>{
    const id=String(c.id);
    if(!id.endsWith(':return'))return [id,'remote'];
    if(c.from==='remote')return [id,'local'];       // 从云端来的重新出现 ＝ 别的设备有意加的，🚫 不是回声
    const uid=id.slice(0,-':return'.length);
    const mine=intentional.has(idOfUid[uid]||'');
    const age=tombAge(uid,c.path,c.url);
    const old=age===null||age>ECHO_WINDOW_MS;     // 没时间戳的老墓碑也当「隔久了」
    return [id,(mine||old)?'local':'remote'];
  }));
}
async function syncCloudFirst(){
  const {data,c}=await syncConfiguration();
  if(data.syncVerified!==syncVerification(c))await verifySync(c);
  let p;
  if(data.syncInProgress){
    const remote=await readSync(c);if(!remote.snapshot)throw Error('云端没有可恢复的共同版本，已保留本机资料');
    const current=await captureSnapshot('以云端恢复前');
    const candidate=portable(remote.snapshot),plan=BK.plan(current,candidate);
    p={token:crypto.randomUUID(),fingerprint:await fingerprint(current),endpoint:syncEndpoint(c),remote,candidate,conflicts:[],unresolved:0,tombstones:data.syncTombstones||[],first:false,recovery:true,localChanges:plan.changes,cloudChanges:[],metaChanged:plan.metaChanged,largeDeletion:false};
    await chrome.storage.session.set({syncPreview:p});
  }else{
    p=await prepareSync({},true);
    if(p.unresolved){
      const ctx=await chrome.storage.local.get(['intentionalCreates','bookmarkIdentity','syncTombstones']);
      p=await prepareSync(cloudFirstChoices(p.conflicts,{intentionalCreates:ctx.intentionalCreates,bookmarkIdentity:ctx.bookmarkIdentity,tombstones:ctx.syncTombstones}),true);
    }
  }
  await applySync(p.token);
  await chrome.storage.local.set({syncAuto:true});return true;
}
// 🔴 260914 实撞（老徐「每次都这样」）：原来任何一次失败都 syncAuto:false，
// 于是一次网络抖动 ＝ 自动同步永久停摆，顶栏那颗药丸从此一直是「同步失败」，
// 而且它不会自己再试，非要人手动成功一次才清掉。
// 把错误分成两类：
//   · 自己会好的（网络不通、服务端 5xx、超时、被别人占着）⇒ 保持自动同步开着，等下一轮
//   · 要人来拿主意的（冲突、首次同步、大量删除、读回核验对不上、账号密码不对）⇒ 才停下来等人
const TRANSIENT = /网络|超时|timeout|failed to fetch|network|ECONN|5\d\d\)|请求失败（5|暂时|稍后再试|正在改书签|请等它结束/i;
const transientError = (msg) => TRANSIENT.test(String(msg || ''));
// 连着失败几次就别再自己扛了。
// 🔴 两头都要防：
//   · 只重试不升级 ⇒ 密码改了、云端挂了一整天，它每分钟白试一次，永远不告诉人
//   · 只升级不重试 ⇒ 网络抖一下就把自动同步永久关掉（v0.10.18 之前就是这样）
// 退避 1 → 2 → 4 → 8 → 16 → 30 分钟封顶，累计约一小时还不成，就转成「要你处理」。
// 真抖动一两次就过去了，人根本不会看见；真故障一小时内一定会摆到台面上。
const STUCK_RECOVER_MS=10*60e3;   // 「做到一半」的标记搁够这么久还在，就按保守合并自己往下走
const RETRY_MAX = 6;
const retryDelay = (n) => Math.min(30, Math.pow(2, Math.max(0, n - 1))) * 60e3;
async function noteSyncFailure(message){
  const { syncFailStreak = 0 } = await chrome.storage.local.get('syncFailStreak');
  const streak = syncFailStreak + 1;
  // 一直连不上也是一种「要你处理」—— 只是这个结论要等它试够了才下
  const keepAuto = transientError(message) && streak < RETRY_MAX;
  const note = transientError(message) && streak >= RETRY_MAX
    ? `连续 ${streak} 次都没能同步成功，已暂停自动同步。最后一次的原因：${message}`
    : String(message || '');
  await chrome.storage.local.set({ syncError: note, syncErrorTransient: keepAuto, syncFailStreak: streak,
    syncRetryAfter: keepAuto ? Date.now() + retryDelay(streak) : 0,
    ...(keepAuto ? {} : { syncAuto: false }) });
}
async function maybeSync(){
  // 🔴 有人正在成批改书签（AI 整理／恢复）就不要插进去：两边同时写，守卫只会把对方当外来改动，双双中止
  if(await WriteLease.heldByOther('sync'))return;
  const d=await chrome.storage.local.get(['syncAuto','lastSyncAt','syncInProgress','backupMode','webdav','syncError','syncState','syncRetryAfter']);
  // 🔴 自愈：v0.10.18 之前，任何一次失败（哪怕只是网络抖一下）都会把自动同步关掉，
  // 而它自己永远不会再打开 —— 用户看到的就是「每次都这样」。
  // 判据：自动同步是关的 ＋ 挂着一条会自己好的错 ＋ 以前确实同步成功过
  //      ⇒ 那它一定是被失败关掉的，不是用户自己关的（用户自己关时会把 syncError 清掉）。
  if(!d.syncAuto&&d.syncError&&transientError(d.syncError)&&d.syncState){
    await chrome.storage.local.set({syncAuto:true,syncErrorTransient:true,syncFailStreak:0,syncRetryAfter:0});
    d.syncAuto=true;
  }
  // 🔴 第二种永久停摆：`syncInProgress` 一旦留下就没有任何自动路径清得掉它（全仓只有 412、
  //    本轮彻底成功、以及「忘记账号」三处会清），而下面这一行见到它就 return ⇒ 上面那套退避重试
  //    一次都跑不到。用户看到的还是「每次都这样」，只是换了个开关（260914 核实官查出）。
  //    放行是安全的：applySync 取 base 时 `!data.syncInProgress` 已经把基线置空 ⇒ 走的是
  //    「首次合并」那套语义，两边的东西都留下，不会拿云端去抹本机。🚫 别在这儿改成走云端优先。
  const stuckSince=d.syncInProgress?Date.parse(d.syncInProgress.startedAt||0):0;
  if(d.syncInProgress&&stuckSince&&Date.now()-stuckSince>STUCK_RECOVER_MS&&d.syncState){
    await chrome.storage.local.remove('syncInProgress');
    await chrome.storage.local.set({syncErrorTransient:true,syncError:'上次同步没跑完，已按「两边都保留」重新合并'});
    d.syncInProgress=null;
  }
  if(!d.syncAuto||d.syncInProgress||modeOf(d)!=='webdav'||!d.webdav?.enabled||Date.now()-nativeLastChange<3000)return;
  // 🔴 同步的排期是按 lastSyncAt 算的，而失败时它不更新 ⇒ 没有这一行就会每分钟砸一次云端
  if(d.syncRetryAfter&&Date.now()<d.syncRetryAfter)return;
  const schedule=await automationStatus();if(schedule.sync.state!=='waiting'||Date.now()<schedule.sync.nextAt)return;
  try{
    const latest=await latestSyncStatus();
    if(latest.state==='latest'){
      await chrome.storage.local.set({lastSyncAt:new Date().toISOString(),syncError:'',syncErrorTransient:false,syncFailStreak:0,syncRetryAfter:0});
      return;
    }
    await syncCloudFirst();
  }catch(e){await noteSyncFailure(e.message);}
}
async function syncAction(message){
  switch(message.type){
    case 'SYNC_STATUS':{const d=await chrome.storage.local.get(['syncAuto','lastSyncAt','syncError','syncErrorTransient','syncInProgress','syncState','webdav','syncCheck','syncVerified','lastSyncReceipt','syncFollowOnly']);const {endpoint,...check}=d.syncCheck||{};const {endpoint:receiptEndpoint,...receipt}=d.lastSyncReceipt||{};return {receipt:receiptEndpoint===syncEndpoint(d.webdav||DAV_DEFAULT)?receipt:null,check:endpoint===syncEndpoint(d.webdav||DAV_DEFAULT)?check:null,verified:d.syncVerified===syncVerification(d.webdav||DAV_DEFAULT),auto:!!d.syncAuto,followOnly:!!d.syncFollowOnly,lastSyncAt:d.lastSyncAt,error:d.syncError,
      // 🔴 这个标记是 v0.10.18 才有的：在那之前记下的失败一律没有它，
      // 直接当 false 会把老的「503／连不上」全归到「要你处理」，白白吓人一跳。
      // 字段不存在时（≠ 存着 false）现场按错误文本判一次。
      errorTransient:d.syncErrorTransient===undefined?transientError(d.syncError):!!d.syncErrorTransient,inProgress:!!d.syncInProgress,initialized:!!d.syncState&&d.syncState.endpoint===syncEndpoint(d.webdav||DAV_DEFAULT)};}
    case 'SYNC_NOW':return syncCloudFirst();
    case 'SYNC_PREVIEW':return syncView(await prepareSync(message.choices||{},true));
    case 'SYNC_APPLY':return applySync(message.token);
    case 'SYNC_LATEST_STATUS':return latestSyncStatus();
    case 'SYNC_AUTO':{
      if(message.enabled){const {data,c}=await syncConfiguration();if(data.syncInProgress||data.syncState?.endpoint!==syncEndpoint(c)||data.syncVerified!==syncVerification(c))throw Error('请先完成一次同步');}
      await chrome.storage.local.set({syncAuto:!!message.enabled,syncError:'',syncFailStreak:0,syncRetryAfter:0});return true;
    }
    case 'SYNC_FOLLOW_ONLY':
      // 这台只接收、不上传。🔴 只存本机，🚫 不进同步内容 —— 否则一开就传染给所有设备
      await chrome.storage.local.set({syncFollowOnly:!!message.enabled});return true;
    default:throw Error('未知同步操作');
  }
}
