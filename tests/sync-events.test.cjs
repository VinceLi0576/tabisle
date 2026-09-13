const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function guard(expected){
 const src=fs.readFileSync(require.resolve('../sync-worker.js'),'utf8').split('const syncVerification=')[0];
 const ctx=vm.createContext({SyncCore:{},BK:require('../bookmark-core.js'),URL,chrome:{bookmarks:{}}});vm.runInContext(src,ctx);
 ctx.expected=expected;vm.runInContext('syncGuard={dirty:false,expected}',ctx);
 return {observe:(...args)=>ctx.observeNative(...args),state:()=>vm.runInContext('syncGuard',ctx)};
}
test('expected events consume their own operation without weakening protection',()=>{const p=guard([{type:'create',parentId:'1',title:'A',url:'https://example.com/'}]);p.observe('create','2',{parentId:'1',title:'A',url:'https://example.com/'});assert.equal(p.state().dirty,false);assert.equal(p.state().expected.length,0);});
test('URL rewrites remain blocked and diagnostic stores no URL or title',()=>{const p=guard([{type:'create',parentId:'1',title:'Private title',url:'https://example.com/a'}]);p.observe('create','2',{parentId:'1',title:'Private title',url:'https://example.com/b'});assert.equal(p.state().dirty,true);assert.deepEqual(Array.from(p.state().diagnostic.fields),['url']);const text=JSON.stringify(p.state().diagnostic);assert.ok(!text.includes('Private')&&!text.includes('favorites')&&!text.includes('bookmarks'));});
test('unexpected reorder preserves the first diagnostic',()=>{const p=guard([]);p.observe('reorder','1',{});p.observe('update','2',{title:'other'});assert.equal(p.state().dirty,true);assert.equal(p.state().diagnostic.type,'reorder');});

test('known Edge bookmark-manager rewrite is accepted; other internal routes are not',()=>{const p=guard([{type:'create',parentId:'1',title:'书签',url:'chrome://bookmarks/'}]);p.observe('create','2',{parentId:'1',title:'书签',url:'edge://favorites/'});assert.equal(p.state().dirty,false);const q=guard([{type:'create',url:'chrome://settings/'}]);q.observe('create','2',{url:'edge://favorites/'});assert.equal(q.state().dirty,true);});
