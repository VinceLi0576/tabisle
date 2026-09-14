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
 const chrome={bookmarks:{getTree:()=>api.getTree(),get:async id=>[await api.get(id)],getChildren:id=>api.children(id),create:p=>api.create(p),update:(id,p)=>api.update(id,p),move:(id,p)=>api.move(id,p),remove:id=>api.remove(id),removeTree:id=>api.removeTree(id)},storage:{local,session},permissions:{contains:async()=>true},alarms:{get:async()=>({}),create:async()=>{},clear:async()=>{}}};
 const context=vm.createContext({chrome,crypto:webcrypto,TextEncoder,URL,AbortSignal,console,btoa:s=>Buffer.from(s,'binary').toString('base64'),fetch:async(url,options)=>{requests.push({url,options});return {ok:options.method!=='GET',status:options.method==='GET'?404:201,text:async()=>'<d:multistatus xmlns:d="DAV:"/>',json:async()=>({})};}});
 // 🔴 直接读 background.js 的 importScripts 名单，别在这儿抄一份 ——
 // 抄的那份漏掉新加的文件时，报的是 "XxxCore is not defined"，看不出是名单没跟上
 const WORKER_FILES=fs.readFileSync(require.resolve('../background.js'),'utf8').match(/importScripts\(([^)]*)\)/)[1].match(/'([^']+)'/g).map(x=>x.slice(1,-1));
 for(const f of WORKER_FILES)vm.runInContext(fs.readFileSync(require.resolve('../'+f),'utf8'),context);
 vm.runInContext('automationJitter=()=>0',context);
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
 const w=await worker(),server=davServer();w.context.fetch=async(url,options)=>{w.requests.push({url,options});return server.fetch(url,options);};await w.api.seed([link('x','X','https://x.test')]);await w.call('backupAction',{type:'BACKUP_DAV_SAVE',config:{url:'https://dav.jianguoyun.com/dav/test/',username:'user',password:'pass',enabled:false}});
 await w.call('backupAction',{type:'BACKUP_CREATE'});let id=w.local.data.backups[0].id;await w.call('backupAction',{type:'BACKUP_DAV_UPLOAD',id});
 await w.call('backupAction',{type:'BACKUP_CREATE'});id=w.local.data.backups[0].id;await w.call('backupAction',{type:'BACKUP_DAV_UPLOAD',id});
 const puts=w.requests.filter(r=>r.options.method==='PUT');assert.equal(puts.length,2);assert.notEqual(puts[0].url,puts[1].url);assert.equal(puts[0].options.headers['If-None-Match'],'*');assert.equal(puts[0].options.redirect,'error');assert(!puts[0].options.body.includes('pass'));
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_DAV_SAVE',config:{url:'https://evil.test/',enabled:false}}));
});
test('backup modes stop automatic local and cloud work without deleting bookmarks or old versions',async()=>{
 const w=await worker();await w.api.seed([link('x','X','https://x.test')]);
 const initial=await w.call('backupAction',{type:'BACKUP_STATUS'});assert.equal(initial.backupMode,'webdav');assert.equal(initial.webdav.enabled,false);
 await w.call('backupAction',{type:'BACKUP_CREATE'});w.local.data.webdav={enabled:true,url:'https://dav.jianguoyun.com/dav/test/',username:'user',password:'pass'};
 await w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'local',auto:true,intervalDays:1,device:'Test'});w.local.data.lastBackupAt='2020-01-01';
 await w.call('maybeBackup',{});assert.equal(w.requests.length,0);assert.equal(w.local.data.backups.length,1);assert.equal((await w.api.children('1')).length,1);assert.equal(w.local.data.webdav.enabled,false);
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_AUTO',enabled:true}),/纯本地/);
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_DAV_UPLOAD',id:w.local.data.backups[0].id}),/关闭云端/);
 const exported=await w.call('backupAction',{type:'BACKUP_EXPORT_CURRENT'});assert.equal(exported.device,'Test');assert.equal(w.local.data.backups.length,1);
 await w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'browser',auto:true,intervalDays:7,device:'Test'});await w.call('maybeBackup',{});assert.equal(w.local.data.backups[0].reason,'定时自动备份');assert.equal(w.requests.length,0);
 const before96=w.local.data.backups[0].id;await w.call('maybeBackup',{});assert.equal(w.local.data.backups[0].id,before96,'刚备过、还没到点，不该再出一版');
});
test('failed WebDAV verification preserves previous credentials and policy; successful connection creates nested directories',async()=>{
 const w=await worker();const old={enabled:false,url:'https://dav.jianguoyun.com/dav/old/',username:'old',password:'oldpass'};w.local.data.webdav=old;w.local.data.backupMode='local';
 const config={url:'https://dav.jianguoyun.com/dav/TabIsle/backups/',username:'new',password:'newpass'};
 const fetch=w.context.fetch;w.context.fetch=async()=>({ok:false,status:401});
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_DAV_CONNECT',config}),/401/);assert.deepEqual(w.local.data.webdav,old);assert.equal(w.local.data.backupMode,'local');
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_DAV_CONNECT',config:{...config,password:''}}),/更换账号/);
 w.context.fetch=fetch;await w.call('backupAction',{type:'BACKUP_DAV_CONNECT',config});assert.equal(w.local.data.webdav.enabled,true);assert.equal(w.local.data.backupMode,'webdav');
 assert.deepEqual(w.requests.map(r=>[r.options.method,r.url]),[['MKCOL','https://dav.jianguoyun.com/dav/TabIsle/'],['MKCOL',config.url],['PROPFIND',config.url]]);
});
test('cloud retry is idempotent after a lost response, and cloud failures never stop scheduled local versions',async()=>{
 const w=await worker(),clock=clockFor(w);w.local.data.webdav={enabled:true,url:'https://dav.jianguoyun.com/dav/test/',username:'user',password:'pass'};
 const remote=new Map();let fail=true;
 w.context.fetch=async(url,options)=>{w.requests.push({url,options});if(options.method==='PUT'){if(remote.has(url))return {ok:false,status:412};remote.set(url,options.body);if(fail)throw Error('lost response');}return {ok:options.method!=='GET'||remote.has(url),status:options.method==='GET'&&!remote.has(url)?404:201,text:async()=>remote.get(url)||''};};
 const first=await w.call('backupAction',{type:'BACKUP_CREATE'});assert(first.warning);assert(w.local.data.pendingCloudBackup);
 fail=false;w.local.data.lastCloudAttemptAt='2020-01-01';await w.call('maybeBackup',{});assert.equal(w.local.data.backups.length,1);assert.equal(remote.size,1);assert(!w.local.data.pendingCloudBackup);assert(w.requests.some(r=>r.options.method==='GET'));
 clock.now+=3600001;w.context.fetch=async()=>{throw Error('offline')};const b113=w.local.data.backups[0].id;await assert.rejects(()=>w.call('maybeBackup',{}),/offline/);assert.notEqual(w.local.data.backups[0].id,b113,'云端离线，本机版本照出');
 clock.now+=3600001;const b114=w.local.data.backups[0].id;await assert.rejects(()=>w.call('maybeBackup',{}),/offline/);assert.notEqual(w.local.data.backups[0].id,b114);assert.equal(w.local.data.pendingCloudBackup,w.local.data.backups[0].id);assert.equal(w.local.data.backups.filter(b=>b.reason==='定时自动备份').length,1,'定时的只留最新 1 份');
});
test('monthly cloud listing is read-only and rejects path traversal; conflicting existing files are never overwritten',async()=>{
 const w=await worker();w.local.data.webdav={enabled:true,url:'https://dav.jianguoyun.com/dav/test/',username:'user',password:'pass'};
 await w.call('backupAction',{type:'BACKUP_DAV_LIST',period:'2026-09'});assert.equal(w.requests[0].options.method,'PROPFIND');assert(w.requests[0].url.endsWith('/2026-09/'));
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_DAV_LIST',period:'../other'}));await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_DAV_GET',name:'../bookmarks-test.json'}));assert.equal(w.requests.length,1);
 w.context.fetch=async(url,options)=>({ok:options.method!=='PUT',status:options.method==='PUT'?412:200,text:async()=>'different'});
 const r=await w.call('backupAction',{type:'BACKUP_CREATE'});assert.match(r.warning,/未覆盖/);assert(w.local.data.pendingCloudBackup);
});
test('folder folding migrates across browser IDs and clearing history protects an incomplete restore',async()=>{
 const w=await worker();const [f]=await w.api.seed([folder('f','Folder',[link('x','X','https://x.test')])]);w.local.data.folderCollapsed={[`${f.id}:${f.dateAdded}`]:true};
 const saved=await w.call('backupAction',{type:'BACKUP_EXPORT_CURRENT'});assert.equal(saved.folderState[saved.children[0].uid],true);
 const other=await worker();await other.api.seed([link('z','Z','https://z.test')]);const p=await other.call('backupAction',{type:'BACKUP_PREVIEW',snapshot:saved});assert.equal(p.folderStateChanged,true);
 await other.call('backupAction',{type:'BACKUP_RESTORE',token:p.token});const [restored]=await other.api.children('1');assert.equal(other.local.data.folderCollapsed[`${restored.id}:${restored.dateAdded}`],true);assert.notEqual(restored.id,f.id);
 other.local.data.restoreInProgress={backupId:'protection'};await assert.rejects(()=>other.call('backupAction',{type:'BACKUP_CLEAR_LOCAL'}),/保护副本/);assert(other.local.data.backups.length);
 delete other.local.data.restoreInProgress;await other.call('backupAction',{type:'BACKUP_CLEAR_LOCAL'});assert(!other.local.data.backups);assert.equal((await other.api.children('1')).length,1);assert(other.local.data.meta);
 assert.throws(()=>Core.validate({...saved,folderState:{f:'yes'}}));
});
const Sync=require('../sync-core.js');
test('three-way sync merges separate fields and preserves first-connection additions and duplicate URLs',()=>{
 const b=snapshot([folder('f','Folder',[link('x','X','https://x.test')])]);const l=structuredClone(b),r=structuredClone(b);l.children[0].children[0].title='Local';r.children[0].children[0].url='https://remote.test';
 let m=Sync.merge(b,l,r);assert.equal(m.unresolved,0);assert.equal(m.snapshot.children[0].children[0].title,'Local');assert.equal(m.snapshot.children[0].children[0].url,'https://remote.test');
 m=Sync.merge(null,snapshot([link('l','X','https://x.test'),link('d','X','https://x.test'),link('only','Local','https://local.test')]),snapshot([link('r','X','https://x.test'),link('other','Remote','https://remote.test')]));
 assert.equal(Core.flatten(m.snapshot.children).length,4);assert.equal(Core.flatten(m.snapshot.children).filter(n=>n.url==='https://x.test').length,2);
});
test('sync stops same-field and delete-vs-subtree-change conflicts until explicitly resolved',()=>{
 const b=snapshot([folder('f','Folder',[link('x','X','https://x.test')])]);let l=structuredClone(b),r=structuredClone(b);l.children[0].title='L';r.children[0].title='R';
 let m=Sync.merge(b,l,r);assert.equal(m.unresolved,1);m=Sync.merge(b,l,r,{'f:title':'remote'});assert.equal(m.unresolved,0);assert.equal(m.snapshot.children[0].title,'R');
 l=snapshot([]);r=structuredClone(b);r.children[0].children.push(link('new','New','https://new.test'));
 m=Sync.merge(b,l,r);assert(m.conflicts.some(c=>c.id==='f:presence'));
 m=Sync.merge(b,l,r,{'f:presence':'remote'});assert.equal(m.snapshot.children[0].children.some(n=>n.uid==='new'),true);assert.equal(m.snapshot.children[0].children.some(n=>n.uid==='x'),true);
 m=Sync.merge(b,l,r,{'f:presence':'local'});assert.equal(m.snapshot.children.length,0);
});
test('browser ID recreation aligns nodes and suspect deleted-item return requires review',()=>{
 const b=snapshot([link('old','X','https://x.test')]);const l=snapshot([link('new-browser-id','X','https://x.test')]);
 let m=Sync.merge(b,l,b);assert.equal(m.snapshot.children.length,1);assert.equal(m.snapshot.children[0].uid,'old');assert.equal(m.unresolved,0);
 m=Sync.merge(snapshot([]),l,snapshot([]),{},[{uid:'old',path:'X',url:'https://x.test'}]);assert.equal(m.unresolved,1);
 m=Sync.merge(snapshot([]),l,snapshot([]),{'new-browser-id:return':'remote'},[{uid:'old',path:'X',url:'https://x.test'}]);assert.equal(m.snapshot.children.length,0);
});
test('sync propagates evidenced deletions, merges metadata fields and detects incompatible parent cycles',()=>{
 const b=snapshot([link('x','X','https://x.test')]);let m=Sync.merge(b,snapshot([]),b);assert.equal(m.snapshot.children.length,0);assert.equal(m.unresolved,0);assert.equal(m.tombstones.length,1);
 b.meta.items['https://x.test']={name:'Old',desc:'Old',tags:['a']};const l=structuredClone(b),r=structuredClone(b);l.meta.items['https://x.test'].name='Local';r.meta.items['https://x.test'].desc='Remote';r.meta.items['https://x.test'].tags.push('b');
 m=Sync.merge(b,l,r);assert.deepEqual(m.snapshot.meta.items['https://x.test'],{name:'Local',desc:'Remote',tags:['a','b']});assert.equal(m.unresolved,0);
 const folders=snapshot([folder('a','A'),folder('b','B')]);assert.throws(()=>Sync.merge(folders,snapshot([folder('b','B',[folder('a','A')])]),snapshot([folder('a','A',[folder('b','B')])])),/循环/);
});
function davServer(){
 const files=new Map(),requests=[];let revision=0,ignoreConditions=false,loseStateResponse=false,rawTags=false,omitHeadTag=false;
 async function fetch(url,o){requests.push({url,...o});const old=files.get(url),h=o.headers||{};const response=(status,file=old)=>({ok:status>=200&&status<300,status,headers:{get:k=>k.toLowerCase()==='etag'&&!(o.method==='HEAD'&&omitHeadTag)?(rawTags?file?.etag.replaceAll('"',''):file?.etag):null},text:async()=>file?.body||''});
  if(o.method==='MKCOL')return response(201);
  if(!ignoreConditions&&(h['If-None-Match']==='*'&&old||h['If-Match']&&h['If-Match']!==(rawTags?old?.etag.replaceAll('"',''):old?.etag)))return response(412);
  if(['GET','HEAD'].includes(o.method))return response(old?200:404);
  if(o.method==='MOVE'){if(!old)return response(404);if(o.headers.Overwrite==='F'&&files.has(o.headers.Destination))return response(409);files.set(o.headers.Destination,old);files.delete(url);return response(201,old);}
  if(o.method==='PUT'){files.set(url,{body:o.body,etag:'"'+(++revision)+'"'});if(loseStateResponse&&url.endsWith('/sync/state.json')){loseStateResponse=false;throw Error('lost sync response');}return response(201,files.get(url));}
  if(o.method==='DELETE'){files.delete(url);return response(204);}throw Error(o.method);
 }
 return {files,requests,fetch,set rawTags(v){rawTags=v;},set omitHeadTag(v){omitHeadTag=v;},set ignoreConditions(v){ignoreConditions=v;},set loseStateResponse(v){loseStateResponse=v;}};
}
async function syncedWorker(server){const w=await worker();w.context.fetch=server.fetch;w.local.data.backupMode='webdav';w.local.data.webdav={enabled:true,url:'https://dav.jianguoyun.com/dav/test/',username:'user',password:'pass'};return w;}
test('direct WebDAV sync verifies conditional writes, merges two browsers, syncs notes, and converges without echo writes',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);await a.api.seed([link('x','X','https://x.test')]);await b.api.seed([link('y','Y','https://y.test')]);
 a.local.data.meta.items['https://x.test']={name:'Remark'};
 let p=await a.call('syncAction',{type:'SYNC_PREVIEW'});assert(p.first);assert.equal(p.unresolved,0);await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 p=await b.call('syncAction',{type:'SYNC_PREVIEW'});assert(p.first);await b.call('syncAction',{type:'SYNC_APPLY',token:p.token});assert.equal((await b.api.children('1')).length,2);assert.equal(b.local.data.meta.items['https://x.test'].name,'Remark');
 p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});assert.equal((await a.api.children('1')).length,2);
 const count=()=>server.requests.filter(r=>r.method==='PUT'&&r.url.endsWith('/sync/state.json')).length;const n=count();p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});assert.equal(count(),n);
 assert(![...server.files.keys()].some(k=>k.includes('probe-')));assert(server.requests.some(r=>r.headers?.['If-Match']));
});
test('servers ignoring conditions cannot enable sync or overwrite the shared file',async()=>{
 const server=davServer();server.ignoreConditions=true;const w=await syncedWorker(server);
 await assert.rejects(()=>w.call('syncAction',{type:'SYNC_PREVIEW'}),/防覆盖验证/);assert(!w.local.data.syncVerified);assert(![...server.files.keys()].some(k=>k.endsWith('state.json')));
});
test('account sync arrivals before WebDAV align new folders and links, preserve notes and stop echo writes',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);
 const sync=async w=>{const p=await w.call('syncAction',{type:'SYNC_PREVIEW'});assert.equal(p.unresolved,0);await w.call('syncAction',{type:'SYNC_APPLY',token:p.token});};
 await sync(a);await sync(b);
 await a.api.seed([folder('f','Research',[link('x','Article','https://article.test')])]);
 a.local.data.meta.items['https://article.test']={name:'My note',tags:['reading']};await sync(a);
 // Google delivers the same native tree without the extension's UUIDs or metadata.
 const [arrived]=await b.api.seed([folder('google-f','Research',[link('google-x','Article','https://article.test')])]);
 const writes=()=>server.requests.filter(r=>r.method==='PUT'&&r.url.endsWith('/sync/state.json')).length;
 const before=writes();await sync(b);await sync(a);await sync(b);
 assert.equal((await b.api.children('1')).length,1);assert.equal((await b.api.children(arrived.id)).length,1);
 assert.equal((await b.api.children(arrived.id))[0].id,arrived.children[0].id);
 assert.equal(b.local.data.meta.items['https://article.test'].name,'My note');assert.equal(writes(),before);
});
test('account sync reintroducing a deleted bookmark follows cloud deletion without manual review',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);
 const sync=async w=>{const p=await w.call('syncAction',{type:'SYNC_PREVIEW'});assert.equal(p.unresolved,0);await w.call('syncAction',{type:'SYNC_APPLY',token:p.token});};
 const [x]=await a.api.seed([link('x','Article','https://article.test')]);await sync(a);await sync(b);
 await a.api.remove(x.id);await sync(a);await sync(b);
 const before=server.files.get('https://dav.jianguoyun.com/dav/test/sync/state.json').body;
 await b.api.create({parentId:'1',title:'Article',url:'https://article.test'});
 await b.call('syncAction',{type:'SYNC_AUTO',enabled:true});b.local.data.lastSyncAt='2020-01-01';await b.call('maybeSync',{});
 assert.equal(b.local.data.syncAuto,true);assert.equal(b.local.data.syncError,'');
 assert.equal(server.files.get('https://dav.jianguoyun.com/dav/test/sync/state.json').body,before);
 assert.equal((await b.api.children('1')).length,0);
 assert(b.local.data.lastSyncReceipt);
 const p=await b.call('syncAction',{type:'SYNC_PREVIEW'});assert.equal(p.unresolved,0);
});
test('stale local or remote sync previews never apply; failed write response keeps recovery marker and stops automation',async()=>{
 const server=davServer(),a=await syncedWorker(server);const [n]=await a.api.seed([link('x','X','https://x.test')]);let p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.api.update(n.id,{title:'Changed'});
 await assert.rejects(()=>a.call('syncAction',{type:'SYNC_APPLY',token:p.token}),/本机数据已变化/);
 p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 p=await a.call('syncAction',{type:'SYNC_PREVIEW'});const remote=server.files.get('https://dav.jianguoyun.com/dav/test/sync/state.json');remote.etag='"another-writer"';
 await assert.rejects(()=>a.call('syncAction',{type:'SYNC_APPLY',token:p.token}),/另一台设备/);
 await a.api.update(n.id,{title:'Next'});p=await a.call('syncAction',{type:'SYNC_PREVIEW'});server.loseStateResponse=true;
 await assert.rejects(()=>a.call('syncAction',{type:'SYNC_APPLY',token:p.token}),/lost sync response/);assert(a.local.data.syncInProgress);assert.equal(a.local.data.syncAuto,false);
 p=await a.call('syncAction',{type:'SYNC_PREVIEW'});assert(p.recovery);assert(p.first);assert.equal(p.unresolved,0);await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});assert(!a.local.data.syncInProgress);assert.equal((await a.api.children('1')).length,1);
});
test('automatic sync adopts cloud conflict value and keeps a recoverable local snapshot',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);const [n]=await a.api.seed([link('x','X','https://x.test')]);
 for(const w of [a,b]){const p=await w.call('syncAction',{type:'SYNC_PREVIEW'});await w.call('syncAction',{type:'SYNC_APPLY',token:p.token});}
 await a.api.update(n.id,{title:'A'});const [bn]=await b.api.children('1');await b.api.update(bn.id,{title:'B'});
 let p=await b.call('syncAction',{type:'SYNC_PREVIEW'});await b.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 await a.call('syncAction',{type:'SYNC_AUTO',enabled:true});a.local.data.lastSyncAt='2020-01-01';await a.call('maybeSync',{});assert.equal(a.local.data.syncAuto,true);assert.equal(a.local.data.syncError,'');assert.equal((await a.api.get(n.id)).title,'B');
 const backups=await a.call('backupAction',{type:'BACKUP_STATUS'});assert(backups.backups.length>0);
 assert.equal(a.local.data.lastSyncReceipt.uploaded,false);
});
test('CAS race after preview cannot overwrite a newer cloud document',async()=>{
 const server=davServer(),w=await syncedWorker(server);const [n]=await w.api.seed([link('x','X','https://x.test')]);let p=await w.call('syncAction',{type:'SYNC_PREVIEW'});await w.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 await w.api.update(n.id,{title:'Local'});p=await w.call('syncAction',{type:'SYNC_PREVIEW'});
 let externalBody;w.context.fetch=async(url,o)=>{if(o.method==='PUT'&&url.endsWith('/sync/state.json')){const file=server.files.get(url),doc=JSON.parse(file.body);doc.revision='external';doc.snapshot.children[0].title='External';file.body=JSON.stringify(doc);externalBody=file.body;file.etag='"external"';}return server.fetch(url,o);};
 await assert.rejects(()=>w.call('syncAction',{type:'SYNC_APPLY',token:p.token}),/本次未覆盖/);assert.equal(server.files.get('https://dav.jianguoyun.com/dav/test/sync/state.json').body,externalBody);assert.equal((await w.api.get(n.id)).title,'Local');assert(!w.local.data.syncInProgress);
});
test('interrupted local application preserves concurrent additions and resumes by merging instead of deleting them',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);await a.api.seed([link('x','X','https://x.test')]);let p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 p=await b.call('syncAction',{type:'SYNC_PREVIEW'});const create=b.api.create.bind(b.api);let injected=false;b.api.create=async args=>{const n=await create(args);if(!injected){injected=true;await create({parentId:'1',title:'Concurrent user bookmark',url:'https://concurrent.test'});}return n;};
 await assert.rejects(()=>b.call('syncAction',{type:'SYNC_APPLY',token:p.token}),/同时新增/);assert.equal((await b.api.children('1')).length,2);assert(b.local.data.syncInProgress);
 b.api.create=create;p=await b.call('syncAction',{type:'SYNC_PREVIEW'});assert(p.recovery);await b.call('syncAction',{type:'SYNC_APPLY',token:p.token});assert.equal((await b.api.children('1')).length,2);assert(!b.local.data.syncInProgress);
});
test('changing DAV account starts a fresh merge; forgetting the connection removes its identity and sync state',async()=>{
 const server=davServer(),w=await syncedWorker(server);await w.api.seed([link('x','X','https://x.test')]);let p=await w.call('syncAction',{type:'SYNC_PREVIEW'});await w.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 w.local.data.webdav.username='another-account';w.local.data.syncVerified=null;p=await w.call('syncAction',{type:'SYNC_PREVIEW'});assert(p.first);
 await w.call('backupAction',{type:'BACKUP_DAV_FORGET'});assert(!w.local.data.syncState);assert(!w.local.data.syncVerified);assert(!w.session.data.syncPreview);assert.equal(w.local.data.webdav.username,'');assert.equal((await w.api.children('1')).length,1);
});
test('backup retries compare semantic JSON and never overwrite a differing existing copy on servers ignoring create-only headers',async()=>{
 const server=davServer(),w=await syncedWorker(server);server.ignoreConditions=true;await w.api.seed([link('x','X','https://x.test')]);await w.call('backupAction',{type:'BACKUP_CREATE'});
 const b=w.local.data.backups[0],entry=[...server.files.entries()].find(([url])=>url.includes('/bookmarks-'));assert(entry);
 const [url,file]=entry;file.body=Core.stableStringify(JSON.parse(file.body));const puts=()=>server.requests.filter(r=>r.method==='PUT'&&r.url===url).length;
 const before=puts();await w.call('backupAction',{type:'BACKUP_DAV_UPLOAD',id:b.id});assert.equal(puts(),before);
 const changed=JSON.parse(file.body);changed.children[0].title='Different cloud data';file.body=JSON.stringify(changed);
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_DAV_UPLOAD',id:b.id}),/未覆盖/);assert.equal(puts(),before);assert.equal(JSON.parse(file.body).children[0].title,'Different cloud data');
});
test('nonstandard DAV conditional writes report transfer success separately from unsupported sync and clean their probes',async()=>{
 const server=davServer(),w=await syncedWorker(server);const standard=server.fetch;
 w.context.fetch=async(url,o)=>{
  if(o.headers?.['If-Match'])return {ok:false,status:412,headers:{get:()=>null},text:async()=>''};
  const opts={...o,headers:{...o.headers}};delete opts.headers['If-None-Match'];const r=await standard(url,opts);const get=r.headers.get;r.headers.get=k=>k==='etag'?get(k)?.replaceAll('"',''):get(k);return r;
 };
 await assert.rejects(()=>w.call('syncAction',{type:'SYNC_PREVIEW'}),/防覆盖验证/);
 const check=w.local.data.syncCheck;assert.equal(check.upload,true);assert.equal(check.download,true);assert.equal(check.conditionalCreate,true);assert.equal(check.conditionalUpdate,false);assert.equal(check.compatible,false);assert.equal(check.cleaned,true);assert(![...server.files.keys()].some(k=>k.includes('probe-')));assert.equal(w.local.data.syncAuto,false);
 const status=await w.call('syncAction',{type:'SYNC_STATUS'});assert.equal(status.verified,false);assert(!('endpoint' in status.check));
});
test('Jianguoyun bare version tokens support verified updates and initial MOVE refuses a racing writer',async()=>{
 const server=davServer();server.rawTags=true;const w=await syncedWorker(server);await w.api.seed([link('x','X','https://x.test')]);const p=await w.call('syncAction',{type:'SYNC_PREVIEW'});assert.equal(w.local.data.syncCheck.compatible,true);
 let competing;
 w.context.fetch=async(url,o)=>{if(o.method==='MOVE'&&o.headers.Destination.endsWith('/sync/state.json')){competing=JSON.stringify({format:'tabisle-sync',version:1,revision:'other',snapshot:snapshot([link('other','Other','https://other.test')])});server.files.set(o.headers.Destination,{body:competing,etag:'"racer"'});}return server.fetch(url,o);};
 await assert.rejects(()=>w.call('syncAction',{type:'SYNC_APPLY',token:p.token}),/本次未覆盖/);assert.equal(server.files.get('https://dav.jianguoyun.com/dav/test/sync/state.json').body,competing);assert(![...server.files.keys()].some(k=>k.includes('/stage-')));
});
test('JSON object field order does not produce false restore or metadata conflicts, while array order still matters',()=>{
 const a=snapshot([]),b=structuredClone(a);a.meta.items['https://x.test']={name:'X',desc:'Note'};b.meta.items['https://x.test']={desc:'Note',name:'X'};a.prefs={view:'card',filterMode:'and'};b.prefs={filterMode:'and',view:'card'};
 const plan=Core.plan(a,b);assert.equal(plan.metaChanged,false);assert.equal(plan.prefsChanged,false);assert.equal(Sync.equal(a.meta,b.meta),true);assert.equal(Sync.equal(['a','b'],['b','a']),false);
});
test('device names initialize once, preserve custom names, and renames leave old snapshots and device identity unchanged',async()=>{
 const w=await worker();w.local.data.backupDevice='未命名设备';
 let status=await w.call('backupAction',{type:'BACKUP_STATUS'});const name=status.backupDevice,id=w.local.data.backupDeviceId;
 assert.match(name,/^[\p{Script=Han}]+·[\p{Script=Han}]+·[\p{Script=Han}]+$/u);assert(id);
 assert.equal((await w.call('backupAction',{type:'BACKUP_STATUS'})).backupDevice,name);
 const created=await w.call('backupAction',{type:'BACKUP_CREATE'});const old=await w.call('backupAction',{type:'BACKUP_GET',id:created.id});assert.equal(old.device,name);assert.equal(old.deviceId,id);
 const saved=JSON.stringify(w.local.data.backups);
 await w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'local',intervalDays:1,device:'A1',auto:false});
 const next=await w.call('backupAction',{type:'BACKUP_EXPORT_CURRENT'});assert.equal(next.device,'A1');assert.equal(next.deviceId,id);assert.equal(JSON.stringify(w.local.data.backups),saved);
 await w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'local',intervalDays:1,device:'  ',auto:false});
 assert.equal((await w.call('backupAction',{type:'BACKUP_STATUS'})).backupDevice,'A1');
 const preview=await w.call('backupAction',{type:'BACKUP_PREVIEW',snapshot:old});await w.call('backupAction',{type:'BACKUP_RESTORE',token:preview.token});
 assert.equal(w.local.data.backupDevice,'A1');assert.equal(w.local.data.backupDeviceId,id);
 const custom=await worker();custom.local.data.backupDevice='My Chrome';assert.equal((await custom.call('backupAction',{type:'BACKUP_STATUS'})).backupDevice,'My Chrome');
 assert.notEqual(custom.local.data.backupDeviceId,id);
});
test('renaming a connected device keeps sync identity and automation and causes no shared-state upload',async()=>{
 const server=davServer(),w=await syncedWorker(server);await w.api.seed([link('x','Article','https://article.test')]);
 let p=await w.call('syncAction',{type:'SYNC_PREVIEW'});await w.call('syncAction',{type:'SYNC_APPLY',token:p.token});await w.call('syncAction',{type:'SYNC_AUTO',enabled:true});
 const before=JSON.stringify(w.local.data.syncState),id=w.local.data.backupDeviceId,config=JSON.stringify(w.local.data.webdav),requestCount=server.requests.length;
 await w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'webdav',intervalDays:1,device:'A1',auto:true});
 assert.equal(w.local.data.syncAuto,true);assert.equal(JSON.stringify(w.local.data.syncState),before);assert.equal(w.local.data.backupDeviceId,id);assert.equal(JSON.stringify(w.local.data.webdav),config);assert.equal(server.requests.length,requestCount);
 const body=server.files.get('https://dav.jianguoyun.com/dav/test/sync/state.json').body;
 p=await w.call('syncAction',{type:'SYNC_PREVIEW'});assert.equal(p.first,false);assert.equal(p.localChanges.length,0);assert.equal(p.cloudChanges.length,0);await w.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 assert.equal(server.files.get('https://dav.jianguoyun.com/dav/test/sync/state.json').body,body);
});


