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

  // 附属数据是「整条替换」语义：要还原成旧样子，四个字段都得显式给值，
  // 旧的没有的字段必须给空（setItemMeta 会把空值删掉），否则新写进去的会留下来。
  const META_KEYS = ['name', 'desc', 'note', 'icon', 'tags'];
  function metaSnapshot(m) {
    const out = {};
    for (const k of META_KEYS) out[k] = k === 'tags' ? [...((m && m.tags) || [])] : ((m && m[k]) || '');
    return out;
  }
  // 把一棵子树拍平成「先父后子」的重建清单，父的下标在前，保证重建时父先存在
  function flattenForRebuild(node) {
    const out = [];
    const walk = (n, parentKey) => {
      const key = out.length;
      out.push({ key, parentKey, id: n.id != null ? String(n.id) : undefined, title: n.title || '', url: n.url || undefined });
      for (const c of n.children || []) walk(c, key);
    };
    walk(node, null);
    return out;
  }
  // 撤销必须倒着放：正着放会让后面每一步依赖前一步改完的位置
  const reverseOrder = (journal) => [...(journal || [])].reverse();

  const UNDONAME = { update: '改名/改址', move: '移动', created: '新建', restore: '删除',
                     order: '排序', tagAdded: '新增标签', group: '夹颜色', meta: '备注', folderNote: '文件夹说明' };

  // 倒着重放逆操作。api 由调用方注入，便于在浏览器外用假数据层测。
  // 约定：每条逆操作之前先核对现状；对不上就跳过并记原因，🚫 不硬盖。
  async function replayUndo(journal, api) {
    const remap = new Map();
    const R = (id) => String(remap.get(String(id)) || id);
    let ok = 0; const skipped = [];
    const why = (e, msg) => skipped.push(`撤销「${UNDONAME[e.kind] || e.kind}」：${msg}`);
    for (const e of reverseOrder(journal)) {
      try {
        if (e.after) {
          const cur = await api.find(R(e.id));
          if (!cur) { why(e, '目标已不存在'); continue; }
          const changed = Object.entries(e.after).some(([k, v]) => String(cur[k] ?? '') !== String(v ?? ''));
          if (changed) { why(e, `「${cur.title || cur.url}」这期间被改过`); continue; }
        }
        switch (e.kind) {
          case 'update': await api.update(R(e.id), e.to); break;
          case 'move': {
            if (!(await api.find(R(e.id)))) { why(e, '目标已不存在'); continue; }
            await api.move(R(e.id), { ...e.to, parentId: R(e.to.parentId) });
            break;
          }
          case 'created': {
            const cur = await api.find(R(e.id));
            if (!cur) { why(e, '新建的那条已不在'); continue; }
            if (cur.url) await api.remove(R(e.id)); else await api.removeTree(R(e.id));
            break;
          }
          case 'restore': {
            const made = {};
            for (const it of e.plan) {
              const parentId = it.parentKey === null ? R(e.parentId) : made[it.parentKey];
              if (!parentId) throw new Error('父夹已不在');
              const props = { parentId: String(parentId), title: it.title };
              if (it.url) props.url = it.url;
              if (it.parentKey === null && e.index != null) props.index = e.index;
              const born = await api.create(props);
              made[it.key] = String(born.id);
              if (it.id) remap.set(String(it.id), String(born.id));   // 重建后是新 id，后面的逆操作要跟着换
            }
            break;
          }
          case 'order':
            for (const id of e.ids) { try { await api.move(R(id), { parentId: R(e.id), index: (await api.children(R(e.id))).length }); } catch {} }
            break;
          case 'tagAdded': await api.removeTag(e.id); break;
          case 'group': await api.setGroup(e.title, e.to); break;
          case 'folderNote': await api.setFolderNote(e.id, e.to); break;
          case 'meta': break;   // 统一在下面还原
        }
        for (const m of e.meta || []) await api.setMeta(m.url, m.snap);
        ok++;
      } catch (err) { why(e, String((err && err.message) || err)); }
    }
    return { ok, skipped };
  }

  root.AiCore = { trimHistory, pairingOk, parseUrls, nameFromUrl, metaSnapshot, flattenForRebuild, reverseOrder, replayUndo, META_KEYS, UNDONAME };
  if (typeof module !== 'undefined') module.exports = root.AiCore;
})(globalThis);
