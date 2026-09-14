// 文件夹说明（这个夹该放什么）：按 uid 存、跟着同步走、能撤销
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require(path.join(__dirname, '../bookmark-core.js'));
const SC = require(path.join(__dirname, '../sync-core.js'));
const BmCore = require(path.join(__dirname, '../bm-core.js'));
const AiCore = require(path.join(__dirname, '../ai-core.js'));
const BK = globalThis.BookmarkCore;

const snap = (children, meta) => ({ format: 'newtab-bookmarks', version: 1, id: 's' + Math.random(),
  createdAt: new Date().toISOString(), reason: '测试', children,
  meta: { items: {}, groups: {}, tags: [], ...meta }, prefs: {}, folderState: {} });
const 夹 = (uid, title, kids = []) => ({ uid, title, children: kids });

test('说明按 uid 取，改了名也还在；同名的两个夹互不串', () => {
  const meta = { folderNotes: { uA: '只放在线工具' } };
  const uidById = { '10': 'uA', '11': 'uB' };
  assert.equal(BmCore.folderNote(meta, uidById, '10'), '只放在线工具');
  assert.equal(BmCore.folderNote(meta, uidById, '11'), '');    // 同名但身份不同
  assert.equal(BmCore.folderNote(meta, uidById, '99'), '');    // 没有身份映射就没有说明
  assert.equal(BmCore.folderNote({}, uidById, '10'), '');
  assert.equal(BmCore.folderNote(meta, null, '10'), '');
});

test('🔴 同步一轮后说明必须还在（locks 就是漏了这一步，同步一次全丢）', () => {
  const tree = [夹('u1', '工具')];
  const notes = { u1: '只放能直接打开用的在线工具' };
  const { snapshot } = SC.merge(snap(tree, { folderNotes: notes }), snap(tree, { folderNotes: notes }), snap(tree, { folderNotes: notes }));
  assert.deepEqual(snapshot.meta.folderNotes, notes);
});

test('两端各写各的说明，合并后都留下', () => {
  const tree = [夹('u1', '工具'), 夹('u2', '学习')];
  const { snapshot } = SC.merge(snap(tree, { folderNotes: {} }), snap(tree, { folderNotes: { u1: '甲' } }), snap(tree, { folderNotes: { u2: '乙' } }));
  assert.deepEqual(snapshot.meta.folderNotes, { u1: '甲', u2: '乙' });
});

test('一端删掉说明会传播，不被另一端的旧值顶回来', () => {
  const tree = [夹('u1', '工具')];
  const { snapshot } = SC.merge(snap(tree, { folderNotes: { u1: '旧的' } }), snap(tree, { folderNotes: {} }), snap(tree, { folderNotes: { u1: '旧的' } }));
  assert.equal(snapshot.meta.folderNotes.u1, undefined);
});

test('没有这个字段的旧备份照样能合并、能校验', () => {
  const tree = [夹('u1', '工具')];
  assert.deepEqual(SC.merge(snap(tree), snap(tree), snap(tree)).snapshot.meta.folderNotes, {});
  assert.doesNotThrow(() => BK.validate(snap(tree)));
});

test('校验：接受字符串字典，拒绝数组和非字符串值', () => {
  const tree = [夹('u1', '工具')];
  assert.doesNotThrow(() => BK.validate(snap(tree, { folderNotes: { u1: '行' } })));
  assert.throws(() => BK.validate(snap(tree, { folderNotes: ['u1'] })), /文件夹说明数据结构不正确/);
  assert.throws(() => BK.validate(snap(tree, { folderNotes: { u1: 42 } })), /文件夹说明数据结构不正确/);
});

test('撤销能把说明写回原样（改过和原来是空的两种都要能回去）', async () => {
  const store = { uA: '原来的说明' };
  const api = { setFolderNote: async (id, val) => { if (val) store[id] = val; else delete store[id]; },
    find: async () => ({ id: 'uA', title: '工具' }), setMeta: async () => {} };
  await AiCore.replayUndo([{ kind: 'folderNote', id: 'uA', to: '原来的说明' }], api);
  assert.equal(store.uA, '原来的说明');
  await AiCore.replayUndo([{ kind: 'folderNote', id: 'uB', to: '' }], api);
  assert.equal(store.uB, undefined, '原来没有说明的，撤销后要回到没有');
});
