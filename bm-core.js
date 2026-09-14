// 书签树 + 附属数据的派生逻辑。首页和侧栏共用同一份，🚫 别各抄一份（抄出来必然漂移）。
// 只放纯逻辑与对 store 的薄封装，不碰 DOM。
(function (root) {
  const SLD = new Set(['com.cn','net.cn','org.cn','gov.cn','edu.cn','co.uk','org.uk','com.au','co.jp','com.hk','com.tw','com.sg']);

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  // 附属数据按「归一化网址」做 key：去掉锚点与结尾斜杠 ⇒ 同一个网址的多份收藏共用一份备注
  const key = (u) => { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return String(u || ''); } };
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  function domainParts(u) {
    const h = host(u); if (!h) return { root: '', pre: '' };
    if (/^(\d+\.){3}\d+$/.test(h) || !h.includes('.')) return { root: h, pre: '' };
    const p = h.split('.');
    const n = SLD.has(p.slice(-2).join('.')) ? 3 : 2;
    return { root: p.slice(-n).join('.'), pre: p.slice(0, -n).join('.') };
  }
  const countUrls = (n) => (n.children || []).reduce((s, c) => s + (c.url ? 1 : countUrls(c)), 0);
  function findNode(bar, id) {
    if (!bar) return null;
    if (String(id) === String(bar.id)) return bar;
    let hit = null;
    const walk = (n) => { if (hit) return; if (String(n.id) === String(id)) { hit = n; return; } (n.children || []).forEach(walk); };
    walk(bar); return hit;
  }
  function flatten(bar) {
    const out = [];
    const walk = (n, path) => {
      for (const c of n.children || []) {
        if (c.url) out.push({ id: c.id, title: c.title, url: c.url, path, parentId: n.id });
        else walk(c, path ? `${path} / ${c.title}` : c.title);
      }
    };
    if (bar) walk(bar, '');
    return out;
  }
  // 附属数据写入是「四个字段一起判空」：全空就把整条删掉，不留空壳
  function applyItemMeta(meta, url, patch) {
    const k = key(url); const cur = { ...(meta.items[k] || {}), ...patch };
    if (!(cur.tags && cur.tags.length) && !cur.desc && !cur.icon && !cur.name) delete meta.items[k];
    else meta.items[k] = cur;
    return meta;
  }
  // 锁：先看节点的稳定身份，再兼容旧的按名锁
  function folderLocked(meta, uidById, n) {
    if (!n || n.url) return false;
    const uid = uidById[String(n.id)];
    if (uid && meta.locks && meta.locks[uid]) return true;
    return !!(meta.groups[n.title] || {}).locked;
  }
  // 锁沿父链继承：祖先锁了，里面全锁
  function lockedInTree(meta, uidById, bar, id) {
    let hit = false;
    const walk = (n, chain) => {
      if (hit) return;
      const c2 = n.url ? chain : chain || folderLocked(meta, uidById, n);
      if (String(n.id) === String(id)) { hit = c2; return; }
      for (const c of n.children || []) walk(c, c2);
    };
    if (bar) walk(bar, false);
    return hit;
  }
  // 同一个网站的收藏分布在哪几个文件夹里。
  // 🔴 按注册域归并（cc.xntj.tv 和 www.xntj.tv 算同一个网站），子域只在明细里显示 ——
  // 要的是「同一个站的东西散在几个夹里」，按 hostname 分会把它们拆散、看不出散乱。
  function sameDomainFolders(rootNodes, url, currentId, cap = 50) {
    const target = domainParts(url).root;
    if (!target) return { root: '', total: 0, folders: [] };
    const byFolder = new Map();
    const walk = (nodes, path) => {
      for (const n of nodes || []) {
        if (n.children) { walk(n.children, path ? path + ' / ' + (n.title || '未命名') : (n.title || '未命名')); continue; }
        if (!n.url || domainParts(n.url).root !== target) continue;
        const at = path || '书签栏';
        if (!byFolder.has(at)) byFolder.set(at, { path: at, parentId: n.parentId, count: 0, items: [], hasCurrent: false });
        const g = byFolder.get(at);
        g.count++;
        const current = String(n.id) === String(currentId);
        if (current) g.hasCurrent = true;
        if (g.items.length < cap) g.items.push({ id: n.id, title: n.title || '未命名', url: n.url, sub: host(n.url), current });
      }
    };
    walk(rootNodes, '');
    const folders = [...byFolder.values()].sort((a, b) => Number(b.hasCurrent) - Number(a.hasCurrent) || b.count - a.count || a.path.localeCompare(b.path, 'zh'));
    return { root: target, total: folders.reduce((s, f) => s + f.count, 0), folders };
  }

  root.BmCore = { esc, key, host, domainParts, countUrls, findNode, flatten, applyItemMeta, folderLocked, lockedInTree, sameDomainFolders, SLD };
  if (typeof module !== 'undefined') module.exports = root.BmCore;
})(globalThis);
