// 跨版本同步：还没升级的那台浏览器不能把新版才有的数据悄悄抹掉
// 实撞背景：v0.10.1 的合并只重建 items/groups/tags，locks 和 folderNotes 直接没了，
// 而三方合并下一轮会把这次「删除」当成用户意图传播开 —— 救不回来。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require(path.join(__dirname, '../bookmark-core.js'));
const SC = require(path.join(__dirname, '../sync-core.js'));

const snap = (meta) => ({ format: 'newtab-bookmarks', version: 1, id: 's' + Math.random(),
  createdAt: new Date().toISOString(), reason: 't',
  children: [{ uid: 'u1', title: '工具', children: [] }, { uid: 'u2', title: '私密', children: [] }],
  meta: { items: {}, groups: {}, tags: [], ...meta }, prefs: {}, folderState: {} });
const C = (o) => JSON.parse(JSON.stringify(o));
// 旧版本浏览器写出来的样子：meta 里压根没有这两个键（不是空对象）
const 旧版写的 = () => { const s = snap({}); delete s.meta.locks; delete s.meta.folderNotes; return s; };
const 有数据 = () => snap({ locks: { u2: true }, folderNotes: { u1: '只放在线工具' } });

test('云端那份是旧版写的（键都没有）⇒ 本机的锁定和说明必须留住', () => {
  const { snapshot } = SC.merge(C(有数据()), C(有数据()), C(旧版写的()));
  assert.deepEqual(snapshot.meta.locks, { u2: true });
  assert.deepEqual(snapshot.meta.folderNotes, { u1: '只放在线工具' });
});

test('基线也是旧版写的（第一次升级后同步）⇒ 本机新写的照样留住', () => {
  const { snapshot } = SC.merge(C(旧版写的()), C(有数据()), C(旧版写的()));
  assert.deepEqual(snapshot.meta.locks, { u2: true });
  assert.deepEqual(snapshot.meta.folderNotes, { u1: '只放在线工具' });
});

test('🔴 「用户自己清空」必须照常传播，不能跟「旧版不认识」混为一谈', () => {
  const 清空了 = snap({ locks: {}, folderNotes: {} });     // 键在，值为空 ＝ 真实意图
  const { snapshot } = SC.merge(C(有数据()), C(清空了), C(有数据()));
  assert.deepEqual(snapshot.meta.locks, {}, '本机清空要传播出去');
  assert.deepEqual(snapshot.meta.folderNotes, {});
});

test('云端是新版写的、确实删了一条 ⇒ 正常接受删除', () => {
  const 云端删了说明 = snap({ locks: { u2: true }, folderNotes: {} });
  const { snapshot } = SC.merge(C(有数据()), C(有数据()), C(云端删了说明));
  assert.deepEqual(snapshot.meta.folderNotes, {}, '新版写的空对象是真删除');
});

test('两端都是新版、各写各的 ⇒ 照常合并，不受这条保护影响', () => {
  const a = snap({ folderNotes: { u1: '甲' } }), b = snap({ folderNotes: { u2: '乙' } });
  const { snapshot } = SC.merge(C(snap({ folderNotes: {} })), C(a), C(b));
  assert.deepEqual(snapshot.meta.folderNotes, { u1: '甲', u2: '乙' });
});

test('合并结果报出「有几份是旧版写的」，好让页面提示去升级', () => {
  assert.equal(SC.merge(C(有数据()), C(有数据()), C(旧版写的())).laggards, 1);
  assert.equal(SC.merge(C(旧版写的()), C(有数据()), C(旧版写的())).laggards, 2);
  assert.equal(SC.merge(C(有数据()), C(有数据()), C(有数据())).laggards, 0);
});

test('书签本身不受这条保护干扰：旧版那边的增删照常合并', () => {
  const 云端加了一个 = 旧版写的();
  云端加了一个.children.push({ uid: 'u3', title: '新夹', children: [] });
  const { snapshot } = SC.merge(C(有数据()), C(有数据()), C(云端加了一个));
  assert.deepEqual(snapshot.children.map((n) => n.uid), ['u1', 'u2', 'u3']);
  assert.deepEqual(snapshot.meta.locks, { u2: true }, '书签合并的同时，锁还得在');
});
