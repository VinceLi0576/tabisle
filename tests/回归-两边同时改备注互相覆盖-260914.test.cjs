// 回归：两个页面同时开着改同一份附属数据，后写的不许盖掉先写的
// （260914 grok 和 codex 各自独立发现；老徐日常首页＋侧栏都开着，必撞）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const BmCore = require(require('node:path').join(__dirname, '..', 'bm-core.js'));
const M = BmCore.mergeMetaWrite;
const meta = (o = {}) => ({ items: {}, groups: {}, tags: [], ...o });

test('🔴 A 页给甲加标签、B 页同时给乙写说明 —— 两样都要留住', () => {
  const base = meta({ items: { 甲: { name: '甲' }, 乙: { name: '乙' } } });
  // B 页先落盘：给乙写了说明
  const 存储里现在 = meta({ items: { 甲: { name: '甲' }, 乙: { name: '乙', desc: 'B写的说明' } } });
  // A 页拿着老快照，给甲加了标签
  const A页的 = meta({ items: { 甲: { name: '甲', tags: ['t1'] }, 乙: { name: '乙' } } });
  const out = M(base, A页的, 存储里现在);
  assert.deepEqual(out.items.甲.tags, ['t1'], 'A 加的标签要写进去');
  assert.equal(out.items.乙.desc, 'B写的说明', '🔴 B 写的说明不能被 A 的老快照抹掉');
});

test('我真删掉的，照样删得掉（别把「删除」也当成没动过）', () => {
  const base = meta({ items: { 甲: { name: '甲' } } });
  const 我删了 = meta({ items: {} });
  assert.deepEqual(M(base, 我删了, meta({ items: { 甲: { name: '甲' } } })).items, {});
});

test('我没碰过的条目，即使存储里已经变了，也原样保留', () => {
  const base = meta({ items: { 甲: { desc: '旧' } } });
  const 我没动 = meta({ items: { 甲: { desc: '旧' } } });
  const 别人改了 = meta({ items: { 甲: { desc: '别人写的新说明' } } });
  assert.equal(M(base, 我没动, 别人改了).items.甲.desc, '别人写的新说明');
});

test('锁定和文件夹说明也走同一套，不会互相抹', () => {
  const base = meta({ locks: {}, folderNotes: {} });
  const 我锁了一个 = meta({ locks: { u1: true }, folderNotes: {} });
  const 别人写了说明 = meta({ locks: {}, folderNotes: { u2: '只放工具' } });
  const out = M(base, 我锁了一个, 别人写了说明);
  assert.deepEqual(out.locks, { u1: true });
  assert.deepEqual(out.folderNotes, { u2: '只放工具' });
});

test('标签：我改我的、别人加别人的，都在', () => {
  const base = meta({ tags: [{ id: 'a', name: '甲' }] });
  const 我改了甲 = meta({ tags: [{ id: 'a', name: '甲改过' }] });
  const 别人加了乙 = meta({ tags: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }] });
  const out = M(base, 我改了甲, 别人加了乙);
  const byId = Object.fromEntries(out.tags.map((t) => [t.id, t.name]));
  assert.deepEqual(byId, { a: '甲改过', b: '乙' });
});

test('我删掉一个标签，别人新加的那个不受影响', () => {
  const base = meta({ tags: [{ id: 'a', name: '甲' }] });
  const out = M(base, meta({ tags: [] }), meta({ tags: [{ id: 'a', name: '甲' }, { id: 'b', name: '乙' }] }));
  assert.deepEqual(out.tags.map((t) => t.id), ['b']);
});

test('emoji 兜底库这类整段文本：我改过才覆盖', () => {
  const base = meta({ emojiRules: '老的' });
  assert.equal(M(base, meta({ emojiRules: '我改的' }), meta({ emojiRules: '别人改的' })).emojiRules, '我改的');
  assert.equal(M(base, meta({ emojiRules: '老的' }), meta({ emojiRules: '别人改的' })).emojiRules, '别人改的');
});

test('第一次写（没有基线）不会把存储里已有的东西弄丢', () => {
  const 存储里 = meta({ items: { 甲: { desc: '已有的' } } });
  const out = M(null, meta({ items: { 乙: { desc: '我新写的' } } }), 存储里);
  assert.equal(out.items.甲.desc, '已有的');
  assert.equal(out.items.乙.desc, '我新写的');
});

test('不改动传进来的那三个对象（调用方还拿着它们在用）', () => {
  const base = meta({ items: { 甲: {} } }), mine = meta({ items: { 甲: { desc: 'x' } } }), cur = meta({ items: { 甲: {} } });
  const snap = [base, mine, cur].map((o) => JSON.stringify(o));
  M(base, mine, cur);
  assert.deepEqual([base, mine, cur].map((o) => JSON.stringify(o)), snap);
});
