function draftKey(windowId,selection) { return 'editorDraft:'+windowId+':'+(selection.id||'new:'+selection.parentId); }
async function editorAction(m) {
  const windowId=Number(m.windowId);if(!Number.isInteger(windowId))throw Error('找不到当前窗口');
  const selectionKey='editorSelection:'+windowId;
  if(m.type==='EDITOR_SELECT') {
    await chrome.storage.session.set({[selectionKey]:{id:m.id||null,parentId:m.parentId||null,stamp:Date.now()}});return true;
  }
  if(m.type==='EDITOR_NUDGE') {
    const id=String(m.id||'');
    const node=(await chrome.bookmarks.get(id))[0];
    if(!node)throw Error('这一条已经不在了');
    const bar=await bookmarkBar();
    const to=BmCore.nudgeTarget(bar,id,String(m.dir||''));
    if(!to)throw Error({up:'已经是第一个了',down:'已经是最后一个了',out:'已经在最外层了',in:'上面紧挨着的不是文件夹，没法收进去'}[m.dir]||'这个方向挪不动');
    const {meta={}}=await chrome.storage.local.get('meta');
    const uidMap=(await chrome.storage.local.get('bookmarkIdentity')).bookmarkIdentity||{};
    const locked=(n)=>!!(meta.locks?.[uidMap[String(n.id)]?.uid]||meta.groups?.[n.title]?.locked);
    if(locked(node))throw Error('这一条已锁定');
    const target=(await chrome.bookmarks.get(String(to.parentId)))[0];
    if(target&&locked(target))throw Error('目标文件夹已锁定');
    await chrome.bookmarks.move(id,to);
    return true;
  }
  if(m.type==='EDITOR_UNDO_DUPLICATE') {
    const undoKey='editorDuplicateUndo:'+windowId;
    const data=await chrome.storage.session.get(undoKey),undo=data[undoKey];
    if(!undo)throw Error('没有可撤销的删除');
    const parent=(await chrome.bookmarks.get(undo.parentId))[0];
    if(!parent||parent.url)throw Error('原文件夹已不存在，请从保护备份恢复');
    const children=await chrome.bookmarks.getChildren(parent.id);
    await chrome.bookmarks.create({parentId:parent.id,index:Math.min(undo.index,children.length),title:undo.title,url:undo.url});
    await chrome.storage.session.remove(undoKey);return true;
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
  const draft=savedDraft||{id:node?.id||null,parentId:node?.parentId||selection.parentId,base:node?{title:node.title,url:node.url,parentId:node.parentId,dateAdded:node.dateAdded}:null,fields:{name:node?.title||'',url:node?.url||'',alias:item.name||'',desc:item.desc||'',note:item.note||'',icon:item.icon||'',tags:item.tags||[],parentId:node?.parentId||selection.parentId}};
  if(m.type==='EDITOR_LOAD') {
    const bar=await bookmarkBar();const folders=[{id:bar.id,title:'未分组（书签栏）'}];
    const walk=(n,path)=>{for(const c of n.children||[])if(!c.url){const p=path?path+' / '+c.title:c.title;folders.push({id:c.id,title:p});walk(c,p);}};walk(bar,'');
    if(!draft.fields.parentId)draft.fields.parentId=bar.id;
    const duplicates=[];
    const visit=(nodes,path=[])=>{for(const n of nodes){const next=[...path,n.title||'未命名'];if(node&&n.url===node.url)duplicates.push({id:n.id,title:n.title,url:n.url,parentId:n.parentId,dateAdded:n.dateAdded,path:next.join(' / ')});if(n.children)visit(n.children,next);}};
    const roots=(await chrome.bookmarks.getTree())[0].children||[];
    visit(roots);
    const domain=BmCore.sameDomainFolders(roots, draft.fields.url||node?.url||'', node?.id||null);
    const undoKey='editorDuplicateUndo:'+windowId;
    return {selection,draft,folders,tags:meta.tags||[],hasDraft:!!savedDraft,duplicates,domain,canNudge:node?BmCore.nudgeable(bar,node.id):{},canUndoDuplicate:!!(await chrome.storage.session.get(undoKey))[undoKey]};
  }
  if(m.type==='EDITOR_DELETE_DUPLICATE') {
    if(!node)throw Error('请先选择当前书签');
    const target=(await chrome.bookmarks.get(String(m.id)))[0];
    if(!target?.url||target.id===node.id||target.url!==node.url||target.dateAdded!==m.dateAdded)throw Error('这份收藏已变化，请刷新后重试');
    let parent=(await chrome.bookmarks.get(target.parentId))[0];
    // 🔴 260914 实撞：锁 v0.10.5 就迁到 meta.locks[uid] 了，这里还只认旧的按名锁 ⇒
    // 只用新锁锁住的文件夹，从详情侧栏「删除这一份」照样删得掉。两种锁都要认。
    const uidMap=(await chrome.storage.local.get('bookmarkIdentity')).bookmarkIdentity||{};
    const lockedNode=(n)=>!!(meta.locks?.[uidMap[String(n.id)]?.uid]||meta.groups?.[n.title]?.locked);
    while(parent){if(lockedNode(parent))throw Error('这份收藏所在文件夹已锁定');if(!parent.parentId)break;parent=(await chrome.bookmarks.get(parent.parentId))[0];}
    await makeSnapshot('删除重复收藏前');
    const fresh=(await chrome.bookmarks.get(target.id))[0];
    if(fresh.url!==target.url||fresh.parentId!==target.parentId||fresh.dateAdded!==target.dateAdded)throw Error('收藏已变化，请刷新后重试');
    await chrome.bookmarks.remove(target.id);
    await chrome.storage.session.set({['editorDuplicateUndo:'+windowId]:{parentId:target.parentId,index:target.index,title:target.title,url:target.url}});
    return true;
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
      // 🔴 这里原来拿着几百毫秒前读到的 meta 整包写回，首页这期间的改动会被抹掉。
      // 现在只动这一条书签的附属数据，其余字段原样保留存储里最新的那份。
      const fresh=(await chrome.storage.local.get('meta')).meta||{items:{},groups:{},tags:[]};
      meta.items=fresh.items||{};meta.groups=fresh.groups||{};meta.tags=fresh.tags||[];
      if(fresh.locks)meta.locks=fresh.locks;if(fresh.folderNotes)meta.folderNotes=fresh.folderNotes;
      if(fresh.emojiRules!==undefined)meta.emojiRules=fresh.emojiRules;
      meta.items[BK.key(url)]={...(meta.items[BK.key(url)]||{}),name:fields.alias,desc:fields.desc,note:fields.note,icon:fields.icon,tags:fields.tags};
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
