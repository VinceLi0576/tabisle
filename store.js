// 数据层：唯一数据是浏览器自己的书签树。
// 真环境走 chrome.bookmarks；不在扩展里打开（file:// 开发预览）时走内存模拟，
// 模拟数据由 dev/mock-data.js 注入（Chrome 的 Bookmarks 文件原样转出来的），行为跟真 API 一致。

const hasChrome = typeof chrome !== 'undefined' && chrome.bookmarks && chrome.storage;

// ── 真书签 ──
const ChromeStore = {
  kind: 'chrome',
  async bar() {
    const tree = await chrome.bookmarks.getTree();
    const roots = tree[0].children || [];
    const bar = roots.find((n) => n.folderType === 'bookmarks-bar') || roots.find((n) => n.id === '1') || roots[0];
    return bar;
  },
  children: (id) => chrome.bookmarks.getChildren(String(id)),
  get: async (id) => (await chrome.bookmarks.get(String(id)))[0],
  move: (id, dest) => chrome.bookmarks.move(String(id), dest),
  update: (id, ch) => chrome.bookmarks.update(String(id), ch),
  create: (props) => chrome.bookmarks.create(props),
  remove: async (id) => { const r = await chrome.runtime.sendMessage({ type: 'BOOKMARK_REMOVE', id: String(id) }); if (!r?.ok) throw Error(r?.error || '删除失败'); },
  removeTree: async (id) => { const r = await chrome.runtime.sendMessage({ type: 'BOOKMARK_REMOVE', id: String(id), tree: true }); if (!r?.ok) throw Error(r?.error || '删除失败'); },
  onChange(cb) {
    for (const ev of ['onCreated', 'onChanged', 'onMoved', 'onRemoved', 'onChildrenReordered', 'onImportEnded']) {
      chrome.bookmarks[ev]?.addListener(cb);
    }
  },
  favicon(url) {
    const u = new URL(chrome.runtime.getURL('/_favicon/'));
    u.searchParams.set('pageUrl', url);
    u.searchParams.set('size', '32');
    return u.href;
  },
  // Chrome 没缓存过的站，_favicon 会回一个灰地球。拿一个肯定没缓存的域名当参照，逐像素比对认出它
  _refSig: null,
  _sig(img) {
    const c = document.createElement('canvas'); c.width = c.height = 16;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0, 16, 16);
    return c.toDataURL();
  },
  isDefaultIcon(img) {
    if (!this._refSig) {
      this._refSig = new Promise((res) => {
        const i = new Image();
        i.onload = () => res(this._sig(i));
        i.onerror = () => res(null);
        i.src = this.favicon('https://no-such-site-for-default-icon.invalid/');
      });
    }
    return this._refSig.then((ref) => ref && this._sig(img) === ref);
  },
  prefs: {
    get: (defaults) => chrome.storage.local.get(defaults),
    set: (obj) => chrome.storage.local.set(obj),
  },
  // 附属数据（标签／说明／图标按网址对应，组颜色按组名对应）。书签里放不下这些，所以另存一份；丢了只丢装饰
  meta: {
    async get() { return (await chrome.storage.local.get({ meta: { items: {}, groups: {} } })).meta; },
    set: (meta) => chrome.storage.local.set({ meta }),
    onChanged(cb) { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.meta && ch.meta.newValue) cb(ch.meta.newValue); }); },
  },
  // 后台统一请求站点图标，避免页面跨域失败与重复请求。
  _iconCache: new Map(),
  async remoteIcon(h) {
    if (!this._iconCache.has(h)) this._iconCache.set(h,
      chrome.runtime.sendMessage({ type: 'ICON_FETCH', host: h }).then(r => r?.ok ? r.data : null).catch(() => null));
    return this._iconCache.get(h);
  },
  async recent(n = 18) {
    if (!chrome.history) return [];
    const self = chrome.runtime.getURL('');
    const items = await chrome.history.search({ text: '', maxResults: 120, startTime: Date.now() - 14 * 86400e3 });
    const seen = new Set(); const out = [];
    for (const it of items.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0))) {
      if (!/^https?:/.test(it.url) || it.url.startsWith(self)) continue;
      let h = ''; try { h = new URL(it.url).hostname; } catch {}
      const key = (it.title || '').trim() ? `${h}|${it.title.trim()}` : it.url.replace(/[#?].*$/, '').replace(/\/$/, '');
      if (seen.has(key)) continue;   // 同站同标题只留最近一次（同一个后台点了好几页，不重复占位）
      seen.add(key); out.push({ url: it.url, title: it.title || '' });
      if (out.length >= n) break;
    }
    return out;
  },
};

