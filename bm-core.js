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

  // ── AI 的工作范围 ──
  // 附加一个文件夹之后，哪些节点算「在这一摊里」。
  // 🔴 含子夹，并且不给开关：用户在左边点的是「这一摊」不是「这一层」。
  // 依据：Continue 用 path LIKE 'dir%'、Aider 用 rglob("*")，两个互不相干的实现
  // 独立收敛到同一个默认，都没提供关闭。代价用可见性补（卡片上写含几个子夹、多少条）。
  function scopeIds(bar, rootIds) {
    const want = new Set((rootIds || []).map(String));
    const out = new Set();
    if (!bar || !want.size) return out;
    const collect = (n) => { out.add(String(n.id)); for (const c of n.children || []) collect(c); };
    const walk = (n) => {
      if (want.has(String(n.id))) { collect(n); return; }
      for (const c of n.children || []) if (!c.url) walk(c);
    };
    walk(bar);
    return out;
  }
  // 从书签栏根一路拼下来的路径，给人看「这是哪个夹」
  function folderPath(bar, id) {
    if (!bar) return '';
    if (String(bar.id) === String(id)) return bar.title || '书签栏';
    const walk = (n, p) => {
      for (const c of n.children || []) {
        if (c.url) continue;
        const next = p ? p + ' / ' + (c.title || '（未命名）') : (c.title || '（未命名）');
        if (String(c.id) === String(id)) return next;
        const hit = walk(c, next);
        if (hit) return hit;
      }
      return '';
    };
    return walk(bar, bar.title || '书签栏');
  }
  // 卡片上要显示的：这一摊多少条、几个子夹、完整路径
  function scopeStats(bar, rootId) {
    const n = findNode(bar, rootId);
    if (!n || n.url) return null;
    let subfolders = 0;
    const walk = (x) => { for (const c of x.children || []) if (!c.url) { subfolders++; walk(c); } };
    walk(n);
    return { id: String(n.id), title: n.title || '（未命名）', path: folderPath(bar, rootId), count: countUrls(n), subfolders };
  }

  // 文件夹说明（这个夹该放哪类东西）。
  // \u{1F534} 按 uid 存，跟锁同一套身份 —— 按标题存的话，改个名说明就跟丢了，
  // 而且两个同名夹会共用一条说明（锁当初就是踩了这两个坑才迁到 uid 的）。
  const folderNote = (meta, uidById, id) => {
    const uid = uidById && uidById[String(id)];
    return (uid && meta && meta.folderNotes && meta.folderNotes[uid]) || '';
  };

  root.BmCore = { esc, key, host, domainParts, countUrls, findNode, flatten, applyItemMeta, folderLocked, lockedInTree, sameDomainFolders, scopeIds, scopeStats, folderPath, folderNote, SLD };
  if (typeof module !== 'undefined') module.exports = root.BmCore;
})(globalThis);
