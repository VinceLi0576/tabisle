// 本机备份按用途分档（260914 老徐拍：本地备份是操作保险丝，不是版本库）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const R = (f) => path.join(__dirname, '..', f);

function worker() {
  const store = { backups: [] };
  const ctx = { URL, TextEncoder, crypto: { randomUUID: () => 'id-' + Math.random().toString(36).slice(2) }, Date, Math, JSON, Object, Array, String, Number, Error, console,
    chrome: { storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => Object.assign(store, o), remove: async () => {} } }, bookmarks: {} },
    BK: { flatten: () => [] }, portable: (x) => JSON.parse(JSON.stringify(x)) };
  // 只抠 storeSnapshot 那一段跑：从 BYTES 常量到函数结束
  const src = fs.readFileSync(R('backup-worker.js'), 'utf8');
  const i = src.indexOf('const BYTES='), j = src.indexOf('\n}', src.indexOf('async function storeSnapshot')) + 2;
  vm.runInNewContext(src.slice(i, j) + '\nglobalThis.storeSnapshot=storeSnapshot;', ctx);
  let t = Date.parse('2026-09-14T08:00:00Z');
  const snap = (reason, dayOffset = 0) => ({ id: 'id-' + Math.random().toString(36).slice(2), reason, createdAt: new Date(t += 60e3 + dayOffset * 86400e3).toISOString(), children: [], meta: { items: {}, groups: {}, tags: [] } });
  return { store, put: (reason, d) => ctx.storeSnapshot(snap(reason, d)) };
}
const count = (w, r) => w.store.backups.filter((b) => b.reason === r).length;

test('同步前那种高频的只留最新 1 份，🚫 不许再把删除前那种挤出去', async () => {
  const w = worker();
  for (let i = 0; i < 4; i++) await w.put('删除前');
  for (let i = 0; i < 30; i++) await w.put('同步前自动保护');
  assert.equal(count(w, '删除前'), 4, '4 份删除前一份都不能少');
  assert.equal(count(w, '同步前自动保护'), 1);
});

test('保险丝那一档留最近 5 份，第 6 份进来最老的出去', async () => {
  const w = worker();
  for (let i = 0; i < 7; i++) await w.put('删除书签前');
  assert.equal(count(w, '删除书签前'), 5);
  // 🔴 vm 里造出来的数组跟这边不是同一个 Array 原型，deepStrictEqual 恒不等 ⇒ 比字符串
  const kept = Array.from(w.store.backups, (b) => b.createdAt.slice(11, 16)).sort().join(',');
  assert.equal(kept, '08:03,08:04,08:05,08:06,08:07', '7 份是 08:01..08:07，留下的必须是最新五份');
});

test('每天第一次同步前顺手出一份「每日留底」，当天不重复', async () => {
  const w = worker();
  for (let i = 0; i < 5; i++) await w.put('同步前自动保护');
  assert.equal(count(w, '每日留底'), 1, '同一天只有一份');
  await w.put('同步前自动保护', 1);      // 第二天
  assert.equal(count(w, '每日留底'), 2);
});

test('每日留底只留 3 天', async () => {
  const w = worker();
  for (let d = 0; d < 6; d++) await w.put('同步前自动保护', 1);
  assert.equal(count(w, '每日留底'), 3);
});

test('各档互不挤占：总数是各档之和，不会有一档吃光配额', async () => {
  const w = worker();
  for (let i = 0; i < 9; i++) await w.put('恢复前自动保护');
  for (let i = 0; i < 9; i++) await w.put('定时自动备份');
  for (let i = 0; i < 9; i++) await w.put('同步前云端保护');
  assert.equal(count(w, '恢复前自动保护'), 5);
  assert.equal(count(w, '定时自动备份'), 1);
  assert.equal(count(w, '同步前云端保护'), 1);
  assert.ok(w.store.backups.length <= 5 + 1 + 1 + 3 + 1 + 1, '上限就是各档配额相加');
});
