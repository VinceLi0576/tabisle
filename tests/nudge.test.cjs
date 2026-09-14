// 上移 / 下移 / 升一层 / 降一层：只测「该落到哪儿」这段纯算
const { test } = require('node:test');
const assert = require('node:assert/strict');
const BmCore = require(require('node:path').join(__dirname, '..', 'bm-core.js'));

//  书签栏
//   ├ 工具(10)
//   │   ├ A(100)  书签
//   │   ├ AI(101) 夹
//   │   │   └ B(1010) 书签
//   │   └ C(102)  书签
//   ├ 学习(11) 夹
//   └ 散的(12) 书签
const bar = { id: '1', title: '书签栏', children: [
  { id: '10', title: '工具', children: [
    { id: '100', title: 'A', url: 'https://a.com/' },
    { id: '101', title: 'AI', children: [{ id: '1010', title: 'B', url: 'https://b.com/' }] },
    { id: '102', title: 'C', url: 'https://c.com/' },
  ] },
  { id: '11', title: '学习', children: [] },
  { id: '12', title: '散的', url: 'https://d.com/' },
] };
const T = (id, dir) => BmCore.nudgeTarget(bar, id, dir);

test('上移就是往前挪一格；已经在第一个就动不了', () => {
  assert.deepEqual(T('101', 'up'), { parentId: '10', index: 0 });
  assert.equal(T('100', 'up'), null, 'A 已经是第一个');
});

test('🔴 下移的下标要 +2，不是 +1 —— 浏览器是先把自己抽走再插进去', () => {
  // 抽走之后后面的整体前移一格，想落到「原来那个后面」就得写 index+2
  assert.deepEqual(T('100', 'down'), { parentId: '10', index: 2 });
  assert.deepEqual(T('101', 'down'), { parentId: '10', index: 3 });
  assert.equal(T('102', 'down'), null, 'C 已经是最后一个');
});

test('升一层 = 变成父夹的同级，紧跟在父夹后面', () => {
  assert.deepEqual(T('1010', 'out'), { parentId: '10', index: 2 }, 'B 升一层，落在 AI 后面');
  assert.deepEqual(T('102', 'out'), { parentId: '1', index: 1 }, 'C 升到书签栏，落在「工具」后面');
});

test('已经在最外层就升不动了', () => {
  assert.equal(T('10', 'out'), null);
  assert.equal(T('12', 'out'), null);
});

test('降一层 = 收进紧挨着的前一个文件夹，放在末尾', () => {
  assert.deepEqual(T('102', 'in'), { parentId: '101', index: 1 }, 'C 收进 AI，排在 B 后面');
  assert.deepEqual(T('12', 'in'), { parentId: '11', index: 0 }, '散的 收进「学习」');
});

test('前面没有东西、或者前面那个是书签，就降不动', () => {
  assert.equal(T('100', 'in'), null, '前面什么都没有');
  assert.equal(T('101', 'in'), null, '前面是书签 A，不是夹');
  assert.deepEqual(T('11', 'in'), { parentId: '10', index: 3 }, '前面是「工具」夹，所以「学习」能收进去');
});

test('找不到的 id、坏方向、空树，都安静地返回 null', () => {
  assert.equal(T('没这个', 'up'), null);
  assert.equal(T('100', '瞎写'), null);
  assert.equal(BmCore.nudgeTarget(null, '100', 'up'), null);
});

test('置灰用的那个表，要跟逐个算的结果一致', () => {
  const n = BmCore.nudgeable(bar, '101');
  assert.deepEqual(n, { up: true, down: true, in: false, out: true });
  assert.deepEqual(BmCore.nudgeable(bar, '100'), { up: false, down: true, in: false, out: true });
});
