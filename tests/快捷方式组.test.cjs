// 首页「快捷方式」这一组（老徐 260915）：打了「捷 快捷方式」标签的地址排上来，一组最多 16 个。
// 他的原话：「这快捷方式这四个字也属于标签，然后我们打上这快捷方式的标签的地址 就会显示在这新的组」
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
const nocomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
const html = fs.readFileSync(p('newtab.html'), 'utf8');
const css = nocomment(fs.readFileSync(p('style.css'), 'utf8'));
const backup = nocomment(fs.readFileSync(p('backup-worker.js'), 'utf8'));

test('快捷方式就是一个普通标签，不是另一套数据', () => {
  assert.match(app, /id: 'K', glyph: '捷', name: '快捷方式'/, '标签没进默认表');
  assert.match(app, /const PINNED_TAG = 'K'/, '没有标签常量，散落的字面量迟早对不上');
});

test('🔴 只认书签自己打的标签，不吃文件夹继承下来的', () => {
  // effectiveTags 会把所在文件夹的标签算给里面每一条 ⇒ 一个夹打一下就塞进来几十条，那就不叫快捷方式了
  const fn = app.match(/const pinnedItems = \(\) => ([^;]*);/);
  assert.ok(fn, '没有 pinnedItems');
  assert.match(fn[1], /itemMeta\(n\.url\)\.tags/, '没走书签自己的标签');
  assert.doesNotMatch(fn[1], /effectiveTags/, '走了 effectiveTags ⇒ 文件夹标签会把整夹拖进来');
});

test('一组最多 16 个，多出来的不是丢掉而是能点开看', () => {
  assert.match(app, /const PINNED_MAX = 16/, '上限不是 16');
  assert.match(app, /slice\(0, PINNED_MAX\)/, '没截断 ⇒ 打满 50 个首页就炸了');
  assert.match(app, /pinnedmore/, '超出的那些没有出口');
});

test('🔴 新偏好两处都要登记，少一处就是「存得进、换台机器读不回来」', () => {
  const defaults = app.match(/const DEFAULTS = \{(.*)\};/)[1];   // 🔴 别用 [^}]*：DEFAULTS 里嵌着 folderCollapsed: {}，一遇到就截断
  for (const k of ['pinnedNote', 'pinnedCollapsed']) assert.match(defaults, new RegExp(k), k + ' 没进 DEFAULTS');
  const keys = backup.match(/const PREF_KEYS=\[([^\]]*)\]/)[1];
  for (const k of ['pinnedNote', 'pinnedCollapsed', 'foldDefault', 'orgCols']) {
    assert.match(keys, new RegExp("'" + k + "'"), k + ' 没进 PREF_KEYS ⇒ 备份还原后它会消失');
  }
});

test('🔴 applyPrefs 里不许引用那几个伪 id 常量 —— 它在声明之前就被调用了', () => {
  const fn = app.match(/function applyPrefs\(\) \{[\s\S]*?\n  \}/)[0];
  // 🔴 名单要连着取值函数一起列：只防常量名挡不住 deckTab()，我自己就这么踩过一次
  assert.doesNotMatch(fn, /PINNED_NOTE|RECENT_NOTE|DECK_TABS|deckTab\(\)/, '撞暂时性死区：整页白屏，且报错指向别处');
  assert.match(fn, /'__deck'/, '没处理工作台的显示档');
  assert.match(fn, /deckCollapsed/, '工作台折不了');
});

test('老数据要补上这个标签，而且只补不改', () => {
  const fn = app.match(/function ensurePinnedTag\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /some\(\(t\) => t\.id === PINNED_TAG\)/, '没判断已存在 ⇒ 每次打开都塞一个重复标签');
  assert.match(fn, /push/, '不补 ⇒ 老数据里 meta.tags 已经存在，||= 走不到，界面上永远勾不上');
  // 外部 meta 变更重载那处只补内存，别存盘：两台机器会互相写个没完
  assert.match(app, /ensurePinnedTag\(\);\s*$/m, '重载路径没补');
});

