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
    { id: 'K', glyph: '捷', name: '快捷方式', desc: '钉在首页最上面那一组，一组最多 16 个', color: '#8e44ad' },
  ];
  // 老徐 260915：「这快捷方式这四个字也属于标签，然后我们打上这快捷方式的标签的地址 就会显示在这新的组」
  // ⇒ 它就是一个普通标签，只是首页专门给它开一组。
  // 🔴 只认书签自己身上的标签，🚫 不走 effectiveTags —— 那个会把文件夹的标签继承给里面每一条，
  //    一个夹打一下就能把几十条一起塞进来，那就不叫快捷方式了。
  const PINNED_TAG = 'K';
  const PINNED_MAX = 16;
  // 老徐 260915：「我刚才讲的是文件夹整理，不是标签组。标签组是标签组，文件夹自己也要有标签组。
  //   比如这个是『已经上线』的，我们总共有 7 个，其他都是『待整理』」
  // 🔴 这是跟书签标签完全分开的第二套名单（他拍的「完全两套，互不相干」）：
  //   存在 meta.folderTags，打在 meta.groups[名字].ftags 上。
  //   带 dim 的那个＝排到最后＋整组压淡。
  const DEFAULT_FOLDER_TAGS = [
    { id: 'F1', glyph: '定', name: '确定', desc: '定下来的分组，排在上面', color: '#002FA7' },
    { id: 'F0', glyph: '待', name: '待定', desc: '还没定，排到最后并整组压淡', color: '#8A8F98', dim: true },
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
  // 文件夹颜色：8 个带名字的固定色（老徐 260914）。🔴 改颜色走详情侧栏，🚫 不再点那根细色条 —— 太难点。
  // 老徐 260915 给的一套颜色标准。🔴 值以他给的为准，🚫 别自己调。
  // 普鲁士蓝那条他备注「笔记目前无内容」⇒ 这里先用该颜料的通行值 #003153，等他给了再换。
  const FOLDER_COLORS = [
    { c: '#002FA7', n: '克莱因蓝', rgb: '0,47,167' },
    { c: '#81D8D0', n: '蒂芙尼蓝', rgb: '129,216,208' },   // 🔴 他给的是 #81D8CF ＋ RGB(129,216,208)，两者差 1：CF＝207。按 RGB 反推是 D0，也是这颜色的通行值 ⇒ 取 #81D8D0
    { c: '#003153', n: '普鲁士蓝', rgb: '0,49,83' },
    { c: '#B05923', n: '提香红', rgb: '176,89,35' },
    { c: '#E60000', n: '中国红', rgb: '230,0,0' },
    { c: '#900021', n: '勃艮第红', rgb: '144,0,33' },
    { c: '#FBD26A', n: '申布伦黄', rgb: '251,210,106' },
    { c: '#8F4B28', n: '凡戴克棕', rgb: '143,75,40' },
  ];
  const PALETTE = FOLDER_COLORS.map((x) => x.c);   // 标签那边还按这个挑默认色

  // ── 本机偏好 ──
  // 🔴 chrome.storage.local.get(对象) 只返回对象里列出的键 ⇒ 不在这张表里的偏好写得进去、读不回来，
  //    每开一个新标签页就退回默认。folderView / inboxIndex 曾经漏在这儿（260914 核实官查出）。
  const DEFAULTS = { view: 'card', recentCollapsed: false, filterMode: 'and', folderCollapsed: {}, folderView: {}, inboxIndex: 0, recentNote: undefined, inboxNote: undefined, pinnedNote: undefined, foldDefault: 'auto', orgCols: 3, pinnedCollapsed: false, deckTab: 'web', deckCollapsed: false, webEngine: 'baidu' };
  // 工作台这一块的四页。老徐 260915：「在这个区域顶部横排一列标签，把这些功能都整合到这一整块里面」
  // 老徐 260915 定的顺序：搜索最左 → 快捷方式 → 收集箱 → 最近访问，四段各一个颜色、铺满一整行
  const DECK_TABS = [
    { k: 'web',    t: '搜索',     note: '',          c: '#2f6fdb', e: '🔍' },
    { k: 'pinned', t: '快捷方式', note: '__pinned',  c: '#8e44ad', e: '📌' },
    { k: 'inbox',  t: '收集箱',   note: 'bar',       c: '#e07a2f', e: '📥' },
    { k: 'recent', t: '最近访问', note: '__recent',  c: '#1f9d55', e: '🕘' },
  ];
  // 老徐 260915 点名要这八个；知乎／小红书／抖音他说先不要
  const WEB_ENGINES = [
    { k: 'baidu',   t: '百度',    u: 'https://www.baidu.com/s?wd=' },
    { k: 'bing',    t: '必应',    u: 'https://www.bing.com/search?q=' },
    { k: 'google',  t: '谷歌',    u: 'https://www.google.com/search?q=' },
    { k: 'sogou',   t: '搜狗',    u: 'https://www.sogou.com/web?query=' },
    { k: 'bili',    t: 'B站',     u: 'https://search.bilibili.com/all?keyword=' },
    { k: 'youtube', t: 'YouTube', u: 'https://www.youtube.com/results?search_query=' },
    { k: 'github',  t: 'GitHub',  u: 'https://github.com/search?q=' },
    { k: 'x',       t: 'Twitter', u: 'https://x.com/search?q=' },
  ];
  // 名单增删过之后，存着的那个可能已经没了 ⇒ 回落到第一个，否则一个都不亮、搜出来也不知道用的哪家
  const curEngine = () => WEB_ENGINES.find((x) => x.k === prefs.webEngine) || WEB_ENGINES[0];
  let prefs = await store.prefs.get(DEFAULTS);
  // 老版本那个 bug 留下的字面量 'undefined' 键，清掉；它还会被带进备份文件
  try { if (chrome?.storage?.local) chrome.storage.local.remove('undefined'); } catch {}
  if (!prefs.folderCollapsed || typeof prefs.folderCollapsed !== 'object' || Array.isArray(prefs.folderCollapsed)) prefs.folderCollapsed = {};
  if (!['list', 'detail'].includes(prefs.view)) prefs.view = 'card';   // card＝紧凑 · detail＝详细 · list＝列表
  // 老徐 260914：「紧凑 / 详细」要能在每个文件夹上单独点。顶栏那组管全部（会清掉各夹自己的选择），夹上那颗只管这一夹。
  if (!prefs.folderView || typeof prefs.folderView !== 'object' || Array.isArray(prefs.folderView)) prefs.folderView = {};
  for (const [k, v] of Object.entries(prefs.folderView)) if (!['card', 'detail', 'list'].includes(v)) delete prefs.folderView[k];
  const viewFor = (id) => prefs.folderView[id] || prefs.view;
  // 收集箱排在第几个组：老徐 260914「放到哪个地方我自己知道就行」。只是显示位置，这台浏览器自己记，🚫 不动书签树
  if (!Number.isInteger(prefs.inboxIndex) || prefs.inboxIndex < 0) prefs.inboxIndex = 0;
  const viewName = (v) => ({ card: '紧凑', detail: '详细', list: '列表' })[v] || '紧凑';
  function applyPrefs() {
    for (const el of $$('.card, #deck')) el.dataset.view = viewFor(el.dataset.id || '__deck');
    for (const b of $$('.hd-view')) b.textContent = viewName(viewFor(b.dataset.viewof));
    $$('.seg').forEach((seg) => $$('button', seg).forEach((b) => b.classList.toggle('on', b.dataset.val === String(prefs[seg.dataset.key]))));
    // 工作台整块一个折叠状态（老徐 260915：「这一整块同样是可以折叠的」）
    const dc = !!prefs.deckCollapsed, deck = $('#deck');
    if (deck) {
      deck.classList.toggle('collapsed', dc);
      deck.classList.toggle('is-collapsed', dc);   // 跟下面的文件夹同一套类名，样式一份就够
      $('#deck-head .folder-toggle')?.setAttribute('aria-expanded', String(!dc));
      $('#deck-body').hidden = dc;
      // 🔴 这儿不能调 deckTab()：applyPrefs 在它声明之前就被调用了，一调就撞暂时性死区、整页白屏
      $('#deck-note').hidden = dc || prefs.deckTab === 'web';
    }
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
  const { esc, key, host, domainParts, countUrls } = BmCore;   // 派生逻辑跟侧栏共用一份
  const tagList = () => meta.tags;
  const tagDef = (id) => meta.tags.find((t) => t.id === id);
  // ── 文件夹那一套（跟上面那套互不相干）──
  const fTagList = () => (meta.folderTags ||= DEFAULT_FOLDER_TAGS.map((t) => ({ ...t })));
  const fTagDef = (id) => fTagList().find((t) => t.id === id);
  const folderTagIds = (f) => (f && !f.url && meta.groups[f.title]?.ftags) || [];
  function setFolderTags(f, ids) {
    const g = (meta.groups[f.title] ||= {});
    if (ids && ids.length) g.ftags = [...new Set(ids)]; else delete g.ftags;
    if (!Object.keys(g).length) delete meta.groups[f.title];
    saveMeta(); render();
  }
  // 🔴 「排到最后＋压淡」现在只看文件夹自己那套标签里带 dim 的那个，🚫 不再硬匹配名字、也🚫 不掺和书签标签
  const deprecatedTags = () => fTagList().filter((t) => t.dim);
  // 老数据：他之前是拿书签标签（名叫「废弃」）标文件夹的 ⇒ 把那些搬到文件夹标签上来，🚫 别让他的标记凭空消失
  function migrateFolderTags() {
    let changed = false;
    if (!meta.folderTags) { meta.folderTags = DEFAULT_FOLDER_TAGS.map((t) => ({ ...t })); changed = true; }
    // 上一版默认叫「已上线／待整理」，老徐 260915 改口叫「确定／待定」并给了配色 ⇒ 他没自己改过的就跟着换
    for (const d of DEFAULT_FOLDER_TAGS) {
      const cur = meta.folderTags.find((t) => t.id === d.id);
      if (!cur) { meta.folderTags.push({ ...d }); changed = true; continue; }
      if (['已上线', '待整理'].includes(cur.name?.trim()) && cur.name !== d.name) {
        Object.assign(cur, { name: d.name, glyph: d.glyph, desc: d.desc, color: d.color }); changed = true;
      }
    }
    const dimId = meta.folderTags.find((t) => t.dim)?.id;
    const oldIds = new Set((meta.tags || []).filter((t) => t.dim || ['废弃', '待整理'].includes(t.name?.trim())).map((t) => t.id));
    if (dimId && oldIds.size) {
      for (const g of Object.values(meta.groups || {})) {
        if (!g.tags?.some((id) => oldIds.has(id))) continue;
        g.ftags = [...new Set([...(g.ftags || []), dimId])];
        g.tags = g.tags.filter((id) => !oldIds.has(id));
        if (!g.tags.length) delete g.tags;
        changed = true;
      }
    }
    return changed;
  }
  function effectiveTags(n) {
    const ids = new Set(n.url ? itemMeta(n.url).tags || [] : []);
    for (let node = n.url ? findNode(n.parentId) : n; node; node = node.parentId ? findNode(node.parentId) : null) {
      for (const id of meta.groups[node.title]?.tags || []) ids.add(id);
    }
    return [...ids];
  }
  // 只有文件夹会被标成「待整理」；一条书签算不算，看它所在的夹（includeParents 时）
  function isDeprecated(n, includeParents = false) {
    const ids = new Set(deprecatedTags().map((t) => t.id));
    if (!ids.size) return false;
    for (let node = n; node; node = node.parentId ? findNode(node.parentId) : null) {
      if (!node.url && (meta.groups[node.title]?.ftags || []).some((id) => ids.has(id))) return true;
      if (!includeParents && node === n) { if (n.url) continue; return false; }
    }
    return false;
  }
  // 徽章上写标签自己的名字（他改成「待整理」就显示「待整理」），🚫 别写死
  function dimLabel(n) {
    const ids = new Set(deprecatedTags().map((t) => t.id));
    const own = (folderTagIds(n) || []).find((id) => ids.has(id));
    return (own && fTagDef(own)?.name) || deprecatedTags()[0]?.name || '待整理';
  }
  function deprecatedLast(nodes, includeParents = false) {
    const current = [], deprecated = [];
    for (const node of nodes) (isDeprecated(node, includeParents) ? deprecated : current).push(node);
    return [...current, ...deprecated]; // 仅稳定分区展示，不改变浏览器书签树。
  }
  // 🔴 color 和 id 曾经是裸插值：标签可以从「导入附属数据」和 AI 的 add_tag 两条路进来，
  // 那两条都不走备份那套校验 ⇒ 一个带引号的 color 就能往 button 上挂属性。这里按位置各自转义。
  const safeColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)) ? c : 'currentColor';
  const tagBtn = (t, cls = '') => `<button type="button" class="tag ${cls}" data-tag="${esc(t.id)}" style="--tc:${safeColor(t.color)}" title="${esc(t.name)}${t.desc ? '：' + esc(t.desc) : ''}"><b>${esc(t.glyph)}</b>`;
  let lastMetaJson = '';
  const saveMeta = () => {
    lastMetaJson = JSON.stringify(meta);
    const p = store.meta.set(meta);
    // 多数调用方不 await 它 ⇒ 失败就静默了，刷新之后改动凭空消失。这里兜住并说出来。
    p.catch((e) => toast('这次改动没能存下来：' + (e.message || e) + '（刷新后会恢复成上次保存的样子）'));
    return p;
  };
  store.meta.onChanged?.((fresh) => {
    const j = JSON.stringify(fresh);
    if (j === lastMetaJson || j === JSON.stringify(meta)) return;   // 自己写的回声
    meta = fresh; meta.items ||= {}; meta.groups ||= {}; meta.tags ||= DEFAULT_TAGS.map((t) => ({ ...t }));
    ensurePinnedTag(); migrateFolderTags();   // 只补内存这一份，🚫 别在这儿存盘：会跟另一台来回写
    if (typeof meta.emojiRules !== 'string') meta.emojiRules = DEFAULT_EMOJI_RULES;
    emojiRules = parseEmojiRules(meta.emojiRules);
    if (typeof render === 'function' && bar) render();
  });
  const itemMeta = (u) => meta.items[key(u)] || {};
  function setItemMeta(u, patch) { BmCore.applyItemMeta(meta, u, patch); saveMeta(); }
  // 老数据里 meta.tags 早就有了，上面那个 ||= 不会补新标签 ⇒ 缺了就补一条。
  // 🔴 只补不改：他要是自己把这个标签改了名或换了色，照他的来。
  function ensurePinnedTag() {
    if (meta.tags.some((t) => t.id === PINNED_TAG)) return false;
    meta.tags.push({ ...DEFAULT_TAGS.find((t) => t.id === PINNED_TAG) });
    return true;
  }
  if (ensurePinnedTag() | migrateFolderTags()) saveMeta();
  const groupColor = (title) => (meta.groups[title] || {}).color || '';
  // ── 锁定：锁在文件夹的稳定身份（uid）上，不再认名字 ──
  // 🔴 原先按文件夹名记（meta.groups[title].locked）有三个后果：同名夹互相串；
  //    改名就等于换了把锁（先改名再动手就绕过去了）；节点自身没有锁记录，全靠当前父链判断。
  //    现在锁记在 meta.locks[uid]，改名不影响；旧的按名锁继续认，并在能唯一对上时自动迁过来。
  let uidById = {};                       // chrome id → 稳定身份 uid，由后台维护
  const uidOf = (id) => uidById[String(id)] || null;
  const folderLockedByTitle = (title) => !!(meta.groups[title] || {}).locked;
  const folderLocked = (n) => BmCore.folderLocked(meta, uidById, n);
  const isLocked = (id) => BmCore.lockedInTree(meta, uidById, bar, id);
  // 文件夹说明＝这个夹该放什么。跟锁一样按 uid 存，改名不丢、同名夹不串
  // 老徐 260914：「不能直接写到代码里面去」⇒ 收集箱和最近访问那两句也是可改的，代码里只给一句默认文案。
  // 收集箱本身就是书签栏这个文件夹，走 folderNotes；最近访问不是文件夹，存在本机偏好里。
  // 最近访问和收集箱不是普通文件夹：前者根本不是夹，后者是书签栏根目录、拿不到稳定标识
  // ⇒ 这两块的说明存在本机偏好里；代码里只给一句默认文案，他改了就用他的、清空了就真的空着。
  const RECENT_NOTE = '__recent';
  const PINNED_NOTE = '__pinned';
  const pseudoNote = (id) => (String(id) === RECENT_NOTE ? 'recentNote' : String(id) === PINNED_NOTE ? 'pinnedNote' : String(id) === String(bar?.id) ? 'inboxNote' : '');
  const DEFAULT_NOTES = {
    recentNote: '最近访问：这台浏览器最近打开过的几个网页，按时间排。已经收藏的就是那条书签本身，点右边箭头能进详情；没收藏过的是影子卡，只能点开。',
    inboxNote: '收集箱：在别处点星号收藏、没归类的网址都落在这里。整理完点「归入」挪进文件夹，这里就空了。',
    pinnedNote: '快捷方式：鼠标移到任意一条书签上、点右上角那颗「捷」就钉到这里，最多 16 个。它不是副本 —— 书签还在自己原来的文件夹里，这儿只是多一个入口；再点一次那颗「捷」就取消。',
  };
  const deckTab = () => DECK_TABS.find((x) => x.k === prefs.deckTab) || DECK_TABS[0];
  const folderNote = (id) => {
    const k = pseudoNote(id);
    if (k) return typeof prefs[k] === 'string' ? prefs[k] : DEFAULT_NOTES[k];
    return BmCore.folderNote(meta, uidById, id);
  };
  function setFolderNote(id, text) {
    const k = pseudoNote(id);
    if (k) { prefs[k] = String(text || '').trim(); savePrefs(); render(); return true; }
    const uid = uidOf(id);
    if (!uid) { toast('这个文件夹还没拿到稳定标识，先做一次自动备份再写说明'); return false; }
    meta.folderNotes = meta.folderNotes || {};
    const v = String(text || '').trim();
    if (v) meta.folderNotes[uid] = v; else delete meta.folderNotes[uid];
    saveMeta(); render();
    return true;
  }
  function setFolderLock(n, on) {
    const uid = uidOf(n.id);
    meta.locks = meta.locks || {};
    if (uid) { if (on) meta.locks[uid] = true; else delete meta.locks[uid]; }
    // 同时清掉这个名字上的旧锁，避免「解锁了还锁着」
    const g = meta.groups[n.title];
    if (g && g.locked) { delete g.locked; if (!Object.keys(g).length) delete meta.groups[n.title]; }
    if (!uid && on) { meta.groups[n.title] = { ...(meta.groups[n.title] || {}), locked: true }; toast('这个文件夹还没拿到稳定标识，先按名字锁住；下次自动备份后会自动改成按标识锁'); }
    saveMeta(); render();
  }
  // 旧的按名锁：名字在书签栏里唯一对应一个文件夹时，自动迁到 uid 上；同名多个就保持原样，🚫 别乱猜
  function migrateLocks() {
    const named = Object.entries(meta.groups).filter(([, g]) => g && g.locked).map(([t]) => t);
    if (!named.length) return;
    const byTitle = {};
    const walk = (n) => { for (const c of n.children || []) { if (!c.url) { (byTitle[c.title] = byTitle[c.title] || []).push(c); walk(c); } } };
    walk(bar);
    let moved = 0;
    for (const title of named) {
      const hits = byTitle[title] || [];
      if (hits.length !== 1) continue;              // 同名多个或已不存在：保持按名锁
      const uid = uidOf(hits[0].id); if (!uid) continue;
      meta.locks = meta.locks || {}; meta.locks[uid] = true;
      const g = meta.groups[title]; delete g.locked; if (!Object.keys(g).length) delete meta.groups[title];
      moved++;
    }
    if (moved) saveMeta();
  }

  // ── 筛选状态（不持久）──
  const globalFilter = new Set();
  const groupFilter = new Map(); // folderId → Set

  // ── 数据 ──
  let bar = null;
  let flat = [];
  const tagCounts = (n) => {
    const c = {}; tagList().forEach((t) => { c[t.id] = 0; });
    const walk = (x) => { for (const k of x.children || []) { if (k.url) effectiveTags(k).forEach((t) => { if (t in c) c[t]++; }); else walk(k); } };
    walk(n); return c;
  };
  function buildFlat() { flat = BmCore.flatten(bar); }
  // 🔴 挪一格不该重建两万个节点：数据和重画拆开，挪位置只要前半截
  async function refreshData() {
    bar = await store.bar();
    if (store.kind === 'chrome') {
      try { const r = await BG.askBg({ type: 'IDENTITY_MAP' }, { ms: 10000, retry: false }); if (r?.ok && r.data) { uidById = r.data; migrateLocks(); } }
      catch { /* 后台没起来：这次先用旧的按名锁，🚫 别因此卡住整页 */ }
    }
    buildFlat();
    if (selectedId && !findNode(selectedId)) selectedId = null;
  }
  async function refresh() {
    await refreshData();
    render();
    if ($('#search').value.trim()) renderSearch();
  }

  // ── 渲染 ──
  const svgChev = '<svg viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
    a.appendChild(pinBtn(n));
    const txt = document.createElement('span'); txt.className = 'txt';
    const line1 = document.createElement('span'); line1.className = 'line1';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = label(n); line1.appendChild(name);
    line1.appendChild(tagChips(m.tags));
    if (n.parentId === bar.id) { const mv = document.createElement('button'); mv.type = 'button'; mv.className = 'tile-move'; mv.dataset.id = n.id; mv.textContent = '归入…'; mv.title = '挪进一个文件夹'; line1.appendChild(mv); }
    txt.appendChild(line1);
    // 老徐 260914 拍：详细版多露三样 —— 书签名原样（有显示名时才露，灰字）· 详细说明前两行 · 最近打开
    if (m.name) { const o = document.createElement('span'); o.className = 'orig'; o.textContent = rawLabel(n); o.title = '网页带过来的原名'; txt.appendChild(o); }
    const desc = document.createElement('span'); desc.className = 'desc';
    if (m.desc) { desc.textContent = m.desc; desc.classList.add('said'); }
    else { const d = domainParts(n.url); desc.innerHTML = (d.pre ? `<span class="pre">${esc(d.pre)}</span><span class="sep">·</span>` : '') + `<span class="dom">${esc(d.root)}</span>`; }
    desc.title = m.desc ? m.desc : n.url;
    txt.appendChild(desc);
    if (m.note) { const nt = document.createElement('span'); nt.className = 'note'; nt.textContent = m.note; nt.title = m.note; txt.appendChild(nt); }
    const foot = document.createElement('span'); foot.className = 'foot';
    const dp = domainParts(n.url);
    foot.innerHTML = `<span class="fdom">${esc((dp.pre ? dp.pre + '.' : '') + dp.root)}</span><span class="since" data-k="${esc(key(n.url))}">…</span>`;
    txt.appendChild(foot);
    const u = document.createElement('span'); u.className = 'url'; u.textContent = n.url; txt.appendChild(u);
    a.appendChild(txt);
    a.appendChild(strip3(n.id));
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
    if (typeof saved === 'boolean') return saved;
    // 老徐 260914：「一种是我自己逐个设，一种是全局默认全折或全开」⇒ 没单独设过的按全局默认走
    if (prefs.foldDefault === 'closed') return true;
    if (prefs.foldDefault === 'open') return false;
    return defaultCollapsed(f);
  }
  function levelMark(level) {
    return `<span class="level-mark" aria-hidden="true" style="--level-count:${level}">${'<i></i>'.repeat(level)}</span>`;
  }
  function paintFold(section, collapsed) {
    section.classList.toggle('is-collapsed', collapsed);
    const body = section.querySelector(':scope > .body');
    if (body) body.hidden = collapsed;
    // 右边竖条上那颗跟左边那颗是同一件事，状态一起画
    const stripFold = section.querySelector(':scope > .fstrip > .fs-fold');   // 一级二级同一套
    if (stripFold) {
      stripFold.setAttribute('aria-expanded', String(!collapsed));
      stripFold.title = collapsed ? '展开这个文件夹' : '收起这个文件夹';
      stripFold.setAttribute('aria-label', stripFold.title);
    }
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
    // 🔴 顶上那一整块不是 .card／.sub ⇒ 点它的三角时 main 那条委托拿到的 box 是 null。
    //    这就是运行错误里长期挂着的那条 Cannot read properties of null (reading 'dataset')。
    if (!section) return;
    const f = section.dataset.id === bar.id ? bar : findNode(section.dataset.id); if (!f) return;
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
      levelMark(opts.level || 1) + (`<button class="folder-toggle" type="button" aria-controls="folder-body-${f.id}" aria-expanded="true"><svg viewBox="0 0 12 12"><path d="M3 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`) +
      (opts.fixed ? '' : `<span class="grip" draggable="true" title="拖动排序">⋮⋮</span>`) +
      `<span class="hd-name" title="${opts.fixed ? '' : '点名字改名 · 颜色在右边「›」详情里选'}"><span class="swatch"></span><span class="title">${esc(f.title || '（未命名）')}</span>${folderLocked(f) ? '<span class="lock" title="已锁定：AI 只看不动">🔒</span>' : ''}</span>` +
      `<span class="level-label">${opts.level || 1}级</span>` +
      (isInbox(f) ? '<span class="inbox-badge">收纳</span>' : '') +

      (isDeprecated(f) ? `<span class="deprecated-badge">${esc(dimLabel(f))}</span>` : '') +
      (opts.tags && opts.level > 1 ? `<span class="hd-subs">${deprecatedLast((f.children || []).filter((c) => !c.url)).slice(0, 6).map((c) => `<button type="button" class="subchip" data-goto="${c.id}">${esc(c.title || '（未命名）')}</button>`).join('')}</span>` : '') +
      (opts.tags && opts.level > 1 ? `<span class="hd-tags">${tagList().filter((t) => counts[t.id] || gf.has(t.id)).map((t) => tagBtn(t, gf.has(t.id) ? 'on' : '') + `<span class="cnt">${counts[t.id]}</span></button>`).join('')}</span>` : '') +
      `<span class="hd-toggle"></span>` +
      (opts.fixed
        ? `<span class="hd-nudge inbox-nudge">${[['up','▲','收集箱上移一格'],['down','▼','收集箱下移一格'],['top','⇱','复位：回到最顶上']].map(([d,g,t])=>`<button type="button" class="nudge" data-inbox="${d}" title="${t}" aria-label="${t}">${g}</button>`).join('')}</span>`
        : `<span class="hd-nudge">${[['up','▲','上移一格'],['down','▼','下移一格'],['out','⇤','移出去，升一层'],['in','⇥','收进上面那个夹，降一层']].map(([d,g,t])=>`<button type="button" class="nudge" data-nudge="${d}" data-id="${f.id}" title="${t}" aria-label="${t}">${g}</button>`).join('')}</span>`) +
      (cls === 'head' ? `<button class="hd-view" type="button" data-viewof="${f.id}" title="这一组怎么显示：点一下在紧凑 / 详细之间切；顶栏那组是管全部的">${viewName(viewFor(f.id))}</button>` : '') +
      `<span class="n">${countUrls(f)}</span>` +
      `<button class="more" type="button" title="更多">⋯</button>`;
    return head;
  }

  // 「这个夹该放什么」那一条。写下来之后，AI 归类时会照它办。
  // 老徐 260914：「折叠时回答『这个文件夹是干什么的』，展开时内容本身回答『里面有什么』」
  // ⇒ 说明的**只读**形态只出现在折叠那一行的右段（headEl 里的 .hd-note-line）；
  //   这个盒子从此只当编辑器用，平时是空的、不占版面。
  // 标题栏底下那一条说明小框。老徐 260914：「只折叠时留着」——展开之后标题栏下面直接是书签。
  // 内容来源两种：普通夹是他自己写的文件夹说明；收集箱和最近访问是写死的一句「这是什么」。
  function noteCardEl(f) {
    const box = document.createElement('div');
    box.className = 'note-card'; box.dataset.id = f.id;
    // 收集箱和最近访问这两块是常驻说明：折叠展开都在，但内容照样是他自己能改的
    // 老徐 260914：「如果有备注就显示备注」；没备注就说清楚这一夹由什么构成，点它就能写
    const t = folderNote(f.id);
    // 🔴 这里曾经用 <button>：Chrome 给按钮的内部盒子另有一套排版，外框会被撑到 116px 高（实测）。
    // 换成 span，点击交给外框那一层，高度就跟着文字走了。
    const btn = document.createElement('span');
    btn.className = 'note-card-btn' + (t ? '' : ' note-blank');   // 🔴 别叫 .empty：全局有个 .empty{margin-top:80px} 会把这个框撑到 116px
    // 🚫 这里不再挂 data-note —— 老徐 260915 定：说明只显示，要改走右边那一整条开侧栏。
    //    条数标题栏右边已经有一份，这儿不重复报数，只留一句「怎么写」。
    if (t) { btn.textContent = t; btn.title = t; }
    else { btn.textContent = '还没写说明　·　点右边那一条「›」，在侧栏里写一句：这个夹是干什么的'; btn.title = btn.textContent; }
    box.appendChild(btn);
    return box;
  }
  // 挪一格：算好落点再动手，动不了就说清楚为什么，🚫 别默默没反应
  // 四个方向做成菜单项：动不了的直接不列，🚫 别让人点了才发现没反应
  function nudgeMenu(id) {
    const can = BmCore.nudgeable(bar, String(id));
    const label = { up: '↑ 上移一格', down: '↓ 下移一格', out: '⇤ 移出当前文件夹（升一层）', in: '⇥ 收进上面那个文件夹（降一层）' };
    return ['up', 'down', 'out', 'in'].filter((d) => can[d]).map((d) => ({ t: label[d], f: () => nudge(id, d) }));
  }
  // ── 挪位置：只动两个节点，别推倒重来 ──
  // 老徐 260915：「我一点，整个页面都在刷新、跳动和滚动……能不能做成像鼠标滚轮那样直接平滑地滑上去」
  // 实测旧做法一次点击：整棵树全量重画 2 次（23920 个节点 ×2）、耗时 1.5～1.8 秒、页面被拽着跳 125～186 像素。
  // 三个病根：① render() 是全量的 ② nudge 自己刷一次、书签事件又刷一次 ③ revealFolder 强行 scrollIntoView。
  // 现在：同级上下移只换 DOM 顺序 ＋ FLIP 滑动；跨层级才重画；两种都不再滚动页面。
  let selfWriteUntil = 0;
  const markSelfWrite = () => { selfWriteUntil = Date.now() + 1200; };
  // FLIP：先记位置 → 改 DOM → 反向偏移回原处 → 动画归零，看起来就是两块互相错身滑过去
  function flipCapture(nodes) {
    const m = new Map();
    for (const el of nodes) m.set(el, el.getBoundingClientRect().top);
    return m;
  }
  function flipPlay(m, ms = 220) {
    const moved = [];
    for (const [el, was] of m) {
      const d = was - el.getBoundingClientRect().top;
      if (!d) continue;
      el.style.transition = 'none'; el.style.transform = `translateY(${d}px)`;
      moved.push(el);
    }
    if (!moved.length) return;
    requestAnimationFrame(() => {
      for (const el of moved) { el.style.transition = `transform ${ms}ms cubic-bezier(.2,.7,.3,1)`; el.style.transform = ''; }
    });
    setTimeout(() => { for (const el of moved) { el.style.transition = ''; el.style.transform = ''; } }, ms + 60);
  }
  // 按 bar 里的新顺序，把 #groups 那一排重新串一遍 —— 只调 insertBefore，一个节点都不重建
  function resyncTopOrder() {
    const groups = $('#groups');
    const want = deprecatedLast((bar.children || []).filter((f) => !f.url));
    const ordered = [...want.filter((f) => !isDeprecated(f)), ...want.filter((f) => isDeprecated(f))];
    let ok = true;
    for (const f of ordered) {
      const el = document.getElementById('sec-' + f.id);
      if (!el || el.parentElement !== groups) { ok = false; break; }
      groups.appendChild(el);
    }
    return ok;
  }
  async function nudge(id, dir) {
    const node = findNode(String(id));
    if (!node) { toast('这一条已经不在了，刷新一下'); return; }
    if (isLocked(id)) { toast('这一条在锁定的文件夹里，先解锁再挪'); return; }
    const to = BmCore.nudgeTarget(bar, String(id), dir);
    if (!to) { toast({ up: '已经是第一个了', down: '已经是最后一个了', out: '已经在最外层了', in: '上面紧挨着的不是文件夹，没法收进去' }[dir]); return; }
    if (isLocked(to.parentId)) { toast('目标文件夹已锁定'); return; }
    // 一级夹同级上下移＝最常用那条路：走轻量通道
    const card = document.getElementById('sec-' + id);
    const light = (dir === 'up' || dir === 'down')
      && String(node.parentId) === String(bar.id)
      && card && card.parentElement === $('#groups') && $('#organize').hidden && !search.value.trim();
    try {
      if (light) {
        const snap = flipCapture([...$('#groups').children]);
        await store.move(String(id), to);
        markSelfWrite();
        await refreshData();
        if (resyncTopOrder()) { flipPlay(snap); return; }   // 🚫 页面一步都不滚：动的是块，不是视口
        render();                                           // DOM 跟数据对不上了才退回重画
        return;
      }
      // 整理页开着时同样别让页面跳：记下这块在屏幕上的位置，重画完把滚动补回去
      const orgOpen2 = !$('#organize').hidden;
      const was = orgOpen2 ? document.querySelector(`#organize .fchip[data-id="${CSS.escape(String(id))}"]`)?.getBoundingClientRect().top : null;
      await store.move(String(id), to);
      markSelfWrite();
      await refresh();
      if (orgOpen2) {
        const now = document.querySelector(`#organize .fchip[data-id="${CSS.escape(String(id))}"]`)?.getBoundingClientRect().top;
        if (was != null && now != null) window.scrollBy(0, now - was);
        return;
      }
      // 跨层级会换爹，得让他看见挪到哪去了；同级那条上面已经 return，不会走到这儿
      document.getElementById('sec-' + (dir === 'in' ? to.parentId : String(id)))?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    catch (err) { toast('没挪动：' + (err.message || err)); }
  }
  // 按住任一个方向键 ＋ 滚轮 ＝ 一格一格连着挪（老徐 260915：「点住，然后用鼠标滚轮往上滚一层、往下滚一层」）
  // 两种方式都在：点一下走一格，按住滚轮连着走。按住 ▲▼ 滚的是同级顺序，按住 ⇤⇥ 滚的是层级深浅。
  let hold = null, nudgeChain = Promise.resolve(), wheelMoved = false;
  const queueNudge = (id, dir) => { nudgeChain = nudgeChain.then(() => nudge(id, dir)).catch(() => {}); return nudgeChain; };
  document.addEventListener('mousedown', (e) => {
    const nb = e.target.closest('.nudge[data-nudge]');
    hold = nb ? { id: nb.dataset.id, level: nb.dataset.nudge === 'in' || nb.dataset.nudge === 'out' } : null;
    wheelMoved = false;
  });
  document.addEventListener('mouseup', () => { hold = null; });
  window.addEventListener('blur', () => { hold = null; });
  document.addEventListener('wheel', (e) => {
    if (!hold) return;
    e.preventDefault();          // 按住时滚轮归我用，🚫 别让页面跟着滚
    wheelMoved = true;
    queueNudge(hold.id, hold.level ? (e.deltaY < 0 ? 'out' : 'in') : (e.deltaY < 0 ? 'up' : 'down'));
  }, { passive: false });
  document.addEventListener('click', (e) => {
    const sf = e.target.closest('[data-stripfold]');
    if (sf) { e.preventDefault(); e.stopPropagation(); toggleFolder(document.getElementById('sec-' + sf.dataset.stripfold)); return; }
    const hd = e.target.closest('.hd-detail, .fs-more'); if (hd) { e.preventDefault(); e.stopPropagation(); openDetail(hd.dataset.detail); return; }
    const nb = e.target.closest('.nudge');
    if (nb) {
      e.preventDefault(); e.stopPropagation();
      // 刚用滚轮连着挪过 ⇒ 松手这下的 click 不算数，否则平白多走一格
      if (wheelMoved) { wheelMoved = false; return; }
      queueNudge(nb.dataset.id, nb.dataset.nudge); return;
    }
  });

  function subEl(f, level) {
    const sub = document.createElement('div');
    sub.className = 'sub'; sub.id = 'sec-' + f.id;
    sub.dataset.id = f.id; sub.dataset.kind = 'folder';
    markLevel(sub, level);
    const color = groupColor(f.title); if (color) sub.style.setProperty('--gc', color);
    sub.appendChild(headEl(f, 'sub-head', { level }));
    sub.appendChild(bodyEl(f, false, level));
    sub.appendChild(folderStripEl(f));   // 二级也有自己那一条：上段收起展开、下段开详情
    initFold(sub, f);
    return sub;
  }

  // 🔄 老徐 260915 把收集箱收进了顶上那一整块 ⇒ 它不再排在下面这一排里，
  //    原来那三颗上移／下移／复位按钮没有落脚点了，一起退场。
  //    偏好 inboxIndex 留着不删：万一要退回旧排法，位置还在。
  // 老徐 260915：「右边这个箭头……放在整个框的最右边，可以做宽一点。相当于整个文件夹，
  //   甚至展开子文件夹时，右边一整条都属于关于整个文件夹的定位」
  // ⇒ 跟书签卡片右边那条竖条同一个意思，只是这条管的是整个夹。箭头贴顶，折叠展开位置不变。
  // 上段＝收起／展开（跟左边那个三角同一件事，手不用跑到左边去），下段＝这个夹的详情
  function folderStripEl(f) {
    const box = document.createElement('span');
    box.className = 'fstrip';
    const fold = document.createElement('button');
    fold.type = 'button'; fold.className = 'fs-fold'; fold.dataset.stripfold = f.id;
    fold.innerHTML = '<svg viewBox="0 0 12 12"><path d="M3 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const more = document.createElement('button');
    more.type = 'button'; more.className = 'fs-more'; more.dataset.detail = f.id;
    more.title = `「${f.title || '这个文件夹'}」的详情：说明、颜色、锁定、挪位置`;
    more.setAttribute('aria-label', more.title);
    more.innerHTML = '<span class="fs-arrow">›</span>';
    box.append(fold, more);
    return box;
  }
  // 两组之间那条分隔。名字跟着标签走（他把标签叫「待整理」就写「待整理」）
  function dimDividerEl(n) {
    const d = document.createElement('div');
    d.className = 'dim-divider';
    const name = deprecatedTags()[0]?.name || '待整理';
    d.innerHTML = `<span class="dd-line"></span><span class="dd-txt">${esc(name)} · ${n} 个</span><span class="dd-line"></span>`;
    d.title = `打了「${name}」标签的都排在这条线下面。要它回到上面，去详情侧栏把这个标签取消。`;
    return d;
  }
  function cardEl(f, opts = {}) {
    const card = document.createElement('div');
    card.className = 'card' + (opts.fixed ? '' : (isDeprecated(f) ? ' is-dim' : '')); card.id = 'sec-' + f.id;
    card.dataset.id = f.id; card.dataset.kind = opts.fixed ? 'bar' : 'folder';
    card.dataset.view = viewFor(f.id);
    markLevel(card, 1);
    const color = groupColor(f.title); if (color) card.style.setProperty('--gc', color);
    card.appendChild(headEl(f, 'head', { tags: true, fixed: opts.fixed }));
    card.appendChild(noteCardEl(f));
    card.appendChild(bodyEl(f, !!opts.fixed));
    card.appendChild(folderStripEl(f));
    initFold(card, f);   // 收集箱也能折（老徐 260914「收件箱也可以折叠嘛」）
    return card;
  }


  // ── 整理文件夹：一棵缩进的树，上下拖改顺序 ──
  // 老徐 260914：「不要一级二级给它拆出来，就是那种缩线的、类似于 Markdown 一样缩进这种状态」
  //   ＋「整体框稍微扩大一点，显示内容多一点」＋「底部『还没有子文件夹的组』直接在一级分组里标上」
  // ⇒ 一列到底（🚫 不再横铺），子夹往右缩一层用竖线连；每块两行：名字 ／ 条数·子夹数·锁·说明；
  //   没有子夹的在自己那行标「无子夹」，底部那一段就不用存在了。
  const orgFold = new Map();                      // id → true 折起 / false 展开；没记的按默认：一级展开、二级及以下折起
  const orgSubs = (f) => deprecatedLast((f.children || []).filter((c) => !c.url));
  const orgOpen = (id, lv) => (orgFold.has(id) ? !orgFold.get(id) : lv <= 1);
  function fchipEl(f, parentId, lv, open) {
    const c = document.createElement('div');
    c.className = 'fchip' + (lv > 1 ? ' sm' : '');
    c.draggable = true;
    c.dataset.id = f.id; c.dataset.parent = parentId; c.dataset.kind = 'folder'; c.dataset.lv = lv;
    markLevel(c, lv);
    const col = groupColor(f.title); if (col) c.style.setProperty('--gc', col);
    const subs = orgSubs(f).length;
    const direct = (f.children || []).filter((k) => k.url).length;
    const total = countUrls(f);
    const note = folderNote(f.id);
    c.innerHTML = levelMark(lv)
      + (subs
        ? `<button type="button" class="ftwist" data-twist="${f.id}" aria-expanded="${open ? 'true' : 'false'}" title="${open ? '收起' : '展开'}子文件夹"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5l4 3.5-4 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
        : '<span class="ftwist none" aria-hidden="true"></span>')
      + '<i class="swatch"></i>'
      + '<span class="fmain">'
      +   `<span class="fline"><b class="title">${esc(f.title || '（未命名）')}</b>${folderLockedByTitle(f.title) ? '<em class="lk" title="锁着，先解锁再挪">🔒</em>' : ''}</span>`
      +   '<span class="fmeta">'
      +     `<u class="c-url">${direct} 条</u>`
      +     (total > direct ? `<u class="c-all">连子夹 ${total} 条</u>` : '')
      +     (subs ? `<u class="c-sub">${subs} 个子夹</u>` : '<u class="c-sub none">无子夹</u>')
      +     (note ? `<span class="fnote" title="${esc(note)}">${esc(note)}</span>` : '')
      +   '</span>'
      + '</span>'
      // 老徐 260915：「既然能往上移一移、往下移一移，那左右呢？」⇒ 四个方向都给上。
      // 🔴 类名和 data 属性跟首页那套一模一样 ⇒ 点击委托和「按住＋滚轮连着挪」直接就能用，🚫 不另写一套
      // 老徐 260915：「把它变成像游戏手柄一样的上下左右」⇒ 十字排布，方向即含义：
      //   上下＝在同一个爹里往前往后挪 · 左＝移出去升一层 · 右＝收进上面那个夹降一层
      + `<span class="fnudge">${[['up','▲','往上排一格'],['out','◀','往左：移出去，升一层'],['in','▶','往右：收进上面那个夹，降一层'],['down','▼','往下排一格']]
          .map(([d,g,t]) => `<button type="button" class="nudge n-${d}" data-nudge="${d}" data-id="${f.id}" title="${t}（按住我滚鼠标滚轮，能一格一格连着挪）" aria-label="${t}">${g}</button>`).join('')}</span>`;
    if (isDeprecated(f)) c.querySelector('.title').insertAdjacentHTML('afterend', `<span class="deprecated-badge">${esc(dimLabel(f))}</span>`);
    c.title = '拖到别块的上下边＝改顺序，拖到别块中间＝放进那个夹 · 点一下开右边详情 · 右键改名/换色';
    return c;
  }
  function orgFoldAll(collapse) {
    orgFold.clear();
    const walk = (f) => { for (const sf of orgSubs(f)) { orgFold.set(sf.id, collapse); walk(sf); } };
    for (const f of (bar.children || [])) if (!f.url) { orgFold.set(f.id, collapse); walk(f); }
  }
  // 每一层末尾那个虚线格：在这儿直接建一个文件夹，🚫 不用先在外面建好再拖进来（老徐 260914）
  function newFolderTile(parentId) {
    const d = document.createElement('div');
    d.className = 'fnew'; d.dataset.newin = parentId;
    d.innerHTML = '<span class="fnew-plus">＋</span><span class="fnew-t">在这儿新建文件夹</span>';
    d.title = '在这个位置新建一个文件夹';
    return d;
  }
  async function createFolderIn(parentId) {
    const where = parentId === bar.id ? '书签栏' : (findNode(parentId)?.title || '这个文件夹');
    const r = await dialog({ title: `在「${where}」里新建文件夹`, name: '', showUrl: false, ok: '创建' });
    if (!r || !r.name.trim()) return;
    try { await store.create({ parentId, title: r.name.trim() }); toast(`「${r.name.trim()}」建好了`); }
    catch (e) { toast('没建成：' + (e.message || e)); }
  }
  function renderOrganize() {
    const box = $('#organize');
    box.innerHTML = '';
    const folders = deprecatedLast((bar.children || []).filter((f) => !f.url));
    const withSubs = folders.filter((f) => orgSubs(f).length).length;

    const tip = document.createElement('p'); tip.className = 'forg-tip';
    tip.textContent = '这一页直接改浏览器书签栏里的文件夹结构，改完立刻生效、也会同步到别的电脑。一级分组一行一个；子文件夹平铺，每行几个在右上角选。拖到某一块的上边或下边＝改顺序，拖到它中间＝放进那个文件夹；每块右边四个方向键也能挪，按住其中一个滚鼠标滚轮可以连着挪。每一层最后那个虚线格是「在这儿新建一个文件夹」。';

    const head = document.createElement('div'); head.className = 'forg-h';
    head.innerHTML = `一级分组 <span class="n">${folders.length} 个 · ${withSubs} 个有子文件夹 · ${folders.length - withSubs} 个还没有</span>`;
    const sp = document.createElement('span'); sp.className = 'sp';
    const bOpen = document.createElement('button');
    bOpen.type = 'button'; bOpen.className = 'forg-act'; bOpen.dataset.orgall = 'open'; bOpen.textContent = '全部展开';
    const bClose = document.createElement('button');
    bClose.type = 'button'; bClose.className = 'forg-act'; bClose.dataset.orgall = 'close'; bClose.textContent = '全部折起';
    const cols = document.createElement('span'); cols.className = 'seg mini-seg forg-cols'; cols.title = '子文件夹每行摆几个';
    cols.innerHTML = [2, 3, 4].map((n) => `<button type="button" data-orgcols="${n}"${Number(prefs.orgCols) === n ? ' class="on"' : ''}>${n}</button>`).join('');
    head.append(sp, document.createTextNode('每行'), cols, bOpen, bClose);

    const root = document.createElement('div');
    root.className = 'frow ftree'; root.dataset.parent = bar.id; root.dataset.lv = 1;
    markLevel(root, 1);
    const build = (f, parentId, lv, into) => {
      const node = document.createElement('div');
      node.className = 'fnode'; node.dataset.id = f.id; node.dataset.lv = lv;
      const col = groupColor(f.title); if (col) node.style.setProperty('--gc', col);
      const subs = orgSubs(f);
      const open = subs.length > 0 && orgOpen(f.id, lv);
      node.classList.toggle('open', open);
      node.appendChild(fchipEl(f, parentId, lv, open));
      if (open) {
        const kids = document.createElement('div');
        kids.className = 'frow fkids'; kids.dataset.parent = f.id; kids.dataset.lv = lv + 1;
        markLevel(kids, lv + 1);
        subs.forEach((sf) => build(sf, f.id, lv + 1, kids));
        kids.appendChild(newFolderTile(f.id));
        node.appendChild(kids);
      }
      into.appendChild(node);
    };
    folders.forEach((f) => build(f, bar.id, 1, root));
    root.appendChild(newFolderTile(bar.id));
    box.style.setProperty('--org-cols', String(Number(prefs.orgCols) || 3));
    box.append(tip, head, root);
  }
  function toggleOrganize(on) {
    const box = $('#organize');
    const show = on === undefined ? box.hidden : on;
    box.hidden = !show;
    $('#groups').hidden = show;
    $('#deck').hidden = show;
    if (show) { clearDomHl(); renderOrganize(); }
    else $('#empty').hidden = (bar.children || []).length > 0;
    $('#organize-btn').classList.toggle('on', show);
    if (show) $('#empty').hidden = true;
  }
  $('#organize-btn').addEventListener('click', () => toggleOrganize());
  $('#organize').addEventListener('click', (e) => {
    e.stopPropagation();
    // 🔴 这个处理器一进来就 stopPropagation ⇒ document 上那条 .nudge 委托在整理页里收不到，
    //    方向键点了会毫无反应（260915 实测排位纹丝不动）。所以方向键必须在这儿自己接一次。
    const nb = e.target.closest('.nudge[data-nudge]');
    if (nb) { e.preventDefault(); if (wheelMoved) { wheelMoved = false; return; } queueNudge(nb.dataset.id, nb.dataset.nudge); return; }
    const all = e.target.closest('[data-orgall]');
    if (all) { orgFoldAll(all.dataset.orgall === 'close'); renderOrganize(); return; }
    const tw = e.target.closest('.ftwist[data-twist]');
    if (tw) {                                                  // 三角＝这一夹的子夹开合，🚫 不跳走
      const id = tw.dataset.twist, lv = Number(tw.closest('.fchip').dataset.lv) || 1;
      orgFold.set(id, orgOpen(id, lv));                         // 记的是「折起没有」：现在开着就折起
      renderOrganize(); return;
    }
    const cols = e.target.closest('[data-orgcols]');
    if (cols) { prefs.orgCols = Number(cols.dataset.orgcols); savePrefs(); renderOrganize(); return; }
    const nw = e.target.closest('[data-newin]');
    if (nw) { createFolderIn(nw.dataset.newin); return; }
    const c = e.target.closest('.fchip'); if (!c || dragJustHappened) return;
    // 老徐 260914：「点一级还是二级，都应该直接弹出右边的配置选项，而不是跳来跳去、不知道跳到哪里去」
    // ⇒ 留在整理页不动，右边侧栏开这个夹的详情（名字、颜色、说明、锁、挪位置）。
    selectedId = c.dataset.id;
    $$('#organize .fchip.on').forEach((x) => x.classList.remove('on'));
    c.classList.add('on');
    openDetail(c.dataset.id);
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
    const ordered = [...folders.filter(f => !isDeprecated(f)), ...folders.filter(f => isDeprecated(f))];
    // 老徐 260914：根目录不放具体网址，散在根目录的就是「收集箱」—— 星号收藏落这儿，整理完归入文件夹就从这消失。
    // 它排第几由 prefs.inboxIndex 定（默认最顶上），头上的 ▲▼⇱ 只改这个数
    // 老徐 260915：「我只用 7 个文件夹，这些属于正式的……其他的文件夹都是灰色的待整理，
    //   相当给文件夹多了个分组。侧边栏就会分上下 2 组，页面就这么显示」
    // ⇒ 没打「待整理」标签的就是正式的（默认状态，🚫 不用他给 7 个正式的逐个打标签）。
    //   两组中间横一条，写清楚下面这些是什么、有几个。
    const dim = ordered.filter((f) => isDeprecated(f));
    ordered.forEach((f, i) => {
      if (dim.length && f === dim[0]) groups.appendChild(dimDividerEl(dim.length));
      groups.appendChild(cardEl(f));
    });
    $('#empty').hidden = kids.length > 0;
    $('#total').textContent = `${flat.length} 条 · ${folders.length} 组`;
    domHl = '';
    if (!$('#organize').hidden) renderOrganize();
    renderTagDefs();
    applyFilters();
    renderSide(folders, loose.length ? bar.id : null, loose);
    noticeInbox(loose);
    if (search.value.trim()) renderSearch();
    renderDeck();       // 先用手上这份最近访问画出来
    renderRecent();     // 历史记录是异步的，来了再重画一次

    paintSince(); refreshLastVisits();
  }

  // ── 最近打开：数据异步来，先渲染卡片，来了再往 .since 里填字，🚫 不让渲染等它 ──
  let lastVisits = new Map();
  function paintSince() {
    $$('.tile .since').forEach((el) => { el.textContent = BmCore.sinceLabel(lastVisits.get(el.dataset.k) || 0); el.classList.toggle('never', !lastVisits.get(el.dataset.k)); });
  }
  let visitsBusy = false;
  async function refreshLastVisits() {
    if (visitsBusy) return; visitsBusy = true;
    try { lastVisits = await store.lastVisits(); paintSince(); } catch { /* 没历史权限或没历史就空着 */ } finally { visitsBusy = false; }
  }
  // ── 侧边栏：只列前两级；更深层滚动时高亮所属的二级 ──
  let sideObserver = null;
  // 左栏哪几个一级夹是展开的。只活在这一页里 —— 它是导航状态，不是内容，刷新后全收起正好清爽
  const sideOpen = new Set();
  function renderSide(folders, looseId, loose = []) {
    const list = $('#side-list'); list.innerHTML = '';
    const add = (f, depth, parentId) => {
      const d = document.createElement('div');
      d.className = 'side-item d' + depth + (isDeprecated(f) ? ' is-dim' : ''); d.dataset.id = f.id; d.dataset.parent = parentId; d.dataset.kind = f.id === bar.id ? 'bar' : 'folder';
      d.draggable = f.id !== bar.id;
      markLevel(d, depth + 1);
      const color = groupColor(f.title); if (color) d.style.setProperty('--gc', color);
      d.classList.toggle('inbox-folder', isInbox(f));
      const kids = (f.children || []).filter((c) => !c.url).length;
      // 🔴 原来靠「滚到哪个夹就自动展开哪个」，那个夹子夹一多，左栏突然拉长、位置还跟着跳。
      // 改成自己点开：有子夹的才给三角，点三角只管展开收起，点名字照旧跳过去。
      d.innerHTML = levelMark(depth + 1)
        + (depth === 0 && kids ? `<button type="button" class="side-fold${sideOpen.has(f.id) ? ' on' : ''}" data-fold="${f.id}" title="展开 / 收起子文件夹" aria-expanded="${sideOpen.has(f.id)}">▸</button>` : '<span class="side-fold ph"></span>')
        + `<span class="nm">${esc(f.title || '（未命名）')}${folderLocked(f) ? ' 🔒' : ''}</span><span class="ct">${countUrls(f)}</span>`;
      if (isDeprecated(f)) d.querySelector('.nm').insertAdjacentHTML('afterend', `<span class="deprecated-badge">${esc(dimLabel(f))}</span>`);
      d.title = f.title; d.dataset.name = (f.title || '').toLowerCase();
      list.appendChild(d);
      if (depth < 1 && sideOpen.has(f.id)) for (const c of deprecatedLast(f.children || [])) if (!c.url) add(c, depth + 1, f.id);
    };
    const addInbox = () => { add({ id: bar.id, title: '收集箱', children: loose }, 0, bar.id); list.lastElementChild.classList.add('inbox'); };
    const orderedSide = [...folders.filter(f => !isDeprecated(f)), ...folders.filter(f => isDeprecated(f))];
    const sideDim = orderedSide.filter((f) => isDeprecated(f));
    orderedSide.forEach((f, i) => {
      if (looseId && i === prefs.inboxIndex) addInbox();
      if (sideDim.length && f === sideDim[0]) {
        const sep = document.createElement('div'); sep.className = 'side-sep';
        sep.textContent = `${deprecatedTags()[0]?.name || '待整理'} · ${sideDim.length}`;
        list.appendChild(sep);
      }
      add(f, 0, bar.id);
    });
    if (looseId && prefs.inboxIndex >= orderedSide.length) addInbox();
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
      $$('.side-item').forEach((s) => s.classList.toggle('active', s.dataset.id === id));
      const act = $('.side-item.active'); if (act) act.scrollIntoView({ block: 'nearest' });
    }, { rootMargin: '-60px 0px -70% 0px', threshold: 0 });
    $$('.card, .sub').forEach((el) => sideObserver.observe(el));
  }
  $('#side-list').addEventListener('click', (e) => {
    const fold = e.target.closest('.side-fold[data-fold]');
    if (fold) {
      e.stopPropagation();
      const id = fold.dataset.fold;
      if (sideOpen.has(id)) sideOpen.delete(id); else sideOpen.add(id);
      render();
      return;                                   // 🚫 点三角不跳转，只管展开收起
    }
    const it = e.target.closest('.side-item'); if (!it) return;
    revealFolder(it.dataset.id);
    // 左边点一个夹，右边 AI 就只在这一摊里干活；再点同一个取消。
    // \u{1F534} 只是「选中」，一个字都还没发出去 —— 发送时才把范围盖在那条消息上。
    window.dispatchEvent(new CustomEvent('bm-scope', { detail: { id: it.dataset.id, toggle: true, quiet: true } }));
  });
  // 范围存在 session 里，首页和侧栏共用一份 ⇒ 哪边改了两边都跟上
  function paintScope(id) { $$('.side-item').forEach((s) => s.classList.toggle('scoped', !!id && s.dataset.id === String(id))); }
  chrome.storage.session.get('aiScope').then((d) => paintScope(d?.aiScope?.id)).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'session' && ch.aiScope) paintScope(ch.aiScope.newValue?.id); });
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
      $('#tag-dim').checked = !!cur.dim;
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
        done({ glyph, name, desc: $('#tag-desc').value.trim(), color, dim: $('#tag-dim').checked });
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

  // ── 工作台：四页合一 ──
  // 老徐 260915：「在这个区域顶部横排一列标签（Tab）……把这些功能都整合到这一整块里面，
  //   而且这一整块同样是可以折叠的」⇒ 原来的「最近访问」「快捷方式」两块 ＋ 从下面收上来的「收集箱」
  //   ＋ 一个能换引擎的搜网页框，合成这一个块。顶上省掉大约三分之二的地方。
  let recentRender = 0;
  let recentCache = [];
  async function loadRecent() {
    const request = ++recentRender;
    const items = deprecatedLast(await store.recent(8));   // 老徐 260914：「最多就显示 8 个好了，不要 16 个」
    if (request !== recentRender) return false;
    recentCache = items;
    return true;
  }
  const looseNodes = () => deprecatedLast((bar.children || []).filter((k) => k.url));
  const deckCount = (k) => k === 'recent' ? recentCache.length : k === 'pinned' ? pinnedItems().length : k === 'inbox' ? looseNodes().length : null;

  // 最近访问：已收藏的就是那条书签本身（能进详情、能挪）；没收藏过的是「影子卡」，只能点开
  function deckRecentBody() {
    const body = document.createElement('div'); body.className = 'body';
    if (!recentCache.length) { body.appendChild(deckHint('这台浏览器还没有最近打开的记录，或者没给历史记录权限。')); return body; }
    for (const it of recentCache) {
      const node = flat.find((x) => key(x.url) === key(it.url));
      if (node) { body.appendChild(tileEl(node)); continue; }
      const ghost = tileEl({ id: '', url: it.url, title: it.title || host(it.url), parentId: null });
      ghost.classList.add('ghost'); ghost.draggable = false; ghost.dataset.kind = 'ghost'; delete ghost.dataset.id;
      ghost.querySelector('.strip3')?.remove(); ghost.querySelector('.pin')?.remove();
      ghost.title = `${it.title || host(it.url)}\n${it.url}\n（还没收藏）`;
      body.appendChild(ghost);
    }
    return body;
  }
  // 快捷方式：打了「捷」标签的。🔴 只认书签自己的标签，🚫 不用 effectiveTags（它会把文件夹标签继承给里面每一条）
  const pinnedItems = () => flat.filter((n) => (itemMeta(n.url).tags || []).includes(PINNED_TAG));
  function deckPinnedBody() {
    const all = deprecatedLast(pinnedItems());
    const body = document.createElement('div'); body.className = 'body';
    if (!all.length) { body.appendChild(deckHint('还没有快捷方式。鼠标移到任意一条书签上，点它右上角那颗「捷」，它就会排到这里来。')); return body; }
    for (const n of all.slice(0, PINNED_MAX)) body.appendChild(tileEl(n));
    if (all.length > PINNED_MAX) {
      const more = document.createElement('button');
      more.type = 'button'; more.className = 'pinned-more'; more.dataset.pinnedmore = '1';
      more.textContent = `还有 ${all.length - PINNED_MAX} 个 · 点这里在下面只看这个标签`;
      body.appendChild(more);
    }
    return body;
  }
  // 收集箱＝书签栏根目录里散着的网址。老徐 260915 把它从下面那一排收进这一块
  function deckInboxBody() {
    const loose = looseNodes();
    const body = document.createElement('div'); body.className = 'body'; body.dataset.folder = bar.id;
    if (!loose.length) { body.appendChild(deckHint('收集箱是空的 —— 根目录不放具体网址，这正是它该有的样子。')); return body; }
    for (const n of loose) body.appendChild(tileEl(n));
    body.appendChild(addTile(bar.id));
    return body;
  }
  // 搜网页：地址栏只认默认引擎，想临时换一个得进设置 ⇒ 这里放一排能一键切的。🚫 不要任何新权限，只是拼个网址
  function deckWebBody() {
    const body = document.createElement('div'); body.className = 'websearch';
    const seg = document.createElement('span'); seg.className = 'seg eng-seg';
    for (const e of WEB_ENGINES) {
      const b = document.createElement('button');
      b.type = 'button'; b.dataset.eng = e.k; b.textContent = e.t;
      b.className = curEngine().k === e.k ? 'on' : '';
      seg.appendChild(b);
    }
    const form = document.createElement('form'); form.className = 'web-form';
    const input = document.createElement('input');
    input.type = 'search'; input.id = 'web-q'; input.autocomplete = 'off';
    input.placeholder = `用${curEngine().t}搜网页（上面那个搜索框搜的是书签）`;
    const go = document.createElement('button'); go.type = 'submit'; go.className = 'web-go'; go.textContent = '搜';
    form.append(input, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim(); if (!q) return;
      location.href = curEngine().u + encodeURIComponent(q);
    });
    body.append(seg, form);
    return body;
  }
  function deckHint(text) {
    const d = document.createElement('div'); d.className = 'pinned-hint'; d.textContent = text; return d;
  }

  function renderDeck() {
    const deck = $('#deck'); if (!deck) return;
    // 整理页开着时别把这一块放出来盖在上面（最近访问撞过一次：拖一下就冒出来）
    deck.hidden = !!search.value.trim() || !$('#organize').hidden;
    const cur = deckTab();
    // 标签行。折叠时它变成一行摘要，但照样能点 —— 点了直接展开并切到那一页
    const tabs = $('#deck-tabs'); tabs.innerHTML = '';
    for (const t of DECK_TABS) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'deck-tab' + (t.k === cur.k ? ' on' : '');
      b.dataset.deck = t.k; b.style.setProperty('--tc', t.c);
      b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(t.k === cur.k));
      b.innerHTML = `<span class="dt-e" aria-hidden="true">${t.e}</span><span class="dt-name">${esc(t.t)}</span>`
        + (deckCount(t.k) === null ? '' : `<span class="dt-n">${deckCount(t.k)}</span>`);
      tabs.appendChild(b);
    }
    // 说明跟着当前那一页走；搜网页那页没有说明
    const noteId = cur.note === 'bar' ? bar.id : cur.note;
    const note = noteId ? noteCardEl({ id: noteId }) : document.createElement('div');
    if (!noteId) { note.className = 'note-card fixed'; note.hidden = true; }
    note.id = 'deck-note';
    deck.replaceChild(note, $('#deck-note'));
    $('#deck-note').hidden = !!prefs.deckCollapsed || !noteId;
    // 搜索那页里一张卡片都没有 ⇒ 「紧凑／详细」在这儿没有意义，藏掉
    const hv = $('#deck-head .hd-view'); if (hv) hv.hidden = cur.k === 'web';
    const box = $('#deck-body'); box.innerHTML = '';
    box.appendChild(cur.k === 'recent' ? deckRecentBody() : cur.k === 'pinned' ? deckPinnedBody() : cur.k === 'inbox' ? deckInboxBody() : deckWebBody());
    paintSince();
  }
  async function renderRecent() { if (await loadRecent()) renderDeck(); }

  $('#deck-head').addEventListener('click', (e) => {
    if (e.target.closest('.hd-view')) return;
    const tab = e.target.closest('[data-deck]');
    if (tab) {
      e.stopPropagation();
      // 折叠着点标签 ＝ 展开并切过去；已经展开时点当前这页 ＝ 收起（跟文件夹标题栏一个手感）
      if (prefs.deckCollapsed) { prefs.deckCollapsed = false; prefs.deckTab = tab.dataset.deck; }
      else if (tab.dataset.deck === prefs.deckTab) prefs.deckCollapsed = true;
      else prefs.deckTab = tab.dataset.deck;
      savePrefs(); applyPrefs(); renderDeck();
      if (prefs.deckTab === 'web' && !prefs.deckCollapsed) $('#web-q')?.focus();
      return;
    }
    prefs.deckCollapsed = !prefs.deckCollapsed; applyPrefs(); savePrefs();
  });
  $('#deck-body').addEventListener('click', (e) => {
    const eng = e.target.closest('[data-eng]');
    if (eng) {
      e.preventDefault(); e.stopPropagation();
      prefs.webEngine = eng.dataset.eng; savePrefs(); renderDeck(); $('#web-q')?.focus();
      return;
    }
    // 🔴 卡片本身是个 <a>，先拦住默认跳转，否则点一下就把网页打开了
    const more = e.target.closest('[data-pinnedmore]');
    if (more) {
      e.preventDefault(); e.stopPropagation();
      globalFilter.clear(); globalFilter.add(PINNED_TAG); applyFilters();
      $('#groups').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  // 钉上去之后自动切到快捷方式那一页，让他看见东西确实进去了
  const showDeckTab = (k) => { prefs.deckTab = k; prefs.deckCollapsed = false; savePrefs(); applyPrefs(); renderDeck(); };

  // ── 搜索 ──
  const search = $('#search');
  function renderSearch() {
    const q = search.value.trim().toLowerCase();
    const results = $('#results');
    const showing = !!q;
    $('#groups').hidden = showing; results.hidden = !showing;
    $('#deck').hidden = showing || !$('#organize').hidden;
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
      if (!isDeprecated(b) && isDeprecated(b, true)) l1.insertAdjacentHTML('beforeend', '<span class="deprecated-badge" title="所在文件夹被标成了排到最后的那一类">↓</span>');
      txt.innerHTML += `<span class="desc">${esc(b.path || '收集箱')} · ${esc(host(b.url))}</span>`;
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
    if (!seg.dataset.key) return;   // #filter-mode 有自己的 handler；没有 data-key 时这里会写出一个字面量 'undefined' 键
    prefs[seg.dataset.key] = b.dataset.val;
    if (seg.dataset.key === 'view') prefs.folderView = {};   // 顶栏选的是「全部」，各夹自己的选择让路
    applyPrefs(); savePrefs();
    // 换默认折叠状态要重画一次才看得出来；单独设过的夹仍然优先，要它们也跟着走得点「回到默认」
    if (seg.dataset.key === 'foldDefault') { render(); toast(Object.keys(prefs.folderCollapsed).length ? '默认改好了。单独设过的夹还按自己的来，点「回到默认」让它们也跟着走' : '默认改好了'); }
  }));
  // 折叠这一排：三颗动作按钮 ＋ 一个默认状态（老徐 260914 要放在标签那一行的最右边）
  const foldAll = async (collapsed) => {
    for (const s of [...$$('#groups > .card'), ...$$('#groups .sub')]) {
      const f = s.dataset.id === bar.id ? bar : findNode(s.dataset.id);
      if (f) prefs.folderCollapsed[foldKey(f)] = collapsed;
    }
    prefs.deckCollapsed = collapsed;
    try { await store.prefs.set({ folderCollapsed: prefs.folderCollapsed }); await savePrefs(); }
    catch { toast('折叠状态没存下来'); }
    applyPrefs(); render();
  };
  $('#fold-close').addEventListener('click', () => foldAll(true));
  $('#fold-open').addEventListener('click', () => foldAll(false));
  $('#fold-reset').addEventListener('click', async () => {
    // 「回到默认」＝ 把逐个设过的那些忘掉，交给上面选的默认
    prefs.folderCollapsed = {};
    try { await store.prefs.set({ folderCollapsed: {} }); } catch { toast('没能清掉逐个设过的状态'); }
    applyPrefs(); render();
    toast(prefs.foldDefault === 'closed' ? '都回到默认：折叠' : prefs.foldDefault === 'open' ? '都回到默认：展开' : '都回到默认：按每个夹原本的规矩');
  });
  // 「新分组」这颗按钮 260914 并进了分组整理页：建在哪儿就在哪儿点那个虚线格。
  // 右键菜单等入口仍然要能建，走同一个函数。
  const newGroup = () => createFolderIn(bar.id);
  // 侧栏里有「详情 / AI」两个页签；这里直接把它开到 AI 那一页
  $('#ai-side')?.addEventListener('click', async () => {
    if (store.kind !== 'chrome' || !chrome.sidePanel) { toast('请在 Chrome 扩展中使用侧栏'); return; }
    try {
      await chrome.storage.session.set({ panelTab: 'ai' });
      await chrome.sidePanel.open({ windowId: currentWindowId });
    } catch (e) { toast('打不开侧栏：' + (e.message || e)); }
  });
  $('#ai-setup-btn')?.addEventListener('click', () => window.open('ai-setup.html', '_blank'));
  // 「备份与恢复」并进了同步药丸，🚫 顶栏不再单独摆一个按钮
  // 老徐 260914：「检查云端之后，其实还是需要能让我进到设置页。我现在进不到」
  // ⇒ 药丸只负责显示状态，点它一律进「同步与备份」页；同步本身每分钟自动跑，不需要人点。
  $('#sync-pill').addEventListener('click', () => { window.open('backup.html', '_blank'); });
  // 老徐 260915：「我改了，马上就能点同步；再改了，我自己还能点」⇒ 同步按钮直接摆在状态条旁边，
  // 🚫 不用再「先点云端最新版、进去、再点同步」三步
  $('#sync-go').addEventListener('click', async () => {
    const b = $('#sync-go');
    if (b.disabled) return;
    b.disabled = true; const was = b.textContent; b.textContent = '⟳ 同步中…';
    try {
      const r = await BG.askBg({ type: 'SYNC_NOW' }, { ms: 120000, retry: false });
      if (r?.ok) { toast('同步完成'); await refresh(); }
      else toast('没同步成：' + (r?.error || '云端没应答') , { t: '去备份页看看', f: () => window.open('backup.html', '_blank') });
    } catch (err) {
      toast('没同步成：' + (err?.message || err), { t: '去备份页看看', f: () => window.open('backup.html', '_blank') });
    } finally { b.disabled = false; b.textContent = was; updateSyncPill(); }
  });
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
      // 🔴 260914 实撞：导出用的是 {...meta}（带着锁定和夹说明），导入却只合并 items/groups/tags。
      // 导出→再导入，或者拷到另一台，锁和夹说明就没了，提示还说「已导入」。
      const plainMap = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
      meta.locks = { ...(meta.locks || {}), ...plainMap(d.locks) };
      meta.folderNotes = { ...(meta.folderNotes || {}), ...Object.fromEntries(Object.entries(plainMap(d.folderNotes)).filter(([, v]) => typeof v === 'string')) };
      // 🔴 标签直接 Object.assign 进来，color 会被原样插进 style="--tc:..."。
      // 这条路不经过备份那套校验 ⇒ 在这儿自己挡一次，格式不对就退回调色板。
      const okColor = (c) => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c);
      const cleanTag = (t, i) => ({ id: String(t.id || '').replace(/[^\w-]/g, '') || 't' + i,
        name: String(t.name ?? '').slice(0, 20), glyph: String(t.glyph ?? '').slice(0, 2),
        desc: String(t.desc ?? '').slice(0, 60), color: okColor(t.color) ? t.color : PALETTE[i % PALETTE.length] });
      for (const [i, raw] of (Array.isArray(d.tags) ? d.tags : []).entries()) {
        const t = cleanTag(raw, i); if (!t.id) continue;
        const cur = tagDef(t.id); if (cur) Object.assign(cur, t); else if (meta.tags.length < MAX_TAGS) meta.tags.push(t);
      }
      if (typeof d.emojiRules === 'string') { meta.emojiRules = d.emojiRules; emojiRules = parseEmojiRules(meta.emojiRules); }
      await saveMeta(); render(); toast(`已导入：${Object.keys(d.items || {}).length} 条标签／说明，${Object.keys(d.groups || {}).length} 个组颜色，${Object.keys(plainMap(d.locks)).length} 个锁定，${Object.keys(plainMap(d.folderNotes)).length} 条夹说明`);
    } catch (err) { toast('导入失败：' + err.message); }
  });

  // ── 点击 / 右键 ──
  const main = $('#main');
  let dragJustHappened = false;
  main.addEventListener('click', async (e) => {
    if (dragJustHappened) { dragJustHappened = false; return; }
    const box = e.target.closest('.card, .sub');
    // 折叠状态下点这一行的空白处 ⇒ 展开/收起，跟下面每个文件夹一模一样（老徐 260914）。
    // 🚫 别在这儿弹侧栏 —— 侧栏走标题栏最右边那个 ›。
    const rowHead = e.target.closest('.card > .head');
    if (rowHead && !e.target.closest('button, .grip, .swatch, .hd-name, .tag')) {
      e.preventDefault(); await toggleFolder(rowHead.parentElement); return;
    }
    const hv = e.target.closest('.hd-view');
    if (hv) {
      e.preventDefault(); e.stopPropagation();
      const id = hv.dataset.viewof, next = viewFor(id) === 'detail' ? 'card' : 'detail';
      prefs.folderView[id] = next; savePrefs();
      const holder = hv.closest('.card, #deck'); if (holder) holder.dataset.view = next;
      hv.textContent = viewName(next); return;
    }
    if (e.target.closest('.folder-toggle')) { e.preventDefault(); await toggleFolder(box); return; }
    if (e.target.closest('.hd-tags .tag')) {
      const t = e.target.closest('.tag').dataset.tag; const id = box.dataset.id;
      const s = groupFilter.get(id) || new Set(); if (s.has(t)) s.delete(t); else s.add(t);
      if (s.size) groupFilter.set(id, s); else groupFilter.delete(id);
      $$('.hd-tags .tag', box).forEach((b) => b.classList.toggle('on', s.has(b.dataset.tag)));
      applyFilters(); return;
    }
    if (e.target.closest('.subchip')) { revealFolder(e.target.closest('.subchip').dataset.goto); return; }

    if (e.target.closest('.hd-name')) { if (box.dataset.kind !== 'bar') inlineRename(box.querySelector('.title')); return; }
    const more = e.target.closest('.more');
    if (more) { e.preventDefault(); openMenu(folderMenu(box), e.clientX, e.clientY); return; }
    const mv = e.target.closest('.tile-move');
    if (mv) { e.preventDefault(); e.stopPropagation(); openMenu(moveMenu(mv.dataset.id), e.clientX, e.clientY); return; }
    const pin = e.target.closest('[data-pin]');
    if (pin) { e.preventDefault(); e.stopPropagation(); togglePin(pin.dataset.pin); return; }
    const strip = e.target.closest('.strip');
    if (strip) { e.preventDefault(); e.stopPropagation(); openDetail(strip.closest('.tile').dataset.id, null, true); return; }
    const add = e.target.closest('.tile.add');
    if (add) { openDetail(null, add.dataset.folder); return; }
  });
  main.addEventListener('contextmenu', (e) => {
    const tile = e.target.closest('.tile:not(.add)');
    if (tile) { e.preventDefault(); openMenu(urlMenu(tile.dataset.id), e.clientX, e.clientY); return; }

    const head = e.target.closest('.head, .sub-head');
    if (head) { e.preventDefault(); openMenu(folderMenu(head.parentElement), e.clientX, e.clientY); return; }
    const body = e.target.closest('.body');
    if (body) { e.preventDefault(); openMenu(folderMenu(body.closest('.card, .sub'), true), e.clientX, e.clientY); return; }
    if (e.target.closest('.recent, .legend')) return;
    e.preventDefault();
    openMenu([{ t: '＋ 新分组', f: () => newGroup() }], e.clientX, e.clientY);
  });

  const findNode = (id) => BmCore.findNode(bar, id);

  // ── 归入：把一条书签挪进某个文件夹（收集箱里每条都有这颗按钮；右键菜单里所有书签都有）──
  function moveMenu(id) {
    const n = findNode(id); if (!n) return [];
    const items = [];
    const push = (f, depth) => {
      if (f.id === n.parentId) return;
      items.push({ t: (depth ? '　'.repeat(depth) + '└ ' : '') + (f.title || '（未命名）'), f: () => moveTo(id, f.id) });
    };
    for (const f of deprecatedLast(bar.children || []).filter((c) => !c.url)) {
      push(f, 0);
      for (const c of deprecatedLast(f.children || []).filter((x) => !x.url)) push(c, 1);
    }
    if (n.parentId !== bar.id) items.push(null, { t: '放回收集箱（根目录）', f: () => moveTo(id, bar.id) });
    return items.length ? items : [{ t: '还没有文件夹，先建一个分组', f: () => newGroup() }];
  }
  async function moveTo(id, parentId) {
    const n = findNode(id); if (!n) return;
    // 🔴 锁定原来只挡得住 AI 和 ▲▼⇤⇥；菜单「归入」和拖动两条最常用的路一声不吭就放行了
    if (isLocked(parentId)) { toast(`「${findNode(parentId)?.title || '目标文件夹'}」锁着，先解锁再挪`); return; }
    if (isLocked(n.parentId)) { toast(`「${findNode(n.parentId)?.title || '原文件夹'}」锁着，先解锁再挪`); return; }
    const from = { parentId: n.parentId, index: n.index };
    try { await store.move(id, { parentId }); }
    catch (e) { toast('没挪动：' + e.message); return; }
    const dest = findNode(parentId);
    // 挪回根目录会让收集箱多一条 ⇒ noticeInbox 0.3 秒后吐一条新提示，把撤销按钮顶没了。
    // 自己挪进去的不用再提醒一遍，记下来让它跳过。
    if (parentId === bar.id) inboxQuiet.add(id);
    toast(`「${label(n)}」已${parentId === bar.id ? '放回收集箱' : '归入「' + (dest?.title || '') + '」'}`, { t: '撤销', f: () => undoMove(id, from) });
  }
  // 撤销一次移动。🔴 别直接拿当时那个 index 硬塞：这几秒里源文件夹被动过的话，
  // 同一个下标已经不是同一个位置了。复核一下，对不上就放回那个夹的末尾并说明。
  async function undoMove(id, from) {
    if (!from) return;
    try {
      const kids = await store.children(from.parentId);
      const exact = from.index <= kids.length;
      await store.move(id, exact ? { parentId: from.parentId, index: from.index } : { parentId: from.parentId });
      if (from.parentId === bar.id) inboxQuiet.add(id);
      if (!exact) toast('已放回原来那个文件夹，位置按最后一格算（这中间它被动过）');
    } catch (e) { toast('撤销失败：' + (e.message || e)); }
  }
  // 收集箱多了新东西（多半是在别的页面点了星号）：每条只提醒一次，这台浏览器自己记。
  // inboxQuiet 是「我自己刚挪进去的」，不用再提醒一遍（提醒会把撤销按钮顶掉）
  const inboxQuiet = new Set();
  function noticeInbox(loose) {
    let seen = []; try { seen = JSON.parse(localStorage.getItem('inboxSeen') || '[]'); } catch {}
    const fresh = loose.filter((n) => !seen.includes(n.id) && !inboxQuiet.has(n.id));
    try { localStorage.setItem('inboxSeen', JSON.stringify(loose.map((n) => n.id))); } catch {}
    if (!fresh.length || (seen.length === 0 && loose.length > 3)) return;   // 第一次装上、根目录本来就一堆：别一上来就吼
    const first = label(fresh[0]);
    toast(fresh.length === 1 ? `收集箱多了一条：${first}` : `收集箱多了 ${fresh.length} 条：${first} 等`, { t: '去看看', f: () => { showDeckTab('inbox'); $('#deck')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } });
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
      { t: '归入文件夹…', f: () => openMenu(moveMenu(id), menuPos.x, menuPos.y) },
      null,
      ...nudgeMenu(id),
      null,
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
      // 挪位置放最前面 —— 这是最常用的那几下；🚫 已经动不了的方向不列出来
      ...(isBar || bodyOnly ? [] : [...nudgeMenu(id), ...(nudgeMenu(id).length ? [null] : [])]),
      ...(isBar ? [] : [{ t: '文件夹详情…', f: () => openDetail(id) }, null]),
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
        { t: folderLocked(f) ? '🔓 解除锁定' : '🔒 锁定（AI 只看不动）', f: () => setFolderLock(f, !folderLocked(f)) },
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
  // 一次挪一格，比拖拽准。🔴 拖拽在长列表里要边拖边滚，落点全靠手稳。
  function nudgeBtn(id, dir) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'nudge nudge-' + dir; b.dataset.nudge = dir; b.dataset.id = id;
    b.title = { up: '上移一格', down: '下移一格', out: '移出当前文件夹（升一层）', in: '收进上面那个文件夹（降一层）' }[dir];
    b.setAttribute('aria-label', b.title);
    b.textContent = { up: '▲', down: '▼', out: '⇤', in: '⇥' }[dir];
    return b;
  }
  // 老徐 260915：「我点了地址就是快捷方式来」⇒ 每张卡片右上角就有这颗，点一下钉上／再点取消，
  // 🚫 不用绕进右边详情侧栏去勾标签。钉过的一直亮着，没钉的鼠标移上去才露。
  function pinBtn(n) {
    const b = document.createElement('button');
    const on = (itemMeta(n.url).tags || []).includes(PINNED_TAG);
    b.type = 'button'; b.className = 'pin' + (on ? ' on' : ''); b.textContent = '捷';
    b.dataset.pin = n.url;
    b.title = on ? '从快捷方式里去掉 —— 只取消这个标签，书签留在原来的文件夹' : '钉进上面的「快捷方式」那一组';
    b.setAttribute('aria-label', b.title);
    b.setAttribute('aria-pressed', String(on));
    return b;
  }
  function togglePin(url) {
    const cur = itemMeta(url).tags || [];
    const on = cur.includes(PINNED_TAG);
    setItemMeta(url, { tags: on ? cur.filter((x) => x !== PINNED_TAG) : [...cur, PINNED_TAG] });
    render();
    if (on) toast('已从快捷方式里去掉 —— 书签还在原来的文件夹里');
    else {
      showDeckTab('pinned');   // 切过去，让他当场看见东西确实进去了
      const n = pinnedItems().length;
      toast(n > PINNED_MAX ? `已钉上 —— 超过 ${PINNED_MAX} 个了，上面只露前 ${PINNED_MAX} 个` : '已钉进快捷方式');
    }
  }
  function strip3(id) {
    const box = document.createElement('span'); box.className = 'strip3';
    box.append(nudgeBtn(id, 'up'), detailArrow(id), nudgeBtn(id, 'down'));
    return box;
  }
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
  // 老徐 260915：「侧边栏显示那个，就高亮我标的 1 或者 2 这文件夹或者文件」
  // ⇒ 侧栏现在显示谁，谁右边那条竖条就亮着 —— 否则开着侧栏不知道它讲的是哪一个
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
      tile.querySelector('.strip3')?.classList.toggle('on', open);
    });
    // 文件夹那条（整理页里的块也算一份）
    for (const el of $$('.card[data-id] > .fstrip, .sub[data-id] > .fstrip')) {
      const open = detailPanelOpen && el.parentElement.dataset.id === selectedId;
      el.classList.toggle('on', open);
    }
    $$('#organize .fchip[data-id]').forEach((c) => c.classList.toggle('on', detailPanelOpen && c.dataset.id === selectedId));
  }
  function openDetail(id, parentId = null, toggle = false) {
    if (store.kind !== 'chrome' || !chrome.sidePanel) { toast('请在 Chrome 扩展中打开详情编辑'); return; }
    if (detailTransition) return;
    if (toggle && id && detailPanelOpen && selectedId === id) { closeDetail(); return; }
    detailTransition = true;
    // 不在 open 前 await，保持箭头点击的用户手势。
    const opening = chrome.sidePanel.open({ windowId: currentWindowId });
    const selecting = BG.askBg({ type: 'EDITOR_SELECT', windowId: currentWindowId, id, parentId }, { ms: 10000 });
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
        for (const k of ['view', 'deckCollapsed', 'deckTab', 'filterMode']) if (changes[k]) { prefs[k] = changes[k].newValue; changed = true; }
        if (changed) { applyPrefs(); render(); }
      }
    });
  }

  // ── 菜单 / 对话框 / 提示 ──
  const menu = $('#menu');
  let menuPos = { x: 0, y: 0 };
  function openMenu(items, x, y) {
    if (!items.length) return;
    menuPos = { x, y };
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
    const isList = (t.closest('[data-view]')?.dataset.view || prefs.view) === 'list';
    const side = (el, vertical) => {
      const r = el.getBoundingClientRect();
      return vertical ? (e.clientY < r.top + r.height / 2 ? 'before' : 'after') : (e.clientX < r.left + r.width / 2 ? 'before' : 'after');
    };
    const side_ = (el) => side(el, true);
    if (drag.el.classList.contains('fchip')) {                 // 整理页：只在整理页内部动
      const chip = t.closest('.fchip');
      if (chip) {
        // 🔴 三段式，跟所有文件管理器一个手感：上边一条＝排它前面，下边一条＝排它后面，中间一大片＝放进它里面。
        //    原来是「拖到右端那个 ↳ 小图标上才算放进去」—— 又窄又得先看懂那个符号（老徐 260915 当面说不懂）
        const r = chip.getBoundingClientRect();
        const p = (e.clientY - r.top) / r.height;
        if (p >= 0.3 && p <= 0.7) return { parentId: chip.dataset.id, refId: null, el: chip, cls: 'drop-into' };
        const pos = p < 0.3 ? 'before' : 'after';
        return { parentId: chip.dataset.parent, refId: chip.dataset.id, pos, el: chip, cls: 'drop-' + pos };
      }
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
    const dn = findNode(d.id); const from = dn ? { parentId: dn.parentId, index: dn.index } : null;
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
      if (isLocked(tg.parentId)) { toast(`「${findNode(tg.parentId)?.title || '目标文件夹'}」锁着，先解锁再挪`); return; }
      if (isLocked(from.parentId)) { toast(`「${findNode(from.parentId)?.title || '原文件夹'}」锁着，先解锁再挪`); return; }
      await store.move(d.id, { parentId: tg.parentId, index });
      if (tg.parentId === bar.id) inboxQuiet.add(d.id);
      // 拖动才是整理时的主力动作，原来成功后一声不响、手滑了没有回头路
      const moved = findNode(d.id);
      toast(`「${moved ? label(moved) : '已移动'}」挪到「${findNode(tg.parentId)?.title || '收集箱'}」`, { t: '撤销', f: () => undoMove(d.id, from) });
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
  // 🔴 自己刚挪完、DOM 已经就位 ⇒ 浏览器回来的那声 onMoved 别再重画一遍（实测就是它让一次点击重画了两次）
  store.onChange(() => {
    if (Date.now() < selfWriteUntil) return;
    clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120);
  });
  await refresh();
  // 给 ai.js 的接口（同页其它脚本用）
  window.BM = {
    store, key, host, label, rawLabel, domainParts, countUrls, esc,
    get bar() { return bar; }, get flat() { return flat; }, get meta() { return meta; }, get prefs() { return prefs; },
    itemMeta, setItemMeta, saveMeta, savePrefs, tagList, tagDef, findNode, refresh, render, openDetail, toast, MAX_TAGS, PALETTE, isLocked,
    folderNote, setFolderNote,
    parseEmojiRules, setEmojiRules(txt) { meta.emojiRules = txt; emojiRules = parseEmojiRules(txt); saveMeta(); },
  };
  // 后台可能正在冷启动甚至没起来：超时也要有结论，🚫 别让状态条静默消失
  const askBg=(type,ms=6000)=>BG.askBg({type},{ms,retry:false});
  const hhmm=(v)=>{const d=new Date(v||Date.now());return isNaN(d)?'':d.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});};
  let pillBusy=false,pillFailed=false;
  function setPill(state,text,title){
    const pill=$('#sync-pill');
    pill.dataset.state=state;pill.textContent=text;pill.hidden=false;
    pill.title=title||text;
    const go=$('#sync-go'); if(go) go.hidden=false;   // 状态条露出来＝云端配好了 ⇒ 同步按钮也跟着露
  }
  async function updateSyncPill(retry=true) {
    if (store.kind !== 'chrome') return;
    const pill=$('#sync-pill');
    if(pillBusy)return;
    try {
      const status=await askBg('SYNC_STATUS');
      // 只有后台明确答「没初始化」才隐藏；读不到多半是 service worker 冷启动，显示读取中并重试一次
      if(!status?.ok){
        if(retry){setPill('busy','同步状态读取中…','后台正在启动，稍后自动重试');setTimeout(()=>updateSyncPill(false),1500);return;}
        setPill('attention','同步状态读不到','点一下打开「备份与恢复」查看详情');pillFailed=true;return;
      }
      // 🔴 以前这里把药丸藏掉，于是没配同步的浏览器顶栏就少一块、位置还会跳。
      // 现在它同时是「备份与恢复」的入口，永远在，只是文案不同。
      if(!status.data.initialized||status.data.verified===false){setPill('idle','☁ 备份与恢复','还没设置多设备同步，点开可以备份、恢复，或连上坚果云');return;}
      const d=status.data;
      if(d.inProgress){setPill('attention','上次同步未完成','点一下按云端共同版本恢复；写入前会先留本机保护副本');return;}
      if(d.error){
        // 网络抖一下跟「两边改了同一条、要你选」是两回事，原来一律显示「同步失败」并且都停掉自动同步
        if(d.errorTransient){
          setPill('warn','上次没连上 · 会自动重试','上次同步没连上云端，自动同步还开着，过几分钟会自己再试一次。点一下可以立刻手动试。\n原因：'+d.error);
          pillFailed=false; return;          // 这种可以直接点了重试，🚫 别推去设置页
        }
        pillFailed=true;setPill('attention','同步要你处理 · 点开查看','这次同步需要你拿个主意，自动同步已暂停。点一下打开设置页看详情。\n原因：'+d.error);return;
      }
      const latest=await askBg('SYNC_LATEST_STATUS',15000);
      if(!latest?.ok)throw Error(latest?.error||'无法检查云端');
      pillFailed=false;
      const st=latest.data.state,at=hhmm(latest.data.checkedAt);
      const map={latest:['ok','云端最新版 · '+at],'cloud-new':['warn','云端有新版 · 稍后自动跟上'],'local-new':['warn','本机有改动 · 稍后自动上传'],diverged:['warn','两端都改了 · 自动合并中']};
      // 这台设成「只接收」时，本机改动本来就不会上传 ⇒ 别再拿「本机待上传」吓人，
      // 说清楚它的角色：它跟着云端走，自己的改动会被盖掉
      if(d.followOnly){
        const f={latest:['ok','只接收 · 已是最新 · '+at],'cloud-new':['warn','只接收 · 云端有新版 · 点一下拉取'],'local-new':['ok','只接收 · 已是最新 · '+at],diverged:['warn','只接收 · 云端有新版 · 点一下拉取']};
        const [t2,x2]=f[st]||['ok','只接收 · '+at];
        setPill(t2,x2,'这台设成了「只接收，不上传」：它跟着云端走，本机的改动不会传出去，也会被云端盖掉。要改这个设置去「备份与恢复」。');
        return;
      }
      const [tone,text]=map[st]||['attention','同步待处理'];
      const r=d.receipt;
      setPill(tone,text,(r?'最近核验 '+hhmm(r.verifiedAt)+' · '+r.count+' 条':'尚无核验回执')+'　右边「备份与恢复」是设置入口');
    } catch (e) {pillFailed=true;setPill('attention','同步待处理',(e&&e.message)||'无法检查云端');}
  }
  // 点一下：先主动查云端；确有差异再走既有的 SYNC_NOW（冲突保留云端、先存保护副本、写后完整读回核验）
  async function runSyncPill(){
    if (store.kind !== 'chrome') return;
    if(pillBusy)return;
    if(pillFailed){window.open('backup.html','_blank');return;}   // 失败态点开设置页看详情，🚫 不盲目重试
    pillBusy=true;
    try{
      setPill('busy','检查云端…');
      const status=await askBg('SYNC_STATUS');
      if(!status?.ok)throw Error(status?.error||'无法读取同步状态');
      let need=status.data.inProgress;
      if(!need){
        const latest=await askBg('SYNC_LATEST_STATUS',15000);
        if(!latest?.ok)throw Error(latest?.error||'无法检查云端');
        if(latest.data.state==='latest'){
          setPill('ok','云端最新版 · '+hhmm(latest.data.checkedAt));
          toast('云端已是最新版，无需同步');
          return;
        }
        need=true;
        setPill('busy',{'cloud-new':'下载合并中…','local-new':'上传中…',diverged:'合并中…'}[latest.data.state]||'同步中…');
      } else setPill('busy','按云端版本恢复中…');
      const done=await askBg('SYNC_NOW',180000);
      if(!done?.ok)throw Error(done?.error||'同步失败');
      setPill('busy','读回核验中…');
      const after=await askBg('SYNC_STATUS');
      const r=after?.ok?after.data.receipt:null;
      pillFailed=false;
      setPill('ok','已核验 · '+hhmm(r?.verifiedAt), r?'云端版本 '+String(r.revision||'').slice(0,8)+' · '+r.count+' 条 · 已重新下载核对一致':'');
      toast(r?('同步完成，已读回核验 '+r.count+' 条'):'同步完成');
      await refresh();
    }catch(e){
      pillFailed=true;
      setPill('attention','同步失败 · 点开查看',(e&&e.message)||String(e));
      toast('同步失败：'+((e&&e.message)||e), { t:'查看', f:()=>window.open('backup.html','_blank') });
    }finally{pillBusy=false;}
  }
  if (store.kind === 'chrome') {
    // 🚫 别把状态条挂在 APP_READY 的 finally 上：后台睡死时它永不落定，状态条会一直停在隐藏态
    BG.askBg({ type: 'APP_READY' }, { ms: 10000, retry: false }).catch(() => {});
    updateSyncPill();
    let pillTimer=null;
    chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&['lastSyncAt','syncError','syncAuto','syncInProgress','syncState'].some(k=>k in changes)){clearTimeout(pillTimer);pillTimer=setTimeout(updateSyncPill,250);}});
  }
  window.dispatchEvent(new Event('bm-ready'));
  if (store.kind === 'mock') $('#total').textContent += ' · 离线预览';
})();
