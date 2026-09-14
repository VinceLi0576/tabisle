// 各家 AI 接口的配置。首页、侧栏、设置页共用这一份，🚫 别各抄一份（抄出来必然漂移）。
//
// 🔴 端点是 260914 逐个实测过的：不带钥匙发一次请求，返回 401（地址对、只是没授权）才收进来。
//    返回 404 或域名不通的一律没收。复验命令见 dev/probe-api.py。
// 🔴 「免费」只标官方长期免费的那一档，🚫 不写额度数字和单价 —— 那种东西写下来第二天就在骗人，
//    而且不报错。每家都带一个「去哪查价」的链接，要数字点过去看。
(function (root) {
  const P = {
    kimicode: {
      name: 'Kimi Code 会员', base: 'https://api.kimi.com/coding/v1',
      apply: 'https://www.kimi.com/code', pricing: 'https://www.kimi.com/code',
      note: '走 Kimi Code 会员额度，不另计费。⚠️ 官方文档写它是给编程工具用的，在这里用属于灰色地带，额度异常时优先换回开放平台。',
      models: [['k3', 'k3 · 最强（Moderato 及以上会员）'], ['k3-256k', 'k3-256k · 同上，256K 上下文'], ['kimi-for-coding', 'kimi-for-coding · 所有会员可用']],
    },
    moonshot: {
      name: 'Moonshot 开放平台（Kimi）', base: 'https://api.moonshot.cn/v1',
      apply: 'https://platform.moonshot.cn/console/api-keys', pricing: 'https://platform.moonshot.cn/docs/pricing',
      note: '按量付费。整理书签这种活 kimi-k2.6 就够，难活再换 k3。',
      models: [['kimi-k2.6', 'kimi-k2.6 · 便宜够用'], ['kimi-k3', 'kimi-k3 · 最强，贵约 4 倍']],
    },
    deepseek: {
      name: 'DeepSeek', base: 'https://api.deepseek.com/v1',
      apply: 'https://platform.deepseek.com/api_keys', pricing: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
      note: '按量付费，单价在国内属于很低的一档。reasoner 是带思考的版本，不吃温度设置。',
      models: [['deepseek-chat', 'deepseek-chat · 日常整理用这个'], ['deepseek-reasoner', 'deepseek-reasoner · 会思考，慢且贵']],
    },
    zhipu: {
      name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4',
      apply: 'https://open.bigmodel.cn/usercenter/apikeys', pricing: 'https://open.bigmodel.cn/pricing',
      note: 'flash 那一档官方标长期免费，拿来整理书签完全够。⚠️ glm-4.5-flash 已下线，会自动转到 4.7。',
      models: [['glm-4.7-flash', 'glm-4.7-flash · 免费', 1], ['glm-4-flash-250414', 'glm-4-flash · 免费，老一点', 1], ['glm-4.7', 'glm-4.7 · 付费旗舰']],
    },
    siliconflow: {
      name: '硅基流动', base: 'https://api.siliconflow.cn/v1',
      apply: 'https://cloud.siliconflow.cn/account/ak', pricing: 'https://siliconflow.cn/pricing',
      note: '一个平台上挂着一堆开源模型。9B 及以下那一档官方标免费，注册另送一笔额度。',
      models: [['Qwen/Qwen3-8B', 'Qwen3-8B · 免费档', 1], ['THUDM/GLM-4-9B-0414', 'GLM-4-9B · 免费档', 1], ['deepseek-ai/DeepSeek-V3', 'DeepSeek-V3 · 付费']],
    },
    dashscope: {
      name: '阿里百炼（通义千问）', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apply: 'https://bailian.console.aliyun.com/?tab=model#/api-key', pricing: 'https://help.aliyun.com/zh/model-studio/models',
      note: '新用户有一笔赠送额度，用完转按量付费。turbo 那一档最便宜。',
      models: [['qwen-turbo', 'qwen-turbo · 最便宜'], ['qwen-plus', 'qwen-plus · 均衡'], ['qwen-max', 'qwen-max · 最强']],
    },
    ark: {
      name: '火山方舟（豆包）', base: 'https://ark.cn-beijing.volces.com/api/v3',
      apply: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey', pricing: 'https://www.volcengine.com/docs/82379/1099320',
      note: '⚠️ 这家的「模型」要填你自己在控制台开的推理接入点 ID（ep- 开头），不是模型名。',
      models: [['doubao-pro-32k', 'doubao-pro-32k'], ['doubao-lite-32k', 'doubao-lite-32k · 便宜']],
    },
    hunyuan: {
      name: '腾讯混元', base: 'https://api.hunyuan.cloud.tencent.com/v1',
      apply: 'https://console.cloud.tencent.com/hunyuan/api-key', pricing: 'https://cloud.tencent.com/document/product/1729/97731',
      note: 'lite 那一档官方标免费。',
      models: [['hunyuan-lite', 'hunyuan-lite · 免费档', 1], ['hunyuan-turbos-latest', 'hunyuan-turbos · 付费']],
    },
    openrouter: {
      name: 'OpenRouter（转发国外各家）', base: 'https://openrouter.ai/api/v1',
      apply: 'https://openrouter.ai/keys', pricing: 'https://openrouter.ai/models?order=pricing-low-to-high',
      note: '一把钥匙调国外几百个模型。名字带 :free 的那些不收钱（260914 实测：445 个模型里有 19 个）。🔴 国内直连不通，要走代理。',
      models: [['deepseek/deepseek-chat', 'deepseek-chat · 便宜'], ['anthropic/claude-3.5-haiku', 'claude-3.5-haiku'], ['google/gemini-flash-1.5', 'gemini-flash · 便宜']],
      freeHint: '要用免费的：去上面「查价格」页按价格从低到高排，把带 :free 的模型 id 填进下面的模型名框。',
    },
    qianfan: {
      name: '百度千帆', base: 'https://qianfan.baidubce.com/v2',
      apply: 'https://console.bce.baidu.com/iam/#/iam/apikey/list', pricing: 'https://cloud.baidu.com/doc/qianfan-docs/s/hlrk4akp7',
      note: '钥匙用千帆的 API Key（不是老的 AK/SK）。',
      models: [['ernie-4.5-turbo-128k', 'ernie-4.5-turbo'], ['ernie-speed-128k', 'ernie-speed · 便宜']],
    },
    spark: {
      name: '讯飞星火', base: 'https://spark-api-open.xf-yun.com/v1',
      apply: 'https://console.xfyun.cn/services/bmx1', pricing: 'https://xinghuo.xfyun.cn/sparkapi',
      note: 'lite 那一档官方标免费。钥匙格式是「APIKey:APISecret」拼起来的那一串。',
      models: [['lite', 'lite · 免费档', 1], ['generalv3.5', 'generalv3.5 · 付费']],
    },
    custom: {
      name: '自定义（任何 OpenAI 兼容接口）', base: '',
      apply: '', pricing: '',
      note: '自己填接口地址和模型名。本地跑的 Ollama 填 http://localhost:11434/v1，钥匙随便填一个字。上面没列到的、或者列表过期了，都走这条。',
      models: [], custom: true,
    },
  };
  // k3 和 reasoner 这类会思考的模型不吃温度设置，干脆不送这个参数
  const noTemperature = (m) => /(^|[-/])k3\b|kimi-k3|reasoner|-thinking|o[1-4](-|$)/i.test(String(m || ''));
  const freeModels = (id) => (P[id]?.models || []).filter((m) => m[2]).map((m) => m[0]);
  root.AiProviders = { P, noTemperature, freeModels, DEFAULT_ID: 'kimicode' };
  if (typeof module !== 'undefined') module.exports = root.AiProviders;
})(globalThis);
