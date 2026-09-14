// 墓碑保质期：挡回声可以，别把「重新收藏同一个网址」也挡掉（260914 实撞）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
require(path.join(__dirname, '..', 'bookmark-core.js'));
const SC = require(path.join(__dirname, '..', 'sync-core.js'));
const snap = (ch) => ({ format: 'newtab-bookmarks', version: 1, id: 's' + Math.random(),
  createdAt: new Date().toISOString(), reason: 't', children: ch,
  meta: { items: {}, groups: {}, tags: [] }, prefs: {}, folderState: {} });
const link = (uid, title, url) => ({ uid, title, url });
const 前几天 = (d) => new Date(Date.now() - d * 86400e3).toISOString();

test('刚删掉就又冒出来 ⇒ 当回声，要人确认', () => {
  const 有 = snap([link('新id', 'X', 'https://x.test')]);
  const m = SC.merge(snap([]), 有, snap([]), {}, [{ uid: '老id', path: 'X', url: 'https://x.test', at: new Date().toISOString() }]);
  assert.equal(m.unresolved, 1, '新鲜墓碑要拦一下');
});

test('🔴 隔了很久又收藏同一个网址 ⇒ 那是人的新意图，别再拦', () => {
  const 有 = snap([link('新id', 'X', 'https://x.test')]);
  const m = SC.merge(snap([]), 有, snap([]), {}, [{ uid: '老id', path: 'X', url: 'https://x.test', at: 前几天(10) }]);
  assert.equal(m.unresolved, 0, '十天前的墓碑不该再挡「重新收藏」');
  assert.equal(m.snapshot.children.length, 1);
});

test('老版本留下的、没有时间戳的墓碑，仍然照旧拦 —— 🚫 不能顺手把这条正当保护去掉', () => {
  const 有 = snap([link('新id', 'X', 'https://x.test')]);
  const m = SC.merge(snap([]), 有, snap([]), {}, [{ uid: '老id', path: 'X', url: 'https://x.test' }]);
  assert.equal(m.unresolved, 1);
});

test('新记下的墓碑一定带时间戳，否则保质期永远算不出来', () => {
  const b = snap([link('x', 'X', 'https://x.test')]);
  const m = SC.merge(b, snap([]), b);          // 本机删掉了
  assert.equal(m.tombstones.length, 1);
  assert.ok(m.tombstones[0].at, '新墓碑要带 at');
  assert.ok(Date.now() - Date.parse(m.tombstones[0].at) < 5000);
});

test('太老的墓碑会被清出去，不会无限堆着', () => {
  const b = snap([link('x', 'X', 'https://x.test')]);
  const 很老的 = [{ uid: 'z', path: 'Z', url: 'https://z.test', at: 前几天(60) }];
  const m = SC.merge(b, snap([]), b, {}, 很老的);
  assert.ok(!m.tombstones.some((t) => t.uid === 'z'), '60 天前的该被清掉');
});