test('hourly backups wait until due, accept three hours, and retain legacy daily settings',async()=>{
 const w=await worker();await w.api.seed([link('x','X','https://x.test')]);
 assert.equal((await w.call('backupAction',{type:'BACKUP_STATUS'})).backupIntervalHours,1);
 w.local.data.backupIntervalDays=7;assert.equal((await w.call('backupAction',{type:'BACKUP_STATUS'})).backupIntervalHours,168);
 await w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'browser',intervalHours:1,auto:true});
 w.local.data.lastBackupAt=new Date(Date.now()-59*60000).toISOString();await w.call('maybeBackup');assert(!w.local.data.backups);
 w.local.data.lastBackupAt=new Date(Date.now()-61*60000).toISOString();await w.call('maybeBackup');assert.equal(w.local.data.backups.length,1);
 await w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'browser',intervalHours:3,auto:true});
 w.local.data.lastBackupAt=new Date(Date.now()-121*60000).toISOString();await w.call('maybeBackup');assert.equal(w.local.data.backups.length,1);
 const b314=w.local.data.backups[0].id;w.local.data.lastBackupAt=new Date(Date.now()-181*60000).toISOString();await w.call('maybeBackup');assert.notEqual(w.local.data.backups[0].id,b314,'满 3 小时要出新的一版');
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'browser',intervalHours:0,auto:true}));
});
test('backup receipts require full readback; HTTP success with corrupted content stays pending',async()=>{
 const server=davServer(),w=await syncedWorker(server);await w.api.seed([link('x','X','https://x.test')]);
 await w.call('backupAction',{type:'BACKUP_CREATE'});const status=await w.call('backupAction',{type:'BACKUP_STATUS'});
 assert.equal(status.backupReceipt.count,1);assert.equal(status.backupReceipt.httpStatus,200);assert.match(status.backupReceipt.sha256,/^[a-f0-9]{64}$/);assert(!('account'in status.backupReceipt));
 const old=w.local.data.lastCloudBackupAt;w.context.fetch=async(url,o)=>{const r=await server.fetch(url,o);if(o.method==='GET'&&r.ok&&url.includes('/bookmarks-'))return {...r,text:async()=>JSON.stringify(snapshot([]))};return r;};
 const result=await w.call('backupAction',{type:'BACKUP_CREATE'});assert.match(result.warning,/校验失败/);assert(w.local.data.pendingCloudBackup);assert.equal(w.local.data.lastCloudBackupAt,old);
 w.local.data.webdav.url='https://dav.jianguoyun.com/dav/other/';assert.equal((await w.call('backupAction',{type:'BACKUP_STATUS'})).backupReceipt,null);
});
test('sync receipt proves matching remote and local content; corrupted accepted upload never reports success',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);const [x]=await a.api.seed([link('x','X','https://x.test')]);
 const sync=async w=>{const p=await w.call('syncAction',{type:'SYNC_PREVIEW'});return w.call('syncAction',{type:'SYNC_APPLY',token:p.token});};
 await sync(a);await sync(b);let ra=(await a.call('syncAction',{type:'SYNC_STATUS'})).receipt,rb=(await b.call('syncAction',{type:'SYNC_STATUS'})).receipt;
 assert.equal(ra.sha256,rb.sha256);assert.equal(ra.revision,rb.revision);assert(ra.uploaded);assert(!rb.uploaded);assert(rb.localApplied);assert(!('endpoint'in ra));
 await a.api.update(x.id,{title:'Changed'});const p=await a.call('syncAction',{type:'SYNC_PREVIEW'});const old=a.local.data.lastSyncAt;
 a.context.fetch=async(url,o)=>{const r=await server.fetch(url,o);if(o.method==='PUT'&&url.endsWith('/sync/state.json')){const f=server.files.get(url),doc=JSON.parse(f.body);doc.snapshot.children[0].title='Corrupted';f.body=JSON.stringify(doc);}return r;};
 await assert.rejects(()=>a.call('syncAction',{type:'SYNC_APPLY',token:p.token}),/读回校验/);assert.equal(a.local.data.lastSyncAt,old);assert.equal(a.local.data.syncAuto,false);assert(a.local.data.syncInProgress);
});
test('observers never see a new successful sync receipt with an unfinished marker',async()=>{
 const w=await syncedWorker(davServer());await w.api.seed([link('n','Name','https://example.test')]);
 const set=w.local.set.bind(w.local);let observed=false;
 w.local.set=async patch=>{await set(patch);if(patch.lastSyncReceipt){observed=true;assert.equal(!!w.local.data.syncInProgress,false);assert(w.local.data.syncState.base);}};
 const p=await w.call('syncAction',{type:'SYNC_PREVIEW'});await w.call('syncAction',{type:'SYNC_APPLY',token:p.token});assert(observed);
});
test('stale policy submissions cannot overwrite a newer device name or backup interval',async()=>{
 const w=await worker();const old=(await w.call('backupAction',{type:'BACKUP_STATUS'})).policyState;
 await w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'browser',auto:true,intervalHours:3,device:'New name',expectedPolicy:old});
 await assert.rejects(()=>w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'webdav',auto:false,intervalHours:1,device:'Old name',expectedPolicy:old}),/其他页面更新/);
 assert.equal(w.local.data.backupDevice,'New name');assert.equal(w.local.data.backupIntervalHours,3);assert.equal(w.local.data.backupMode,'browser');
 const fresh=(await w.call('backupAction',{type:'BACKUP_STATUS'})).policyState;
 await w.call('backupAction',{type:'BACKUP_POLICY_SAVE',mode:'browser',auto:true,intervalHours:24,device:'Confirmed',expectedPolicy:fresh});assert.equal(w.local.data.backupDevice,'Confirmed');
});
function clockFor(w,start=Date.parse('2026-09-13T00:00:00Z')) {
 let now=start;const RealDate=Date;
 w.context.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 return {get now(){return now},set now(value){now=value}};
}
test('device deadlines persist across page reads and worker restarts, and differ across devices',async()=>{
 const a=await worker(),b=await worker(),ca=clockFor(a),cb=clockFor(b);
 vm.runInContext('automationJitter=()=>30000',a.context);vm.runInContext('automationJitter=()=>210000',b.context);
 a.local.data.lastBackupAt=b.local.data.lastBackupAt=new Date(ca.now).toISOString();
 const first=await a.call('automationStatus'),second=await b.call('automationStatus');
 assert.equal(first.backup.nextAt,ca.now+3600000+30000);assert.equal(second.backup.nextAt,cb.now+3600000+210000);
 ca.now+=10000;assert.equal((await a.call('automationStatus')).backup.nextAt,first.backup.nextAt);
 vm.runInContext(fs.readFileSync(require.resolve('../automation-worker.js'),'utf8'),a.context);
 assert.equal((await a.call('automationStatus')).backup.nextAt,first.backup.nextAt);
 const portable=await a.call('backupAction',{type:'BACKUP_EXPORT_CURRENT'});assert(!JSON.stringify(portable).includes('automationSchedule'));
});
test('missed deadlines are staggered once after sleep, then execute at their persisted time',async()=>{
 const w=await worker(),clock=clockFor(w);vm.runInContext('automationJitter=()=>45000',w.context);
 const first=await w.call('automationStatus');await w.call('maybeBackup');assert(!w.local.data.backups);
 clock.now=first.backup.nextAt+120000;
 const resumed=await w.call('automationStatus');assert.equal(resumed.backup.nextAt,clock.now+45000);
 assert.equal((await w.call('automationStatus')).backup.nextAt,resumed.backup.nextAt);
 await w.call('maybeBackup');assert(!w.local.data.backups);
 clock.now=resumed.backup.nextAt;await w.call('maybeBackup');assert.equal(w.local.data.backups.length,1);
 assert.equal((await w.call('automationStatus')).backup.nextAt,clock.now+3600000+45000);
});
test('paused and disabled tasks have no countdown; alarm targets earliest active deadline',async()=>{
 const w=await worker(),clock=clockFor(w),alarms=new Map();
 w.context.chrome.alarms={get:async k=>alarms.get(k),create:async(k,o)=>alarms.set(k,{scheduledTime:o.when}),clear:async k=>alarms.delete(k)};
 vm.runInContext('automationJitter=()=>60000',w.context);
 await w.call('refreshAutomationAlarm');assert.equal(alarms.get('bookmark-task-due').scheduledTime,clock.now+60000);
 w.local.data.restoreInProgress={id:'test'};await w.call('refreshAutomationAlarm');assert(!alarms.has('bookmark-task-due'));assert.equal((await w.call('automationStatus')).backup.state,'paused');
 delete w.local.data.restoreInProgress;w.local.data.backupAuto=false;assert.equal((await w.call('automationStatus')).backup.state,'off');
});
test('cloud retry uses its own delay instead of firing on every page visit',async()=>{
 const w=await worker(),clock=clockFor(w);w.local.data.backupAuto=false;w.local.data.webdav={enabled:true};w.local.data.pendingCloudBackup='pending';w.local.data.lastCloudAttemptAt=new Date(clock.now).toISOString();
 vm.runInContext('automationJitter=()=>90000',w.context);
 const plan=await w.call('automationStatus');assert.equal(plan.retry.nextAt,clock.now+300000+90000);assert.equal(plan.backup.state,'off');
 clock.now+=60000;assert.equal((await w.call('automationStatus')).retry.nextAt,plan.retry.nextAt);
});
test('continuous sync respects its deadline without changing backup frequency',async()=>{
 const w=await syncedWorker(davServer()),clock=clockFor(w);await w.api.seed([link('x','X','https://example.test')]);
 const p=await w.call('syncAction',{type:'SYNC_PREVIEW'});await w.call('syncAction',{type:'SYNC_APPLY',token:p.token});await w.call('syncAction',{type:'SYNC_AUTO',enabled:true});
 vm.runInContext('automationJitter=()=>30000',w.context);
 const old=w.local.data.lastSyncAt,plan=await w.call('automationStatus');assert.equal(plan.sync.nextAt,clock.now+60000+30000);
 clock.now+=60000;await w.call('maybeSync');assert.equal(w.local.data.lastSyncAt,old);
 clock.now=plan.sync.nextAt;await w.call('maybeSync');assert.notEqual(w.local.data.lastSyncAt,old);assert.equal(w.local.data.syncAuto,true);
});
test('latest status uses a lightweight HEAD check and minute sync merges pending local and remote versions',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);const [x]=await a.api.seed([link('x','X','https://x.test')]);
 const sync=async w=>{const p=await w.call('syncAction',{type:'SYNC_PREVIEW'});await w.call('syncAction',{type:'SYNC_APPLY',token:p.token});};
 await sync(a);let shared=JSON.parse(server.files.get('https://dav.jianguoyun.com/dav/test/sync/state.json').body);
 assert.equal(shared.parentRevision,null);assert.match(shared.sha256,/^[a-f0-9]{64}$/);assert(shared.updatedAt);assert(shared.updatedBy.id);assert(shared.updatedBy.name);
 const gets=()=>server.requests.filter(r=>r.method==='GET'&&r.url.endsWith('/sync/state.json')).length;
 const before=gets(),current=await a.call('syncAction',{type:'SYNC_LATEST_STATUS'});assert.equal(current.state,'latest');assert.equal(gets(),before);assert.equal(server.requests.at(-1).method,'HEAD');
 server.omitHeadTag=true;const beforeFallback=gets();assert.equal((await a.call('syncAction',{type:'SYNC_LATEST_STATUS'})).state,'latest');assert.equal(gets(),beforeFallback+1);assert.equal(server.requests.at(-1).method,'GET');server.omitHeadTag=false;
 await sync(b);await b.api.seed([link('y','Y','https://y.test')]);await sync(b);
 const newer=await a.call('syncAction',{type:'SYNC_LATEST_STATUS'});assert.equal(newer.state,'cloud-new');assert.equal(newer.remote.updatedBy.id,b.local.data.backupDeviceId);
 await a.api.update(x.id,{title:'X local'});assert.equal((await a.call('syncAction',{type:'SYNC_LATEST_STATUS'})).state,'diverged');
 const clock=clockFor(a);a.local.data.lastSyncAt=new Date(clock.now).toISOString();a.local.data.syncAuto=true;delete a.local.data.automationSchedule;vm.runInContext('automationJitter=()=>5000',a.context);
 const plan=await a.call('automationStatus');assert.equal(plan.sync.nextAt,clock.now+65000);clock.now=plan.sync.nextAt;await a.call('maybeSync');
 assert.equal((await a.api.children('1')).length,2);assert.equal((await a.api.get(x.id)).title,'X local');assert.equal((await a.call('syncAction',{type:'SYNC_LATEST_STATUS'})).state,'latest');assert.equal(a.local.data.syncAuto,true);
});
test('a failed automatic snapshot backs off instead of retrying at every status read',async()=>{
 const w=await worker(),clock=clockFor(w);let attempts=0;
 w.context.chrome.bookmarks.getTree=async()=>{attempts++;throw Error('temporarily unavailable');};
 await assert.rejects(()=>w.call('maybeBackup'),/temporarily unavailable/);assert.equal(attempts,1);
 const schedule=await w.call('automationStatus');assert.equal(schedule.backup.nextAt,clock.now+300000);
 await w.call('maybeBackup');await w.call('automationStatus');assert.equal(attempts,1);
 clock.now=schedule.backup.nextAt;await assert.rejects(()=>w.call('maybeBackup'),/temporarily unavailable/);assert.equal(attempts,2);
});
test('cloud-first interrupted recovery downloads shared version and preserves pre-recovery snapshot',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);
 await a.api.seed([folder('f','Cloud',[link('x','Kept','https://kept.test')])]);
 await a.call('syncAction',{type:'SYNC_NOW'});
 await b.api.seed([link('y','Interrupted local','https://local.test')]);
 b.local.data.syncInProgress={operation:'interrupted'};
 const before=server.files.get('https://dav.jianguoyun.com/dav/test/sync/state.json').body;
 await b.call('syncAction',{type:'SYNC_NOW'});
 assert.equal(server.files.get('https://dav.jianguoyun.com/dav/test/sync/state.json').body,before);
 const roots=await b.api.children('1');assert.equal(roots.length,1);assert.equal(roots[0].title,'Cloud');
 assert.equal(b.local.data.syncInProgress,null);assert.equal(b.local.data.syncAuto,true);
 assert.equal(b.local.data.lastSyncReceipt.uploaded,false);assert.equal(b.local.data.lastSyncReceipt.count,1);
 const status=await b.call('backupAction',{type:'BACKUP_STATUS'});
 const saved=await Promise.all(status.backups.map(x=>b.call('backupAction',{type:'BACKUP_GET',id:x.id})));
 assert(saved.some(s=>Core.flatten(s.children).some(n=>n.url==='https://local.test')));
});
test('Edge native alias round-trips the shared URL without echo uploads',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);
 await a.api.seed([link('x','Bookmarks','chrome://bookmarks/')]);await a.call('syncAction',{type:'SYNC_NOW'});
 const create=b.api.create.bind(b.api);b.api.create=p=>create({...p,url:p.url==='chrome://bookmarks/'?'edge://favorites/':p.url});
 await b.call('syncAction',{type:'SYNC_NOW'});
 assert.equal((await b.api.children('1'))[0].url,'edge://favorites/');
 assert.equal(b.local.data.lastSyncReceipt.sha256,a.local.data.lastSyncReceipt.sha256);
 await b.call('syncAction',{type:'SYNC_NOW'});assert.equal(b.local.data.lastSyncReceipt.uploaded,false);
 const [n]=await b.api.children('1');await b.api.update(n.id,{url:'https://changed.test'});
 await b.call('syncAction',{type:'SYNC_NOW'});assert.equal(b.local.data.lastSyncReceipt.uploaded,true);
});

