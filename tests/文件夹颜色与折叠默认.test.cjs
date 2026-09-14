// 文件夹颜色改成 8 个带名字的固定色，入口在详情侧栏；左栏点夹只安静设 AI 范围（老徐 260914）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
const nocomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

test('8 个带名字的固定色，首页和后台用同一份', () => {
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  const ew = nocomment(fs.readFileSync(p('editor-worker.js'), 'utf8'));
  const grab = (s) => [...s.matchAll(/\{\s*c:\s*'(#[0-9a-f]{6})',\s*n:\s*'(.)'\s*\}/gi)].map((m) => m[1] + m[2]);
  const a = grab(app.match(/const FOLDER_COLORS = \[([\s\S]*?)\];/)[1]);
  const b = grab(ew.match(/const FOLDER_COLORS=\[([\s\S]*?)\];/)[1]);
  assert.equal(a.length, 8, '不是 8 个色');
  assert.deepEqual(a, b, '首页和后台两份颜色对不上 ⇒ 侧栏选的色首页认不出来');
  assert.match(app, /const PALETTE = FOLDER_COLORS\.map/, '标签那边没跟着用同一份');
});

test('改颜色走详情侧栏，🚫 不再点首页那根细色条', () => {
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  assert.ok(!/closest\('\.swatch'\)/.test(app), '色条还是改颜色的入口（老徐：那太难了）');
  const html = fs.readFileSync(p('sidepanel.html'), 'utf8');
  assert.match(html, /id="fp-colors"/, '侧栏没有颜色那一排');
  const sp = nocomment(fs.readFileSync(p('sidepanel.js'), 'utf8'));
  assert.match(sp, /folderPatch\(\{color:o\.c\}\)/, '侧栏选了色不往后台写');
});

test('后台只认这 8 个色，别的一律当成不上色', () => {
  const ew = nocomment(fs.readFileSync(p('editor-worker.js'), 'utf8'));
  const blk = ew.match(/if\(m\.color!==undefined\)\{([\s\S]*?)\n      \}/)[1];
  assert.match(blk, /FOLDER_COLORS\.some\(x=>x\.c===m\.color\)/, '没校验颜色值 ⇒ 侧栏传什么就存什么');
  assert.match(blk, /delete g\.color/, '不能取消颜色');
});

test('左栏点文件夹只安静设 AI 范围：🚫 不弹面板、🚫 不写记录', () => {
  // 老徐 260914：「我点左边的时候，不要给我弹出来这些东西，展现出来让我看得见就好了」
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  assert.match(app, /detail: \{ id: it\.dataset\.id, toggle: true, quiet: true \}/, '左栏那条没标安静');
  assert.match(app, /detail: \{ id: String\(id\), quiet: false \}/, '「让 AI 看着写一条」那条该出声，它要把面板打开');
  const ai = nocomment(fs.readFileSync(p('ai.js'), 'utf8'));
  assert.match(ai, /async function setScope\(id, quiet = false\)/, 'setScope 没有安静模式');
  assert.match(ai, /if \(quiet\) return;/, '安静模式没有真的跳过弹面板和写记录');
});

test('⇕ 折叠：一次全折全开，外加三种默认状态', () => {
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  const html = fs.readFileSync(p('newtab.html'), 'utf8');
  assert.match(html, /id="fold-all"/, '顶栏没有折叠按钮');
  assert.match(app, /foldDefault: 'auto'/, 'foldDefault 没进 DEFAULTS ⇒ 写得进读不回来');
  const fc = app.match(/function folderCollapsed\(f\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(fc, /prefs\.foldDefault === 'closed'/, '全局默认折叠不生效');
  assert.match(fc, /prefs\.foldDefault === 'open'/, '全局默认展开不生效');
  assert.match(fc, /typeof saved === 'boolean'/, '自己逐个设的应该优先于全局默认');
});
