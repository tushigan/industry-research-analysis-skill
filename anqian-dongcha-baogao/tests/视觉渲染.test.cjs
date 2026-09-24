"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { renderReportDocument } = require("../scripts/lib/渲染报告.cjs");
const { validateDocument } = require("../scripts/lib/schema-validator.cjs");
const { inspectPages } = require("../scripts/lib/浏览器检查.cjs");
const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const table = () => ({ columns: ["对象", "条件", "判断"], rows: [
  ["甲方向", "同一观察期", "待验证适用条件"], ["乙方向", "同一观察期", "待验证适用条件"], ["丙方向", "同一观察期", "待验证适用条件"]] });
function fixture() {
  const research = JSON.parse(read("tests/fixtures/基础有效样本/研究数据.json"));
  const report = JSON.parse(read("tests/fixtures/基础有效样本/报告.json"));
  report.presentation_style = "visual";
  Object.assign(report.pages[0], { content_mode: "insight", body: "已有观察只支持比较条件，不支持给方向排序。", table: table(), limitations: "仍需同条件验证。" });
  research.storyline[0].business_meaning = "先核对适用条件，再决定验证顺序。";
  research.storyline[0].limitations = "仍需同条件验证。";
  research.points_of_view[0].boundaries = "仍需同条件验证。";
  return { research, report, fingerprint: "b".repeat(64),
    assets: { echarts: read("assets/依赖/echarts.min.js"), lucide: read("assets/依赖/lucide.min.js") } };
}
const render = input => renderReportDocument(input);
const bodyHTML = html => html.slice(html.indexOf('<main id="report">'), html.indexOf("</main>"));
const mainHTML = html => bodyHTML(html).split('data-page-kind="appendix"')[0];

test("显式开启且仅限横版，Schema 枚举与旧配置兼容", () => {
  const input = fixture(), schema = JSON.parse(read("schemas/报告配置.schema.json"));
  assert.deepEqual(validateDocument(input.report, schema), []);
  for (const layout of ["comparison", "steps", "matrix", "split"]) {
    input.report.pages[0].visual_layout = layout;
    assert.deepEqual(validateDocument(input.report, schema), []);
  }
  input.report.pages[0].visual_layout = "unknown";
  assert.ok(validateDocument(input.report, schema).length);
  delete input.report.pages[0].visual_layout;
  input.report.page_mode = "a4_portrait";
  assert.ok(validateDocument(input.report, schema).length);
  assert.throws(() => render(input), /仅支持横版/);
  delete input.report.presentation_style;
  assert.deepEqual(validateDocument(input.report, schema), []);
  assert.ok(!render(input).html.includes('data-page-kind="main"'));
  input.report.presentation_style = "unknown";
  assert.throws(() => render(input), /presentation_style/);
});

test("三种表格布局实际结构不同，默认按 content_mode，3/4 行均支持", () => {
  const input = fixture(), before = JSON.stringify(input);
  const comparison = mainHTML(render(input).html);
  assert.match(comparison, /<div class="visual-comparison"/);
  assert.match(comparison, /<dt>条件<\/dt><dd>同一观察期<\/dd>/);
  assert.equal(JSON.stringify(input), before);
  input.report.pages[0].content_mode = "method";
  const steps = mainHTML(render(input).html);
  assert.match(steps, /<ol class="visual-steps"/);
  assert.equal([...steps.matchAll(/data-lucide="arrow-right"/g)].length, 2);
  input.report.pages[0].content_mode = "comparison_matrix";
  const matrix = mainHTML(render(input).html);
  assert.match(matrix, /<th scope="row">甲方向<\/th>/);
  assert.match(matrix, /<th scope="col">条件<\/th>/);
  assert.ok(!matrix.includes("visual-column"));
  input.report.pages[0].table.rows.push(["丁方向", "同条件", "待验证"]);
  for (const layout of ["comparison", "steps", "matrix"]) {
    input.report.pages[0].visual_layout = layout;
    assert.equal(render(input).pages.filter(p => p.kind === "main").length, 1);
  }
});

