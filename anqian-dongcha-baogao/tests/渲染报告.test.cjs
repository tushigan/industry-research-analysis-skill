"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { renderReport, renderReportDocument } = require("../scripts/lib/渲染报告.cjs");
const { validateChart, chartOption } = require("../scripts/lib/图表安全.cjs");
const { validateDocument } = require("../scripts/lib/schema-validator.cjs");
const { contextFor } = require("../scripts/lib/渲染内容.cjs");
const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const fixture = () => ({ research: JSON.parse(read("tests/fixtures/基础有效样本/研究数据.json")),
  report: JSON.parse(read("tests/fixtures/基础有效样本/报告.json")), fingerprint: "a".repeat(64),
  assets: { echarts: read("assets/依赖/echarts.min.js"), lucide: read("assets/依赖/lucide.min.js") }, attachments: [] });
const chart = () => ({ type: "bar", labels: ["甲", "乙", "丙"], values: [20, 30, 50], unit: "%", evidence_ids: ["ev-001"] });
const metadata = html => JSON.parse(html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);

async function assertPreviewContained(surface) {
  const geometry = await surface.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const wrap = document.getElementById("presenter-preview").getBoundingClientRect();
    const clone = document.querySelector("#presenter-preview .preview-page").getBoundingClientRect();
    return { wrap: wrap.toJSON(), clone: clone.toJSON(), viewport: innerWidth,
      contained: clone.width > 0 && clone.height > 0 && clone.left >= wrap.left - 1 && clone.top >= wrap.top - 1 &&
        clone.right <= wrap.right + 1 && clone.bottom <= wrap.bottom + 1 };
  });
  assert.ok(geometry.contained, `预览页被裁切：${JSON.stringify(geometry)}`);
}

test("观点性质按五种 claim_type 展示，草稿只加状态不改类型", () => {
  const input = fixture(), page = input.report.pages[0], point = input.research.points_of_view[0];
  const names = { fact: "外部事实", client_statement: "客户陈述", judgment: "研究判断", hypothesis: "工作假设", recommendation: "建议" };
  input.research.storyline[0].page_status = "formal_delivery";
  for (const [type, name] of Object.entries(names)) {
    point.claim_type = type;
    for (const status of ["draft", "client_ready"]) {
      point.status = status;
      const expected = name + (status === "draft" ? "（草稿）" : "");
      assert.equal(contextFor(page, input.research).nature, expected);
      assert.ok(renderReport(input).includes(`<span class="nature">${expected}</span>`));
    }
  }
  point.claim_type = "judgment"; input.research.storyline[0].page_status = "research_stage";
  assert.equal(contextFor(page, input.research).nature, "研究判断（草稿）");
  delete point.claim_type;
  assert.equal(contextFor(page, input.research).nature, "研究判断（草稿）");
  page.fact_nature = "recommendation";
  assert.equal(contextFor(page, input.research).nature, "建议（草稿）");
});

test("图表白名单拒绝脚本、函数、外部图像、非有限数和不匹配数组", () => {
  assert.deepEqual(validateChart(chart()), []);
  for (const mutation of [c => { c.formatter = () => "x"; }, c => { c.image = "https://example.com/x.png"; },
    c => { c.values[0] = "20"; }, c => { c.values[0] = Infinity; }, c => { c.values = [1]; },
    c => { c.labels[0] = () => 1; }, c => { c.evidence_ids = []; }, c => { c.unit = ""; }]) {
    const c = chart(); mutation(c); const issues = validateChart(c);
    assert.ok(issues.some(i => i.severity === "fatal"));
    assert.ok(issues.every(i => i.path && i.message && i.fix));
  }
  assert.ok(validateChart(null).length);
  assert.ok(validateChart({ ...chart(), type: "pie", values: [-1, 50, 51] }).length);
  assert.ok(validateChart({ ...chart(), type: "pie", values: [0, 0, 0] }).length);
  assert.ok(validateChart({ ...chart(), type: "pie", values: [20, 20, 20] }).length);
  assert.deepEqual(validateChart({ ...chart(), values: [-20, 30, 50] }), []);
  assert.equal(chartOption(chart()).yAxis.scale, false);
});