test('说明那一句不写死在代码里，他能自己改', () => {
  assert.match(app, /String\(id\) === PINNED_NOTE \? 'pinnedNote'/, '说明没接到偏好上');
  assert.match(app, /pinnedNote: '快捷方式：/, '没有默认文案');
});

test('三块合成一个工作台，四页横排（老徐 260915）', () => {
  assert.match(html, /<section class="recent deck" id="deck">/, '不是同一套壳');
  for (const id of ['deck-head', 'deck-tabs', 'deck-note', 'deck-body']) {
    assert.ok(html.includes('id="' + id + '"'), '缺 ' + id);
  }
  assert.match(css, /#deck > \.note-card/, '说明小框没套上样式');
  const tabs = app.match(/const DECK_TABS = \[([\s\S]*?)\];/)[1];
  for (const k of ["'recent'", "'pinned'", "'inbox'", "'web'"]) assert.match(tabs, new RegExp(k), '少一页 ' + k);
  // 🔴 顶上只能剩这一个块，旧的两个 section 必须真删掉，否则地方还是白占
  assert.doesNotMatch(html, /id="recent"|id="pinned"/, '旧的块还留着 ⇒ 顶上照样占三栏');
  assert.doesNotMatch(app, /inboxCard\(/, '收集箱还在下面那一排里画一份 ⇒ 会出现两个收集箱');
});

test('折起来时标签行退成一行摘要，但照样点得动', () => {
  assert.match(css, /\.deck\.collapsed \.deck-tab \{/, '折叠后标签还是按钮样 ⇒ 占一行还不止');
  const fn = app.match(/\$\('#deck-head'\)\.addEventListener[\s\S]*?\n  \}\);/)[0];
  assert.match(fn, /if \(prefs\.deckCollapsed\) \{ prefs\.deckCollapsed = false/, '折叠时点标签没展开');
  assert.match(fn, /=== prefs\.deckTab\) prefs\.deckCollapsed = true/, '点当前这页不收起 ⇒ 没法用标签收回去');
});

test('搜网页：三个引擎、记住上次那个、🚫 不要新权限', () => {
  // 🔴 这条必须读没剥过注释的原文：剥注释那个正则会把网址里的 // 当成行注释，
  //    连 https://www.baidu.com/... 一起削掉，断言就永远对不上（读起来还像是代码写错了）
  const raw = fs.readFileSync(p('app.js'), 'utf8');
  const eng = raw.match(/const WEB_ENGINES = \[([\s\S]*?)\];/)[1];
  for (const k of ['baidu', 'bing', 'google']) assert.match(eng, new RegExp(k), '少一个引擎 ' + k);
  assert.match(eng, /baidu\.com\/s\?wd=/, '百度地址不对');
  assert.match(app, /webEngine: 'baidu'/, '没记住引擎 ⇒ 每次都得重选');
  const fn = raw.match(/function deckWebBody\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /encodeURIComponent/, '关键词没转义 ⇒ 带 & 或 # 的词会搜错');
  const mf = JSON.parse(fs.readFileSync(p('manifest.json'), 'utf8'));
  for (const p2 of (mf.permissions || [])) assert.notEqual(p2, 'search', '为了搜网页多要了权限');
});

test('整理页开着、搜索时都要让位', () => {
  const fn = app.match(/function renderDeck\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /organize'\)\.hidden/, '整理页开着时会盖在上面（最近访问就撞过这个）');
  assert.match(app, /\$\('#deck'\)\.hidden = showing/, '搜索时没让位');
});

test('🔴 钉的入口在卡片上，不在右边侧栏（老徐 260915「我点了地址就是快捷方式来」）', () => {
  assert.match(app, /a\.appendChild\(pinBtn\(n\)\)/, '卡片上没有那颗按钮 ⇒ 又得绕进侧栏勾标签');
  const fn = app.match(/function pinBtn\(n\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /dataset\.pin = n\.url/, '按钮没带网址，点了不知道钉谁');
  assert.match(fn, /'pin' \+ \(on \? ' on' : ''\)/, '钉过的看不出来 ⇒ 分不清哪些已经钉了');
  // 点击委托必须排在 .strip 前面：竖条那一片会先把事件吃掉
  const pinIdx = app.indexOf("closest('[data-pin]')"), stripIdx = app.indexOf("closest('.strip')");
  assert.ok(pinIdx > 0 && pinIdx < stripIdx, '钉的分支排在详情箭头后面 ⇒ 点了只会开侧栏');
});

test('钉和取消是同一颗按钮，🚫 不碰书签', () => {
  const fn = app.match(/function togglePin\(url\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /filter\(\(x\) => x !== PINNED_TAG\)/, '取消不是去标签');
  assert.match(fn, /\[\.\.\.cur, PINNED_TAG\]/, '钉上不是加标签');
  assert.doesNotMatch(fn, /removeTree|chrome\.bookmarks/, '碰到书签了 —— 这里只能动标签');
  assert.match(app, /const pin = e\.target\.closest\('\[data-pin\]'\);\n\s*if \(pin\) \{ e\.preventDefault\(\)/, '卡片是个 <a>，不拦住就直接把网页打开了');
  assert.doesNotMatch(app, /data-unpin|class="unpin"|'unpin'/, '还留着第二个入口 ⇒ 两处入口早晚分叉');
});

test('点顶上那一块的三角不该炸：它不是文件夹，委托拿到的是 null', () => {
  // 运行错误里长期挂着的 Cannot read properties of null (reading 'dataset') 就是这条
  const fn = app.match(/async function toggleFolder\(section\) \{[\s\S]*?\n    const f =/)[0];
  assert.match(fn, /if \(!section\) return;/, '没兜住 null ⇒ 每点一次工作台的三角就抛一个错');
});

test('没收藏过的影子卡不给钉', () => {
  // 它不在书签树里，打了标签也排不上来，露个按钮只会让人点了没反应
  assert.match(app, /ghost\.querySelector\('\.pin'\)\?\.remove\(\)/, '影子卡上还留着那颗按钮');
});

test('右边那条竖条和文件夹详情箭头都加宽了（老徐 260915「不够宽一点」）', () => {
  const strip = css.match(/\.tile \.strip3\{([^}]*)\}/)[1];
  const w = Number(strip.match(/width:var\(--strip-w,(\d+)px\)/)[1]);
  assert.ok(w >= 28, '竖条还是窄的，点不准：' + w);
  const hd = Number(css.match(/\.hd-detail\{[^}]*width:(\d+)px/)[1]);
  assert.ok(hd >= 32, '文件夹那颗「›」还是窄的：' + hd);
  // 「捷」得让开竖条，否则压在箭头上
  assert.match(css, /\.pin \{[\s\S]*?right: calc\(var\(--strip-w/, '那颗「捷」没让开竖条');
});
