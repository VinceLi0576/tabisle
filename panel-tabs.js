// 侧栏两个页签：详情 / AI。Chrome 一个窗口只有一个原生侧栏，所以两者共用这块地方。
(() => {
  const $ = (id) => document.getElementById(id);
  const KEY = 'panelTab';
  const panes = { detail: ['tab-detail', 'pane-detail'], ai: ['tab-ai', 'pane-ai'] };
  function show(which, remember = true) {
    for (const [name, [tabId, paneId]] of Object.entries(panes)) {
      const on = name === which;
      $(tabId).setAttribute('aria-selected', String(on));
      $(tabId).tabIndex = on ? 0 : -1;
      $(paneId).hidden = !on;
    }
    if (remember) chrome.storage.session?.set({ [KEY]: which }).catch(() => {});
    if (which === 'ai') $('ai-input')?.focus();
  }
  $('tab-detail').onclick = () => show('detail');
  $('tab-ai').onclick = () => show('ai');
  for (const id of ['tab-detail', 'tab-ai']) $(id).onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault(); const to = id === 'tab-detail' ? 'ai' : 'detail'; show(to); $(panes[to][0]).focus();
  };
  // 从首页点某条书签的箭头进来时，要自动回到「详情」
  window.addEventListener('panel-open-detail', () => show('detail'));
  chrome.storage.session?.get(KEY).then((d) => show(d?.[KEY] === 'ai' ? 'ai' : 'detail', false)).catch(() => show('detail', false));
  // 侧栏里对话区常驻：ai.js 用 hidden 控制首页那块的展开收起，这里用样式盖掉，
  // 同时把没用的「展开/收起」按钮藏掉，🚫 不去改 ai.js 的逻辑
  document.getElementById('ai-toggle')?.setAttribute('hidden', '');
  document.getElementById('ai-close')?.setAttribute('hidden', '');
  window.PanelTabs = { show };
})();
