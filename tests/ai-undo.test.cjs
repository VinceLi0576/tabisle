// 批量撤销的纯逻辑：附属数据整条还原、子树重建顺序、逆序重放（260913）
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {metaSnapshot,flattenForRebuild,reverseOrder,META_KEYS}=require('../ai-core.js');

test('附属数据快照五个字段都在，旧的没有的给空值（否则新写的会残留）',()=>{
  assert.deepEqual(metaSnapshot({name:'甲',tags:['t1']}),{name:'甲',desc:'',note:'',icon:'',tags:['t1']});
  assert.deepEqual(metaSnapshot({}),{name:'',desc:'',note:'',icon:'',tags:[]});
  assert.deepEqual(metaSnapshot(undefined),{name:'',desc:'',note:'',icon:'',tags:[]});
  assert.deepEqual(META_KEYS,['name','desc','note','icon','tags']);
  // 🔴 撤销要靠这份快照把旧值写回去：漏一个字段，AI 写的那个值就永远留在那儿撤不掉
  assert.deepEqual(metaSnapshot({note:'详细说明'}),{name:'',desc:'',note:'详细说明',icon:'',tags:[]});
});

test('快照要脱开引用，之后改原对象不影响快照',()=>{
  const m={name:'甲',tags:['t1']};
  const snap=metaSnapshot(m);
  m.tags.push('t2'); m.name='乙';
  assert.deepEqual(snap.tags,['t1']); assert.equal(snap.name,'甲');
});

test('子树重建清单：父一定排在子前面，根的 parentKey 是 null',()=>{
  const tree={title:'工具',children:[
    {title:'AI',children:[{title:'K',url:'https://k.com/'}]},
    {title:'书签',url:'https://b.com/'}]};
  const plan=flattenForRebuild(tree);
  assert.equal(plan[0].parentKey,null);
  assert.equal(plan[0].title,'工具');
  for(const it of plan) if(it.parentKey!==null) assert.ok(it.parentKey<it.key,'父的下标必须小于子');
  assert.deepEqual(plan.map(x=>x.title),['工具','AI','K','书签']);
  assert.equal(plan.find(x=>x.title==='K').url,'https://k.com/');
  assert.equal(plan.find(x=>x.title==='AI').url,undefined);   // 文件夹没有 url
});

test('单条书签也能拍平',()=>{
  const plan=flattenForRebuild({title:'一条',url:'https://a.com/'});
  assert.equal(plan.length,1);
  assert.equal(plan[0].parentKey,null);
});

test('撤销必须倒着重放，且不改动原数组',()=>{
  const j=[{kind:'a'},{kind:'b'},{kind:'c'}];
  assert.deepEqual(reverseOrder(j).map(x=>x.kind),['c','b','a']);
  assert.deepEqual(j.map(x=>x.kind),['a','b','c']);
  assert.deepEqual(reverseOrder(null),[]);
});
