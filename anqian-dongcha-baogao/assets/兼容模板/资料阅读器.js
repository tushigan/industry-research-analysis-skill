(() => {
  "use strict";
  const manifestElement = document.getElementById("document-manifest");
  const documents = manifestElement ? JSON.parse(manifestElement.textContent) : [];
  window.reportDocuments = documents.map(({file, ...item}) => item);
  document.querySelectorAll("[data-open-library]").forEach(button => button.hidden = !documents.length);
  const total = document.getElementById("reference-total");
  if (total) total.textContent = documents.length + "份PDF资料 · 共" + documents.reduce((sum, item) => sum + item.pages, 0).toLocaleString("zh-CN") + "页";
  if (!documents.length) return;
  const byId = new Map(documents.map(item => [item.id, item]));
  const bySource = new Map(documents.map(item => [item.sourceKey, item]));
  const urls = new Map();
  const dialog = document.getElementById("reference-dialog");
  const viewport = document.getElementById("reference-viewport");
  const stage = document.getElementById("reference-paper");
  const list = document.getElementById("reference-list");
  const title = document.getElementById("reference-title");
  const detail = document.getElementById("reference-detail");
  const status = document.getElementById("reference-status");
  const download = document.getElementById("reference-download");
  const external = document.getElementById("reference-external");
  const newTab = document.getElementById("reference-new-tab");
  const sources = window.REPORT_DATA?.sources || {};
  let selected = documents[0].id;
  let currentPage = 1;
  let zoom = 1;
  let renderId = 0;
  let renderTask;
  let enginePromise;
  const pdfs = new Map();
  const moduleUrls = [];

  function decode(encoded) {
    const binary = atob(encoded.trim());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function engine() {
    if (!enginePromise) enginePromise = (async () => {
      const moduleUrl = URL.createObjectURL(new Blob([decode(document.getElementById("embedded-pdfjs").textContent)], {type:"application/javascript"}));
      const workerUrl = URL.createObjectURL(new Blob([decode(document.getElementById("embedded-pdfjs-worker").textContent)], {type:"application/javascript"}));
      moduleUrls.push(moduleUrl, workerUrl);
      const pdfjs = await import(moduleUrl);
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      const resources = JSON.parse(document.getElementById("embedded-pdfjs-resources").textContent);
      class EmbeddedBinaryDataFactory {
        async fetch({kind, filename}) {
          const encoded = resources[kind]?.[filename];
          if (!encoded) throw new Error("缺少内嵌字体资源：" + filename);
          return decode(encoded);
        }
      }
      return {pdfjs, EmbeddedBinaryDataFactory};
    })();
    return enginePromise;
  }

  async function pdfDocument(id) {
    if (!pdfs.has(id)) pdfs.set(id, (async () => {
      const {pdfjs, EmbeddedBinaryDataFactory} = await engine();
      const pdf = await pdfjs.getDocument({
        data:decode(document.getElementById("embedded-pdf-" + id).textContent),
        BinaryDataFactory:EmbeddedBinaryDataFactory,useWorkerFetch:false,useWasm:false,
        isEvalSupported:false,verbosity:0
      }).promise;
      if (pdf.numPages !== byId.get(id).pages) throw new Error("PDF页数与清单不一致");
      return pdf;
    })());
    return pdfs.get(id);
  }

  async function renderPage() {
    const ticket = ++renderId;
    const id = selected;
    const number = currentPage;
    renderTask?.cancel();
    delete dialog.dataset.renderedPage;
    delete dialog.dataset.renderedDocument;
    stage.replaceChildren();
    delete dialog.dataset.renderError;
    dialog.dataset.document = id;
    dialog.dataset.page = String(number);
    newTab.href = pdfUrl(id) + "#page=" + number;
    status.textContent = "正在打开" + (byId.get(id).formatLabel || "PDF资料") + "，第" + number + "页…";
    document.getElementById("reference-page").value = number;
    document.getElementById("reference-page").max = byId.get(id).pages;
    document.getElementById("reference-pages").textContent = "/ " + byId.get(id).pages;
    document.getElementById("reference-prev").disabled = number === 1;
    document.getElementById("reference-next").disabled = number === byId.get(id).pages;
    document.getElementById("reference-zoom-label").textContent = Math.round(zoom * 100) + "%";
    try {
      const {pdfjs} = await engine();
      const pdf = await pdfDocument(id);
      const pdfPage = await pdf.getPage(number);
      if (ticket !== renderId || !dialog.open) return;
      const base = pdfPage.getViewport({scale:1});
      const scale = Math.max(0.1, (viewport.clientWidth - 28) / base.width) * zoom;
      const pageViewport = pdfPage.getViewport({scale});
      const ratio = Math.min(devicePixelRatio || 1, 2);
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-label", byId.get(id).title + " 第" + number + "页");
      canvas.width = Math.floor(pageViewport.width * ratio);
      canvas.height = Math.floor(pageViewport.height * ratio);
      canvas.style.width = pageViewport.width + "px";
      canvas.style.height = pageViewport.height + "px";
      stage.style.width = pageViewport.width + "px";
      stage.style.height = pageViewport.height + "px";
      stage.style.setProperty("--total-scale-factor", scale);
      stage.append(canvas);
      renderTask = pdfPage.render({canvasContext:canvas.getContext("2d"),viewport:pageViewport,
        transform:ratio === 1 ? null : [ratio,0,0,ratio,0,0]});
      await renderTask.promise;
      if (ticket !== renderId) return;
      const layer = document.createElement("div");
      layer.className = "pdf-text-layer";
      stage.append(layer);
      await new pdfjs.TextLayer({textContentSource:pdfPage.streamTextContent(),container:layer,viewport:pageViewport}).render();
      if (ticket !== renderId) return;
      viewport.scrollTo(0,0);
      dialog.dataset.renderedPage = String(number);
      dialog.dataset.renderedDocument = id;
      status.textContent = "PDF第" + number + "页 / 共" + pdf.numPages + "页 · " + (byId.get(id).formatLabel || "PDF资料") + " · 可选中文字";
    } catch (error) {
      if (ticket !== renderId || error?.name === "RenderingCancelledException") return;
      status.textContent = "此页预览未能载入，可在新窗口打开或下载PDF。";
      dialog.dataset.renderError = String(error?.message || error);
    }
  }

  function pdfUrl(id) {
    if (!urls.has(id)) {
      const encoded = document.getElementById("embedded-pdf-" + id).textContent.trim();
      const bytes = decode(encoded);
      if (bytes.length !== byId.get(id).bytes) throw new Error("附件大小校验未通过");
      urls.set(id, URL.createObjectURL(new Blob([bytes], {type:"application/pdf"})));
    }
    return urls.get(id);
  }

  function selectDocument(id, page = 1) {
    const item = byId.get(id);
    if (!item) return;
    selected = id;
    const pageNumber = Math.max(1, Math.min(item.pages, Math.round(Number(page) || 1)));
    currentPage = pageNumber;
    title.textContent = item.title;
    detail.textContent = (item.formatLabel || "PDF资料") + " · " + item.pages + "页 · " + (item.bytes / 1024 / 1024).toFixed(2) + " MB" + (item.description ? " · " + item.description : "");
    const originalUrl = sources[item.sourceKey] || item.originalPdf;
    external.hidden = !originalUrl;
    if (originalUrl) external.href = originalUrl;
    else external.removeAttribute("href");
    list.querySelectorAll("button").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.document === id));
    });
    try {
      const url = pdfUrl(id);
      download.href = url;
      download.download = item.filename;
      newTab.href = url + "#page=" + pageNumber;
      download.removeAttribute("aria-disabled");
      newTab.removeAttribute("aria-disabled");
      dialog.dataset.document = id;
      dialog.dataset.page = String(pageNumber);
      delete dialog.dataset.renderError;
      renderPage();
    } catch {
      stage.replaceChildren();
      download.removeAttribute("href");
      newTab.removeAttribute("href");
      download.setAttribute("aria-disabled", "true");
      newTab.setAttribute("aria-disabled", "true");
      status.textContent = "内嵌附件未能载入，请通过原始网页核对文件，或使用随包的研究资料。";
    }
  }

  function openDocument(id = selected, page = currentPage) {
    if (!byId.has(id)) return;
    if (!dialog.open) dialog.showModal();
    selectDocument(id, page);
  }

  documents.forEach(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.document = item.id;
    button.setAttribute("aria-pressed", "false");
    const icon = document.createElement("i");
    icon.dataset.lucide = "file-text";
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = item.title;
    const meta = document.createElement("small");
    meta.textContent = item.pages + "页 · " + (item.formatLabel || "PDF资料");
    text.append(name, meta);
    button.append(icon, text);
    button.addEventListener("click", () => selectDocument(item.id));
    list.append(button);
  });

  // 来源编号与附件编号独立；在线引用保留原始网页入口。
  document.querySelectorAll("a[data-source]").forEach(link => {
    const item = bySource.get(link.dataset.source);
    if (!item || link.hasAttribute("data-online")) return;
    const originalUrl = item.originalPdf || sources[item.sourceKey];
    if (originalUrl) link.href = originalUrl;
    link.dataset.document = item.id;
    const page = Math.max(1, Math.min(item.pages, Math.round(Number(link.dataset.pdfPage) || item.citedPage || 1)));
    link.title = "打开内嵌" + (item.formatLabel || "PDF资料") + "，第" + page + "页";
    link.addEventListener("click", event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openDocument(item.id, page);
    });
  });
  document.querySelectorAll("[data-open-library]").forEach(button => {
    button.addEventListener("click", () => openDocument());
  });
  document.getElementById("reference-close").addEventListener("click", () => dialog.close());
  document.getElementById("reference-full").addEventListener("click", () => selectDocument(selected, 1));
  document.getElementById("reference-cited").addEventListener("click", () => selectDocument(selected, byId.get(selected).citedPage));
  document.getElementById("reference-prev").addEventListener("click", () => selectDocument(selected, currentPage - 1));
  document.getElementById("reference-next").addEventListener("click", () => selectDocument(selected, currentPage + 1));
  document.getElementById("reference-page").addEventListener("change", event => selectDocument(selected, event.target.value));
  document.getElementById("reference-zoom-out").addEventListener("click", () => {zoom = Math.max(0.5, zoom - 0.25);renderPage();});
  document.getElementById("reference-zoom-in").addEventListener("click", () => {zoom = Math.min(3, zoom + 0.25);renderPage();});
  document.getElementById("reference-fit").addEventListener("click", () => {zoom = 1;renderPage();});
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {if (dialog.open) renderPage();}, 180);
  });
  dialog.addEventListener("close", () => {renderId++;renderTask?.cancel();stage.replaceChildren();});
  window.addEventListener("pagehide", () => {urls.forEach(url => URL.revokeObjectURL(url));moduleUrls.forEach(url => URL.revokeObjectURL(url));});
  window.reportDocuments = documents.map(({file, ...item}) => item);
  window.lucide?.createIcons();
})();
