(()=>{
  const $=id=>document.getElementById(id);
  let policyBaseline=null;
  let token=null,busy=false,current=null,dirty=false,cloudLoaded=false,syncToken=null,syncUnresolved=0,syncReady=false,syncChoices={};
  const staleMessage='插件刚刚更新，当前页面与后台的连接已失效。请重新加载此页面，再读取已保存的账号配置；未保存的输入请先自行留存。';
  const ask=async(type,extra={})=>{
    try {
      if(!globalThis.chrome?.runtime?.id)throw Error('Extension context invalidated');
      const r=await chrome.runtime.sendMessage({type,...extra});
      if(!r?.ok)throw Error(r?.error||'后台没有响应');return r.data;
    }catch(error){
      if(/context invalidated|receiving end does not exist|could not establish connection|message port closed|no sw/i.test(error.message||'')){
        $('reconnect-page').hidden=false;
        if(!current){$('credential-state').textContent='暂时无法读取连接信息，不代表账号或密码已删除。';$('password-state').textContent='重新加载页面后核对已保存状态。';}
        throw Error(staleMessage);
      }
      throw error;
    }
  };
  const date=value=>{const d=new Date(value);return isNaN(d)?String(value):d.toLocaleString('zh-CN',{hour12:false});};
  const size=n=>n>=1e6?(n/1e6).toFixed(1)+' MB':Math.max(1,Math.round(n/1e3))+' KB';
  const selected=()=>document.querySelector('[name=mode]:checked')?.value||'webdav';
  function availability(){
    document.querySelectorAll('button').forEach(b=>b.disabled=busy);
    document.querySelectorAll('#policy-form input,#policy-form select,#dav-form input,#cloud-period,#import,.sync-conflict select').forEach(n=>n.disabled=busy);
    $('restore').disabled=busy||!token||!$('sync-paused').checked;
    $('sync-apply').disabled=busy||!syncToken||syncUnresolved>0;
    $('sync-auto').disabled=busy||!syncReady;
    $('sync-preview').disabled=busy||!current?.webdav.enabled;
    $('auto').disabled=busy||selected()==='local';$('interval').disabled=busy||selected()==='local';
    $('forget').disabled=busy||!current?.webdav.hasPassword;
  }
  async function run(fn){if(busy)return;busy=true;$('error').textContent='';availability();try{await fn();}catch(e){$('error').textContent=e.message||String(e);}finally{busy=false;availability();}}
  function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=()=>run(fn);return b;}
  function download(snapshot){const u=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='TabIsle-'+snapshot.createdAt.replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);}
  function syncMode(){const mode=selected();$('webdav-guide').hidden=mode!=='webdav';$('browser-guide').hidden=mode!=='browser';$('local-guide').hidden=mode!=='local';$('policy-note').textContent=dirty?'方案有未保存的修改。':mode==='webdav'&&!current?.webdav.enabled?'推荐方案尚未连接，当前不会上传。':'设置已保存。';availability();}
  function setTab(cloud){$('local-tab').setAttribute('aria-selected',String(!cloud));$('cloud-tab').setAttribute('aria-selected',String(cloud));$('local-tab').tabIndex=cloud?-1:0;$('cloud-tab').tabIndex=cloud?0:-1;$('local-panel').hidden=cloud;$('cloud-panel').hidden=!cloud;}
  let automation=null,automationReading=false;
  function renderCountdowns(){
    const labels={backup:'下次自动备份',sync:'下次持续同步',retry:'云备份重试'};
    for(const [kind,label] of Object.entries(labels)) {
      const el=$(kind+'-countdown'),s=automation?.[kind];if(!el)continue;
      el.hidden=kind==='retry'&&s?.state!=='waiting';
      if(!s){el.textContent=label+'：正在读取…';continue;}
      if(s.state!=='waiting'){el.textContent=label+'：'+(s.state==='paused'?'已暂停，请处理未完成操作':'未开启');continue;}
      const seconds=Math.max(0,Math.ceil((s.nextAt-Date.now())/1000));
      const duration=[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
      el.textContent=label+'：'+(seconds?'还有 '+duration:'已到计划时间，等待后台执行')+' · '+date(s.nextAt);
    }
  }
  async function readAutomation(){
    if(automationReading)return;automationReading=true;
    try{automation=await ask('AUTOMATION_STATUS');renderCountdowns();}finally{automationReading=false;}
  }
  async function refresh({forms=false,preferWebdav=false}={}){
    current=await ask('BACKUP_STATUS');const data=current;
    $('credential-state').textContent=data.webdav.hasPassword
      ? '坚果云账号与应用密码已保存在本机。'+(data.webdav.enabled?'云备份已启用。':'当前云备份上传关闭，保存的连接信息仍然保留。')
      : '这台浏览器还没有保存完整的坚果云连接信息。其他浏览器的配置不会自动复制到这里。';
    $('password-state').textContent=data.webdav.hasPassword
      ? '应用密码已保存，无需重新填写。密码框留空是正常的，验证时会使用已保存的密码；只有更换账号或密码时才需要填写。'
      : '填写坚果云的第三方应用密码，验证成功后保存在这台浏览器。';
    const sync=await ask('SYNC_STATUS');syncReady=sync.initialized&&sync.verified!==false&&!sync.inProgress&&data.webdav.enabled;$('sync-auto').checked=sync.auto;
    $('sync-status').textContent=(sync.check?.upload&&sync.check?.download?'文件上传、读取已实测通过。'+(sync.check.compatible?'同步能力验证通过。':'双向同步未通过验证，尚未启用。')+'\n':'')+(sync.lastSyncAt?'最近同步：'+date(sync.lastSyncAt):'尚未同步。连接后先预览，两端内容会合并。')+(sync.inProgress?'\n上次同步未完成，自动同步已暂停；请重新预览合并。':'')+(sync.error?'\n'+sync.error:'');
    const receipt=sync.receipt;
    const counts=changes=>Object.entries(changes||{}).map(([op,n])=>op+' '+n+' 项').join('、')||'书签结构无变化';
    $('sync-receipt').textContent=receipt?date(receipt.verifiedAt)+' · '+receipt.count+' 条书签\n'+(receipt.uploaded?'云端已写入，并重新下载核对一致。':'已重新读取云端，内容一致，无需上传。')+'\n'+(receipt.localApplied?'本机已应用并核对一致。':'本机内容一致，无需修改。')+'\n本机：'+counts(receipt.localChanges)+'\n云端：'+counts(receipt.cloudChanges)+(sync.error?'\n注意：这是上次成功回执，当前同步有异常。':''):'尚无读回校验记录。旧版的成功时间不作为新版核验回执；完成下一次同步后显示。';
    $('sync-proof').textContent=receipt?'云端版本：'+receipt.revision+'\n内容指纹（SHA-256）：'+receipt.sha256:'尚无记录';
    const br=data.backupReceipt;
    $('backup-receipt').textContent=br?'最近云备份核验：'+date(br.verifiedAt)+' · '+br.count+' 条书签 · 已重新下载，完整内容一致。'+(data.lastBackupError?' 上次成功记录；当前备份有异常。':''):'尚无云备份读回核验记录。完成下一次上传后显示。';
    $('mode-status').textContent={webdav:data.webdav.enabled?'坚果云 · 云备份已启用':'坚果云 · 待连接',browser:'浏览器账号 · 本机备份',local:'纯本地 · 自动备份关闭'}[data.backupMode];
    $('local-status').textContent=data.lastBackupAt?date(data.lastBackupAt):'尚无本机版本';$('remote-status').textContent=data.lastCloudBackupAt?date(data.lastCloudBackupAt):'尚无完整备份上传记录';
    $('connection-state').textContent=data.webdav.enabled?'账号与目录已验证':data.webdav.hasPassword?'连接已保存 · 上传关闭':'待连接';
    const recovery=data.restoreInProgress||sync.inProgress;
    $('recovery-notice').hidden=!recovery;
    $('recovery-note').textContent=data.restoreInProgress
      ? '上次恢复未完成，自动备份和持续同步已暂停，保护副本仍保留。请查看本机历史，预览「恢复前自动保护」或其他完整版本，再确认恢复。恢复成功后自动备份可继续；持续同步需重新预览。'
      : '上次同步未完成，自动备份和持续同步已暂停。请先查看本机保护副本，再重新预览同步；确认合并成功后自动备份可继续，持续同步需重新开启。';
    $('recovery-sync').hidden=!!data.restoreInProgress;
    if(data.lastBackupError)$('error').textContent=data.lastBackupError+(data.pendingCloudBackup?'；本机副本已保留，云备份启用时会重试。':'');
    if(forms){policyBaseline=data.policyState;const displayMode=preferWebdav?'webdav':data.backupMode;document.querySelector(`[name=mode][value=${displayMode}]`).checked=true;$('auto').checked=data.backupAuto!==false&&data.backupMode!=='local';$('interval').value=String(data.backupIntervalHours);$('device').value=data.backupDevice||'';$('dav-url').value=data.webdav.url;$('dav-user').value=data.webdav.username||'';dirty=displayMode!==data.backupMode;}
    $('dav-pass').placeholder=data.webdav.hasPassword?'已保存，留空保留；更换账号须重新填写':'不是坚果云登录密码';
    $('history').replaceChildren(...data.backups.map(b=>{const row=document.createElement('div');row.className='backup-item';const info=document.createElement('div'),p=document.createElement('p'),small=document.createElement('small');p.textContent=date(b.createdAt);small.textContent=[b.device,b.reason,b.count+' 条书签',size(b.bytes)].join(' · ');info.append(p,small);const actions=document.createElement('div');actions.className='action-row';actions.append(button('预览恢复',async()=>preview(await ask('BACKUP_GET',{id:b.id}),'本机历史')),button('下载',async()=>download(await ask('BACKUP_GET',{id:b.id}))));if(data.backupMode==='webdav'&&data.webdav.enabled)actions.append(button('上传',async()=>{await ask('BACKUP_DAV_UPLOAD',{id:b.id});await refresh();$('status').textContent='这个版本已上传到坚果云。';}));row.append(info,actions);return row;}));
    await readAutomation();
    if(!data.backups.length){const p=document.createElement('p');p.className='empty';p.textContent='还没有本机版本。点击「立即备份」保存第一份。';$('history').append(p);}syncMode();
  }
  async function preview(snapshot,source='导入 JSON'){
    const result=await ask('BACKUP_PREVIEW',{snapshot});token=result.token;$('sync-paused').checked=false;$('preview').hidden=false;
    $('preview-title').textContent=[source,date(snapshot.createdAt),snapshot.device||'旧版本',snapshot.reason||'完整备份'].join(' · ');
    const counts={};for(const c of result.changes)counts[c.op]=(counts[c.op]||0)+1;
    $('preview-summary').textContent=[...Object.entries(counts).map(([k,v])=>k+' '+v+' 项'),result.metaChanged?'备注与标签等附属数据将更新':'附属数据无变化',result.prefsChanged?'显示偏好将更新':'',result.folderStateChanged?'文件夹折叠状态将更新':''].filter(Boolean).join(' · ');
    $('changes').replaceChildren(...result.changes.map(c=>{const li=document.createElement('li');li.textContent=c.op+'：'+c.path+(c.oldValue!=null?' · '+c.oldValue+' → '+c.newValue:'')+(c.before&&c.before!==c.path?'（当前：'+c.before+'）':'');return li;}));
    if(!result.changes.length){const li=document.createElement('li');li.textContent='书签树无变化。';$('changes').append(li);}$('preview').scrollIntoView({behavior:'smooth',block:'start'});
  }
  // Only accept direct children of the directory we requested, never arbitrary DAV URLs.
  function parseDirectory({xml,base}){
    const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw Error('云端目录返回格式不正确');
    const responses=[...doc.getElementsByTagNameNS('*','response')],b=new URL(base),entries=[];
    for(const r of responses){try{const u=new URL(r.getElementsByTagNameNS('*','href')[0]?.textContent||'',base);if(u.origin!==b.origin||!u.pathname.startsWith(b.pathname))continue;let name=decodeURIComponent(u.pathname.slice(b.pathname.length));const isDir=r.getElementsByTagNameNS('*','collection').length>0;if(isDir&&!name.endsWith('/'))name+='/';
      if((isDir&&/^\d{4}-(?:0[1-9]|1[0-2])\/$/.test(name))||(!isDir&&/^bookmarks-[a-zA-Z0-9-]+\.json$/.test(name)))entries.push({name,isDir,date:r.getElementsByTagNameNS('*','getlastmodified')[0]?.textContent||'',bytes:Number(r.getElementsByTagNameNS('*','getcontentlength')[0]?.textContent)||0});
    }catch{ /* Ignore unrelated or malformed hrefs. */ }}
    return {entries:entries.sort((a,b)=>b.name.localeCompare(a.name)),limited:responses.length>=750};
  }
  async function loadCloud(discover=false){
    $('cloud-status').textContent='正在读取坚果云目录…';let listing,period=$('cloud-period').value,limited=false;
    if(discover||!cloudLoaded){const root=parseDirectory(await ask('BACKUP_DAV_LIST'));limited=root.limited;const months=root.entries.filter(e=>e.isDir).map(e=>e.name.slice(0,-1));const old=$('cloud-period').value;$('cloud-period').replaceChildren(new Option('根目录 · 兼容旧版本',''),...months.map(m=>new Option(m,m)));period=months.includes(old)?old:(cloudLoaded?'':months[0]||'');$('cloud-period').value=period;cloudLoaded=true;if(!period)listing=root;}
    if(!listing)listing=parseDirectory(await ask('BACKUP_DAV_LIST',{period}));limited||=listing.limited;
    const entries=listing.entries.filter(e=>!e.isDir);$('cloud-history').replaceChildren(...entries.map(e=>{const name=(period?period+'/':'')+e.name,row=document.createElement('div'),info=document.createElement('div'),p=document.createElement('p'),small=document.createElement('small'),actions=document.createElement('div');row.className='backup-item';p.textContent=e.date?date(e.date):e.name;small.textContent=e.name+' · '+size(e.bytes);info.append(p,small);actions.className='action-row';actions.append(button('预览恢复',async()=>preview(await ask('BACKUP_DAV_GET',{name}),'坚果云历史')),button('下载',async()=>download(await ask('BACKUP_DAV_GET',{name}))));row.append(info,actions);return row;}));
    $('cloud-status').textContent='找到 '+entries.length+' 份版本。'+(limited?'目录条目较多，服务可能只返回前 750 项；请到坚果云网页核对完整目录。':'');
    if(!entries.length){const p=document.createElement('p');p.className='empty';p.textContent='这个目录还没有书签首页备份。';$('cloud-history').append(p);}
  }
  $('policy-form').oninput=()=>{dirty=true;syncMode();};
  $('policy-form').onsubmit=e=>{e.preventDefault();run(async()=>{await ask('BACKUP_POLICY_SAVE',{mode:selected(),auto:$('auto').checked,intervalHours:Number($('interval').value),device:$('device').value,expectedPolicy:policyBaseline});await refresh({forms:true});$('status').textContent='方案已保存。浏览器账号同步可在浏览器设置中按需调整。';});};
  document.querySelectorAll('.sync-settings').forEach(b=>b.onclick=()=>run(async()=>{await chrome.tabs.create({url:/Edg\//.test(navigator.userAgent)?'edge://settings/profiles/sync':'chrome://settings/syncSetup/advanced'});}));
  $('dav-form').onsubmit=e=>{e.preventDefault();if(busy)return;const config={url:$('dav-url').value,username:$('dav-user').value,password:$('dav-pass').value};
    // Optional permission must be requested within the user's submit gesture.
    const permission=chrome.permissions.request({origins:['https://dav.jianguoyun.com/*']});
    run(async()=>{if(!await permission)throw Error('没有获得坚果云访问权限');await ask('BACKUP_DAV_CONNECT',{config});if(policyBaseline)policyBaseline={...policyBaseline,mode:'webdav'};$('dav-pass').value='';cloudLoaded=false;const preserveDraft=dirty;await refresh({forms:!preserveDraft});$('status').textContent='连接已验证，云备份已启用。'+(preserveDraft?'上面的方案草稿尚未保存，请点击「保存方案」确认。':'备份频率和设备名保持已保存的设置。')+' 点击「立即备份」保存云端版本。';});
  };
  $('forget').onclick=()=>run(async()=>{if(!confirm('移除本机保存的坚果云账号和应用密码，并关闭上传？云端文件不会删除。'))return;await ask('BACKUP_DAV_FORGET');$('dav-pass').value='';cloudLoaded=false;await refresh({forms:true});$('status').textContent='已移除本机连接信息。';});
  $('create').onclick=()=>run(async()=>{const r=await ask('BACKUP_CREATE');await refresh();$('status').textContent=current.webdav.enabled&&!r.warning?'本机和坚果云都已保存这个版本。':'本机版本已保存。';if(r.warning)$('error').textContent=r.warning;});
  $('export').onclick=()=>run(async()=>{download(await ask('BACKUP_EXPORT_CURRENT'));$('status').textContent='完整备份已生成并交给浏览器下载，请确认下载完成；未新增本机历史或上传。';});
  $('import-open').onclick=()=>$('import').click();
  $('import').onchange=()=>{const file=$('import').files[0];$('import').value='';if(file)run(async()=>{if(file.size>12e6)throw Error('文件超过 12 MB');let snapshot;try{snapshot=JSON.parse(await file.text());}catch{throw Error('请导入书签首页完整备份 JSON；floccus 的 XBEL / HTML 文件请用 floccus 恢复。');}await preview(snapshot);});};
  $('clear-local').onclick=()=>run(async()=>{if(!confirm('清空本机所有备份历史？正常书签、备注和云端文件都会保留。建议先下载一份完整备份。'))return;await ask('BACKUP_CLEAR_LOCAL');await refresh();$('status').textContent='本机备份历史已清空。自动备份开启时，下次检查会生成新版本。';});
  $('local-tab').onclick=()=>setTab(false);$('cloud-tab').onclick=()=>setTab(true);
  for(const id of ['local-tab','cloud-tab'])$(id).onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const cloud=e.key==='End'||(e.key!=='Home'&&id==='local-tab');setTab(cloud);$(cloud?'cloud-tab':'local-tab').focus();}};
  $('cloud-list').onclick=()=>run(()=>loadCloud(true));$('cloud-period').onchange=()=>run(()=>loadCloud());
  $('refresh').onclick=()=>run(async()=>{await refresh();if(!$('cloud-panel').hidden)await loadCloud(true);});
  $('cancel-preview').onclick=()=>{$('preview').hidden=true;token=null;availability();};$('sync-paused').onchange=availability;
  $('restore').onclick=()=>run(async()=>{if(!token||!$('sync-paused').checked)throw Error('请先预览并确认同步状态');if(!confirm('按预览恢复书签栏及附属数据？恢复前会保存当前状态作为保护副本。'))return;await ask('BACKUP_RESTORE',{token});token=null;$('preview').hidden=true;await refresh();$('status').textContent='恢复完成，书签首页自动同步已暂停。请检查书签与备注，再预览同步到坚果云。';});
  async function showSync(){
    let p;try{p=await ask('SYNC_PREVIEW',{choices:syncChoices});}catch(e){await refresh();throw e;}syncToken=p.token;syncUnresolved=p.unresolved;
    $('sync-review').hidden=false;$('sync-summary').textContent=(p.first?'首次合并：保留双方已有内容。':'按上次共同版本合并两端变化。')+' 备注、说明、标签与分组颜色一并同步。';
    $('sync-review-note').textContent=(p.recovery?'上次同步中断，本次按首次合并重新检查，避免把中间状态当作删除。 ':'')+(p.largeDeletion?'本次删除比例超过 20%，请仔细检查下面的清单。 ':'')+(p.metaChanged?'附属数据将更新。':'附属数据无变化。')+' 显示布局和折叠偏好仍由每台设备自己保存。';
    $('sync-conflicts').replaceChildren(...p.conflicts.map(c=>{const box=document.createElement('div');box.className='sync-conflict';const title=document.createElement('strong');title.textContent=c.path+' · '+c.field;const info=document.createElement('p');const show=v=>v===undefined?'已删除':typeof v==='string'?v:JSON.stringify(v);info.textContent='本机：'+(c.localLabel??show(c.local))+'\n云端：'+(c.remoteLabel??show(c.remote));const label=document.createElement('label');label.textContent='处理方式';const select=document.createElement('select');select.append(new Option('请选择…',''),new Option('采用本机这一项','local'),new Option('采用云端这一项','remote'));select.value=c.choice||'';select.onchange=()=>{syncChoices[c.id]=select.value;syncToken=null;availability();};label.append(select);box.append(title,info,label);return box;}));
    for(const [id,changes]of [['sync-local-changes',p.localChanges],['sync-cloud-changes',p.cloudChanges]]){$(id).replaceChildren(...changes.map(c=>{const li=document.createElement('li');li.textContent=c.op+'：'+c.path+(c.oldValue!=null?' · '+c.oldValue+' → '+c.newValue:'')+(c.before&&c.before!==c.path?'（当前：'+c.before+'）':'');return li;}));if(!changes.length){const li=document.createElement('li');li.textContent='书签树无变化';$(id).append(li);}}
    $('sync-review').scrollIntoView({behavior:'smooth',block:'start'});
  }
  $('sync-preview').onclick=()=>run(async()=>{syncChoices={};await showSync();});
  $('sync-update').onclick=()=>run(showSync);
  $('sync-cancel').onclick=()=>{$('sync-review').hidden=true;syncToken=null;availability();};
  $('sync-apply').onclick=()=>run(async()=>{if(!syncToken)throw Error('请先更新预览');await ask('SYNC_APPLY',{token:syncToken});syncToken=null;$('sync-review').hidden=true;await refresh();$('status').textContent='两端已完成同步。可开启每 15 分钟自动同步；出现冲突时会暂停，等待你确认。';});
  $('sync-auto').onchange=()=>run(async()=>{try{await ask('SYNC_AUTO',{enabled:$('sync-auto').checked});}finally{await refresh();}});
  $('reconnect-page').onclick=()=>location.reload();
  $('app-version').textContent='v'+(chrome.runtime?.getManifest?.()?.version||'待重新加载');
  $('recovery-history').onclick=()=>{setTab(false);$('history').scrollIntoView({behavior:'smooth',block:'start'});};
  $('recovery-sync').onclick=()=>$('sync-preview').click();
  $('refresh-receipts').onclick=()=>run(()=>refresh());
  setInterval(renderCountdowns,1000);
  setInterval(()=>{if(!busy&&document.visibilityState==='visible')readAutomation().catch(()=>{});},15000);
  document.addEventListener('visibilitychange',()=>{if(!busy&&document.visibilityState==='visible')readAutomation().catch(()=>{});});
  run(()=>refresh({forms:true,preferWebdav:true}));
})();
