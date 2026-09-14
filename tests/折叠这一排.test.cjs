// 折叠这一排：三颗动作按钮 ＋ 一个默认状态，钉在标签那一行的最右边（老徐 260914）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
const nocomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
const html = fs.readFileSync(p('newtab.html'), 'utf8');
const css = nocomment(fs.readFileSync(p('style.css'), 'utf8'));

test('折叠这一排在标签那一行里，且靠右', () => {
  const bar = html.match(/<div class="toolbar"[\s\S]*?\n<\/div>/)[0];
  assert.match(bar, /id="fold-bar"/, '折叠这一排不在工具条里');
  const i = bar.indexOf('id="intro-tags"'), j = bar.indexOf('id="fold-bar"');
  assert.ok(i >= 0 && j > i, '折叠这一排要排在标签后面');
  assert.match(css, /\.fold-bar\{[^}]*margin-left:auto/, '没有靠右');
  assert.match(css, /\.toolbar\{[^}]*flex-wrap:wrap/, '工具条不换行 ⇒ 挤进这一排之后按钮里的字会被折成两行');
  assert.match(css, /\.toolbar button[^{]*\{[^}]*white-space:nowrap/, '按钮里的字没锁成一行');
  assert.ok(!/id="fold-all"/.test(html), '旧的那颗「⇕ 折叠」还在');
});

test('三颗按钮：全部折叠、全部展开、回到默认', () => {
  for (const id of ['fold-close', 'fold-open', 'fold-reset']) {
    assert.match(html, new RegExp(`id="${id}"`), `少一颗 ${id}`);
    assert.match(app, new RegExp(`\\$\\('#${id}'\\)\\.addEventListener\\('click'`), `${id} 没接上`);
  }
  const reset = app.match(/\$\('#fold-reset'\)\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n  \}\);/)[1];
  assert.match(reset, /prefs\.folderCollapsed = \{\}/, '「回到默认」没把逐个设过的清掉');
});

test('默认状态是一个三选一，改完要重画', () => {
  assert.match(html, /data-key="foldDefault"[\s\S]*?data-val="auto"[\s\S]*?data-val="closed"[\s\S]*?data-val="open"/, '默认状态没有三个选项');
  assert.match(app, /seg\.dataset\.key === 'foldDefault'.*render\(\)/, '换了默认不重画，看不出变化');
  assert.match(app, /foldDefault: 'auto'/, 'foldDefault 没进 DEFAULTS ⇒ 写得进读不回来');
});

test('逐个设过的夹优先于全局默认', () => {
  const fc = app.match(/function folderCollapsed\(f\) \{([\s\S]*?)\n  \}/)[1];
  const iSaved = fc.indexOf("typeof saved === 'boolean'"), iDef = fc.indexOf("prefs.foldDefault");
  assert.ok(iSaved >= 0 && iDef > iSaved, '全局默认压过了自己逐个设的');
});
