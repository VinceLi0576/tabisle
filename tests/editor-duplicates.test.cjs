const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(){
 const nodes=[{id:'0',title:'',children:[]},{id:'1',parentId:'0',title:'收藏夹栏',children:[]},{id:'2',parentId:'1',title:'资料',children:[]},{id:'3',parentId:'2',index:0,title:'A',url:'https://example.com/?a=1#x',dateAdded:3},{id:'4',parentId:'2',index:1,title:'B',url:'https://example.com/?a=1#x',dateAdded:4},{id:'5',parentId:'2',index:2,title:'C',url:'https://example.com/?a=1#y',dateAdded:5}];
 const meta={items:{shared:{desc:'保留'}},groups:{},tags:[]},session={};let backups=0;
 const tree=()=>{const build=n=>({...n,...(!n.url?{children:nodes.filter(c=>c.parentId===n.id).map(build)}:{})});return [build(nodes[0])];};
 const storage={get:async k=>Object.fromEntries((Array.isArray(k)?k:[k]).map(x=>[x,session[x]])),set:async v=>Object.assign(session,v),remove:async k=>{for(const x of Array.isArray(k)?k:[k])delete session[x];}};
 const ctx=vm.createContext({BK:{key:()=> 'shared'},bookmarkBar:async()=>tree()[0].children[0],makeSnapshot:async()=>backups++,chrome:{storage:{session:storage,local:{get:async()=>({meta})}},bookmarks:{get:async id=>{const n=nodes.find(n=>n.id===id);if(!n)throw Error('missing');return [n];},getTree:async()=>tree(),getChildren:async id=>nodes.filter(n=>n.parentId===id),remove:async id=>nodes.splice(nodes.findIndex(n=>n.id===id),1),create:async n=>{const x={...n,id:'new',dateAdded:10};nodes.push(x);return x;}}}});
 vm.runInContext(fs.readFileSync(require.resolve('../editor-worker.js'),'utf8'),ctx);
 const call=(type,extra={})=>ctx.editorAction({type,windowId:1,selection:{id:'3'},...extra});
 return {call,nodes,meta,session,backups:()=>backups};
}
test('duplicate list uses exact URL including query and hash',async()=>{const p=setup(),r=await p.call('EDITOR_LOAD');assert.deepEqual(Array.from(r.duplicates,n=>n.id),['3','4']);assert.ok(r.duplicates[1].path.includes('资料'));});
test('deleting one duplicate retains shared metadata and supports undo',async()=>{const p=setup();await p.call('EDITOR_DELETE_DUPLICATE',{id:'4',dateAdded:4});assert.equal(p.backups(),1);assert.equal(p.meta.items.shared.desc,'保留');assert.ok(p.nodes.find(n=>n.id==='3'));await p.call('EDITOR_UNDO_DUPLICATE');assert.equal(p.nodes.at(-1).parentId,'2');assert.equal(p.nodes.at(-1).title,'B');assert.equal(p.nodes.at(-1).index,1);});
test('rejects changed, nonduplicate, current or locked entries',async()=>{for(const target of [{id:'4',dateAdded:99},{id:'5',dateAdded:5},{id:'3',dateAdded:3}]){const p=setup();await assert.rejects(p.call('EDITOR_DELETE_DUPLICATE',target));assert.equal(p.backups(),0);}const p=setup();p.meta.groups['资料']={locked:true};await assert.rejects(p.call('EDITOR_DELETE_DUPLICATE',{id:'4',dateAdded:4}));assert.equal(p.backups(),0);});
