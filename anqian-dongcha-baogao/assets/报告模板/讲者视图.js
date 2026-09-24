(() => {
  "use strict";
  const data = window.__reportData;
  const pages = [...document.querySelectorAll("#report > .report-page")];
  const presenter = location.hash === "#presenter";
  const namespace = `anqian-report-${data.fingerprint}`;
  const sender = Math.random().toString(36).slice(2);
  let current = 0, child = null, channel = null, sequence = 0, workspace, timerOutput;
  let ignoreScrollUntil = 0;
  const received = new Map();
  function read(key, fallback) { try { return JSON.parse(localStorage.getItem(namespace + key)) ?? fallback; } catch { return fallback; } }
  function save(key, value) { try { localStorage.setItem(namespace + key, JSON.stringify(value)); } catch {} }
  const button = (action, icon, label) => `<button data-action="${action}" title="${label}" aria-label="${label}"><i data-lucide="${icon}"></i></button>`;
  function post(kind, value) {
    const message = { namespace, sender, sequence: ++sequence, kind, value };
    channel?.postMessage(message);
    if (child && !child.closed) child.postMessage(message, "*");
    if (presenter && window.opener && !window.opener.closed) window.opener.postMessage(message, "*");
  }
  function receive(message) {
    if (!message || message.namespace !== namespace || message.sender === sender || typeof message.sender !== "string" || !Number.isInteger(message.sequence)) return;
    if (message.sequence <= (received.get(message.sender) || 0)) return;
    received.set(message.sender, message.sequence);
    if (message.kind === "page" && Number.isInteger(message.value)) go(message.value, false);
    if (message.kind === "hello" && !presenter) post("page", current);
  }
  try { channel = new BroadcastChannel(namespace); channel.onmessage = event => receive(event.data); } catch {}
  window.addEventListener("message", event => {
    if (event.source === child || (presenter && event.source === window.opener)) receive(event.data);
  });
  function go(index, publish = true, scroll = true) {
    if (!Number.isFinite(index)) return;
    current = Math.max(0, Math.min(pages.length - 1, Math.floor(index)));
    window.__report.currentPage = current + 1;
    const input = document.getElementById(presenter ? "presenter-page" : "page-input");
    if (input) input.value = current + 1;
    document.querySelectorAll('#toolbar [data-action="prev"],.presenter-tools [data-action="prev"]').forEach(b => { b.disabled = current === 0; });
    document.querySelectorAll('#toolbar [data-action="next"],.presenter-tools [data-action="next"]').forEach(b => { b.disabled = current === pages.length - 1; });
    if (presenter) updatePanels();
    else if (scroll) { ignoreScrollUntil = Date.now() + 300; pages[current].scrollIntoView({ block: "start", behavior: "instant" }); }
    if (publish) post("page", current);
  }
  window.__report.goToPage = number => go(Number(number) - 1);
  window.__report.openPresenter = () => {
    const url = new URL(location.href); url.hash = "presenter";
    child = window.open(url.href, `${namespace}-presenter`, "width=1280,height=850,resizable=yes");
    if (!child) { const error = document.getElementById("report-error"); error.hidden = false; error.textContent = "讲者台窗口被浏览器阻止"; }
  };
  const defaultTimer = { elapsed: 0, started: 0, running: false };
  let timer = read("-timer", defaultTimer);
  if (!timer || !Number.isFinite(timer.elapsed) || timer.elapsed < 0 || !Number.isFinite(timer.started) || typeof timer.running !== "boolean") timer = defaultTimer;
  function tick() {
    const seconds = Math.floor((timer.elapsed + (timer.running ? Math.max(0, Date.now() - timer.started) : 0)) / 1000);
    if (timerOutput) timerOutput.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function toggleTimer(reset = false) {
    if (reset) timer = { ...defaultTimer };
    else if (timer.running) timer = { elapsed: timer.elapsed + Math.max(0, Date.now() - timer.started), started: 0, running: false };
    else timer = { ...timer, started: Date.now(), running: true };
    save("-timer", timer);
    const control = document.querySelector('[data-action="timer"]');
    if (control) {
      const label = timer.running ? "暂停计时" : "开始计时";
      control.title = label; control.setAttribute("aria-label", label);
      control.innerHTML = `<i data-lucide="${timer.running ? "pause" : "play"}"></i>`;
      window.lucide?.createIcons();
    }
    tick();
  }
  function safeSource(source, container) {
    const entry = document.createElement("div"); entry.className = "source-entry";
    const label = document.createElement("a"); label.textContent = `${source.source_id} ${source.title}`;
    try { const url = new URL(source.original_url_or_file); if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) { label.href = url.href; label.target = "_blank"; label.rel = "noopener noreferrer"; } } catch {}
    entry.append(label);
    const detail = document.createElement("p");
    detail.textContent = `发布者：${source.publisher_or_author || "未披露"}\n发布：${source.publication_date || "未披露"}；采集：${source.collection_date || "未披露"}\n时期：${source.data_period || "未披露"}\n范围：${source.scope || "未披露"}\n取得方式：${source.access_method || "未披露"}\n原文位置：${source.original_location || "未披露"}\n分享限制：${source.share_restriction || "未披露"}`;
    entry.append(detail); container.append(entry);
  }
  function fitPreview() {
    const wrap = document.getElementById("presenter-preview");
    if (!wrap?.firstElementChild) return;
    const width = data.pageMode === "a4_portrait" ? 794 : 1440;
    const height = data.pageMode === "a4_portrait" ? 1122 : 810;
    const scale = Math.min(wrap.clientWidth / width, (wrap.parentElement.clientHeight - 24) / height);
    wrap.style.height = `${height * scale}px`;
    wrap.firstElementChild.style.transform = `scale(${scale})`;
  }
  function updatePanels() {
    if (!workspace) return;
    const page = data.pages[current];
    const preview = document.getElementById("presenter-preview");
    const clone = pages[current].cloneNode(true);
    clone.removeAttribute("id"); clone.removeAttribute("data-page-id"); clone.className = "preview-page";
    clone.querySelectorAll("[id]").forEach(node => node.removeAttribute("id"));
    clone.style.cssText = `width:${data.pageMode === "a4_portrait" ? 794 : 1440}px;height:${data.pageMode === "a4_portrait" ? 1122 : 810}px;padding:${data.pageMode === "a4_portrait" ? "44px 48px 30px" : "30px 48px 24px"}`;
    preview.replaceChildren(clone);
    document.getElementById("presenter-notes").textContent = `${page.title}\n\n${page.notes}${page.limitations ? "\n\n限制：" + page.limitations : ""}`;
    const sources = document.getElementById("presenter-sources"); sources.replaceChildren();
    page.sources.forEach(s => safeSource(s, sources));
    page.evidence.forEach(e => { const p = document.createElement("p"); p.textContent = `${e.evidence_id}：${e.claim}\n限制：${e.limitations}`; sources.append(p); });
    fitPreview();
  }
  function initLayout() {
    const panels = [...workspace.children];
    const defaults = [[0, 0, .62, 1], [.64, 0, .36, .53], [.64, .55, .36, .45]];
    let layout = read("-layout", defaults);
    if (!Array.isArray(layout) || layout.length !== 3 || layout.some(p => !Array.isArray(p) || p.length !== 4 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1) || p[2] < .1 || p[3] < .1)) layout = defaults.map(x => [...x]);
    function apply() {
      if (innerWidth <= 650) { fitPreview(); return; }
      const w = workspace.clientWidth, h = workspace.clientHeight;
      panels.forEach((panel, i) => {
        const [x, y, width, height] = layout[i];
        const pw = Math.min(w, Math.max(180, width * w)), ph = Math.min(h, Math.max(100, height * h));
        Object.assign(panel.style, { left: `${Math.min(x * w, Math.max(0, w - pw))}px`, top: `${Math.min(y * h, Math.max(0, h - ph))}px`, width: `${pw}px`, height: `${ph}px` });
      });
      fitPreview();
    }
    function storeLayout() {
      if (innerWidth <= 650 || !workspace.clientWidth || !workspace.clientHeight) return;
      layout = panels.map(p => [p.offsetLeft / workspace.clientWidth, p.offsetTop / workspace.clientHeight, p.offsetWidth / workspace.clientWidth, p.offsetHeight / workspace.clientHeight]);
      save("-layout", layout);
    }
    for (const panel of panels) {
      for (const handle of panel.querySelectorAll(".panel-handle,.resize-handle")) {
        handle.addEventListener("pointerdown", event => {
          if (innerWidth <= 650 || event.button !== 0) return;
          event.preventDefault(); handle.setPointerCapture(event.pointerId);
          const x = event.clientX, y = event.clientY, left = panel.offsetLeft, top = panel.offsetTop, width = panel.offsetWidth, height = panel.offsetHeight;
          const resize = handle.classList.contains("resize-handle");
          const move = e => {
            if (resize) {
              panel.style.width = `${Math.max(180, Math.min(workspace.clientWidth - left, width + e.clientX - x))}px`;
              panel.style.height = `${Math.max(100, Math.min(workspace.clientHeight - top, height + e.clientY - y))}px`;
            } else {
              panel.style.left = `${Math.max(0, Math.min(workspace.clientWidth - width, left + e.clientX - x))}px`;
              panel.style.top = `${Math.max(0, Math.min(workspace.clientHeight - height, top + e.clientY - y))}px`;
            }
            fitPreview();
          };
          const end = () => { handle.removeEventListener("pointermove", move); handle.removeEventListener("pointerup", end); handle.removeEventListener("pointercancel", end); storeLayout(); };
          handle.addEventListener("pointermove", move); handle.addEventListener("pointerup", end); handle.addEventListener("pointercancel", end);
        });
      }
    }
    document.querySelector('[data-action="reset-layout"]').onclick = () => { layout = defaults.map(x => [...x]); save("-layout", layout); apply(); };
    window.addEventListener("resize", apply); apply();
  }
  function initPresenter() {
    document.body.classList.add("presenter");
    document.getElementById("toolbar").remove();
    const shell = document.createElement("section"); shell.className = "presenter-shell";
    const panel = (id, label, body) => `<section class="presenter-panel" id="${id}"><header class="panel-handle"><h3>${label}</h3><i data-lucide="grip"></i></header><div class="panel-body">${body}</div><button class="resize-handle" title="调整面板大小" aria-label="调整面板大小"><i data-lucide="move-diagonal-2"></i></button></section>`;
    shell.innerHTML = `<nav class="presenter-tools" aria-label="讲者控制">${button("prev", "chevron-left", "上一页")}<input id="presenter-page" type="number" min="1" max="${pages.length}" value="1" aria-label="报告页码"><span>/ ${pages.length}</span>${button("next", "chevron-right", "下一页")}<output id="presenter-timer">00:00</output>${button("timer", timer.running ? "pause" : "play", timer.running ? "暂停计时" : "开始计时")}${button("reset-timer", "timer-reset", "重置计时")}${button("reset-layout", "layout-dashboard", "恢复默认布局")}</nav><div class="presenter-workspace">${panel("panel-preview", "当前页", '<div class="preview-wrap" id="presenter-preview"></div>')}${panel("panel-notes", "讲解备注", '<p id="presenter-notes"></p>')}${panel("panel-sources", "来源与限制", '<div class="presenter-sources" id="presenter-sources"></div>')}</div>`;
    document.body.append(shell); workspace = shell.querySelector(".presenter-workspace");
    timerOutput = document.getElementById("presenter-timer");
    initLayout(); updatePanels(); tick(); setInterval(tick, 250);
    post("hello", null); window.lucide?.createIcons();
  }
  document.addEventListener("click", event => {
    const anchor = event.target.closest('a[href^="#"]');
    if (anchor) {
      const destination = document.getElementById(anchor.getAttribute("href").slice(1));
      const reportPage = destination?.closest(".report-page");
      if (reportPage && pages.includes(reportPage)) { event.preventDefault(); go(pages.indexOf(reportPage)); }
    }
    const control = event.target.closest("#toolbar [data-action],.presenter-tools [data-action]");
    const action = control?.dataset.action;
    if (action === "prev") go(current - 1);
    if (action === "next") go(current + 1);
    if (action === "presenter") window.__report.openPresenter();
    if (action === "print") window.print();
    if (action === "full") { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.().catch(() => {}); }
    if (action === "timer") toggleTimer();
    if (action === "reset-timer") toggleTimer(true);
  });
  document.addEventListener("change", event => { if (["page-input", "presenter-page"].includes(event.target.id)) go(Number(event.target.value) - 1); });
  document.addEventListener("keydown", event => {
    if (document.querySelector("dialog[open]")) return;
    if (event.target.closest("input,textarea,button,a,dialog,[contenteditable=true]")) return;
    const moves = { ArrowRight: current + 1, PageDown: current + 1, ArrowLeft: current - 1, PageUp: current - 1, Home: 0, End: pages.length - 1 };
    if (Object.hasOwn(moves, event.key)) { event.preventDefault(); go(moves[event.key]); }
  });
  let scrollFrame = false;
  const scrollSurface = document.body.classList.contains("visual-report") ? document.getElementById("report") : window;
  scrollSurface.addEventListener("scroll", () => {
    if (presenter || scrollFrame || Date.now() < ignoreScrollUntil) return;
    scrollFrame = true;
    requestAnimationFrame(() => { scrollFrame = false; let best = 0, distance = Infinity;
      const top = scrollSurface === window ? 0 : scrollSurface.getBoundingClientRect().top;
      pages.forEach((page, i) => { const d = Math.abs(page.getBoundingClientRect().top - top); if (d < distance) { distance = d; best = i; } });
      if (best !== current) go(best, true, false);
    });
  });
  document.getElementById("page-total").textContent = `/ ${pages.length}`;
  document.getElementById("page-input").max = pages.length;
  function init() { if (presenter) initPresenter(); go(current, false, false); }
  if (window.__reportReady) init(); else document.addEventListener("report-ready", init, { once: true });
  window.addEventListener("beforeunload", () => channel?.close());
})();
