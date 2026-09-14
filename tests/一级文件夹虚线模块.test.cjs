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
  const box = css.match(/\.card > \.note-card, #recent > \.note-card \{([^}]*)\}/)[1];
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

test('折叠状态下点说明要先展开，否则编辑框在藏起来的容器里看不见', () => {
  const open = app.match(/function openNoteEditor\(id\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(open, /is-collapsed/, '没处理折叠状态');
  assert.match(open, /toggleFolder\(section\)/);
});

test('没写说明那一行的类名不许叫 .empty —— 全局有个 .empty 会把框撑到 116px', () => {
  // 实撞：span 挂上 .empty 之后继承了 .empty{margin-top:80px}，框从 38px 变 116px，查了半天
  assert.ok(!/note-card-btn' \+ \(t \? '' : ' empty'\)/.test(app), '又叫回 .empty 了');
  assert.match(app, /note-card-btn' \+ \(t \? '' : ' note-blank'\)/, '空说明那一行没有自己的类名');
  assert.match(css, /\.note-card-btn\.note-blank \{/, '样式没跟着改名');
});

test('没写说明时这一行说清楚这夹由什么构成，点一下就能写', () => {
  const fn = app.match(/function noteCardEl\(f\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(fn, /个文件夹 · /, '没说明时没有给出构成');
  assert.match(fn, /条书签/, '没说明时没有给出条数');
  assert.match(fn, /点这里写一句/, '没说明时没有写说明的入口');
  assert.match(app, /closest\('\.hd-note-btn, \.note-card'\)/, '点说明框打不开编辑器');
});

test('收集箱和最近访问的说明常驻，但内容是可改的，🚫 不许写死在代码里', () => {
  // 老徐 260914：「你不能自动给我写进去啊，那别人用的时候没有 AI 怎么写？不能直接写到代码里面去」
  assert.match(app, /const DEFAULT_NOTES = \{/, '没有默认文案这一层');
  assert.match(app, /recentNote: undefined, inboxNote: undefined/, '这两个键没进 DEFAULTS ⇒ 写得进读不回来');
  const set = app.match(/function setFolderNote\(id, text\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(set, /prefs\[k\] = String\(text/, '这两块的说明存不回去 ⇒ 等于还是写死的');
  const get = app.match(/const folderNote = \(id\) => \{([\s\S]*?)\n  \};/)[1];
  assert.match(get, /typeof prefs\[k\] === 'string'/, '他清空之后应该真的空着，不能又弹回默认那句');
  assert.match(app, /pseudoNote = \(id\) =>/, '收集箱拿不到稳定标识，说明得另找地方存');
  assert.ok(!/inbox-hint/.test(app), '标题行上那句灰字还在');
  const html = fs.readFileSync(p('newtab.html'), 'utf8');
  assert.match(html, /id="recent-note"><\/div>/, '最近访问的说明还硬写在 HTML 里');
  assert.match(html, /<span class="title">最近访问<\/span><span class="level-label">/, '最近访问标题后面该接层级标');
  assert.ok(!/inbox-hint/.test(html), '最近访问标题行上那句灰字还在');
  assert.match(html, /<span class="hd-toggle"><\/span>/,
    '最近访问标题那行少一个撑开的空档 ⇒「紧凑」会贴到标题旁边，右边按钮排不齐');
});

test('标题栏点空白处＝展开收起，跟下面每个文件夹一样，🚫 不许弹侧栏', () => {
  // 老徐 260914：「我点收集箱它就直接弹出左边，这样不对……展开逻辑也是一样的」
  const h = app.match(/const rowHead = e\.target\.closest\('\.card > \.head'\);([\s\S]*?)\n    \}/);
  assert.ok(h, '折叠行没有接点击');
  assert.match(h[1], /button, \.grip, \.swatch, \.hd-name, \.tag/, '没把按钮和改名排除掉');
  assert.match(h[1], /toggleFolder\(/, '点了没有展开');
  assert.ok(!/openDetail\(/.test(h[1]), '点一行就弹侧栏 ⇒ 跟下面的文件夹不一致');
});

test('最近访问和收集箱的标题结构跟下面的文件夹一样，只有颜色不同', () => {
  const html = fs.readFileSync(p('newtab.html'), 'utf8');
  const head = html.match(/<div class="recent-head"[\s\S]*?<\/div>/)[0];
  assert.match(head, /class="folder-toggle"/, '最近访问还在用自己那套箭头');
  assert.match(head, /class="level-mark"/, '最近访问没有层级条');
  assert.match(head, /class="level-label"/, '最近访问没有层级标');
  assert.ok(!/class="chev"/.test(head), '旧的 chev 还留着');
  // 收集箱走 headEl，层级条和层级标不能再被 fixed 跳过
  assert.match(app, /^\s*levelMark\(opts\.level \|\| 1\) \+ \(`<button class="folder-toggle"/m, '收集箱还是没有层级条');
  assert.match(app, /^\s*`<span class="level-label">\$\{opts\.level \|\| 1\}级<\/span>` \+/m, '收集箱还是没有层级标');
  assert.match(css, /\.recent-head \.folder-toggle \{ color: var\(--accent\) \}|\.recent-head \.folder-toggle \{ color: var\(--accent\); \}/, '最近访问的箭头没跟着换色调');
});

test('最近访问最多 8 条', () => {
  assert.match(app, /store\.recent\(8\)/, '最近访问还在取 8 条以上');
});