test("Schema 声明正文、图表、表格、大数字和附件元数据，原始图像不接收 data_uri", () => {
  const { report } = fixture(); const p = report.pages[0];
  p.body = ["正文"]; p.chart = chart(); p.table = { columns: ["品牌", "数值"], rows: [["甲", 20]] };
  p.image = { path: "product.png", alt: "商品" };
  p.statistic = { value: 20, unit: "%", label: "调查占比", evidence_ids: ["ev-001"], sample_size: 120 };
  p.fact_nature = "research_judgment"; p.sourceNote = "推导依据";
  report.attachments = [{ attachment_id: "att-1", path: "source.pdf", title: "获准材料", page_count: 3,
    referenced_pages: [1, 3], format: "pdf", share_approved: true, share_basis: "自制", source_id: "src-001" }];
  const schema = JSON.parse(read("schemas/报告配置.schema.json"));
  assert.deepEqual(validateDocument(report, schema), []);
  p.image.data_uri = "unsafe";
  assert.ok(validateDocument(report, schema).some(i => i.path.endsWith("data_uri")));
  delete p.image.data_uri; delete report.attachments[0].page_count;
  assert.ok(validateDocument(report, schema).some(i => i.path.endsWith("page_count")));
});

test("渲染静态实体页、保留来源和限制、不改输入、不依赖附件脚本", () => {
  const input = fixture(); const before = JSON.stringify(input);
  input.assets.attachmentScript = "FORBIDDEN_READER_INJECTION";
  const html = renderReport(input); const data = metadata(html);
  assert.equal(data.pageCount, [...html.matchAll(/class="report-page"/g)].length);
  assert.equal(data.fingerprint, input.fingerprint);
  assert.deepEqual(renderReportDocument(input).pages, data.pages);
  let callbackData; renderReport({ ...input, onRendered: value => { callbackData = value; } });
  assert.deepEqual(callbackData, data);
  for (const s of input.research.sources.filter(x => input.report.pages[0].source_ids.includes(x.source_id))) {
    assert.ok(html.includes(s.collection_date)); assert.ok(html.includes(s.scope));
  }
  assert.ok(html.includes('<span class="nature">研究判断（草稿）</span>')); assert.ok(html.includes("内部研究阶段稿"));
  assert.ok(html.includes("不能推出持续趋势"));
  assert.ok(!html.includes("FORBIDDEN_READER_INJECTION"));
  delete input.assets.attachmentScript; assert.equal(JSON.stringify(input), before);
  assert.equal(html, renderReport(input));
});

test("客户模式不把内部研究状态印到最终页面", () => {
  const input = fixture();
  input.report.audience_mode = "client";
  const html = renderReport(input);
  assert.match(html, /<span>匿名食品研究技术样本 · 研究报告<\/span>/);
  assert.match(html, /<span class="nature">研究判断<\/span>/);
  assert.doesNotMatch(html, /<span>匿名食品研究技术样本 · 内部研究阶段稿/);
  assert.doesNotMatch(html, /<span class="nature">研究判断（草稿）<\/span>/);
  assert.doesNotMatch(html, /<span class="fingerprint">/);
  assert.match(html, new RegExp(`<meta name="report-fingerprint" content="${input.fingerprint}">`));
  assert.equal(metadata(html).fingerprint, input.fingerprint);
});

test("内部模式保留页面可见指纹供审计", () => {
  const input = fixture();
  const html = renderReport(input);
  assert.match(html, new RegExp(`<span class="fingerprint">${input.fingerprint}<\\/span>`));
});