test('「这台只接收不上传」：本机改动不会传上去，反而被云端盖掉',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);
 await a.api.seed([link('x','X','https://x.test')]);await b.api.seed([link('x','X','https://x.test')]);
 let p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 p=await b.call('syncAction',{type:'SYNC_PREVIEW'});await b.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 // b 勾上「只接收」，然后各自改各自的
 b.local.data.syncFollowOnly=true;
 await a.api.create({parentId:'1',title:'A 新加的',url:'https://a.test'});
 await b.api.create({parentId:'1',title:'B 新加的',url:'https://b.test'});
 p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 const puts=()=>server.requests.filter(r=>r.method==='PUT'&&r.url.endsWith('/sync/state.json')).length;
 const before=puts();
 p=await b.call('syncAction',{type:'SYNC_PREVIEW'});
 assert.equal(p.followOnly,true);
 assert.equal(p.cloudChanges.length,0,'只接收的那台不该有任何要写上去的东西');
 await b.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 assert.equal(puts(),before,'🔴 只接收的那台一次云端写入都不能发');
 const titles=(await b.api.children('1')).map(n=>n.title).sort().join('|');
 assert.equal(titles,'A 新加的|X','它本机那条被云端盖掉了，这正是「只接收」的意思');
 assert.equal(b.local.data.lastSyncReceipt.followOnly,true);
 // 关掉开关之后要能恢复正常上传
 b.local.data.syncFollowOnly=false;
 await b.api.create({parentId:'1',title:'B 再加',url:'https://b2.test'});
 p=await b.call('syncAction',{type:'SYNC_PREVIEW'});
 assert.ok(!p.followOnly,'关掉开关之后不该再是只接收');
 await b.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 assert.equal(puts(),before+1,'关掉之后又能正常上传');
});

