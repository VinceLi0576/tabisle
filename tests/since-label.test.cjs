const { test } = require('node:test');
const assert = require('node:assert/strict');
const BmCore = require(require('node:path').join(__dirname, '..', 'bm-core.js'));
const now = Date.parse('2026-09-14T12:00:00Z'), D = 86400e3;
test('最近打开时间说人话，每一档都试到边界', () => {
  const L = (ms) => BmCore.sinceLabel(ms, now);
  assert.equal(L(0), '没打开过'); assert.equal(L(undefined), '没打开过');
  assert.equal(L(now - 3600e3), '今天打开过');
  assert.equal(L(now - 1 * D - 1), '昨天打开过');
  assert.equal(L(now - 5 * D), '5 天前打开过');
  assert.equal(L(now - 29 * D), '29 天前打开过');
  assert.equal(L(now - 45 * D), '1 个月前打开过');
  assert.equal(L(now - 400 * D), '1 年前打开过');
});