test("多个逻辑页保持一页一判断，简短来源索引与完整底稿分离", () => {
  const input = fixture(); input.report.toc = true;
  input.report.pages.push({ ...input.report.pages[0], page_id: "second-page", visual_layout: "steps" });
  input.research.evidence.find(e => e.evidence_id === "ev-002").evidence_type = "public_document";
  const result = render(input), main = mainHTML(result.html), body = bodyHTML(result.html), notebook = result.notebookHTML;
  assert.equal(result.pages.filter(p => p.kind === "main").length, 2);
  assert.ok(result.pages.some(p => p.kind === "appendix"));
  assert.ok(!main.includes('class="source-text"'));
  assert.ok(!result.titles.some(title => title.includes("（续")));
  const page = result.pages.find(p => p.kind === "main");
  assert.ok(page.sources.length > 1); assert.ok(page.evidence.length > 1);
  for (const [index, s] of page.sources.entries()) {
    assert.equal(notebook.split(`<h3>来源 [${index + 1}] · ${s.source_id}</h3>`).length - 1, 1);
    for (const key of ["collection_date", "scope", "share_restriction"]) assert.ok(notebook.includes(s[key]));
    assert.ok(body.includes(s.title));
  }
  for (const e of page.evidence) {
    assert.equal(notebook.split(`<h3>证据 · ${e.evidence_id}</h3>`).length - 1, 1);
    assert.ok(notebook.includes(e.claim)); assert.ok(notebook.includes(e.limitations));
    assert.ok(!body.includes(`<h3>证据 · ${e.evidence_id}</h3>`));
  }
  assert.match(notebook, /机构公开材料 \(public_document\)/);
  assert.deepEqual(page.sources, result.pages.find(p => p.id === "second-page").sources);
  const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map(x => x[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, href] of body.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(href), `悬空引用 ${href}`);
  assert.ok(ids.includes("source-p0-0") && ids.includes("source-p1-0"));
  for (const [, anchor] of body.matchAll(/href="研究底稿.html#([^"]+)"/g)) assert.ok(notebook.includes(`id="${anchor}"`));
});

test("附录补齐推导上游证据，长 claim 不截断，正文限制不覆盖故事线和观点边界", () => {
  const input = fixture(), story = input.research.storyline[0];
  const original = input.research.evidence.find(e => e.evidence_id === "ev-002");
  input.research.evidence.push({ ...original, evidence_id: "upstream-1", claim: "上游完整事实", limitations: "上游边界" });
  original.input_evidence_ids = ["upstream-1"];
  original.claim = "完整长陈述".repeat(300) + "陈述结尾";
  story.limitations = "故事线边界";
  input.research.points_of_view[0].boundaries = "观点边界";
  const result = render(input), html = result.notebookHTML;
  assert.ok(html.includes("上游完整事实") && html.includes("陈述结尾"));
  const paragraphs = [...html.matchAll(/<p class="evidence-text">([\s\S]*?)<\/p>/g)].map(x => x[1]).join("");
  assert.ok(paragraphs.includes(original.claim));
  for (const text of ["故事线边界", "观点边界", "仍需同条件验证。"]) assert.ok(mainHTML(result.html).includes(text));
});

test("缺字段、非法布局、额外图块与溢出明确失败，不偷偷拆页", () => {
  for (const change of [
    p => { delete p.table; }, p => { p.table.rows = []; }, p => { p.table.rows.pop(); },
    p => { p.table.rows[0].pop(); }, p => { p.table.rows[0][0] = {}; },
    p => { p.body = "超长正文".repeat(1000); }, p => { p.table.rows[0][1] = "超长格".repeat(200); },
    p => { p.visual_layout = "other"; }, p => { p.visual_layout = "split"; },
    p => { p.visual_layout = "matrix"; p.table.rows = Array.from({ length: 80 }, () => ["甲", "乙", "丙"]); },
    p => { p.statistic = { value: 3 }; }, p => { p.image = { alt: "不允许混入" }; },
    p => { p.page_id = "source-visual-0"; }
  ]) {
    const input = fixture(); change(input.report.pages[0]); assert.throws(() => render(input));
  }
  const input = fixture(); input.report.pages[0].content_mode = "method"; delete input.assets.lucide;
  assert.throws(() => render(input), /lucide/);
});

