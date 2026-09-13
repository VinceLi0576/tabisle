function draftKey(windowId,selection) { return 'editorDraft:'+windowId+':'+(selection.id||'new:'+selection.parentId); }
async function editorAction(m) {
  const windowId=Number(m.windowId);if(!Number.isInteger(windowId))throw Error('找不到当前窗口');
  const selectionKey='editorSelection:'+windowId;
  if(m.type==='EDITOR_SELECT') {
    await chrome.storage.session.set({[selectionKey]:{id:m.id||null,parentId:m.parentId||null,stamp:Date.now()}});return true;
  }
  const stored=await chrome.storage.session.get(selectionKey),selection=m.selection||stored[selectionKey];
  if(!selection)return null;
  const dk=draftKey(windowId,selection);
  if(m.type==='EDITOR_DISCARD') {await chrome.storage.session.remove(dk);return true;}
  const node=selection.id ? (await chrome.bookmarks.get(selection.id))[0] : null;
  if(node&&!node.url)throw Error('请选择一条书签');
  const {meta={items:{},groups:{},tags:[]}}=await chrome.storage.local.get('meta');
  const item=node ? meta.items[BK.key(node.url)]||{} : {};
  const { [dk]: savedDraft }=await chrome.storage.session.get(dk);
  const draft=savedDraft||{id:node?.id||null,parentId:node?.parentId||selection.parentId,base:node?{title:node.title,url:node.url,parentId:node.parentId,dateAdded:node.dateAdded}:null,fields:{name:node?.title||'',url:node?.url||'',alias:item.name||'',desc:item.desc||'',icon:item.icon||'',tags:item.tags||[],parentId:node?.parentId||selection.parentId}};
  if(m.type==='EDITOR_LOAD') {
    const bar=await bookmarkBar();const folders=[{id:bar.id,title:'未分组（书签栏）'}];
    const walk=(n,path)=>{for(const c of n.children||[])if(!c.url){const p=path?path+' / '+c.title:c.title;folders.push({id:c.id,title:p});walk(c,p);}};walk(bar,'');
    if(!draft.fields.parentId)draft.fields.parentId=bar.id;
    return {selection,draft,folders,tags:meta.tags||[],hasDraft:!!savedDraft};
  }
  if(m.type==='EDITOR_DRAFT') {
    const patch=m.patch||{};const allowed=['name','url','alias','desc','icon','tags','parentId'];
    for(const k of Object.keys(patch))if(allowed.includes(k))draft.fields[k]=patch[k];
    await chrome.storage.session.set({[dk]:draft});
    if(node && ['alias','desc','icon','tags'].some(k=>k in patch)) {
      if(node.dateAdded!==draft.base.dateAdded || node.url!==draft.base.url) throw Error('书签地址已在其他地方改变。编辑草稿已保留，请重新载入后保存。');
      const k=BK.key(node.url),entry={...(meta.items[k]||{})};
      for(const f of ['alias','desc','icon','tags'])if(f in patch)entry[f==='alias'?'name':f]=patch[f];
      meta.items[k]=entry;await chrome.storage.local.set({meta});
    }
    return true;
  }
  if(m.type==='EDITOR_SAVE') {
    if(node&&(node.dateAdded!==draft.base.dateAdded||node.title!==draft.base.title||node.url!==draft.base.url||node.parentId!==draft.base.parentId))throw Error('这条书签已在其他地方修改。请先复制你的编辑内容，再点「放弃草稿」重新载入。');
    const fields=draft.fields,url=BK.validUrl(fields.url),parentId=String(fields.parentId||selection.parentId||(await bookmarkBar()).id);
    const parent=(await chrome.bookmarks.get(parentId))[0];if(parent.url)throw Error('目标必须是文件夹');
    let result;
    if(node) {
      result=await chrome.bookmarks.update(node.id,{title:fields.name.trim()||new URL(url).hostname,url});
      if(parentId!==node.parentId)result=await chrome.bookmarks.move(node.id,{parentId});
      if(BK.key(node.url)!==BK.key(url)) {
        let remaining=false;
        const walk=nodes=>{for(const n of nodes){if(n.url && BK.key(n.url)===BK.key(node.url))remaining=true;if(n.children)walk(n.children);}};walk(await chrome.bookmarks.getTree());
        const old=meta.items[BK.key(node.url)]||{};
        meta.items[BK.key(url)]={...(meta.items[BK.key(url)]||{}),...old};
        if(!remaining)delete meta.items[BK.key(node.url)];
        await chrome.storage.local.set({meta});
      }
    } else {
      result=await chrome.bookmarks.create({parentId,title:fields.name.trim()||fields.alias.trim()||new URL(url).hostname,url});
      meta.items[BK.key(url)]={...(meta.items[BK.key(url)]||{}),name:fields.alias,desc:fields.desc,icon:fields.icon,tags:fields.tags};
      await chrome.storage.local.set({meta});
    }
    await chrome.storage.session.remove(dk);
    await chrome.storage.session.set({[selectionKey]:{id:result.id,parentId:result.parentId,stamp:Date.now()}});
    return {id:result.id};
  }
  if(m.type==='EDITOR_DELETE') {
    if(!node)throw Error('没有可删除的书签');
    await makeSnapshot('删除书签前');await chrome.bookmarks.remove(node.id);
    await chrome.storage.session.remove([selectionKey,dk]);return true;
  }
  throw Error('未知编辑操作');
}
