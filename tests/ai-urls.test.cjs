// 粘网址直接入库：只有整段都是 http(s) 网址才算，混了字就必须走对话（260913）
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseUrls,nameFromUrl}=require('../ai-core.js');

test('单条、多条、换行、重复',()=>{
  assert.deepEqual(parseUrls('https://a.com/x'),['https://a.com/x']);
  assert.deepEqual(parseUrls(' https://a.com  http://b.cn/p '),['https://a.com/','http://b.cn/p']);
  assert.deepEqual(parseUrls('https://a.com\nhttps://b.com'),['https://a.com/','https://b.com/']);
  assert.deepEqual(parseUrls('https://a.com https://a.com'),['https://a.com/']);  // 去重
});

test('混了别的字、空、非 http 协议，一律走对话',()=>{
  for(const t of ['把这个加进去 https://a.com','看一下 GPT 夹','','   ',
                  'javascript:alert(1)','file:///etc/passwd','chrome://settings',
                  'a.com','这是一句话'])
    assert.equal(parseUrls(t),null,JSON.stringify(t)+' 不该被当成网址批');
});

test('临时书签名：拿得到就带一段路径，拿不到只用域名',()=>{
  assert.equal(nameFromUrl('https://www.github.com/'),'github.com');
  assert.equal(nameFromUrl('https://developer.chrome.com/docs/extensions/reference/api/bookmarks'),'developer.chrome.com · bookmarks');
  assert.equal(nameFromUrl('https://a.com/some-long-page_name.html'),'a.com · some long page name');
  assert.equal(nameFromUrl('不是网址'),'不是网址');
});
