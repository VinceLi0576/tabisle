// 260914 五家通盘复查抓出来的真问题，一条一测。命名按「症状」，不按「函数名」。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const R = (f) => path.join(__dirname, '..', f);
require(R('bookmark-core.js'));
const SC = require(R('sync-core.js'));

function leaseCtx() {
  const store = {};
  let n = 0;
  const ctx = { crypto: { randomUUID: () => 'id-' + (++n) }, Date, console,
    chrome: { storage: { local: {
      get: async (k) => ({ [k]: store[k] }),
      set: async (o) => Object.assign(store, o),
      remove: async (k) => { delete store[k]; },
    } } } };
  ctx.globalThis = ctx;
  vm.runInNewContext(fs.readFileSync(R('write-lease.js'), 'utf8'), ctx);
  return { L: ctx.WriteLease, store };
}

test('🔴 拿不到锁的一方不许把别人的锁清掉（调用方普遍写 release(lease?.id)）', async () => {
  const { L } = leaseCtx();
  const mine = await L.acquire('ai');
  assert.equal(await L.release(undefined), false, 'id 是 undefined 时必须拒绝');
  assert.equal(await L.release(null), false);
  assert.equal(await L.release(''), false);
  assert.ok(await L.read(), '别人的锁还得在');
  assert.equal(await L.release(mine.lease.id), true, '持有者自己释放要成功');
  assert.equal(await L.read(), null);
});

test('别人正持有时，acquire 返回的是「谁在占」，不是一把假锁', async () => {
  const { L } = leaseCtx();
  await L.acquire('sync');
  const r = await L.acquire('ai');
  assert.equal(r.ok, false);
  assert.equal(r.owner, 'sync');
  assert.equal(r.lease, undefined, '失败时不该给出 lease —— 调用方会拿它去 release');
});

test('🔴 新设备首次连上已有云端：对齐 uid 之后，锁和夹说明不能变成孤儿键', () => {
  const snap = (ch, m) => ({ format: 'newtab-bookmarks', version: 1, id: 's' + Math.random(),
    createdAt: new Date().toISOString(), reason: 't', children: ch,
    meta: { items: {}, groups: {}, tags: [], ...m }, prefs: {}, folderState: {} });
  const f = (uid) => ({ uid, title: '工具', children: [] });
  // 本机 uid=L1，云端同一个夹 uid=R1
  const { snapshot } = SC.merge(null,
    snap([f('L1')], { locks: { L1: true }, folderNotes: { L1: '只放在线工具' } }),
    snap([f('R1')], { locks: {}, folderNotes: {} }));
  assert.equal(snapshot.children[0].uid, 'R1', '树对齐到云端的 uid');
  assert.deepEqual(Object.keys(snapshot.meta.locks), ['R1'], '锁要跟着换键，否则界面上锁凭空消失');
  assert.deepEqual(Object.keys(snapshot.meta.folderNotes), ['R1'], '夹说明同理');
  assert.equal(snapshot.meta.folderNotes.R1, '只放在线工具', '内容不能丢');
});

test('折叠状态早就在对齐 uid 时换键了 —— 锁和说明现在跟它一致', () => {
  const snap = (ch, m, fs_) => ({ format: 'newtab-bookmarks', version: 1, id: 's', createdAt: new Date().toISOString(),
    reason: 't', children: ch, meta: { items: {}, groups: {}, tags: [], ...m }, prefs: {}, folderState: fs_ || {} });
  const f = (uid) => ({ uid, title: '夹', children: [] });
  const { snapshot } = SC.merge(null, snap([f('A')], { locks: { A: true } }, { A: true }), snap([f('B')], {}, {}));
  assert.deepEqual(Object.keys(snapshot.folderState), ['B']);
  assert.deepEqual(Object.keys(snapshot.meta.locks), ['B']);
});

test('标签颜色只认十六进制，别的一律退回调色板（导入和 AI 两条路都不走备份校验）', () => {
  const src = fs.readFileSync(R('app.js'), 'utf8');
  const i = src.indexOf('const safeColor');
  assert.ok(i > 0, 'app.js 里要有 safeColor');
  const fn = new Function('return ' + src.slice(src.indexOf('=', i) + 1, src.indexOf('\n', i)).trim().replace(/;$/, ''))();
  assert.equal(fn('#2f6fdb'), '#2f6fdb');
  assert.equal(fn('#fff'), '#fff');
  assert.equal(fn('red" onmouseover="alert(1)'), 'currentColor', '带引号的值必须被挡掉');
  assert.equal(fn(undefined), 'currentColor');
  assert.equal(fn({}), 'currentColor');
});

test('导入附属数据要把锁定和夹说明一起带回来（导出本来就带着它们）', () => {
  const src = fs.readFileSync(R('app.js'), 'utf8');
  const blk = src.slice(src.indexOf("$('#import-file').addEventListener"), src.indexOf("// ── 点击 / 右键 ──"));
  assert.match(blk, /meta\.locks\s*=/, '导入要合并 locks');
  assert.match(blk, /meta\.folderNotes\s*=/, '导入要合并 folderNotes');
  assert.match(blk, /\/\^#\[0-9a-f\]/i, '导入的标签颜色要校验');
});

test('删除重复收藏要认新式的按身份锁，不能只认旧的按名字锁', () => {
  const blk = fs.readFileSync(R('editor-worker.js'), 'utf8');
  const i = blk.indexOf('EDITOR_DELETE_DUPLICATE');
  const body = blk.slice(i, i + 1600);
  assert.match(body, /meta\.locks/, '要查 meta.locks[uid]');
  assert.match(body, /groups\?\.\[/, '旧的按名字锁也要继续认');
});

test('恢复这条路自己要持锁，不能只查别人有没有在写', () => {
  const src = fs.readFileSync(R('backup-worker.js'), 'utf8');
  assert.match(src, /WriteLease\.acquire\('restore'\)/, '恢复必须 acquire');
  assert.match(src, /WriteLease\.release\(restoreLease\.id\)/, '而且要在 finally 里释放');
});

test('AI 给文件夹改名，按名字存的组颜色要跟着走', () => {
  const src = fs.readFileSync(R('ai.js'), 'utf8');
  // 🔴 别用 indexOf("case 'rename'") —— 第一处是预览文案那个 describe()，执行逻辑在后面
  const i = src.indexOf("case 'rename': { const cur = BM.findNode");
  const body = src.slice(i, src.indexOf("case 'set_url'", i));
  assert.match(body, /meta\.groups/, '改名要搬 meta.groups');
  assert.match(body, /kind: 'group'/, '而且要能撤销');
});

test('新增标签的说明要显示在预览里 —— 它会进每一轮的系统提示', () => {
  const src = fs.readFileSync(R('ai.js'), 'utf8');
  const i = src.indexOf("case 'add_tag': return");
  assert.match(src.slice(i, i + 200), /ch\.desc/, '预览必须带上 desc，否则用户看不见就点了执行');
});
