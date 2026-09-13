// 书签首页：书签栏的一个视图。
// 规矩：「哪个在哪、什么顺序、归哪组、叫什么」全部写回书签树（换机跟着 floccus 走）；
//       「标签／说明／自定义图标（按网址）、组颜色（按组名）」是附属数据，本机存、可导出导入 —— 丢了只丢装饰；
//       「显示方式／大小／折叠／点开方式」只存本机。
(async () => {
  const store = await window.loadStore();
  const currentTab = store.kind === 'chrome' ? await chrome.tabs.getCurrent() : null;
  const currentWindowId = currentTab?.windowId;
  let selectedId = null, detailPanelOpen = false, detailSelection = null, detailTransition = false;
  if (store.kind === 'chrome') {
    const state = await chrome.storage.session.get(['editorOpen:' + currentWindowId, 'editorSelection:' + currentWindowId]);
    detailPanelOpen = !!state['editorOpen:' + currentWindowId];
    detailSelection = state['editorSelection:' + currentWindowId];
    selectedId = detailPanelOpen ? detailSelection?.id || null : null;
  }
  window.__store = store; // 调试口：CDP 里直接调数据层
  const $ = (s) => document.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const DEFAULT_TAGS = [
    { id: 'G', glyph: '官', name: '官网', desc: '产品或服务的官方入口', color: '#2f6fdb' },
    { id: 'Z', glyph: '自', name: '自建', desc: '自己搭的站、服务、后台', color: '#1f9d55' },
    { id: 'B', glyph: '备', name: '备份', desc: '资料存放、备份所在', color: '#d08700' },
  ];
  const MAX_TAGS = 9;
  const DEFAULT_EMOJI_RULES = `github 🐙
gitlab 🦊
google.com/drive 📁
drive.google 📁
docs.google 📄
sheets 📊
notebooklm 📓
gemini 💎
chatgpt 🤖
openai 🤖
claude 🧠
anthropic 🧠
grok 🚀
deepseek 🐋
kimi 🌙
notion 📓
yuque 📚
feishu 🕊️
larkoffice 🕊️
huoban 🧩
weread 📖
douban 📗
z-lib 📕
amazon 🛒
taobao 🛍️
tmall 🛍️
jd.com 📦
bilibili 📺
youtube ▶️
douyin 🎵
weixin 💬
qq.com 🐧
x.com 🐦
instagram 📷
telegram ✈️
discord 🎮
mail 📧
192.168. 🏠
100. 🏠
127.0.0.1 🏠
localhost 🏠
file:// 🗂️
ip 🌐
dns 🌐
nas 🗄️
fnnas 🗄️
synology 🗄️
cloud 🗄️
kod 🗄️
tailscale 🔗
cloudflare ☁️
tencent 🐧
aliyun ☁️
translate 🌍
deepl 🌍
duolingo 🦉
readwise 📚
obsidian 💎
logseq 🧱
anki 🃏
makerworld 🖨️
bilibili.com/cheese 🎓
xiaoe-tech 🎓
candobear 🐻
skilljar 🎓
apple 🍎
icloud ☁️
microsoft 🪟
live.com 🪟
huawei 📱
xiaomi 📱
pixpin 📸
typeless 🎙️
ticnote 🎙️
tingwu 🎙️
pexels 🖼️
chrome:// ⚙️`;
  const parseEmojiRules = (txt) => String(txt || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const m = l.match(/^(\S+)\s+(\S+)$/); return m ? { k: m[1].toLowerCase(), e: m[2] } : null; }).filter(Boolean);
  const segLen = (s) => { try { return [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(s)].length; } catch { return s.length; } };
  const isEmoji = (s) => !!s && !/^https?:|^data:|^chrome/.test(s) && segLen(s.trim()) <= 2 && /\p{Extended_Pictographic}/u.test(s);
  const PALETTE = ['#2f6fdb', '#1f9d55', '#d08700', '#d64545', '#8e44ad', '#0e9aa7', '#e07a2f', '#5c6b7a', '#c2185b', '#3d8b40'];

  // ── 本机偏好 ──
  const DEFAULTS = { view: 'card', recentCollapsed: false, filterMode: 'and', folderCollapsed: {} };
  let prefs = await store.prefs.get(DEFAULTS);
  if (!prefs.folderCollapsed || typeof prefs.folderCollapsed !== 'object' || Array.isArray(prefs.folderCollapsed)) prefs.folderCollapsed = {};
  if (prefs.view !== 'list') prefs.view = 'card';
  function applyPrefs() {
    const h = document.documentElement;
    h.dataset.view = prefs.view;
    $$('.seg').forEach((seg) => $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.val === String(prefs[seg.dataset.key]))));
    $('#recent').classList.toggle('collapsed', !!prefs.recentCollapsed);
  }
  const savePrefs = () => { const { folderCollapsed, ...display } = prefs; return store.prefs.set(display); };
  applyPrefs();

  // ── 附属数据 ──
  let meta = await store.meta.get();
  meta.items ||= {}; meta.groups ||= {}; meta.tags ||= DEFAULT_TAGS.map((t) => ({ ...t }));
  if (typeof meta.emojiRules !== 'string') meta.emojiRules = DEFAULT_EMOJI_RULES;
  let emojiRules = parseEmojiRules(meta.emojiRules);
  function emojiFor(u, title) {
    const hay = `${String(u || '').toLowerCase()} ${String(title || '').toLowerCase()}`;
    const r = emojiRules.find((x) => hay.includes(x.k));
    return r ? r.e : '';
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const tagList = () => meta.tags;
  const tagDef = (id) => meta.tags.find((t) => t.id === id);
  const deprecatedTags = () => meta.tags.filter((t) => t.name?.trim() === '废弃');
  function effectiveTags(n) {
    const ids = new Set(n.url ? itemMeta(n.url).tags || [] : []);
    for (let node = n.url ? findNode(n.parentId) : n; node; node = node.parentId ? findNode(node.parentId) : null) {
      for (const id of meta.groups[node.title]?.tags || []) ids.add(id);
    }
    return [...ids];
  }
  function isDeprecated(n, includeParents = false) {
    const ids = new Set(deprecatedTags().map((t) => t.id));
    for (let node = n; node; node = includeParents && node.parentId ? findNode(node.parentId) : null) {
      const tags = (node.url ? itemMeta(node.url) : meta.groups[node.title])?.tags || [];
      if (tags.some((id) => ids.has(id))) return true;
    }
    return false;
  }
  function deprecatedLast(nodes, includeParents = false) {
    const current = [], deprecated = [];
    for (const node of nodes) (isDeprecated(node, includeParents) ? deprecated : current).push(node);
    return [...current, ...deprecated]; // 仅稳定分区展示，不改变浏览器书签树。
  }
  const tagBtn = (t, cls = '') => `<button type="button" class="tag ${cls}" data-tag="${t.id}" style="--tc:${t.color}" title="${esc(t.name)}${t.desc ? '：' + esc(t.desc) : ''}"><b>${esc(t.glyph)}</b>`;
  let lastMetaJson = '';
  const saveMeta = () => { lastMetaJson = JSON.stringify(meta); return store.meta.set(meta); };
  store.meta.onChanged?.((fresh) => {
    const j = JSON.stringify(fresh);
    if (j === lastMetaJson || j === JSON.stringify(meta)) return;   // 自己写的回声
    meta = fresh; meta.items ||= {}; meta.groups ||= {}; meta.tags ||= DEFAULT_TAGS.map((t) => ({ ...t }));
    if (typeof meta.emojiRules !== 'string') meta.emojiRules = DEFAULT_EMOJI_RULES;
    emojiRules = parseEmojiRules(meta.emojiRules);
    if (typeof render === 'function' && bar) render();
  });
  const key = (u) => { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return String(u || ''); } };
  const itemMeta = (u) => meta.items[key(u)] || {};
  function setItemMeta(u, patch) {
    const k = key(u); const cur = { ...(meta.items[k] || {}), ...patch };
    if (!(cur.tags && cur.tags.length) && !cur.desc && !cur.icon && !cur.name) delete meta.items[k]; else meta.items[k] = cur;
    saveMeta();
  }
  const groupColor = (title) => (meta.groups[title] || {}).color || '';
  // 锁定：按文件夹名记在 meta.groups；锁了的夹（含子夹）AI 只看不动，页面上拖进拖出也挡
  const folderLockedByTitle = (title) => !!(meta.groups[title] || {}).locked;
  function isLocked(id) {
    let hit = false;
    const walk = (n, chain) => { if (hit) return; const c2 = n.url ? chain : chain || folderLockedByTitle(n.title); if (n.id === id) { hit = c2; return; } for (const c of n.children || []) walk(c, c2); };
    walk(bar, false); return hit;
  }

  // ── 筛选状态（不持久）──
  const globalFilter = new Set();
  const groupFilter = new Map(); // folderId → Set

  // ── 数据 ──
  let bar = null;
  let flat = [];
  const countUrls = (n) => (n.children || []).reduce((s, c) => s + (c.url ? 1 : countUrls(c)), 0);
  const tagCounts = (n) => {
    const c = {}; tagList().forEach((t) => { c[t.id] = 0; });
    const walk = (x) => { for (const k of x.children || []) { if (k.url) effectiveTags(k).forEach((t) => { if (t in c) c[t]++; }); else walk(k); } };
    walk(n); return c;
  };
  function buildFlat() {
    flat = [];
    const walk = (n, path) => {
      for (const c of n.children || []) {
        if (c.url) flat.push({ id: c.id, title: c.title, url: c.url, path, parentId: n.id });
        else walk(c, path ? `${path} / ${c.title}` : c.title);
      }
    };
    walk(bar, '');
  }
  async function refresh() {
    bar = await store.bar();
    buildFlat();
    render();
    if ($('#search').value.trim()) renderSearch();
    if (selectedId && !findNode(selectedId)) selectedId = null;
  }

  // ── 渲染 ──
  const svgChev = '<svg viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
  const SLD = new Set(['com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'co.uk', 'org.uk', 'com.au', 'co.jp', 'com.hk', 'com.tw', 'com.sg']);
  function domainParts(u) {
    const h = host(u); if (!h) return { root: '', pre: '' };
    if (/^(\d+\.){3}\d+$/.test(h) || !h.includes('.')) return { root: h, pre: '' };
    const p = h.split('.');
    const n = SLD.has(p.slice(-2).join('.')) ? 3 : 2;
    return { root: p.slice(-n).join('.'), pre: p.slice(0, -n).join('.') };
  }
  const label = (n) => (n.url && itemMeta(n.url).name) || n.title || host(n.url) || '（无名）';
  const rawLabel = (n) => n.title || host(n.url) || '（无名）';
  const hue = (s) => { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h % 360; };

  // 图标井：三种来源全进同一个 36×36 的井 —— 浏览器缓存 20、公网图标 24、首字＝井本身上色＋白字
  function icoEl(n) {
    const ico = document.createElement('span');
    ico.className = 'well';
    const h = host(n.url);
    const letter = () => {
      const t = label(n).trim();
      const em = emojiFor(n.url, t);
      ico.replaceChildren();
      if (em) { ico.className = 'well emoji'; ico.textContent = em; ico.style.background = `hsl(${hue(h || t)} 40% 92%)`; return; }
      ico.className = 'well letter';
      ico.textContent = (t[0] || '?').toUpperCase();
      ico.style.background = `hsl(${hue(h || t)} 45% 52%)`;
    };
    const remote = async () => {
      if (!h || /^(\d+\.){3}\d+$|^localhost$|\.local$|^[^.]+$/.test(h)) { letter(); return; }
      const src = await store.remoteIcon(h);
      if (!src) { letter(); return; }
      const r = document.createElement('img'); r.alt = '';
      r.onload = () => { ico.className = 'well big'; ico.replaceChildren(r); };
      r.onerror = letter;
      r.src = src;
    };
    const custom = itemMeta(n.url).icon;
    if (isEmoji(custom)) { ico.className = 'well emoji'; ico.textContent = custom; ico.style.background = `hsl(${hue(h || label(n))} 40% 92%)`; return ico; }
    const src = custom || store.favicon(n.url);
    if (!src) { letter(); return ico; }
    const img = document.createElement('img');
    img.alt = '';
    img.src = src;
    if (custom) { ico.className = 'well custom'; img.onerror = remote; }
    else { img.onload = async () => { if (await store.isDefaultIcon(img)) remote(); }; img.onerror = remote; }
    ico.appendChild(img);
    return ico;
  }

  function tagChips(tags, max = 2) {
    const box = document.createElement('span'); box.className = 'tags';
    const defs = (tags || []).map(tagDef).filter(Boolean);
    defs.slice(0, max).forEach((t) => {
      const s = document.createElement('span'); s.className = 'tag mini'; s.title = t.name; s.style.setProperty('--tc', t.color);
      s.innerHTML = `<b>${esc(t.glyph)}</b>`; box.appendChild(s);
    });
    if (defs.length > max) { const m = document.createElement('span'); m.className = 'more-n'; m.textContent = `+${defs.length - max}`; m.title = defs.slice(max).map((t) => t.name).join('、'); box.appendChild(m); }
    return box;
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      toast('网址已复制');
      return true;
    } catch {
      toast('复制失败，请重试；也可在详情中手动复制网址');
      return false;
    }
  }

  function copyLogo(n) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'copy-url';
    button.title = '点击复制网址';
    button.setAttribute('aria-label', `复制网址：${label(n)}`);
    button.appendChild(icoEl(n));
    let feedbackTimer;
    button.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      if (dragJustHappened) return;
      clearTimeout(feedbackTimer);
      button.classList.remove('copied'); button.title = '点击复制网址';
      if (await copyUrl(n.url)) {
        button.classList.add('copied'); button.title = '网址已复制';
        clearTimeout(feedbackTimer);
        feedbackTimer = setTimeout(() => {
          button.classList.remove('copied'); button.title = '点击复制网址';
        }, 1600);
      }
    });
    // 空格由按钮原生激活，不能冒泡触发首页的键入搜索。
    button.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') e.stopPropagation();
    });
    button.addEventListener('auxclick', (e) => e.preventDefault());
    return button;
  }

  function tileEl(n) {
    const m = itemMeta(n.url);
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = n.url; a.target = '_blank'; a.rel = 'noopener';
    a.draggable = true;
    a.dataset.id = n.id; a.dataset.kind = 'url';
    a.title = `${label(n)}${m.name ? '（书签名：' + rawLabel(n) + '）' : ''}\n${n.url}${m.desc ? '\n' + m.desc : ''}`;
    a.dataset.dom = domainParts(n.url).root;
    a.appendChild(copyLogo(n));
    const txt = document.createElement('span'); txt.className = 'txt';
    const line1 = document.createElement('span'); line1.className = 'line1';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = label(n); line1.appendChild(name);
    line1.appendChild(tagChips(m.tags));
    txt.appendChild(line1);
    if (m.name) { const o = document.createElement('span'); o.className = 'orig'; o.textContent = rawLabel(n); line1.appendChild(o); }
    const desc = document.createElement('span'); desc.className = 'desc';
    if (m.desc) { desc.textContent = m.desc; desc.classList.add('said'); }
    else { const d = domainParts(n.url); desc.innerHTML = (d.pre ? `<span class="pre">${esc(d.pre)}</span><span class="sep">·</span>` : '') + `<span class="dom">${esc(d.root)}</span>`; }
    desc.title = m.desc ? m.desc : n.url;
    txt.appendChild(desc);
    const u = document.createElement('span'); u.className = 'url'; u.textContent = n.url; txt.appendChild(u);
    a.appendChild(txt);
    a.appendChild(detailArrow(n.id));
    if (selectedId === n.id) a.classList.add('selected');
    return a;
  }

  function addTile(folderId) {
    const d = document.createElement('div');
    d.className = 'tile add'; d.dataset.folder = folderId; d.title = '在这一组里加一条书签';
    d.innerHTML = '<span class="ico">＋</span>';
    return d;
  }

  const LEVEL_COLORS = ['#2f6fdb', '#1f9d55', '#e07a2f', '#8e44ad'];
  const isInbox = (f) => f.title?.trim().toLowerCase() === 'inbox';
  const foldKey = (f) => `${f.id}:${f.dateAdded || 0}`;
  function defaultCollapsed(f) {
    for (let n = f; n; n = n.parentId ? findNode(n.parentId) : null) if (isInbox(n)) return true;
    return false;
  }
  function folderCollapsed(f) {
    const saved = prefs.folderCollapsed[foldKey(f)];
    return typeof saved === 'boolean' ? saved : defaultCollapsed(f);
  }
  function levelMark(level) {
    return `<span class="level-mark" aria-hidden="true" style="--level-count:${level}">${'<i></i>'.repeat(level)}</span>`;
  }
  function paintFold(section, collapsed) {
    section.classList.toggle('is-collapsed', collapsed);
    const body = section.querySelector(':scope > .body');
    if (body) body.hidden = collapsed;
    const button = section.querySelector(':scope > .head > .folder-toggle, :scope > .sub-head > .folder-toggle');
    if (button) {
      button.setAttribute('aria-expanded', String(!collapsed));
      const title = section.querySelector(':scope > .head .title, :scope > .sub-head .title')?.textContent || '文件夹';
      button.title = `${collapsed ? '展开' : '收起'}「${title}」`;
      button.setAttribute('aria-label', button.title);
    }
  }
  function initFold(section, f) {
    section.classList.toggle('inbox-folder', isInbox(f));
    section.querySelector(':scope > .body').id = 'folder-body-' + f.id;
    paintFold(section, folderCollapsed(f));
  }
  async function toggleFolder(section) {
    const f = findNode(section.dataset.id); if (!f) return;
    const key = foldKey(f), previous = prefs.folderCollapsed[key];
    const collapsed = !section.classList.contains('is-collapsed');
    prefs.folderCollapsed[key] = collapsed;
    paintFold(section, collapsed);
    try { await store.prefs.set({ folderCollapsed: prefs.folderCollapsed }); }
    catch {
      if (previous === undefined) delete prefs.folderCollapsed[key]; else prefs.folderCollapsed[key] = previous;
      paintFold(section, !collapsed); toast('折叠状态保存失败，请重试');
    }
  }
  function revealFolder(id) {
    const section = document.getElementById('sec-' + id); if (!section) return;
    // 定位仅临时展开，不覆盖用户保存的折叠偏好。
    for (let el = section; el; el = el.parentElement?.closest('.card, .sub')) paintFold(el, false);
    if (search.value) { search.value = ''; renderSearch(); }
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function markLevel(el, level) {
    el.dataset.level = level;
    el.style.setProperty('--level-color', LEVEL_COLORS[(level - 1) % LEVEL_COLORS.length]);
  }
  function bodyEl(f, onlyUrls = false, level = 1) {
    const body = document.createElement('div');
    body.className = 'body'; body.dataset.folder = f.id;
    for (const c of deprecatedLast(f.children || [])) {
      if (c.url) body.appendChild(tileEl(c));
      else if (!onlyUrls) body.appendChild(subEl(c, level + 1));
    }
    body.appendChild(addTile(f.id));
    return body;
  }

  function headEl(f, cls, opts = {}) {
    const head = document.createElement('div');
    head.className = cls; head.draggable = false;
    const color = groupColor(f.title);
    const counts = tagCounts(f);
    const gf = groupFilter.get(f.id) || new Set();
    head.innerHTML =
      (opts.fixed ? '' : levelMark(opts.level || 1) + `<button class="folder-toggle" type="button" aria-controls="folder-body-${f.id}" aria-expanded="true"><svg viewBox="0 0 12 12"><path d="M3 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`) +
      (opts.fixed ? '' : `<span class="grip" draggable="true" title="拖动排序">⋮⋮</span>`) +
      `<span class="hd-name" title="${opts.fixed ? '' : '点名字改名 · 点色块换颜色'}"><span class="swatch"></span><span class="title">${esc(f.title || '（未命名）')}</span>${folderLockedByTitle(f.title) ? '<span class="lock" title="已锁定：AI 只看不动">🔒</span>' : ''}</span>` +
      (opts.fixed ? '' : `<span class="level-label">${opts.level || 1}级</span>`) +
      (isInbox(f) ? '<span class="inbox-badge">收纳</span>' : '') +
      (isDeprecated(f) ? '<span class="deprecated-badge">废弃</span>' : '') +
      (opts.tags ? `<span class="hd-subs">${deprecatedLast((f.children || []).filter((c) => !c.url)).slice(0, 6).map((c) => `<button type="button" class="subchip" data-goto="${c.id}">${esc(c.title || '（未命名）')}</button>`).join('')}</span>` : '') +
      (opts.tags ? `<span class="hd-tags">${tagList().filter((t) => counts[t.id] || gf.has(t.id)).map((t) => tagBtn(t, gf.has(t.id) ? 'on' : '') + `<span class="cnt">${counts[t.id]}</span></button>`).join('')}</span>` : '') +
      `<span class="hd-toggle"></span>` +
      `<span class="n">${countUrls(f)}</span>` +
      `<button class="more" type="button" title="更多">⋯</button>`;
    return head;
  }

  function subEl(f, level) {
    const sub = document.createElement('div');
    sub.className = 'sub'; sub.id = 'sec-' + f.id;
    sub.dataset.id = f.id; sub.dataset.kind = 'folder';
    markLevel(sub, level);
    const color = groupColor(f.title); if (color) sub.style.setProperty('--gc', color);
    sub.appendChild(headEl(f, 'sub-head', { level }));
    sub.appendChild(bodyEl(f, false, level));
    initFold(sub, f);
    return sub;
  }

  function cardEl(f, opts = {}) {
    const card = document.createElement('div');
    card.className = 'card'; card.id = 'sec-' + f.id;
    card.dataset.id = f.id; card.dataset.kind = opts.fixed ? 'bar' : 'folder';
    markLevel(card, 1);
    const color = groupColor(f.title); if (color) card.style.setProperty('--gc', color);
    card.appendChild(headEl(f, 'head', { tags: true, fixed: opts.fixed }));
    card.appendChild(bodyEl(f, !!opts.fixed));
    if (!opts.fixed) initFold(card, f);
    return card;
  }

  // ── 整理文件夹：所有文件夹摊成一排，左右拖动改顺序（侧栏太长，从底往上拖没法弄） ──
  function fchipEl(f, parentId, lv) {
    const c = document.createElement('span');
    c.className = 'fchip' + (lv > 1 ? ' sm' : '');
    c.draggable = true;
    c.dataset.id = f.id; c.dataset.parent = parentId; c.dataset.kind = 'folder'; c.dataset.lv = lv;
    markLevel(c, lv);
    const col = groupColor(f.title); if (col) c.style.setProperty('--gc', col);
    c.innerHTML = levelMark(lv) + `<i class="swatch"></i><b class="title">${esc(f.title || '（未命名）')}</b>${folderLockedByTitle(f.title) ? '<em class="lk">🔒</em>' : ''}<u>${countUrls(f)}</u><span class="finto" title="拖到这里，放进这个文件夹" data-folder="${f.id}">↳</span>`;
    if (isDeprecated(f)) c.querySelector('.title').insertAdjacentHTML('afterend', '<span class="deprecated-badge">废弃</span>');
    c.title = '拖动改顺序 · 点一下跳到那一组 · 右键改名/换色';
    return c;
  }
  function renderOrganize() {
    const box = $('#organize');
    const expanded = new Set($$('.forg-deeper[open]', box).map((el) => el.dataset.id));
    box.innerHTML = '';
    const folders = deprecatedLast((bar.children || []).filter((f) => !f.url));
    const tip = document.createElement('p'); tip.className = 'forg-tip';
    tip.textContent = '拖到文件夹左右两侧改顺序；拖到 ↳ 放进该文件夹；拖回一级分组那排可提升为一级。保留所有层级，改动直接写回书签栏。';
    box.appendChild(tip);

    const h1 = document.createElement('div'); h1.className = 'forg-h'; h1.innerHTML = `一级分组 <span class="n">${folders.length}</span>`;
    const r1 = document.createElement('div'); r1.className = 'frow lv1'; r1.dataset.parent = bar.id;
    folders.forEach((f) => r1.appendChild(fchipEl(f, bar.id, 1)));
    box.append(h1, r1);

    const appendRow = (container, f, level, path) => {
      const wrap = document.createElement('div'); wrap.className = 'fgrp';
      markLevel(wrap, level);
      const color = groupColor(f.title); if (color) wrap.style.setProperty('--gc', color);
      const lab = document.createElement('span'); lab.className = 'fgrp-lab';
      lab.textContent = path; lab.title = path;
      const row = document.createElement('div'); row.className = 'frow lv2'; row.dataset.parent = f.id;
      deprecatedLast((f.children || []).filter((c) => !c.url)).forEach((sf) => row.appendChild(fchipEl(sf, f.id, level)));
      wrap.append(lab, row); container.appendChild(wrap);
    };
    const hasSubs = folders.filter((f) => (f.children || []).some((c) => !c.url));
    const noSubs = folders.filter((f) => !(f.children || []).some((c) => !c.url));
    if (hasSubs.length) {
      const h2 = document.createElement('div'); h2.className = 'forg-h'; h2.innerHTML = `二级文件夹 <span class="n">${hasSubs.length} 组里有</span>`;
      box.appendChild(h2);
      hasSubs.forEach((f) => {
        appendRow(box, f, 2, f.title || '（未命名）');
        const deeper = document.createElement('details'); deeper.className = 'forg-deeper';
        deeper.dataset.id = f.id; deeper.open = expanded.has(f.id);
        const summary = document.createElement('summary');
        summary.textContent = `${f.title || '（未命名）'} · 第3级及以下`;
        deeper.appendChild(summary);
        const walk = (parent, level, path) => {
          for (const child of deprecatedLast(parent.children || [])) {
            if (child.url || !(child.children || []).some((c) => !c.url)) continue;
            const nextPath = `${path} / ${child.title || '（未命名）'}`;
            appendRow(deeper, child, level + 1, nextPath);
            walk(child, level + 1, nextPath);
          }
        };
        walk(f, 2, f.title || '（未命名）');
        if (deeper.children.length > 1) box.appendChild(deeper);
      });
    }
    if (noSubs.length) {
      const h3 = document.createElement('div'); h3.className = 'forg-h'; h3.innerHTML = `还没有子文件夹的组 <span class="n">拖一个子夹到框里就进去了</span>`;
      const wrap = document.createElement('div'); wrap.className = 'fdrops';
      noSubs.forEach((f) => {
        const d = document.createElement('span'); d.className = 'frow lv2 mini'; d.dataset.parent = f.id;
        const col = groupColor(f.title); if (col) d.style.setProperty('--gc', col);
        d.textContent = f.title || '（未命名）';
        wrap.appendChild(d);
      });
      box.append(h3, wrap);
    }
  }
  function toggleOrganize(on) {
    const box = $('#organize');
    const show = on === undefined ? box.hidden : on;
    box.hidden = !show;
    $('#groups').hidden = show;
    $('#recent').hidden = show;
    if (show) { clearDomHl(); renderOrganize(); }
    else $('#empty').hidden = (bar.children || []).length > 0;
    $('#organize-btn').classList.toggle('on', show);
    if (show) $('#empty').hidden = true;
  }
  $('#organize-btn').addEventListener('click', () => toggleOrganize());
  $('#organize').addEventListener('click', (e) => {
    e.stopPropagation();
    const c = e.target.closest('.fchip'); if (!c || dragJustHappened) return;
    toggleOrganize(false);
    revealFolder(c.dataset.id);
  });
  $('#organize').addEventListener('contextmenu', (e) => {
    const c = e.target.closest('.fchip');
    e.preventDefault(); e.stopPropagation();
    if (c) openMenu(folderMenu(c), e.clientX, e.clientY);
  });

  // ── 同域名联动高亮：鼠标停在一条上，同一个主域的全都点亮同一个色 ──
  let domHl = '';
  function clearDomHl() {
    $$('#main .tile.peer').forEach((t) => { t.classList.remove('peer'); t.style.removeProperty('--ph'); });
    domHl = '';
  }
  function setDomHl(d) {
    if (d === domHl) return;
    clearDomHl();
    if (!d) return;
    const peers = $$(`#main .tile[data-dom="${CSS.escape(d)}"]:not(.filtered)`);
    if (peers.length < 2) return;                       // 只有一条就不用点了
    domHl = d;
    peers.forEach((t) => { t.classList.add('peer'); t.style.setProperty('--ph', hue(d)); });
  }
  $('#main').addEventListener('mouseover', (e) => {
    const t = e.target.closest?.('.tile[data-dom]');
    setDomHl(t ? t.dataset.dom : '');
  });
  $('#main').addEventListener('mouseleave', clearDomHl);

  function render() {
    const groups = $('#groups');
    groups.innerHTML = '';
    const kids = deprecatedLast(bar.children || []);
    const loose = kids.filter((k) => k.url), folders = kids.filter((k) => !k.url);
    folders.filter(f => !isDeprecated(f)).forEach((f) => groups.appendChild(cardEl(f)));
    if (loose.length) groups.appendChild(cardEl({ id: bar.id, title: '未分组', children: loose }, { fixed: true }));
    folders.filter(f => isDeprecated(f)).forEach((f) => groups.appendChild(cardEl(f)));
    $('#empty').hidden = kids.length > 0;
    $('#total').textContent = `${flat.length} 条 · ${folders.length} 组`;
    domHl = '';
    if (!$('#organize').hidden) renderOrganize();
    renderTagDefs();
    applyFilters();
    renderSide(folders, loose.length ? bar.id : null);
    if (search.value.trim()) renderSearch();
    renderRecent();
  }

  // ── 侧边栏：只列前两级；更深层滚动时高亮所属的二级 ──
  let sideObserver = null;
  function renderSide(folders, looseId) {
    const list = $('#side-list'); list.innerHTML = '';
    const add = (f, depth, parentId) => {
      const d = document.createElement('div');
      d.className = 'side-item d' + depth; d.dataset.id = f.id; d.dataset.parent = parentId; d.dataset.kind = f.id === bar.id ? 'bar' : 'folder';
      d.draggable = f.id !== bar.id;
      markLevel(d, depth + 1);
      const color = groupColor(f.title); if (color) d.style.setProperty('--gc', color);
      d.classList.toggle('inbox-folder', isInbox(f));
      d.innerHTML = levelMark(depth + 1) + `<span class="nm">${esc(f.title || '（未命名）')}${folderLockedByTitle(f.title) ? ' 🔒' : ''}</span><span class="ct">${countUrls(f)}</span>`;
      if (isDeprecated(f)) d.querySelector('.nm').insertAdjacentHTML('afterend', '<span class="deprecated-badge">废弃</span>');
      d.title = f.title; d.dataset.name = (f.title || '').toLowerCase();
      list.appendChild(d);
      if (depth < 1) for (const c of deprecatedLast(f.children || [])) if (!c.url) add(c, depth + 1, f.id);
    };
    for (const f of folders.filter(f => !isDeprecated(f))) add(f, 0, bar.id);
    if (looseId) add({ id: bar.id, title: '未分组', children: [] }, 0, bar.id);
    for (const f of folders.filter(f => isDeprecated(f))) add(f, 0, bar.id);
    if (sideObserver) sideObserver.disconnect();
    const visible = new Set();
    sideObserver = new IntersectionObserver((entries) => {
      for (const e of entries) { if (e.isIntersecting) visible.add(e.target); else visible.delete(e.target); }
      const vis = [...visible].filter((el) => el.isConnected).sort((x, y) => x.getBoundingClientRect().top - y.getBoundingClientRect().top);
      if (!vis.length) return;
      const el = vis[0];
      let navSection = el;
      while (Number(navSection.dataset.level) > 2) navSection = navSection.parentElement.closest('.card, .sub');
      const id = navSection.dataset.id;
      const topCard = el.closest('.card'); const topId = topCard ? topCard.dataset.id : id;
      $$('.side-item').forEach((s) => {
        s.classList.toggle('active', s.dataset.id === id);
        if (s.classList.contains('d1')) s.classList.toggle('show', s.dataset.parent === topId);
      });
      const act = $('.side-item.active'); if (act) act.scrollIntoView({ block: 'nearest' });
    }, { rootMargin: '-60px 0px -70% 0px', threshold: 0 });
    $$('.card, .sub').forEach((el) => sideObserver.observe(el));
  }
  $('#side-list').addEventListener('click', (e) => {
    const it = e.target.closest('.side-item'); if (!it) return;
    revealFolder(it.dataset.id);
  });
  $('#side-list').addEventListener('contextmenu', (e) => {
    const it = e.target.closest('.side-item'); if (!it) return;
    const box = document.getElementById('sec-' + it.dataset.id); if (!box) return;
    e.preventDefault(); openMenu(folderMenu(box), e.clientX, e.clientY);
  });

  // ── 标签组（说明区）──
  function renderTagDefs() {
    const box = $('#intro-tags'); box.innerHTML = '';
    for (const t of tagList()) {
      box.insertAdjacentHTML('beforeend', tagBtn(t, globalFilter.has(t.id) ? 'on' : '') + `<span><i>${esc(t.name)}</i><em>${esc(t.desc || '')}</em></span></button>`);
    }
    if (tagList().length < MAX_TAGS) box.insertAdjacentHTML('beforeend', `<button type="button" class="tag addtag" id="add-tag"><b style="background:transparent;color:inherit">＋</b><span><i style="color:inherit">加一个标签</i></span></button>`);
  }
  $('#intro-tags').addEventListener('click', (e) => {
    if (e.target.closest('#add-tag')) { editTag(null); return; }
    const b = e.target.closest('.tag'); if (!b) return;
    const t = b.dataset.tag;
    if (globalFilter.has(t)) globalFilter.delete(t); else globalFilter.add(t);
    applyFilters();
  });
  $('#intro-tags').addEventListener('contextmenu', (e) => {
    const b = e.target.closest('.tag[data-tag]'); if (!b) return;
    e.preventDefault();
    const t = tagDef(b.dataset.tag);
    openMenu([
      { t: `编辑「${t.glyph} ${t.name}」…`, f: () => editTag(t.id) },
      { t: `只看「${t.name}」`, f: () => { globalFilter.clear(); globalFilter.add(t.id); applyFilters(); } },
    ], e.clientX, e.clientY);
  });
  async function editTag(id) {
    const cur = id ? tagDef(id) : { glyph: '', name: '', desc: '', color: PALETTE[tagList().length % PALETTE.length] };
    const r = await tagDialog(cur, !!id);
    if (!r) return;
    if (r.delete) {
      if (!confirm(`删除标签「${cur.glyph} ${cur.name}」？已打了这个标签的书签会去掉它，书签本身不动。`)) return;
      meta.tags = meta.tags.filter((t) => t.id !== id);
      for (const [k, v] of Object.entries(meta.items)) { if (v.tags?.includes(id)) { v.tags = v.tags.filter((x) => x !== id); if (!v.tags.length && !v.desc && !v.icon && !v.name) delete meta.items[k]; } }
      for (const g of Object.values(meta.groups)) if (g.tags?.includes(id)) { g.tags = g.tags.filter((x) => x !== id); if (!g.tags.length) delete g.tags; }
      globalFilter.delete(id); groupFilter.forEach((s) => s.delete(id));
    } else if (id) {
      Object.assign(cur, r);
    } else {
      meta.tags.push({ id: 't' + Date.now().toString(36), ...r });
    }
    saveMeta(); render();
  }
  const dlgTag = $('#dlg-tag');
  function tagDialog(cur, existing) {
    return new Promise((resolve) => {
      $('#dlg-tag-title').textContent = existing ? '编辑标签' : '新标签';
      $('#tag-glyph').value = cur.glyph; $('#tag-name').value = cur.name; $('#tag-desc').value = cur.desc || '';
      let color = cur.color;
      const pal = $('#tag-palette'); pal.innerHTML = '';
      for (const c of PALETTE) { const s = document.createElement('span'); s.style.background = c; s.classList.toggle('on', c === color); s.onclick = () => { color = c; $$('span', pal).forEach((x) => x.classList.toggle('on', x === s)); }; pal.appendChild(s); }
      $('#tag-delete').hidden = !existing;
      const form = $('#dlg-tag-form');
      const done = (v) => { dlgTag.close(); form.onsubmit = null; $('#tag-cancel').onclick = null; $('#tag-delete').onclick = null; dlgTag.onclose = null; resolve(v); };
      form.onsubmit = (e) => {
        e.preventDefault();
        const glyph = $('#tag-glyph').value.trim().slice(0, 2), name = $('#tag-name').value.trim();
        if (!glyph || !name) { toast('「一个字」和「名称」都要填'); return; }
        done({ glyph, name, desc: $('#tag-desc').value.trim(), color });
      };
      $('#tag-cancel').onclick = () => done(null);
      $('#tag-delete').onclick = () => done({ delete: true });
      dlgTag.onclose = () => done(null);
      dlgTag.showModal(); $('#tag-glyph').focus();
    });
  }

  // ── 筛选 ──
  function applyFilters() {
    $$('#intro-tags .tag[data-tag]').forEach((b) => b.classList.toggle('on', globalFilter.has(b.dataset.tag)));
    $('#filter-clear').hidden = !globalFilter.size && ![...groupFilter.values()].some((s) => s.size);
    for (const card of $$('.card')) {
      const gf = groupFilter.get(card.dataset.id) || new Set();
      const active = new Set([...globalFilter, ...gf]);
      let visible = 0;
      for (const t of $$('.tile:not(.add)', card)) {
        const n = flat.find((b) => b.id === t.dataset.id);
        const tags = n ? effectiveTags(n) : [];
        const ok = !active.size || (prefs.filterMode === 'or' ? [...active].some((x) => tags.includes(x)) : [...active].every((x) => tags.includes(x)));
        t.classList.toggle('filtered', !ok);
        if (ok) visible++;
      }
      for (const sub of $$('.sub', card).reverse()) {
        const any = $$('.tile:not(.add):not(.filtered)', sub).length > 0;
        sub.classList.toggle('filtered', active.size > 0 && !any);
      }
      card.classList.toggle('filtered', globalFilter.size > 0 && visible === 0);
      for (const section of [card, ...$$('.sub', card)]) {
        if (section.dataset.kind === 'bar') continue;
        const f = findNode(section.dataset.id);
        if (f) paintFold(section, active.size && !section.classList.contains('filtered') ? false : folderCollapsed(f));
      }
    }
  }
  $('#filter-clear').addEventListener('click', () => { globalFilter.clear(); groupFilter.clear(); render(); });
  $('#filter-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; prefs.filterMode = b.dataset.val; $$('#filter-mode button').forEach((x) => x.classList.toggle('on', x === b)); savePrefs(); applyFilters(); });
  $$('#filter-mode button').forEach((x) => x.classList.toggle('on', x.dataset.val === prefs.filterMode));

  // ── 最近访问 ──
  let recentRender = 0;
  async function renderRecent() {
    const request = ++recentRender;
    const items = deprecatedLast(await store.recent(16));
    if (request !== recentRender) return;
    const box = $('#recent-body'); box.innerHTML = '';
    $('#recent').hidden = !!search.value.trim() || !items.length;
    for (const it of items) {
      const a = document.createElement('a'); a.className = 'pill'; a.href = it.url; a.target = '_blank'; a.title = `${it.title}\n${it.url}`;
      a.appendChild(copyLogo(it));
      const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = it.title || host(it.url); a.appendChild(nm);
      box.appendChild(a);
    }
  }
  $('#recent-head').addEventListener('click', () => {
    prefs.recentCollapsed = !prefs.recentCollapsed; applyPrefs(); savePrefs();
  });

  // ── 搜索 ──
  const search = $('#search');
  function renderSearch() {
    const q = search.value.trim().toLowerCase();
    const results = $('#results');
    const showing = !!q;
    $('#groups').hidden = showing; $('#recent').hidden = showing || !$('#recent-body').children.length; results.hidden = !showing;
    if (!showing) { results.innerHTML = ''; return; }
    const terms = q.split(/\s+/);
    const hits = deprecatedLast(flat.filter((b) => {
      const m = itemMeta(b.url);
      const hay = `${m.name || ''} ${b.title} ${b.url} ${b.path} ${m.desc || ''} ${effectiveTags(b).map((t) => (tagDef(t) || {}).name || '').join(' ')}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    }), true).slice(0, 200);
    results.innerHTML = '';
    if (!hits.length) { results.innerHTML = '<div class="none">没有匹配的书签</div>'; return; }
    hits.forEach((b, i) => {
      const a = document.createElement('a');
      a.className = 'tile' + (i === 0 ? ' first' : '');
      a.href = b.url; a.target = '_blank'; a.dataset.id = b.id; a.dataset.kind = 'url';
      a.title = `${label(b)}\n${b.url}`;
      a.appendChild(copyLogo(b));
      const txt = document.createElement('span'); txt.className = 'txt';
      const l1 = document.createElement('span'); l1.className = 'line1';
      l1.innerHTML = `<span class="name">${esc(label(b))}</span>`; l1.appendChild(tagChips(itemMeta(b.url).tags)); txt.appendChild(l1);
      if (!isDeprecated(b) && isDeprecated(b, true)) l1.insertAdjacentHTML('beforeend', '<span class="deprecated-badge" title="所属文件夹已标记废弃">废弃</span>');
      txt.innerHTML += `<span class="desc">${esc(b.path || '未分组')} · ${esc(host(b.url))}</span>`;
      a.appendChild(txt);
      a.appendChild(detailArrow(b.id));
      if (selectedId === b.id) a.classList.add('selected');
      results.appendChild(a);
    });
  }
  search.addEventListener('input', renderSearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; renderSearch(); search.blur(); }
    if (e.key === 'Enter') {
      const first = $('#results .tile.first');
      if (first) location.href = first.href;
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest?.('.folder-toggle') && (e.key === ' ' || e.key === 'Enter')) return;
    const inField = /^(INPUT|TEXTAREA)$/.test(e.target.tagName) || e.target.isContentEditable || $('#dlg').open;
    if (inField) return;
    if (e.key === '/') { e.preventDefault(); search.focus(); search.select(); return; }
    if (e.key === 'Escape' && selectedId) { closeDetail(); return; }
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) search.focus();
  });

  // ── 工具栏 ──
  $$('.seg').forEach((seg) => seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    prefs[seg.dataset.key] = b.dataset.val;
    applyPrefs(); savePrefs();
  }));
  $('#new-group').addEventListener('click', async () => {
    const r = await dialog({ title: '新分组', name: '', showUrl: false, ok: '创建' });
    if (r && r.name.trim()) await store.create({ parentId: bar.id, title: r.name.trim() });
  });
  $('#backup-btn').addEventListener('click', () => window.open('backup.html', '_blank'));
  $('#more-btn').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openMenu([
      { t: '导出附属数据（标签／说明／颜色）', f: exportMeta },
      { t: '导入附属数据…', f: () => $('#import-file').click() },
      { t: 'emoji 兜底库…', f: editEmojiRules },
      null,
      { t: `标签 ${meta.tags.length} 个 · 有附属数据的书签 ${Object.keys(meta.items).length} 条 · 组颜色 ${Object.keys(meta.groups).length} 个`, f: () => {} },
    ], r.right - 260, r.bottom + 6);
  });
  const dlgEmoji = $('#dlg-emoji');
  function editEmojiRules() {
    $('#emoji-rules').value = meta.emojiRules;
    const form = $('#dlg-emoji-form');
    const done = () => { dlgEmoji.close(); form.onsubmit = null; $('#emoji-cancel').onclick = null; $('#emoji-reset').onclick = null; };
    form.onsubmit = (e) => { e.preventDefault(); meta.emojiRules = $('#emoji-rules').value; emojiRules = parseEmojiRules(meta.emojiRules); saveMeta(); done(); render(); renderRecent(); toast(`emoji 兜底库：${emojiRules.length} 条规则`); };
    $('#emoji-cancel').onclick = done;
    $('#emoji-reset').onclick = () => { $('#emoji-rules').value = DEFAULT_EMOJI_RULES; };
    dlgEmoji.showModal();
  }
  function exportMeta() {
    const blob = new Blob([JSON.stringify({ v: 1, exportedAt: new Date().toISOString(), ...meta }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `书签首页-附属数据-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  $('#import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (!d.items && !d.groups) throw new Error('不是附属数据文件');
      meta.items = { ...meta.items, ...(d.items || {}) };
      meta.groups = { ...meta.groups, ...(d.groups || {}) };
      for (const t of d.tags || []) { const cur = tagDef(t.id); if (cur) Object.assign(cur, t); else if (meta.tags.length < MAX_TAGS) meta.tags.push(t); }
      if (typeof d.emojiRules === 'string') { meta.emojiRules = d.emojiRules; emojiRules = parseEmojiRules(meta.emojiRules); }
      await saveMeta(); render(); toast(`已导入：${Object.keys(d.items || {}).length} 条标签／说明，${Object.keys(d.groups || {}).length} 个组颜色`);
    } catch (err) { toast('导入失败：' + err.message); }
  });

  // ── 点击 / 右键 ──
  const main = $('#main');
  let dragJustHappened = false;
  main.addEventListener('click', async (e) => {
    if (dragJustHappened) { dragJustHappened = false; return; }
    const box = e.target.closest('.card, .sub');
    if (e.target.closest('.folder-toggle')) { e.preventDefault(); await toggleFolder(box); return; }
    if (e.target.closest('.hd-tags .tag')) {
      const t = e.target.closest('.tag').dataset.tag; const id = box.dataset.id;
      const s = groupFilter.get(id) || new Set(); if (s.has(t)) s.delete(t); else s.add(t);
      if (s.size) groupFilter.set(id, s); else groupFilter.delete(id);
      $$('.hd-tags .tag', box).forEach((b) => b.classList.toggle('on', s.has(b.dataset.tag)));
      applyFilters(); return;
    }
    if (e.target.closest('.subchip')) { revealFolder(e.target.closest('.subchip').dataset.goto); return; }
    if (e.target.closest('.swatch')) { openMenu(colorMenu(box), e.clientX, e.clientY); return; }
    if (e.target.closest('.hd-name')) { if (box.dataset.kind !== 'bar') inlineRename(box.querySelector('.title')); return; }
    const more = e.target.closest('.more');
    if (more) { e.preventDefault(); openMenu(folderMenu(box), e.clientX, e.clientY); return; }
    const strip = e.target.closest('.strip');
    if (strip) { e.preventDefault(); e.stopPropagation(); openDetail(strip.closest('.tile').dataset.id, null, true); return; }
    const add = e.target.closest('.tile.add');
    if (add) { openDetail(null, add.dataset.folder); return; }
  });
  main.addEventListener('contextmenu', (e) => {
    const tile = e.target.closest('.tile:not(.add)');
    if (tile) { e.preventDefault(); openMenu(urlMenu(tile.dataset.id), e.clientX, e.clientY); return; }
    if (e.target.closest('.swatch')) { e.preventDefault(); openMenu(colorMenu(e.target.closest('.card, .sub')), e.clientX, e.clientY); return; }
    const head = e.target.closest('.head, .sub-head');
    if (head) { e.preventDefault(); openMenu(folderMenu(head.parentElement), e.clientX, e.clientY); return; }
    const body = e.target.closest('.body');
    if (body) { e.preventDefault(); openMenu(folderMenu(body.closest('.card, .sub'), true), e.clientX, e.clientY); return; }
    if (e.target.closest('.recent, .legend')) return;
    e.preventDefault();
    openMenu([{ t: '＋ 新分组', f: () => $('#new-group').click() }], e.clientX, e.clientY);
  });

  function findNode(id) {
    if (id === bar.id) return bar;
    let hit = null;
    const walk = (n) => { if (hit) return; if (n.id === id) { hit = n; return; } (n.children || []).forEach(walk); };
    walk(bar);
    return hit;
  }

  function urlMenu(id) {
    const n = findNode(id); if (!n) return [];
    const m = itemMeta(n.url); const tags = m.tags || [];
    const toggleTag = (t) => () => {
      const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t].sort();
      setItemMeta(n.url, { tags: next }); render();
    };
    return [
      { t: '打开', f: () => { location.href = n.url; } },
      { t: '新标签页打开', f: () => window.open(n.url, '_blank') },
      { t: '复制地址', f: () => copyUrl(n.url) },
      null,
      ...tagList().map((t) => ({ t: `${tags.includes(t.id) ? '☑' : '☐'} 标记「${t.glyph}」${t.name}`, f: toggleTag(t.id) })),
      null,
      { t: '详情 / 编辑', f: () => openDetail(id) },
      ...(m.name ? [{ t: `用备注名替换书签名（书签栏也会变成「${m.name}」）`, f: async () => { await store.update(id, { title: m.name }); setItemMeta(n.url, { name: '' }); render(); } }] : []),
      { t: '删除', danger: true, f: () => deleteUrl(id) },
    ];
  }
  function colorMenu(box) {
    const f = findNode(box.dataset.id); if (!f || box.dataset.kind === 'bar') return [];
    const title = f.title;
    const pick = (c) => {
      const group = { ...(meta.groups[title] || {}) };
      if (c) group.color = c; else delete group.color;
      if (Object.keys(group).length) meta.groups[title] = group; else delete meta.groups[title];
      saveMeta(); render();
    };
    return [{ palette: [...PALETTE, ''], f: pick }];
  }
  function folderMenu(box, bodyOnly = false) {
    const id = box.dataset.id; const f = findNode(id); if (!f) return [];
    const isBar = box.dataset.kind === 'bar';
    const items = [
      { t: '＋ 加书签…', f: () => createIn(id) },
      { t: isBar ? '＋ 新分组…' : '＋ 新建子夹…', f: async () => {
        const r = await dialog({ title: isBar ? '新分组' : `在「${f.title}」里新建子夹`, name: '', showUrl: false, ok: '创建' });
        if (r && r.name.trim()) await store.create({ parentId: id, title: r.name.trim() });
      } },
    ];
    if (!isBar && !bodyOnly) {
      items.push(null,
        { t: isDeprecated(f) ? '取消废弃标记' : '标记为废弃（排到底部）', f: async () => {
          const definitions = deprecatedTags();
          if (!definitions.length) { toast('请先添加一个名称为「废弃」的标签'); return; }
          const group = { ...(meta.groups[f.title] || {}) };
          const tags = group.tags || [];
          group.tags = isDeprecated(f) ? tags.filter(id => !definitions.some(t => t.id === id)) : [...tags, definitions[0].id];
          if (!group.tags.length) delete group.tags;
          if (Object.keys(group).length) meta.groups[f.title] = group; else delete meta.groups[f.title];
          await saveMeta(); render();
        } },
        { t: '改名', f: () => inlineRename(box.querySelector('.title')) },
        { t: '颜色…', f: () => { const r = box.querySelector('.swatch').getBoundingClientRect(); openMenu(colorMenu(box), r.left, r.bottom + 4); } },
        { t: folderLockedByTitle(f.title) ? '🔓 解除锁定' : '🔒 锁定（AI 只看不动）', f: () => { const g = meta.groups[f.title] || {}; if (g.locked) delete g.locked; else g.locked = true; if (Object.keys(g).length) meta.groups[f.title] = g; else delete meta.groups[f.title]; saveMeta(); render(); } },
        { t: '全部在新标签打开', f: () => { (f.children || []).filter((c) => c.url).forEach((c) => window.open(c.url, '_blank')); } },
        { t: '按域名排序（写回书签栏）', f: async () => {
          const kids = await store.children(id);
          const urls = kids.filter((k) => k.url);
          const keyOf = (k) => { const d = domainParts(k.url); return [d.root, d.pre, label(k)].join('\u0000'); };
          const sorted = [...urls].sort((x, y) => keyOf(x).localeCompare(keyOf(y), 'zh'));
          for (const k of sorted) await store.move(k.id, { parentId: id, index: (await store.children(id)).length });
          toast(`「${f.title}」已按域名排好 ${sorted.length} 条`);
        } },
        { t: `删除（含 ${countUrls(f)} 条）`, danger: true, f: async () => {
          if (confirm(`删除「${f.title}」及里面的 ${countUrls(f)} 条书签？\n这会真的从书签栏删掉，并同步到别的机器。`)) await store.removeTree(id);
        } });
    }
    return items;
  }

  async function createIn(folderId) { openDetail(null, folderId); }

  let lastDeleted = null;
  async function deleteUrl(id) {
    const n = findNode(id); if (!n) return;
    lastDeleted = { parentId: n.parentId, index: n.index, title: n.title, url: n.url };
    await store.remove(id);
    toast(`已删除「${label(n)}」`, { t: '撤销', f: async () => { if (!lastDeleted) return; await store.create(lastDeleted); lastDeleted = null; } });
  }

  function inlineRename(el) {
    const box = el.closest('.card, .sub'); if (!box || box.dataset.kind === 'bar') return;
    if (el.isContentEditable) return;
    const id = box.dataset.id; const old = el.textContent;
    const head = box.querySelector('.head, .sub-head');
    el.contentEditable = 'true'; el.focus();
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    let done = false;
    const finish = async (commit) => {
      if (done) return; done = true;
      el.contentEditable = 'false';
      const v = el.textContent.trim();
      if (commit && v && v !== old) {
        if (meta.groups[old] && !meta.groups[v]) { meta.groups[v] = meta.groups[old]; delete meta.groups[old]; saveMeta(); }
        await store.update(id, { title: v });
      } else el.textContent = old;
    };
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    el.addEventListener('blur', () => finish(true), { once: true });
  }

  // 同一窗口共享原生侧栏状态；箭头切换开关，菜单始终打开详情。
  function detailArrow(id) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'strip';
    const open = detailPanelOpen && selectedId === id;
    button.title = open ? '收起详情侧栏' : '打开详情侧栏';
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(open));
    button.innerHTML = '<svg viewBox="0 0 12 12"><path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    return button;
  }
  function paintDetailState() {
    $$('.tile[data-id]').forEach((tile) => {
      const open = detailPanelOpen && tile.dataset.id === selectedId;
      tile.classList.toggle('selected', open);
      const button = tile.querySelector('.strip');
      if (button) {
        button.title = open ? '收起详情侧栏' : '打开详情侧栏';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-expanded', String(open));
      }
    });
  }
  function openDetail(id, parentId = null, toggle = false) {
    if (store.kind !== 'chrome' || !chrome.sidePanel) { toast('请在 Chrome 扩展中打开详情编辑'); return; }
    if (detailTransition) return;
    if (toggle && id && detailPanelOpen && selectedId === id) { closeDetail(); return; }
    detailTransition = true;
    // 不在 open 前 await，保持箭头点击的用户手势。
    const opening = chrome.sidePanel.open({ windowId: currentWindowId });
    const selecting = chrome.runtime.sendMessage({ type: 'EDITOR_SELECT', windowId: currentWindowId, id, parentId });
    detailSelection = { id, parentId }; selectedId = id; detailPanelOpen = true;
    paintDetailState();
    Promise.all([opening, selecting]).then(([, r]) => {
      if (!r?.ok) throw Error(r?.error || '无法载入书签');
    }).catch((e) => {
      detailPanelOpen = false; selectedId = null; paintDetailState();
      toast('侧栏打开失败：' + e.message);
    }).finally(() => { detailTransition = false; });
  }
  function closeDetail() {
    if (store.kind !== 'chrome' || detailTransition) return;
    detailTransition = true;
    chrome.sidePanel.close({ windowId: currentWindowId }).then(() => {
      detailPanelOpen = false; selectedId = null; paintDetailState();
    }).catch((e) => toast('侧栏收起失败：' + e.message))
      .finally(() => { detailTransition = false; });
  }
  if (store.kind === 'chrome') {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session') {
        const open = changes['editorOpen:' + currentWindowId];
        const selection = changes['editorSelection:' + currentWindowId];
        if (selection) detailSelection = selection.newValue;
        if (open) detailPanelOpen = !!open.newValue;
        if (open || selection) {
          selectedId = detailPanelOpen ? detailSelection?.id || null : null;
          paintDetailState();
        }
      }
      if (area === 'local') {
        if (changes.folderCollapsed) {
          const previous = prefs.folderCollapsed;
          const fresh = changes.folderCollapsed.newValue;
          prefs.folderCollapsed = fresh && typeof fresh === 'object' && !Array.isArray(fresh) ? fresh : {};
          for (const section of $$('#groups .card[data-kind="folder"], #groups .sub')) {
            const f = findNode(section.dataset.id);
            if (f && previous[foldKey(f)] !== prefs.folderCollapsed[foldKey(f)]) paintFold(section, folderCollapsed(f));
          }
        }
        let changed = false;
        for (const k of ['view', 'recentCollapsed', 'filterMode']) if (changes[k]) { prefs[k] = changes[k].newValue; changed = true; }
        if (changed) { applyPrefs(); render(); }
      }
    });
  }

  // ── 菜单 / 对话框 / 提示 ──
  const menu = $('#menu');
  function openMenu(items, x, y) {
    if (!items.length) return;
    menu.innerHTML = '';
    for (const it of items) {
      if (!it) { menu.appendChild(document.createElement('hr')); continue; }
      if (it.palette) {
        const p = document.createElement('div'); p.className = 'palette';
        for (const c of it.palette) {
          const s = document.createElement('span');
          if (c) s.style.background = c; else { s.className = 'none'; s.title = '去掉颜色'; }
          s.onclick = () => { closeMenu(); it.f(c); };
          p.appendChild(s);
        }
        menu.appendChild(p); continue;
      }
      const b = document.createElement('button'); b.type = 'button'; b.textContent = it.t;
      if (it.danger) b.className = 'danger';
      b.onclick = () => { closeMenu(); it.f(); };
      menu.appendChild(b);
    }
    menu.hidden = false;
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
    menu.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  }
  const closeMenu = () => { menu.hidden = true; };
  document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  addEventListener('scroll', closeMenu, true);

  const dlg = $('#dlg');
  function dialog({ title, alias = '', name = '', url = '', showUrl, showMeta = false, tags = [], desc = '', icon = '', ok = '保存' }) {
    return new Promise((resolve) => {
      const picked = new Set(tags);
      $('#dlg-title').textContent = title;
      $('#dlg-alias').value = alias; $('#dlg-name').value = name; $('#dlg-url').value = url; $('#dlg-desc').value = desc; $('#dlg-icon').value = icon;
      $('#dlg-alias-row').hidden = !showMeta; $('#dlg-name-lbl').textContent = showMeta ? '书签名（书签栏里的原名，改了各处都变）' : '名称';
      $('#dlg-url-row').hidden = !showUrl; $('#dlg-meta').hidden = !showMeta; $('#dlg-ok').textContent = ok;
      const tl = $('#dlg-tag-list'); tl.innerHTML = tagList().map((t) => tagBtn(t, picked.has(t.id) ? 'on' : '') + `${esc(t.name)}</button>`).join('');
      $$('.tag', tl).forEach((b) => { b.onclick = () => { const t = b.dataset.tag; if (picked.has(t)) picked.delete(t); else picked.add(t); b.classList.toggle('on', picked.has(t)); }; });
      const form = $('#dlg-form');
      const done = (v) => { dlg.close(); form.onsubmit = null; $('#dlg-cancel').onclick = null; dlg.onclose = null; resolve(v); };
      form.onsubmit = (e) => { e.preventDefault(); done({ alias: $('#dlg-alias').value, name: $('#dlg-name').value, url: $('#dlg-url').value, tags: [...picked].sort(), desc: $('#dlg-desc').value, icon: $('#dlg-icon').value }); };
      $('#dlg-cancel').onclick = () => done(null);
      dlg.onclose = () => done(null);
      dlg.showModal();
      (showUrl && !url ? $('#dlg-url') : showMeta ? $('#dlg-alias') : $('#dlg-name')).focus();
    });
  }

  let toastTimer = null;
  function toast(msg, action) {
    const t = $('#toast');
    t.innerHTML = esc(msg);
    if (action) { const b = document.createElement('button'); b.textContent = action.t; b.onclick = () => { t.hidden = true; action.f(); }; t.appendChild(b); }
    t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  // ── 拖动：位置与归属写回书签树 ──
  let drag = null;          // { id, kind, el }
  let target = null;        // { parentId, refId, pos, el, cls }
  const clearMark = () => { if (target) target.el.classList.remove(target.cls); target = null; };

  document.addEventListener('dragstart', (e) => {
    const tile = e.target.closest?.('.tile:not(.add)');
    const head = e.target.closest?.('.head, .sub-head');
    const side = e.target.closest?.('.side-item');
    const fchip = e.target.closest?.('.fchip');
    let el = null;
    if (fchip) el = fchip;
    else if (tile && !tile.closest('.results')) el = tile;
    else if (head && e.target.closest?.('.grip')) el = head.parentElement;
    else if (side && side.draggable) el = document.getElementById('sec-' + side.dataset.id) || side;
    if (!el || !el.dataset.id || el.dataset.kind === 'bar') { e.preventDefault(); return; }
    drag = { id: el.dataset.id, kind: el.dataset.kind, el };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', el.dataset.id);
    setTimeout(() => { el.classList.add('dragging'); const s = $(`.side-item[data-id="${CSS.escape(el.dataset.id)}"]`); if (s) s.classList.add('dragging'); }, 0);
  });

  function computeTarget(e) {
    const t = e.target;
    if (!(t instanceof Element)) return null;
    const isList = prefs.view === 'list';
    const side = (el, vertical) => {
      const r = el.getBoundingClientRect();
      return vertical ? (e.clientY < r.top + r.height / 2 ? 'before' : 'after') : (e.clientX < r.left + r.width / 2 ? 'before' : 'after');
    };
    const side_ = (el) => side(el, true);
    if (drag.el.classList.contains('fchip')) {                 // 整理页：只在整理页内部动
      const into = t.closest('.finto');
      if (into) return { parentId: into.dataset.folder, refId: null, el: into, cls: 'drop-into' };
      const chip = t.closest('.fchip');
      if (chip) return { parentId: chip.dataset.parent, refId: chip.dataset.id, pos: side(chip, false), el: chip, cls: 'drop-' + side(chip, false) };
      const row = t.closest('.frow');
      if (row) return { parentId: row.dataset.parent, refId: null, el: row, cls: 'drop-into' };
      return null;
    }
    const sideItem = t.closest('.side-item');
    if (sideItem) {
      if (drag.kind === 'folder' && sideItem.dataset.kind !== 'bar') {
        const pos = side_(sideItem);
        return { parentId: sideItem.dataset.parent, refId: sideItem.dataset.id, pos, el: sideItem, cls: 'drop-' + pos };
      }
      return { parentId: sideItem.dataset.id, refId: null, el: sideItem, cls: 'drop-into' };
    }
    const tile = t.closest('.tile');
    if (tile && !tile.classList.contains('add') && tile.dataset.id !== drag.id && tile.closest('.body')) {
      const pos = side(tile, isList);
      return { parentId: tile.parentElement.dataset.folder, refId: tile.dataset.id, pos, el: tile, cls: 'drop-' + pos };
    }
    const subHead = t.closest('.sub-head');
    if (subHead) {
      const sub = subHead.parentElement;
      if (drag.kind === 'folder') {
        const r = subHead.getBoundingClientRect(), y = (e.clientY - r.top) / r.height;
        if (y < .25 || y > .75) {
          const pos = y < .25 ? 'before' : 'after';
          return { parentId: findNode(sub.dataset.id).parentId, refId: sub.dataset.id, pos, el: sub, cls: 'drop-' + pos };
        }
      }
      return { parentId: sub.dataset.id, refId: null, el: sub, cls: 'drop-into' };
    }
    const head = t.closest('.head');
    if (head) {
      const card = head.parentElement;
      if (drag.kind === 'folder' && drag.el.classList.contains('card') && card.dataset.kind !== 'bar') {
        const pos = side(card, true);
        return { parentId: bar.id, refId: card.dataset.id, pos, el: card, cls: 'drop-' + pos };
      }
      return { parentId: card.dataset.id, refId: null, el: card, cls: 'drop-into' };
    }
    const body = t.closest('.body');
    if (body) return { parentId: body.dataset.folder, refId: null, el: body, cls: 'drop-into' };
    const card = t.closest('.card');
    if (card) {
      if (drag.kind === 'folder' && drag.el.classList.contains('card') && card.dataset.kind !== 'bar') {
        const pos = side(card, true);
        return { parentId: bar.id, refId: card.dataset.id, pos, el: card, cls: 'drop-' + pos };
      }
      return { parentId: card.dataset.id, refId: null, el: card, cls: 'drop-into' };
    }
    if (t.closest('#groups, #main') && drag.kind === 'folder') return { parentId: bar.id, refId: null, el: $('#groups'), cls: 'drop-into' };
    return null;
  }

  const isAncestor = (aid, bid) => { const a = findNode(aid); if (!a) return false; let hit = false; const w = (x) => { for (const c of x.children || []) { if (c.id === bid) { hit = true; return; } w(c); } }; w(a); return hit; };
  function validTarget(tg) {
    if (!tg) return false;
    if (drag.kind === 'folder' && (tg.parentId === drag.id || isAncestor(drag.id, tg.parentId))) return false;
    if (drag.el.classList.contains('fchip')) {
      if (tg.refId === drag.id) return false;
      return true;
    }
    const tgSec = tg.el.classList.contains('side-item') ? document.getElementById('sec-' + tg.el.dataset.id) : tg.el;
    if (drag.kind === 'folder' && tgSec && drag.el.contains(tgSec) && tgSec !== drag.el) return false;   // 不能进自己肚子里
    if (tg.el.classList.contains('side-item') && tg.el.dataset.id === drag.id) return false;
    if (tg.parentId === drag.id) return false;
    if (tg.el === drag.el) return false;
    return true;
  }

  document.addEventListener('dragover', (e) => {
    if (!drag) return;
    const tg = computeTarget(e);
    if (!validTarget(tg)) { clearMark(); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (target && target.el === tg.el && target.cls === tg.cls) return;
    clearMark();
    target = tg; tg.el.classList.add(tg.cls);
  });
  document.addEventListener('drop', async (e) => {
    if (!drag || !target) return;
    e.preventDefault();
    const tg = target; const d = drag;
    clearMark();
    try {
      const kids = await store.children(tg.parentId);
      let index;
      if (tg.refId) {
        index = kids.findIndex((k) => k.id === tg.refId);
        if (index < 0) index = kids.length; else if (tg.pos === 'after') index++;
      } else {
        index = kids.length;
      }
      await store.move(d.id, { parentId: tg.parentId, index });
    } catch (err) {
      toast('移动失败：' + (err.message || err));
    }
  });
  document.addEventListener('dragend', () => {
    if (drag) { drag.el.classList.remove('dragging'); $$('.side-item.dragging').forEach((s) => s.classList.remove('dragging')); dragJustHappened = true; setTimeout(() => { dragJustHappened = false; }, 50); }
    drag = null; clearMark();
  });

  // ── 起 ──
  let refreshTimer = null;
  store.onChange(() => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); });
  await refresh();
  // 给 ai.js 的接口（同页其它脚本用）
  window.BM = {
    store, key, host, label, rawLabel, domainParts, countUrls, esc,
    get bar() { return bar; }, get flat() { return flat; }, get meta() { return meta; }, get prefs() { return prefs; },
    itemMeta, setItemMeta, saveMeta, savePrefs, tagList, tagDef, findNode, refresh, render, openDetail, toast, MAX_TAGS, PALETTE, isLocked,
    parseEmojiRules, setEmojiRules(txt) { meta.emojiRules = txt; emojiRules = parseEmojiRules(txt); saveMeta(); },
  };
  if (store.kind === 'chrome') chrome.runtime.sendMessage({ type: 'APP_READY' }).catch(() => {});
  window.dispatchEvent(new Event('bm-ready'));
  if (store.kind === 'mock') $('#total').textContent += ' · 离线预览';
})();
