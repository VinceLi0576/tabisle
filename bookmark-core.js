// Shared, browser-independent snapshot validation, matching and diff logic.
(function (root) {
  const key = (url) => { try { const u = new URL(url); u.hash = ''; return u.href.replace(/\/$/, ''); } catch { return String(url || ''); } };
  // Only these exact browser-owned routes are equivalent. Web URLs remain exact.
  const browserUrlEqual=(a,b)=>a===b||(['chrome://bookmarks/','edge://favorites/'].includes(a)&&['chrome://bookmarks/','edge://favorites/'].includes(b));
  const validUrl = (value) => {
    let url = String(value || '').trim();
    if (!url) throw Error('地址不能为空');
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
    const parsed = new URL(url);
    if (!['http:', 'https:', 'file:', 'ftp:', 'chrome:', 'chrome-extension:', 'mailto:'].includes(parsed.protocol)) throw Error('不支持这个地址类型');
    return parsed.href;
  };
  function flatten(children, parent = '', path = '', out = []) {
    children.forEach((node, index) => {
      const entry = { ...node, parent, index, path: path ? path + ' / ' + node.title : node.title };
      out.push(entry);
      if (node.children) flatten(node.children, node.uid, entry.path, out);
    });
    return out;
  }
  function validate(snapshot) {
    if (!snapshot || snapshot.format !== 'newtab-bookmarks' || snapshot.version !== 1 || !Array.isArray(snapshot.children) || !snapshot.meta || !snapshot.prefs) throw Error('不是书签首页的完整备份文件');
    if (JSON.stringify(snapshot).length > 12e6) throw Error('备份文件过大（上限 12 MB）');
    const safe = (v) => { if (!v || typeof v !== 'object') return; for (const k of Object.keys(v)) { if (['__proto__', 'prototype', 'constructor'].includes(k)) throw Error('备份包含不安全的属性'); safe(v[k]); } };
    safe(snapshot);
    if(snapshot.folderState!=null&&(Array.isArray(snapshot.folderState)||typeof snapshot.folderState!=='object'||Object.values(snapshot.folderState).some(v=>typeof v!=='boolean')))throw Error('文件夹折叠状态格式不正确');
    const ids = new Set(); let total = 0;
    const walk = (nodes, depth) => {
      if (depth > 100) throw Error('文件夹层级超过 100 层');
      for (const n of nodes) {
        if (++total > 20000) throw Error('备份条目超过 20000 个');
        if (!n || typeof n.uid !== 'string' || !n.uid || ids.has(n.uid) || typeof n.title !== 'string') throw Error('备份条目缺少标识或存在重复标识');
        ids.add(n.uid);
        if (typeof n.url === 'string') { if (n.children) throw Error('书签不能同时是文件夹'); new URL(n.url); }
        else { if (!Array.isArray(n.children)) throw Error('文件夹结构不完整'); walk(n.children, depth + 1); }
      }
    };
    walk(snapshot.children, 1);
    const m = snapshot.meta;
    if (!m.items || Array.isArray(m.items) || typeof m.items !== 'object' || !m.groups || Array.isArray(m.groups) || typeof m.groups !== 'object' || !Array.isArray(m.tags)) throw Error('附属数据结构不完整');
    const color = (c) => c == null || /^#[0-9a-f]{3,8}$/i.test(c);
    for (const t of m.tags) if (!t || !/^[\w-]+$/.test(t.id) || typeof t.name !== 'string' || typeof t.glyph !== 'string' || !color(t.color)) throw Error('标签格式不正确');
    for (const g of Object.values(m.groups)) if (!g || typeof g !== 'object' || !color(g.color)) throw Error('分组颜色格式不正确');
    if (m.locks != null && (Array.isArray(m.locks) || typeof m.locks !== 'object')) throw Error('锁定数据结构不正确');
    if (m.folderNotes != null && (Array.isArray(m.folderNotes) || typeof m.folderNotes !== 'object' || Object.values(m.folderNotes).some((v) => typeof v !== 'string'))) throw Error('文件夹说明数据结构不正确');
    for (const item of Object.values(m.items)) {
      if (!item || typeof item !== 'object' || ['name', 'desc', 'note', 'icon'].some(k => item[k] != null && typeof item[k] !== 'string') || item.tags != null && (!Array.isArray(item.tags) || item.tags.some(t => typeof t !== 'string'))) throw Error('书签附属数据格式不正确');
    }
    return snapshot;
  }
  function plan(current, desired) {
    validate(desired);
    const before = flatten(current.children), after = flatten(desired.children);
    const byUid = new Map(before.map(n => [n.uid, n]));
    const used = new Set(), match = new Map();
    const sameType = (a,b) => ('url' in a) === ('url' in b);
    for (const n of after) { const b = byUid.get(n.uid); if (b && sameType(n,b)) { match.set(n.uid,b); used.add(b.uid); } }
    // Other browsers may assign different IDs. Reuse an unambiguous path/URL match.
    for (const n of after) if (!match.has(n.uid)) {
      let candidates = before.filter(b => !used.has(b.uid) && sameType(n,b) && b.path === n.path && (!n.url || b.url === n.url));
      if (candidates.length !== 1 && n.url) candidates = before.filter(b => !used.has(b.uid) && b.url === n.url);
      if (candidates.length === 1) { match.set(n.uid,candidates[0]); used.add(candidates[0].uid); }
    }
    const changes = [];
    const add = (op,n,b) => changes.push({ op, title:n.title || '（未命名）', path:n.path, before:b?.path, uid:n.uid,
      ...(op==='改名'?{oldValue:b.title,newValue:n.title}:op==='改地址'?{oldValue:b.url,newValue:n.url}:op==='排序'?{oldValue:String(b.index+1),newValue:String(n.index+1)}:{}) });
    const oldToNew = new Map([...match].map(([uid,b])=>[b.uid,uid]));
    for (const n of after) {
      const b = match.get(n.uid);
      if (!b) { add('新增',n); continue; }
      if (n.title !== b.title) add('改名',n,b);
      if (n.url !== b.url) add('改地址',n,b);
      const oldParent = b.parent ? oldToNew.get(b.parent) : '';
      if (oldParent !== n.parent) add('移动',n,b);
      else {
        const oldPeers = before.filter(x=>x.parent===b.parent && used.has(x.uid) && after.some(y=>y.uid===oldToNew.get(x.uid) && y.parent===n.parent)).map(x=>oldToNew.get(x.uid));
        const newPeers = after.filter(x=>x.parent===n.parent && match.has(x.uid) && match.get(x.uid).parent===b.parent).map(x=>x.uid);
        if (oldPeers.indexOf(n.uid) !== newPeers.indexOf(n.uid)) add('排序',n,b);
      }
    }
    for (const b of before) if (!used.has(b.uid)) add('删除',b);
    return { before, after, match, used, changes, metaChanged: stableStringify(current.meta)!==stableStringify(desired.meta), prefsChanged: stableStringify(current.prefs)!==stableStringify(desired.prefs) };
  }
  async function restore(api, barId, current, desired, onPlaced) {
    const p = plan(current,desired), live = new Map(), desiredLive = new Set();
    async function place(nodes,parentId) {
      for (const n of nodes) {
        const b = p.match.get(n.uid); let item;
        if (b) {
          item = await api.get(b.id);
          if (item.parentId !== parentId) item = await api.move(item.id,{parentId});
          if (item.title !== n.title || item.url !== n.url) item = await api.update(item.id,{title:n.title,...(n.url ? {url:n.url}:{})});
        } else item = await api.create({parentId,title:n.title,...(n.url ? {url:n.url}:{})});
        live.set(n.uid,item); desiredLive.add(item.id);
        if(onPlaced)await onPlaced(n.uid,item);
        if (n.children) await place(n.children,item.id);
      }
    }
    await place(desired.children,barId);
    const originalIds=new Set(p.before.map(n=>n.id));
    async function checkKnown(n){
      if(!originalIds.has(n.id)&&!desiredLive.has(n.id))throw Error('发现同时新增的书签，请重新预览');
      if(!n.url)for(const child of await api.children(n.id))await checkKnown(child);
    }
    async function prune(parentId) {
      for (const n of await api.children(parentId)) {
        if (!desiredLive.has(n.id)) { await checkKnown(n); if (n.url) await api.remove(n.id); else await api.removeTree(n.id); }
        else if (!n.url) await prune(n.id);
      }
    }
    await prune(barId);
    async function order(nodes,parentId) {
      for (let i=0;i<nodes.length;i++) {
        const n=nodes[i],item=live.get(n.uid),kids=await api.children(parentId);
        // Prefix is already correct: moves are always backward, avoiding index ambiguity.
        if (kids[i]?.id!==item.id) await api.move(item.id,{parentId,index:i});
        if (n.children) await order(n.children,item.id);
      }
    }
    await order(desired.children,barId);
    return live;
  }
  function stableStringify(value){
    const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
    return JSON.stringify(sort(value));
  }
  root.BookmarkCore = { key, browserUrlEqual, validUrl, flatten, validate, plan, restore, stableStringify };
  if (typeof module !== 'undefined') module.exports = root.BookmarkCore;
})(globalThis);
