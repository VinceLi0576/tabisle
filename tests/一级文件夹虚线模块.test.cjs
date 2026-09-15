// 一级文件夹统一成虚线模块（老徐 260914）：折叠时一行回答「这个夹是干什么的」，展开时内容回答「里面有什么」。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
const nocomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const css = nocomment(fs.readFileSync(p('style.css'), 'utf8'));
const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));

test('只有一级文件夹变虚线模块，二级三级这轮不动', () => {
  assert.match(css, /\.card\[data-kind="folder"\]\s*\{[^}]*border:\s*1px dashed/, '一级没套虚线框');
  const sub = css.match(/^\.sub \{[^}]*\}/m);
  assert.ok(sub && !/dashed/.test(sub[0]), '子夹被顺手改了 —— 这轮只管一级');
});

test('普通一级用各自的分组色、且比收集箱/最近访问淡', () => {
  const norm = css.match(/\.card\[data-kind="folder"\]\s*\{([^}]*)\}/)[1];
  assert.match(norm, /--gc/, '没用分组色，三十多个夹会长得一模一样');
  const nw = Number(norm.match(/dashed color-mix\(in srgb, var\(--gc[\s\S]*?\)\)\s*(\d+)%/)[1]);   // --gc 自带一层嵌套括号，别用 [^)]*
  const inbox = css.match(/\.card\.inbox \{([^}]*)\}/)[1];
  assert.match(inbox, /1\.5px dashed var\(--accent\)/, '收集箱要保持显眼');
  assert.ok(nw <= 50, `普通分组边框 ${nw}% 太重，三十多个一起会抢眼`);
});

test('折叠行分两段：数量跟在名字层级后面，说明在右段，按钮最后', () => {
  const seg = (sel) => Number((css.match(new RegExp(`\\.is-collapsed > \\.head ${sel} \\{[^}]*order:\\s*(-?\\d+)`)) || [])[1]);
  assert.equal(seg('\\.n'), 1, '数量不在左段末尾');
  assert.equal(seg('\\.hd-toggle'), 2, '说明不在右段');
  assert.ok(css.includes('.is-collapsed > .head .more { order: 3; }') || /\.more \{ order: 3/.test(css), '操作按钮没排到最后');
});

test('说明是标题栏底下自己一个小框，折叠展开都在', () => {
  // 老徐 260914 复议：「如果有备注就显示备注」⇒ 展开后那一行也留着
  // 选择器列表会随着新框加长（#recent、#pinned…），只锚住开头那一段
  const box = css.match(/\.card > \.note-card[^{]*\{([^}]*)\}/)[1];
  assert.match(box, /display: flex/, '说明小框没显示出来');
  assert.match(box, /border:/, '不是一个框，只是一行字');
  const inner = css.match(/\.note-card-btn \{([^}]*)\}/)[1];
  assert.match(inner, /max-height: calc\(3 \* 1\.7em\)/, '没封顶 ⇒ 写五百字会撑成一屏');
  assert.match(inner, /overflow: hidden/, '封了顶不裁掉，等于没封');
});

test('一级标题栏上不挂子夹快捷和标签筛选，那些东西往下排', () => {
  // 老徐 260914：「上面堆了一堆文件夹、还显示那么多标签，这也不合理」
  assert.match(app, /opts\.tags && opts\.level > 1 \? `<span class="hd-subs">/, '一级标题栏还挂着子夹快捷');
  assert.match(app, /opts\.tags && opts\.level > 1 \? `<span class="hd-tags">/, '一级标题栏还挂着标签筛选');
});

test('说明小框在 DOM 里排在标题栏和内容区之间', () => {
  const card = app.match(/function cardEl\(f, opts = \{\}\) \{([\s\S]*?)\n  \}/)[1];
  const iHead = card.indexOf("headEl(f, 'head'"), iNote = card.indexOf('noteCardEl('), iBody = card.indexOf('bodyEl(');
  assert.ok(iHead >= 0 && iNote > iHead && iBody > iNote, `顺序不对：head ${iHead} / note ${iNote} / body ${iBody}`);
});

