const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { dependency } = require('./运行依赖.cjs');

async function withReport(root, work) {
  const { chromium } = dependency('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, offline: true });
    const errors = [], network = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route(/^https?:/, route => { network.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    await page.goto(pathToFileURL(path.join(root, '案前洞察.html')).href);
    await page.waitForFunction(() => window.__reportReady === true || Boolean(document.querySelector('#report-error')?.textContent), null, { timeout: 30000 });
    const renderError = await page.locator('#report-error').textContent();
    if (renderError || errors.length) throw new Error(`页面初始化失败：${[renderError, ...errors].filter(Boolean).join('；')}`);
    await page.evaluate(() => document.fonts.ready);
    return await work({ browser, context, page, errors, network });
  } finally { await browser.close(); }
}
async function inspectPages(page) {
  return page.evaluate(() => {
    const issues = [], pages = Array.from(document.querySelectorAll('.report-page'));
    const toolbar = document.getElementById('toolbar');
    if (document.body.classList.contains('visual-report') && toolbar && getComputedStyle(toolbar).display !== 'none') {
      const control = toolbar.getBoundingClientRect(), report = document.getElementById('report').getBoundingClientRect();
      if (control.bottom > report.top + 1 && control.top < report.bottom - 1 && control.right > report.left && control.left < report.right) {
        issues.push('翻页工具栏遮挡报告阅读区域');
      }
    }
    const details = pages.map((el, index) => {
      const box = el.getBoundingClientRect();
      const heading = el.querySelector('h1,h2');
      if (!heading?.textContent.trim() || !box.width || !box.height) issues.push(`第${index + 1}页空白或无标题`);
      if (el.scrollHeight > el.clientHeight + 3 || el.scrollWidth > el.clientWidth + 3) issues.push(`第${index + 1}页容器溢出`);
      const content = el.querySelector('.page-content');
      const bodyBox = content.getBoundingClientRect();
      const bodyBounds = [(bodyBox.left - box.left) / box.width, (bodyBox.top - box.top) / box.height,
        (bodyBox.right - box.left) / box.width, (bodyBox.bottom - box.top) / box.height];
      if (content.scrollHeight > content.clientHeight + 3 || content.scrollWidth > content.clientWidth + 3) issues.push(`第${index + 1}页正文容器溢出`);
      const footer = el.querySelector('.page-footer').getBoundingClientRect();
      for (const child of content.children) {
        if (child.getBoundingClientRect().bottom > footer.top + 2) issues.push(`第${index + 1}页正文遮挡页脚`);
      }
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (!text.textContent.trim() || text.parentElement.closest('script,style,svg,[hidden]')) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          if (rect.left < box.left - 2 || rect.right > box.right + 2 || rect.top < box.top - 2 || rect.bottom > box.bottom + 2) {
            issues.push(`第${index + 1}页文字越界：${text.textContent.slice(0, 24)}`); break;
          }
        }
      }
      const charts = Array.from(el.querySelectorAll('.chart'));
      for (const graphic of content.querySelectorAll('svg,img,canvas,svg path,svg text,svg rect,svg line,svg polyline,svg polygon,svg circle,svg ellipse,svg image,svg use')) {
        if (graphic.closest('defs,clipPath,mask,symbol,[hidden]')) continue;
        const style = getComputedStyle(graphic);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
        const rect = graphic.getBoundingClientRect();
        if (!rect.width && !rect.height) {
          if (graphic.matches('img,canvas') || graphic.closest('.chart')) issues.push(`第${index + 1}页图形不可见`);
          continue;
        }
        const host = graphic.closest('.chart')?.getBoundingClientRect() || bodyBox;
        const bounds = [box, bodyBox, host];
        if (graphic.ownerSVGElement) bounds.push(graphic.ownerSVGElement.getBoundingClientRect());
        if (bounds.some(bound => rect.left < bound.left - 3 || rect.right > bound.right + 3 || rect.top < bound.top - 3 || rect.bottom > bound.bottom + 3)) {
          issues.push(`第${index + 1}页图形越界：${graphic.tagName.toLowerCase()}`);
        }
      }
      const kind = el.dataset.pageKind || 'legacy';
      if (kind === 'main') {
        const body = content.cloneNode(true);
        body.querySelectorAll('.sources,.source-note,.source-text,.evidence-list,.evidence-card,.evidence-text,.appendix-record,script,style').forEach(node => node.remove());
        if (!body.textContent.trim() && !body.querySelector('img,.chart')) issues.push(`第${index + 1}页正文为空或仅有出处`);
      }
      for (const chart of charts) if (!chart.querySelector('svg path,svg rect,svg polyline')) issues.push(`第${index + 1}页图表为空`);
      for (const img of el.querySelectorAll('img')) if (!img.complete || !img.naturalWidth) issues.push(`第${index + 1}页图片未加载`);
      const links = Array.from(el.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).filter(h => /^https?:/.test(h));
      const referenceDestinations = Array.from(el.querySelectorAll('a[href^="#"]')).map(a => {
        const target = document.getElementById(a.getAttribute('href').slice(1));
        const destination = pages.indexOf(target?.closest('.report-page')) + 1;
        if (destination < 1) issues.push(`第${index + 1}页内部引用缺少目标：${a.getAttribute('href')}`);
        return destination;
      }).filter(destination => destination > 0);
      const destinations = Array.from(el.querySelectorAll('.toc-list a')).map(a => {
        const target = document.getElementById(a.getAttribute('href').slice(1));
        const destination = pages.indexOf(target) + 1;
        if (destination < 1 || Number(a.querySelector('b')?.textContent) !== destination) issues.push('目录页码与实际页面不一致');
        return destination;
      });
      return { page: index + 1, id: el.dataset.pageId, title: heading?.textContent.trim(),
        width: box.width, height: box.height, kind, bodyBounds, charts: charts.length, links, destinations, referenceDestinations,
        tableHeaders: Array.from(el.querySelectorAll('thead th')).map(th => th.textContent) };
    });
    return { pages: details, issues: [...new Set(issues)], fingerprint: window.__report.fingerprint };
  });
}
async function screenshots(page, folder, prefix) {
  fs.mkdirSync(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, `${prefix}界面.png`) });
  const style = await page.addStyleTag({ content: '#toolbar{visibility:hidden!important}body.visual-report:not(.presenter){display:block!important;height:auto!important;overflow:visible!important}.visual-report #report{height:auto!important;overflow:visible!important}' });
  try {
    const pages = page.locator('.report-page');
    for (let i = 0; i < await pages.count(); i++) {
      await pages.nth(i).screenshot({ path: path.join(folder, `${prefix}-${String(i + 1).padStart(2, '0')}.png`) });
    }
  } finally { await style.evaluate(node => node.remove()); }
}
module.exports = { withReport, inspectPages, screenshots };
