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
    pending=Promise.all([pending.catch(()=>{}),req]).then(()=>{});
    req.then(()=>load()).catch(error);
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
    pending=Promise.all([pending.catch(()=>{}),request]).then(()=>{});
    pending.then(()=>{if(version===editVersion){updateStatus();$('promote').disabled=!draft.fields.alias;}}).catch(error);
  }
  for(const id of ['alias','name','url','desc','note','icon'])$(id).addEventListener('input',()=>persist({[id]:$(id).value}));
  $('parentId').addEventListener('change',()=>persist({parentId:$('parentId').value}));
  $('tags').addEventListener('change',()=>persist({tags:[...$('tags').querySelectorAll('input:checked')].map(e=>e.value)}));
  $('editor').addEventListener('submit',async e=>{e.preventDefault();$('save').disabled=true;try{await pending;await ask('EDITOR_SAVE',{selection});await load();}catch(e){error(e);updateStatus();}});
  $('discard').onclick=async()=>{try{await pending;await ask('EDITOR_DISCARD',{selection});await load();}catch(e){error(e);}};
  $('promote').onclick=()=>{$('name').value=$('alias').value;persist({name:$('alias').value});};
  $('use-title').onclick=()=>{$('alias').value='';persist({alias:''});};   // 老徐：显示名的意思其实是去改带过来的书签名 —— 反方向也得有
  $('delete').onclick=async()=>{if(!confirm('删除这条书签？删除前会自动保存完整备份。'))return;try{await pending;await ask('EDITOR_DELETE',{selection});await load();}catch(e){error(e);}};
  $('close').onclick=$('close-footer').onclick=async()=>{try{await pending;await chrome.sidePanel.close({windowId});}catch(e){error(e);}};
  $('favicon').onerror=()=>{$('favicon').hidden=true;$('favicon-fallback').hidden=false;};
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();$('editor').requestSubmit();}if(e.key==='Escape')$('close').click();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes['editorSelection:'+windowId])load();});
  await load();
})();
