/* ===========================================================
 * 侧边工作台 · 设置页
 * 主题 / 默认打开方式 / 嵌入失败自动提示，改动即存。
 * =========================================================== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const savedHint = $('savedHint');

  const DEFAULTS = {
    theme: 'light', autoTheme: true, defaultOpenMode: 'panel', blockedAutoPrompt: true
  };

  function loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(Object.keys(DEFAULTS), (data) => {
        const theme = data.theme || 'light';
        const autoTheme = data.autoTheme !== false;
        const openMode = data.defaultOpenMode || 'panel';
        const blockedAutoPrompt = data.blockedAutoPrompt !== false;
        resolve({ theme, autoTheme, openMode, blockedAutoPrompt });
      });
    });
  }

  function applyToUI(s) {
    const themeMode = s.autoTheme ? 'auto' : s.theme;
    document.querySelector('input[name="themeMode"][value="' + themeMode + '"]').checked = true;
    document.querySelector('input[name="openMode"][value="' + s.openMode + '"]').checked = true;
    $('blockedAutoPrompt').checked = s.blockedAutoPrompt;
  }

  function toStorage() {
    const themeMode = document.querySelector('input[name="themeMode"]:checked').value;
    const autoTheme = themeMode === 'auto';
    const theme = themeMode === 'dark' ? 'dark' : 'light';
    const openMode = document.querySelector('input[name="openMode"]:checked').value;
    const blockedAutoPrompt = $('blockedAutoPrompt').checked;
    chrome.storage.local.set({ theme, autoTheme, defaultOpenMode: openMode, blockedAutoPrompt });

    savedHint.hidden = false;
    clearTimeout(toStorage._t);
    toStorage._t = setTimeout(() => { savedHint.hidden = true; }, 1600);
  }

  document.querySelectorAll('input[name="themeMode"], input[name="openMode"]').forEach(el => {
    el.addEventListener('change', toStorage);
  });
  $('blockedAutoPrompt').addEventListener('change', toStorage);

  loadState().then(applyToUI);
})();
