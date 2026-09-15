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
  assert.match(app, /ensurePinnedTag\(\); migrateFolderTags\(\);/, '重载路径没补');
});

test('🔴 文件夹有自己一套标签，跟书签那套完全分开（老徐 260915 拍的「两套，互不相干」）', () => {
  // 他原话：「我刚才讲的是文件夹整理，不是标签组。标签组是标签组，文件夹自己也要有标签组」
  assert.match(app, /const DEFAULT_FOLDER_TAGS = \[/, '没有文件夹那套默认标签');
  assert.match(app, /meta\.folderTags \|\|= DEFAULT_FOLDER_TAGS/, '文件夹标签没有自己的存放处');
  assert.match(app, /const folderTagIds = \(f\) => .*\.ftags/, '文件夹标签没打在自己的字段上');
  // 「排到最后＋压淡」只看文件夹那套，🚫 别再掺和书签标签
  assert.match(app, /const deprecatedTags = \(\) => fTagList\(\)\.filter\(\(t\) => t\.dim\)/, '还在从书签标签里找');
  const isDep = app.match(/function isDeprecated\(n, includeParents = false\) \{[\s\S]*?\n  \}/)[0];
  assert.match(isDep, /ftags/, '判断还在看书签标签');
  assert.doesNotMatch(isDep, /itemMeta\(node\.url\)/, '一条书签自己不该能被标成「待整理」');
  // 老数据：他之前拿书签标签标过文件夹 ⇒ 得搬过来，🚫 别让标记凭空消失
  assert.match(app, /function migrateFolderTags\(\)/, '没有迁移');
  assert.match(app, /g\.ftags = \[\.\.\.new Set\(\[\.\.\.\(g\.ftags \|\| \[\]\), dimId\]\)\]/, '老标记没搬到文件夹标签上');
  // 🔴 同步：两套名单都得走按 id 合并那一段，漏掉哪套，另一台新建的标签就会被整份覆盖掉
  const core = nocomment(fs.readFileSync(p('bm-core.js'), 'utf8'));
  assert.match(core, /for \(const key of \['tags', 'folderTags'\]\)/, '合并只处理了一套名单');
  assert.match(core, /k === 'tags' \|\| k === 'folderTags'/, 'folderTags 被当普通标量字段覆盖了');
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

test('🔴 四段顺序是老徐定的：搜索最左 → 快捷方式 → 收集箱 → 最近访问', () => {
  const raw = fs.readFileSync(p('app.js'), 'utf8');
  const tabs = raw.match(/const DECK_TABS = \[([\s\S]*?)\];/)[1];
  const order = [...tabs.matchAll(/k: '(\w+)'/g)].map((m) => m[1]);
  assert.deepEqual(order, ['web', 'pinned', 'inbox', 'recent'], '顺序被改了');
  assert.match(app, /deckTab: 'web'/, '默认没停在第一页');
});

test('四段各一个颜色、铺满一整行（老徐 260915「不是缩起来这么短」）', () => {
  const raw = fs.readFileSync(p('app.js'), 'utf8');
  const tabs = raw.match(/const DECK_TABS = \[([\s\S]*?)\];/)[1];
  const colors = [...tabs.matchAll(/c: '(#[0-9a-f]{6})'/gi)].map((m) => m[1].toLowerCase());
  assert.equal(colors.length, 4, '有的段没给颜色');
  assert.equal(new Set(colors).size, 4, '四段撞色了 ⇒ 分不出来');
  assert.match(app, /b\.style\.setProperty\('--tc', t\.c\)/, '颜色没传进样式');
  // 老徐 260915：四段前面都要一个不夸张的 emoji
  // 🔴 别漏 \b：note: '…' 里的 note 也以 e 结尾，不加词边界会多数出三个
  const emos = [...tabs.matchAll(/\be: '([^']+)'/g)].map((m) => m[1]);
  assert.equal(emos.length, 4, '有的段没给 emoji');
  assert.equal(new Set(emos).size, 4, '两段用了同一个 emoji');
  assert.match(app, /<span class="dt-e" aria-hidden="true">/, 'emoji 没画出来');
  const tab = css.match(/^\.deck-tab \{([^}]*)\}/m)[1];
  assert.match(tab, /flex: 1 1 0/, '标签还是按内容宽 ⇒ 缩在左边一小截');
  assert.match(tab, /var\(--tc/, '样式里没用那个颜色');
  // 折起来也得留着颜色，否则折着就认不出是哪四块
  assert.match(css, /\.deck\.collapsed \.deck-tab \{[^}]*--tc/, '折叠后丢了颜色');
});

test('搜索那页不显示「紧凑／详细」—— 它一张卡片都没有', () => {
  // 老徐 260915：「搜索这里没有所谓的紧凑型嘛，有吗？就这一个比较特殊嘛」
  const fn = app.match(/function renderDeck\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /hv\.hidden = cur\.k === 'web'/, '搜索页还挂着紧凑按钮');
  assert.doesNotMatch(fn, /hv\.hidden = false/, '写死成不藏了');
});

test('搜索引擎不止三个，且每个都有能用的地址', () => {
  const raw = fs.readFileSync(p('app.js'), 'utf8');   // 🔴 读原文：剥注释会把网址里的 // 削掉
  const eng = raw.match(/const WEB_ENGINES = \[([\s\S]*?)\];/)[1];
  const us = [...eng.matchAll(/u: '(https:\/\/[^']+)'/g)].map((m) => m[1]);
  assert.ok(us.length >= 6, '引擎太少：' + us.length);
  assert.equal(new Set(us).size, us.length, '有两个引擎地址一样');
  for (const u of us) assert.match(u, /[?&][a-z_]+=$/i, '地址末尾不是待拼关键词的形态：' + u);
  // 老徐 260915 点名的八个，一个都不能少；知乎／小红书／抖音他说先不要
  for (const t of ['百度', '必应', '谷歌', '搜狗', 'B站', 'YouTube', 'GitHub', 'Twitter']) {
    assert.match(eng, new RegExp("t: '" + t + "'"), '少了 ' + t);
  }
  for (const t of ['知乎', '小红书', '抖音']) assert.doesNotMatch(eng, new RegExp("t: '" + t + "'"), t + ' 他说先不要');
  // 名单删过东西之后，存着的那个可能已经不存在 ⇒ 必须回落，否则一个都不亮
  assert.match(app, /const curEngine = \(\) => WEB_ENGINES\.find/, '没有回落 ⇒ 删掉某个引擎后老偏好会指空');
  const seg = css.match(/\.eng-seg button \{([^}]*)\}/)[1];
  assert.match(seg, /flex: 1 1 0/, '引擎排没铺开（老徐：「也可以再宽一点」）');
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
  const pin = css.match(/^\.pin \{([^}]*)\}/m)[1];
  assert.match(pin, /right: calc\(var\(--strip-w/, '那颗「捷」没让开竖条');
  // 🔴 必须在右【下】角：上面那行是标签徽章，放右上会跟「官/自/备」叠在一起；
  //    而且 .tile 是 overflow:hidden，贴太近会被裁掉半颗（老徐 260915 截图指出来的）
  assert.match(pin, /bottom: \d+px/, '又放回右上角了 ⇒ 跟标签徽章叠在一起');
  assert.doesNotMatch(pin, /top: \d+px/, '还带着 top ⇒ 位置会打架');
});
