// 回归：附属数据合并时漏掉 meta.locks，每同步一次锁定就全没了（260913 实撞）
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
require(path.join(__dirname,'../bookmark-core.js'));
const SC=require(path.join(__dirname,'../sync-core.js'));
const BK=globalThis.BookmarkCore;

const snap=(children,meta)=>({format:'newtab-bookmarks',version:1,id:'s'+Math.random(),
  createdAt:new Date().toISOString(),reason:'测试',children,
  meta:{items:{},groups:{},tags:[],...meta},prefs:{},folderState:{}});
const 夹=(uid,title,kids=[])=>({uid,title,children:kids});

test('两端合并后，锁定必须还在（旧实现会把它整个丢掉）',()=>{
  const tree=[夹('u1','工具'),夹('u2','私密')];
  const base=snap(tree,{locks:{u2:true}});
  const local=snap(tree,{locks:{u2:true}});
  const remote=snap(tree,{locks:{u2:true}});
  const {snapshot}=SC.merge(base,local,remote);
  assert.deepEqual(snapshot.meta.locks,{u2:true},'同步一轮后锁不该消失');
});

test('一端新加的锁会合并过来',()=>{
  const tree=[夹('u1','工具'),夹('u2','私密')];
  const base=snap(tree,{locks:{}});
  const local=snap(tree,{locks:{u1:true}});
  const remote=snap(tree,{locks:{u2:true}});
  const {snapshot}=SC.merge(base,local,remote);
  assert.deepEqual(snapshot.meta.locks,{u1:true,u2:true},'两端各自加的锁都要留下');
});

test('一端解锁会传播过去，不会被另一端的旧值顶回来',()=>{
  const tree=[夹('u1','工具')];
  const base=snap(tree,{locks:{u1:true}});
  const local=snap(tree,{locks:{}});          // 本机解了锁
  const remote=snap(tree,{locks:{u1:true}});  // 云端还是旧的
  const {snapshot}=SC.merge(base,local,remote);
  assert.equal(snapshot.meta.locks.u1,undefined,'解锁要传播');
});

test('没有 locks 字段的旧数据也能合并，不报错',()=>{
  const tree=[夹('u1','工具')];
  const {snapshot}=SC.merge(snap(tree),snap(tree),snap(tree));
  assert.deepEqual(snapshot.meta.locks,{});
});

test('校验接受 locks，拒绝写成数组',()=>{
  const tree=[夹('u1','工具')];
  assert.doesNotThrow(()=>BK.validate(snap(tree,{locks:{u1:true}})));
  assert.doesNotThrow(()=>BK.validate(snap(tree)));
  assert.throws(()=>BK.validate(snap(tree,{locks:['u1']})),/锁定数据结构不正确/);
});
