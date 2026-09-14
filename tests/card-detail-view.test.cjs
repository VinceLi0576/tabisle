// 卡片两档 + 详情摘要条（老徐 260914 拍：①露详细说明 ②露书签名原样 ③上最近打开 ④列表不动）
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const R = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
test('显示方式有三档：紧凑 / 详细 / 列表，列表这轮不动', () => {
  const h = R('newtab.html');
  for (const v of ['card', 'detail', 'list']) assert.match(h, new RegExp(`data-val="${v}"`));
  assert.match(R('app.js'), /\['list', 'detail'\]\.includes\(prefs\.view\)/, '偏好里要认 detail');
});
test('卡片上准备好了详细版要露的三样，紧凑版靠样式藏起来', () => {
  const a = R('app.js'), css = R('style.css');
  assert.match(a, /className = 'orig'/); assert.match(a, /className = 'note'/); assert.match(a, /className = 'foot'/);
  assert.match(css, /\.tile \.orig,\.tile \.note,\.tile \.foot\{display:none\}/, '紧凑版不露');
  assert.match(css, /html\[data-view="detail"\] \.tile \.note\{display:-webkit-box;-webkit-line-clamp:2/, '详细说明只露两行');
});
test('最近打开走浏览历史，一次查完并缓存；🚫 不用 dateLastUsed', () => {
  const st = R('store.js');
  assert.match(st, /async lastVisits\(\)/); assert.match(st, /chrome\.history\.search/); assert.match(st, /60e3/, '要缓存，别每次渲染都查');
  assert.doesNotMatch(R('app.js').slice(R('app.js').indexOf('function tileEl')), /dateLastUsed/);
});
test('详情页顶上有跟卡片同一张脸的摘要条，并且能「不要显示名了，就用书签名」', () => {
  const h = R('sidepanel.html'), j = R('sidepanel.js');
  assert.match(h, /id="detail-summary"/); assert.match(h, /id="use-title"/);
  assert.match(j, /\$\('use-title'\)\.onclick=\(\)=>\{\$\('alias'\)\.value='';persist\(\{alias:''\}\);\}/);
});
