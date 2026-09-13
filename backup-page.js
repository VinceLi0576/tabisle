/* Presentation state is local to this browser; no backup or sync data is written here. */
(()=>{
  const sections=[...document.querySelectorAll('details.section-card')];
  const links=[...document.querySelectorAll('.page-toc nav a')];
  const key='backupPageLayoutV1';
  let saved={},ready=false,frame=0,lastData=null,lastSync=null,lastLatest=null,errorsSeen=new Set(),lastProgress=null;
  // 扩展重载后旧页面的 chrome.storage 会变成 undefined；同步抛出会让下面的初始化链建不起来
  const store={
    get:k=>{try{return chrome.storage.local.get(k);}catch{return Promise.reject(Error('no storage'));}},
    set:v=>{try{return chrome.storage.local.set(v);}catch{return Promise.resolve();}},
  };
  const persist=()=>store.set({[key]:saved}).catch(()=>{});
  function setOpen(section,value,remember=false){
    if(remember){saved[section.id]=value;persist();}
    section.open=value;
    schedule();
  }
  function mark(active){
    for(const link of links){if(link===active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}
  }
  // 点目录后先锁住高亮，等平滑滚动落定再交还给滚动判定，避免中途闪跳
  let lockedLink=null,lockUntil=0;
  function currentSection(){
    frame=0;
    if(lockedLink&&Date.now()<lockUntil){mark(lockedLink);return;}   // 🚫 别在这里 schedule()：会自我递归
    lockedLink=null;
    const marker=matchMedia('(max-width:1080px)').matches?88:48;
    let active=links[0];
    for(const link of links){
      const target=document.getElementById(link.hash.slice(1));
      if(target&&target.getBoundingClientRect().top<=marker)active=link;
    }
    // 🚫 不再「到页底就选最后一段」：那会让点中间某段时高亮跳到最后一段。
    //    最后一段够不到判定线的问题，改由正文底部留白解决（backup.css 的 .backup-main padding-bottom）。
    mark(active);
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(currentSection);}
  function reveal(id,scroll=true){
    const target=document.getElementById(id);if(!target)return;
    let parent=target;
    while(parent){if(parent.tagName==='DETAILS')setOpen(parent,true);parent=parent.parentElement;}
    if(scroll)requestAnimationFrame(()=>target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'}));
  }
  function navigate(id){
    const link=links.find(l=>l.hash==='#'+id);
    if(link){lockedLink=link;lockUntil=Date.now()+900;mark(link);setTimeout(()=>{if(lockedLink===link)lockedLink=null;schedule();},920);}
    reveal(id);history.replaceState(null,'','#'+id);
  }
  for(const section of sections){
    const summary=section.querySelector('summary');
    summary.addEventListener('click',e=>{e.preventDefault();setOpen(section,!section.open,true);});
    section.addEventListener('toggle',schedule);
  }
  for(const link of links)link.addEventListener('click',e=>{e.preventDefault();navigate(link.hash.slice(1));});
  document.getElementById('expand-all').onclick=()=>{for(const s of sections)saved[s.id]=true;persist();for(const s of sections)setOpen(s,true);};
  document.getElementById('collapse-all').onclick=()=>{for(const s of sections)saved[s.id]=false;persist();for(const s of sections)setOpen(s,false);};
  addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule,{passive:true});
  addEventListener('hashchange',()=>reveal(location.hash.slice(1)));
  const shortDate=value=>value?new Date(value).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'';
  function render(data,sync,latest){
    lastData=data;lastSync=sync;lastLatest=latest;if(!ready)return;
    const syncOk=!!sync;
    sync=sync||{initialized:false,auto:false,inProgress:false,error:'',receipt:null};
    const cloud=data.webdav.enabled,webdav=data.backupMode==='webdav';
    const recovery=data.restoreInProgress||sync.inProgress;
    // 同步状态没读到时沿用上一次的进度，🚫 别把「读不到」当成「没初始化」而重排各段默认展开
    const progress=!syncOk&&lastProgress!==null?lastProgress:!cloud?'none':!sync.initialized?'connected':'synced';
    const defaults=progress==='none'?['backup-mode',...(webdav?['webdav-guide']:[])]:progress==='connected'?['backup-live','continuous-sync']:['backup-live'];
    const state={
      'backup-mode':['neutral',({webdav:'坚果云',browser:'浏览器账号',local:'纯本地'}[data.backupMode]||'未配置')+' · '+(data.backupAuto!==false&&data.backupMode!=='local'?'每 '+data.backupIntervalHours+' 小时备份':'自动备份关闭')],
      'webdav-guide':[cloud?'ok':'neutral',cloud?'已连接 · 云备份已启用':data.webdav.hasPassword?'账号已保存 · 上传关闭':'待连接'],
      'backup-live':[recovery||data.lastBackupError?'error':data.pendingCloudBackup?'warn':data.backupReceipt?'ok':'neutral',recovery?'自动备份已暂停':data.lastBackupError?'备份异常 · 本机副本请见详情':data.pendingCloudBackup?'云备份等待重试':data.backupReceipt?shortDate(data.backupReceipt.verifiedAt)+' · '+data.backupReceipt.count+' 条已核验':data.lastBackupAt?'本机已备份 · '+shortDate(data.lastBackupAt):'尚无备份记录'],
      'backup-history':['neutral','本机 '+data.backups.length+' 个版本 · 云端按需读取'],
      'continuous-sync':[sync.error||recovery?'error':sync.initialized&&sync.auto?'ok':cloud?'warn':'neutral',recovery?'自动同步已暂停':sync.error?'同步异常 · 需要处理':!cloud?'连接坚果云后配置':!sync.initialized?'待完成首次合并':sync.auto?'每分钟自动同步 · 已开启':'已建立共同版本 · 自动同步关闭'],
      'help-section':['neutral','多设备配置 · 常见问题']
    };
    if(!syncOk)state['continuous-sync']=['warn','同步状态暂时读不到 · 已保存的设置未受影响'];
    if(!recovery&&!sync.error&&latest&&['cloud-new','local-new','diverged','attention'].includes(latest.state)){
      state['continuous-sync']=[latest.state==='attention'?'error':'warn',{'cloud-new':'云端有新版 · 等待同步','local-new':'本机有修改 · 等待上传',diverged:'两端有修改 · 等待合并',attention:'无法确认云端版本 · 请查看详情'}[latest.state]];
    }
    for(const section of sections){
      const [tone,text]=state[section.id];section.dataset.tone=tone;
      const summary=section.querySelector('[data-summary]');summary.textContent=text;summary.title=text;
      const link=links.find(l=>l.hash==='#'+section.id);link.dataset.tone=tone;link.title=text;
      const dot=link.querySelector('.toc-dot');if(dot)dot.title=text;
      if(lastProgress===null&&section.id in saved)setOpen(section,saved[section.id]);
      else if(lastProgress!==progress&&!(section.id in saved))setOpen(section,defaults.includes(section.id));
      const signature=section.id+':'+text;
      if(tone==='error'&&!errorsSeen.has(signature)){setOpen(section,true);errorsSeen.add(signature);}
    }
    document.getElementById('overview-sync').textContent=sync.receipt?shortDate(sync.receipt.verifiedAt)+' · '+sync.receipt.count+' 条已核验':sync.initialized?'已建立共同版本 · 待核验':'尚未首次合并';
    const action=document.getElementById('overview-action'),note=document.getElementById('overview-next');
    const target=recovery?(data.restoreInProgress?'backup-history':'continuous-sync'):sync.error?'continuous-sync':data.lastBackupError?'backup-live':progress==='none'?(webdav?'webdav-guide':'backup-live'):progress==='connected'?'continuous-sync':'backup-live';
    action.textContent=recovery?'处理未完成操作':sync.error||data.lastBackupError?'查看异常':progress==='none'&&webdav?'连接坚果云':progress==='connected'?'设置多设备同步':'查看备份与倒计时';
    note.textContent=recovery?'自动任务已暂停，先查看保护副本与处理说明。':sync.error||data.lastBackupError?'有一项任务需要处理，下面保留上次成功记录。':progress==='connected'?'云备份已启用；需要各浏览器保持一致时，再完成首次合并。':progress==='synced'?'同步保持各设备一致，备份保留可恢复的历史版本。':'从当前方案开始配置，完成后会保留你的展开习惯。';
    action.onclick=()=>navigate(target);
    if(lastProgress===null&&location.hash)reveal(location.hash.slice(1),false);
    lastProgress=progress;
    schedule();
  }
  window.BackupPage={render,reveal};
  store.get(key).then(data=>{const value=data[key];if(value&&typeof value==='object')for(const s of sections)if(typeof value[s.id]==='boolean')saved[s.id]=value[s.id];}).catch(()=>{}).finally(()=>{
    ready=true;if(lastData)render(lastData,lastSync,lastLatest);
    if(location.hash)reveal(location.hash.slice(1));schedule();
  });
})();
