/* ===========================================================
 * 侧边工作台 · 逻辑
 * 布局：左侧 = 网页浏览区，右侧 = 竖向网站图标栏
 * 所有站点通过 declarativeNetRequest 移除 X-Frame-Options / CSP 后直接 iframe 内嵌
 * =========================================================== */
(() => {
  'use strict';

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const listWrap = $('linkList');
  const viewer = $('viewer');
  const addrBar = $('addrBar');
  const emptyState = $('emptyState');
  const blockedState = $('blockedState');
  const blockedUrl = $('blockedUrl');

  // ---------- 状态 ----------
  const state = {
    links: [],          // {id, name, url, folder, openMode, clickAction, favicon}
    theme: 'light',     // light | dark
    autoTheme: true,    // 跟随系统
    editingId: null,
    railWidth: 56,
  };

  // 内嵌浏览历史（跨域 iframe 无法直接操作 history，故自行维护栈）
  const nav = { stack: ['about:blank'], index: 0, lastUrl: '' };

  // ---------- 存储 ----------
  const DEFAULTS = {
    links: [], theme: 'light', autoTheme: true, railWidth: 56,
    defaultOpenMode: 'panel', blockedAutoPrompt: true
  };

  function loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get(Object.keys(DEFAULTS), (data) => {
        state.links = Array.isArray(data.links) ? data.links : [];
        state.theme = data.theme || 'light';
        state.autoTheme = data.autoTheme !== false;
        state.railWidth = data.railWidth || 56;
        state.defaultOpenMode = data.defaultOpenMode || 'panel';
        state.blockedAutoPrompt = data.blockedAutoPrompt !== false;
        resolve();
      });
    });
  }

  function save(patch) {
    return new Promise((resolve) => chrome.storage.local.set(patch, resolve));
  }

  function saveLinks() { return save({ links: state.links }); }
  function saveTheme() { return save({ theme: state.theme, autoTheme: state.autoTheme }); }

  // ---------- 主题 ----------
  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme() {
    const dark = state.autoTheme ? systemPrefersDark() : state.theme === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const icon = $('themeIcon');
    icon.textContent = state.autoTheme ? '◐' : (dark ? '☾' : '☀');
    icon.parentElement.title = state.autoTheme
      ? '跟随系统（点击改为' + (dark ? '浅色' : '深色') + '）'
      : (dark ? '深色模式（点击改为浅色）' : '浅色模式（点击改为深色）');
  }

  function cycleTheme() {
    if (state.autoTheme) {
      state.autoTheme = false;
      state.theme = systemPrefersDark() ? 'light' : 'dark';
    } else if (state.theme === 'light') {
      state.theme = 'dark';
    } else {
      state.autoTheme = true;
    }
    applyTheme();
    saveTheme();
  }

  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (state.autoTheme) applyTheme();
    });
  }

  // ---------- 工具 ----------
  function uid() {
    return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function normalizeUrl(raw) {
    let u = (raw || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u) && /^[\w.-]+\.[a-z]{2,}/i.test(u)) u = 'https://' + u;
    return u;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function faviconFor(link) {
    if (link.favicon) return link.favicon;
    const host = hostOf(link.url);
    if (!host) return '';
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=32';
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2400);
  }

  // ---------- 渲染图标栏 ----------
  function renderList() {
    listWrap.innerHTML = '';

    if (!state.links.length) {
      const d = document.createElement('div');
      d.className = 'rail-empty';
      d.textContent = '点击上方 + 添加网站';
      listWrap.appendChild(d);
      return;
    }

    state.links.forEach(link => listWrap.appendChild(buildItem(link)));
  }

  function buildItem(link) {
    const el = document.createElement('div');
    el.className = 'rail-item';
    el.dataset.id = link.id;
    el.draggable = true;
    el.title = link.name || link.url;

    // favicon
    const src = faviconFor(link);
    if (src) {
      const img = document.createElement('img');
      img.className = 'favicon';
      img.src = src;
      img.alt = '';
      img.addEventListener('error', () => {
        const fb = document.createElement('div');
        fb.className = 'favicon-fallback';
        fb.textContent = (link.name || '?').trim().charAt(0).toUpperCase();
        img.replaceWith(fb);
      });
      el.appendChild(img);
    } else {
      const fb = document.createElement('div');
      fb.className = 'favicon-fallback';
      fb.textContent = (link.name || '?').trim().charAt(0).toUpperCase();
      el.appendChild(fb);
    }

    // 悬停名称提示
    const tip = document.createElement('div');
    tip.className = 'rail-tip';
    tip.textContent = link.name || hostOf(link.url);
    el.appendChild(tip);

    // 打开模式角标
    if (link.openMode !== 'panel') {
      const b = document.createElement('span');
      b.className = 'rail-badge';
      b.textContent = link.openMode === 'tab' ? '↗' : '❐';
      b.title = link.openMode === 'tab' ? '单击在新标签页打开' : '单击在独立小窗打开';
      el.appendChild(b);
    }

    // 悬停工具（编辑 / 删除）
    const tools = document.createElement('div');
    tools.className = 'rail-tools';
    const edit = document.createElement('button');
    edit.className = 'rail-tool'; edit.textContent = '✎'; edit.title = '编辑';
    const del = document.createElement('button');
    del.className = 'rail-tool del'; del.textContent = '✕'; del.title = '删除';
    tools.appendChild(edit); tools.appendChild(del);
    el.appendChild(tools);

    // 点击行为（统一用计时器区分单击/双击，避免快速双击重复打开）
    let clickTimer = null;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.rail-tool')) return;
      if (clickTimer) return; // 正在等待第二次点击，忽略本次点击
      clickTimer = setTimeout(() => {
        clickTimer = null;
        selectItem(el);
        if (link.clickAction !== 'double') openLink(link); // 单次模式：计时结束即视为单击
      }, 220);
    });
    el.addEventListener('dblclick', () => {
      if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
      selectItem(el);
      if (link.clickAction === 'double') openLink(link); // 双击模式：双击才打开
    });

    edit.addEventListener('click', (e) => { e.stopPropagation(); openModal(link); });
    del.addEventListener('click', async (e) => { e.stopPropagation(); await removeLink(link.id); });

    // 拖拽排序
    el.addEventListener('dragstart', (e) => {
      el.classList.add('dragging');
      e.dataTransfer.setData('text/plain', link.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      el.classList.remove('dragging');
      clearDropMarks();
    });
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropMarks();
      const rect = el.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      el.classList.add(after ? 'drop-after' : 'drop-before');
    });
    el.addEventListener('dragleave', () => clearDropMarks());
    el.addEventListener('drop', async (e) => {
      e.preventDefault();
      const srcId = e.dataTransfer.getData('text/plain');
      const after = el.classList.contains('drop-after');
      clearDropMarks();
      if (srcId && srcId !== link.id) await reorder(srcId, link.id, after);
    });

    return el;
  }

  function clearDropMarks() {
    listWrap.querySelectorAll('.drop-before,.drop-after').forEach(n => {
      n.classList.remove('drop-before', 'drop-after');
    });
  }

  function selectItem(el) {
    listWrap.querySelectorAll('.rail-item.selected').forEach(n => n.classList.remove('selected'));
    if (el) el.classList.add('selected');
  }

  async function reorder(srcId, targetId, after) {
    const from = state.links.findIndex(l => l.id === srcId);
    const to = state.links.findIndex(l => l.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = state.links.splice(from, 1);
    let idx = state.links.findIndex(l => l.id === targetId);
    if (idx < 0) idx = state.links.length - 1;
    state.links.splice(after ? idx + 1 : idx, 0, moved);
    await saveLinks();
    renderList();
  }

  async function removeLink(id) {
    state.links = state.links.filter(l => l.id !== id);
    await saveLinks();
    renderList();
    toast('已删除');
  }

  // =========================================================
  //  打开链接：三种模式
  // =========================================================
  function openLink(link) {
    if (link.openMode === 'tab') {
      chrome.tabs.create({ url: link.url });
      toast('已在新标签页打开');
      return;
    }
    if (link.openMode === 'popup') {
      openInPopup(link.url);
      return;
    }
    // panel：直接在侧边栏 iframe 内加载（DNR 已移除嵌框限制）
    loadInPanel(link.url);
  }

  // 弹出独立小窗
  async function openInPopup(url) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'openPopupWindow', url });
      if (res && res.ok) { toast('已在独立小窗打开'); return; }
      throw new Error((res && res.error) || 'failed');
    } catch (e) {
      chrome.tabs.create({ url });
      toast('已在新标签页打开');
    }
  }

  function loadInPanel(url) {
    const u = normalizeUrl(url);
    if (!u) return;
    nav.lastUrl = u;
    addrBar.value = u;
    emptyState.hidden = true;
    viewer.hidden = false;
    viewer.src = u;
    hideBlocked();
    armLoadWatchdog(u);
    nav.stack = nav.stack.slice(0, nav.index + 1);
    nav.stack.push(u);
    nav.index = nav.stack.length - 1;
    updateNavButtons();
  }

  function updateNavButtons() {
    $('navBack').disabled = nav.index <= 0;
    $('navFwd').disabled = nav.index >= nav.stack.length - 1;
  }

  // ---------- 嵌入失败检测 + 兜底 ----------
  let loadWatchdog = 0;
  let viewerCommitted = false;

  viewer.addEventListener('load', () => {
    viewerCommitted = true;
    hideBlocked();
  });

  function hideBlocked() {
    blockedState.hidden = true;
    clearTimeout(loadWatchdog);
  }

  function showBlocked(url) {
    blockedUrl.textContent = url;
    blockedState.dataset.url = url;
    blockedState.hidden = false;
  }

  // 设置 iframe.src 后启动看门狗：若 9s 内没有 load 事件（多为被禁嵌/超时），
  // 则弹出兜底提示，让用户改在独立小窗 / 新标签打开。
  function armLoadWatchdog(url) {
    if (!state.blockedAutoPrompt) return;
    viewerCommitted = false;
    clearTimeout(loadWatchdog);
    loadWatchdog = setTimeout(() => {
      if (!viewerCommitted) showBlocked(url);
    }, 9000);
  }

  $('blkPopup').addEventListener('click', () => {
    const u = blockedState.dataset.url;
    hideBlocked();
    if (u) openInPopup(u);
  });
  $('blkTab').addEventListener('click', () => {
    const u = blockedState.dataset.url;
    hideBlocked();
    if (u) chrome.tabs.create({ url: u });
  });
  $('blkRetry').addEventListener('click', () => {
    const u = blockedState.dataset.url;
    hideBlocked();
    if (u) loadInPanel(u);
  });

  function gotoStack(i) {
    if (i < 0 || i >= nav.stack.length) return;
    nav.index = i;
    const u = nav.stack[i];
    addrBar.value = u === 'about:blank' ? '' : u;
    emptyState.hidden = u !== 'about:blank';
    viewer.hidden = (u === 'about:blank');
    if (u !== 'about:blank') {
      viewer.src = u;
      hideBlocked();
      armLoadWatchdog(u);
    }
    updateNavButtons();
  }

  $('navBack').addEventListener('click', () => gotoStack(nav.index - 1));
  $('navFwd').addEventListener('click', () => gotoStack(nav.index + 1));

  $('navReload').addEventListener('click', () => {
    if (!nav.lastUrl) return;
    viewer.src = nav.lastUrl;
    hideBlocked();
    armLoadWatchdog(nav.lastUrl);
  });

  $('navPop').addEventListener('click', () => {
    if (nav.lastUrl) chrome.tabs.create({ url: nav.lastUrl });
  });

  addrBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const v = normalizeUrl(addrBar.value);
      if (!v) { toast('请输入网址'); return; }
      loadInPanel(v);
    }
  });

  // ---------- 弹窗：新增 / 编辑 ----------
  const modalMask = $('modalMask');

  function openModal(link) {
    state.editingId = link ? link.id : null;
    $('modalTitle').textContent = link ? '编辑收藏' : '新增收藏';
    $('fName').value = link ? link.name : '';
    $('fUrl').value = link ? link.url : '';
    $('fFolder').value = link ? (link.folder || '') : '';
    // 兼容旧数据：mirror 模式统一回退为 panel；新增时默认用设置里的「默认打开方式」
    const mode = link ? (link.openMode === 'mirror' ? 'panel' : link.openMode) : state.defaultOpenMode;
    const act = link ? (link.clickAction || 'single') : 'single';
    document.querySelector('input[name="openMode"][value="' + mode + '"]').checked = true;
    document.querySelector('input[name="clickAction"][value="' + act + '"]').checked = true;
    modalMask.hidden = false;
    setTimeout(() => $('fName').focus(), 30);
  }

  function closeModal() {
    modalMask.hidden = true;
    state.editingId = null;
  }

  $('btnAdd').addEventListener('click', () => openModal(null));
  $('modalClose').addEventListener('click', closeModal);
  $('modalCancel').addEventListener('click', closeModal);
  modalMask.addEventListener('click', (e) => { if (e.target === modalMask) closeModal(); });

  $('modalSave').addEventListener('click', async () => {
    const name = $('fName').value.trim();
    const url = normalizeUrl($('fUrl').value);
    const folder = $('fFolder').value.trim();
    const openMode = document.querySelector('input[name="openMode"]:checked').value;
    const clickAction = document.querySelector('input[name="clickAction"]:checked').value;

    if (!url) { toast('请填写网址'); return; }
    if (!/^https?:\/\//i.test(url)) { toast('网址需以 http:// 或 https:// 开头'); return; }

    if (state.editingId) {
      const l = state.links.find(x => x.id === state.editingId);
      if (l) Object.assign(l, { name: name || hostOf(url), url, folder, openMode, clickAction });
      await saveLinks();
      toast('已保存');
    } else {
      state.links.push({
        id: uid(), name: name || hostOf(url), url, folder,
        openMode, clickAction, favicon: ''
      });
      await saveLinks();
      toast('已添加');
    }
    closeModal();
    renderList();
  });

  // ---------- 抓取当前标签页 ----------
  $('btnCapture').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !/^https?:/i.test(tab.url)) {
      toast('当前页面无法抓取（仅支持 http/https）');
      return;
    }
    const url = tab.url;
    const name = tab.title || hostOf(url);
    const folder = guessFolder(url);
    const favicon = tab.favIconUrl || '';

    const exist = state.links.find(l => l.url === url);
    if (exist) {
      openLink(exist);
      toast('已在列表中，按其模式打开');
      return;
    }

    state.links.push({
      id: uid(), name, url, folder,
      openMode: state.defaultOpenMode, clickAction: 'single', favicon
    });
    await saveLinks();
    renderList();
    toast('已抓取：' + name);
  });

  function guessFolder(url) {
    const h = hostOf(url).toLowerCase();
    if (/mail|outlook|qq\.com|163/.test(h)) return '邮箱';
    if (/calendar|calendly/.test(h)) return '日历';
    if (/github|gitlab|stackoverflow/.test(h)) return '开发';
    if (/chatgpt|claude|gemini|deepseek/.test(h)) return 'AI';
    if (/douyin|xiaohongshu|bilibili|weibo/.test(h)) return '短视频';
    if (/doc|sheet|drive|docs\./.test(h)) return '文档';
    if (/translate|baidu\.com/.test(h)) return '翻译';
    return '';
  }

  // ---------- 管理模式 ----------
  const manageMask = $('manageMask');
  $('btnManage').addEventListener('click', () => {
    renderManage();
    manageMask.hidden = false;
  });
  $('manageClose').addEventListener('click', () => { manageMask.hidden = true; });
  $('manageDone').addEventListener('click', () => { manageMask.hidden = true; });
  manageMask.addEventListener('click', (e) => { if (e.target === manageMask) manageMask.hidden = true; });

  function renderManage() {
    const box = $('manageList');
    box.innerHTML = '';
    if (!state.links.length) {
      box.innerHTML = '<div class="folder-empty">暂无收藏</div>';
      return;
    }
    state.links.forEach(l => {
      const row = document.createElement('div');
      row.className = 'm-row';
      const n = document.createElement('div');
      n.className = 'm-name';
      n.textContent = l.name || l.url;
      const tag = document.createElement('span');
      tag.className = 'm-tag';
      tag.textContent = l.openMode === 'tab' ? '新标签'
        : (l.openMode === 'popup' ? '小窗' : '面板内');
      const del = document.createElement('button');
      del.className = 'm-del'; del.textContent = '✕'; del.title = '删除';
      del.addEventListener('click', async () => {
        await removeLink(l.id);
        renderManage();
      });
      row.appendChild(n); row.appendChild(tag); row.appendChild(del);
      box.appendChild(row);
    });
  }

  $('btnExport').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.links, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sidedesk-links-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!Array.isArray(data)) throw new Error('格式错误');
      const items = data.map(x => ({
        id: x.id || uid(),
        name: x.name || hostOf(x.url) || '未命名',
        url: normalizeUrl(x.url),
        folder: x.folder || '',
        // 兼容旧数据：mirror 统一回退为 panel
        openMode: ['tab', 'popup'].includes(x.openMode) ? x.openMode : 'panel',
        clickAction: x.clickAction === 'double' ? 'double' : 'single',
        favicon: x.favicon || ''
      })).filter(x => x.url);
      state.links = items.concat(state.links);
      await saveLinks();
      renderList();
      renderManage();
      toast('已导入 ' + items.length + ' 条');
    } catch (err) {
      toast('导入失败：' + err.message);
    }
    e.target.value = '';
  });

  // ---------- 主题按钮 ----------
  $('btnTheme').addEventListener('click', cycleTheme);

  // ---------- 分隔条拖拽调宽 ----------
  (() => {
    const sp = $('splitter');
    const side = $('sidebar');
    let dragging = false;
    sp.addEventListener('mousedown', (e) => {
      dragging = true;
      sp.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const rect = side.getBoundingClientRect();
      const w = Math.min(120, Math.max(48, rect.right - e.clientX));
      side.style.width = w + 'px';
      state.railWidth = w;
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      sp.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      save({ railWidth: state.railWidth });
    });
  })();

  // ---------- 麦克风权限 ----------
  const micBtn = $('btnMic');
  const micDot = $('micDot');

  // 说明：Chrome 不允许用 chrome.permissions.request 动态申请 microphone，
  // 只能在 manifest 里声明（已加）。参考豆包做法：点击麦克风按钮时新开一个
  // 标签页（mic-request.html），由该标签页调用 getUserMedia，浏览器在标签页
  // 内弹出授权框，授权更可靠。这里只负责打开标签页 + 展示授权状态（绿点）。
  async function refreshMicState() {
    let granted = false;
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const st = await navigator.permissions.query({ name: 'microphone' });
        granted = st.state === 'granted';
      }
    } catch (e) { granted = false; }
    micBtn.classList.toggle('granted', granted);
    micDot.hidden = !granted;
    micBtn.title = granted ? '麦克风已授权（点击重新检测）' : '麦克风权限（点击授权）';
  }

  micBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('mic-request.html') });
  });

  // 授权页（新标签页）处理完后会发消息回来，刷新侧栏绿点
  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === 'micPermissionChanged') refreshMicState();
    });
  }

  // ---------- 启动 ----------
  (async () => {
    await loadState();
    $('sidebar').style.width = state.railWidth + 'px';
    applyTheme();
    renderList();
    updateNavButtons();
    refreshMicState();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.links) {
        state.links = changes.links.newValue || [];
        renderList();
      }
      if (changes.theme || changes.autoTheme) {
        state.theme = changes.theme ? changes.theme.newValue : state.theme;
        state.autoTheme = changes.autoTheme ? changes.autoTheme.newValue : state.autoTheme;
        applyTheme();
      }
      if (changes.defaultOpenMode) state.defaultOpenMode = changes.defaultOpenMode.newValue || 'panel';
      if (changes.blockedAutoPrompt) state.blockedAutoPrompt = changes.blockedAutoPrompt.newValue !== false;
    });
  })();
})();
