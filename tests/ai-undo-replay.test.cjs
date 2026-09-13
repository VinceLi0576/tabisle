// 批量撤销重放：拿假书签树跑，确定性复现「先移动再删父夹」这种交叉依赖（260913）
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {replayUndo,flattenForRebuild,metaSnapshot}=require('../ai-core.js');

// ── 假数据层：一棵能增删改移的书签树 ──
function fakeTree(){
  let seq=100;
  const nodes=new Map();      // id -> {id,title,url,parentId}
  const kids=new Map();       // parentId -> [id]
  const meta=new Map(); const groups=new Map(); let tags=[];
  const add=(parentId,title,url,index)=>{
    const id=String(++seq); nodes.set(id,{id,title,url,parentId:parentId?String(parentId):null});
    const arr=kids.get(String(parentId))||[]; kids.set(String(parentId),arr);
    if(index==null||index>arr.length)arr.push(id); else arr.splice(index,0,id);
    kids.set(id,kids.get(id)||[]); return nodes.get(id);
  };
  const detach=(id)=>{const n=nodes.get(String(id));if(!n)return;const a=kids.get(String(n.parentId))||[];const i=a.indexOf(String(id));if(i>=0)a.splice(i,1);};
  const api={
    find:(id)=>{const n=nodes.get(String(id));if(!n)return null;return {...n,children:(kids.get(String(id))||[]).map(k=>nodes.get(k))};},
    children:(id)=>(kids.get(String(id))||[]).map(k=>({...nodes.get(k)})),
    create:({parentId,title,url,index})=>add(parentId,title,url,index),
    update:(id,patch)=>{Object.assign(nodes.get(String(id)),patch);},
    move:(id,{parentId,index})=>{const n=nodes.get(String(id));if(!n)throw new Error("Can't find bookmark for id.");
      detach(id);n.parentId=String(parentId);const a=kids.get(String(parentId))||[];kids.set(String(parentId),a);
      if(index==null||index>a.length)a.push(String(id));else a.splice(index,0,String(id));},
    remove:(id)=>{detach(id);nodes.delete(String(id));kids.delete(String(id));},
    removeTree:(id)=>{const walk=(x)=>{for(const k of [...(kids.get(String(x))||[])])walk(k);detach(x);nodes.delete(String(x));kids.delete(String(x));};walk(id);},
    setMeta:(url,snap)=>meta.set(url,{...snap}),
    removeTag:(id)=>{tags=tags.filter(t=>t.id!==id);},
    setGroup:(title,val)=>{if(val)groups.set(title,val);else groups.delete(title);},
  };
  const shape=(id)=>{const n=nodes.get(String(id));if(!n)return null;
    return {t:n.title,u:n.url||null,c:(kids.get(String(id))||[]).map(shape)};};
  return {api,add,shape,meta,groups,get tags(){return tags;},set tags(v){tags=v;},nodes};
}

test('先移动再删父夹：撤销后整棵树一字不差回到原样',async()=>{
  const T=fakeTree();
  const f=T.add(null,'测试夹'), 甲=T.add(f.id,'甲','https://a/1'), sub=T.add(f.id,'子夹'), 乙=T.add(sub.id,'乙','https://a/2');
  T.meta.set('https://a/1',{name:'原名',desc:'原说明',icon:'',tags:[]});
  const before=JSON.stringify(T.shape(f.id));
  const metaBefore=JSON.stringify(T.meta.get('https://a/1'));

  // 模拟 AI 执行这批：改名 → 改备注 → 移进子夹 → 新建丙 → 删子夹
  const journal=[];
  journal.push({kind:'update',id:甲.id,to:{title:'甲'},after:{title:'甲改过'}});
  T.api.update(甲.id,{title:'甲改过'});
  journal.push({kind:'meta',meta:[{url:'https://a/1',snap:metaSnapshot(T.meta.get('https://a/1'))}]});
  T.api.setMeta('https://a/1',{name:'新名',desc:'新说明',icon:'',tags:[]});
  journal.push({kind:'move',id:甲.id,to:{parentId:f.id,index:0}});
  T.api.move(甲.id,{parentId:sub.id,index:0});
  const 丙=T.api.create({parentId:f.id,title:'丙',url:'https://a/3'});
  journal.push({kind:'created',id:丙.id,meta:[{url:'https://a/3',snap:metaSnapshot(null)}]});
  // 🔴 删除快照必须在删之前、且在移动之后拍，才能把刚移进来的「甲」包进去
  journal.push({kind:'restore',parentId:f.id,index:1,plan:flattenForRebuild(deep(T,sub.id))});
  T.api.removeTree(sub.id);

  assert.equal(JSON.stringify(T.shape(f.id)),JSON.stringify({t:'测试夹',u:null,c:[{t:'丙',u:'https://a/3',c:[]}]}));

  const {ok,skipped}=await replayUndo(journal,T.api);
  assert.deepEqual(skipped,[],'不该有跳过：'+skipped.join('；'));
  assert.equal(ok,5);
  assert.equal(JSON.stringify(T.shape(f.id)),before,'树没回到原样');
  assert.equal(JSON.stringify(T.meta.get('https://a/1')),metaBefore,'备注没还原');
});

