const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../backup-page.js'),'utf8');
const ids=['backup-mode','webdav-guide','backup-live','backup-history','continuous-sync','help-section'];
async function page(saved={},hash=''){
  const writes=[];
  function element(id){return {id,open:true,dataset:{},tagName:'DETAILS',listeners:{},addEventListener(k,f){this.listeners[k]=f;},querySelector(k){return this.children[k]??=(element('child'));},children:{},getBoundingClientRect(){return {top:200};},setAttribute(){},removeAttribute(){},scrollIntoView(){this.scrolled=true;}};}
  const sections=ids.map(element),links=ids.map(id=>Object.assign(element(id+'-link'),{hash:'#'+id}));
  const nodes=Object.fromEntries(sections.map(s=>[s.id,s]));
  const ctx={document:{querySelectorAll:q=>q.startsWith('details')?sections:links,getElementById:id=>nodes[id]??=element(id),documentElement:{scrollHeight:2000}},chrome:{storage:{local:{get:async()=>({backupPageLayoutV1:saved}),set:async v=>writes.push(JSON.parse(JSON.stringify(v)))}}},matchMedia:()=>({matches:false}),requestAnimationFrame:()=>1,addEventListener(){},innerHeight:800,scrollY:0,history:{replaceState(){}},location:{hash}};
  ctx.window=ctx;vm.runInNewContext(source,ctx);await new Promise(setImmediate);
  const data={webdav:{enabled:true},backupMode:'webdav',backupAuto:true,backupIntervalHours:1,backups:[]};
  const sync={initialized:true,auto:true};
  const render=(d=data,s=sync,l=null)=>ctx.BackupPage.render(d,s,l);
  return {sections,links,nodes,writes,render,data,sync};
}
test('saved collapsed sections remain collapsed after initial data and periodic refresh',async()=>{
 const p=await page(Object.fromEntries(ids.map(id=>[id,false])));p.render();p.render();assert.ok(p.sections.every(s=>!s.open));
});
test('new connected users see actionable sections; manual choice survives status refresh',async()=>{
 const p=await page();p.render(p.data,{initialized:false});assert.deepEqual(p.sections.filter(s=>s.open).map(s=>s.id),['backup-live','continuous-sync']);
 const s=p.nodes['backup-live'];s.querySelector('summary').listeners.click({preventDefault(){}});p.render(p.data,{initialized:false});assert.equal(s.open,false);assert.equal(p.writes.at(-1).backupPageLayoutV1['backup-live'],false);
});
test('directory navigation reveals collapsed section without changing saved preference',async()=>{
 const p=await page(Object.fromEntries(ids.map(id=>[id,false])));p.render();p.links[5].listeners.click({preventDefault(){}});assert.equal(p.nodes['help-section'].open,true);assert.equal(p.writes.length,0);p.render();assert.equal(p.nodes['help-section'].open,true);
});
test('deep link opens target after restoring saved collapsed layout',async()=>{
 const p=await page(Object.fromEntries(ids.map(id=>[id,false])),'#backup-history');p.render();assert.equal(p.nodes['backup-history'].open,true);assert.equal(p.nodes['backup-live'].open,false);
});
test('new errors reveal affected section once, then respect manual collapse',async()=>{
 const p=await page();const s=p.nodes['continuous-sync'];p.render(p.data,{...p.sync,error:'连接失败'});assert.equal(s.open,true);s.querySelector('summary').listeners.click({preventDefault(){}});p.render(p.data,{...p.sync,error:'连接失败'});assert.equal(s.open,false);
});
