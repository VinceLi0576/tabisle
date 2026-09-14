// AI 助手：Kimi（Moonshot，OpenAI 同款接口＋工具调用）在右栏里直接操作书签与附属数据。
// 规矩：读的工具随叫随执行；一切「改」都先走 propose_changes 出预览，用户点「执行」才写。
// 钥匙只存本机 chrome.storage.local 的 ai 键，不进附属数据导出。
window.addEventListener('bm-ready', () => {
  const BM = window.BM;
  const $ = (s) => document.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = BM.esc;
  const PROVIDERS = AiProviders.P;
  const DEFAULT_AI = { key: '', provider: AiProviders.DEFAULT_ID, base: PROVIDERS[AiProviders.DEFAULT_ID].base, model: 'k3', temperature: 0.3 };
  let ai = { ...DEFAULT_AI };
  let history = [];
  let lastBatch = null;      // 上一批 AI 改动的逆操作日志（只存内存，刷新即失）          // OpenAI 格式 messages（不含 system）
  let proposal = null;       // { summary, changes: [...] }
  let busy = false;
  let usage = { in: 0, out: 0 };
  // 当前附加的工作范围（左边点的那个文件夹）。存 session ⇒ 首页和侧栏看到同一个，关浏览器就没了
  let scope = null;          // { id, title, path, count, subfolders, at }
  const SCOPE_KEY = 'aiScope';
  let standard = '';         // 「AI 整理标准」页里写的长期规矩，每次对话都带上
  let tasks = [];            // 常用任务 ＝ 对话区上面那排按钮

  chrome.storage.local.get({ ai: DEFAULT_AI }).then((r) => { ai = { ...DEFAULT_AI, ...(r.ai || {}) }; paintStatus(); });
  const DEFAULT_TASKS = [
    { id: 't1', name: '体检', prompt: '看一下我的书签整体情况，哪些文件夹太杂、哪些重复' },
    { id: 't2', name: '补说明打标签', prompt: '给没有说明的书签补一句话说明，给能判断的打上标签，一批提交预览' },
    { id: 't3', name: '归置未分组', prompt: '把「未分组」里散着的书签归到合适的文件夹' },
  ];
  function loadSetup() {
    return chrome.storage.local.get({ aiStandard: '', aiTasks: null }).then((r) => {
      standard = String(r.aiStandard || '');
      tasks = Array.isArray(r.aiTasks) && r.aiTasks.length ? r.aiTasks : DEFAULT_TASKS;
      renderTasks();
    }).catch(() => {});
  }
  // 那排按钮原来是写死在 html 里的，现在从「AI 整理标准」页读
  function renderTasks() {
    const box = $('#ai-quick'); if (!box) return;
    box.replaceChildren(...tasks.map((t) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = t.name; b.title = t.prompt;
      b.onclick = () => { $('#ai-input').value = t.prompt; $('#ai-send').click(); };
      return b;
    }));
    box.hidden = !tasks.length;
  }
  chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.aiStandard || ch.aiTasks || ch.ai)) loadSetup(); });
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
        op: { type: 'string', enum: ['move', 'rename', 'set_url', 'meta', 'create_folder', 'create_bookmark', 'delete', 'sort_folder', 'add_tag', 'set_folder_color', 'folder_note'] },
        id: { type: 'string', description: '书签或文件夹 id（move/rename/set_url/meta/delete/sort_folder/set_folder_color）' },
        parent_id: { type: 'string', description: '目标文件夹 id；可写 $ref 引用本批 create_folder 的 ref' },
        index: { type: 'integer', description: '目标位置（0 起）；不填＝末尾' },
        title: { type: 'string' }, url: { type: 'string' },
        alias: { type: 'string', description: '备注名（≤12 字）' }, desc: { type: 'string', description: '一句话说明（≤20 字）' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签 id 列表（只能用已定义的标签 id，或本批 add_tag 的 ref）' },
        emoji: { type: 'string', description: '一个 emoji 当图标' },
        by: { type: 'string', enum: ['domain', 'title', 'alias'], description: 'sort_folder 的排序依据' },
        note: { type: 'string', description: 'folder_note：这个文件夹该放哪类内容，一两句话，写给人看，留空＝清掉' },
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
  // 范围内的全部节点 id（含范围根自身与所有子孙）。每次现算，书签树随时在变
  const inScope = () => {
    if (!scope) return null;
    // 范围里那个夹被删了 \u21d2 集合会变成空的，于是「什么都不在范围里」，
    // 表现成 AI 一句话也办不了却说不清为什么。这里当场发现、当场恢复成全部书签。
    if (!BM.findNode(String(scope.id))) { setScope(null); return null; }
    return BmCore.scopeIds(BM.bar, [scope.id]);
  };
  const okIn = (set, id) => !set || set.has(String(id));
  // 🔴 越权 ≠ 失败：给机器可读的 type、给唯一合法出路，🚫 不写「请重试」
  // （抄 Roo-Code 的形状，它的越权回复也是结构化 JSON 带 suggestion）
  const outOfScope = (what, extra = {}) => ({
    type: 'out_of_scope',
    message: '「' + what + '」不在这次附加的范围里，拿不到也改不了。',
    scope: scope ? { folder: scope.path, includes_subfolders: true, bookmarks: scope.count } : null,
    suggestion: '只处理范围内的内容就行。确实需要它，请让用户在左边点那个文件夹把它附加进来——换个工具或换个 id 都拿不到。',
    ...extra,
  });
  const RUN = {
    get_overview() {
      // 🔴 有范围时这里只给「骨架」：范围外的夹只报名字和条数，不报任何书签。
      // 判据：文件夹结构本来就在左边 UI 上用户自己看得见，真正的泄露面是条目不是骨架。
      const set = inScope();
      const folders = [];
      const walk = (n, depth, path) => { for (const c of n.children || []) if (!c.url) {
        const p = path ? path + '/' + c.title : c.title;
        const mine = okIn(set, c.id);
        folders.push(mine
          ? { id: c.id, title: c.title, depth, path: p, count: BM.countUrls(c), subfolders: (c.children || []).filter((x) => !x.url).length, ...(BM.folderNote(c.id) ? { note: BM.folderNote(c.id) } : {}), ...(isLocked(c.id) ? { locked: true } : {}) }
          : { title: c.title, depth, path: p, count: BM.countUrls(c), out_of_scope: true });
        walk(c, depth + 1, p); } };
      walk(BM.bar, 0, '');
      return { bar_id: BM.bar.id, total_bookmarks: BM.flat.length,
        ...(set ? { scope: { folder: scope.path, bookmarks: scope.count, includes_subfolders: true },
          scope_note: 'out_of_scope:true 的夹只给了名字和条数，里面的书签拿不到、也不要对它们提改动。没有 id 的就是这类。' } : {}),
        note_note: 'note 是用户给这个夹定的规矩「这里该放什么」。归类时照它办；它和夹里的实际内容对不上，就说出来。', locked_note: 'locked:true 的文件夹及其内容用户已锁定，不要对它们提任何改动', folders, tags: BM.tagList().map((t) => ({ id: t.id, glyph: t.glyph, name: t.name, desc: t.desc })), max_tags: BM.MAX_TAGS, loose_in_bar: (BM.bar.children || []).filter((c) => c.url).length };
    },
    get_folder({ folder_id }) {
      const f = BM.findNode(String(folder_id)); if (!f || f.url) return { error: '没有这个文件夹' };
      if (!okIn(inScope(), f.id)) return outOfScope(f.title || String(folder_id));
      const path = folderPath(f.id);
      return { id: f.id, title: f.title, ...(BM.folderNote(f.id) ? { note: BM.folderNote(f.id) } : {}), items: (f.children || []).map((c, i) => c.url ? { id: c.id, index: i, title: c.title, alias: BM.itemMeta(c.url).name || '', url: c.url, tags: BM.itemMeta(c.url).tags || [], desc: BM.itemMeta(c.url).desc || '', emoji: BM.itemMeta(c.url).icon || '' } : { id: c.id, index: i, folder: c.title, count: BM.countUrls(c) }) , path };
    },
    search({ query, limit = 50 }) {
      const q = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
      const set = inScope();
      const all = BM.flat.filter((b) => { const m = BM.itemMeta(b.url); const hay = `${b.title} ${m.name || ''} ${b.url} ${m.desc || ''} ${b.path}`.toLowerCase(); return q.every((t) => hay.includes(t)); });
      const mine = set ? all.filter((b) => set.has(String(b.id))) : all;
      const hits = mine.slice(0, limit);
      return { count: hits.length, items: hits.map((b) => compact(b, b.path || '书签栏')), format: 'id|文件夹路径|标题|备注名|域名|标签|说明',
        ...(set ? { scoped_to: scope.path, hidden_outside_scope: all.length - mine.length } : {}) };
    },
    get_all_bookmarks() {
      const set = inScope();
      const rows = set ? BM.flat.filter((b) => set.has(String(b.id))) : BM.flat;
      return { format: 'id|文件夹路径|标题|备注名|域名|标签|说明', count: rows.length, lines: rows.map((b) => compact(b, b.path || '书签栏')),
        ...(set ? { scoped_to: scope.path, note: '这是附加的那个文件夹（含子夹）里的全部书签，不是全库。' } : {}) };
    },
    propose_changes({ summary, changes }) {
      if (!Array.isArray(changes) || !changes.length) return { error: 'changes 为空' };
      // 🔴 schema 裁剪挡不住模型硬编 id ⇒ 执行前再做一次运行时校验（Roo-Code 两层里的第二层）
      const set = inScope();
      if (set) {
        // 跨夹移动改的是两个 children 列表 ⇒ 源和目标都得在范围里
        const bad = changes.filter((c) => (c.id && !set.has(String(c.id)))
          || (c.parent_id && !String(c.parent_id).startsWith('$') && !set.has(String(c.parent_id))));
        const offender = (c) => (c.id && !set.has(String(c.id))) ? c.id : c.parent_id;
        if (bad.length) return outOfScope(bad.map((c) => (OPNAME[c.op] || c.op) + ' ' + offender(c)).slice(0, 5).join('、'),
          { rejected: bad.length, note: '整批都没有提交。把越界的那几条去掉，再提交一次剩下的。' });
      }
      proposal = { summary: String(summary || ''), changes };
      renderProposal();
      return { ok: true, shown: changes.length, note: '已展示给用户预览，等用户点「执行」。你现在用一两句话总结即可，不要再调工具。' };
    },
  };

  // ── 预览与执行 ──
  const OPNAME = { move: '移动', rename: '改名', set_url: '改地址', meta: '改说明', create_folder: '新建夹', create_bookmark: '新建书签', delete: '删除', sort_folder: '排序', add_tag: '新增标签', set_folder_color: '夹颜色', folder_note: '夹说明' };
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
      // 🔴 desc 会拼进每一轮的系统提示，但原来预览里只显示名字 ⇒
      // 模型把指令塞在 desc 里，用户看不见就点了执行，那段话此后一直在提示里、还会同步到别的设备。
      case 'add_tag': return `新增标签「${ch.glyph} ${ch.name}」${ch.desc ? '，说明：' + ch.desc : ''}`;
      case 'set_folder_color': return `${nm} 颜色 ${ch.color}`;
      case 'folder_note': return `${nm} 说明：${ch.note ? '「' + ch.note + '」' : '（清空）'}`;
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
    try { await withWriteLease('撤销', () => runUndo()); }
    catch (e) { busy = false; if (btn) btn.disabled = false; addMsg('sys', '没能撤销：' + (e.message || e)); BM.toast(e.message || String(e)); return; }
  }
  async function runUndo() {
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
      setFolderNote: (id, val) => BM.setFolderNote(id, val || ''),
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

  // 成批改书签前先向后台申请写租约：同一时刻只让一方改，避免和持续同步互相打断
  let renewTimer = null, releaseOnUnload = null;
  async function withWriteLease(what, fn) {
    let lease = null;
    try {
      const r = await BG.askBg({ type: 'WRITE_ACQUIRE', owner: 'ai' }, { ms: 10000 });
      if (!r?.ok) throw Error(r?.error || '无法申请写入权限');
      if (!r.data?.ok) { const o = r.data || {}; throw Error(`${({ sync: '同步', restore: '恢复' })[o.owner] || o.owner || '别的任务'}正在改书签，请稍后再${what}`); }
      lease = r.data.lease;
      // 🔴 260914 核实官发现：租约有 5 分钟硬上限，而全库没有一处发 WRITE_RENEW ⇒
      // 批次一跑满 5 分钟，锁就自己失效了，下一次闹钟（周期也正好 5 分钟）读到「没人持锁」
      // 直接开工 —— 而这边还在写。租约到期放行不是竞态，是必然，所以必须续。
      renewTimer = setInterval(() => {
        BG.askBg({ type: 'WRITE_RENEW', id: lease.id }, { ms: 8000, retry: false }).catch(() => {});
      }, 60e3);
      // 🔴 页面在批次中途被关掉时，下面的 finally 跟着页面一起死，释放消息永远发不出去，
      // 锁要挂到自然过期（最长 5 分钟内同步和备份全停）。pagehide 是关页面时还能发出去的那一下。
      releaseOnUnload = () => { try { chrome.runtime.sendMessage({ type: 'WRITE_RELEASE', id: lease.id }); } catch {} };
      addEventListener('pagehide', releaseOnUnload);
      return await fn();
    } finally {
      clearInterval(renewTimer); renewTimer = null;
      if (releaseOnUnload) { removeEventListener('pagehide', releaseOnUnload); releaseOnUnload = null; }
      if (lease) await BG.askBg({ type: 'WRITE_RELEASE', id: lease.id }, { ms: 8000, retry: false }).catch(() => {});
    }
  }

  async function applyProposal() {
    if (!proposal) return;
    const picked = $$('#ai-proposal input[type=checkbox]').filter((c) => c.checked).map((c) => proposal.changes[Number(c.dataset.i)]);
    if (!picked.length) return;
    try { await withWriteLease('执行', () => runPicked(picked)); }
    catch (e) { addMsg('sys', '没能执行：' + (e.message || e)); BM.toast(e.message || String(e)); }
  }
  async function runPicked(picked) {
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
            // 🔴 组颜色还是按文件夹名字存的（meta.groups[名字]）⇒ 改名不带着走，颜色当场就没了，
            // 旧数据还留在旧名字下。锁和夹说明已经迁到 uid，不受影响，只有颜色这一项要手动搬。
            const oldTitle = cur.title, g = !cur.url && oldTitle && BM.meta.groups[oldTitle];
            if (g && oldTitle !== String(ch.title)) {
              journal.push({ kind: 'group', title: oldTitle, to: { ...g } });
              BM.meta.groups[String(ch.title)] = { ...(BM.meta.groups[String(ch.title)] || {}), ...g };
              delete BM.meta.groups[oldTitle]; BM.saveMeta();
            }
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
            const id = String(ch.id); const kids = (await store.children(id)).filter((k) => k.url); const keyOf = (k) => { const d = BM.domainParts(k.url); const m = BM.itemMeta(k.url); return ch.by === 'title' ? k.title : ch.by === 'alias' ? (m.name || k.title) : [d.root, d.pre, BM.label(k)].join('\u0000'); }; for (const k of [...kids].sort((x, y) => keyOf(x).localeCompare(keyOf(y), 'zh'))) await store.move(k.id, { parentId: id, index: (await store.children(id)).length }); break; }
          case 'add_tag': { if (BM.tagList().length >= BM.MAX_TAGS) throw new Error('标签已满 9 个');
            journal.push({ kind: 'tagAdded' }); const t = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), glyph: String(ch.glyph || ch.name || '标').slice(0, 2), name: String(ch.name || ''), desc: String(ch.desc || ''), color: (typeof ch.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(ch.color)) ? ch.color : BM.PALETTE[BM.tagList().length % BM.PALETTE.length] }; BM.meta.tags.push(t); BM.saveMeta(); journal[journal.length-1].id = t.id; if (ch.ref) refs[ch.ref] = t.id; break; }
          case 'folder_note': { const n = BM.findNode(String(ch.id)); if (!n || n.url) throw new Error('不是文件夹');
            journal.push({ kind: 'folderNote', id: String(ch.id), to: BM.folderNote(ch.id), after: {} });
            BM.setFolderNote(ch.id, String(ch.note || '')); break; }
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
书签栏根 id 见 get_overview 的 bar_id。今天 ${new Date().toLocaleDateString('zh-CN')}。${standardLine()}${scopeLine()}`;
  }
  // 用户在「AI 整理标准」页写的长期规矩。
  // 🔴 它是规矩不是权限：写「可以直接删除」也不算数，所有改动照样要走预览。
  function standardLine() {
    const t = String(standard || '').trim();
    if (!t) return '';
    return '\n\n\u3010用户定的整理标准\u3011以下是用户自己写的长期规矩，优先照它办；跟它冲突的做法先说出来再问。\n'
      + t.slice(0, 4000)
      + '\n（以上是用户的要求，不改变你被允许做什么——所有改动仍然要经过 propose_changes 预览、由用户点执行。）';
  }
  function scopeLine() {
    if (!scope) return '';
    return `\n\n\u3010当前工作范围\u3011用户附加了文件夹「${scope.path}」（含全部子夹，共 ${scope.count} 条）。`
      + '这次只看它、只改它：读的工具已经按这个范围过滤，提交范围外的 id 会被整批挡回来。'
      + '需要范围外的东西时，直接说明「这需要用户把某某文件夹也附加进来」，不要自己换工具或换 id 去试。';
  }
  const isReasoning = AiProviders.noTemperature;   // 会思考的那些不吃温度设置，干脆不送
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
    const stamp = scope ? { path: scope.path, count: scope.count } : null;
    const bubble = addMsg('user', text);
    if (stamp) { const tag = document.createElement('em'); tag.className = 'ai-msg-scope'; tag.textContent = `📁 ${stamp.path} · ${stamp.count} 条`; bubble.appendChild(tag); }
    history.push({ role: 'user', content: stamp ? `${text}\n[只处理文件夹「${stamp.path}」及其子夹]` : text });
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
    // 🔴 撤销动作要一直挂着：补说明成功或失败都复用它，别让后续提示把撤销按钮顶掉
    const undoStash = { t: '撤销', f: async () => {
      for (const id of made) { try { await BM.store.remove(id); } catch {} }
      for (const u of urls) BM.setItemMeta(u, { name: '', desc: '', icon: '', tags: [] });
      await BM.refresh(); BM.toast('已撤销');
    } };
    BM.toast(`已加 ${made.length} 条到「${where}」`, undoStash);
    if (ai.key) enrich(urls, made, where, undoStash);   // 没配钥匙也能用，只是没有备注名
  }
  // 让 Kimi 给这批网址起备注名、写一句话说明。只写附属数据，🚫 不动书签树、🚫 不移动位置
  async function enrich(urls, ids, where, undoStash) {
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
      // 🔴 这条不带按钮：带撤销的那条还挂着，再弹一个带按钮的会把撤销顶掉，用户就点不到了
      if (done) { BM.render(); BM.toast(`已加 ${ids.length} 条到「${where}」，并补上了备注名和说明`, undoStash); }
    } catch (e) {
      BM.toast(`已加 ${ids.length} 条到「${where}」；AI 没能补上说明（${String(e.message || e).slice(0, 40)}）`, undoStash);
    }
  }

  // ── 工作范围：左边点一个文件夹，右边的对话就只在那一摊里 ──
  // 存 chrome.storage.session ⇒ 首页和侧栏看到同一个范围，关掉浏览器就没了。
  function renderScope() {
    const panel = $('#ai-panel'); if (!panel) return;
    let card = $('#ai-scope');
    if (!scope) { if (card) card.remove(); return; }
    if (!card) { card = document.createElement('div'); card.id = 'ai-scope'; card.className = 'ai-scope'; panel.insertBefore(card, panel.firstChild); }
    const fresh = BM.bar ? BmCore.scopeStats(BM.bar, scope.id) : null;
    if (fresh) scope = { ...scope, ...fresh };
    const sub = scope.subfolders ? `含 ${scope.subfolders} 个子夹 · ` : '';
    card.innerHTML = `<span class="ai-scope-ico">📁</span><span class="ai-scope-txt"><b>${esc(scope.title)}</b><em>${esc(scope.path)} · ${sub}${scope.count} 条 · 这次对话只在这一摊里改</em></span>` +
      `<button type="button" class="chev" id="ai-scope-off" title="改回全部书签">×</button>`;
    $('#ai-scope-off').onclick = () => setScope(null);
  }
  async function setScope(id) {
    const stat = id ? BmCore.scopeStats(BM.bar, String(id)) : null;
    scope = stat ? { ...stat, at: Date.now() } : null;
    try { await chrome.storage.session.set({ [SCOPE_KEY]: scope }); } catch {}
    renderScope();
    if (scope) { showPanel(true); addMsg('sys', `范围已设为「${scope.path}」（${scope.subfolders ? '含 ' + scope.subfolders + ' 个子夹，' : ''}共 ${scope.count} 条）。之后只在这一摊里看和改。`); }
    else if (BM.bar) addMsg('sys', '范围已取消，恢复成全部书签。');
  }
  chrome.storage.session.get(SCOPE_KEY).then((d) => { scope = d?.[SCOPE_KEY] || null; renderScope(); }).catch(() => {});
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'session' || !ch[SCOPE_KEY]) return;
    scope = ch[SCOPE_KEY].newValue || null; renderScope();      // 另一边（首页/侧栏）改了范围，这边跟上
  });
  // 首页文件夹头上那个「让 AI 看着写一条」按钮
  window.addEventListener('bm-ask', (e) => {
    const text = e.detail && e.detail.text; if (!text) return;
    showPanel(true);
    if (!ai.key) { openSettings(); return; }
    send(text);
  });
  window.addEventListener('bm-scope', (e) => {
    const id = e.detail && e.detail.id;
    // 再点同一个夹 = 取消，不用去找那个小 ×
    setScope(e.detail?.toggle && scope && String(scope.id) === String(id) ? null : id);
  });

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
    run: RUN,                       // 直接跑工具，用来验范围过滤有没有真生效
    get prompt() { return systemPrompt(); },   // 验「整理标准」和「范围」有没有真拼进去
    get scope() { return scope; },
    setScope,
    get batch() { return lastBatch; },
    undo: () => undoBatch(),
  };
  $('#ai-settings').addEventListener('click', () => { try { window.open('ai-setup.html', '_blank'); } catch { openSettings(); } });
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
  loadSetup();
  paintStatus();
});