test('🔴 标题栏那颗「说明」按钮和就地编辑框整套退场（老徐 260915）', () => {
  // 他原话：「这去掉，我们从侧边栏展开去填写就行了」
  // ⇒ 说明只剩一条路：右边那整条 → 侧栏里填。🚫 别再留第二个入口
  assert.doesNotMatch(app, /class="hd-note-btn/, '标题栏还挂着「说明」按钮');
  assert.doesNotMatch(app, /function openNoteEditor/, '就地编辑框还在');
  assert.doesNotMatch(app, /class="fn-input"/, '编辑框的输入区还在');
  assert.doesNotMatch(app, /function noteEl\(/, '那个隐藏容器还在');
  assert.doesNotMatch(app, /closest\('\.fn-edit'\)/, '还接着编辑入口的点击');
});

test('没写说明那一行的类名不许叫 .empty —— 全局有个 .empty 会把框撑到 116px', () => {
  // 实撞：span 挂上 .empty 之后继承了 .empty{margin-top:80px}，框从 38px 变 116px，查了半天
  assert.ok(!/note-card-btn' \+ \(t \? '' : ' empty'\)/.test(app), '又叫回 .empty 了');
  assert.match(app, /note-card-btn' \+ \(t \? '' : ' note-blank'\)/, '空说明那一行没有自己的类名');
  assert.match(css, /\.note-card-btn\.note-blank \{/, '样式没跟着改名');
});

test('🔴 说明框只显示、不接编辑 —— 要改走右边那一整条开侧栏（老徐 260915）', () => {
  // 他原话：「点每一个文件夹上面的备注名，它就直接跳出一个框……其实这些都不需要，
  //   下面这一段不能直接操作；要操作的话，肯定是通过右边那个箭头打开侧边栏才能操作」
  const fn = app.match(/function noteCardEl\(f\) \{([\s\S]*?)\n  \}/)[1];
  assert.doesNotMatch(fn, /box\.dataset\.note/, '说明框还挂着编辑入口 ⇒ 点一下又弹框了');
  assert.doesNotMatch(app, /closest\('\.hd-note-btn, \.note-card'\)/, '点说明框还会开编辑器');
  // 🔄 260915 再改：没写说明时整条不画了 —— 空框跟标题一样高、一屏重复六遍、
  //   而且说明框已经只读，那句引导点不动 ⇒ 纯占地方。要写说明只剩一条路：右边那一整条 → 侧栏。
  assert.match(fn, /box\.classList\.add\('is-empty'\)/, '空说明还在占一整行');
  assert.match(css, /\.note-card\.is-empty \{ display: none/, '空说明没被藏掉');
  // 条数标题栏右边已经有一份，这儿不重复报数
  assert.doesNotMatch(fn, /个文件夹 · /, '又在说明框里报了一遍条数');
});

test('右边一整条＝这个文件夹的入口，贯穿整个框（老徐 260915）', () => {
  // 他原话：「右边这个箭头你也得设计一下，放在整个框的最右边，可以做宽一点。
  //   相当于整个文件夹，甚至展开子文件夹时，右边一整条都属于关于整个文件夹的定位」
  assert.match(app, /function folderStripEl\(f\)/, '没有这一条');
  assert.match(app, /card\.appendChild\(folderStripEl\(f\)\)/, '这一条没挂到文件夹框上');
  // 老徐 260915：「二级文件夹……其实也需要有这个箭头出现，二级这一列在右边显示这个颜色」
  assert.match(app, /sub\.appendChild\(folderStripEl\(f\)\)/, '二级没有这一条');
  assert.match(css, /\.sub > \.fstrip \{/, '二级那条没样式 ⇒ 会套用一级的宽度，把二级挤变形');
  assert.match(css, /\.sub \{ position: relative; padding-right/, '二级框没给这一条让位');
  assert.doesNotMatch(app, /class="hd-detail"/, '标题栏里那颗「›」还在 ⇒ 两个入口做同一件事');
  assert.match(app, /closest\('\.hd-detail, \.fs-more'\)/, '点这一条开不了详情');
  // 老徐 260915：「要在左边找一个小箭头去展开缩小，体验太差了」⇒ 上段收起展开、下段详情，两件都在右边
  assert.match(app, /closest\('\[data-stripfold\]'\)/, '右边这条不能收起展开 ⇒ 还得跑去左边点那个小三角');
  assert.match(css, /\.fs-fold \{/, '上段没样式');
  // 🔴 特异性坑：光写 .fs-more 会被上面 .fstrip > button 的 flex:none 压掉，下段就只剩 17px 高
  assert.match(css, /\.fstrip > \.fs-more \{[^}]*flex: 1 1 auto/, '下段没撑满 ⇒ 整条下半截点不到');
  assert.match(css, /\.is-collapsed > \.fstrip \.fs-fold svg \{ transform: rotate\(-90deg\)/, '折起来时右边那颗三角不跟着转');
  const st = css.match(/^\.fstrip \{([^}]*)\}/m)[1];
  assert.match(st, /position: absolute/, '不是贯穿整框 ⇒ 展开后下半截点不到');
  assert.match(st, /top: 0; bottom: 0/, '没有从头贯到底');
  const w = Number(st.match(/width: (\d+)px/)[1]);
  assert.ok(w >= 34, '还是窄的（他要「做宽一点」）：' + w);
  // 框要给这一条让出位置，否则卡片会压在它底下
  assert.match(css, /\.card\[data-kind="folder"\], \.card\.inbox \{[^}]*padding-right: 46px/, '框没给这一条让位');
});

test('收集箱和最近访问的说明常驻，但内容是可改的，🚫 不许写死在代码里', () => {
  // 老徐 260914：「你不能自动给我写进去啊，那别人用的时候没有 AI 怎么写？不能直接写到代码里面去」
  assert.match(app, /const DEFAULT_NOTES = \{/, '没有默认文案这一层');
  assert.match(app, /recentNote: undefined, inboxNote: undefined/, '这两个键没进 DEFAULTS ⇒ 写得进读不回来');
  // 🔄 260915 三块合成一个工作台 ⇒ 说明的空壳从每块一个变成整块共用一个，内容跟着当前那一页换
  const set = app.match(/function setFolderNote\(id, text\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(set, /prefs\[k\] = String\(text/, '这两块的说明存不回去 ⇒ 等于还是写死的');
  const get = app.match(/const folderNote = \(id\) => \{([\s\S]*?)\n  \};/)[1];
  assert.match(get, /typeof prefs\[k\] === 'string'/, '他清空之后应该真的空着，不能又弹回默认那句');
  assert.match(app, /pseudoNote = \(id\) =>/, '收集箱拿不到稳定标识，说明得另找地方存');
  assert.ok(!/inbox-hint/.test(app), '标题行上那句灰字还在');
  const html = fs.readFileSync(p('newtab.html'), 'utf8');
  assert.match(html, /id="deck-note"><\/div>/, '工作台的说明还硬写在 HTML 里');
  // 🔄 260915：最近访问的标题变成工作台里的一个标签按钮了，层级标只留在下面每个文件夹上
  assert.match(html, /<span class="deck-tabs" id="deck-tabs"/, '工作台没有标签行');
  assert.ok(!/inbox-hint/.test(html), '最近访问标题行上那句灰字还在');
  // 🔄 260915：撑开右边按钮这件事改由标签行自己 flex:1 干（老徐要「一整行排到头」），
  //    弹性占位反而会跟标签行平分空间 ⇒ 这里改钉标签行铺满
  const deckTab = css.match(/^\.deck-tab \{([^}]*)\}/m)[1];
  assert.match(deckTab, /flex: 1 1 0/, '标签不铺满 ⇒ 缩在左边一小截，右边按钮也排不齐');
});

test('标题栏点空白处＝展开收起，跟下面每个文件夹一样，🚫 不许弹侧栏', () => {
  // 老徐 260914：「我点收集箱它就直接弹出左边，这样不对……展开逻辑也是一样的」
  const h = app.match(/const rowHead = e\.target\.closest\('\.card > \.head'\);([\s\S]*?)\n    \}/);
  assert.ok(h, '折叠行没有接点击');
  assert.match(h[1], /button, \.grip, \.swatch, \.hd-name, \.tag/, '没把按钮和改名排除掉');
  assert.match(h[1], /toggleFolder\(/, '点了没有展开');
  assert.ok(!/openDetail\(/.test(h[1]), '点一行就弹侧栏 ⇒ 跟下面的文件夹不一致');
});

test('工作台的标题结构跟下面的文件夹一样，只有颜色不同', () => {
  // 🔄 260915：最近访问／快捷方式／收集箱三块合成一个带标签行的工作台，标题栏还是那一套壳
  const html = fs.readFileSync(p('newtab.html'), 'utf8');
  const head = html.match(/<div class="recent-head deck-head"[\s\S]*?<\/div>/)[0];
  assert.match(head, /class="folder-toggle"/, '工作台还在用自己那套箭头');
  assert.match(head, /class="level-mark"/, '工作台没有层级条');
  assert.ok(!/class="chev"/.test(head), '旧的 chev 还留着');
  // 收集箱走 headEl，层级条和层级标不能再被 fixed 跳过
  assert.match(app, /^\s*levelMark\(opts\.level \|\| 1\) \+ \(`<button class="folder-toggle"/m, '收集箱还是没有层级条');
  assert.match(app, /^\s*`<span class="level-label">\$\{opts\.level \|\| 1\}级<\/span>` \+/m, '收集箱还是没有层级标');
  assert.match(css, /\.recent-head \.folder-toggle \{ color: var\(--accent\) \}|\.recent-head \.folder-toggle \{ color: var\(--accent\); \}/, '最近访问的箭头没跟着换色调');
});

test('最近访问最多 8 条', () => {
  assert.match(app, /store\.recent\(8\)/, '最近访问还在取 8 条以上');
});
