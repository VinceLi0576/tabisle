// 回归：详细说明（note）曾经在 EDITOR_DRAFT 的白名单里漏掉 —— 侧栏每敲一个字都发过来，
// 后台静默丢掉，保存时写回的是载入时的旧值 ⇒ 用户写的详细说明永远存不上，而且不报错。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'editor-worker.js'), 'utf8');
const code = src.replace(/\/\/[^\n]*/g, '');   // 去注释，免得注释里的字样把断言骗过去
test('EDITOR_DRAFT 白名单必须收下 note，否则详细说明写了等于没写', () => {
  const m = code.match(/const allowed=\[([^\]]*)\]/);
  assert.ok(m, '找不到 EDITOR_DRAFT 的字段白名单');
  const fields = m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
  for (const f of ['name', 'url', 'alias', 'desc', 'note', 'icon', 'tags', 'parentId']) {
    assert.ok(fields.includes(f), `白名单少了 ${f}`);
  }
});
test('改一个字就落盘的那条路也要认 note（不然要等用户点保存才写）', () => {
  const m = code.match(/if\(node && \[([^\]]*)\]\.some/);
  assert.ok(m, '找不到即时落盘的字段判断');
  for (const f of ['alias', 'desc', 'note', 'icon', 'tags']) assert.ok(m[1].includes(`'${f}'`), `即时落盘少了 ${f}`);
  const w = code.match(/for\(const f of \[([^\]]*)\]\)if\(f in patch\)/);
  assert.ok(w && ['alias', 'desc', 'note', 'icon', 'tags'].every((f) => w[1].includes(`'${f}'`)), '写回循环少了字段');
});
test('侧栏确实在监听 note 输入（两边得对得上）', () => {
  const panel = fs.readFileSync(require('node:path').join(__dirname, '..', 'sidepanel.js'), 'utf8');
  assert.match(panel, /for\(const id of \[[^\]]*'note'[^\]]*\]\)\$\(id\)\.addEventListener\('input'/);
});
