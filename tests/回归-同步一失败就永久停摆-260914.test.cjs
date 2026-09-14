// 回归：一次网络抖动不该让自动同步永久停摆（老徐 260914「每次都这样」）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path'); const fs = require('node:fs'); const vm = require('node:vm');
const R = (f) => path.join(__dirname, '..', f);

// 把 sync-worker 里那条判据抠出来单测 —— 它决定「要不要把自动同步关掉」
const src = fs.readFileSync(R('sync-worker.js'), 'utf8');
const line = src.match(/const TRANSIENT = [^\n]+/)[0];
const ctx = {}; vm.runInNewContext(line + '\nglobalThis.T = TRANSIENT;', ctx);
const transient = (m) => ctx.T.test(String(m || ''));

test('🔴 会自己好的那些错，不许关掉自动同步', () => {
  for (const m of [
    '坚果云同步请求失败（503）',
    '坚果云同步请求失败（502）',
    'Failed to fetch',
    '网络连接失败',
    'timeout',
    'AI 整理正在改书签，请等它结束或撤销后再同步',
  ]) assert.equal(transient(m), true, '这条应该算「等会儿自己再试」：' + m);
});

test('🔴 要人拿主意的那些，必须停下来等人', () => {
  for (const m of [
    '请先选择冲突处理方式，再更新预览',
    '同步需要你确认，请在备份页查看变化与冲突',
    '云端读回校验不一致，自动同步已暂停，请重新预览',
    '另一台设备刚刚更新了云端，本次未覆盖，请重新预览',
    '本机数据已变化，请重新预览同步',
    '请先在备份页验证并预览首次同步',
  ]) assert.equal(transient(m), false, '这条必须停下来等人：' + m);
});

test('失败分两类之后，只有第二类才关自动同步', () => {
  assert.match(src, /async function noteSyncFailure/, '要有统一的失败处理');
  const i = src.indexOf('async function noteSyncFailure');
  const body = src.slice(i, i + 600);
  assert.match(body, /keepAuto \? \{\} : \{ syncAuto: false \}/, '只有非暂时性错误才关自动同步');
  assert.match(body, /deferFailedAutomation/, '暂时性错误要退避后自己再试，别原地打转');
  // 🔴 旧写法一律关掉，不许再出现
  assert.doesNotMatch(src, /set\(\{syncError:e\.message,syncAuto:false\}\)/, '旧的「一律关掉」写法不能留');
});

test('成功之后要把「暂时性」这个标记一起清掉，否则药丸会一直显示会重试', () => {
  assert.match(src, /syncError:'',syncErrorTransient:false/, '成功时两个都要清');
});

test('顶栏药丸要分得清这两类，措辞不一样、后续动作也不一样', () => {
  const app = fs.readFileSync(R('app.js'), 'utf8');
  assert.match(app, /errorTransient/, '药丸要读这个标记');
  assert.match(app, /上次没连上 · 会自动重试/, '暂时性的要说清楚它会自己再试');
  assert.match(app, /同步要你处理/, '需要人介入的不能再笼统说「同步失败」');
  const i = app.indexOf('if(d.errorTransient)');
  assert.match(app.slice(i, i + 400), /pillFailed=false/, '暂时性的点一下就该直接重试，不该被推去设置页');
});

test('「立即同步」不能再被读成两步操作', () => {
  const html = fs.readFileSync(R('backup.html'), 'utf8');
  assert.doesNotMatch(html, /立即同步 · 冲突保留云端版本/, '这个标题让人以为要再点一次「保留云端版本」');
  assert.match(html, /这一个按钮就够了/, '要明写只需要点这一个');
});

test('🔴 自愈：被一次抖动关掉的自动同步，下一轮要自己开回来', () => {
  const i = src.indexOf('async function maybeSync');
  const body = src.slice(i, i + 1400);
  assert.match(body, /!d\.syncAuto&&d\.syncError&&transientError\(d\.syncError\)&&d\.syncState/,
    '判据要同时满足：自动同步关着 + 挂着会自己好的错 + 以前同步成功过');
  assert.match(body, /syncAuto:true/, '满足就把它开回来');
});

test('用户自己关掉的自动同步，不许被自愈逻辑偷偷打开', () => {
  // 用户点开关时走 SYNC_AUTO，那条会把 syncError 清空 ⇒ 自愈的判据不成立
  const i = src.indexOf("case 'SYNC_AUTO'");
  assert.match(src.slice(i, i + 400), /syncError:''/,
    '用户手动开关必须清掉 syncError，否则关掉之后会被自愈逻辑打开');
});

test('没成功同步过的（还没连云端）不许自愈 —— 那是首次设置，要人来走一遍', () => {
  const i = src.indexOf('async function maybeSync');
  assert.match(src.slice(i, i + 1400), /&&d\.syncState/, '必须要求 syncState 存在');
});
