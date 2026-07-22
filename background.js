// Background Service Worker - 3 concurrent workers for speed
importScripts('lib/jszip.min.js');

const SIGN_KEY = 'UXO91eVnUveQn8suOJaYMvBcWs9KptS8N5HoP8ezSeU4vqApZpy1CkPaTpkpQEx2W2mlhxL8zwS8UePwBgksUM0CTtAODbTTTDFD';

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'yuque-dl-download') return;

  function sendStatus(idx, total, msg) {
    const pct = total > 0 ? (idx / total) * 100 : 0;
    try { port.postMessage({ type: 'DL_PROGRESS', articlePct: pct, totalPct: pct, status: msg }); } catch {}
  }

  const heartbeat = setInterval(() => {
    try { port.postMessage({ type: 'DL_KEEPALIVE' }); } catch {}
  }, 10000);

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== 'DOWNLOAD_KNOWLEDGE_BASE') return;
    try {
      const savePath = await downloadKB(msg.bookInfo, msg.prefs || {}, sendStatus);
      port.postMessage({ type: 'DL_COMPLETE', savePath: savePath || null });
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      console.error('[yuque-dl] Error:', e);
      try { port.postMessage({ type: 'DL_COMPLETE', error: e.message || String(e) }); } catch {}
      await new Promise(r => setTimeout(r, 200));
    } finally {
      clearInterval(heartbeat);
      port.disconnect();
    }
  });
});

async function downloadKB(info, prefs, sendStatus) {
  const zip = new JSZip();
  const { bookId, bookName, bookDesc, tocList, host, bookSlug } = info;
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\n\r]/g, '_').replace(/\s/g, '');
  const root = safe(bookName || String(bookId));

  if (!Array.isArray(tocList)) throw new Error('Invalid tocList');

  const items = tocList.filter(t => (t.type || '').toLowerCase() === 'doc');
  const total = items.length;

  const parentMap = new Map();
  for (const t of tocList) parentMap.set(t.uuid, t);

  function resolvePath(item) {
    const parts = [];
    let cur = item;
    while (cur) { parts.unshift(safe(cur.title)); cur = cur.parent_uuid ? parentMap.get(cur.parent_uuid) : null; }
    return parts;
  }

  // Process one article
  async function processOne(item) {
    const title = item.title || item.url || 'untitled';

    const params = '?book_id=' + bookId + '&merge_dynamic_data=false';
    const [mdRes, htmlRes] = await Promise.all([
      fetch(host + '/api/docs/' + item.url + params + '&mode=markdown', { credentials: 'include' }),
      fetch(host + '/api/docs/' + item.url + params, { credentials: 'include' }),
    ]);
    const mdJson = await mdRes.json();
    const htmlJson = await htmlRes.json();

    let md = mdJson?.data?.sourcecode || '';
    const html = htmlJson?.data?.content || '';
    const type = (mdJson?.data?.type || '').toLowerCase();

    if (type === 'sheet' && htmlJson?.data?.content) {
      try { const sd = JSON.parse(htmlJson.data.content)?.sheet; if (sd) md = sheetsToMd(Array.isArray(sd) ? sd : [sd]); } catch {}
    }

    md = fixLatex(md);
    md = fixImages(md, html);
    md = fixCode(md);

    if (!prefs.ignoreImages) {
      const imgDir = 'img/' + item.uuid;
      const urls = [...md.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map(m => m[2]).filter(u => u.startsWith('http'));
      for (const url of urls) {
        try {
          const sig = await signUrl(url);
          const r = await fetch(sig, { credentials: 'include' });
          if (r.ok) {
            const blob = await r.blob();
            const name = url.split('/').pop() || 'img.png';
            zip.folder(root).folder(imgDir).file(name, blob);
            md = md.replace(url, imgDir + '/' + name);
          }
        } catch {}
      }
    }

    if (!prefs.ignoreAttachments) {
      const aDir = 'attachments/' + item.uuid;
      const matches = [...md.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)]*?yuque\.com\/attachments[^)]*)\)/g)];
      for (const [, label, url] of matches) {
        try {
          const r = await fetch(url, { credentials: 'include' });
          if (r.ok) {
            const blob = await r.blob();
            const name = url.split('/').pop() || label;
            zip.folder(root).folder(aDir).file(name, blob);
            md = md.replace('[' + label + '](' + url + ')', '[附件: ' + name + '](' + aDir + '/' + name + ')');
          }
        } catch {}
      }
    }

    const t = mdJson?.data?.content_updated_at || '';
    if (!prefs.hideFooter && t) {
      md += '\n\n> 更新: ' + fmtDate(t) + '  \n> 原文: <' + host + '/' + bookSlug + '/' + item.url + '>';
    }
    md = '# ' + title + '\n\n' + md;

    const parts = resolvePath(item);
    const fp = item.child_uuid ? [...parts, 'index.md'].join('/') : [...parts, safe(title) + '.md'].join('/');
    zip.folder(root).file(fp, md);
  }

  // Run 3 concurrent workers
  let completed = 0;
  const CONCURRENCY = 3;
  const queue = [...items];

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      try { await processOne(item); } catch (e) { console.error('[yuque-dl] Article error:', e); }
      completed++;
      sendStatus(completed, total, '正在下载 (' + completed + '/' + total + '): ' + (item.title || 'untitled'));
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()));

  // Summary
  sendStatus(total, total, '正在生成目录…');
  let summary = '# ' + (bookName || '知识库') + '\n\n';
  if (bookDesc) summary += '> ' + bookDesc + '\n\n';
  for (const item of items) {
    const title = item.title || item.url || 'untitled';
    const parts = resolvePath(item);
    const fp = item.child_uuid ? [...parts, 'index.md'].join('/') : [...parts, safe(title) + '.md'].join('/');
    summary += '- [' + title + '](' + fp + ')\n';
  }
  zip.folder(root).file('index.md', summary);

  // ZIP
  sendStatus(total, total, '正在打包 ZIP（0%）…');
  const blob = await zip.generateAsync({ type: 'blob' }, (meta) => {
    sendStatus(total, total, '正在打包 ZIP（' + Math.round(meta.percent) + '%）…');
  });

  // Download
  sendStatus(total, total, '正在保存文件…');
  // Convert blob to a downloadable URL
  let url;
  try {
    url = URL.createObjectURL(blob);
  } catch {
    // Fallback for environments where createObjectURL is unavailable
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    url = 'data:application/zip;base64,' + btoa(bin);
  }
  const id = await chrome.downloads.download({
    url,
    filename: safe(bookName || 'yuque') + '.zip',
    saveAs: true,
  });

  const savePath = await new Promise((resolve) => {
    const handler = (d) => {
      if (d.id === id && d.state?.current === 'complete') {
        chrome.downloads.onChanged.removeListener(handler);
        chrome.downloads.search({ id }, (r) => resolve(r?.[0]?.filename || ''));
      }
    };
    chrome.downloads.onChanged.addListener(handler);
    setTimeout(() => resolve(''), 15000);
  });

  setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 10000);
  sendStatus(total, total, savePath ? '下载完成！文件已保存到: ' + savePath : '下载完成！');
  return savePath;
}

