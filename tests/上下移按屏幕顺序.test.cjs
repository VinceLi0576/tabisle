// 🔴 260915 核实官实证：首页把带「待定」的一级夹重排到最后 ⇒ 屏幕顺序 ≠ 书签栏真实顺序，
// 而上下移一直是按真实顺序算的。他看到的和实际动的不是同一格：
//   · 沉在最底下的夹点「上移」，会说「已经是第一个了」（它在真实顺序里确实是第一个）
//   · 点别的夹「上移」屏幕一格不动，书签栏里却已经换了位置
//   · 每次点击都实打实写回书签树 ⇒ 等他取消待定标记，排列就是乱的，且回溯不了
// 这一份钉住「按屏幕顺序算」这件事。另外本仓库此前没有任何一条测试覆盖到「显示顺序」这一层。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const p = (f) => path.join(__dirname, '..', f);
const nocomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
require(path.join(__dirname, '../bookmark-core.js'));
const BmCore = require(path.join(__dirname, '../bm-core.js'));

test('🔴 一级夹的上下移要按屏幕顺序算，不是按书签栏原始顺序', () => {
  assert.match(app, /function visualNudgeTarget\(id, dir\)/, '没有按屏幕顺序算的那一层');
  assert.match(app, /const to = visual === undefined \? BmCore\.nudgeTarget\(bar, String\(id\), dir\) : visual;/,
    'nudge 没优先用屏幕顺序的结果');
  const fn = app.match(/function visualNudgeTarget\(id, dir\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /if \(dir !== 'up' && dir !== 'down'\) return undefined;/, '把进出层级也拦了 ⇒ 左右移会失灵');
  assert.match(fn, /String\(node\.parentId\) !== String\(bar\?\.id\)/, '没限定一级 ⇒ 子夹会走错逻辑');
  assert.match(fn, /at > me \? at \+ 1 : at/, '往后挪没 +1 ⇒ 会少挪一格（自己先被抽走，后面整体前移）');
  assert.match(fn, /shownTopFolders\(\)/, '没用屏幕顺序');
  // 🔴 真机验出来的第二层：待定的夹永远在最后那一段，不可能往上走出去。
  //   不限定在同一段内的话，会变成「屏幕纹丝不动、书签栏里跳了十几位」——比原来的错更难察觉。
  assert.match(fn, /const dim = isDeprecated\(node\);/, '没判断它属于哪一段');
  assert.match(fn, /\.filter\(\(f\) => isDeprecated\(f\) === dim\)/, '没限定在同一段内 ⇒ 会跨段乱挪');
});

test('屏幕顺序＝先不待定后待定，跟首页渲染用的是同一套', () => {
  const fn = app.match(/function shownTopFolders\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(fn, /deprecatedLast/, '没沿用同一个分区函数');
  assert.match(fn, /filter\(\(f\) => !isDeprecated\(f\)\)[\s\S]*?filter\(\(f\) => isDeprecated\(f\)\)/,
    '分区顺序跟 render 里那句对不上 ⇒ 两边算出来的屏幕顺序会不一样');
  // render 里那句必须还是同一个形状，否则这条测试保护的前提就没了
  assert.match(app, /const ordered = \[\.\.\.folders\.filter\(f => !isDeprecated\(f\)\), \.\.\.folders\.filter\(f => isDeprecated\(f\)\)\]/,
    'render 的排法变了 ⇒ shownTopFolders 要跟着改');
});

test('底层 nudgeTarget 本身没变（它按真实顺序算是对的，只是不该直接喂给一级夹）', () => {
  const bar = { id: '1', children: [
    { id: '10', title: 'B', children: [] },
    { id: '11', title: 'A', children: [] },
    { id: '12', title: 'C', children: [] },
  ] };
  // 真实顺序 B A C：对 B 点上移 ⇒ 它确实已经是第一个
  assert.equal(BmCore.nudgeTarget(bar, '10', 'up'), null);
  // 对 A 点上移 ⇒ 挪到下标 0
  assert.deepEqual(BmCore.nudgeTarget(bar, '11', 'up'), { parentId: '1', index: 0 });
  // 对 A 点下移 ⇒ 浏览器语义要 +2
  assert.deepEqual(BmCore.nudgeTarget(bar, '11', 'down'), { parentId: '1', index: 3 });
});
