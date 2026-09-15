// 🔴 同步合并的结果 meta 是一个**硬写死键名的对象字面量** ⇒ 凡是没列进去的 meta 子键，
// 每同步一次就被整键删掉一次，删掉的版本还会被上传 ⇒ 两台一起丢，全程不报错。
// 260915 实撞：folderTags（文件夹那套标签，当天新加）和 emojiRules（早就有）都是这么丢的。
// 这条测试的作用：以后谁往 meta 里加新键，忘了同步这一头，当场报。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const p = (f) => require('node:path').join(__dirname, '..', f);
const nocomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const app = nocomment(fs.readFileSync(p('app.js'), 'utf8'));
const sync = nocomment(fs.readFileSync(p('sync-core.js'), 'utf8'));

// meta 里真正存数据的子键。加新键时这张单和 sync-core 的 meta 字面量**必须一起改**。
const META_KEYS = ['items', 'groups', 'tags', 'locks', 'folderNotes', 'folderTags', 'emojiRules'];

test('🔴 meta 的每个子键都要出现在同步合并的结果里，漏一个就是「同步一次丢一次」', () => {
  const lit = sync.match(/const meta=\{([\s\S]*?)\};/);
  assert.ok(lit, '没找到合并结果那个 meta 字面量 —— 结构变了，这条测试要跟着改');
  const body = lit[1];
  const missing = META_KEYS.filter((k) => !new RegExp('\\b' + k + ':').test(body));
  assert.deepEqual(missing, [], '这些键同步一次就没了（而且会把没了的版本传上云）：' + missing.join(' '));
});

test('🔴 app.js 里没有 META_KEYS 之外的 meta 子键 —— 有就是刚加了新键，同步那头也得改', () => {
  // 抓 meta.xxx 的用法；过滤掉方法调用（meta.xxx( ）和一眼不是数据的
  const seen = new Set([...app.matchAll(/\bmeta\.([a-zA-Z]\w*)/g)].map((m) => m[1]));
  const SKIP = new Set(['get', 'set', 'onChanged']);   // store.meta 那个包装对象上的方法
  const extra = [...seen].filter((k) => !META_KEYS.includes(k) && !SKIP.has(k));
  assert.deepEqual(extra, [], '发现 meta 上的新键：' + extra.join(' ')
    + ' —— 请同时做三件：加进本文件的 META_KEYS、加进 sync-core.js 的 meta 字面量、想清楚它该怎么合并');
});

test('数组型的 meta 键按 id 合并，🚫 别用 newerKey（那个按对象合并，会把数组拍成对象）', () => {
  assert.match(sync, /const fTagMap=s=>Object\.fromEntries\(\(s\?\.meta\.folderTags\|\|\[\]\)/, '文件夹标签没有自己的 id 映射');
  assert.match(sync, /folderTags:Object\.values\(object\(/, '文件夹标签没走按 id 合并');
  assert.doesNotMatch(sync, /folderTags:newerKey/, '数组走了 newerKey ⇒ 会被拍成对象');
});

test('「对面是不是旧版」那张单不许混进新键，否则会永远提示有旧版', () => {
  // 绝大多数现存快照都没有 folderTags／emojiRules，放进 NEW_META_KEYS 会让 laggards 恒大于 0
  const lag = sync.match(/const NEW_META_KEYS=\[([^\]]*)\]/)[1];
  for (const k of ['folderTags', 'emojiRules']) {
    assert.doesNotMatch(lag, new RegExp("'" + k + "'"), k + ' 混进了旧版判定 ⇒ 页面会一直提示去升级');
  }
  assert.match(lag, /'locks'/, '旧版判定丢了 locks');
  assert.match(lag, /'folderNotes'/, '旧版判定丢了 folderNotes');
});