test("文本与 JSON 转义、非法链接降级、图片预处理和引用拒绝", () => {
  const input = fixture(); const payload = '</script><img src=x onerror="window.pwned=1">';
  input.report.pages[0].body = payload; input.report.pages[0].speaker_notes = payload;
  input.research.sources[1].original_url_or_file = "javascript:alert(1)";
  const html = renderReport(input);
  assert.ok(!html.includes(payload)); assert.ok(html.includes("&lt;/script&gt;"));
  assert.ok(!html.includes('href="javascript:'));
  assert.equal(metadata(html).pages[0].notes, payload);
  input.report.pages[0].image = { path: "missing.png", alt: "待处理" };
  assert.throws(() => renderReport(input), /data_uri/);
  input.report.pages[0].image.data_uri = "data:image/svg+xml;base64,PHN2Zz4=";
  assert.throws(() => renderReport(input), /data_uri/);
  delete input.report.pages[0].image; input.report.pages[0].chart = { ...chart(), evidence_ids: ["missing"] };
  assert.throws(() => renderReport(input), /缺失证据/);
});

test("长表稳定拆页重复表头、目录指向实际物理页、正文无丢失", () => {
  const input = fixture(); input.report.page_mode = "a4_portrait";
  input.report.pages[0].table = { columns: ["编号", "说明"], rows: Array.from({ length: 100 }, (_, i) => [`row-${i}`, "同条件观察"]) };
  const html = renderReport(input), data = metadata(html);
  assert.ok(data.pageCount > 5); assert.equal(data.titles[0], "目录");
  assert.ok([...html.matchAll(/<thead>/g)].length >= 5);
  assert.ok(html.includes('data-report-page="2"'));
  for (let i = 0; i < 100; i++) assert.equal([...html.matchAll(new RegExp(`<td>row-${i}</td>`, "g"))].length, 1);
  assert.equal(html, renderReport(input));
  input.report.pages[0].table.rows[0][1] = "长".repeat(5000);
  assert.throws(() => renderReport(input), /单行超出/);
});

test("附件只输出阅读器按钮协议，数据和阅读器由构建器注入", () => {
  const input = fixture(); input.attachments = [{ attachment_id: "att-1", title: "自制资料", page_count: 3, referenced_pages: [1, 3], data_base64: "PRIVATE_BASE64" }];
  const html = renderReport(input);
  assert.ok(html.includes('data-attachment-id="att-1" data-attachment-page="3"'));
  assert.ok(!html.includes("PRIVATE_BASE64")); assert.ok(!html.includes('id="attachment-data"'));
});

test("单证据图表页含正文、经营含义、限制和来源仍为一个横版实体页", () => {
  const input = fixture(); input.research.storyline[0].evidence_ids = ["ev-002"];
  input.research.storyline[0].source_ids = ["src-002"]; input.report.pages[0].source_ids = ["src-002"];
  input.report.pages[0].chart = { type: "bar", labels: ["匿名商品"], values: [19.9], unit: "CNY/件", evidence_ids: ["ev-002"] };
  assert.equal(renderReportDocument(input).pageCount, 1);
});

