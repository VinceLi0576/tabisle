(async()=>{
  const $=id=>document.getElementById(id),{id:windowId}=await chrome.windows.getCurrent();
  let selection=null, draft=null, loading=false, loadVersion=0, editVersion=0, pending=Promise.resolve();
  const ask=(type,extra={})=>BG.ask(type,{windowId,...extra},{ms:15000});
  const error=e=>{$('error').textContent=e.message||String(e);};
  const safeLink=url=>{try{return ['http:','https:','file:','ftp:'].includes(new URL(url).protocol)}catch{return false}};
  async function load(){
    const version=++loadVersion;loading=true;
    try{
      await pending;const data=await ask('EDITOR_LOAD');if(version!==loadVersion)return;
      $('empty').hidden=!!data;$('editor').hidden=!data;if(!data){selection=null;return;}
      selection=data.selection;draft=data.draft;$('error').textContent='';
      $('heading').textContent=draft.id?'书签详情':'新书签';
      for(const id of ['alias','name','url','desc','icon'])$(id).value=draft.fields[id]||'';
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
      $('delete').hidden=!draft.id;$('promote').disabled=!draft.fields.alias;$('discard').hidden=!data.hasDraft;
      renderDuplicates(data);
      updateStatus();
    }catch(e){error(e);$('editor').hidden=true;$('empty').hidden=false;}
    finally{if(version===loadVersion)loading=false;}
  }
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
    $('preview-domain').textContent=domain;$('preview-domain').title=f.url;
    const allowed=safeLink(f.url);$('open-link').hidden=!allowed;$('open-link').href=allowed?f.url:'#';
    const src=chrome.runtime.getURL('/_favicon/')+'?pageUrl='+encodeURIComponent(f.url)+'&size=32';
    if($('favicon').getAttribute('src')!==src){$('favicon').hidden=!allowed;$('favicon-fallback').hidden=allowed;$('favicon').src=src;}
    $('path').textContent=$('parentId').selectedOptions[0]?.textContent||'';
    $('name').title=f.name||'';
    $('path').hidden=!$('path').textContent.includes(' / ');
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
  for(const id of ['alias','name','url','desc','icon'])$(id).addEventListener('input',()=>persist({[id]:$(id).value}));
  $('parentId').addEventListener('change',()=>persist({parentId:$('parentId').value}));
  $('tags').addEventListener('change',()=>persist({tags:[...$('tags').querySelectorAll('input:checked')].map(e=>e.value)}));
  $('editor').addEventListener('submit',async e=>{e.preventDefault();$('save').disabled=true;try{await pending;await ask('EDITOR_SAVE',{selection});await load();}catch(e){error(e);updateStatus();}});
  $('discard').onclick=async()=>{try{await pending;await ask('EDITOR_DISCARD',{selection});await load();}catch(e){error(e);}};
  $('promote').onclick=()=>{$('name').value=$('alias').value;persist({name:$('alias').value});};
  $('delete').onclick=async()=>{if(!confirm('删除这条书签？删除前会自动保存完整备份。'))return;try{await pending;await ask('EDITOR_DELETE',{selection});await load();}catch(e){error(e);}};
  $('close').onclick=$('close-footer').onclick=async()=>{try{await pending;await chrome.sidePanel.close({windowId});}catch(e){error(e);}};
  $('favicon').onerror=()=>{$('favicon').hidden=true;$('favicon-fallback').hidden=false;};
  document.addEventListener('keydown',e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();$('editor').requestSubmit();}if(e.key==='Escape')$('close').click();});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='session'&&changes['editorSelection:'+windowId])load();});
  await load();
})();
