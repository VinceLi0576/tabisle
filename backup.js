(()=>{
  const $=id=>document.getElementById(id);let token=null,busy=false;
  const ask=async(type,extra={})=>{const r=await chrome.runtime.sendMessage({type,...extra});if(!r?.ok)throw Error(r?.error||'后台没有响应');return r.data;};
  function report(e){$('error').textContent=e.message||String(e);}
  async function run(fn){if(busy)return;busy=true;$('error').textContent='';document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){report(e);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}}
  const date=value=>{const d=new Date(value);return isNaN(d)?value:d.toLocaleString('zh-CN',{hour12:false});};
  function download(snapshot){const u=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download='书签完整备份-'+snapshot.createdAt.replace(/[:.]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),2000);}
  function button(text,fn){const b=document.createElement('button');b.textContent=text;b.onclick=()=>run(fn);return b;}
  async function preview(snapshot){const result=await ask('BACKUP_PREVIEW',{snapshot});token=result.token;$('preview').hidden=false;$('preview-title').textContent=date(snapshot.createdAt)+' · '+(snapshot.reason||'导入备份');
    const counts={};for(const c of result.changes)counts[c.op]=(counts[c.op]||0)+1;
    $('preview-summary').textContent=[...Object.entries(counts).map(([k,v])=>k+' '+v+' 项'),result.metaChanged?'附属数据将更新':'附属数据无变化',result.prefsChanged?'显示偏好将更新':''].filter(Boolean).join(' · ');
    $('changes').replaceChildren(...result.changes.map(c=>{const li=document.createElement('li');li.textContent=c.op+'：'+c.path+(c.oldValue!=null?' · '+c.oldValue+' → '+c.newValue:'')+(c.before&&c.before!==c.path?'（当前：'+c.before+'）':'');return li;}));
    $('preview').scrollIntoView({behavior:'smooth',block:'start'});
  }
  async function refresh(){const data=await ask('BACKUP_STATUS');$('auto').checked=data.backupAuto!==false;
    $('status').textContent=(data.lastBackupAt?'最近本机备份：'+date(data.lastBackupAt):'还没有备份')+(data.lastCloudBackupAt?'\n最近云端上传：'+date(data.lastCloudBackupAt):'')+(data.restoreInProgress?'\n上次恢复未完成。请在本机历史中选择「恢复前自动保护」的版本查看和恢复。':'');
    if(data.lastBackupError)$('error').textContent=data.lastBackupError;
    $('dav-url').value=data.webdav.url;$('dav-user').value=data.webdav.username;$('dav-enabled').checked=data.webdav.enabled;$('dav-pass').placeholder=data.webdav.hasPassword?'已保存应用密码；留空不更换':'填写第三方应用密码';
    $('history').replaceChildren(...data.backups.map(b=>{const row=document.createElement('div');row.className='backup-item';const info=document.createElement('div'),p=document.createElement('p'),small=document.createElement('small');p.textContent=date(b.createdAt);small.textContent=b.reason+' · '+b.count+' 条书签';info.append(p,small);const actions=document.createElement('div');actions.className='action-row';actions.append(button('预览恢复',async()=>preview(await ask('BACKUP_GET',{id:b.id}))),button('下载',async()=>download(await ask('BACKUP_GET',{id:b.id}))),button('上传',async()=>{$('cloud-status').textContent='正在上传…';await ask('BACKUP_DAV_UPLOAD',{id:b.id});$('cloud-status').textContent='已上传到坚果云';}));row.append(info,actions);return row;}));
    if(!data.backups.length)$('history').textContent='点击「立即备份」，保存第一个版本。';
  }
  $('create').onclick=()=>run(async()=>{const r=await ask('BACKUP_CREATE');await refresh();if(r.warning)$('error').textContent=r.warning;else $('status').textContent+='\n本次备份已保存。';});
  $('refresh').onclick=()=>run(refresh);
  $('auto').onchange=()=>run(async()=>{await ask('BACKUP_AUTO',{enabled:$('auto').checked});});
  $('import').onchange=()=>{const file=$('import').files[0];$('import').value='';if(file)run(async()=>{if(file.size>12e6)throw Error('文件超过 12 MB');await preview(JSON.parse(await file.text()));});};
  $('cancel-preview').onclick=()=>{$('preview').hidden=true;token=null;};
  $('restore').onclick=()=>run(async()=>{if(!token)throw Error('请先选择一个备份预览');if(!confirm('按预览恢复书签栏？列出的删除和移动会同步到浏览器书签。'))return;await ask('BACKUP_RESTORE',{token});token=null;$('preview').hidden=true;await refresh();$('status').textContent+='\n恢复完成，书签首页会自动更新。';});
  $('dav-form').onsubmit=e=>{e.preventDefault();
    // Request optional host access directly in the click gesture.
    const permission=chrome.permissions.request({origins:['https://dav.jianguoyun.com/*']});
    run(async()=>{if(!await permission)throw Error('没有获得坚果云访问权限');await ask('BACKUP_DAV_SAVE',{config:{url:$('dav-url').value,username:$('dav-user').value,password:$('dav-pass').value,enabled:$('dav-enabled').checked}});$('dav-pass').value='';$('cloud-status').textContent='设置已保存。点击「连接并读取历史」验证连接。';});
  };
  $('cloud-list').onclick=()=>run(async()=>{
    $('cloud-status').textContent='正在读取坚果云历史…';const {xml,base}=await ask('BACKUP_DAV_LIST');const doc=new DOMParser().parseFromString(xml,'application/xml');if(doc.querySelector('parsererror'))throw Error('云端目录返回格式不正确');
    const entries=[...doc.getElementsByTagNameNS('*','response')].map(r=>{const href=r.getElementsByTagNameNS('*','href')[0]?.textContent||'';const u=new URL(href,base),b=new URL(base);if(u.origin!==b.origin||!u.pathname.startsWith(b.pathname))return null;const name=decodeURIComponent(u.pathname.slice(b.pathname.length));if(!/^bookmarks-[a-zA-Z0-9-]+\.json$/.test(name))return null;return {name,date:r.getElementsByTagNameNS('*','getlastmodified')[0]?.textContent||''};}).filter(Boolean).sort((a,b)=>b.name.localeCompare(a.name));
    $('cloud-history').replaceChildren(...entries.map(entry=>{const row=document.createElement('div');row.className='backup-item';const text=document.createElement('p');text.textContent=date(entry.date||entry.name);text.title=entry.name;row.append(text,button('预览恢复',async()=>preview(await ask('BACKUP_DAV_GET',{name:entry.name}))));return row;}));$('cloud-status').textContent='找到 '+entries.length+' 份云备份。';
  });
  run(refresh);
})();
