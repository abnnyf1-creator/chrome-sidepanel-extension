/* ===========================================================
 * 麦克风授权页（独立标签页）
 * 参考豆包侧边栏做法：在独立标签页内调用 getUserMedia，
 * 由浏览器在此标签页弹出麦克风授权框，授权更可靠。
 * =========================================================== */
(() => {
  'use strict';

  const statusEl = document.getElementById('status');
  const levelEl = document.getElementById('level');
  const deviceEl = document.getElementById('device');
  const btnRetry = document.getElementById('btnRetry');
  const btnClose = document.getElementById('btnClose');

  let stream = null;
  let audioCtx = null;
  let rafId = 0;

  function notifySidePanel() {
    // 通知侧边栏刷新绿点（侧栏可能没打开，忽略错误）
    try { chrome.runtime.sendMessage({ type: 'micPermissionChanged' }); } catch (e) {}
  }

  function stopAll() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  }

  async function start() {
    stopAll();
    levelEl.style.width = '0%';
    deviceEl.textContent = '';
    statusEl.textContent = '正在请求麦克风权限…（若浏览器弹出提示，请点击“允许”）';

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      deviceEl.textContent = '设备：' + (track && track.label ? track.label : '默认麦克风');
      statusEl.textContent = '麦克风可用 ✓ 对着麦克风说话，下方音量条会跳动：';
      notifySidePanel();

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        const pct = Math.min(100, Math.round(rms * 220));
        levelEl.style.width = pct + '%';
        rafId = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      statusEl.textContent = '未能获取麦克风权限';
      deviceEl.textContent = (e && e.name === 'NotAllowedError')
        ? '原因：你拒绝了授权，或扩展麦克风权限被禁用。可点击下方“重新检测”重试，或到扩展管理页允许麦克风。'
        : ('原因：' + (e && e.message || e));
      notifySidePanel();
    }
  }

  btnRetry.addEventListener('click', start);
  btnClose.addEventListener('click', () => {
    stopAll();
    notifySidePanel();
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id != null) chrome.tabs.remove(tab.id);
      else window.close();
    });
  });

  window.addEventListener('beforeunload', stopAll);

  start();
})();
