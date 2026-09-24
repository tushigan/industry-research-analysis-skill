(() => {
  'use strict';
  const payload = document.getElementById('attachment-payload');
  if (!payload) return;
  const { documents, pdfjs, worker, resources } = JSON.parse(payload.textContent);
  if (!documents.length) return;
  const dialog = document.createElement('dialog');
  dialog.id = 'attachment-reader';
  dialog.setAttribute('aria-label', '来源资料');
  dialog.innerHTML = `<header><strong id="attachment-title"></strong><button title="关闭资料" data-action="close"><i data-lucide="x"></i></button></header>
    <nav><button title="首页" data-action="first"><i data-lucide="chevrons-left"></i></button><button title="上一页" data-action="prev"><i data-lucide="chevron-left"></i></button>
    <input type="number" min="1" aria-label="原始 PDF 页码" id="attachment-page"><span id="attachment-total"></span>
    <button title="下一页" data-action="next"><i data-lucide="chevron-right"></i></button><button title="末页" data-action="last"><i data-lucide="chevrons-right"></i></button>
    <button title="缩小" data-action="out"><i data-lucide="zoom-out"></i></button><output id="attachment-zoom">100%</output><button title="放大" data-action="in"><i data-lucide="zoom-in"></i></button>
    <a id="attachment-download" title="下载原始 PDF"><i data-lucide="download"></i></a></nav>
    <p id="attachment-status" role="status"></p><div id="attachment-viewport"><canvas aria-label="原始 PDF 页面"></canvas></div>`;
  const style = document.createElement('style');
  style.textContent = `#attachment-reader{width:min(1000px,94vw);height:92vh;border:1px solid #bbb;border-radius:6px;padding:12px;color:#202624;background:#fff;max-width:96vw}#attachment-reader::backdrop{background:#0008}#attachment-reader header,#attachment-reader nav{display:flex;align-items:center;gap:8px;flex-wrap:wrap}#attachment-reader header strong{flex:1;overflow-wrap:anywhere}#attachment-reader nav{margin:10px 0}#attachment-reader button,#attachment-download{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid #ccc;background:#fff;color:#202624;border-radius:4px;padding:6px}#attachment-reader svg{width:20px;height:20px}#attachment-page{width:64px;height:34px}#attachment-viewport{height:calc(100% - 140px);overflow:auto;background:#e9eceb;text-align:center}#attachment-viewport canvas{background:#fff;max-width:none}#attachment-status{font-size:13px;margin:6px 0}@media print{#attachment-reader{display:none!important}}`;
  document.head.append(style);
  document.body.append(dialog);
  window.lucide?.createIcons();
  const decode = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const urls = [];
  const byId = new Map(documents.map(item => [item.attachment_id, item]));
  const pdfs = new Map();
  let enginePromise, current, pageNumber = 1, zoom = 1, ticket = 0, task;
  const status = dialog.querySelector('#attachment-status');
  function blobUrl(bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type })); urls.push(url); return url;
  }
  async function engine() {
    if (!enginePromise) enginePromise = (async () => {
      const api = await import(blobUrl(decode(pdfjs), 'application/javascript'));
      api.GlobalWorkerOptions.workerSrc = blobUrl(decode(worker), 'application/javascript');
      return api;
    })();
    return enginePromise;
  }
  async function documentFor(item) {
    if (!pdfs.has(item.attachment_id)) pdfs.set(item.attachment_id, (async () => {
      const api = await engine();
      class BinaryDataFactory {
        async fetch({ kind, filename }) {
          const value = resources[kind]?.[filename];
          if (!value) throw new Error(`附件缺少字体资源：${filename}`);
          return decode(value);
        }
      }
      const pdf = await api.getDocument({ data: decode(item.data_base64), BinaryDataFactory,
        useWorkerFetch: false, useWasm: false, isEvalSupported: false, verbosity: 0 }).promise;
      if (pdf.numPages !== item.page_count) throw new Error('附件实际页数不一致');
      return pdf;
    })());
    return pdfs.get(item.attachment_id);
  }
  async function render() {
    const id = ++ticket;
    task?.cancel();
    delete dialog.dataset.renderedPage; delete dialog.dataset.error;
    dialog.querySelector('#attachment-page').value = pageNumber;
    dialog.querySelector('#attachment-page').max = current.page_count;
    dialog.querySelector('#attachment-total').textContent = `/ ${current.page_count}`;
    dialog.querySelector('#attachment-zoom').textContent = `${Math.round(zoom * 100)}%`;
    status.textContent = `正在打开原始 PDF 第 ${pageNumber} 页`;
    try {
      const pdf = await documentFor(current);
      const page = await pdf.getPage(pageNumber);
      if (id !== ticket || !dialog.open) return;
      const base = page.getViewport({ scale: 1 });
      const width = dialog.querySelector('#attachment-viewport').clientWidth - 24;
      const viewport = page.getViewport({ scale: Math.max(0.1, width / base.width) * zoom });
      const canvas = dialog.querySelector('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      task = page.render({ canvasContext: canvas.getContext('2d'), viewport });
      await task.promise;
      if (id !== ticket) return;
      dialog.dataset.renderedPage = String(pageNumber);
      dialog.dataset.document = current.attachment_id;
      status.textContent = `原始 PDF 第 ${pageNumber} 页 / 共 ${current.page_count} 页`;
    } catch (error) {
      if (id !== ticket || error.name === 'RenderingCancelledException') return;
      dialog.dataset.error = error.message; status.textContent = `资料加载失败：${error.message}`;
    }
  }
  function open(id, number = 1) {
    if (!byId.has(id)) return;
    current = byId.get(id); pageNumber = Math.max(1, Math.min(current.page_count, Number(number) || 1)); zoom = 1;
    dialog.querySelector('#attachment-title').textContent = current.title || id;
    const download = dialog.querySelector('#attachment-download');
    download.href = blobUrl(decode(current.data_base64), 'application/pdf');
    download.download = `${id}.pdf`;
    if (!dialog.open) dialog.showModal();
    render();
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-attachment-id]');
    if (button) { event.preventDefault(); open(button.dataset.attachmentId, button.dataset.attachmentPage); }
  });
  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'close') { dialog.close(); return; }
    if (action === 'first') pageNumber = 1;
    if (action === 'last') pageNumber = current.page_count;
    if (action === 'prev') pageNumber = Math.max(1, pageNumber - 1);
    if (action === 'next') pageNumber = Math.min(current.page_count, pageNumber + 1);
    if (action === 'out') zoom = Math.max(0.25, zoom - 0.25);
    if (action === 'in') zoom = Math.min(3, zoom + 0.25);
    render();
  });
  dialog.querySelector('#attachment-page').addEventListener('change', event => {
    pageNumber = Math.max(1, Math.min(current.page_count, Math.round(Number(event.target.value) || 1))); render();
  });
  dialog.addEventListener('close', () => { ++ticket; task?.cancel(); });
  window.addEventListener('pagehide', () => urls.forEach(url => URL.revokeObjectURL(url)));
  window.__attachments = { open, count: documents.length };
})();