// 读整棵子树（模拟 readSubtree）
function deep(T,id){const n=T.api.find(id);const out={id:n.id,title:n.title,url:n.url,children:[]};
  if(n.url)return out;for(const k of T.api.children(id))out.children.push(deep(T,k.id));return out;}

test('这期间被用户改过的，跳过并说明，🚫 不硬盖',async()=>{
  const T=fakeTree();
  const f=T.add(null,'夹'), b=T.add(f.id,'旧名','https://a/1');
  const journal=[{kind:'update',id:b.id,to:{title:'旧名'},after:{title:'AI改的名'}}];
  T.api.update(b.id,{title:'AI改的名'});
  T.api.update(b.id,{title:'我自己又改了'});      // 用户插一脚
  const {ok,skipped}=await replayUndo(journal,T.api);
  assert.equal(ok,0);
  assert.match(skipped[0],/改名.*这期间被改过/);
  assert.equal(T.api.find(b.id).title,'我自己又改了','不许把用户的改动盖掉');
});

test('目标已经不在了：跳过并说明，不抛错',async()=>{
  const T=fakeTree();
  const f=T.add(null,'夹'), b=T.add(f.id,'甲','https://a/1');
  const journal=[{kind:'move',id:b.id,to:{parentId:f.id,index:0}},{kind:'created',id:'9999'}];
  T.api.remove(b.id);
  const {ok,skipped}=await replayUndo(journal,T.api);
  assert.equal(ok,0);
  assert.equal(skipped.length,2);
  assert.ok(skipped.every(s=>/已不存在|已不在/.test(s)),skipped.join('；'));
});

test('排序撤销：按记下的原顺序放回去',async()=>{
  const T=fakeTree();
  const f=T.add(null,'夹');
  const ids=['丙','甲','乙'].map(t=>T.add(f.id,t,'https://a/'+t).id);
  const journal=[{kind:'order',id:f.id,ids}];
  for(const t of ['甲','乙','丙']){const n=T.api.children(f.id).find(x=>x.title===t);T.api.move(n.id,{parentId:f.id,index:999});}
  assert.deepEqual(T.api.children(f.id).map(n=>n.title),['甲','乙','丙']);
  const {skipped}=await replayUndo(journal,T.api);
  assert.deepEqual(skipped,[]);
  assert.deepEqual(T.api.children(f.id).map(n=>n.title),['丙','甲','乙'],'没回到原顺序');
});

test('新增标签与夹颜色也能撤销',async()=>{
  const T=fakeTree(); T.tags=[{id:'t1',name:'旧'},{id:'t2',name:'AI加的'}];
  T.groups.set('工具',{color:'#111'});
  const journal=[{kind:'tagAdded',id:'t2'},{kind:'group',title:'工具',to:{color:'#000'}},{kind:'group',title:'新夹',to:null}];
  T.groups.set('新夹',{color:'#222'});
  const {skipped}=await replayUndo(journal,T.api);
  assert.deepEqual(skipped,[]);
  assert.deepEqual(T.tags.map(t=>t.id),['t1']);
  assert.deepEqual(T.groups.get('工具'),{color:'#000'});
  assert.equal(T.groups.has('新夹'),false,'原来没有的分组设置应被删掉');
});
