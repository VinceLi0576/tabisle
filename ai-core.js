// AI 会话的纯逻辑：可在浏览器外单测，不碰 DOM、不碰 chrome.*
(function(root){
  // 🔴 裁剪必须以「完整回合」为单位。
  //    按条数裸切（history.slice(-30)）会把「assistant 带 tool_calls」和配对的 role:'tool' 切成两半，
  //    下一次请求直接 400；k3 的 reasoning_content 也必须跟着它那条 assistant 一起留或一起丢。
  //    一个回合 = user → assistant(可带 tool_calls) → 若干 role:'tool' → assistant …，切点只能落在 role:'user' 之前。
  function trimHistory(list, keepTurns) {
    keepTurns = keepTurns || 8;
    if (!Array.isArray(list)) return [];
    const starts = [];
    for (let i = 0; i < list.length; i++) if (list[i] && list[i].role === 'user') starts.push(i);
    if (starts.length <= keepTurns) return list;
    return list.slice(starts[starts.length - keepTurns]);
  }

  // 不变量：发出去的消息里，每个 role:'tool' 都能找到声明过它 tool_call_id 的 assistant。
  function pairingOk(list) {
    const ids = new Set();
    for (const m of list || []) for (const c of (m && m.tool_calls) || []) ids.add(c.id);
    return (list || []).every((m) => !m || m.role !== 'tool' || ids.has(m.tool_call_id));
  }

  // 输入是不是「一批网址」：整段里每一行都得是 http(s) 网址才算，混了别的字就走对话
  function parseUrls(text) {
    const parts = String(text || '').split(/[\s\n]+/).filter(Boolean);
    if (!parts.length) return null;
    const urls = [];
    for (const p of parts) {
      let u; try { u = new URL(p); } catch { return null; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      urls.push(u.href);
    }
    return [...new Set(urls)];   // 同一句里重复粘的只入一次
  }

  // 先用域名当临时书签名，等 AI 补备注名；拿不到 AI 也能用
  function nameFromUrl(href) {
    try {
      const u = new URL(href);
      const host = u.hostname.replace(/^www\./, '');
      const seg = u.pathname.split('/').filter(Boolean).pop() || '';
      const tail = decodeURIComponent(seg).replace(/[-_+]/g, ' ').replace(/\.\w{1,5}$/, '').trim();
      return tail && tail.length <= 40 ? host + ' · ' + tail : host;
    } catch { return href; }
  }

  root.AiCore = { trimHistory, pairingOk, parseUrls, nameFromUrl };
  if (typeof module !== 'undefined') module.exports = root.AiCore;
})(globalThis);
