// 文件夹详情：后台对文件夹的 EDITOR_LOAD / FOLDER_UPDATE
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const R = (f) => path.join(__dirname, '..', f);

function setup() {
  const nodes = [
    { id: '0', title: '', children: [] }, { id: '1', parentId: '0', title: '书签栏', folderType: 'bookmarks-bar' },
    { id: '10', parentId: '1', index: 0, title: '工具' },
    { id: '100', parentId: '10', index: 0, title: 'A', url: 'https://a.test/' },
    { id: '101', parentId: '10', index: 1, title: '子夹' },
    { id: '1010', parentId: '101', index: 0, title: 'B', url: 'https://b.test/' },
    { id: '11', parentId: '1', index: 1, title: '别的' },
  ];
  const local = { meta: { items: { keep: { desc: '别人的备注' } }, groups: { 工具: { color: '#123456' } }, tags: [], locks: {}, folderNotes: {} },
    bookmarkIdentity: { '10': { uid: 'u-tools' }, '101': { uid: 'u-sub' }, '11': { uid: 'u-other' } } };
  const session = {};
  const tree = () => { const build = (n) => ({ ...n, ...(!n.url ? { children: nodes.filter((c) => c.parentId === n.id).map(build) } : {}) }); return [build(nodes[0])]; };
  const st = (store) => ({ get: async (k) => { const ks = Array.isArray(k) ? k : typeof k === 'string' ? [k] : Object.keys(k); return Object.fromEntries(ks.map((x) => [x, store[x]])); }, set: async (v) => Object.assign(store, v), remove: async (k) => { for (const x of [].concat(k)) delete store[x]; } });
  const ctx = vm.createContext({ URL, JSON, Object, Array, String, Number, Error, console, Date, Math, Set,
    BK: { key: (u) => u }, bookmarkBar: async () => tree()[0].children[0], makeSnapshot: async () => {},
    chrome: { storage: { session: st(session), local: st(local) }, bookmarks: {
      get: async (id) => { const n = nodes.find((n) => n.id === String(id)); if (!n) throw Error('missing'); return [n]; },
      getTree: async () => tree(), getChildren: async (id) => nodes.filter((n) => n.parentId === String(id)),
      update: async (id, ch) => Object.assign(nodes.find((n) => n.id === String(id)), ch),
      move: async () => {}, remove: async () => {}, create: async () => {} } } });
  vm.runInContext(fs.readFileSync(R('bm-core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(R('editor-worker.js'), 'utf8'), ctx);
  const call = (type, extra = {}) => ctx.editorAction({ type, windowId: 1, ...extra });
  return { call, nodes, local };
}

test('选中文件夹时 EDITOR_LOAD 返回文件夹详情，不再抛「请选择一条书签」', async () => {
  const p = setup();
  const r = await p.call('EDITOR_LOAD', { selection: { id: '10' } });
  assert.equal(r.kind, 'folder');
  assert.equal(r.folder.title, '工具');
  assert.equal(r.folder.path, '书签栏 / 工具');
  assert.equal(r.folder.count, 2, '含子夹里的那一条');
  assert.equal(r.folder.subfolders, 1);
  assert.equal(r.folder.color, '#123456');
  assert.equal(r.folder.uid, 'u-tools');
  assert.equal(r.folder.children.length, 2);
  assert.equal(r.folder.children.find((c) => !c.url).count, 1, '子夹一行要带条数');
  assert.equal(typeof r.canNudge.down, 'boolean');
});

test('对文件夹发别的编辑消息要明确拒绝，不能静默当成书签处理', async () => {
  const p = setup();
  await assert.rejects(p.call('EDITOR_DRAFT', { selection: { id: '10' }, patch: { name: 'x' } }), /文件夹/);
});

test('写说明和锁定按稳定标识落库，🔴 别的附属数据一个字不动', async () => {
  const p = setup();
  await p.call('EDITOR_FOLDER_UPDATE', { id: '10', note: '只放在线工具', locked: true });
  assert.equal(p.local.meta.folderNotes['u-tools'], '只放在线工具');
  assert.equal(p.local.meta.locks['u-tools'], true);
  assert.equal(p.local.meta.items.keep.desc, '别人的备注', '没碰的键必须原样');
  assert.equal(p.local.meta.groups['工具'].color, '#123456');
  const r = await p.call('EDITOR_LOAD', { selection: { id: '10' } });
  assert.equal(r.folder.note, '只放在线工具');
  assert.equal(r.folder.locked, true);
});

test('清空说明就删掉那个键；解锁要连旧的按名字锁一起清，不然「解了还锁着」', async () => {
  const p = setup();
  p.local.meta.groups['工具'].locked = true;          // 老版本留下的按名字锁
  p.local.meta.folderNotes['u-tools'] = '旧说明';
  await p.call('EDITOR_FOLDER_UPDATE', { id: '10', note: '   ', locked: false });
  assert.equal('u-tools' in p.local.meta.folderNotes, false);
  assert.equal('u-tools' in p.local.meta.locks, false);
  assert.equal(p.local.meta.groups['工具'].locked, undefined, '旧的按名字锁也要清');
  assert.equal(p.local.meta.groups['工具'].color, '#123456', '颜色留着');
});

test('改名走 bookmarks.update；空名或没变就不动', async () => {
  const p = setup();
  await p.call('EDITOR_FOLDER_UPDATE', { id: '10', title: '  工具箱 ' });
  assert.equal(p.nodes.find((n) => n.id === '10').title, '工具箱');
  await p.call('EDITOR_FOLDER_UPDATE', { id: '10', title: '   ' });
  assert.equal(p.nodes.find((n) => n.id === '10').title, '工具箱', '空名不生效');
});

test('没拿到稳定标识的文件夹，写说明/锁定要报清楚原因，而不是写到不存在的键上', async () => {
  const p = setup();
  delete p.local.bookmarkIdentity['10'];
  await assert.rejects(p.call('EDITOR_FOLDER_UPDATE', { id: '10', note: 'x' }), /稳定标识/);
  assert.deepEqual(p.local.meta.folderNotes, {}, '一个字都不能写进去');
});

test('🔴 侧栏写文件夹属性时，不许把 load() 挂进 pending 链（load 自己会 await pending，会死锁）', () => {
  const src = fs.readFileSync(R('sidepanel.js'), 'utf8');
  const i = src.indexOf('const folderPatch');
  const body = src.slice(i, src.indexOf('\n  };', i) + 5);
  assert.ok(body.length > 0, '要有 folderPatch');
  assert.doesNotMatch(body, /pending\s*=\s*pending[^;]*load\(\)/, 'load() 不能出现在赋给 pending 的那条链里');
  assert.match(body, /Promise\.all\(\[pending/, '照 persist() 的形状：pending 只跟踪写有没有落地');
});
