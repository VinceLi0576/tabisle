// 跟后台说话的唯一入口。
// 🔴 后台是 service worker：空闲约 30 秒就被浏览器停掉，也可能整个崩掉。
//    崩掉时 chrome.runtime.sendMessage 既不成功也不失败，就那么悬着——
//    任何把界面状态挂在它上面的写法，都会让界面永远停在「正在读取…」。
//    所以这里强制：每次调用都有超时、超时后重试一次、仍不行给出用户能照做的一句话。
(function (root) {
  const DEAD = /context invalidated|receiving end does not exist|could not establish connection|message port closed|no sw/i;
  const NO_PAGE = '页面与后台的连接已失效（多半是扩展刚更新过）。刷新本页即可，已保存的数据不受影响。';
  const NO_BG = '后台没有响应，这次操作没有执行。请打开扩展管理页，把「书签首页」停用再启用，然后重试。';

  function once(message, ms) {
    return Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise((_, rej) => setTimeout(() => rej(Object.assign(Error('timeout'), { timeout: true })), ms)),
    ]);
  }

  // retry 只对「超时」重试；🚫 对已经明确失败的不重试，避免把一次写操作做两遍
  async function askBg(message, { ms = 8000, retry = true } = {}) {
    try {
      return await once(message, ms);
    } catch (e) {
      if (DEAD.test(e.message || '')) throw Object.assign(Error(NO_PAGE), { reload: true });
      if (!e.timeout) throw e;
      if (!retry) throw Object.assign(Error(NO_BG), { background: true });
      try {
        return await once(message, ms);
      } catch (e2) {
        if (DEAD.test(e2.message || '')) throw Object.assign(Error(NO_PAGE), { reload: true });
        throw Object.assign(Error(NO_BG), { background: true });
      }
    }
  }

  // 常用包装：后台统一回 {ok,data,error}
  async function ask(type, extra = {}, opts) {
    const r = await askBg({ type, ...extra }, opts);
    if (!r?.ok) throw Error(r?.error || '后台没有返回结果');
    return r.data;
  }

  root.BG = { askBg, ask, NO_BG, NO_PAGE };
  if (typeof module !== 'undefined') module.exports = root.BG;
})(globalThis);
