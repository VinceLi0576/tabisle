(async()=>{
  const $=id=>document.getElementById(id),{id:windowId}=await chrome.windows.getCurrent();
  let selection=null, draft=null, currentId=null, loading=false, loadVersion=0, editVersion=0, pending=Promise.resolve(), domainExpanded=false;
  const ask=(type,extra={})=>BG.ask(type,{windowId,...extra},{ms:15000});
  const error=e=>{$('error').textContent=e.message||String(e);};
  const safeLink=url=>{try{return ['http:','https:','file:','ftp:'].includes(new URL(url).protocol)}catch{return false}};
  async function load(){
    const version=++loadVersion;loading=true;
    try{
      await pending;const data=await ask('EDITOR_LOAD');if(version!==loadVersion)return;
      $('empty').hidden=!!data;if(!data){selection=null;draft=null;currentId=null;$('editor').hidden=true;$('folder-pane').hidden=true;$('detail-nudge').hidden=true;return;}
      if(data.kind==='folder'){renderFolder(data);return;}
      $('folder-pane').hidden=true;$('editor').hidden=false;
      if(data.selection?.id!==selection?.id)domainExpanded=false;
      selection=data.selection;draft=data.draft;$('error').textContent='';
      $('heading').textContent=draft.id?'书签详情':'新书签';
      for(const id of ['alias','name','url','desc','note','icon'])$(id).value=draft.fields[id]||'';
      $('parentId').replaceChildren(...data.folders.map(f=>{const o=document.createElement('option');o.value=f.id;o.textContent=f.title;return o;}));$('parentId').value=draft.fields.parentId;
      updatePreview();
      $('tags').replaceChildren(...data.tags.map((tag,index)=>{
        const label=document.createElement('label'),input=document.createElement('input'),glyph=document.createElement('span'),name=document.createElement('span');
        const fallback=['#2f6fdb','#21865a','#b77913','#9254c8','#d25877'];
        label.style.setProperty('--tag-color',/^#[0-9a-f]{6}$/i.test(tag.color||'')?tag.color:fallback[index%fallback.length]);
        input.type='checkbox';input.value=tag.id;input.checked=draft.fields.tags.includes(tag.id);
        glyph.className='tag-glyph';glyph.textContent=tag.glyph||tag.name?.slice(0,1)||'·';glyph.setAttribute('aria-hidden','true');
        name.textContent=tag.name;label.append(input,glyph,name);return label;
      }));
      $('tags').closest('fieldset').hidden=!data.tags.length;
      $('name-help').textContent=draft.id?'收藏时网页自己带过来的标题。保持原样就行，想改首页上的叫法请改下面的「显示名」。':'通常使用网页标题，也可以自己填写。';
      currentId=draft.id;$('detail-nudge').hidden=!draft.id;
      $('from-tabs').hidden=!!draft.id;$('tab-list').hidden=true;$('autofill-state').hidden=true;
      for(const b of $('detail-nudge').querySelectorAll('[data-nudge]'))b.disabled=!(data.canNudge||{})[b.dataset.nudge];
      $('delete').hidden=!draft.id;$('promote').disabled=!draft.fields.alias;$('use-title').disabled=!draft.fields.alias;$('discard').hidden=!data.hasDraft;
      renderDuplicates(data);
      renderDomain(data);
      updateStatus();
    }catch(e){error(e);$('editor').hidden=true;$('empty').hidden=false;}
    finally{if(version===loadVersion)loading=false;}
  }
  // 同一个网站的收藏散在哪几个文件夹里。点一行展开明细，看得见到底是哪些页。
  function renderDomain(data){
    const d=data.domain;
    const box=$('domain-spread');
    box.hidden=!d||!d.root||d.total<=1;
    if(box.hidden)return;
    $('domain-summary').textContent=d.root+' 一共收了 '+d.total+' 条，分在 '+d.folders.length+' 个文件夹里。点一行看是哪些。';
    // 散在几十个夹里是常态（实测 google.com 有 44 个），全铺开会把详情页撑到一千多像素
    const FIRST=8, shown=domainExpanded?d.folders:d.folders.slice(0,FIRST);
    $('domain-folders').replaceChildren(...shown.map(f=>{
      const wrap=document.createElement('div');wrap.className='dom-group';
      const row=document.createElement('button');row.type='button';row.className='dom-row';row.setAttribute('aria-expanded','false');
      const caret=document.createElement('span');caret.className='dom-caret';caret.textContent='▸';
      const path=document.createElement('span');path.className='dom-path';path.textContent=f.path;path.title=f.path;
      const count=document.createElement('span');count.className='dom-count';count.textContent=f.count+' 条';
      row.append(caret,path);
      if(f.hasCurrent){const here=document.createElement('span');here.className='dom-here';here.textContent='当前这份在这';row.append(here);}
      row.append(count);
      const list=document.createElement('div');list.className='dom-items';list.hidden=true;
      list.replaceChildren(...f.items.map(it=>{
        const line=document.createElement('div');line.className='dom-item'+(it.current?' current':'');
        const name=document.createElement('span');name.className='dom-name';name.textContent=it.title;name.title=it.url;
        const sub=document.createElement('span');sub.className='dom-sub';sub.textContent=it.sub;
        line.append(name,sub);
        if(it.current){const b=document.createElement('span');b.className='dom-badge';b.textContent='当前这份';line.append(b);}
        else{const b=document.createElement('button');b.type='button';b.className='dom-go';b.textContent='看这份';
          b.onclick=async()=>{try{await pending;await ask('EDITOR_SELECT',{id:it.id});}catch(e){error(e);}};line.append(b);}
        return line;
      }));
      if(f.count>f.items.length){const more=document.createElement('p');more.className='field-help';more.textContent='还有 '+(f.count-f.items.length)+' 条没列出来。';list.append(more);}
      row.onclick=()=>{const open=list.hidden;list.hidden=!open;caret.textContent=open?'▾':'▸';row.setAttribute('aria-expanded',String(open));};
      wrap.append(row,list);return wrap;
    }));
    if(!domainExpanded&&d.folders.length>FIRST){
      const more=document.createElement('button');more.type='button';more.className='dom-more';
      more.textContent='还有 '+(d.folders.length-FIRST)+' 个文件夹，全部展开';
      more.onclick=()=>{domainExpanded=true;renderDomain(data);};
      $('domain-folders').append(more);
    }
  }
  // 文件夹详情：说明、锁定、改名都在这儿，挪位置用顶上那排
  function renderFolder(data){
    const f=data.folder;selection=data.selection;draft=null;currentId=f.id;
    $('editor').hidden=true;$('folder-pane').hidden=false;$('error').textContent='';
    $('heading').textContent='文件夹详情';
    $('fp-title').value=f.title;$('fp-path').textContent=f.path;$('fp-path').title=f.path;
    $('fp-count').textContent=f.count+' 条书签';$('fp-subs').textContent=f.subfolders?' · '+f.subfolders+' 个子文件夹':'';
    $('fp-note').value=f.note||'';$('fp-lock').checked=!!f.locked;
    // 颜色：8 个固定色 ＋ 一个「不上色」。老徐 260914：改颜色走这儿，首页那根细色条太难点
    $('fp-colors').replaceChildren(...[...(f.colors||[]),{c:'',n:'不上色'}].map(o=>{
      const b=document.createElement('button');b.type='button';b.className='fp-color'+(String(f.color||'')===o.c?' on':'')+(o.c?'':' none');
      if(o.c)b.style.setProperty('--fc',o.c);
      b.title=o.n;b.setAttribute('aria-label',o.n);
      b.onclick=()=>{[...$('fp-colors').children].forEach(x=>x.classList.toggle('on',x===b));folderPatch({color:o.c});};
      return b;}));
    // 文件夹那套标签（老徐 260915：「标签组是标签组，文件夹自己也要有标签组」）
    $('fp-ftags').replaceChildren(...(f.folderTags||[]).map(t=>{
      const on=(f.ftags||[]).includes(t.id);
      const b=document.createElement('button');
      b.type='button';b.className='fp-ftag'+(on?' on':'');b.dataset.id=t.id;
      b.style.setProperty('--tc',/^#[0-9a-f]{6}$/i.test(t.color||'')?t.color:'#5c6b7a');
      b.title=t.desc||t.name;
      b.innerHTML='<b>'+(t.glyph||t.name.slice(0,1))+'</b><span>'+t.name+'</span>';
      b.onclick=()=>{
        const next=on?(f.ftags||[]).filter(x=>x!==t.id):[...(f.ftags||[]),t.id];
        folderPatch({ftags:next});
      };
      return b;
    }));
    if(!(f.folderTags||[]).length){const p=document.createElement('p');p.className='field-help';p.textContent='还没有文件夹标签。';$('fp-ftags').append(p);}
    $('fp-note').disabled=$('fp-lock').disabled=!f.uid;
    if(!f.uid)$('fp-note').placeholder='这个文件夹还没拿到稳定标识，等一次自动备份之后再写';
    $('fp-children').replaceChildren(...f.children.map(c=>{
      const row=document.createElement('button');row.type='button';row.className='fp-child'+(c.url?'':' is-folder');
      row.textContent=(c.url?'· ':'📁 ')+(c.title||'（未命名）')+(c.url?'':'  '+c.count+' 条');row.title=c.url||'';
      row.onclick=async()=>{try{await pending;await ask('EDITOR_SELECT',{id:c.id});}catch(e){error(e);}};   // 点子项就跳到它的详情
      return row;}));
    if(!f.children.length){const p=document.createElement('p');p.className='field-help';p.textContent='空的。';$('fp-children').append(p);}
    $('detail-nudge').hidden=false;
    for(const b of $('detail-nudge').querySelectorAll('[data-nudge]'))b.disabled=!(data.canNudge||{})[b.dataset.nudge];
  }
  // 🔴 260914 实撞：原来把 load() 也挂进 pending 链，而 load() 开头就 await pending ⇒ 自己等自己，
  //    第一次写完之后面板永远不再刷新（锁定、改名、点子项全没反应，错误栏还是空的）。
  //    照 persist() 的形状：pending 只跟踪「写有没有落地」，重载另起一条。
  const folderPatch=(patch)=>{
    if(!currentId)return;
    const req=ask('EDITOR_FOLDER_UPDATE',{id:currentId,...patch});
    pending=Promise.all([pending.catch(()=>{}),req.catch(()=>{})]).then(()=>{});
    req.then(()=>load()).catch(error);
  };
  // 老徐 260914：「点击展开右边详情，有『创建子文件夹』的按钮」—— 建在哪儿就在哪儿建，🚫 别在外面建好再拖进来
  $('fp-newsub').onclick=async()=>{
    if(!currentId)return;
    const name=prompt('在这个文件夹里新建一个子文件夹，叫什么？');
    if(name===null||!name.trim())return;
    try{await pending;await ask('EDITOR_FOLDER_CREATE',{parentId:currentId,title:name.trim()});await load();}catch(e){error(e);}
  };
  $('fp-title').addEventListener('change',()=>folderPatch({title:$('fp-title').value}));
  $('fp-title').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('fp-title').blur();}});
  let noteTimer=null;$('fp-note').addEventListener('input',()=>{clearTimeout(noteTimer);noteTimer=setTimeout(()=>folderPatch({note:$('fp-note').value}),500);});
  $('fp-lock').addEventListener('change',()=>folderPatch({locked:$('fp-lock').checked}));
  function renderDuplicates(data){
    const entries=data.duplicates||[];
    $('duplicate-summary').textContent=draft.id?'这个完整网址收藏了 '+entries.length+' 次。可保留多份，也可以删除不需要的那一份。':'保存书签后可查看相同网址的其他收藏。';
    $('duplicates').replaceChildren(...entries.map(n=>{
      const row=document.createElement('div');row.className='duplicate-item';
      const title=document.createElement('strong');title.textContent=n.title||'未命名';
      const path=document.createElement('p');path.textContent=n.path;
      row.append(title,path);
      if(safeLink(n.url)){const a=document.createElement('a');a.href=n.url;a.target='_blank';a.rel='noopener';a.textContent='打开网址 ↗';row.append(a);}
      if(n.id===draft.id){const badge=document.createElement('span');badge.textContent=' 当前这份';row.append(badge);}
      else {
        const view=document.createElement('button');view.type='button';view.textContent='查看这份详情';view.onclick=async()=>{try{await pending;await ask('EDITOR_SELECT',{id:n.id});}catch(e){error(e);}};
        const del=document.createElement('button');del.type='button';del.textContent='删除这一份';del.onclick=async()=>{del.disabled=true;try{await pending;await ask('EDITOR_DELETE_DUPLICATE',{selection,id:n.id,dateAdded:n.dateAdded});await load();}catch(e){error(e);del.disabled=false;}};
        row.append(view,del);
      }
      return row;
    }));
    $('duplicate-undo').hidden=!data.canUndoDuplicate;
  }
  $('duplicate-undo').onclick=async()=>{try{await ask('EDITOR_UNDO_DUPLICATE');await load();}catch(e){error(e);}};
  // 🔴 老徐原话：卡片上那个点太小，「会不会误触」。详情页里这一排大按钮是给精确操作用的。
  // 真正挪书签的活交给后台，侧栏只发指令 —— 🚫 别在这儿再写一份移动逻辑。
  $('detail-nudge').addEventListener('click',async(e)=>{
    const b=e.target.closest('[data-nudge]'); if(!b||!currentId)return;
    b.disabled=true;
    try{await pending;await ask('EDITOR_NUDGE',{id:currentId,dir:b.dataset.nudge});await load();}
    catch(err){error(err);}
    finally{b.disabled=false;}
  });
  function updateStatus(){
    const f=draft?.fields,b=draft?.base,dirty=!b||f.name!==b.title||f.url!==b.url||f.parentId!==b.parentId;
    $('save').textContent=draft?.id?'保存修改':'添加书签';
    $('save').disabled=!dirty;
    $('save-state').textContent=dirty?'待保存 · 草稿已保留':'书签已保存';
    $('save-state').dataset.state=dirty?'dirty':'saved';
    $('discard').hidden=!dirty;
  }
  function updatePreview(){
    const f=draft.fields;let domain='尚未填写网址';
    try{const url=new URL(f.url);domain=url.hostname||url.protocol;}catch{if(f.url)domain='请检查网址';}
    $('preview-name').textContent=f.alias||f.name||'新书签';$('preview-name').title=$('preview-name').textContent;
    // 顶上那条摘要跟详细版卡片是同一张脸：显示名 · 一句话说明 · 所在夹
    $('ds-name').textContent=f.alias||f.name||'新书签';$('ds-desc').textContent=f.desc||'';$('ds-desc').hidden=!f.desc;
    $('ds-path').textContent=$('parentId').selectedOptions[0]?.textContent||'';
    $('preview-domain').textContent=domain;$('preview-domain').title=f.url;
    const allowed=safeLink(f.url);$('open-link').hidden=!allowed;$('open-link').href=allowed?f.url:'#';
    const src=chrome.runtime.getURL('/_favicon/')+'?pageUrl='+encodeURIComponent(f.url)+'&size=32';
    if($('favicon').getAttribute('src')!==src){$('favicon').hidden=!allowed;$('favicon-fallback').hidden=allowed;$('favicon').src=src;}
    $('name').title=f.name||'';
  }
  function persist(patch){
    if(loading||!draft)return;Object.assign(draft.fields,patch);const sel={...selection};
    updatePreview();$('error').textContent='';
    $('save-state').textContent='正在保留修改…';$('save-state').dataset.state='saving';$('discard').hidden=false;
    // Send every patch immediately; Chrome's native X can destroy this page at any time.
    // The worker serializes writes, so no unsent edits remain in a page-local queue.
    const version=++editVersion, request=ask('EDITOR_DRAFT',{selection:sel,patch});
    // 🔴 pending 以前会停在 rejected 上再也不复位 ⇒ load() 第一句 await pending 直接抛，
    // 侧栏从此一直显示空状态，点哪条书签都打不开，只能关掉重开。现在失败也让它落回已完成。
    pending=Promise.all([pending.catch(()=>{}),request.catch(()=>{})]).then(()=>{});
    request.then(()=>{if(version===editVersion){updateStatus();$('promote').disabled=!draft.fields.alias;}}).catch(error);
  }
  // 🔴 原来逐字 persist：每个字符一次 EDITOR_DRAFT → 后台写 meta → 首页 storage.onChanged → 整页重绘。
  // 首页 865 条重绘一次要一秒多，而侧栏和首页同源、多半在同一个渲染进程 ⇒ 打字被自己卡住。
  // 文字框按停手 400ms 落一次；离开输入框立刻落，🚫 别让「最后一笔」留在计时器里。
  const typeTimers={};
  const persistSoon=(id,ms=400)=>{clearTimeout(typeTimers[id]);typeTimers[id]=setTimeout(()=>{delete typeTimers[id];persist({[id]:$(id).value});},ms);};
  const flushField=(id)=>{if(typeTimers[id]){clearTimeout(typeTimers[id]);delete typeTimers[id];persist({[id]:$(id).value});}};
  for(const id of ['alias','name','url','desc','note','icon']){
    $(id).addEventListener('input',()=>persistSoon(id));
    $(id).addEventListener('blur',()=>flushField(id));
  }
  const flushAll=()=>{for(const id of Object.keys(typeTimers))flushField(id);};
  addEventListener('pagehide',flushAll);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')flushAll();});

  // ── 自动填：不靠 AI。① 从打开的标签页选一条；② 按网址去读网页的标题和它自带的一句话简介 ──
  const ORIGINS={origins:['https://*/*']};
  const say=(t)=>{$('autofill-state').textContent=t;$('autofill-state').hidden=!t;};
  function fill(patch){for(const [k,v] of Object.entries(patch))$(k).value=v;persist(patch);}
  $('from-tabs').onclick=async()=>{
    const list=$('tab-list');
    if(!list.hidden){list.hidden=true;return;}
    let tabs=[];try{tabs=await chrome.tabs.query({currentWindow:true});}catch(e){say('读不到标签页：'+(e.message||e));return;}
    const picks=BmCore.tabPick(tabs.filter(t=>!t.active||true));
    list.replaceChildren(...picks.map(t=>{
      const b=document.createElement('button');b.type='button';b.className='tab-item';
      const img=document.createElement('img');img.src=chrome.runtime.getURL('/_favicon/')+'?pageUrl='+encodeURIComponent(t.url)+'&size=16';img.alt='';
      const name=document.createElement('span');name.className='tab-name';name.textContent=t.title;
      const hostEl=document.createElement('span');hostEl.className='tab-host';hostEl.textContent=BmCore.host(t.url);
      b.append(img,name,hostEl);b.title=t.url;
      b.onclick=async()=>{
        list.hidden=true;
        const patch={url:t.url};if(!draft.fields.name.trim())patch.name=t.title;
        fill(patch);say('已填网址和书签名。');
        // 简介只有网页源码里才有；已经同意过读网页的，顺手补上
        if(!draft.fields.desc.trim()&&await chrome.permissions.contains(ORIGINS).catch(()=>false))await grabMeta(false);
      };
      return b;
    }));
    if(!picks.length){const p=document.createElement('p');p.className='field-help';p.textContent='这个窗口里没有别的网页标签。';list.append(p);}
    list.hidden=false;
  };
  // 🔴 chrome.permissions.request 必须是用户点击之后的第一个调用，前面任何一个 await 都会把手势丢掉
  $('fetch-meta').onclick=()=>{const p=chrome.permissions.request(ORIGINS);grabMeta(true,p);};
  async function grabMeta(manual,permission){
    const url=draft?.fields.url?.trim();
    if(!url||!/^https?:/i.test(url)){say('先填一个 http(s) 网址。');return;}
    if(permission&&!await permission){say('没有同意读取网页，无法自动填。手填也行。');return;}
    if(!permission&&!await chrome.permissions.contains(ORIGINS).catch(()=>false)){say('点「按网址取标题和简介」，第一次要同意一次。');return;}
    say('正在读取网页…');
    try{
      const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),8000);
      const res=await fetch(url,{signal:ctrl.signal,credentials:'include',redirect:'follow'});clearTimeout(timer);
      if(!res.ok)throw Error('网页返回 '+res.status);
      const buf=await res.arrayBuffer();
      // 国内不少站还是 GBK：先按响应头，没有就看源码里声明的 charset，都没有才当 UTF-8
      let cs=(res.headers.get('content-type')||'').match(/charset=([\w-]+)/i)?.[1]||'';
      let html=new TextDecoder('utf-8').decode(buf);
      const declared=BmCore.pageMeta(html).charset;
      if(!cs&&declared)cs=declared;
      if(cs&&!/^utf-?8$/i.test(cs)){try{html=new TextDecoder(cs).decode(buf);}catch{}}
      const m=BmCore.pageMeta(html);
      const patch={};
      if(m.title&&!draft.fields.name.trim())patch.name=m.title;
      if(m.desc&&!draft.fields.desc.trim())patch.desc=m.desc;
      if(Object.keys(patch).length){fill(patch);say('已填：'+Object.keys(patch).map(k=>({name:'书签名',desc:'一句话说明'})[k]).join('、')+'。'+(m.desc?'':'这个网页没写简介。'));}
      else say(m.title||m.desc?'书签名和一句话说明都已有内容，没有改动。':'这个网页没给出标题和简介。');
    }catch(e){say('读取失败：'+(e.name==='AbortError'?'8 秒没响应':(e.message||e))+'。要登录的站请用「从打开的标签页选」。');}
  }
  // 新书签里刚粘进一个网址：同意过读网页的直接去取，没同意过的提示一句怎么开
  $('url').addEventListener('paste',()=>{setTimeout(async()=>{
    if(!draft||draft.id||draft.fields.name.trim())return;
    if(!/^https?:/i.test(draft.fields.url.trim()))return;
    if(await chrome.permissions.contains(ORIGINS).catch(()=>false))grabMeta(false);else say('点「按网址取标题和简介」可以自动填书签名和简介，第一次要同意一次。');
  },0);});
  $('parentId').addEventListener('change',()=>persist({parentId:$('parentId').value}));
  $('tags').addEventListener('change',()=>persist({tags:[...$('tags').querySelectorAll('input:checked')].map(e=>e.value)}));
  $('editor').addEventListener('submit',async e=>{e.preventDefault();flushAll();$('save').disabled=true;try{await pending;await ask('EDITOR_SAVE',{selection});await load();}catch(e){error(e);updateStatus();}});
  $('discard').onclick=async()=>{try{await pending;await ask('EDITOR_DISCARD',{selection});await load();}catch(e){error(e);}};
  $('promote').onclick=()=>{$('name').value=$('alias').value;persist({name:$('alias').value});};
  $('use-title').onclick=()=>{$('alias').value='';persist({alias:''});};   // 老徐：显示名的意思其实是去改带过来的书签名 —— 反方向也得有
  $('delete').onclick=async()=>{if(!confirm('删除这条书签？删除前会自动保存完整备份。'))return;try{await pending;await ask('EDITOR_DELETE',{selection});await load();}catch(e){error(e);}};
  $('close').onclick=$('close-footer').onclick=async()=>{flushAll();try{await pending;await chrome.sidePanel.close({windowId});}catch(e){error(e);}};
  $('favicon').onerror=()=>{$('favicon').hidden=true;$('favicon-fallback').hidden=false;};
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();$('editor').requestSubmit();}if(e.key==='Escape')$('close').click();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes['editorSelection:'+windowId])load();});
  await load();
})();
