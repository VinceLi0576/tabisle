// 首页与侧栏共用的派生逻辑（260913）
const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../bm-core.js');

test('归一化网址：去锚点、去结尾斜杠 ⇒ 同一网址的多份收藏共用一份备注',()=>{
  assert.equal(C.key('https://a.com/x#frag'),'https://a.com/x');
  assert.equal(C.key('https://a.com/'),'https://a.com');
  assert.equal(C.key('https://a.com/x?q=1'),'https://a.com/x?q=1','query 不能去掉，那是不同页面');
  assert.equal(C.key('不是网址'),'不是网址');
});

test('域名拆分：认二级后缀',()=>{
  assert.deepEqual(C.domainParts('https://app.huoban.com/x'),{root:'huoban.com',pre:'app'});
  assert.deepEqual(C.domainParts('https://www.dywt.com.cn/'),{root:'dywt.com.cn',pre:''});
  assert.deepEqual(C.domainParts('https://192.168.1.2/'),{root:'192.168.1.2',pre:''});
});

test('附属数据：五个字段全空就把整条删掉，不留空壳',()=>{
  const m={items:{},groups:{},tags:[]};
  C.applyItemMeta(m,'https://a.com/','{}'&&{name:'甲'});
  assert.deepEqual(m.items['https://a.com'],{name:'甲'});
  C.applyItemMeta(m,'https://a.com/',{name:''});
  assert.equal('https://a.com' in m.items,false,'全空应删掉整条');
});

test('锁：认稳定身份，改名不影响；旧的按名锁仍然认',()=>{
  const meta={items:{},groups:{'私密':{locked:true}},tags:[],locks:{u9:true}};
  const uid={'10':'u9'};
  assert.equal(C.folderLocked(meta,uid,{id:'10',title:'随便改的名'}),true,'按身份锁，改名不影响');
  assert.equal(C.folderLocked(meta,{},{id:'11',title:'私密'}),true,'旧的按名锁要兼容');
  assert.equal(C.folderLocked(meta,{},{id:'12',title:'公开'}),false);
  assert.equal(C.folderLocked(meta,uid,{id:'10',title:'x',url:'https://a'}),false,'书签不是文件夹，不参与锁');
});

test('锁沿父链继承：祖先锁了，里面全锁',()=>{
  const bar={id:'0',children:[{id:'1',title:'私密',children:[{id:'2',title:'子',children:[{id:'3',title:'书签',url:'https://a'}]}]},{id:'4',title:'公开',children:[{id:'5',title:'b',url:'https://b'}]}]};
  const meta={items:{},groups:{},tags:[],locks:{u1:true}};
  const uid={'1':'u1'};
  assert.equal(C.lockedInTree(meta,uid,bar,'3'),true,'孙子也该锁着');
  assert.equal(C.lockedInTree(meta,uid,bar,'5'),false);
});

test('拍平与查找',()=>{
  const bar={id:'0',children:[{id:'1',title:'工具',children:[{id:'2',title:'甲',url:'https://a'}]},{id:'3',title:'乙',url:'https://b'}]};
  assert.deepEqual(C.flatten(bar).map(x=>x.path),['工具','']);
  assert.equal(C.countUrls(bar),2);
  assert.equal(C.findNode(bar,'2').title,'甲');
  assert.equal(C.findNode(bar,'不存在'),null);
  assert.deepEqual(C.flatten(null),[]);
});