// ── 内存模拟（只为离线看排版、试拖动）──
function makeMockStore(raw) {
  let seq = 1;
  const byId = new Map();
  const listeners = [];
  const emit = () => listeners.forEach((f) => f());

  function conv(n, parentId, index) {
    const node = { id: String(seq++), parentId, index, title: n.name || '', dateAdded: Number(n.date_added) || 0 };
    if (n.type === 'url') node.url = n.url;
    else node.children = [];
    byId.set(node.id, node);
    if (n.type === 'folder') (n.children || []).forEach((c, i) => node.children.push(conv(c, node.id, i)));
    return node;
  }
  const root = { id: '0', title: '', children: [] };
  byId.set('0', root);
  const bar = conv({ ...raw.roots.bookmark_bar, name: '书签栏' }, '0', 0);
  bar.folderType = 'bookmarks-bar';
  root.children.push(bar);

  const reindex = (folder) => folder.children.forEach((c, i) => { c.index = i; });
  const clone = (n) => {
    const c = { ...n };
    if (n.children) c.children = n.children.map(clone);
    return c;
  };
  const shallow = (n) => { const { children, ...rest } = n; return rest; };

  return {
    kind: 'mock',
    async bar() { return clone(bar); },
    async children(id) { return (byId.get(String(id)).children || []).map(shallow); },
    async get(id) { return shallow(byId.get(String(id))); },
    async move(id, dest) {
      const node = byId.get(String(id));
      const oldParent = byId.get(node.parentId);
      const newParent = byId.get(String(dest.parentId ?? node.parentId));
      const oldIndex = oldParent.children.indexOf(node);
      let index = dest.index ?? newParent.children.length;
      if (oldParent === newParent && (index === oldIndex || index === oldIndex + 1)) return shallow(node);
      if (oldParent === newParent && index > oldIndex) index--;
      oldParent.children.splice(oldIndex, 1);
      newParent.children.splice(index, 0, node);
      node.parentId = newParent.id;
      reindex(oldParent); reindex(newParent);
      emit();
      return shallow(node);
    },
    async update(id, ch) {
      const node = byId.get(String(id));
      if (ch.title !== undefined) node.title = ch.title;
      if (ch.url !== undefined && node.url) node.url = ch.url;
      emit();
      return shallow(node);
    },
    async create(props) {
      const parent = byId.get(String(props.parentId));
      const node = { id: String(seq++), parentId: parent.id, title: props.title || '', dateAdded: Date.now() };
      if (props.url) node.url = props.url; else node.children = [];
      byId.set(node.id, node);
      parent.children.splice(props.index ?? parent.children.length, 0, node);
      reindex(parent);
      emit();
      return shallow(node);
    },
    async remove(id) { return this.removeTree(id); },
    async removeTree(id) {
      const node = byId.get(String(id));
      const parent = byId.get(node.parentId);
      parent.children.splice(parent.children.indexOf(node), 1);
      const drop = (n) => { byId.delete(n.id); (n.children || []).forEach(drop); };
      drop(node);
      reindex(parent);
      emit();
    },
    onChange(cb) { listeners.push(cb); },
    favicon() { return null; },
    isDefaultIcon() { return Promise.resolve(false); },
    meta: {
      async get() { try { return JSON.parse(localStorage.getItem('meta')) || { items: {}, groups: {} }; } catch { return { items: {}, groups: {} }; } },
      async set(m) { try { localStorage.setItem('meta', JSON.stringify(m)); } catch {} },
    },
    async recent() { return []; },
    async remoteIcon() { return null; },
    prefs: {
      async get(defaults) {
        try { return { ...defaults, ...JSON.parse(localStorage.getItem('prefs') || '{}') }; } catch { return { ...defaults }; }
      },
      async set(obj) {
        try {
          const cur = JSON.parse(localStorage.getItem('prefs') || '{}');
          localStorage.setItem('prefs', JSON.stringify({ ...cur, ...obj }));
        } catch {}
      },
    },
  };
}

async function loadStore() {
  if (hasChrome) return ChromeStore;
  if (!window.__MOCK__) {
    await new Promise((resolve) => {
      const s = document.createElement('script');
      s.src = 'dev/mock-data.js';
      s.onload = resolve;
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
  }
  const raw = window.__MOCK__ || { roots: { bookmark_bar: { type: 'folder', name: '书签栏', children: [] } } };
  return makeMockStore(raw);
}

window.loadStore = loadStore;
