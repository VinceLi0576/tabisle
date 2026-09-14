const test = require('node:test');
const assert = require('node:assert');
const BmCore = require('../bm-core.js');

const bar = { id: '1', title: '书签栏', children: [
  { id: '10', title: '工具', children: [
    { id: '100', title: 'a', url: 'https://a.com/' },
    { id: '101', title: 'AI', children: [
      { id: '1010', title: 'b', url: 'https://b.com/' },
      { id: '1011', title: '更深', children: [{ id: '10110', title: 'c', url: 'https://c.com/' }] },
    ] },
  ] },
  { id: '11', title: '别的', children: [{ id: '110', title: 'd', url: 'https://d.com/' }] },
  { id: '12', title: '散的', url: 'https://loose.com/' },
] };

test('范围含全部子孙：夹自己、子夹、书签，一个不落', () => {
  const s = BmCore.scopeIds(bar, ['10']);
  assert.deepStrictEqual([...s].sort(), ['10', '100', '101', '1010', '1011', '10110'].sort());
});

test('范围外的一律不在集合里', () => {
  const s = BmCore.scopeIds(bar, ['10']);
  for (const id of ['1', '11', '110', '12']) assert.ok(!s.has(id), id + ' 不该在范围里');
});

test('附加子夹时只圈住那一支，兄弟支不进来', () => {
  const s = BmCore.scopeIds(bar, ['101']);
  assert.deepStrictEqual([...s].sort(), ['101', '1010', '1011', '10110'].sort());
  assert.ok(!s.has('100'));
});

test('附加书签栏根 = 全部都在范围里', () => {
  const s = BmCore.scopeIds(bar, ['1']);
  assert.strictEqual(s.size, 10);
});

test('没附加任何东西时集合是空的（调用方据此判定「没有范围」）', () => {
  assert.strictEqual(BmCore.scopeIds(bar, []).size, 0);
  assert.strictEqual(BmCore.scopeIds(bar, null).size, 0);
  assert.strictEqual(BmCore.scopeIds(null, ['10']).size, 0);
});

test('卡片上的数字：条数只数书签，子夹数递归', () => {
  const st = BmCore.scopeStats(bar, '10');
  assert.strictEqual(st.title, '工具');
  assert.strictEqual(st.count, 3);         // a b c
  assert.strictEqual(st.subfolders, 2);    // AI、更深
  assert.strictEqual(st.path, '书签栏 / 工具');
});

test('路径从根一路拼下来，深层也对', () => {
  assert.strictEqual(BmCore.folderPath(bar, '1011'), '书签栏 / 工具 / AI / 更深');
  assert.strictEqual(BmCore.folderPath(bar, '1'), '书签栏');
  assert.strictEqual(BmCore.folderPath(bar, '不存在'), '');
});

test('指向书签或不存在的 id 时不给统计，调用方不会拿到假范围', () => {
  assert.strictEqual(BmCore.scopeStats(bar, '12'), null);   // 这是书签不是夹
  assert.strictEqual(BmCore.scopeStats(bar, '没有'), null);
});
