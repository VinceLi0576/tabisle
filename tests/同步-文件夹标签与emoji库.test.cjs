// 🔴 260915 实撞：同步合并的结果 meta 是硬写死键名的对象字面量 ⇒ 没列进去的键每同步一次就被删一次，
// 而且删掉的版本还会被上传 ⇒ 两台一起丢，全程不报错。folderTags 和 emojiRules 就是这么丢的。
// 上面那份 tests/同步不许吞掉meta新键.test.cjs 钉的是「代码形态」，这一份钉的是「真跑一次的行为」。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require(path.join(__dirname, '../bookmark-core.js'));
const SC = require(path.join(__dirname, '../sync-core.js'));

const snap = (meta) => ({ format: 'newtab-bookmarks', version: 1, id: 's' + Math.random(),
  createdAt: new Date().toISOString(), reason: '测试',
  children: [{ uid: 'u1', title: '一个夹', children: [] }],
  meta: { items: {}, groups: {}, tags: [], ...meta }, prefs: {}, folderState: {} });

const FT = [{ id: 'F1', name: '确定', color: '#002FA7' }, { id: 'F0', name: '待定', color: '#8A8F98', dim: true }];

test('🔴 三边都有文件夹标签 ⇒ 合并后还在（原来会被整键删掉）', () => {
  const s = SC.merge(snap({ folderTags: FT }), snap({ folderTags: FT }), snap({ folderTags: FT })).snapshot;
  assert.deepEqual(s.meta.folderTags, FT, '文件夹标签名单被同步吞了');
});

test('🔴 emoji 兜底库同理 —— 它是一整串文本，不是对象', () => {
  const txt = 'github 🐙\nyoutube 📺';
  const s = SC.merge(snap({ emojiRules: txt }), snap({ emojiRules: txt }), snap({ emojiRules: txt })).snapshot;
  assert.equal(s.meta.emojiRules, txt, 'emoji 兜底库被同步吞了');
});

test('只有本机有这两样（云端那台还没升级）⇒ 不许因此清掉', () => {
  const s = SC.merge(snap({}), snap({ folderTags: FT, emojiRules: 'a 🅰' }), snap({})).snapshot;
  assert.deepEqual(s.meta.folderTags, FT, '云端没带这个键，就把本机的删了');
  assert.equal(s.meta.emojiRules, 'a 🅰', '云端没带这个键，就把本机的删了');
});

test('本机新建了一个文件夹标签 ⇒ 合并后保留，云端原有的也在', () => {
  const mine = [...FT, { id: 'F2', name: '归档', color: '#003153' }];
  const s = SC.merge(snap({ folderTags: FT }), snap({ folderTags: mine }), snap({ folderTags: FT })).snapshot;
  assert.equal(s.meta.folderTags.length, 3, '新建的那个没保住');
  assert.ok(s.meta.folderTags.some((t) => t.id === 'F2'), '新建的那个没保住');
});

test('本机真的删掉一个文件夹标签 ⇒ 合并后确实没了（跟「对面不认识」区分开）', () => {
  const s = SC.merge(snap({ folderTags: FT }), snap({ folderTags: [FT[0]] }), snap({ folderTags: FT })).snapshot;
  assert.equal(s.meta.folderTags.length, 1, '删除没被尊重');
  assert.equal(s.meta.folderTags[0].id, 'F1');
});

test('我改过 emoji 库、云端没改 ⇒ 用我的；我没改、云端改了 ⇒ 用云端的', () => {
  const a = SC.merge(snap({ emojiRules: '旧' }), snap({ emojiRules: '我改的' }), snap({ emojiRules: '旧' })).snapshot;
  assert.equal(a.meta.emojiRules, '我改的');
  const b = SC.merge(snap({ emojiRules: '旧' }), snap({ emojiRules: '旧' }), snap({ emojiRules: '云端改的' })).snapshot;
  assert.equal(b.meta.emojiRules, '云端改的');
});

test('这两个新键不许影响「对面是不是旧版」的判断', () => {
  // 两边都没有 folderTags／emojiRules，但 locks／folderNotes 齐 ⇒ 不该算旧版
  const r = SC.merge(snap({ locks: {}, folderNotes: {} }), snap({ locks: {}, folderNotes: {} }), snap({ locks: {}, folderNotes: {} }));
  assert.equal(r.laggards, 0, '把新键算进旧版判定了 ⇒ 页面会一直提示去升级');
});