test("浏览器离线 SVG、双向讲者、计时布局恢复、移动和打印", { timeout: 90000 }, async t => {
  let chromium;
  try { ({ chromium } = require(require.resolve("playwright", { paths: [process.env.ANQIAN_NODE_MODULES || root] }))); }
  catch { t.skip("需要 ANQIAN_NODE_MODULES 指向含 Playwright 的运行时"); return; }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "anqian-render-"));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, offline: true });
  const errors = []; context.on("page", p => p.on("pageerror", e => errors.push(e.message)));
  try {
    const input = fixture(); const base = input.report.pages[0];
    base.source_ids = ["src-001"]; input.research.storyline[0].source_ids = ["src-001"];
    input.research.storyline[0].evidence_ids = ["ev-001"];
    input.report.pages = Array.from({ length: 6 }, (_, i) => ({ ...base, page_id: `test-${i}`, title: `技术检查 ${i + 1}：保留观察条件`,
      body: "仅作匿名技术回归，不代表当前市场事实。", ...(i < 3 ? { chart: { ...chart(), type: ["bar", "line", "pie"][i] } } : {}) }));
    const output = path.join(temporary, "报告.html"); fs.writeFileSync(output, renderReport(input));
    const page = await context.newPage(); await page.goto(pathToFileURL(output).href);
    await page.waitForFunction(() => window.__reportReady === true);
    await page.evaluate(() => { const button = document.createElement("button"); button.id = "reader-next"; button.dataset.action = "next"; button.textContent = "attachment"; document.body.append(button); });
    await page.locator("#reader-next").evaluate(b => b.click()); assert.equal(await page.evaluate(() => window.__report.currentPage), 1);
    await page.locator("#reader-next").evaluate(b => b.remove());
    assert.equal(await page.locator(".chart svg").count(), 3);
    assert.ok(await page.locator(".chart svg path").count() > 6);
    assert.equal(await page.locator(".report-page").count(), await page.evaluate(() => window.__report.pageCount));
    assert.equal(await page.locator(".report-page").count(), 6);
    const overflow = () => [...document.querySelectorAll("#report > .report-page")].filter(p => {
      const content = p.querySelector(".page-content"); return content.scrollHeight > content.clientHeight + 2 || p.scrollWidth > p.clientWidth + 2;
    }).map(p => p.dataset.pageId);
    assert.deepEqual(await page.evaluate(overflow), []);
    const first = await page.locator(".report-page").first().boundingBox(); assert.ok(Math.abs(first.width / first.height - 16 / 9) < .001);
    if (process.env.RENDER_ARTIFACT_DIR) { fs.mkdirSync(process.env.RENDER_ARTIFACT_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.RENDER_ARTIFACT_DIR, "横版.png") }); }
    const popupPromise = page.waitForEvent("popup"); await page.getByTitle("讲者台", { exact: true }).click(); const popup = await popupPromise;
    await popup.waitForSelector("#presenter-notes");
    await popup.getByTitle("下一页", { exact: true }).click();
    await page.waitForFunction(() => window.__report.currentPage === 2);
    await page.evaluate(() => window.__report.goToPage(3));
    await popup.waitForFunction(() => window.__report.currentPage === 3);
    assert.equal(await popup.locator("#presenter-page").inputValue(), "3");
    assert.ok(await popup.locator("#presenter-sources").textContent());
    assert.ok(await popup.locator("#presenter-preview .preview-page").count());
    await popup.getByTitle("开始计时", { exact: true }).click(); await popup.waitForTimeout(1100);
    await popup.getByTitle("暂停计时", { exact: true }).click(); const time = await popup.locator("#presenter-timer").textContent();
    assert.notEqual(time, "00:00"); await popup.waitForTimeout(350); assert.equal(await popup.locator("#presenter-timer").textContent(), time);
    await popup.getByTitle("重置计时", { exact: true }).click(); assert.equal(await popup.locator("#presenter-timer").textContent(), "00:00");
    const handle = await popup.locator("#panel-notes .panel-handle").boundingBox();
    await popup.mouse.move(handle.x + 40, handle.y + 15); await popup.mouse.down(); await popup.mouse.move(handle.x - 30, handle.y + 55); await popup.mouse.up();
    const left = await popup.locator("#panel-notes").evaluate(p => p.style.left);
    await popup.reload(); await popup.waitForSelector("#presenter-notes");
    assert.equal(await popup.locator("#panel-notes").evaluate(p => p.style.left), left);
    await popup.getByTitle("恢复默认布局", { exact: true }).click();
    assert.notEqual(await popup.locator("#panel-notes").evaluate(p => p.style.left), left);
    if (process.env.RENDER_ARTIFACT_DIR) await popup.screenshot({ path: path.join(process.env.RENDER_ARTIFACT_DIR, "讲者台.png") });
    const savedLayout = await popup.evaluate(() => localStorage.getItem(`anqian-report-${window.__report.fingerprint}-layout`));
    for (const width of [1280, 390, 375, 520, 1280]) {
      await popup.setViewportSize({ width, height: 850 });
      await assertPreviewContained(popup);
      assert.ok(await popup.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (width === 390 && process.env.RENDER_ARTIFACT_DIR) await popup.screenshot({ path: path.join(process.env.RENDER_ARTIFACT_DIR, "讲者台-手机修复.png"), fullPage: true });
    }
    assert.equal(await popup.evaluate(() => localStorage.getItem(`anqian-report-${window.__report.fingerprint}-layout`)), savedLayout);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.evaluate(() => window.__report.goToPage(1));
    await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
    const mobileOverflow = await page.evaluate(() => ({
      viewport: innerWidth,
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      offenders: [...document.querySelectorAll("body *")].map(node => {
        const box = node.getBoundingClientRect();
        return { tag: node.tagName, id: node.id, className: typeof node.className === "string" ? node.className : "",
          left: box.left, right: box.right, width: box.width, scrollWidth: node.scrollWidth };
      }).filter(item => item.left < -1 || item.right > innerWidth + 1).slice(0, 10)
    }));
    assert.ok(mobileOverflow.html <= mobileOverflow.viewport, `移动页面横向溢出：${JSON.stringify(mobileOverflow)}`);
    if (process.env.RENDER_ARTIFACT_DIR) await page.screenshot({ path: path.join(process.env.RENDER_ARTIFACT_DIR, "移动.png") });
    await page.emulateMedia({ media: "print" });
    assert.equal(await page.locator("#toolbar").isVisible(), false);
    assert.equal(await page.locator(".report-page:visible").count(), await page.locator(".report-page").count());
    await popup.close();
    input.report.page_mode = "a4_portrait"; input.report.report_type = "long_report";
    input.report.pages = Array.from({ length: 20 }, (_, i) => ({ ...base, page_id: `long-${i}`, title: `章节 ${i + 1}：同条件技术观察`, ...(i === 0 ? { chart: chart() } : {}) }));
    input.report.pages[1].table = { columns: ["序号", "渠道", "观察条件"], rows: Array.from({ length: 80 }, (_, i) => [i + 1, "匿名渠道", "相同规格、优惠资格、地区和采集时间"]) };
    fs.writeFileSync(output, renderReport(input)); await page.setViewportSize({ width: 1100, height: 900 }); await page.emulateMedia({ media: "screen" }); await page.reload();
    await page.waitForFunction(() => window.__reportReady === true);
    assert.ok(await page.locator(".report-page").count() >= 20); assert.deepEqual(await page.evaluate(overflow), []);
    const links = await page.locator(".toc-list a").evaluateAll(nodes => nodes.map(a => ({ number: Number(a.dataset.reportPage), target: a.hash.slice(1) })));
    const ids = await page.locator("#report > .report-page").evaluateAll(nodes => nodes.map(n => n.id));
    for (const link of links) assert.equal(ids[link.number - 1], link.target);
    await page.evaluate(() => window.__report.goToPage(1));
    if (process.env.RENDER_ARTIFACT_DIR) await page.screenshot({ path: path.join(process.env.RENDER_ARTIFACT_DIR, "长报告.png") });
    const longPopupPromise = page.waitForEvent("popup"); await page.getByTitle("讲者台", { exact: true }).click(); const longPopup = await longPopupPromise;
    await longPopup.waitForSelector("#presenter-notes");
    for (const width of [1280, 390, 1280]) {
      await longPopup.setViewportSize({ width, height: 850 }); await assertPreviewContained(longPopup);
    }
    await longPopup.close();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); fs.rmSync(temporary, { recursive: true, force: true }); }
});