test('整理标准进完整备份、但不进同步内容（钥匙两样都不进）',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);
 await a.api.seed([link('x','X','https://x.test')]);await b.api.seed([link('x','X','https://x.test')]);
 a.local.data.aiStandard='标签只用已经定义好的那几个';
 a.local.data.aiTasks=[{id:'t9',name:'查重复',prompt:'找出收了多份的'}];
 a.local.data.ai={key:'sk-绝不能外泄',provider:'kimicode',model:'k3'};
 // ① 完整备份带上标准和任务，🔴 但一个字的钥匙都不许有
 const snap=await a.call('backupAction',{type:'BACKUP_CREATE',reason:'测试'});
 const got=await a.call('backupAction',{type:'BACKUP_GET',id:snap.id||(await a.call('backupAction',{type:'BACKUP_STATUS'})).backups[0].id});
 assert.equal(got.prefs.aiStandard,'标签只用已经定义好的那几个','整理标准要跟着备份走，否则换台机器就没了');
 assert.equal(got.prefs.aiTasks[0].name,'查重复');
 assert.ok(!JSON.stringify(got).includes('sk-绝不能外泄'),'🔴 钥匙绝不能进备份文件');
 // ② 同步内容里两样都没有 —— 标准是本机的事，不该传给别的设备，也不该跟别人的打架
 let p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 const cloud=JSON.parse([...server.files.entries()].find(([k])=>k.endsWith('/sync/state.json'))[1].body);
 assert.deepEqual(cloud.snapshot.prefs,{},'同步内容里的 prefs 必须是空的');
 assert.ok(!JSON.stringify(cloud).includes('标签只用已经定义好的'),'整理标准不该上云端');
 assert.ok(!JSON.stringify(cloud).includes('sk-绝不能外泄'),'🔴 钥匙绝不能上云端');
 // ③ 另一台同步下来，它自己的标准不受影响
 b.local.data.aiStandard='我这台的标准';
 p=await b.call('syncAction',{type:'SYNC_PREVIEW'});await b.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 assert.equal(b.local.data.aiStandard,'我这台的标准','同步不该动别人的整理标准');
});

