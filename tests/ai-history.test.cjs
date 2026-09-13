// 回归：AI 会话按条数裁剪会切断 tool_calls / role:'tool' 配对，下一轮请求 400（260913）
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {trimHistory,pairingOk}=require('../ai-core.js');

const turn=(i,tools)=>{
  const out=[{role:'user',content:'问'+i}];
  if(tools){
    const calls=Array.from({length:tools},(_,k)=>({id:`c${i}_${k}`,function:{name:'get_folder',arguments:'{}'}}));
    out.push({role:'assistant',content:'',reasoning_content:'想'+i,tool_calls:calls});
    for(const c of calls)out.push({role:'tool',tool_call_id:c.id,name:'get_folder',content:'{}'});
  }
  out.push({role:'assistant',content:'答'+i});
  return out;
};

test('裁剪后每个 role:tool 都还能找到它的 assistant（200 轮随机）',()=>{
  for(let round=0;round<200;round++){
    const list=[];
    const turns=2+Math.floor(Math.random()*20);
    for(let i=0;i<turns;i++)list.push(...turn(i,Math.random()<0.5?1+Math.floor(Math.random()*3):0));
    const out=trimHistory(list,1+Math.floor(Math.random()*8));
    assert.ok(pairingOk(out),`第 ${round} 轮：裁剪把 tool 配对切断了`);
    assert.ok(out.length===0||out[0].role==='user',`第 ${round} 轮：首条不是 user，切点落在回合中间`);
  }
});

test('原来的 slice(-30) 确实会切断配对（证明这条测试抓得住病）',()=>{
  // 每个回合 4 条（user / assistant(1 个 tool_call) / tool / assistant），10 个回合共 40 条。
  // slice(-30) 从下标 10 开始，而 10 正是某回合的 role:'tool'，它的 assistant 在下标 9 被切掉了。
  const list=[];
  for(let i=0;i<10;i++)list.push(...turn(i,1));
  assert.equal(list.length,40);
  assert.equal(list[10].role,'tool');
  assert.equal(pairingOk(list),true);
  assert.equal(pairingOk(list.slice(-30)),false);   // 旧写法：切点落在回合中间就断
  assert.equal(pairingOk(trimHistory(list,8)),true); // 新写法：永远从 user 开头
});

test('不足 keepTurns 时原样返回，且 reasoning_content 跟着它那条 assistant 一起留',()=>{
  const list=[...turn(0,1),...turn(1,1)];
  const out=trimHistory(list,8);
  assert.deepEqual(out,list);
  const last=trimHistory([...turn(0,1),...turn(1,1),...turn(2,1)],1);
  assert.equal(last[0].role,'user');
  assert.equal(last.filter(m=>m.reasoning_content).length,1);
});

test('空输入与脏数据不炸',()=>{
  assert.deepEqual(trimHistory([]),[]);
  assert.deepEqual(trimHistory(null),[]);
  assert.equal(pairingOk([{role:'tool',tool_call_id:'x'}]),false);
});
