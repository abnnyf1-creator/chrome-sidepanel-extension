// 后台服务工作线程
// 职责：
//  1) 工具栏图标点击开合侧边面板 + 键盘快捷键
//  2) 独立小窗（popup 模式）
//  3) 动态注册 DNR 规则，移除 iframe 响应中的反嵌入头

const EMBED_RULE_ID = 1001;

const EMBED_HEADERS = [
  'x-frame-options',
  'content-security-policy',
  'content-security-policy-report-only',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy'
];

async function ensureEmbedRules() {
  try {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeIds = existing
      .filter(r => r.id === EMBED_RULE_ID)
      .map(r => r.id);
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: removeIds,
      addRules: [{
        id: EMBED_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          responseHeaders: EMBED_HEADERS.map(h => ({ header: h, operation: 'remove' }))
        },
        condition: {
          resourceTypes: ['sub_frame']
        }
      }]
    });
  } catch (e) {
    // 动态规则注册失败时静默回退到静态规则
  }
}

// ---------- 面板开合 ----------
chrome.runtime.onInstalled.addListener(() => {
  ensureEmbedRules();
  chrome.storage.local.get(['links', 'theme', 'autoTheme'], (data) => {
    const patch = {};
    if (!Array.isArray(data.links)) patch.links = [];
    if (!data.theme) patch.theme = 'light';
    if (data.autoTheme === undefined) patch.autoTheme = true;
    if (Object.keys(patch).length) chrome.storage.local.set(patch);
  });
});

chrome.runtime.onStartup.addListener(() => {
  ensureEmbedRules();
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.commands.onCommand.addListener((command) => {
  if (command === '_execute_action') {
    chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT }).catch(() => {});
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId !== undefined) {
    chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  }
});

// ---------- 独立小窗 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'openPopupWindow') return;
  (async () => {
    try {
      const cur = sender && sender.tab
        ? await chrome.windows.get(sender.tab.windowId)
        : await chrome.windows.getCurrent();
      const baseW = (cur && cur.width) ? cur.width : 1400;
      const baseH = (cur && cur.height) ? cur.height : 900;
      const w = Math.min(1100, Math.max(520, Math.round(baseW * 0.55)));
      const h = Math.min(1000, Math.max(600, Math.round(baseH * 0.85)));
      await chrome.windows.create({
        url: msg.url, type: 'popup', width: w, height: h, focused: true
      });
      sendResponse({ ok: true });
    } catch (e) {
      try { await chrome.tabs.create({ url: msg.url }); sendResponse({ ok: true, fallback: true }); }
      catch (e2) { sendResponse({ ok: false, error: String(e2) }); }
    }
  })();
  return true;
});