test('🔴 删过的东西再加回来，自动同步不许再把它删掉（墓碑触发的冲突默认保留本机）',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);
 await a.api.seed([link('x','X','https://x.test'),link('k','Keep','https://keep.test')]);
 let p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 p=await b.call('syncAction',{type:'SYNC_PREVIEW'});await b.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 // a 删掉 X 并同步出去 ⇒ a 有了 X 的新鲜墓碑；b 也跟着删
 const xa=(await a.api.children('1')).find(n=>n.url==='https://x.test');await a.api.remove(xa.id);
 await a.call('syncAction',{type:'SYNC_NOW'});await b.call('syncAction',{type:'SYNC_NOW'});
 assert.equal((await b.api.children('1')).length,1,'b 也删了');
 assert.ok(a.local.data.syncTombstones.some(t=>t.url==='https://x.test'),'a 记了墓碑');
 // a 后悔了，把同名同网址的 X 加回来（＝从备份恢复 / 重新收藏），走自动同步
 const back=await a.api.create({parentId:'1',title:'X',url:'https://x.test'});
 a.local.data.intentionalCreates=[{id:String(back.id),at:Date.now()}];   // 测试直接调 api，绕过了 store.js 的标记，这里补上
 await a.call('syncAction',{type:'SYNC_NOW'});
 assert.ok((await a.api.children('1')).some(n=>n.url==='https://x.test'),'🔴 自动同步不能把刚加回来的 X 再删掉');
 assert.equal(a.local.data.lastSyncReceipt.uploaded,true,'而且要把它传上去');
 await b.call('syncAction',{type:'SYNC_NOW'});
 assert.ok((await b.api.children('1')).some(n=>n.url==='https://x.test'),'另一台同步后也要有');
});
test('真正的内容冲突（两边改了同一条）自动同步照旧保留云端，不受上一条影响',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);
 await a.api.seed([link('x','X','https://x.test')]);
 let p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 p=await b.call('syncAction',{type:'SYNC_PREVIEW'});await b.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 const xa=(await a.api.children('1'))[0],xb=(await b.api.children('1'))[0];
 await b.api.update(xb.id,{title:'云端改的'});await b.call('syncAction',{type:'SYNC_NOW'});
 await a.api.update(xa.id,{title:'本机改的'});await a.call('syncAction',{type:'SYNC_NOW'});
 assert.equal((await a.api.children('1'))[0].title,'云端改的','自动同步时内容冲突仍以云端为准');
});

