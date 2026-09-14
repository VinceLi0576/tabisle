// 分组整理：新建分组并进这一页，二级往下平铺，每层末尾一个「新建」格（老徐 260914）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
const nocomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
const css = nocomment(fs.readFileSync(p('style.css'), 'utf8'));
const html = fs.readFileSync(p('newtab.html'), 'utf8');

test('顶栏那颗「新分组」并进了分组整理页', () => {
  assert.ok(!/id="new-group"/.test(html), '顶栏还留着那颗按钮');
  assert.match(html, /id="organize-btn"[^>]*>分组整理</, '按钮没改名');
  assert.match(app, /const newGroup = \(\) => createFolderIn\(bar\.id\)/, '别处要建分组时没有统一入口');
});

test('每一层末尾都有一个「在这儿新建文件夹」的格子', () => {
  assert.match(app, /function newFolderTile\(parentId\)/, '没有新建格');
  assert.match(app, /kids\.appendChild\(newFolderTile\(f\.id\)\)/, '子层末尾没有新建格');
  assert.match(app, /root\.appendChild\(newFolderTile\(bar\.id\)\)/, '一级末尾没有新建格');
  const click = app.match(/\$\('#organize'\)\.addEventListener\('click'[\s\S]*?\n  \}\);/)[0];
  assert.match(click, /closest\('\[data-newin\]'\)/, '点新建格没反应');
  assert.ok(click.indexOf('data-newin') < click.indexOf('openDetail('), '新建格被开详情抢走');
});

test('二级往下平铺，每行几个可选 2/3/4', () => {
  assert.match(css, /#organize \.fkids\{[^}]*grid-template-columns:repeat\(var\(--org-cols/, '子层不是平铺');
  assert.match(app, /orgCols: 3/, 'orgCols 没进 DEFAULTS ⇒ 写得进读不回来');
  assert.match(app, /\[2, 3, 4\]\.map/, '没有 2/3/4 三档');
  const click = app.match(/\$\('#organize'\)\.addEventListener\('click'[\s\S]*?\n  \}\);/)[0];
  assert.match(click, /closest\('\[data-orgcols\]'\)/, '换列数没反应');
});

test('侧栏详情能就地建子文件夹，且新建要打「有意新建」记号', () => {
  const sh = fs.readFileSync(p('sidepanel.html'), 'utf8');
  assert.match(sh, /id="fp-newsub"/, '侧栏没有新建子文件夹的按钮');
  const sp = nocomment(fs.readFileSync(p('sidepanel.js'), 'utf8'));
  assert.match(sp, /EDITOR_FOLDER_CREATE/, '按钮没接上后台');
  const ew = nocomment(fs.readFileSync(p('editor-worker.js'), 'utf8'));
  const blk = ew.match(/if\(m\.type==='EDITOR_FOLDER_CREATE'\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(blk, /markIntentional\(made\.id\)/, '没打记号 ⇒ 十分钟内会被墓碑当回声删掉');
  assert.match(blk, /parent\.url/, '没挡住「往书签上建子夹」');
  const bg = nocomment(fs.readFileSync(p('bg.js'), 'utf8'));
  assert.match(bg, /FOLDER_UPDATE\|FOLDER_CREATE/, '写操作没进不重试名单 ⇒ 超时会重建一个');
});

test('分组整理页顶上要有一行说清楚这一页在改什么', () => {
  const fn = app.match(/function renderOrganize\(\) \{([\s\S]*?)\n  \}/)[1];
  assert.match(fn, /tip\.textContent = '这一页直接改浏览器书签栏/, '顶上那行说明不见了');
});
