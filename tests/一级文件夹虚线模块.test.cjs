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

test('说明只显示一行，过长省略', () => {
  const line = css.match(/\.is-collapsed > \.head \.hd-note-line \{([^}]*)\}/)[1];
  assert.match(line, /white-space:\s*nowrap/);
  assert.match(line, /text-overflow:\s*ellipsis/);
  assert.match(line, /overflow:\s*hidden/);
});

test('展开时说明文字不占版面：只读那条藏起来，编辑盒平时是空的', () => {
  assert.match(css, /\.hd-note-line \{ display: none; \}/, '展开时说明行没藏');
  const note = app.match(/function noteEl\(f\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(note, /box\.hidden = true/, '编辑盒默认没藏 ⇒ 展开时长说明又会悬在标题下面');
  assert.ok(!/fn-text/.test(note), '编辑盒里还在渲染只读文字');
});

test('折叠状态下点说明要先展开，否则编辑框在藏起来的容器里看不见', () => {
  const open = app.match(/function openNoteEditor\(id\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(open, /is-collapsed/, '没处理折叠状态');
  assert.match(open, /toggleFolder\(section\)/);
});

test('没写说明的夹要给一个写说明的入口', () => {
  assert.match(app, /hd-note-line.*?empty/, '空说明没有占位入口');
  assert.match(app, /closest\('\.hd-note-btn, \.hd-note-line'\)/, '点说明那一行不能打开编辑器');
});
