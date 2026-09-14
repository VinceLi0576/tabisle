#!/usr/bin/env python3
# 验各家 OpenAI 兼容端点是不是真的存在：不带 key 发一次请求
# 401/403 ＝ 端点在、只是没授权（说明地址写对了）；404/DNS 失败 ＝ 地址是错的
import json, urllib.request, urllib.error, socket, concurrent.futures as cf
CANDIDATES = [
    ("Moonshot 开放平台", "https://api.moonshot.cn/v1/chat/completions"),
    ("Kimi Code 会员",   "https://api.kimi.com/coding/v1/chat/completions"),
    ("DeepSeek",         "https://api.deepseek.com/v1/chat/completions"),
    ("智谱 GLM",         "https://open.bigmodel.cn/api/paas/v4/chat/completions"),
    ("阿里百炼(通义)",    "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"),
    ("火山方舟(豆包)",    "https://ark.cn-beijing.volces.com/api/v3/chat/completions"),
    ("硅基流动",         "https://api.siliconflow.cn/v1/chat/completions"),
    ("OpenRouter",       "https://openrouter.ai/api/v1/chat/completions"),
    ("百度千帆",         "https://qianfan.baidubce.com/v2/chat/completions"),
    ("讯飞星火",         "https://spark-api-open.xf-yun.com/v1/chat/completions"),
    ("腾讯混元",         "https://api.hunyuan.cloud.tencent.com/v1/chat/completions"),
    ("MiniMax",          "https://api.minimax.chat/v1/text/chatcompletion_v2"),
    ("零一万物",         "https://api.lingyiwanwu.com/v1/chat/completions"),
    ("Groq",             "https://api.groq.com/openai/v1/chat/completions"),
    ("Ollama 本地",      "http://127.0.0.1:11434/v1/chat/completions"),
]
def probe(item):
    name, url = item
    body = json.dumps({"model": "x", "messages": [{"role": "user", "content": "hi"}]}).encode()
    req = urllib.request.Request(url, data=body, method="POST",
                                 headers={"Content-Type": "application/json", "Authorization": "Bearer probe-no-key"})
    try:
        r = urllib.request.urlopen(req, timeout=15)
        return name, url, r.status, (r.read()[:160]).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return name, url, e.code, (e.read()[:200]).decode("utf-8", "replace")
    except Exception as e:
        return name, url, "网络不通", f"{type(e).__name__}: {e}"
with cf.ThreadPoolExecutor(max_workers=8) as ex:
    for name, url, code, note in ex.map(probe, CANDIDATES):
        verdict = "✅端点在" if code in (401, 403, 400, 422) else ("⚠️" + str(code))
        print(f"{verdict:>10}  {name:<16} {code:<10} {note[:120].replace(chr(10),' ')}")