test('外面来的重新出现：墓碑还新鲜 ⇒ 当回声跟着删；墓碑超过十分钟 ⇒ 当重新收藏保留',async()=>{
 const server=davServer(),a=await syncedWorker(server),b=await syncedWorker(server);
 await a.api.seed([link('x','X','https://x.test'),link('k','Keep','https://keep.test')]);
 let p=await a.call('syncAction',{type:'SYNC_PREVIEW'});await a.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 p=await b.call('syncAction',{type:'SYNC_PREVIEW'});await b.call('syncAction',{type:'SYNC_APPLY',token:p.token});
 const xa=(await a.api.children('1')).find(n=>n.url==='https://x.test');await a.api.remove(xa.id);
 await a.call('syncAction',{type:'SYNC_NOW'});await b.call('syncAction',{type:'SYNC_NOW'});
 // 外面（账号同步）刚塞回来，没有「有意」标记，墓碑几秒钟前的 ⇒ 回声，删
 await a.api.create({parentId:'1',title:'X',url:'https://x.test'});a.local.data.intentionalCreates=[];
 await a.call('syncAction',{type:'SYNC_NOW'});
 assert.ok(!(await a.api.children('1')).some(n=>n.url==='https://x.test'),'新鲜墓碑＋非我们所建 ⇒ 当回声删掉');
 // 把墓碑时间戳拨到 11 分钟前 ⇒ 再出现就当重新收藏
 for(const t of a.local.data.syncTombstones)t.at=new Date(Date.now()-11*60e3).toISOString();
 await a.api.create({parentId:'1',title:'X',url:'https://x.test'});a.local.data.intentionalCreates=[];
 await a.call('syncAction',{type:'SYNC_NOW'});
 assert.ok((await a.api.children('1')).some(n=>n.url==='https://x.test'),'墓碑老了 ⇒ 保留');
});
