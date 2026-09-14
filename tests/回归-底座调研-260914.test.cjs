// 回归：260914 派外部 AI ＋ 子 agent 调研「底座扎不扎实」查出来的几条，逐条钉死。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
const nocomment = (s) => s.replace(/\/\/[^\n]*/g, '');

test('新加的显示偏好必须进备份，否则恢复一次就丢（实测备份里原来只有三个键）', () => {
  const bw = nocomment(fs.readFileSync(p('backup-worker.js'), 'utf8'));
  const m = bw.match(/const PREF_KEYS=\[([^\]]*)\]/);
  assert.ok(m, '找不到 PREF_KEYS');
  for (const k of ['view', 'recentCollapsed', 'filterMode', 'folderView', 'inboxIndex', 'aiStandard', 'aiTasks']) {
    assert.ok(m[1].includes(`'${k}'`), `备份没带上偏好 ${k}`);
  }
  // app.js 里 savePrefs 会把 folderCollapsed 之外的所有键落盘 —— 两边得对得上
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  const d = app.match(/const DEFAULTS = \{([^}]*)\}/);
  assert.ok(d, '找不到 DEFAULTS');
  for (const k of d[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean)) {
    if (k === 'folderCollapsed') continue;   // 它另走 folderState，按 uid 存
    assert.ok(m[1].includes(`'${k}'`), `DEFAULTS 里有 ${k}，备份却没带`);
  }
});

test('图标判定必须按 src 缓存（实测 3.11ms × 713 个 ＝ 每次重绘白烧 2.2 秒）', () => {
  const st = nocomment(fs.readFileSync(p('store.js'), 'utf8'));
  assert.match(st, /_iconCache/, 'store 没有图标缓存');
  assert.match(st, /isDefaultIcon\(img\)\s*\{[\s\S]{0,200}_iconCache\.has/, 'isDefaultIcon 没先查缓存');
});

test('侧栏文字框要去抖，否则每敲一个字就让首页 865 条整页重绘', () => {
  const sp = nocomment(fs.readFileSync(p('sidepanel.js'), 'utf8'));
  assert.match(sp, /persistSoon/, '没有去抖');
  assert.match(sp, /addEventListener\('blur',\s*\(\)\s*=>\s*flushField/, '离开输入框没有立刻落盘');
  assert.match(sp, /addEventListener\('pagehide',\s*flushAll\)/, '关页面前没有把最后一笔冲出去');
});

test('侧栏写失败一次之后不能永远废掉（pending 不许停在 rejected）', () => {
  const sp = nocomment(fs.readFileSync(p('sidepanel.js'), 'utf8'));
  const all = [...sp.matchAll(/pending=Promise\.all\(\[pending\.catch\(\(\)=>\{\}\),\s*([^\]]*)\]\)/g)];
  assert.ok(all.length >= 2, '找不到 pending 的串联（书签那条和文件夹那条都要有）');
  for (const m of all) assert.match(m[1], /\.catch\(/, '有一条没接住失败 ⇒ pending 会停在 rejected，load() 里 await 它直接抛，侧栏从此空白');
});

test('锁定要挡住「归入」和拖动两条路，不能只挡 AI 和方向键', () => {
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  const mv = app.match(/async function moveTo\(id, parentId\) \{([\s\S]*?)\n  \}/);
  assert.ok(mv && /isLocked\(parentId\)/.test(mv[1]), '归入没查目标夹的锁');
  assert.ok(mv && /isLocked\(n\.parentId\)/.test(mv[1]), '归入没查原夹的锁');
  const drop = app.match(/document\.addEventListener\('drop'[\s\S]*?\n  \}\);/);
  assert.ok(drop && /isLocked\(tg\.parentId\)/.test(drop[0]), '拖动没查目标夹的锁');
});

test('拖动也要给撤销，并且撤销前复核落点', () => {
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  const drop = app.match(/document\.addEventListener\('drop'[\s\S]*?\n  \}\);/);
  assert.ok(drop && /undoMove\(d\.id, from\)/.test(drop[0]), '拖动成功后没有撤销入口');
  const undo = app.match(/async function undoMove\(id, from\) \{([\s\S]*?)\n  \}/);
  assert.ok(undo, '没有 undoMove');
  assert.match(undo[1], /store\.children\(from\.parentId\)/, '撤销没复核源文件夹现在有几条');
  assert.match(undo[1], /from\.index <= kids\.length/, '撤销没判断那个下标还成不成立');
});

test('自己挪进收集箱的不再弹一次「多了一条」，否则撤销按钮 0.3 秒就被顶掉', () => {
  const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
  assert.match(app, /const inboxQuiet = new Set\(\)/);
  assert.match(app, /!seen\.includes\(n\.id\) && !inboxQuiet\.has\(n\.id\)/);
});
