// 🔴 老徐 260915 给的颜色标准，跟 app.js 那份必须一字不差（两处都校验颜色合法性）
const FOLDER_COLORS=[{c:'#002FA7',n:'克莱因蓝',rgb:'0,47,167'},{c:'#81D8D0',n:'蒂芙尼蓝',rgb:'129,216,208'},{c:'#003153',n:'普鲁士蓝',rgb:'0,49,83'},{c:'#B05923',n:'提香红',rgb:'176,89,35'},{c:'#E60000',n:'中国红',rgb:'230,0,0'},{c:'#900021',n:'勃艮第红',rgb:'144,0,33'},{c:'#FBD26A',n:'申布伦黄',rgb:'251,210,106'},{c:'#8F4B28',n:'凡戴克棕',rgb:'143,75,40'}];
function draftKey(windowId,selection) { return 'editorDraft:'+windowId+':'+(selection.id||'new:'+selection.parentId); }
async function editorAction(m) {
  const windowId=Number(m.windowId);if(!Number.isInteger(windowId))throw Error('找不到当前窗口');
  const selectionKey='editorSelection:'+windowId;
  if(m.type==='EDITOR_SELECT') {
    await chrome.storage.session.set({[selectionKey]:{id:m.id||null,parentId:m.parentId||null,stamp:Date.now()}});return true;
  }
  if(m.type==='EDITOR_FOLDER_UPDATE') {
    const id=String(m.id||'');const node=(await chrome.bookmarks.get(id))[0];
    if(!node||node.url)throw Error('不是文件夹');
    if(typeof m.title==='string'&&m.title.trim()&&m.title!==node.title)await chrome.bookmarks.update(id,{title:m.title.trim()});
    if(m.note!==undefined||m.locked!==undefined||m.color!==undefined||m.ftags!==undefined){
      // 🔴 只动这个夹的那几个键，其余原样 —— 跟附属数据合并写同一条纪律，别整包盖
      const fresh=(await chrome.storage.local.get('meta')).meta||{items:{},groups:{},tags:[]};
      const uidMap=(await chrome.storage.local.get('bookmarkIdentity')).bookmarkIdentity||{};
      const uid=uidMap[id]?.uid;if(!uid)throw Error('这个文件夹还没拿到稳定标识，先做一次自动备份');
      if(m.note!==undefined){fresh.folderNotes=fresh.folderNotes||{};const v=String(m.note).trim();if(v)fresh.folderNotes[uid]=v;else delete fresh.folderNotes[uid];}
      if(m.locked!==undefined){fresh.locks=fresh.locks||{};if(m.locked)fresh.locks[uid]=true;else delete fresh.locks[uid];
        const g=fresh.groups?.[node.title];if(g&&g.locked&&!m.locked){delete g.locked;if(!Object.keys(g).length)delete fresh.groups[node.title];}}
      if(m.color!==undefined){
        // 颜色仍按夹名存（meta.groups[title].color）—— 首页读的就是这个键。
        // ⚠️ 按名字存 ⇒ 在别处改名会丢色、同名夹会串色；跟锁和说明一样搬到 uid 是后话，老徐还没拍。
        const name=(typeof m.title==='string'&&m.title.trim())?m.title.trim():node.title;
        const ok=FOLDER_COLORS.some(x=>x.c.toLowerCase()===String(m.color).toLowerCase());
        const g={...(fresh.groups?.[name]||{})};
        if(m.color&&ok)g.color=m.color;else delete g.color;
        fresh.groups=fresh.groups||{};
        if(Object.keys(g).length)fresh.groups[name]=g;else delete fresh.groups[name];
      }
      // 文件夹自己那套标签（跟书签标签是两套名单，老徐 260915 拍的）—— 跟颜色一样按夹名存
      if(m.ftags!==undefined){
        const name=(typeof m.title==='string'&&m.title.trim())?m.title.trim():node.title;
        const known=new Set((fresh.folderTags||[]).map(t=>t.id));
        const ids=[...new Set((Array.isArray(m.ftags)?m.ftags:[]).map(String).filter(x=>known.has(x)))];
        const g={...(fresh.groups?.[name]||{})};
        if(ids.length)g.ftags=ids;else delete g.ftags;
        fresh.groups=fresh.groups||{};
        if(Object.keys(g).length)fresh.groups[name]=g;else delete fresh.groups[name];
      }
      await chrome.storage.local.set({meta:fresh});
    }
    return true;
  }
  if(m.type==='EDITOR_FOLDER_CREATE') {
    const parentId=String(m.parentId||'');const title=String(m.title||'').trim();
    if(!title)throw Error('得给它起个名字');
    const parent=(await chrome.bookmarks.get(parentId))[0];
    if(!parent||parent.url)throw Error('目标必须是文件夹');
    const made=await chrome.bookmarks.create({parentId,title});
    if(typeof markIntentional==='function')await markIntentional(made.id);   // 跟别处新建一样打记号，免得被墓碑当回声删掉
    return {id:made.id};
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
    const made=await chrome.bookmarks.create({parentId:parent.id,index:Math.min(undo.index,children.length),title:undo.title,url:undo.url});if(typeof markIntentional==='function')await markIntentional(made.id);   // 定义在 backup-worker.js，单测只加载本文件时没有它
    await chrome.storage.session.remove(undoKey);return true;
  }
  const stored=await chrome.storage.session.get(selectionKey),selection=m.selection||stored[selectionKey];
  if(!selection)return null;
  const dk=draftKey(windowId,selection);
  if(m.type==='EDITOR_DISCARD') {await chrome.storage.session.remove(dk);return true;}
  const node=selection.id ? (await chrome.bookmarks.get(selection.id))[0] : null;
  if(node&&!node.url){
    // 老徐 260914：「点文件夹时也可以显示该文件夹的详情页面……把很多东西嵌入到详情页面」
    if(m.type!=='EDITOR_LOAD')throw Error('这是文件夹，改名/说明/锁定走 EDITOR_FOLDER_UPDATE');
    const bar=await bookmarkBar();
    const {meta={}}=await chrome.storage.local.get('meta');
    const uidMap=(await chrome.storage.local.get('bookmarkIdentity')).bookmarkIdentity||{};
    const uid=uidMap[String(node.id)]?.uid||null;
    const kids=await chrome.bookmarks.getChildren(node.id);
    const count=(n)=>BmCore.countUrls(n);
    const full=BmCore.findNode(bar,node.id)||node;
    return {kind:'folder',folder:{id:node.id,title:node.title,path:BmCore.folderPath(bar,node.id),uid,
      count:count(full),subfolders:(full.children||[]).filter(c=>!c.url).length,
      children:kids.map(c=>c.url?{id:c.id,title:c.title,url:c.url}:{id:c.id,title:c.title,count:count(BmCore.findNode(bar,c.id)||c)}),
      note:(uid&&meta.folderNotes?.[uid])||'',
      color:meta.groups?.[node.title]?.color||'',
      colors:FOLDER_COLORS,
      locked:!!(uid&&meta.locks?.[uid])||!!meta.groups?.[node.title]?.locked,
      color:meta.groups?.[node.title]?.color||'',
      ftags:meta.groups?.[node.title]?.ftags||[],
      folderTags:meta.folderTags||[]},
      canNudge:BmCore.nudgeable(bar,node.id)};
  }
  const {meta={items:{},groups:{},tags:[]}}=await chrome.storage.local.get('meta');
  const item=node ? meta.items[BK.key(node.url)]||{} : {};
  const { [dk]: savedDraft }=await chrome.storage.session.get(dk);
  const draft=savedDraft||{id:node?.id||null,parentId:node?.parentId||selection.parentId,base:node?{title:node.title,url:node.url,parentId:node.parentId,dateAdded:node.dateAdded}:null,fields:{name:node?.title||'',url:node?.url||'',alias:item.name||'',desc:item.desc||'',note:item.note||'',icon:item.icon||'',tags:item.tags||[],parentId:node?.parentId||selection.parentId}};
  if(m.type==='EDITOR_LOAD') {
    const bar=await bookmarkBar();const folders=[{id:bar.id,title:'收集箱（书签栏根目录，待整理）'}];
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
    await snapshotBeforeDelete('删除前');   // 跟首页那条删除共用 90 秒窗口，别让连删把「整批之前」挤掉
    const fresh=(await chrome.bookmarks.get(target.id))[0];
    if(fresh.url!==target.url||fresh.parentId!==target.parentId||fresh.dateAdded!==target.dateAdded)throw Error('收藏已变化，请刷新后重试');
    await chrome.bookmarks.remove(target.id);
    await chrome.storage.session.set({['editorDuplicateUndo:'+windowId]:{parentId:target.parentId,index:target.index,title:target.title,url:target.url}});
    return true;
  }
  if(m.type==='EDITOR_DRAFT') {
    const patch=m.patch||{};const allowed=['name','url','alias','desc','note','icon','tags','parentId'];   // 🔴 note 曾经漏在这儿：侧栏每敲一个字都发过来，这里静默丢掉，保存时写回的还是旧值 ⇒ 详细说明永远存不上（codex 260914 查出）
    for(const k of Object.keys(patch))if(allowed.includes(k))draft.fields[k]=patch[k];
    await chrome.storage.session.set({[dk]:draft});
    if(node && ['alias','desc','note','icon','tags'].some(k=>k in patch)) {
      if(node.dateAdded!==draft.base.dateAdded || node.url!==draft.base.url) throw Error('书签地址已在其他地方改变。编辑草稿已保留，请重新载入后保存。');
      const k=BK.key(node.url),entry={...(meta.items[k]||{})};
      for(const f of ['alias','desc','note','icon','tags'])if(f in patch)entry[f==='alias'?'name':f]=patch[f];
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
        // 🔴 old 后展开会逐键压过目标网址已有的那份 ⇒ 把网址改成另一条书签正在用的地址时，
        //    对方的显示名和说明被无声盖掉（260914 核实官实测）。已有的优先，只补它没有的字段。
        meta.items[BK.key(url)]={...old,...(meta.items[BK.key(url)]||{})};
        if(!remaining)delete meta.items[BK.key(node.url)];
        await chrome.storage.local.set({meta});
      }
    } else {
      result=await chrome.bookmarks.create({parentId,title:fields.name.trim()||fields.alias.trim()||new URL(url).hostname,url});
      // 🔴 没有这一句：删掉一条、十分钟内在侧栏把同一网址加回同一个夹，
      //    下一轮自动同步会把它当成「账号同步回流」静默删掉（260914 核实官端到端复现）。
      //    首页新建、恢复、撤销删重复三条路都打了记号，只有这条漏了。
      if(typeof markIntentional==='function')await markIntentional(result.id);
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
    await snapshotBeforeDelete('删除前');await chrome.bookmarks.remove(node.id);
    await chrome.storage.session.remove([selectionKey,dk]);return true;
  }
  throw Error('未知编辑操作');
}
