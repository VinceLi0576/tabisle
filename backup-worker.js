const BK=BookmarkCore;
// 🔴 aiStandard / aiTasks 放这儿是有意的：prefs 会进完整备份（写了的整理标准不会丢），
// 但同步时被清成 {}（不会传给别的设备，也不会跟别人的标准打架）。钥匙不在这儿，它一样都不进。
const PREF_KEYS=['view','recentCollapsed','filterMode','aiStandard','aiTasks'];
const DAV_DEFAULT={enabled:false,url:'https://dav.jianguoyun.com/dav/TabIsle/backups/',username:'',password:''};
const modeOf=data=>['webdav','browser','local'].includes(data.backupMode)?data.backupMode:'webdav';
const intervalOf=data=>[1,3,24,168,720].includes(data.backupIntervalHours)?data.backupIntervalHours:[1,7,30].includes(data.backupIntervalDays)?data.backupIntervalDays*24:1;
const policyState=data=>({mode:modeOf(data),auto:modeOf(data)!=='local'&&data.backupAuto!==false,intervalHours:intervalOf(data),device:String(data.backupDevice||'')});
async function contentHash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');}
function randomDeviceName() {
  const words=[
    '晴空 晨光 月色 星河 微风 初雪 春雨 秋阳 山岚 云影 朝露 晚霞 清风 远山 暖阳 流光 薄雾 新月 碧空 晓风 星光 雨后 长夏 初晴 落日 清晨 仲夏 银霜 春晓 夜雨 冬阳 海风',
    '松林 竹海 银杏 山谷 海湾 书屋 茶园 花田 溪谷 湖畔 沙洲 岛屿 绿洲 原野 枫林 芦苇 稻田 河岸 庭院 森林 石桥 雪山 草原 港湾 山麓 云台 果园 花溪 苔原 栈桥 柳岸 树屋',
    '白鹭 海豚 松鼠 飞燕 雪狐 鲸鱼 山雀 水獭 鹿 羚羊 云雀 熊猫 海鸥 翠鸟 夜莺 蝴蝶 蜻蜓 知更鸟 企鹅 萤火虫 蜂鸟 蓝鲸 野兔 雪豹 红鹤 喜鹊 斑鸠 海豹 河狸 鹤 雨燕 小熊'
  ];
  const picks=crypto.getRandomValues(new Uint32Array(3));
  return words.map((list,i)=>list.split(' ')[picks[i]%32]).join('·');
}
async function ensureBackupDevice() {
  const saved=await chrome.storage.local.get(['backupDevice','backupDeviceId']);
  const name=String(saved.backupDevice||'').trim();
  const device=name&&name!=='未命名设备'?name:randomDeviceName();
  const deviceId=saved.backupDeviceId||crypto.randomUUID();
  if(device!==saved.backupDevice||deviceId!==saved.backupDeviceId)await chrome.storage.local.set({backupDevice:device,backupDeviceId:deviceId});
  return {device,deviceId};
}
async function bookmarkBar() {
  const roots=(await chrome.bookmarks.getTree())[0].children;
  const bar=roots.find(n=>n.folderType==='bookmarks-bar')||roots.find(n=>n.id==='1');
  if(!bar)throw Error('找不到书签栏');
  return bar;
}
async function captureSnapshot(reason='手动备份') {
  const device=await ensureBackupDevice();
  const bar=await bookmarkBar();
  const data=await chrome.storage.local.get(['bookmarkIdentity','meta','folderCollapsed','backupDevice',...PREF_KEYS]);
  const folderState={};
  const identity=data.bookmarkIdentity||{}, next={};
  const convert=n=>{
    const record=identity[n.id];
    const uid=record && record.dateAdded===n.dateAdded ? record.uid : crypto.randomUUID();
    const syncUrl=record?.dateAdded===n.dateAdded&&record.syncUrl&&BK.browserUrlEqual(record.syncUrl,n.url)?record.syncUrl:null;
    next[n.id]={uid,dateAdded:n.dateAdded,...(syncUrl?{syncUrl}:{})};
    const folded=data.folderCollapsed?.[`${n.id}:${n.dateAdded||0}`];
    if(!n.url&&typeof folded==='boolean')folderState[uid]=folded;
    return {uid,id:n.id,title:n.title,dateAdded:n.dateAdded,...(n.url?{url:syncUrl||n.url}:{children:(n.children||[]).map(convert)})};
  };
  const children=bar.children.map(convert);
  if(BK.stableStringify(identity)!==BK.stableStringify(next))await chrome.storage.local.set({bookmarkIdentity:next});
  return {format:'newtab-bookmarks',version:1,id:crypto.randomUUID(),createdAt:new Date().toISOString(),reason,children,
    meta:data.meta||{items:{},groups:{},tags:[]},prefs:Object.fromEntries(PREF_KEYS.filter(k=>data[k]!==undefined).map(k=>[k,data[k]])),folderState,...device,barId:bar.id};
}
function portable(snapshot) {
  const clean=nodes=>nodes.map(({id,children,...node})=>({...node,...(children?{children:clean(children)}:{})}));
  const {barId,...rest}=snapshot; return {...rest,children:clean(snapshot.children)};
}
async function fingerprint(snapshot) {
  const data=portable(snapshot);
  const bytes=new TextEncoder().encode(JSON.stringify({children:data.children,meta:data.meta,prefs:data.prefs,folderState:data.folderState}));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
// storage.local 整个区上限 10 MB（清单没申请 unlimitedStorage），而这个区里不止住着备份：
// meta、bookmarkIdentity、syncState、各种草稿都在同一个 10 MB 里。
// 🔴 260914 核实官量出来：原来用 JSON.stringify().length 数的是 UTF-16 码元，
//    中文书签的真实 UTF-8 字节是它的 1.37 倍（极端全中文 1.71 倍）⇒ 6e6「字符」
//    实际放行 7.8～9.8 MB，几乎把整个区吃光，而且撞上限时没有任何处理。
// 改成按真实字节算，并且给别的键留出余量。
const BYTES=(v)=>new TextEncoder().encode(typeof v==='string'?v:JSON.stringify(v)).length;
const BACKUP_BYTES_MAX=5.5*1024*1024;      // 10 MB 的区，备份最多占这么多，其余留给 meta 等
async function storeSnapshot(snapshot) {
  const {backups=[]}=await chrome.storage.local.get('backups');
  let list=[portable(snapshot),...backups.filter(b=>b.id!==snapshot.id)].slice(0,20);
  // Keep storage bounded. Do not silently discard the safety snapshot we just made.
  while(list.length>1 && BYTES(list)>BACKUP_BYTES_MAX)list.pop();
  // 🔴 原来这里是 `list.length>1`，意思是「只剩一份就不再裁」⇒ 单份本身超标时闸门完全失效，
  //    原样写进去、撞配额、整个 set 失败。单份就超标的，宁可一份都不留也别把区写爆。
  if(list.length===1 && BYTES(list)>BACKUP_BYTES_MAX){
    const kept=BYTES(list);
    await chrome.storage.local.set({backups:[],lastBackupError:`这一份备份 ${(kept/1048576).toFixed(1)} MB，超过本机可用空间，没有保存。请改用坚果云备份，或先清理书签。`});
    throw Error('单份备份体积超出本机存储上限，未保存');
  }
  // 🔴 配额打回时连 lastBackupError 都写不进去 ⇒ 自动路径的错误只落在控制台，界面上什么都看不见。
  //    先试着只写一条精简的错误（它一定写得下），再把失败抛给调用方。
  try{
    await chrome.storage.local.set({backups:list,lastBackupAt:snapshot.createdAt,lastBackupError:''});
  }catch(e){
    try{await chrome.storage.local.set({backups:backups.slice(0,Math.max(0,backups.length-1)),lastBackupError:'本机存储写不下了，这次备份没有保存：'+(e.message||e)});}catch{}
    throw Error('本机存储写不下了，这次备份没有保存。请到备份页清理旧版本，或改用坚果云备份。原因：'+(e.message||e));
  }
  return snapshot;
}
// 只刷新「chrome id → 稳定身份 uid」的映射，不产生备份版本。
// 页面拿它来把锁、范围这类东西挂在不随改名变化的身份上。
async function ensureIdentity(){
  const bar=await bookmarkBar();
  const {bookmarkIdentity}=await chrome.storage.local.get('bookmarkIdentity');
  const identity=bookmarkIdentity||{},next={},map={};
  const walk=(n)=>{
    const rec=identity[n.id];
    const uid=rec&&rec.dateAdded===n.dateAdded?rec.uid:crypto.randomUUID();
    next[n.id]={uid,dateAdded:n.dateAdded};map[n.id]=uid;
    for(const c of n.children||[])walk(c);
  };
  for(const c of bar.children||[])walk(c);
  if(BK.stableStringify(identity)!==BK.stableStringify(next))await chrome.storage.local.set({bookmarkIdentity:next});
  return map;
}
async function makeSnapshot(reason='手动备份') { return storeSnapshot(await captureSnapshot(reason)); }
async function ensureBackupAlarm() {
  if((await chrome.alarms.get('daily-bookmark-backup'))?.periodInMinutes!==5)await chrome.alarms.create('daily-bookmark-backup',{periodInMinutes:5});
}
async function maybeBackup() {
  const data=await chrome.storage.local.get(['lastBackupAt','restoreInProgress','syncInProgress','backupAuto','backupMode','backupIntervalDays','backupIntervalHours','webdav','pendingCloudBackup','backups']);
  if(data.restoreInProgress||data.syncInProgress||modeOf(data)==='local')return;
  if(await WriteLease.heldByOther('backup'))return;   // 有人正在成批改书签，等它结束再拍，🚫 别把半成品存成版本
  try {
    const schedule=await automationStatus();
    const due=schedule.backup.state==='waiting'&&Date.now()>=schedule.backup.nextAt;
    // Keep creating local protection even when the cloud remains unavailable.
    const snapshot=due?await makeSnapshot('定时自动备份'):null;
    if(modeOf(data)==='webdav'&&data.webdav?.enabled){
      const pending=snapshot||(data.backups||[]).find(b=>b.id===data.pendingCloudBackup);
      if(pending&&(snapshot||(schedule.retry.state==='waiting'&&Date.now()>=schedule.retry.nextAt)))await uploadSnapshot(pending);
      else if(!pending&&data.pendingCloudBackup)await chrome.storage.local.remove('pendingCloudBackup');
    }
  } catch(error) { await chrome.storage.local.set({lastBackupError:error.message}); await deferFailedAutomation(); throw error; }
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
async function davRequest(config,method,name='',body,headers={},allowedStatuses=[]) {
  if(name&&!/^(?:\d{4}-(?:0[1-9]|1[0-2])\/)?bookmarks-[a-zA-Z0-9-]+\.json$/.test(name)&&!/^\d{4}-(?:0[1-9]|1[0-2])\/$/.test(name))throw Error('备份文件名不正确');
  const bytes=new TextEncoder().encode(config.username+':'+config.password);let auth='';for(const b of bytes)auth+=String.fromCharCode(b);
  const r=await fetch(config.url+name,{method,headers:{Authorization:'Basic '+btoa(auth),...headers},body,cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(20000)});
  if(!r.ok && !allowedStatuses.includes(r.status) && !(method==='MKCOL'&&r.status===405)&&!(method==='PUT'&&r.status===412)){
    const help={401:'账号或应用密码不正确，请使用第三方应用密码',403:'没有目录访问权限，请检查应用授权',404:'目录或版本不存在',409:'上级目录不存在，请重新连接并创建目录',429:'请求过于频繁，请稍后重试',507:'坚果云容量或额度不足，请检查账户权益'};
    throw Error(`坚果云 ${method} 失败（${r.status}）：${help[r.status]||'请检查网络或稍后重试'}`);
  }
  return r;
}
async function ensureDavDirectory(config){
  const url=davURL(config.url),parts=url.pathname.slice('/dav/'.length).split('/').filter(Boolean);
  let path='https://dav.jianguoyun.com/dav/';
  if(parts.length>8)throw Error('备份目录最多支持 8 层');
  for(const part of parts){path+=part+'/';await davRequest({...config,url:path},'MKCOL');}
}
async function uploadSnapshot(snapshot) {
  const data=await chrome.storage.local.get('backupMode');
  if(modeOf(data)!=='webdav')throw Error('当前方案已关闭云端上传；请先选择坚果云方案');
  const config=await davConfig();
  const period=new Date(snapshot.createdAt).toISOString().slice(0,7);
  const name=period+'/bookmarks-'+snapshot.createdAt.replace(/[^0-9TZ]/g,'')+'-'+snapshot.id+'.json';
  const body=JSON.stringify(portable(snapshot));
  await chrome.storage.local.set({pendingCloudBackup:snapshot.id,lastCloudAttemptAt:new Date().toISOString()});
  try{
    await ensureDavDirectory(config);await davRequest(config,'MKCOL',period+'/');
    const equalCopy=async response=>{
      try{return BK.stableStringify(BK.validate(JSON.parse(await response.text())))===BK.stableStringify(portable(snapshot));}catch{return false;}
    };
    // Jianguoyun may ignore If-None-Match. UUID filenames isolate independent snapshots;
    // check an existing copy before retrying and compare data rather than JSON key order.
    const existing=await davRequest(config,'GET',name,undefined,{},[404]);
    if(existing.status!==404){
      if(!await equalCopy(existing))throw Error('云端存在同名但内容不同的版本，未覆盖，请保留本机副本');
    }else{
      const response=await davRequest(config,'PUT',name,body,{'Content-Type':'application/json','If-None-Match':'*'});
      if(response.status===412&&!await equalCopy(await davRequest(config,'GET',name)))throw Error('云端存在同名但内容不同的版本，未覆盖，请保留本机副本');
    }
    const readback=await davRequest(config,'GET',name);
    if(!await equalCopy(readback))throw Error('云端备份读回校验失败，本机副本已保留，将重试');
    const verifiedAt=new Date().toISOString();
    await chrome.storage.local.set({lastCloudBackupAt:verifiedAt,lastBackupError:'',lastBackupReceipt:{verifiedAt,file:name,httpStatus:readback.status,sha256:await contentHash(BK.stableStringify(portable(snapshot))),count:BK.flatten(snapshot.children).filter(n=>n.url).length,endpoint:config.url,account:config.username}});
    await chrome.storage.local.remove('pendingCloudBackup');return name;
  }catch(error){await chrome.storage.local.set({lastBackupError:error.message});throw error;}
}
const bookmarkAPI={get:async id=>(await chrome.bookmarks.get(id))[0],children:id=>chrome.bookmarks.getChildren(id),move:(id,d)=>chrome.bookmarks.move(id,d),update:(id,d)=>chrome.bookmarks.update(id,d),create:d=>chrome.bookmarks.create(d),remove:id=>chrome.bookmarks.remove(id),removeTree:id=>chrome.bookmarks.removeTree(id)};
async function backupAction(message) {
  switch(message.type) {
    case 'BACKUP_STATUS': {
      await ensureBackupDevice();
      const data=await chrome.storage.local.get(['backups','backupAuto','backupMode','backupIntervalDays','backupIntervalHours','backupDevice','lastBackupError','lastBackupAt','lastCloudBackupAt','webdav','restoreInProgress','pendingCloudBackup','lastBackupReceipt']);
      const cfg=data.webdav||DAV_DEFAULT;delete data.webdav;
      const receipt=data.lastBackupReceipt;delete data.lastBackupReceipt;
      const {endpoint,account,...safeReceipt}=receipt||{};
      const backupReceipt=endpoint===cfg.url&&account===cfg.username?safeReceipt:null;
      return {...data,policyState:policyState(data),backupReceipt,backupMode:modeOf(data),backupIntervalHours:intervalOf(data),backupIntervalDays:intervalOf(data)/24,backups:(data.backups||[]).map(b=>({id:b.id,createdAt:b.createdAt,reason:b.reason,device:b.device||'旧版本',bytes:new TextEncoder().encode(JSON.stringify(b)).length,count:BK.flatten(b.children).filter(n=>n.url).length})),webdav:{enabled:cfg.enabled&&modeOf(data)==='webdav',url:cfg.url,username:cfg.username,hasPassword:!!cfg.password}};
    }
    case 'BACKUP_POLICY_SAVE': {
      const hours=message.intervalHours??(message.intervalDays*24);
      if(!['webdav','browser','local'].includes(message.mode)||![1,3,24,168,720].includes(hours))throw Error('备份方案或频率不正确');
      const identity=await ensureBackupDevice();
      const saved=await chrome.storage.local.get(['webdav','backupMode','backupAuto','backupIntervalDays','backupIntervalHours','backupDevice']);
      if(message.expectedPolicy&&BK.stableStringify(message.expectedPolicy)!==BK.stableStringify(policyState(saved)))throw Error('方案已在其他页面更新，未覆盖新设置。请先留存草稿，再刷新页面核对后保存。');
      const {webdav=DAV_DEFAULT}=saved;
      await chrome.storage.local.set({backupMode:message.mode,...(message.mode!=='webdav'?{syncAuto:false}:{}),backupAuto:message.mode!=='local'&&!!message.auto,backupIntervalHours:hours,backupIntervalDays:hours/24,backupDevice:String(message.device||'').trim().slice(0,60)||identity.device,webdav:{...webdav,enabled:message.mode==='webdav'&&webdav.enabled}});
      return true;
    }
    case 'BACKUP_EXPORT_CURRENT':return portable(await captureSnapshot('手动导出'));
    case 'BACKUP_CLEAR_LOCAL': {
      const {restoreInProgress,syncInProgress}=await chrome.storage.local.get(['restoreInProgress','syncInProgress']);
      if(restoreInProgress||syncInProgress)throw Error('上次恢复未完成，请先保留并检查保护副本');
      await chrome.storage.local.remove(['backups','lastBackupAt','pendingCloudBackup']);return true;
    }
    case 'BACKUP_CREATE': {
      const snapshot=await makeSnapshot('手动备份');
      const data=await chrome.storage.local.get(['webdav','backupMode']);
      if(modeOf(data)==='webdav'&&data.webdav?.enabled) { try {await uploadSnapshot(snapshot);}catch(e){await chrome.storage.local.set({lastBackupError:e.message});return {id:snapshot.id,warning:'本机备份已保存；'+e.message};} }
      return {id:snapshot.id};
    }
    case 'BACKUP_GET': { const {backups=[]}=await chrome.storage.local.get('backups');const b=backups.find(b=>b.id===message.id);if(!b)throw Error('该备份已不存在');return b; }
    case 'BACKUP_PREVIEW': {
      const desired=BK.validate(message.snapshot), current=await captureSnapshot();const p=BK.plan(current,desired);
      const token=crypto.randomUUID();await chrome.storage.session.set({restorePreview:{token,fingerprint:await fingerprint(current),snapshot:desired}});
      return {token,changes:p.changes,metaChanged:p.metaChanged,prefsChanged:p.prefsChanged,folderStateChanged:desired.folderState!=null&&BK.stableStringify(current.folderState)!==BK.stableStringify(desired.folderState)};
    }
    case 'BACKUP_RESTORE': {
      // 🔴 260914 实撞：这里原来只「查一下别人有没有在写」，自己从不持锁。
      // 于是恢复正在重建整棵树的那几十秒里，AI 那边 acquire('ai') 照样成功、两边同时改；
      // 而 write-lease 里那个 NAME.restore 分支永远不可能被触发（死分支）。
      const busy=await WriteLease.heldByOther('restore');
      if(busy)throw Error(`${WriteLease.NAME[busy.owner]||busy.owner}正在改书签，请等它结束后再恢复`);
      const restoreLease=(await WriteLease.acquire('restore')).lease;
      if(!restoreLease)throw Error('另一方正在改书签，请稍后再恢复');
      try {
      const {restorePreview:p}=await chrome.storage.session.get('restorePreview');if(!p||p.token!==message.token)throw Error('请重新预览要恢复的备份');
      const current=await captureSnapshot('恢复前自动保护');if(await fingerprint(current)!==p.fingerprint)throw Error('书签或附属数据已变化，请重新预览后恢复');
      await storeSnapshot(current);await chrome.storage.local.set({syncAuto:false,restoreInProgress:{backupId:current.id,startedAt:new Date().toISOString()}});
      try {
        const live=await BK.restore(bookmarkAPI,current.barId,current,p.snapshot);
        const identity={};for(const [uid,n]of live)identity[n.id]={uid,dateAdded:n.dateAdded};
        const folderCollapsed={};
        for(const [uid,folded]of Object.entries(p.snapshot.folderState||{})){const n=live.get(uid);if(n&&typeof folded==='boolean')folderCollapsed[`${n.id}:${n.dateAdded||0}`]=folded;}
        const prefs={view:'card',recentCollapsed:false,filterMode:'and',aiStandard:'',aiTasks:null,...Object.fromEntries(PREF_KEYS.filter(k=>p.snapshot.prefs[k]!==undefined).map(k=>[k,p.snapshot.prefs[k]]))};
        await chrome.storage.local.set({meta:p.snapshot.meta,bookmarkIdentity:identity,...prefs,...(p.snapshot.folderState?{folderCollapsed}:{})});
        await chrome.storage.session.remove('restorePreview');
        // Drafts reference pre-restore IDs; clear them to avoid writing into restored records.
        const session=await chrome.storage.session.get(null);await chrome.storage.session.remove(Object.keys(session).filter(k=>k.startsWith('editorDraft:')||k.startsWith('editorSelection:')));
        await chrome.storage.local.remove('restoreInProgress');return {ok:true,safetyBackupId:current.id};
      }catch(e){throw Error('恢复未完成：'+e.message+'。恢复前的完整状态已保存在本机备份列表中，可预览后恢复。');}
      } finally { await WriteLease.release(restoreLease.id); }
    }
    case 'BACKUP_AUTO': {
      const data=await chrome.storage.local.get('backupMode');
      if(modeOf(data)==='local'&&message.enabled)throw Error('纯本地方案已关闭自动备份');
      await chrome.storage.local.set({backupAuto:!!message.enabled});return true;
    }
    case 'BACKUP_DAV_CONNECT': {
      const {webdav=DAV_DEFAULT}=await chrome.storage.local.get('webdav');
      const config={enabled:true,url:davURL(message.config.url).href,username:String(message.config.username||'').trim(),password:message.config.password||webdav.password};
      if(!config.username||!config.password)throw Error('请填写账号和第三方应用密码');
      if(config.username!==webdav.username&&!message.config.password)throw Error('更换账号时请重新填写应用密码');
      if(!await chrome.permissions.contains({origins:['https://dav.jianguoyun.com/*']}))throw Error('请先授权访问坚果云');
      await ensureDavDirectory(config);
      await davRequest(config,'PROPFIND','','',{'Depth':'0'});
      await chrome.storage.local.set({webdav:config,backupMode:'webdav',lastBackupError:'',syncAuto:false,syncVerified:null});return true;
    }
    case 'BACKUP_DAV_FORGET':await chrome.storage.local.set({webdav:{...DAV_DEFAULT},syncAuto:false});await chrome.storage.local.remove(['pendingCloudBackup','syncState','syncVerified','syncInProgress','syncTombstones','lastSyncAt','syncError','syncCheck']);await chrome.storage.session.remove('syncPreview');return true;
    case 'BACKUP_DAV_SAVE': {
      const {webdav=DAV_DEFAULT}=await chrome.storage.local.get('webdav');
      const config={enabled:!!message.config.enabled,url:davURL(message.config.url).href,username:String(message.config.username||'').trim(),password:message.config.password||webdav.password};
      if(config.enabled&&(!config.username||!config.password))throw Error('开启云备份需要账号和应用密码');
      await chrome.storage.local.set({webdav:config,syncAuto:false,syncVerified:null});return true;
    }
    case 'BACKUP_DAV_LIST': {
      const c=await davConfig(),period=message.period||'';
      if(period&&!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period))throw Error('月份格式不正确');
      const config={...c,url:c.url+(period?period+'/':'')};
      const r=await davRequest(config,'PROPFIND','','<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getlastmodified/><d:getcontentlength/></d:prop></d:propfind>',{'Depth':'1','Content-Type':'application/xml'});return {xml:await r.text(),base:config.url};
    }
    case 'BACKUP_DAV_GET': {const r=await davRequest(await davConfig(),'GET',message.name);const txt=await r.text();if(txt.length>12e6)throw Error('备份文件过大');return BK.validate(JSON.parse(txt));}
    case 'BACKUP_DAV_UPLOAD': {const {backups=[]}=await chrome.storage.local.get('backups');const b=backups.find(b=>b.id===message.id);if(!b)throw Error('请先创建本机备份');return uploadSnapshot(b);}
    default:throw Error('未知备份操作');
  }
}
