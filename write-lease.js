// 写入协调：同一时刻只让一方改书签树。
// 为什么需要：AI 执行、持续同步、恢复三者都会写书签，而 chrome.bookmarks 的事件不带「谁写的」，
// 同步侧的守卫只能把别人写的一律当成外来改动而中止 —— 两边互相打断，书签停在半新半旧。
// 🚫 不采用「持锁期间丢弃全部书签事件」：那会连你自己的手工操作、浏览器账号同步送来的变化一起漏掉。
//    这里只做「不让两者同时跑」，事件该怎么看还怎么看。
// 🔴 租约必须带期限：只有布尔标志的锁，任何一条清除路径写漏一次就永久卡死；带期限最多卡到期。
(function (root) {
  const KEY = 'writeLease';
  const MAX_MS = 5 * 60e3;          // 单批最长 5 分钟，与 service worker 的单次调用上限同量级
  const alive = (l) => !!l && typeof l.until === 'number' && l.until > Date.now();

  async function read() {
    const { [KEY]: lease } = await chrome.storage.local.get(KEY);
    return alive(lease) ? lease : null;
  }
  // 返回 {ok:true,lease} 或 {ok:false,owner,until}
  async function acquire(owner, ms = MAX_MS) {
    const cur = await read();
    if (cur && cur.owner !== owner) return { ok: false, owner: cur.owner, until: cur.until };
    const lease = { owner, id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
                    until: Date.now() + Math.min(ms, MAX_MS), at: new Date().toISOString() };
    await chrome.storage.local.set({ [KEY]: lease });
    return { ok: true, lease };
  }
  async function renew(id, ms = MAX_MS) {
    const cur = await read();
    if (!cur || cur.id !== id) return false;
    await chrome.storage.local.set({ [KEY]: { ...cur, until: Date.now() + Math.min(ms, MAX_MS) } });
    return true;
  }
  // 🔴 只有持有者能释放：避免把别人刚拿到的租约误清
  async function release(id) {
    const cur = await read();
    if (cur && id && cur.id !== id) return false;
    await chrome.storage.local.remove(KEY);
    return true;
  }
  // 给同步侧用：别人正持有就别开始
  async function heldByOther(owner) {
    const cur = await read();
    return cur && cur.owner !== owner ? cur : null;
  }
  const NAME = { ai: 'AI 整理', sync: '同步', restore: '恢复' };

  root.WriteLease = { acquire, renew, release, read, heldByOther, NAME, MAX_MS };
  if (typeof module !== 'undefined') module.exports = root.WriteLease;
})(globalThis);
