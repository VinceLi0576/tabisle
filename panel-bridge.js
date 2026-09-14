// 侧栏里的书签桥：形状跟首页的 window.BM 一样，让 ai.js 不用改就能在侧栏跑。
// 数据层用共用的 store.js，派生逻辑用共用的 bm-core.js，🚫 不在这儿另写一份规则。
(async () => {
  const store = await window.loadStore();
  if (store.kind !== 'chrome') return;                 // 侧栏只在扩展里有意义

  const MAX_TAGS = 9;
  const PALETTE = ['#2f6fdb','#1f9d55','#d08700','#d64545','#8e44ad','#0e9aa7','#e07a2f','#5c6b7a','#c2185b','#3d8b40'];
  let meta = await store.meta.get();
  meta.items ||= {}; meta.groups ||= {}; meta.tags ||= []; meta.locks ||= {}; meta.folderNotes ||= {};
  let bar = await store.bar();
  let flat = BmCore.flatten(bar);
  let uidById = {};

  const saveMeta = () => {
    const p = store.meta.set(meta);
    p.catch((e) => toast('这次改动没能存下来：' + (e.message || e)));   // 同首页：🚫 别静默
    return p;
  };
  async function refresh() {
    bar = await store.bar();
    flat = BmCore.flatten(bar);
    try {
      const r = await BG.askBg({ type: 'IDENTITY_MAP' }, { ms: 10000, retry: false });
      if (r?.ok && r.data) uidById = r.data;
    } catch { /* 后台没起来就先用现有映射，🚫 别卡住 */ }
    window.dispatchEvent(new Event('panel-bookmarks'));
  }

  function toast(msg, action) {
    const t = document.getElementById('panel-toast'); if (!t) return;
    t.replaceChildren(document.createTextNode(String(msg)));
    if (action) { const b = document.createElement('button'); b.textContent = action.t; b.onclick = () => { t.hidden = true; action.f(); }; t.appendChild(b); }
    t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, action ? 12000 : 5000);
  }

  window.BM = {
    store, MAX_TAGS, PALETTE,
    key: BmCore.key, host: BmCore.host, domainParts: BmCore.domainParts, countUrls: BmCore.countUrls, esc: BmCore.esc,
    get bar() { return bar; }, get flat() { return flat; }, get meta() { return meta; }, get prefs() { return {}; },
    itemMeta: (u) => meta.items[BmCore.key(u)] || {},
    setItemMeta(u, patch) { BmCore.applyItemMeta(meta, u, patch); saveMeta(); },
    saveMeta, savePrefs: () => {},
    tagList: () => meta.tags, tagDef: (id) => meta.tags.find((t) => t.id === id),
    findNode: (id) => BmCore.findNode(bar, id),
    label: (n) => (n.url && (meta.items[BmCore.key(n.url)] || {}).name) || n.title || BmCore.host(n.url) || '（无名）',
    rawLabel: (n) => n.title || BmCore.host(n.url) || '（无名）',
    isLocked: (id) => BmCore.lockedInTree(meta, uidById, bar, id),
    folderNote: (id) => BmCore.folderNote(meta, uidById, id),
    setFolderNote(id, text) {
      const uid = uidById[String(id)];
      if (!uid) { toast('这个文件夹还没拿到稳定标识，先做一次自动备份再写说明'); return false; }
      meta.folderNotes ||= {};
      const v = String(text || '').trim();
      if (v) meta.folderNotes[uid] = v; else delete meta.folderNotes[uid];
      saveMeta(); return true;
    },
    refresh, render: () => window.dispatchEvent(new Event('panel-bookmarks')), toast,
    openDetail: (id) => window.dispatchEvent(new CustomEvent('panel-open-detail', { detail: { id } })),
    parseEmojiRules: () => [], setEmojiRules: () => {},
  };

  await refresh();
  // 别处（首页、同步）改了书签或备注，侧栏要跟上
  store.onChange(() => { refresh().catch(() => {}); });
  store.meta.onChanged?.((fresh) => { meta = fresh; meta.items ||= {}; meta.groups ||= {}; meta.tags ||= []; meta.locks ||= {}; meta.folderNotes ||= {}; window.dispatchEvent(new Event('panel-bookmarks')); });
  window.dispatchEvent(new Event('bm-ready'));          // ai.js 等的就是这一下
})();
