// 回归：整理页开着的时候，任何一次重绘都不许把「最近访问」放出来盖在上面。
// 病根是 renderOrganize/renderSearch 两条路各自算 #recent 该不该藏，都没看整理页开没开。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const app = fs.readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8').replace(/\/\/[^\n]*/g, '');
test('每一处算「最近访问藏不藏」的地方都要把整理页算进去', () => {
  const lines = app.split('\n').filter((l) => /\$\('#recent'\)\.hidden\s*=/.test(l));
  assert.ok(lines.length >= 2, '找不到那几处赋值');
  for (const l of lines) {
    if (/hidden = show;/.test(l)) continue;   // toggleOrganize 自己那一处，它就是开关本身
    assert.match(l, /!\$\('#organize'\)\.hidden/, '这一处没看整理页：' + l.trim().slice(0, 80));
  }
});
