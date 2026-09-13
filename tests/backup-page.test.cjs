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
  const ctx={document:{querySelectorAll:q=>q.startsWith('details')?sections:links,getElementById:id=>nodes[id]??=element(id),documentElement:{scrollHeight:2000}},chrome:{storage:{local:{get:async()=>({backupPageLayoutV1:saved}),set:async v=>writes.push(JSON.parse(JSON.stringify(v)))}}},matchMedia:()=>({matches:false}),requestAnimationFrame:()=>1,setTimeout:()=>0,clearTimeout(){},addEventListener(){},innerHeight:800,scrollY:0,history:{replaceState(){}},location:{hash}};
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

// 目录高亮：曾经「滚到页底就无条件选最后一段」，点第 3 段会把高亮甩到第 6 段
async function tocPage({tops,scrollY=0,scrollHeight=2000,innerHeight=800}){
  const current=new Set(),timers=[];
  function element(id){return {id,open:true,dataset:{},tagName:'DETAILS',listeners:{},
    addEventListener(k,f){this.listeners[k]=f;},
    querySelector(k){return this.children[k]??=element(id+'-'+k);},children:{},
    getBoundingClientRect(){return {top:Object.prototype.hasOwnProperty.call(tops,this.id)?tops[this.id]:1000};},
    setAttribute(k){if(k==='aria-current')current.add(this.id);},
    removeAttribute(k){if(k==='aria-current')current.delete(this.id);},
    scrollIntoView(){},classList:{contains:()=>false}};}
  const sections=ids.map(element),links=ids.map(id=>Object.assign(element(id+'-link'),{hash:'#'+id}));
  const nodes=Object.fromEntries(sections.map(s=>[s.id,s]));
  const ctx={document:{querySelectorAll:q=>q.startsWith('details')?sections:links,
      getElementById:id=>nodes[id]??=element(id),documentElement:{scrollHeight}},
    chrome:{storage:{local:{get:async()=>({}),set:async()=>{}}}},
    matchMedia:()=>({matches:false}),requestAnimationFrame:f=>{f();return 1;},
    setTimeout:(f,ms)=>{timers.push(f);return timers.length;},clearTimeout(){},
    addEventListener(){},innerHeight,scrollY,history:{replaceState(){}},location:{hash:''}};
  ctx.window=ctx;vm.runInNewContext(source,ctx);await new Promise(setImmediate);
  return {links,nodes,current,timers,ctx};
}
test('clicking a middle section keeps the highlight there even when the page is scrolled to the bottom',async()=>{
  // 第 1、2、3 段已滚过判定线，4、5、6 在下方；同时 innerHeight+scrollY 正好等于 scrollHeight（到页底）
  const tops={'backup-mode':-900,'webdav-guide':-500,'backup-live':10,'backup-history':600,'continuous-sync':660,'help-section':720};
  const p=await tocPage({tops,scrollY:1200,scrollHeight:2000,innerHeight:800});
  p.links[2].listeners.click({preventDefault(){}});          // 点「3 备份状态」
  assert.equal(p.nodes['backup-live'].open,true);            // 段要展开
  assert.deepEqual([...p.current],['backup-live-link']);     // 高亮停在第 3 段
  for(const f of p.timers.splice(0))f();                     // 锁到期后交还滚动判定
  assert.deepEqual([...p.current],['backup-live-link']);     // 仍是第 3 段，🚫 不跳到最后一段
});
test('the last section can still win the highlight once its header passes the marker',async()=>{
  const tops={'backup-mode':-900,'webdav-guide':-800,'backup-live':-700,'backup-history':-600,'continuous-sync':-500,'help-section':20};
  const p=await tocPage({tops,scrollY:1200,scrollHeight:2000,innerHeight:800});
  p.ctx.addEventListener;                                    // 滚动监听是空桩，直接调一次目录点击以触发判定
  p.links[5].listeners.click({preventDefault(){}});
  for(const f of p.timers.splice(0))f();
  assert.deepEqual([...p.current],['help-section-link']);
});
