// 260914 核实官独立查出来的几条（各家都没提），以及它推翻我的那两条
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'); const fs = require('node:fs'); const vm = require('node:vm');
const R = (f) => path.join(__dirname, '..', f);

test('🔴 租约要有人续：跑满 5 分钟自动放行不是竞态，是必然', () => {
  const ai = fs.readFileSync(R('ai.js'), 'utf8');
  assert.match(ai, /WRITE_RENEW/, 'AI 这条批次路径必须周期性续租');
  const i = ai.indexOf('async function withWriteLease');
  const body = ai.slice(i, i + 1800);
  assert.match(body, /setInterval/, '续租要挂在批次期间');
  assert.match(body, /clearInterval/, '结束时要停掉，否则页面留着一个空转的定时器');
});

test('🔴 页面在批次中途被关掉，也要把锁还回去', () => {
  const ai = fs.readFileSync(R('ai.js'), 'utf8');
  const i = ai.indexOf('async function withWriteLease');
  const body = ai.slice(i, i + 1800);
  assert.match(body, /pagehide/, '关页面时 finally 跟着死，只有 pagehide 还发得出去');
  assert.match(body, /removeEventListener\('pagehide'/, '正常结束要摘掉监听，否则越挂越多');
});

test('单份备份自己就超标时，闸门必须生效（原来 list.length>1 让它完全失效）', () => {
  const src = fs.readFileSync(R('backup-worker.js'), 'utf8');
  const i = src.indexOf('async function storeSnapshot');
  const body = src.slice(i, i + 1800);
  assert.match(body, /list\.length===1/, '要单独处理「只剩一份且仍超标」');
  assert.doesNotMatch(body, /JSON\.stringify\(list\)\.length>6e6/, '不能再按字符数判');
});

test('🔴 容量按真实字节算，不按字符数 —— 中文有 1.37 倍膨胀', () => {
  const src = fs.readFileSync(R('backup-worker.js'), 'utf8');
  assert.match(src, /TextEncoder/, '要用 TextEncoder 数真实 UTF-8 字节');
  // 独立验一次膨胀确实存在，免得以后有人又改回 .length
  const zh = JSON.stringify({ t: '书签首页的文件夹说明', u: 'https://example.com/文档' });
  const ratio = new TextEncoder().encode(zh).length / zh.length;
  assert.ok(ratio > 1.2, '中文内容的字节数明显大于字符数，实测倍数 ' + ratio.toFixed(2));
  assert.equal(new TextEncoder().encode('abc').length / 'abc'.length, 1, 'ASCII 不膨胀');
});

test('本机存储写不下时要报出来，不能只落在控制台', () => {
  const src = fs.readFileSync(R('backup-worker.js'), 'utf8');
  const i = src.indexOf('async function storeSnapshot');
  const body = src.slice(i, i + 2200);
  assert.match(body, /catch\s*\(e\)/, '配额打回要接住');
  assert.match(body, /lastBackupError/, '要把原因写到界面看得见的地方');
});

test('🔴 会改东西的消息超时后不许重发，话也不能说死', () => {
  const src = fs.readFileSync(R('bg.js'), 'utf8');
  assert.match(src, /const WRITES = /, '要能认出哪些消息是「会改东西」的');
  for (const t of ['BACKUP_RESTORE', 'SYNC_APPLY', 'BOOKMARK_REMOVE', 'EDITOR_SAVE', 'WRITE_RELEASE'])
    assert.match(src.match(/const WRITES = ([^;]+);/)[1], new RegExp(t.split('_')[0]), t + ' 应该被认成写操作');
  assert.match(src, /后台还在处理这一步/, '超时的文案不能再说「这次操作没有执行」');
});

test('租约的回读不是兜底 —— 注释必须写实话，别人会照着它去绕开', () => {
  const src = fs.readFileSync(R('write-lease.js'), 'utf8');
  assert.doesNotMatch(src, /至少不会两边都以为自己独占/, '这句被实测推翻了，不能留在注释里');
  assert.match(src, /只把窗口缩小/, '要写清楚它关不上那条缝');
  assert.match(src, /🚫 不是「写书签」本身/, '要写清楚那条串行链串的是消息不是写操作');
});
