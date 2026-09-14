// AI 整理标准页。这里写的东西侧栏 AI 每次都会带上，🚫 不在这儿碰书签。
// 标准和任务存 prefs ⇒ 进完整备份（不会丢），但不进同步内容（不污染别的设备）。
// 钥匙单独存 chrome.storage.local.ai，🔴 既不进备份也不进同步。
(async () => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const PROVIDERS = AiProviders.P;
  const DEFAULT_AI = { key: '', provider: AiProviders.DEFAULT_ID, base: PROVIDERS[AiProviders.DEFAULT_ID].base, model: 'k3', temperature: 0.3 };
  const DEFAULT_TASKS = [
    { id: 't1', name: '体检', prompt: '看一下我的书签整体情况，哪些文件夹太杂、哪些重复' },
    { id: 't2', name: '补说明打标签', prompt: '给没有说明的书签补一句话说明，给能判断的打上标签，一批提交预览' },
    { id: 't3', name: '归置未分组', prompt: '把「未分组」里散着的书签归到合适的文件夹' },
  ];
  const EXAMPLE = ['· 标签只用已经定义好的那几个，拿不准就不打，不要自己造新标签',
    '· 备注名 ≤ 6 个字，说明一句话写清「这是什么、什么时候会用」',
    '· 同一个网站的多个页面，优先并到同一个文件夹，别散在各处',
    '· 文件夹有「说明」的，按说明归类；夹里现有内容跟说明对不上，先说出来再动',
    '· 一年没打开过又没有说明的，提出来问我要不要标废弃，不要直接删',
    '· 拿不准的一律不动，列出来问我'].join('\n');

  let ai = { ...DEFAULT_AI }, tasks = [], dirty = { standard: false, tasks: false };
  const say = (m) => { $('status').textContent = m; clearTimeout(say._t); say._t = setTimeout(() => { $('status').textContent = ''; }, 4000); };
  const oops = (e) => { $('error').textContent = e?.message || String(e); };

  async function load() {
    const d = await chrome.storage.local.get({ ai: DEFAULT_AI, aiStandard: '', aiTasks: null });
    ai = { ...DEFAULT_AI, ...(d.ai || {}) };
    $('standard').value = d.aiStandard || '';
    tasks = Array.isArray(d.aiTasks) && d.aiTasks.length ? d.aiTasks : DEFAULT_TASKS.map((t) => ({ ...t }));
    renderTasks(); fillModels(ai.provider, ai.model);
    $('ai-provider').innerHTML = Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('');
    $('ai-provider').value = PROVIDERS[ai.provider] ? ai.provider : AiProviders.DEFAULT_ID;
    $('ai-key').value = ai.key;
    $('ai-base').value = ai.base || ''; $('ai-model-custom').value = ai.model || '';
    fillModels($('ai-provider').value, ai.model);
    paintOverview();
  }
  function paintOverview() {
    const n = $('standard').value.trim().length;
    $('ov-standard').textContent = n ? n + ' 字' : '还没写';
    $('standard-count').textContent = n ? n + ' 字' : '';
    $('ov-tasks').textContent = tasks.length + ' 个';
    $('ov-kimi').textContent = ai.key ? ai.model : '还没填钥匙';
  }

  // ── 常用任务 ──
  function renderTasks() {
    $('task-list').replaceChildren(...tasks.map((t, i) => {
      const row = document.createElement('div'); row.className = 'task-row';
      row.innerHTML = `<div class="task-head"><input class="task-name" value="${esc(t.name)}" placeholder="按钮上的字，2～6 个字" maxlength="12">` +
        `<button type="button" class="task-up" title="上移" ${i === 0 ? 'disabled' : ''}>↑</button>` +
        `<button type="button" class="task-down" title="下移" ${i === tasks.length - 1 ? 'disabled' : ''}>↓</button>` +
        `<button type="button" class="task-del danger" title="删掉这个任务">删掉</button></div>` +
        `<textarea class="task-prompt" rows="3" placeholder="点这个按钮时，对 AI 说的话">${esc(t.prompt)}</textarea>`;
      row.querySelector('.task-name').oninput = (e) => { tasks[i].name = e.target.value; dirty.tasks = true; };
      row.querySelector('.task-prompt').oninput = (e) => { tasks[i].prompt = e.target.value; dirty.tasks = true; };
      row.querySelector('.task-del').onclick = () => { tasks.splice(i, 1); dirty.tasks = true; renderTasks(); paintOverview(); };
      row.querySelector('.task-up').onclick = () => { [tasks[i - 1], tasks[i]] = [tasks[i], tasks[i - 1]]; dirty.tasks = true; renderTasks(); };
      row.querySelector('.task-down').onclick = () => { [tasks[i + 1], tasks[i]] = [tasks[i], tasks[i + 1]]; dirty.tasks = true; renderTasks(); };
      return row;
    }));
    if (!tasks.length) $('task-list').innerHTML = '<p class="muted">一个任务都没有，右侧栏那排按钮会是空的。</p>';
  }
  $('task-add').onclick = () => { tasks.push({ id: 't' + Date.now().toString(36), name: '新任务', prompt: '' }); dirty.tasks = true; renderTasks(); paintOverview(); };
  $('tasks-reset').onclick = () => { if (!confirm('把常用任务恢复成默认那三个？现在写的会丢掉。')) return; tasks = DEFAULT_TASKS.map((t) => ({ ...t })); dirty.tasks = true; renderTasks(); paintOverview(); };
  $('tasks-save').onclick = async () => {
    const clean = tasks.map((t) => ({ id: t.id, name: String(t.name || '').trim().slice(0, 12), prompt: String(t.prompt || '').trim() })).filter((t) => t.name && t.prompt);
    if (clean.length !== tasks.length) say('名字或内容空着的没有保存');
    try { await chrome.storage.local.set({ aiTasks: clean }); tasks = clean; dirty.tasks = false; renderTasks(); paintOverview(); say('常用任务已保存，侧栏里那排按钮跟着变'); } catch (e) { oops(e); }
  };

  // ── 整理标准 ──
  $('standard').oninput = () => { dirty.standard = true; paintOverview(); };
  $('standard-example').onclick = () => {
    if ($('standard').value.trim() && !confirm('用示例覆盖现在写的内容？')) return;
    $('standard').value = EXAMPLE; dirty.standard = true; paintOverview();
  };
  $('standard-save').onclick = async () => {
    try { await chrome.storage.local.set({ aiStandard: $('standard').value.trim().slice(0, 4000) }); dirty.standard = false; say('整理标准已保存，下一次对话就照它办'); paintOverview(); } catch (e) { oops(e); }
  };

  // ── 接口 ──
  function fillModels(provider, current) {
    const p = PROVIDERS[provider] || PROVIDERS[AiProviders.DEFAULT_ID];
    const isCustom = !!p.custom;
    $('row-base').hidden = !isCustom;
    $('row-model').hidden = isCustom || !p.models.length;
    $('row-model-custom').hidden = !isCustom && p.models.length > 0;
    if (!isCustom) $('ai-base').value = p.base;
    if (p.models.length) {
      $('ai-model').innerHTML = p.models.map(([v, l, free]) => `<option value="${esc(v)}">${esc(l)}${free ? '  ★免费档' : ''}</option>`).join('');
      $('ai-model').value = p.models.some(([v]) => v === current) ? current : p.models[0][0];
    }
    // 🔴 价格数字不写在这儿，只给链接 —— 写下来第二天就在骗人，而且不报错
    const free = AiProviders.freeModels(provider);
    $('ai-model-note').innerHTML = esc(p.note || '') + (p.freeHint ? '<br>' + esc(p.freeHint) : '')
      + (free.length ? `<br><b>官方标长期免费的：</b>${esc(free.join('、'))}（额度和限速以官网为准）` : '');
    // 注册入口做成两个明显的按钮摆在模型下面，🚫 别混在小字说明里
    $('go-links').innerHTML = [
      p.apply && `<a class="go-link primary-link" href="${p.apply}" target="_blank" rel="noopener">去 ${esc(p.name.replace(/（.*/, ''))} 注册 / 拿钥匙 ↗</a>`,
      p.pricing && `<a class="go-link" href="${p.pricing}" target="_blank" rel="noopener">查价格和免费额度 ↗</a>`,
    ].filter(Boolean).join('');
    $('go-links').hidden = !p.apply;
  }
  $('ai-provider').onchange = () => fillModels($('ai-provider').value, '');
  $('ai-model').onchange = () => fillModels($('ai-provider').value, $('ai-model').value);
  $('ai-model-custom').oninput = () => fillModels($('ai-provider').value, $('ai-model-custom').value);
  const readForm = (temp) => {
    const provider = $('ai-provider').value, p = PROVIDERS[provider];
    const custom = !!p.custom || !p.models.length;
    return { key: $('ai-key').value.trim(), provider,
      base: (custom ? $('ai-base').value.trim() : p.base).replace(/\/$/, ''),
      model: (custom ? $('ai-model-custom').value : $('ai-model').value).trim(),
      // 温度不再摆在界面上 —— 整理书签只需要稳，0.3 就是稳的那一档。
      // 会思考的模型本来就不吃这个参数，摆出来只会让人以为它有用。
      temperature: temp ?? 0.3 };
  };
  $('ai-save').onclick = async () => { try { ai = readForm();
    if (!ai.base) { oops(Error('接口地址不能为空')); return; }
    if (!ai.model) { oops(Error('模型名不能为空')); return; }
    $('error').textContent = ''; await chrome.storage.local.set({ ai }); say('接口设置已保存'); paintOverview(); } catch (e) { oops(e); } };
  $('ai-test').onclick = async () => {
    const out = $('ai-test-out'); out.textContent = '测试中…';
    const c = readForm(0);
    try {
      const r = await fetch(`${c.base.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.key}` },
        body: JSON.stringify({ model: c.model, messages: [{ role: 'user', content: '回复两个字：可以' }], max_tokens: 256, ...(AiProviders.noTemperature(c.model) ? {} : { temperature: 0 }) }) });
      const j = await r.json();
      out.textContent = r.ok ? `✅ 通了（${j.model || c.model}）` : `❌ ${r.status} ${j.error?.message || ''}`;
    } catch (e) { out.textContent = '❌ ' + (e.message || e); }
  };

  window.addEventListener('beforeunload', (e) => { if (dirty.standard || dirty.tasks) { e.preventDefault(); e.returnValue = ''; } });
  try { $('app-version').textContent = 'v' + chrome.runtime.getManifest().version; } catch {}
  await load().catch(oops);
})();
