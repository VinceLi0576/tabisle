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

test('说明是标题栏底下自己一个小框，只在折叠时出现', () => {
  assert.match(css, /\.note-card, \.note-card\.empty \{ display: none; \}/, '说明小框默认没藏 ⇒ 展开时会把版面撑散');
  const box = css.match(/\.is-collapsed > \.note-card:not\(\.empty\)[^{]*\{([^}]*)\}/)[1];
  assert.match(box, /display: -webkit-box/, '折叠时没把说明小框放出来');
  assert.match(box, /border:/, '不是一个框，只是一行字');
  assert.match(box, /-webkit-line-clamp:\s*3/, '没封顶 ⇒ 写五百字会撑成一屏');
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

test('没写说明的夹不出这个框，写了的点一下就能改', () => {
  const fn = app.match(/function noteCardEl\(f, fixedText\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(fn, /if \(!t\) \{ box\.classList\.add\('empty'\); return box; \}/, '没写说明也挂一个空框 ⇒ 31 个夹全是噪音');
  assert.match(app, /closest\('\.hd-note-btn, \.note-card-btn'\)/, '点说明框打不开编辑器');
});

test('收集箱有一句写死的「这是什么」，折叠展开都在；最近访问不写说明', () => {
  assert.match(app, /noteCardEl\(f, opts\.fixed \? '收集箱：/, '收集箱没有自己的说明框');
  assert.match(css, /\.note-card\.fixed \{ display: -webkit-box; \}/, '收集箱那句展开后会消失');
  assert.ok(!/inbox-hint/.test(app), '标题行上那句灰字还在');
  const html = fs.readFileSync(p('newtab.html'), 'utf8');
  assert.ok(!/recent-note/.test(html), '最近访问不该有说明框（老徐：下面也不用写说明）');
  assert.ok(!/inbox-hint/.test(html), '最近访问标题行上那句灰字还在');
});

test('最近访问最多 8 条', () => {
  assert.match(app, /store\.recent\(8\)/, '最近访问还在取 8 条以上');
});
