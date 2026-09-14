// 写入协调：同一时刻只让一方改书签，租约必须带期限（260913）
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../write-lease.js'),'utf8');

function load(){
  const store={};
  const ctx={crypto:{randomUUID:()=>'u'+Math.random().toString(36).slice(2)},
    chrome:{storage:{local:{
      get:async(k)=>({[k]:store[k]}),
      set:async(o)=>Object.assign(store,o),
      remove:async(k)=>{delete store[k];},
    }}}};
  ctx.globalThis=ctx; vm.runInNewContext(src,ctx);
  return {L:ctx.WriteLease,store};
}

test('先来的拿到，后来的被拒并说明是谁占着',async()=>{
  const {L}=load();
  const a=await L.acquire('sync');
  assert.equal(a.ok,true);
  const b=await L.acquire('ai');
  assert.equal(b.ok,false);
  assert.equal(b.owner,'sync');
  assert.ok(await L.heldByOther('ai'));
  assert.equal(await L.heldByOther('sync'),null,'自己不算被别人占');
});

test('释放之后别人才能拿到',async()=>{
  const {L}=load();
  const a=await L.acquire('ai');
  assert.equal((await L.acquire('sync')).ok,false);
  await L.release(a.lease.id);
  assert.equal((await L.acquire('sync')).ok,true);
});

test('🔴 只有持有者能释放：不许把别人刚拿到的租约清掉',async()=>{
  const {L}=load();
  const a=await L.acquire('ai');
  assert.equal(await L.release('别的id'),false);
  assert.ok(await L.read(),'租约不该被别人清掉');
  assert.equal(await L.release(a.lease.id),true);
  assert.equal(await L.read(),null);
});

test('🔴 租约必须带期限：过期后自动让位，不会永久卡死',async()=>{
  const {L,store}=load();
  await L.acquire('ai');
  assert.equal((await L.acquire('sync')).ok,false);
  store.writeLease.until=Date.now()-1;          // 让它过期
  assert.equal(await L.read(),null,'过期的租约不该还算数');
  assert.equal((await L.acquire('sync')).ok,true,'过期后别人要能接手');
});

test('期限有上限，传再大也封顶',async()=>{
  const {L}=load();
  const a=await L.acquire('ai',999*60e3);
  assert.ok(a.lease.until-Date.now()<=L.MAX_MS+50);
});

test('同一方可以续期，别人不能',async()=>{
  const {L}=load();
  const a=await L.acquire('ai');
  const first=a.lease.until;
  await new Promise(r=>setTimeout(r,5));
  assert.equal(await L.renew(a.lease.id),true);
  assert.ok((await L.read()).until>=first);
  assert.equal(await L.renew('别的id'),false);
});