function fixLatex(md) {
  return md.replace(/!\[([^\]]*)\]\((https?:\/\/[^)]*latex[^)]*)\)/g, (_, alt, url) => {
    try { const u = new URL(url); if (!u.pathname.endsWith('.svg') && u.search) return decodeURIComponent(u.search.slice(1)); } catch {}
    return _;
  });
}

function fixImages(md, html) {
  if (!html) return md;
  const imgs = [];
  const re = /<card[^>]*?name="image"[^>]*?value="data:(.*?)">/gs;
  let m;
  while ((m = re.exec(html)) !== null) {
    try { const p = JSON.parse(decodeURIComponent(m[1])); if (p?.src) imgs.push(p.src); } catch {}
  }
  return md.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
    try { const key = new URL(url).origin + new URL(url).pathname; const r = imgs.find(h => h.includes(key)); if (r) return '![' + alt + '](' + r + ')'; } catch {}
    return match;
  });
}

function fixCode(md) {
  return md.replace(/`([^`]+)`/g, (m, c) => /<[a-z][\s\S]*?>/i.test(c) || /(\*\*|~~|_)/.test(c) ? '<code>' + c + '</code>' : m);
}

function fmtDate(d) {
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) + ' ' + p(dt.getHours()) + ':' + p(dt.getMinutes()) + ':' + p(dt.getSeconds());
}

async function signUrl(url) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SIGN_KEY + url));
  const hash = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'https://www.yuque.com/api/filetransfer/images?url=' + encodeURIComponent(url) + '&sign=' + hash;
}

function sheetsToMd(sheets) {
  let md = '';
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const s of sheets) {
    md += '## ' + (s.name || 'Sheet') + '\n';
    const data = s.data || {};
    const rows = Object.keys(data).map(Number).filter(k => !isNaN(k)).sort((a, b) => a - b);
    if (!rows.length) continue;
    const colMax = Math.max(-1, ...rows.map(r => Math.max(-1, ...Object.keys(data[r]||{}).map(Number).filter(c => !isNaN(c)))));
    const cols = colMax < 0 ? 0 : colMax;
    md += '| |';
    for (let c = 0; c <= cols; c++) md += ' ' + ABC[c % 26] + ' |';
    md += '\n|' + ' --- |'.repeat(cols + 2) + '\n';
    for (const row of rows) {
      md += '| ' + (row + 1) + ' |';
      for (let c = 0; c <= cols; c++) {
        const cell = data[row]?.[c]?.v;
        md += ' ' + (cell != null ? String(cell) : '') + ' |';
      }
      md += '\n';
    }
    md += '\n';
  }
  return md;
}
