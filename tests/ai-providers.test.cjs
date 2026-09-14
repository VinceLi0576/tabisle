// 接口表：形状对不对、有没有抄重复、温度判断准不准
// 🔴 端点本身是 260914 实测的（dev/probe-api.py，不带钥匙发请求、返回 401 才收进来），
//    这里只能验格式 —— 地址通不通得真发请求，那是脚本的活。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const AP = require(path.join(__dirname, '../ai-providers.js'));

test('每一家都有名字、拿钥匙的地方、说明；除自定义外都有接口地址', () => {
  for (const [id, p] of Object.entries(AP.P)) {
    assert.ok(p.name, id + ' 缺名字');
    assert.ok(p.note, id + ' 缺说明');
    if (p.custom) { assert.equal(p.base, '', '自定义那项的地址要留空给用户填'); continue; }
    assert.match(p.base, /^https:\/\/.+/, id + ' 的接口地址要是 https');
    assert.ok(!p.base.endsWith('/'), id + ' 的接口地址不该带结尾斜杠，拼路径会出双斜杠');
    assert.ok(p.apply && p.pricing, id + ' 要给「去拿钥匙」和「查价格」两个链接');
    assert.ok(p.models.length, id + ' 至少要有一个模型');
  }
});

test('🔴 价格数字一律不写进表里——写下来第二天就在骗人，而且不报错', () => {
  const blob = JSON.stringify(AP.P);
  assert.doesNotMatch(blob, /每百万|\/M token|元\s*\/|¥\d|\$\d/, '表里出现了单价，应该只留「查价格」链接');
});

test('模型 id 不许跨家重复，否则下拉框选了等于没选', () => {
  for (const [id, p] of Object.entries(AP.P)) {
    const ids = p.models.map((m) => m[0]);
    assert.equal(new Set(ids).size, ids.length, id + ' 里有重复的模型 id');
  }
});

test('标了免费的模型能被挑出来，没标的不会混进去', () => {
  assert.deepEqual(AP.freeModels('zhipu'), ['glm-4.7-flash', 'glm-4-flash-250414']);
  assert.deepEqual(AP.freeModels('hunyuan'), ['hunyuan-lite']);
  assert.deepEqual(AP.freeModels('deepseek'), [], 'DeepSeek 没有免费档，别标');
  assert.deepEqual(AP.freeModels('没这家'), []);
});

test('会思考的模型不送温度参数，普通的要送', () => {
  for (const m of ['k3', 'k3-256k', 'kimi-k3', 'deepseek-reasoner', 'glm-4.7-thinking', 'o1', 'o3-mini'])
    assert.equal(AP.noTemperature(m), true, m + ' 应该不送温度');
  for (const m of ['kimi-k2.6', 'deepseek-chat', 'glm-4.7-flash', 'qwen-turbo', 'hunyuan-lite', 'Qwen/Qwen3-8B', ''])
    assert.equal(AP.noTemperature(m), false, m + ' 应该照常送温度');
});

test('默认那家真的在表里', () => {
  assert.ok(AP.P[AP.DEFAULT_ID], '默认接口不在表里，页面一开就是空的');
});
