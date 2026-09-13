// AI 助手：Kimi（Moonshot，OpenAI 同款接口＋工具调用）在右栏里直接操作书签与附属数据。
// 规矩：读的工具随叫随执行；一切「改」都先走 propose_changes 出预览，用户点「执行」才写。
// 钥匙只存本机 chrome.storage.local 的 ai 键，不进附属数据导出。
window.addEventListener('bm-ready', () => {
  const BM = window.BM;
  const $ = (s) => document.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = BM.esc;
  const PROVIDERS = {
    moonshot: { base: 'https://api.moonshot.cn/v1', models: [['kimi-k2.6', 'kimi-k2.6 · 便宜够用，整理几十条约几分钱'], ['kimi-k3', 'kimi-k3 · 最强，贵约 4 倍']], note: '按量付费；kimi-k2.6 日常整理够用，kimi-k3 给难活。' },
    kimicode: { base: 'https://api.kimi.com/coding/v1', models: [['k3', 'k3 · 最强（Moderato 及以上会员）'], ['k3-256k', 'k3-256k · 同上，256K 上下文'], ['kimi-for-coding', 'kimi-for-coding · 所有会员可用']], note: '走 Kimi Code 会员额度，不另计费。⚠️ 官方文档写它是给编程工具用的，在这里用属于灰色地带，额度异常时优先换回开放平台。' },
  };
  const DEFAULT_AI = { key: '', provider: 'kimicode', base: PROVIDERS.kimicode.base, model: 'k3', temperature: 0.3 };
  let ai = { ...DEFAULT_AI };
  let history = [];
  let lastBatch = null;      // 上一批 AI 改动的逆操作日志（只存内存，刷新即失）          // OpenAI 格式 messages（不含 system）
  let proposal = null;       // { summary, changes: [...] }
  let busy = false;
  let usage = { in: 0, out: 0 };

  chrome.storage.local.get({ ai: DEFAULT_AI }).then((r) => { ai = { ...DEFAULT_AI, ...(r.ai || {}) }; paintStatus(); });
  const saveAi = () => chrome.storage.local.set({ ai });

  // ── 工具定义（给模型看的）──
  const TOOLS = [
    { type: 'function', function: { name: 'get_overview', description: '拿到全局概览：所有文件夹（id、名字、层级、条数）、标签定义、统计。改东西之前先调它。', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'get_folder', description: '拿某个文件夹里的全部书签和子夹（id、标题、备注名、网址、标签、说明、位置）。', parameters: { type: 'object', required: ['folder_id'], properties: { folder_id: { type: 'string' } } } } },
    { type: 'function', function: { name: 'search', description: '按关键词在全部书签里搜（匹配标题、备注名、网址、说明、所在文件夹），返回最多 limit 条。', parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'integer', default: 50 } } } } },
    { type: 'function', function: { name: 'get_all_bookmarks', description: '一次拿全部书签的紧凑清单（每行：id|文件夹路径|标题|备注名|域名|标签），用于整体分类、批量打标签。几百条时约两三万 token。', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'propose_changes', description: '提交一批修改让用户预览确认。用户点执行后才会真正写入。一次对话只调一次，把所有改动放在一起。', parameters: { type: 'object', required: ['summary', 'changes'], properties: {
      summary: { type: 'string', description: '一句话说明这批改动' },
      changes: { type: 'array', items: { type: 'object', required: ['op'], properties: {
        op: { type: 'string', enum: ['move', 'rename', 'set_url', 'meta', 'create_folder', 'create_bookmark', 'delete', 'sort_folder', 'add_tag', 'set_folder_color'] },
        id: { type: 'string', description: '书签或文件夹 id（move/rename/set_url/meta/delete/sort_folder/set_folder_color）' },
        parent_id: { type: 'string', description: '目标文件夹 id；可写 $ref 引用本批 create_folder 的 ref' },
        index: { type: 'integer', description: '目标位置（0 起）；不填＝末尾' },
        title: { type: 'string' }, url: { type: 'string' },
        alias: { type: 'string', description: '备注名（≤12 字）' }, desc: { type: 'string', description: '一句话说明（≤20 字）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签 id 列表（只能用已定义的标签 id，或本批 add_tag 的 ref）' },
        emoji: { type: 'string', description: '一个 emoji 当图标' },
        by: { type: 'string', enum: ['domain', 'title', 'alias'], description: 'sort_folder 的排序依据' },
        ref: { type: 'string', description: 'create_folder / add_tag 时给这个新对象起的引用名，后续 op 用 $ref 指它' },
        glyph: { type: 'string', description: 'add_tag：一个字' }, name: { type: 'string', description: 'add_tag：标签名' }, color: { type: 'string', description: '十六进制颜色' },
      } } },
    } } } },
  ];

  const compact = (n, path) => {
    const m = BM.itemMeta(n.url); const d = BM.domainParts(n.url);
    return `${n.id}|${path}|${n.title}|${m.name || ''}|${d.pre ? d.pre + '.' : ''}${d.root}|${(m.tags || []).join(',')}${m.desc ? '|' + m.desc : ''}`;
  };
  function folderPath(id) { const b = BM.flat.find((x) => x.parentId === id); if (b) return b.path || '书签栏'; const walk = (n, p) => { if (n.id === id) return p; for (const c of n.children || []) if (!c.url) { const r = walk(c, p ? p + '/' + c.title : c.title); if (r !== null) return r; } return null; }; return walk(BM.bar, '') || '书签栏'; }

  const isLocked = (id) => BM.isLocked ? BM.isLocked(String(id)) : false;
  const RUN = {
    get_overview() {
      const folders = [];
      const walk = (n, depth, path) => { for (const c of n.children || []) if (!c.url) { folders.push({ id: c.id, title: c.title, depth, path: path ? path + '/' + c.title : c.title, count: BM.countUrls(c), subfolders: (c.children || []).filter((x) => !x.url).length, ...(isLocked(c.id) ? { locked: true } : {}) }); walk(c, depth + 1, path ? path + '/' + c.title : c.title); } };
      walk(BM.bar, 0, '');
      return { bar_id: BM.bar.id, total_bookmarks: BM.flat.length, locked_note: 'locked:true 的文件夹及其内容用户已锁定，不要对它们提任何改动', folders, tags: BM.tagList().map((t) => ({ id: t.id, glyph: t.glyph, name: t.name, desc: t.desc })), max_tags: BM.MAX_TAGS, loose_in_bar: (BM.bar.children || []).filter((c) => c.url).length };
    },
    get_folder({ folder_id }) {
      const f = BM.findNode(String(folder_id)); if (!f || f.url) return { error: '没有这个文件夹' };
      const path = folderPath(f.id);
      return { id: f.id, title: f.title, items: (f.children || []).map((c, i) => c.url ? { id: c.id, index: i, title: c.title, alias: BM.itemMeta(c.url).name || '', url: c.url, tags: BM.itemMeta(c.url).tags || [], desc: BM.itemMeta(c.url).desc || '', emoji: BM.itemMeta(c.url).icon || '' } : { id: c.id, index: i, folder: c.title, count: BM.countUrls(c) }) , path };
    },
    search({ query, limit = 50 }) {
      const q = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
      const hits = BM.flat.filter((b) => { const m = BM.itemMeta(b.url); const hay = `${b.title} ${m.name || ''} ${b.url} ${m.desc || ''} ${b.path}`.toLowerCase(); return q.every((t) => hay.includes(t)); }).slice(0, limit);
      return { count: hits.length, items: hits.map((b) => compact(b, b.path || '书签栏')) , format: 'id|文件夹路径|标题|备注名|域名|标签|说明' };
    },
    get_all_bookmarks() {
      return { format: 'id|文件夹路径|标题|备注名|域名|标签|说明', count: BM.flat.length, lines: BM.flat.map((b) => compact(b, b.path || '书签栏')) };
    },
    propose_changes({ summary, changes }) {
      if (!Array.isArray(changes) || !changes.length) return { error: 'changes 为空' };
      proposal = { summary: String(summary || ''), changes };
      renderProposal();
      return { ok: true, shown: changes.length, note: '已展示给用户预览，等用户点「执行」。你现在用一两句话总结即可，不要再调工具。' };
    },
  };

  // ── 预览与执行 ──
  const OPNAME = { move: '移动', rename: '改名', set_url: '改地址', meta: '改说明', create_folder: '新建夹', create_bookmark: '新建书签', delete: '删除', sort_folder: '排序', add_tag: '新增标签', set_folder_color: '夹颜色' };
  function describe(ch) {
    const n = ch.id ? BM.findNode(String(ch.id)) : null; const nm = n ? (n.url ? BM.label(n) : '📁 ' + n.title) : (ch.id ? `#${ch.id}` : '');
    const tgt = ch.parent_id ? (String(ch.parent_id).startsWith('$') ? ch.parent_id : ('📁 ' + (BM.findNode(String(ch.parent_id))?.title || ch.parent_id))) : '';
    switch (ch.op) {
      case 'move': return `${nm} → ${tgt}${ch.index != null ? ' 第 ' + (ch.index + 1) + ' 位' : ''}`;
      case 'rename': return `${nm} 改名为「${ch.title}」`;
      case 'set_url': return `${nm} 地址改为 ${ch.url}`;
      case 'meta': return `${nm}：${[ch.alias != null && '备注「' + ch.alias + '」', ch.desc != null && '说明「' + ch.desc + '」', ch.tags && '标签 ' + ch.tags.map((t) => BM.tagDef(t)?.glyph || t).join(''), ch.emoji && '图标 ' + ch.emoji].filter(Boolean).join(' · ')}`;
      case 'create_folder': return `在 ${tgt || '书签栏'} 新建文件夹「${ch.title}」${ch.ref ? ' (' + ch.ref + ')' : ''}`;
      case 'create_bookmark': return `在 ${tgt || '书签栏'} 新建书签「${ch.title}」 ${ch.url}`;
      case 'delete': return `🗑 删除 ${nm}`;
      case 'sort_folder': return `${nm} 按${{ domain: '域名', title: '标题', alias: '备注名' }[ch.by] || '域名'}排序`;
      case 'add_tag': return `新增标签「${ch.glyph} ${ch.name}」`;
      case 'set_folder_color': return `${nm} 颜色 ${ch.color}`;
      default: return JSON.stringify(ch);
    }
  }
  function renderProposal() {
    const box = $('#ai-proposal'); if (!proposal) { box.hidden = true; box.innerHTML = ''; return; }
    showPanel(true); box.hidden = false;
    const dangerous = proposal.changes.filter((c) => c.op === 'delete').length;
    const lockedHit = (c) => (c.id && isLocked(c.id)) || (c.parent_id && !String(c.parent_id).startsWith('$') && isLocked(c.parent_id));
    const nLocked = proposal.changes.filter(lockedHit).length;
    box.innerHTML = `<div class="ai-prop-head"><b>预览：${esc(proposal.summary)}</b><span>${proposal.changes.length} 项${dangerous ? ' · 含删除 ' + dangerous + ' 项' : ''}${nLocked ? ' · 🔒 涉及锁定 ' + nLocked + ' 项已取消勾选' : ''}</span></div>` +
      `<div class="ai-prop-list">${proposal.changes.map((c, i) => { const lk = lockedHit(c); return `<label class="ai-prop-item ${c.op === 'delete' ? 'danger' : ''} ${lk ? 'locked' : ''}"><input type="checkbox" data-i="${i}" ${(c.op === 'delete' || lk) ? '' : 'checked'}><span class="op">${lk ? '🔒 ' : ''}${OPNAME[c.op] || c.op}</span><span class="what">${esc(describe(c))}</span></label>`; }).join('')}</div>` +
      `<div class="ai-prop-actions"><button type="button" class="btn" id="ai-apply">执行勾选的</button><button type="button" class="btn ghost" id="ai-discard">放弃</button></div>`;
    $('#ai-apply').onclick = applyProposal;
    $('#ai-discard').onclick = () => { proposal = null; renderProposal(); addMsg('sys', '已放弃这批改动'); };
  }
  // ── 批量撤销：倒着重放逆操作。只碰这批动过的节点，🚫 不整树恢复 ──
  function renderUndo() {
    const box = $('#ai-proposal');
    const old = $('#ai-undo-bar'); if (old) old.remove();
    if (!lastBatch) return;
    showPanel(true);
    const bar = document.createElement('div');
    bar.className = 'ai-prop-actions'; bar.id = 'ai-undo-bar';
    bar.innerHTML = `<span class="ai-undo-note">上一批改了 ${lastBatch.n} 项</span>` +
      `<button type="button" class="btn" id="ai-undo">撤销这批</button>` +
      `<button type="button" class="btn ghost" id="ai-undo-keep">保留</button>`;
    box.parentElement.insertBefore(bar, box.nextSibling);
    $('#ai-undo').onclick = undoBatch;
    $('#ai-undo-keep').onclick = () => { lastBatch = null; renderUndo(); };
  }
  async function undoBatch() {
    if (!lastBatch || busy) return;
    busy = true; const btn = $('#ai-undo'); if (btn) btn.disabled = true;
    const store = BM.store;
    const api = {
      find: (id) => BM.findNode(String(id)),
      children: (id) => store.children(String(id)),
      create: (props) => store.create(props),
      update: (id, patch) => store.update(String(id), patch),
      move: (id, dest) => store.move(String(id), dest),
      remove: (id) => store.remove(String(id)),
      // 🔴 重建出来的节点要先进内存树，后面的逆操作才找得到
      removeTree: async (id) => { await store.removeTree(String(id)); await BM.refresh(); },
      setMeta: (url, snap) => BM.setItemMeta(url, snap),
      removeTag: (id) => { BM.meta.tags = BM.tagList().filter((t) => t.id !== id); BM.saveMeta(); },
      setGroup: (title, val) => { if (val) BM.meta.groups[title] = val; else delete BM.meta.groups[title]; BM.saveMeta(); },
    };
    const wrapped = { ...api, create: async (props) => { const r = await store.create(props); await BM.refresh(); return r; } };
    const { ok, skipped } = await AiCore.replayUndo(lastBatch.journal, wrapped);
    lastBatch = null; busy = false;
    await BM.refresh(); renderUndo();
    addMsg('sys', `已撤销 ${ok} 项${skipped.length ? `，${skipped.length} 项没能撤销：` + skipped.slice(0, 3).join('；') : ''}`);
    BM.toast(`已撤销 ${ok} 项${skipped.length ? `，${skipped.length} 项跳过` : ''}`);
  }
  // 🔴 批次内前面的改动还没回写内存树：标题和位置都必须从数据层实读。
  //    用 BM.findNode 会拿到旧标题，重建出来的节点对不上，后面「改名」的逆操作会误判成「被用户改过」而跳过。
  async function readSubtree(live) {
    const node = { id: String(live.id), title: live.title || '', url: live.url || undefined, children: [] };
    if (node.url) return node;
    for (const k of await BM.store.children(node.id)) node.children.push(await readSubtree(k));
    return node;
  }

  async function applyProposal() {
    if (!proposal) return;
    const picked = $$('#ai-proposal input[type=checkbox]').filter((c) => c.checked).map((c) => proposal.changes[Number(c.dataset.i)]);
    if (!picked.length) return;
    const refs = {}; let done = 0, fail = 0; const errs = []; const journal = [];
    const R = (v) => (typeof v === 'string' && v.startsWith('$')) ? (refs[v.slice(1)] || refs[v] || v) : v;
    const store = BM.store; const barId = BM.bar.id;
    let marked = 0;
    for (const ch of picked) {
      try {
        if ((ch.id && isLocked(ch.id)) || (ch.parent_id && !String(ch.parent_id).startsWith('$') && isLocked(ch.parent_id))) throw new Error('目标在锁定的文件夹里');
        switch (ch.op) {
          case 'move': { const cur = BM.findNode(String(ch.id)); if (!cur) throw new Error('不存在');
            const sibs = await store.children(cur.parentId); const oldIndex = sibs.findIndex((k) => String(k.id) === String(ch.id));
            journal.push({ kind: 'move', id: String(ch.id), to: { parentId: String(cur.parentId), index: oldIndex < 0 ? sibs.length : oldIndex } });
            const kids = await store.children(R(ch.parent_id) || barId); await store.move(String(ch.id), { parentId: String(R(ch.parent_id) || barId), index: ch.index != null ? Number(ch.index) : kids.length }); break; }
          case 'rename': { const cur = BM.findNode(String(ch.id)); if (!cur) throw new Error('不存在');
            journal.push({ kind: 'update', id: String(ch.id), to: { title: cur.title || '' }, after: { title: String(ch.title) } });
            await store.update(String(ch.id), { title: String(ch.title) }); break; }
          case 'set_url': { const n0 = BM.findNode(String(ch.id)); if (!n0) throw new Error('不存在');
            journal.push({ kind: 'update', id: String(ch.id), to: { url: n0.url }, after: { url: String(ch.url) },
              meta: [{ url: String(ch.url), snap: AiCore.metaSnapshot(BM.itemMeta(String(ch.url))) }] });
            const n = BM.findNode(String(ch.id)); await store.update(String(ch.id), { url: String(ch.url) }); if (n) { const m = BM.itemMeta(n.url); if (Object.keys(m).length) BM.setItemMeta(ch.url, m); } break; }
          case 'meta': { const n = BM.findNode(String(ch.id)); if (!n || !n.url) throw new Error('不是书签');
            journal.push({ kind: 'meta', meta: [{ url: n.url, snap: AiCore.metaSnapshot(BM.itemMeta(n.url)) }] }); const patch = {}; if (ch.alias != null) patch.name = String(ch.alias); if (ch.desc != null) patch.desc = String(ch.desc); if (ch.emoji != null) patch.icon = String(ch.emoji); if (Array.isArray(ch.tags)) patch.tags = ch.tags.map(R).filter((t) => BM.tagDef(t)); BM.setItemMeta(n.url, patch); break; }
          case 'create_folder': { journal.push({ kind: 'created' });
            const f = await store.create({ parentId: String(R(ch.parent_id) || barId), title: String(ch.title || '新文件夹'), ...(ch.index != null ? { index: Number(ch.index) } : {}) }); journal[journal.length-1].id = f.id; if (ch.ref) refs[ch.ref] = f.id; if (ch.color) { BM.meta.groups[f.title] = { color: ch.color }; BM.saveMeta(); } break; }
          case 'create_bookmark': { journal.push({ kind: 'created' });
            let url = String(ch.url || ''); if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url; const b = await store.create({ parentId: String(R(ch.parent_id) || barId), title: String(ch.title || BM.host(url)), url }); journal[journal.length-1].id = b.id; journal[journal.length-1].meta = [{ url, snap: AiCore.metaSnapshot(BM.itemMeta(url)) }]; if (ch.ref) refs[ch.ref] = b.id; const patch = {}; if (ch.alias) patch.name = ch.alias; if (ch.desc) patch.desc = ch.desc; if (ch.emoji) patch.icon = ch.emoji; if (Array.isArray(ch.tags)) patch.tags = ch.tags.map(R).filter((t) => BM.tagDef(t)); if (Object.keys(patch).length) BM.setItemMeta(url, patch); break; }
          case 'delete': { const n = BM.findNode(String(ch.id)); if (!n) throw new Error('不存在');
            const sibs = await store.children(n.parentId); const at = sibs.findIndex((k) => String(k.id) === String(n.id));
            journal.push({ kind: 'restore', parentId: String(n.parentId), index: at < 0 ? sibs.length : at, plan: AiCore.flattenForRebuild(await readSubtree(sibs[at] || { id: n.id, title: n.title, url: n.url })) }); if (n.url) await store.remove(n.id); else await store.removeTree(n.id); break; }
          case 'sort_folder': { const sid = String(ch.id);
            journal.push({ kind: 'order', id: sid, ids: (await store.children(sid)).map((k) => String(k.id)) });
            const id = String(ch.id); const kids = (await store.children(id)).filter((k) => k.url); const keyOf = (k) => { const d = BM.domainParts(k.url); const m = BM.itemMeta(k.url); return ch.by === 'title' ? k.title : ch.by === 'alias' ? (m.name || k.title) : [d.root, d.pre, BM.label(k)].join(' '); }; for (const k of [...kids].sort((x, y) => keyOf(x).localeCompare(keyOf(y), 'zh'))) await store.move(k.id, { parentId: id, index: (await store.children(id)).length }); break; }
          case 'add_tag': { if (BM.tagList().length >= BM.MAX_TAGS) throw new Error('标签已满 9 个');
            journal.push({ kind: 'tagAdded' }); const t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), glyph: String(ch.glyph || ch.name || '标').slice(0, 2), name: String(ch.name || ''), desc: String(ch.desc || ''), color: ch.color || BM.PALETTE[BM.tagList().length % BM.PALETTE.length] }; BM.meta.tags.push(t); BM.saveMeta(); journal[journal.length-1].id = t.id; if (ch.ref) refs[ch.ref] = t.id; break; }
          case 'set_folder_color': { const n = BM.findNode(String(ch.id)); if (!n) throw new Error('不存在');
            journal.push({ kind: 'group', title: n.title, to: BM.meta.groups[n.title] ? { ...BM.meta.groups[n.title] } : null }); BM.meta.groups[n.title] = { ...(BM.meta.groups[n.title] || {}), color: ch.color }; BM.saveMeta(); break; }
          default: throw new Error('不认识的操作 ' + ch.op);
        }
        done++; marked = journal.length;
      } catch (e) { journal.length = marked; fail++; errs.push(`${OPNAME[ch.op] || ch.op}：${e.message || e}`); }
    }
    proposal = null; renderProposal();
    await BM.refresh();
    lastBatch = journal.length ? { journal, at: Date.now(), n: done } : null;
    renderUndo();
    addMsg('sys', `已执行 ${done} 项${fail ? '，失败 ' + fail + ' 项：' + errs.slice(0, 3).join('；') : ''}${journal.length ? '（可撤销这批）' : ''}`);
    history.push({ role: 'user', content: `[系统] 用户执行了 ${done} 项改动${fail ? '，' + fail + ' 项失败' : ''}。` });
  }

  // ── 对话 ──
  function systemPrompt() {
    const tags = BM.tagList().map((t) => `${t.id}=「${t.glyph}」${t.name}（${t.desc || ''}）`).join('；');
    return `你是「书签首页」里的整理助手，中文回答，简短。数据是用户 Chrome 书签栏（文件夹树＋书签）加一层页面附属数据（备注名 alias、一句话说明 desc、标签 tags、emoji 图标）。
可用标签（只能用这些 id）：${tags || '无'}；最多 ${BM.MAX_TAGS} 个，可用 add_tag 新增。
做法：先用 get_overview / get_folder / search / get_all_bookmarks 看清楚，再把所有改动一次放进 propose_changes（用户会预览后点执行）。不要凭空猜 id，id 必须来自工具结果。
locked:true 的文件夹是用户锁定的，只读，不要提任何改动。
风格：备注名 ≤12 字、说明 ≤20 字、说明写「这是什么／干嘛用」。除非用户明说删，否则不要 delete。移动到新文件夹时先 create_folder 带 ref，再用 $ref。
书签栏根 id 见 get_overview 的 bar_id。今天 ${new Date().toLocaleDateString('zh-CN')}。`;
  }
  const isReasoning = (m) => /(^|-)k3\b|kimi-k3/.test(m || '');   // k3 系列只接受 temperature=1，干脆不送
  async function callKimi(messages) {
    const body = { model: ai.model, messages: [{ role: 'system', content: systemPrompt() }, ...messages], tools: TOOLS, tool_choice: 'auto' };
    if (!isReasoning(ai.model)) body.temperature = Number(ai.temperature) || 0.3;
    const r = await fetch(`${ai.base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.key}` }, body: JSON.stringify(body) });
    if (!r.ok) { let t = await r.text(); try { t = JSON.parse(t).error?.message || t; } catch {} throw new Error(`Kimi ${r.status}：${t.slice(0, 300)}`); }
    const j = await r.json(); if (j.usage) { usage.in += j.usage.prompt_tokens || 0; usage.out += j.usage.completion_tokens || 0; }
    return j.choices[0];
  }
  async function send(text) {
    if (busy) return; if (!ai.key) { openSettings(); return; }
    busy = true; $('#ai-send').disabled = true;
    addMsg('user', text); history.push({ role: 'user', content: text });
    const thinking = addMsg('sys', '思考中…');
    try {
      for (let round = 0; round < 10; round++) {
        const c = await callKimi(history);
        const msg = c.message;
        history.push({ role: 'assistant', content: msg.content || '', ...(msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}), ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {}) });
        if (msg.content && msg.content.trim()) addMsg('ai', msg.content);
        if (c.finish_reason !== 'tool_calls' || !msg.tool_calls?.length) break;
        for (const tc of msg.tool_calls) {
          let args = {}; try { args = JSON.parse(tc.function.arguments || '{}'); } catch {}
          const fn = RUN[tc.function.name];
          let out; try { out = fn ? await fn(args) : { error: '没有这个工具' }; } catch (e) { out = { error: String(e.message || e) }; }
          thinking.textContent = `调用 ${tc.function.name}…`;
          history.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(out) });
        }
      }
    } catch (e) { addMsg('sys', '出错：' + (e.message || e)); }
    thinking.remove(); busy = false; $('#ai-send').disabled = false; paintStatus();
    history = AiCore.trimHistory(history, 8);   // 🚫 别按条数裸切，会切断 tool_calls 配对
  }
  // ── 粘网址直接入库：不弹面板、不问话；AI 只在事后补备注名与说明（附属数据，本来就自动保存）──
  function inboxFolder() {
    const bar = BM.bar; if (!bar) return null;
    const hit = (bar.children || []).find((c) => !c.url && String(c.title || '').trim().toLowerCase() === 'inbox');
    return hit ? hit.id : bar.id;     // 没有 Inbox 就放书签栏末尾，🚫 不自动建夹
  }
  async function stashUrls(urls) {
    if (busy) return;
    const parentId = inboxFolder();
    if (!parentId) { BM.toast('书签栏还没读好，稍后再试'); return; }
    const where = parentId === BM.bar.id ? '书签栏' : 'Inbox';
    const made = [];
    try {
      for (const url of urls) {
        const node = await BM.store.create({ parentId, title: AiCore.nameFromUrl(url), url });
        made.push(node.id);
      }
    } catch (e) { BM.toast('加书签失败：' + (e.message || e)); return; }
    await BM.refresh();
    BM.toast(`已加 ${made.length} 条到「${where}」`, { t: '撤销', f: async () => {
      for (const id of made) { try { await BM.store.remove(id); } catch {} }
      await BM.refresh(); BM.toast('已撤销');
    } });
    if (ai.key) enrich(urls, made, where);       // 没配钥匙也能用，只是没有备注名
  }
  // 让 Kimi 给这批网址起备注名、写一句话说明。只写附属数据，🚫 不动书签树、🚫 不移动位置
  async function enrich(urls, ids, where) {
    const tip = BM.toast ? null : null;
    try {
      const c = await callKimi([{ role: 'user', content:
        '给下面每个网址起一个 4～6 字的中文短名，并写一句不超过 20 字的用途说明。\n' +
        '只回 JSON 数组，形如 [{"url":"...","name":"...","desc":"..."}]，不要别的字。\n' + urls.join('\n') }]);
      const raw = (c.message.content || '').replace(/^[^\[]*/, '').replace(/[^\]]*$/, '');
      const list = JSON.parse(raw);
      let done = 0;
      for (const it of Array.isArray(list) ? list : []) {
        if (!it || !it.url) continue;
        const patch = {};
        if (it.name) patch.name = String(it.name).slice(0, 20);
        if (it.desc) patch.desc = String(it.desc).slice(0, 60);
        if (Object.keys(patch).length) { BM.setItemMeta(it.url, patch); done++; }
      }
      if (done) { BM.render(); BM.toast(`已为 ${done} 条补上备注名和说明`, { t: '看看', f: () => { const n = BM.findNode(ids[0]); if (n) BM.openDetail(n.id); } }); }
    } catch (e) {
      BM.toast('书签已入库；AI 补说明没成功：' + String(e.message || e).slice(0, 60));
    }
  }

  function showPanel(on = true) { $('#ai-panel').hidden = !on; $('#ai-toggle').textContent = on ? '▴' : '▾'; }
  function addMsg(who, text) {
    showPanel(true);
    const box = $('#ai-log'); const d = document.createElement('div'); d.className = 'ai-msg ' + who; d.textContent = text; box.appendChild(d); box.scrollTop = box.scrollHeight; return d;
  }
  function paintStatus() {
    $('#ai-status').textContent = ai.key ? `${ai.model} · 本次用 ${usage.in + usage.out} token` : '还没填 Kimi 钥匙 → 点「设置」';
  }

  // ── 设置 ──
  const dlg = $('#dlg-ai');
  function fillModels(provider, current) {
    const p = PROVIDERS[provider] || PROVIDERS.moonshot;
    $('#ai-model').innerHTML = p.models.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('#ai-model').value = p.models.some(([v]) => v === current) ? current : p.models[0][0];
    $('#ai-base').value = p.base; $('#ai-model-note').textContent = p.note;
    const tempBox = $('#ai-temp'); const upd = () => { const r = isReasoning($('#ai-model').value); tempBox.disabled = r; tempBox.title = r ? 'k3 系列不让调温度，固定为 1' : '0 最稳、1 最放飞；整理书签用 0.2～0.4'; };
    $('#ai-model').onchange = upd; upd();
  }
  function readForm(temp) { const provider = $('#ai-provider').value; return { key: $('#ai-key').value.trim(), provider, base: PROVIDERS[provider].base, model: $('#ai-model').value, temperature: temp ?? (Number($('#ai-temp').value) || 0.3) }; }
  function openSettings() {
    $('#ai-provider').value = ai.provider || 'moonshot'; fillModels($('#ai-provider').value, ai.model);
    $('#ai-key').value = ai.key; $('#ai-temp').value = ai.temperature;
    $('#ai-provider').onchange = () => fillModels($('#ai-provider').value, '');
    $('#ai-test-out').textContent = '';
    const form = $('#dlg-ai-form');
    const done = () => { dlg.close(); form.onsubmit = null; $('#ai-cancel').onclick = null; $('#ai-test').onclick = null; };
    form.onsubmit = (e) => { e.preventDefault(); ai = readForm(); saveAi(); paintStatus(); done(); };
    $('#ai-cancel').onclick = done;
    $('#ai-test').onclick = async () => {
      const out = $('#ai-test-out'); out.textContent = '测试中…';
      const save = ai; ai = readForm(0);
      try { const r = await fetch(`${ai.base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ai.key}` }, body: JSON.stringify({ model: ai.model, messages: [{ role: 'user', content: '回复两个字：可以' }], max_tokens: 256, ...(isReasoning(ai.model) ? {} : { temperature: 0 }) }) }); const j = await r.json(); out.textContent = r.ok ? `✅ 通了（${j.model || ai.model}）${j.choices?.[0]?.message?.content ? '：' + j.choices[0].message.content.trim().slice(0, 20) : ''}` : `❌ ${r.status} ${j.error?.message || ''}`; }
      catch (e) { out.textContent = '❌ ' + (e.message || e); }
      finally { ai = save; }
    };
    dlg.showModal(); (ai.key ? $('#ai-model') : $('#ai-key')).focus();
  }
  // 调试口：CDP 里直接灌一批改动走真实的预览/执行/撤销路径（同 app.js 的 window.__store）
  window.__ai = {
    propose(changes, summary) { proposal = { summary: summary || '调试注入', changes }; renderProposal(); },
    get batch() { return lastBatch; },
    undo: () => undoBatch(),
  };
  $('#ai-settings').addEventListener('click', openSettings);
  $('#ai-toggle').addEventListener('click', () => showPanel($('#ai-panel').hidden));
  $('#ai-close').addEventListener('click', () => showPanel(false));
  $('#ai-input').addEventListener('focus', () => { if (history.length || !ai.key) showPanel(true); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#ai-panel').hidden && !document.activeElement.closest?.('dialog')) showPanel(false); });
  document.addEventListener('pointerdown', (e) => { if (!$('#ai-panel').hidden && !e.target.closest('#ai-panel, .ai-bar, dialog') && !proposal) showPanel(false); });
  $('#ai-send').addEventListener('click', () => {
    const t = $('#ai-input').value.trim(); if (!t) return;
    $('#ai-input').value = '';
    const urls = AiCore.parseUrls(t);
    if (urls) stashUrls(urls); else send(t);     // 粘网址＝直接入库；打整句话才走对话
  });
  $('#ai-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); $('#ai-send').click(); } });
  $('#ai-clear').addEventListener('click', () => { history = []; lastBatch = null; renderUndo(); $('#ai-log').innerHTML = ''; proposal = null; renderProposal(); usage = { in: 0, out: 0 }; paintStatus(); });
  $$('#ai-quick button').forEach((b) => b.addEventListener('click', () => { $('#ai-input').value = b.dataset.q; $('#ai-send').click(); }));
  paintStatus();
});
