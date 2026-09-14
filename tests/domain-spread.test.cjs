const test = require('node:test');
const assert = require('node:assert');
const BmCore = require('../bm-core.js');

// 一棵假书签树：书签栏下两个夹，外加「其他书签」
const tree = [
  { id: '1', title: '书签栏', children: [
    { id: '10', title: '工具', parentId: '1', children: [
      { id: '100', parentId: '10', title: '面板', url: 'https://cc.xntj.tv/chat' },
      { id: '101', parentId: '10', title: '文档', url: 'https://docs.xntj.tv/a' },
      { id: '102', parentId: '10', title: '别的站', url: 'https://example.com/x' },
    ] },
    { id: '11', title: '云 claude', parentId: '1', children: [
      { id: '110', title: '知识库', parentId: '11', children: [
        { id: '1100', parentId: '110', title: '拼chat', url: 'https://cc.xntj.tv/chat' },
      ] },
    ] },
  ] },
  { id: '2', title: '其他书签', children: [
    { id: '20', parentId: '2', title: '散的', url: 'https://www.xntj.tv/' },
  ] },
];

test('按注册域归并：子域不同也算同一个网站', () => {
  const r = BmCore.sameDomainFolders(tree, 'https://cc.xntj.tv/chat', '1100');
  assert.strictEqual(r.root, 'xntj.tv');
  assert.strictEqual(r.total, 4);                  // 三个子域四条，example.com 不算
  assert.strictEqual(r.folders.length, 3);
});

test('当前这份所在的文件夹排在最前面，并被标出来', () => {
  const r = BmCore.sameDomainFolders(tree, 'https://cc.xntj.tv/chat', '1100');
  assert.strictEqual(r.folders[0].path, '书签栏 / 云 claude / 知识库');
  assert.strictEqual(r.folders[0].hasCurrent, true);
  assert.strictEqual(r.folders[0].items[0].current, true);
  assert.strictEqual(r.folders.filter(f => f.hasCurrent).length, 1);
});

test('路径是从根夹一路拼下来的，条数按夹算', () => {
  const r = BmCore.sameDomainFolders(tree, 'https://cc.xntj.tv/chat', '1100');
  const byPath = Object.fromEntries(r.folders.map(f => [f.path, f.count]));
  assert.deepStrictEqual(byPath, { '书签栏 / 云 claude / 知识库': 1, '书签栏 / 工具': 2, '其他书签': 1 });
});

test('明细里带子域，用来分辨是同一个站的哪一块', () => {
  const r = BmCore.sameDomainFolders(tree, 'https://cc.xntj.tv/chat', '1100');
  const tools = r.folders.find(f => f.path === '书签栏 / 工具');
  assert.deepStrictEqual(tools.items.map(i => i.sub).sort(), ['cc.xntj.tv', 'docs.xntj.tv']);
});

test('明细有上限，条数照样是真数', () => {
  const many = [{ id: '1', title: '书签栏', children: [{ id: '10', title: '夹', parentId: '1',
    children: Array.from({ length: 9 }, (_, i) => ({ id: 'x' + i, parentId: '10', title: 't' + i, url: 'https://a.example.com/' + i })) }] }];
  const r = BmCore.sameDomainFolders(many, 'https://a.example.com/0', null, 4);
  assert.strictEqual(r.folders[0].count, 9);
  assert.strictEqual(r.folders[0].items.length, 4);
  assert.strictEqual(r.total, 9);
});

test('网址认不出域名时返回空，不抛错', () => {
  const r = BmCore.sameDomainFolders(tree, '', null);
  assert.deepStrictEqual(r, { root: '', total: 0, folders: [] });
  assert.deepStrictEqual(BmCore.sameDomainFolders(tree, 'chrome://bookmarks/', null).folders, []);
});
