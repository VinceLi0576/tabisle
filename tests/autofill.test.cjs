const { test } = require('node:test');
const assert = require('node:assert/strict');
const BmCore = require(require('node:path').join(__dirname, '..', 'bm-core.js'));
test('pageMeta：标题、简介、字符集都抠得出来，属性顺序颠倒也行，实体要解码', () => {
  const html = `<html><head><meta charset="GBK"><title> 腾讯云 &amp; 控制台 &#x2014; 首页 </title>
  <meta content="一家以互联网为基础的科技与文化公司" name="description">
  <meta property="og:description" content="别用这条"></head><body>正文</body></html>`;
  const m = BmCore.pageMeta(html);
  assert.equal(m.title, '腾讯云 & 控制台 — 首页');
  assert.equal(m.desc, '一家以互联网为基础的科技与文化公司');
  assert.equal(m.charset, 'gbk');
});
test('pageMeta：没有 description 时退到 og:description；没有 title 退到 og:title；都没有给空串', () => {
  const m = BmCore.pageMeta('<head><meta property="og:title" content="OG 标题"><meta property="og:description" content="OG 简介"></head>');
  assert.equal(m.title, 'OG 标题'); assert.equal(m.desc, 'OG 简介');
  const e = BmCore.pageMeta('<html><body>啥都没有</body></html>');
  assert.deepEqual([e.title, e.desc, e.charset], ['', '', '']);
});
test('pageMeta：超长简介截到 300 字以内', () => {
  const m = BmCore.pageMeta('<meta name="description" content="' + '字'.repeat(500) + '">');
  assert.equal(m.desc.length, 300); assert.ok(m.desc.endsWith('…'));
});
test('tabPick：只留 http(s)，扩展页和新标签页不算；最近用过的在前；同一网址只留一条；封顶', () => {
  const tabs = [
    { id: 1, url: 'chrome://newtab/', title: '新标签页', lastAccessed: 900 },
    { id: 2, url: 'chrome-extension://abc/newtab.html', title: '书签首页', lastAccessed: 950 },
    { id: 3, url: 'https://a.com/x', title: 'A', lastAccessed: 100 },
    { id: 4, url: 'https://b.com/', title: '  B  站 ', lastAccessed: 500 },
    { id: 5, url: 'https://a.com/x#top', title: 'A again', lastAccessed: 600 },
    { id: 6, url: 'https://c.com/', title: '', lastAccessed: 50 },
  ];
  const p = BmCore.tabPick(tabs);
  assert.deepEqual(p.map((t) => t.id), [5, 4, 6]);
  assert.equal(p[1].title, 'B 站');
  assert.equal(p[2].title, 'c.com');
  assert.equal(BmCore.tabPick(tabs, 2).length, 2);
});