test("split 图文两栏沿用图表和图片安全校验，HTML 和 JSON 转义", () => {
  const input = fixture(), page = input.report.pages[0];
  delete page.table; page.content_mode = "chart";
  page.chart = { type: "bar", labels: ["商品"], values: [19.9], unit: "CNY/件", evidence_ids: ["ev-002"] };
  assert.match(mainHTML(render(input).html), /class="visual-split"/);
  page.visual_layout = "split"; delete page.chart;
  page.image = { alt: "观察图", data_uri: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" };
  assert.match(mainHTML(render(input).html), /class="visual-media"/);
  page.image.data_uri = "javascript:alert(1)";
  assert.throws(() => render(input), /data_uri/);
  const escaped = fixture(), payload = '<img src=x onerror="alert(1)">';
  escaped.report.pages[0].table.rows[0][0] = payload;
  escaped.report.pages[0].speaker_notes = "</script>";
  escaped.research.sources.forEach(s => { s.original_url_or_file = "javascript:alert(1)"; });
  const html = render(escaped).html;
  assert.ok(!html.includes(payload)); assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes('href="javascript:'));
  assert.equal(JSON.parse(html.match(/id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]).pages[0].notes, "</script>");
});

test("旧模式保持续页及 A4，不启用视觉样式；机构材料正确显示", () => {
  const input = fixture(); delete input.report.presentation_style;
  input.report.pages[0].visual_layout = "steps";
  input.report.pages[0].body = "旧版完整正文".repeat(300);
  input.research.evidence.find(e => e.evidence_id === "ev-002").evidence_type = "public_document";
  for (const mode of ["landscape_16_9", "a4_portrait"]) {
    input.report.page_mode = mode; const result = render(input);
    assert.ok(result.titles.some(t => t.includes("（续")));
    assert.ok(!result.html.includes(".visual-report"));
    assert.ok(!result.pages.some(p => p.kind));
    assert.ok(bodyHTML(result.html).includes("机构公开材料"));
  }
});

