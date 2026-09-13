const BK=BookmarkCore;
const PREF_KEYS=['view','recentCollapsed','filterMode'];
const DAV_DEFAULT={enabled:false,url:'https://dav.jianguoyun.com/dav/书签首页备份/',username:'',password:''};
async function bookmarkBar() {
  const roots=(await chrome.bookmarks.getTree())[0].children;
  const bar=roots.find(n=>n.folderType==='bookmarks-bar')||roots.find(n=>n.id==='1');
  if(!bar)throw Error('找不到书签栏');
  return bar;
}
async function captureSnapshot(reason='手动备份') {
  const bar=await bookmarkBar();
  const data=await chrome.storage.local.get(['bookmarkIdentity','meta',...PREF_KEYS]);
  const identity=data.bookmarkIdentity||{}, next={};
  const convert=n=>{
    const record=identity[n.id];
    const uid=record && record.dateAdded===n.dateAdded ? record.uid : crypto.randomUUID();
    next[n.id]={uid,dateAdded:n.dateAdded};
    return {uid,id:n.id,title:n.title,dateAdded:n.dateAdded,...(n.url?{url:n.url}:{children:(n.children||[]).map(convert)})};
  };
  const children=bar.children.map(convert);
  await chrome.storage.local.set({bookmarkIdentity:next});
  return {format:'newtab-bookmarks',version:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),reason,children,
    meta:data.meta||{items:{},groups:{},tags:[]},prefs:Object.fromEntries(PREF_KEYS.filter(k=>data[k]!==undefined).map(k=>[k,data[k]])),barId:bar.id};
}
function portable(snapshot) {
  const clean=nodes=>nodes.map(({id,children,...node})=>({...node,...(children?{children:clean(children)}:{})}));
  const {barId,...rest}=snapshot; return {...rest,children:clean(snapshot.children)};
}
async function fingerprint(snapshot) {
  const data=portable(snapshot);
  const bytes=new TextEncoder().encode(JSON.stringify({children:data.children,meta:data.meta,prefs:data.prefs}));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
async function storeSnapshot(snapshot) {
  const {backups=[]}=await chrome.storage.local.get('backups');
  let list=[portable(snapshot),...backups.filter(b=>b.id!==snapshot.id)].slice(0,20);
  // Keep storage bounded. Do not silently discard the safety snapshot we just made.
  while(list.length>1 && JSON.stringify(list).length>6e6)list.pop();
  await chrome.storage.local.set({backups:list,lastBackupAt:snapshot.createdAt,lastBackupError:''});
  return snapshot;
}
async function makeSnapshot(reason='手动备份') { return storeSnapshot(await captureSnapshot(reason)); }
async function ensureBackupAlarm() {
  if(!await chrome.alarms.get('daily-bookmark-backup'))await chrome.alarms.create('daily-bookmark-backup',{periodInMinutes:60});
}
async function maybeBackup() {
  const {lastBackupAt,restoreInProgress,backupAuto=true}=await chrome.storage.local.get(['lastBackupAt','restoreInProgress','backupAuto']);
  if(restoreInProgress||!backupAuto||Date.now()-Date.parse(lastBackupAt||0)<24*3600e3)return;
  try {
    const snapshot=await makeSnapshot('每日自动备份');
    const {webdav=DAV_DEFAULT}=await chrome.storage.local.get('webdav');
    if(webdav.enabled)await uploadSnapshot(snapshot);
  } catch(error) { await chrome.storage.local.set({lastBackupError:error.message}); throw error; }
}
function davURL(value) {
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='dav.jianguoyun.com'||url.port||url.username||url.password||!url.pathname.startsWith('/dav/'))throw Error('请使用坚果云的 https://dav.jianguoyun.com/dav/ 目录地址');
  url.search='';url.hash='';if(!url.pathname.endsWith('/'))url.pathname+='/';return url;
}
async function davConfig() {
  const {webdav=DAV_DEFAULT}=await chrome.storage.local.get('webdav');
  if(!webdav.username||!webdav.password)throw Error('请先填写坚果云账号和应用密码');
  if(!await chrome.permissions.contains({origins:['https://dav.jianguoyun.com/*']}))throw Error('尚未授权访问坚果云，请在设置中保存并授权');
  return {...webdav,url:davURL(webdav.url).href};
}
async function davRequest(config,method,name='',body,headers={}) {
  if(name&&!/^bookmarks-[a-zA-Z0-9-]+\.json$/.test(name))throw Error('备份文件名不正确');
  const bytes=new TextEncoder().encode(config.username+':'+config.password);let auth='';for(const b of bytes)auth+=String.fromCharCode(b);
  const r=await fetch(config.url+name,{method,headers:{Authorization:'Basic '+btoa(auth),...headers},body,redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});
  if(!r.ok && !(method==='MKCOL'&&r.status===405))throw Error(`坚果云 ${method} 失败（${r.status}）${r.status===409?'，请先在坚果云创建上级目录':''}`);
  return r;
}
async function uploadSnapshot(snapshot) {
  const config=await davConfig();await davRequest(config,'MKCOL');
  const name='bookmarks-'+snapshot.createdAt.replace(/[^0-9TZ]/g,'')+'-'+snapshot.id+'.json';
  await davRequest(config,'PUT',name,JSON.stringify(portable(snapshot)),{'Content-Type':'application/json','If-None-Match':'*'});
  await chrome.storage.local.set({lastCloudBackupAt:new Date().toISOString(),lastBackupError:''});return name;
}
const bookmarkAPI={get:async id=>(await chrome.bookmarks.get(id))[0],children:id=>chrome.bookmarks.getChildren(id),move:(id,d)=>chrome.bookmarks.move(id,d),update:(id,d)=>chrome.bookmarks.update(id,d),create:d=>chrome.bookmarks.create(d),remove:id=>chrome.bookmarks.remove(id),removeTree:id=>chrome.bookmarks.removeTree(id)};
async function backupAction(message) {
  switch(message.type) {
    case 'BACKUP_STATUS': {
      const data=await chrome.storage.local.get(['backups','backupAuto','lastBackupError','lastBackupAt','lastCloudBackupAt','webdav','restoreInProgress']);
      const cfg=data.webdav||DAV_DEFAULT;delete data.webdav;
      return {...data,backups:(data.backups||[]).map(b=>({id:b.id,createdAt:b.createdAt,reason:b.reason,count:BK.flatten(b.children).filter(n=>n.url).length})),webdav:{enabled:cfg.enabled,url:cfg.url,username:cfg.username,hasPassword:!!cfg.password}};
    }
    case 'BACKUP_CREATE': {
      const snapshot=await makeSnapshot('手动备份');
      const {webdav}=await chrome.storage.local.get('webdav');
      if(webdav?.enabled) { try {await uploadSnapshot(snapshot);}catch(e){await chrome.storage.local.set({lastBackupError:e.message});return {id:snapshot.id,warning:'本机备份已保存；'+e.message};} }
      return {id:snapshot.id};
    }
    case 'BACKUP_GET': { const {backups=[]}=await chrome.storage.local.get('backups');const b=backups.find(b=>b.id===message.id);if(!b)throw Error('该备份已不存在');return b; }
    case 'BACKUP_PREVIEW': {
      const desired=BK.validate(message.snapshot), current=await captureSnapshot();const p=BK.plan(current,desired);
      const token=crypto.randomUUID();await chrome.storage.session.set({restorePreview:{token,fingerprint:await fingerprint(current),snapshot:desired}});
      return {token,changes:p.changes,metaChanged:p.metaChanged,prefsChanged:p.prefsChanged};
    }
    case 'BACKUP_RESTORE': {
      const {restorePreview:p}=await chrome.storage.session.get('restorePreview');if(!p||p.token!==message.token)throw Error('请重新预览要恢复的备份');
      const current=await captureSnapshot('恢复前自动保护');if(await fingerprint(current)!==p.fingerprint)throw Error('书签或附属数据已变化，请重新预览后恢复');
      await storeSnapshot(current);await chrome.storage.local.set({restoreInProgress:{backupId:current.id,startedAt:new Date().toISOString()}});
      try {
        const live=await BK.restore(bookmarkAPI,current.barId,current,p.snapshot);
        const identity={};for(const [uid,n]of live)identity[n.id]={uid,dateAdded:n.dateAdded};
        const prefs={view:'card',recentCollapsed:false,filterMode:'and',...Object.fromEntries(PREF_KEYS.filter(k=>p.snapshot.prefs[k]!==undefined).map(k=>[k,p.snapshot.prefs[k]]))};
        await chrome.storage.local.set({meta:p.snapshot.meta,bookmarkIdentity:identity,...prefs});
        await chrome.storage.session.remove('restorePreview');
        // Drafts reference pre-restore IDs; clear them to avoid writing into restored records.
        const session=await chrome.storage.session.get(null);await chrome.storage.session.remove(Object.keys(session).filter(k=>k.startsWith('editorDraft:')||k.startsWith('editorSelection:')));
        await chrome.storage.local.remove('restoreInProgress');return {ok:true,safetyBackupId:current.id};
      }catch(e){throw Error('恢复未完成：'+e.message+'。恢复前的完整状态已保存在本机备份列表中，可预览后恢复。');}
    }
    case 'BACKUP_AUTO':await chrome.storage.local.set({backupAuto:!!message.enabled});return true;
    case 'BACKUP_DAV_SAVE': {
      const {webdav=DAV_DEFAULT}=await chrome.storage.local.get('webdav');
      const config={enabled:!!message.config.enabled,url:davURL(message.config.url).href,username:String(message.config.username||'').trim(),password:message.config.password||webdav.password};
      if(config.enabled&&(!config.username||!config.password))throw Error('开启云备份需要账号和应用密码');
      await chrome.storage.local.set({webdav:config});return true;
    }
    case 'BACKUP_DAV_LIST': {const c=await davConfig();await davRequest(c,'MKCOL');const r=await davRequest(c,'PROPFIND','','<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>',{'Depth':'1','Content-Type':'application/xml'});return {xml:await r.text(),base:c.url};}
    case 'BACKUP_DAV_GET': {const r=await davRequest(await davConfig(),'GET',message.name);const txt=await r.text();if(txt.length>12e6)throw Error('备份文件过大');return BK.validate(JSON.parse(txt));}
    case 'BACKUP_DAV_UPLOAD': {const {backups=[]}=await chrome.storage.local.get('backups');const b=backups.find(b=>b.id===message.id);if(!b)throw Error('请先创建本机备份');return uploadSnapshot(b);}
    default:throw Error('未知备份操作');
  }
}
