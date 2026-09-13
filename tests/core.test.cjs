const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const Core=require('../bookmark-core.js');
const folder=(uid,title,children=[])=>({uid,title,children});
const link=(uid,title,url)=>({uid,title,url});
const snapshot=children=>({format:'newtab-bookmarks',version:1,id:'snapshot-test',createdAt:'2026-09-13T00:00:00Z',reason:'test',children,meta:{items:{},groups:{},tags:[]},prefs:{view:'card'}});
class Bookmarks {
  constructor(){this.seq=1;this.nodes=new Map([['0',{id:'0',title:'',children:['1']}],['1',{id:'1',title:'bar',parentId:'0',folderType:'bookmarks-bar',dateAdded:1,children:[]}]]);this.moves=0;}
  clone(n,deep=false){const r={...n};if(n.parentId)r.index=this.nodes.get(n.parentId).children.indexOf(n.id);if(n.children) {if(deep)r.children=n.children.map(id=>this.clone(this.nodes.get(id),true));else delete r.children;}return r;}
  async create(p){const id=String(++this.seq),n={id,parentId:p.parentId,title:p.title||'',dateAdded:1000+this.seq,...(p.url?{url:p.url}:{children:[]})};this.nodes.set(id,n);const parent=this.nodes.get(n.parentId);parent.children.splice(p.index??parent.children.length,0,id);return this.clone(n);}
  async get(id){if(!this.nodes.has(id))throw Error('not found');return this.clone(this.nodes.get(id));}
  async children(id){return this.nodes.get(id).children.map(id=>this.clone(this.nodes.get(id)));}
  async getTree(){return [this.clone(this.nodes.get('0'),true)];}
  async update(id,patch){Object.assign(this.nodes.get(id),patch);return this.get(id);}
  async move(id,p){this.moves++;const n=this.nodes.get(id);let ancestor=p.parentId||n.parentId;while(ancestor){if(ancestor===id)throw Error('cycle');ancestor=this.nodes.get(ancestor)?.parentId;}const old=this.nodes.get(n.parentId),dest=this.nodes.get(p.parentId||n.parentId),idx=old.children.indexOf(id);let at=p.index??dest.children.length;if(dest===old&&at>idx)at--;old.children.splice(idx,1);dest.children.splice(at,0,id);n.parentId=dest.id;return this.get(id);}
  async remove(id){const n=this.nodes.get(id);if(n.children?.length)throw Error('not empty');const p=this.nodes.get(n.parentId);p.children.splice(p.children.indexOf(id),1);this.nodes.delete(id);}
  async removeTree(id){for(const c of [...(this.nodes.get(id).children||[])])await this.removeTree(c);await this.remove(id);}
  async seed(nodes,parent='1'){const result=[];for(const n of nodes){const x=await this.create({parentId:parent,title:n.title,...(n.url?{url:n.url}:{})});result.push({...n,id:x.id,dateAdded:x.dateAdded,...(n.children?{children:await this.seed(n.children,x.id)}:{})});}return result;}
}
function storage(initial={}){const data=structuredClone(initial);return {data,async get(keys){if(keys==null)return structuredClone(data);if(typeof keys==='string')return {[keys]:structuredClone(data[keys])};if(Array.isArray(keys))return Object.fromEntries(keys.map(k=>[k,structuredClone(data[k])]));return {...structuredClone(keys),...Object.fromEntries(Object.keys(keys).filter(k=>k in data).map(k=>[k,structuredClone(data[k])]))};},async set(obj){Object.assign(data,structuredClone(obj));},async remove(keys){for(const k of Array.isArray(keys)?keys:[keys])delete data[k];}};}
async function worker(){const api=new Bookmarks(),local=storage({meta:{items:{},groups:{},tags:[]}}),session=storage(),requests=[];
 const chrome={bookmarks:{getTree:()=>api.getTree(),get:async id=>[await api.get(id)],getChildren:id=>api.children(id),create:p=>api.create(p),update:(id,p)=>api.update(id,p),move:(id,p)=>api.move(id,p),remove:id=>api.remove(id),removeTree:id=>api.removeTree(id)},storage:{local,session},permissions:{contains:async()=>true},alarms:{get:async()=>({}),create:async()=>{}}};
 const context=vm.createContext({chrome,crypto:webcrypto,TextEncoder,URL,AbortSignal,console,btoa:s=>Buffer.from(s,'binary').toString('base64'),fetch:async(url,options)=>{requests.push({url,options});return {ok:true,status:201,text:async()=>'<d:multistatus xmlns:d="DAV:"/>',json:async()=>({})};}});
 for(const f of ['bookmark-core.js','backup-worker.js','editor-worker.js'])vm.runInContext(fs.readFileSync(require.resolve('../'+f),'utf8'),context);
 const call=(name,m)=>{context.message=m;return vm.runInContext(name+'(message)',context);};return {api,local,session,requests,call,context};
}
test('diff distinguishes rename, URL, move, delete; adding a sibling does not mark others reordered',()=>{
 const a=snapshot([folder('a','A',[link('x','X','https://x.test')]),folder('b','B'),link('gone','Gone','https://gone.test')]);
 const b=snapshot([link('new','New','https://new.test'),folder('a','A'),folder('b','B',[link('x','XX','https://new-x.test')])]);
 const p=Core.plan(a,b);assert.deepEqual(p.changes.filter(c=>c.uid==='x').map(c=>c.op),['改名','改地址','移动']);assert.equal(p.changes.filter(c=>c.op==='排序').length,0);assert(p.changes.some(c=>c.op==='删除'));
});
test('restore preserves matching IDs/dateAdded, handles parent inversion, duplicate URLs and exact order',async()=>{
 const api=new Bookmarks();const current=snapshot(await api.seed([folder('a','A',[folder('b','B',[link('x','X','https://x.test')]),link('dup','duplicate','https://x.test')]),link('gone','gone','https://gone.test')]));
 const ids=Object.fromEntries(Core.flatten(current.children).map(n=>[n.uid,[n.id,n.dateAdded]]));
 const desired=snapshot([folder('b','B',[folder('a','renamed',[link('x','X2','https://x.test/2')]),link('new','New','https://new.test')]),link('dup','duplicate','https://x.test')]);
 const live=await Core.restore(api,'1',current,desired);
 for(const uid of ['a','b','x','dup'])assert.deepEqual([live.get(uid).id,live.get(uid).dateAdded],ids[uid]);
 assert.deepEqual((await api.children('1')).map(n=>n.title),['B','duplicate']);assert.equal(api.nodes.size,7);assert.equal((await api.children(live.get('b').id)).length,2);
});
test('unchanged restore makes no moves, cross-profile unambiguous URLs reuse existing nodes',async()=>{
 const api=new Bookmarks(),current=snapshot(await api.seed([link('one','One','https://one.test')]));
 await Core.restore(api,'1',current,structuredClone(current));assert.equal(api.moves,0);
 const desired=snapshot([link('different','Renamed','https://one.test')]);const p=Core.plan(current,desired);assert.equal(p.match.get('different').id,current.children[0].id);
});
test('malformed or prototype-injecting backups rejected before mutations',()=>{
 assert.throws(()=>Core.validate(snapshot([link('x','X','https://x.test'),link('x','Y','https://y.test')])));
 const bad=JSON.parse(JSON.stringify(snapshot([])).replace('"items":{}','"items":{"__proto__":{"polluted":true}}'));assert.throws(()=>Core.validate(bad));assert.equal({}.polluted,undefined);
 assert.throws(()=>Core.validUrl('javascript:alert(1)'));assert.equal(Core.validUrl('example.com'),'https://example.com/');
});
test('editor retains unsaved title draft, immediately saves metadata, rejects stale edits and keeps duplicate URL metadata',async()=>{
 const w=await worker();const [node,dup]=await w.api.seed([link('n','Name','https://same.test/#a'),link('d','Dup','https://same.test/#b')]);
 const windowId=1;await w.call('editorAction',{type:'EDITOR_SELECT',windowId,id:node.id});
 await w.call('editorAction',{type:'EDITOR_DRAFT',windowId,patch:{name:'Changed',alias:'Alias'}});
 assert.equal((await w.api.get(node.id)).title,'Name');assert.equal(w.local.data.meta.items['https://same.test'].name,'Alias');
 const loaded=await w.call('editorAction',{type:'EDITOR_LOAD',windowId});assert.equal(loaded.draft.fields.name,'Changed');
 await w.call('editorAction',{type:'EDITOR_DRAFT',windowId,patch:{url:'https://new.test'}});await w.call('editorAction',{type:'EDITOR_SAVE',windowId});
 assert.equal(w.local.data.meta.items['https://same.test'].name,'Alias');assert.equal(w.local.data.meta.items['https://new.test'].name,'Alias');
 await w.call('editorAction',{type:'EDITOR_DRAFT',windowId,patch:{name:'Another'}});await w.api.update(node.id,{title:'External'});
 await assert.rejects(()=>w.call('editorAction',{type:'EDITOR_SAVE',windowId}),/其他地方修改/);assert.equal((await w.api.get(node.id)).title,'External');
});
test('backups exclude credentials, guard stale preview and preserve a safety version',async()=>{
 const w=await worker();const [n]=await w.api.seed([link('x','X','https://x.test')]);w.local.data.ai={key:'secret'};w.local.data.webdav={password:'othersecret'};
 await w.call('backupAction',{type:'BACKUP_CREATE'});const b=w.local.data.backups[0];assert(!JSON.stringify(b).includes('secret'));assert(!('id' in b.children[0]));
 await w.api.update(n.id,{title:'Change'});let p=await w.call('backupAction',{type:'BACKUP_PREVIEW',snapshot:b});await w.api.update(n.id,{title:'Concurrent'});
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_RESTORE',token:p.token}),/已变化/);
 p=await w.call('backupAction',{type:'BACKUP_PREVIEW',snapshot:b});await w.call('backupAction',{type:'BACKUP_RESTORE',token:p.token});assert.equal((await w.api.get(n.id)).title,'X');assert.equal(w.local.data.backups[0].reason,'恢复前自动保护');assert(!w.local.data.restoreInProgress);
});
test('partial restore leaves recovery marker and safety backup',async()=>{
 const w=await worker();const [n]=await w.api.seed([link('x','X','https://x.test')]);await w.call('backupAction',{type:'BACKUP_CREATE'});const b=w.local.data.backups[0];await w.api.update(n.id,{title:'Changed'});const p=await w.call('backupAction',{type:'BACKUP_PREVIEW',snapshot:b});w.api.update=async()=>{throw Error('simulated failure')};
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_RESTORE',token:p.token}),/恢复未完成/);assert(w.local.data.restoreInProgress);assert.equal(w.local.data.backups[0].children[0].title,'Changed');
});
test('WebDAV uses distinct filenames, no-overwrite header, and only configured HTTPS directory',async()=>{
 const w=await worker();await w.api.seed([link('x','X','https://x.test')]);await w.call('backupAction',{type:'BACKUP_DAV_SAVE',config:{url:'https://dav.jianguoyun.com/dav/test/',username:'user',password:'pass',enabled:false}});
 await w.call('backupAction',{type:'BACKUP_CREATE'});let id=w.local.data.backups[0].id;await w.call('backupAction',{type:'BACKUP_DAV_UPLOAD',id});
 await w.call('backupAction',{type:'BACKUP_CREATE'});id=w.local.data.backups[0].id;await w.call('backupAction',{type:'BACKUP_DAV_UPLOAD',id});
 const puts=w.requests.filter(r=>r.options.method==='PUT');assert.equal(puts.length,2);assert.notEqual(puts[0].url,puts[1].url);assert.equal(puts[0].options.headers['If-None-Match'],'*');assert.equal(puts[0].options.redirect,'error');assert(!puts[0].options.body.includes('pass'));
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_DAV_SAVE',config:{url:'https://evil.test/',enabled:false}}));
});
