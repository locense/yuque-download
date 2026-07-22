// Injected content script — runs on www.yuque.com/*
// Detects knowledge-base pages, extracts embedded data,
// and adds a floating download button.

(function () {
  'use strict';

  /** ─── Utils ────────────────────────────────── */
  function parseEmbeddedAppData() {
    // Yuque embeds knowledge-base JSON inside a decodeURIComponent(...) call.
    const scripts = document.querySelectorAll('script');
    for (const script of scripts) {
      const m = script.textContent &&
        script.textContent.match(/decodeURIComponent\("(.+)"\)\);/);
      if (m && m[1]) {
        try {
          return JSON.parse(decodeURIComponent(m[1]));
        } catch (_) { /* not the right block */ }
      }
    }
    return null;
  }

  function hasMeaningfulToc(appData) {
    const list = appData?.book?.toc;
    return Array.isArray(list) && list.length > 0;
  }

  function isKnowledgeBasePage() {
    const data = parseEmbeddedAppData();
    return data && hasMeaningfulToc(data);
  }

  function getBookInfo() {
    const data = parseEmbeddedAppData();
    if (!data || !data.book) return null;
    return {
      bookId: data.book.id,
      bookSlug: data.book.slug,
      bookName: data.book.name || '',
      bookDesc: data.book.description || '',
      tocList: data.book.toc || [],
      host: data.space?.host || 'https://www.yuque.com',
      imageServiceDomains: data.imageServiceDomains || [],
    };
  }

  /** ─── UI helpers ───────────────────────────── */
  let fabEl = null;
  let overlayEl = null;

  function createUI() {
    // Floating action button
    fabEl = document.createElement('button');
    fabEl.id = 'yuque-dl-fab';
    fabEl.title = '下载此知识库';
    fabEl.innerHTML = '&#x2B07;';
    fabEl.addEventListener('click', onDownloadClick);
    document.body.appendChild(fabEl);

    // Overlay + progress panel
    overlayEl = document.createElement('div');
    overlayEl.id = 'yuque-dl-overlay';
    overlayEl.innerHTML =
      '<div id="yuque-dl-panel">' +
        '<h3>&#x2B07; 下载知识库</h3>' +
        '<div class="yuque-dl-progress-row">' +
          '<span style="min-width:80px;font-size:13px;color:#888;">文章进度</span>' +
          '<div class="yuque-dl-progress-bar-bg">' +
            '<div class="yuque-dl-progress-bar-fill" id="yuque-dl-article-bar"></div>' +
          '</div>' +
          '<span class="yuque-dl-progress-label" id="yuque-dl-article-label">0%</span>' +
        '</div>' +
        '<div class="yuque-dl-progress-row">' +
          '<span style="min-width:80px;font-size:13px;color:#888;">总体进度</span>' +
          '<div class="yuque-dl-progress-bar-bg">' +
            '<div class="yuque-dl-progress-bar-fill" id="yuque-dl-total-bar"></div>' +
          '</div>' +
          '<span class="yuque-dl-progress-label" id="yuque-dl-total-label">0%</span>' +
        '</div>' +
        '<div class="yuque-dl-status-text" id="yuque-dl-status-text" style="word-break:break-all;font-size:12px;">准备中…</div>' +
        '<button class="yuque-dl-close-btn" id="yuque-dl-close-btn">关闭</button>' +
      '</div>';
    document.body.appendChild(overlayEl);

    document.getElementById('yuque-dl-close-btn').addEventListener('click', () => {
      overlayEl.classList.remove('active');
    });
  }

  function showProgress(pctArticle, pctTotal, status) {
    if (!overlayEl) return;
    overlayEl.classList.add('active');
    const aBar = document.getElementById('yuque-dl-article-bar');
    const aLbl = document.getElementById('yuque-dl-article-label');
    const tBar = document.getElementById('yuque-dl-total-bar');
    const tLbl = document.getElementById('yuque-dl-total-label');
    const stxt = document.getElementById('yuque-dl-status-text');
    if (aBar) aBar.style.width = Math.round(pctArticle) + '%';
    if (aLbl) aLbl.textContent = Math.round(pctArticle) + '%';
    if (tBar) tBar.style.width = Math.round(pctTotal) + '%';
    if (tLbl) tLbl.textContent = Math.round(pctTotal) + '%';
    if (stxt) stxt.textContent = status || '';
  }

  function showError(msg) {
    const stxt = document.getElementById('yuque-dl-status-text');
    if (stxt) stxt.textContent = '错误: ' + msg;
  }

  /** 下载完成后显示保存路径和打开按钮 */
  function showCompleted(savePath, error) {
    if (error) {
      showError(error);
    } else {
      const msg = savePath
        ? '下载完成！文件已保存到:\n' + savePath
        : '下载完成！';
      showProgress(100, 100, msg);
    }
  }

  /** 检测插件上下文是否仍然有效 */
  function isExtensionValid() {
    try {
      // 访问 chrome.runtime.id 会在上下文失效时抛出异常
      return !!chrome.runtime && !!chrome.runtime.id;
    } catch {
      return false;
    }
  }

  /** ─── Download handler (using Port for long-lived connection) ── */
  async function onDownloadClick() {
    // 如果插件已被重新加载，提示刷新页面
    if (!isExtensionValid()) {
      showError('插件已更新，请刷新页面后重试');
      if (fabEl) fabEl.classList.remove('yuque-dl-loading');
      return;
    }

    // 从页面嵌入式数据中获取知识库信息
    const info = getBookInfo();
    if (!info) {
      showError('未能解析知识库信息，请确认是否在知识库页面');
      return;
    }

    if (fabEl) fabEl.classList.add('yuque-dl-loading');
    showProgress(0, 0, '正在获取文章列表…');

    try {
      const prefs = await chrome.storage.sync.get({
        ignoreImages: false, ignoreAttachments: false,
        includeToc: false, hideFooter: false, convertVideoLinks: false,
      });

      // 再次检查上下文有效性（storage.get 可能跨过 reload 边界）
      if (!isExtensionValid()) {
        showError('插件已更新，请刷新页面后重试');
        if (fabEl) fabEl.classList.remove('yuque-dl-loading');
        return;
      }

      // 建立长连接 Port → 保持 Service Worker 存活直到完成
      const port = chrome.runtime.connect({ name: 'yuque-dl-download' });

      let downloadComplete = false;

      let hasReceivedMessage = false;
      port.onMessage.addListener((msg) => {
        hasReceivedMessage = true;
        if (msg.type === 'DL_PROGRESS') {
          showProgress(msg.articlePct, msg.totalPct, msg.status);
        } else if (msg.type === 'DL_COMPLETE') {
          downloadComplete = true;
          showCompleted(msg.savePath, msg.error);
        }
      });

      port.postMessage({
        type: 'DOWNLOAD_KNOWLEDGE_BASE',
        bookInfo: info,
        prefs,
      });

      // 等待下载完成。Port 断开可能因为：
      //   a) 正常完成 → background 调用了 port.disconnect()
      //   b) 插件重载 → background 被 Chrome 强制断开（Extension context invalidated）
      const result = await new Promise((resolve) => {
        // 20 second timeout if background never responds
        const timeoutId = setTimeout(() => {
          if (!hasReceivedMessage) {
            resolve({ success: false, error: '后台无响应（超过 30 秒），请检查 chrome://extensions 是否有错误' });
          }
        }, 30000);
        port.onDisconnect.addListener(() => {
          clearTimeout(timeoutId);
          const err = chrome.runtime.lastError;
          if (err || !downloadComplete) {
            resolve({
              success: false,
              error: err
                ? '插件上下文已失效，请刷新页面后重试'
                : '下载中途中断（未收到完成信号），请重试',
            });
          } else {
            resolve({ success: true });
          }
        });
      });

      if (!result.success) {
        showError(result.error || '下载失败');
      }
    } catch (e) {
      showError(e.message || '未知错误');
    } finally {
      if (fabEl) fabEl.classList.remove('yuque-dl-loading');
    }
  }

  /** ─── Boot ─────────────────────────────────── */
  if (isKnowledgeBasePage()) {
    createUI();
    console.log('[yuque-dl] 知识库检测成功，已添加下载按钮');
  }
})();

