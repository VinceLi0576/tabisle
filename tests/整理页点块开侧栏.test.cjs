// 整理页点一块＝右边开详情，🚫 不跳回首页（老徐 260914「跳来跳去、不知道跳到哪里去」）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
const app = fs.readFileSync(p('app.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
test('点整理页里的一块，开右边侧栏，不离开整理页', () => {
  const h = app.match(/\$\('#organize'\)\.addEventListener\('click'[\s\S]*?\n  \}\);/)[0];
  assert.match(h, /openDetail\(c\.dataset\.id\)/, '点了没开侧栏');
  assert.ok(!/toggleOrganize\(false\)/.test(h), '还在跳回首页');
  assert.ok(!/revealFolder\(/.test(h), '还在跳去找那个夹');
  assert.match(h, /c\.classList\.add\('on'\)/, '没标出正在看哪一块');
  // 三角和全展/全折这两条必须排在前面，否则点三角也会开侧栏
  assert.ok(h.indexOf("data-orgall") < h.indexOf('openDetail('), '全展全折被抢走');
  assert.ok(h.indexOf('.ftwist[data-twist]') < h.indexOf('openDetail('), '开合三角被抢走');
});
