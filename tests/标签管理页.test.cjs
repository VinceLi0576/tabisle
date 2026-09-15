// 标签管理页（老徐 260914：「点『标签』其实应该跳到一个专门的标签页面，把每一个标签都定义一下，
// 让我能在标签页里做统一的管理和整理……像链接的标签、文件夹的标签，全都得独立开来」）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
const nocomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
const html = fs.readFileSync(p('newtab.html'), 'utf8');
const css = nocomment(fs.readFileSync(p('style.css'), 'utf8'));

test('顶栏「标签」两个字是入口，不再只是个说明文字', () => {
  assert.match(html, /id="tagpage-btn"/, '没有入口按钮');
  assert.match(html, /<section class="organize tagpage" id="tagpage" hidden>/, '没有这一页的壳');
  assert.match(app, /\$\('#tagpage-btn'\)\.addEventListener\('click'/, '入口没接上');
});

test('两套标签并排，各算各的用量', () => {
  const fn = app.match(/function renderTagPage\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /\['link', '书签的标签', tagList\(\)/, '少了书签那一栏');
  assert.match(fn, /\['folder', '文件夹的标签', fTagList\(\)/, '少了文件夹那一栏');
  assert.match(app, /function tagUsage\(tagId\)/, '书签标签没数用量');
  assert.match(app, /function fTagUsage\(tagId\)/, '文件夹标签没数用量');
  // 文件夹标签只有一级分组能打 ⇒ 用量也只能数一级
  const f = app.match(/function fTagUsage\(tagId\) \{[\s\S]*?\n  \}/)[0];
  assert.match(f, /bar\?\.children \|\| \[\]/, '数用量时没限定一级分组');
});

test('🔴 「排到最后」这个标记只能出现在文件夹标签上', () => {
  // 书签标签里可能留着历史数据的 dim（早先那版「排到最后」挂在书签标签上）⇒ 别当真显示
  assert.match(app, /kind === 'folder' && t\.dim \?/, '书签标签也会显示「排到最后」');
});

test('🚫 这一页不做批量打标签（老徐 260914 明确废止）', () => {
  const fn = app.match(/function renderTagPage\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /🚫 这里不批量打标签/, '说明里没写清楚这件事不做');
  // 这一页只该有这几个动作
  const acts = [...app.matchAll(/data-act="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(acts)].sort(), ['add', 'del', 'edit', 'merge'], '动作多了或少了：' + acts.join(' '));
});

test('删标签只去掉「谁挂了它」，🚫 书签和文件夹本身一个不动', () => {
  const fn = app.match(/async function deleteTagOf\(kind, id\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(fn, /removeTree|chrome\.bookmarks/, '碰到书签树了');
  assert.match(fn, /meta\.folderTags = fTagList\(\)\.filter/, '删文件夹标签没从它那份名单里删');
  assert.match(fn, /meta\.tags = meta\.tags\.filter/, '删书签标签没从它那份名单里删');
  assert.match(fn, /confirm\(/, '删之前不问一声');
});

test('合并走两步点击，🚫 不依赖菜单的关闭事件（那个事件根本不存在）', () => {
  // closeMenu 只是 menu.hidden = true，没有任何「关闭了」的信号可以等 ⇒ 用它做单选会永远挂着
  assert.doesNotMatch(app, /menu-closed/, '又用上那个不存在的事件了');
  assert.match(app, /function setMergeMode\(id\)/, '没有选靶模式');
  assert.match(app, /async function doMerge\(id, pick\)/, '没有合并动作');
  const fn = app.match(/async function doMerge\(id, pick\) \{[\s\S]*?\n  \}/)[0];
  assert.doesNotMatch(fn, /chrome\.bookmarks/, '合并碰到书签树了');
  assert.match(fn, /v\.tags\.map\(\(x\) => \(x === id \? pick : x\)\)/, '没把打了 A 的改挂到 B');
  assert.match(css, /\.tagrow\.merging/, '选中那行没有视觉反馈');
  assert.match(css, /\.tagrow\.mergetarget/, '可选目标没有视觉提示');
});

test('这一页跟分组整理页互相让位，🚫 不许同时开着', () => {
  const fn = app.match(/function toggleTagPage\(on\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(show\) toggleOrganize\(false\)/, '开这一页时没关掉分组整理');
  assert.match(app, /if \(show && !\$\('#tagpage'\)\.hidden\) toggleTagPage\(false\)/, '开分组整理时没关掉这一页');
});