test("浏览器四布局、来源跳转、讲者、移动纵排和 PDF 内外链接", { timeout: 90000 }, async t => {
  let chromium;
  try { ({ chromium } = require(require.resolve("playwright", { paths: [process.env.ANQIAN_NODE_MODULES || root] }))); }
  catch { t.skip("需要 ANQIAN_NODE_MODULES 指向 Playwright 运行时"); return; }
  const input = fixture(), base = input.report.pages[0];
  input.report.pages = ["comparison", "steps", "matrix", "split"].map((layout, i) => ({ ...base, page_id: `visual-${i}`, visual_layout: layout }));
  delete input.report.pages[3].table;
  input.report.pages[3].chart = { type: "bar", labels: ["商品"], values: [19.9], unit: "CNY/件", evidence_ids: ["ev-002"] };
  const result = render(input), browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, offline: true });
    const errors = []; const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    await page.route("https://visual.test/report", route => route.fulfill({ contentType: "text/html", body: result.html }));
    await page.goto("https://visual.test/report"); await page.waitForFunction(() => window.__reportReady);
    assert.deepEqual((await inspectPages(page)).issues, []);
    await page.locator('#toolbar').evaluate(el => { el.style.position = 'fixed'; el.style.top = '100px'; });
    assert.ok((await inspectPages(page)).issues.some(issue => /工具栏遮挡/.test(issue)));
    await page.locator('#toolbar').evaluate(el => { el.style.position = ''; el.style.top = ''; });
    for (const selector of ['.visual-steps svg', '.chart svg', '.visual-steps svg path', '.chart svg path', '.chart svg text']) {
      await page.locator(selector).first().evaluate(el => { el.style.transform = 'translateX(-1200px)'; });
      assert.ok((await inspectPages(page)).issues.some(issue => /图形越界/.test(issue)), selector);
      await page.locator(selector).first().evaluate(el => { el.style.transform = ''; });
    }
    assert.deepEqual((await inspectPages(page)).issues, []);
    assert.equal(await page.locator('.visual-steps svg[data-lucide="arrow-right"]').count(), 2);
    assert.ok(await page.locator(".chart svg path").count() > 0);
    const screenshot = await page.locator('[data-page-kind="main"]').first().screenshot();
    assert.ok(screenshot.length > 10000);
    if (process.env.VISUAL_SCREENSHOT) fs.writeFileSync(process.env.VISUAL_SCREENSHOT, screenshot);
    await page.locator('[data-page-kind="main"] .page-footer a').first().click();
    assert.ok(await page.evaluate(() => window.__report.currentPage > 4));
    await page.evaluate(() => window.__report.goToPage(2));
    const popupPromise = page.waitForEvent("popup");
    await context.route("https://visual.test/report", route => route.fulfill({ contentType: "text/html", body: result.html }));
    await page.getByTitle("讲者台", { exact: true }).click(); const popup = await popupPromise;
    await popup.waitForSelector("#presenter-notes");
    assert.ok(await popup.locator("#presenter-sources").textContent());
    for (const width of [1280, 390]) {
      await popup.setViewportSize({ width, height: 850 });
      assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await popup.close();
    for (const width of [375, 650, 900]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual((await inspectPages(page)).issues, [], `移动视口 ${width}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width <= 650) assert.equal(await page.locator(".visual-comparison").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 1);
    }
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const report = document.getElementById('report'), target = document.querySelector('[data-page-id="visual-2"]');
      report.scrollTop += target.getBoundingClientRect().top - report.getBoundingClientRect().top;
    });
    await page.waitForFunction(() => window.__report.currentPage === 3);
    await page.emulateMedia({ media: "print" }); assert.deepEqual((await inspectPages(page)).issues, []);
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const checked = spawnSync(process.env.ANQIAN_PYTHON || "python3", ["-c",
      "import fitz,sys,json;d=fitz.open(stream=sys.stdin.buffer.read(),filetype='pdf');print(json.dumps({'pages':len(d),'links':[l for p in d for l in p.get_links()],'text': ''.join(p.get_text() for p in d)},default=str))"], { input: pdf, maxBuffer: 8 * 1024 * 1024 });
    assert.equal(checked.status, 0, checked.stderr?.toString());
    const data = JSON.parse(checked.stdout);
    assert.equal(data.pages, result.pageCount);
    assert.ok(data.links.some(l => [1, 4].includes(l.kind) && l.page >= 4));
    assert.ok(data.links.filter(l => [1, 4].includes(l.kind)).every(l => l.page >= 0 && l.page < result.pageCount));
    assert.ok(data.links.some(l => l.kind === 2 && /^https?:/.test(l.uri)));
    assert.ok(data.text.includes("来源索引")); assert.ok(!data.text.includes("完整陈述")); assert.deepEqual(errors, []);
    const longLabel = fixture();
    delete longLabel.report.pages[0].table;
    Object.assign(longLabel.report.pages[0], { content_mode: 'chart', visual_layout: 'split',
      chart: { type: 'pie', labels: ['长'.repeat(80)], values: [19.9], unit: 'CNY', evidence_ids: ['ev-002'] } });
    const checkedInput = require('../scripts/验证研究数据.cjs').validateResearch(longLabel.research, longLabel.report);
    assert.equal(checkedInput.counts.fatal, 0, JSON.stringify(checkedInput));
    await page.emulateMedia({ media: 'screen' });
    await page.route('https://visual.test/long-label', route => route.fulfill({ contentType: 'text/html', body: render(longLabel).html }));
    await page.goto('https://visual.test/long-label');
    await page.waitForFunction(() => window.__reportReady);
    assert.ok((await inspectPages(page)).issues.some(issue => /图形越界：text/.test(issue)), '合法长图例不能静默裁切');
  } finally { await browser.close(); }
});
