"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderReportDocument } = require("../scripts/lib/渲染报告.cjs");
const { validateDocument } = require("../scripts/lib/schema-validator.cjs");
const { inspectPages } = require("../scripts/lib/浏览器检查.cjs");

const root = path.resolve(__dirname, "..");
const readJSON = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const diagrams = [
  {
    type: "diagram",
    variant: "relationship-map",
    title: "事实、判断与验证条件必须分开",
    columns: [
      { title: "材料事实", nodes: [{ id: "fact", label: "企业动作", detail: "只说明企业已经做过什么" }] },
      { title: "研究判断", nodes: [{ id: "judgment", label: "形成候选", detail: "用于提出方向，不代表方向已成立" }] },
      { title: "验证条件", nodes: [{ id: "test", label: "同条件测试", detail: "用样品、渠道和复购验证" }] }
    ],
    edges: [
      { from: "fact", to: "judgment", kind: "inference" },
      { from: "judgment", to: "test", kind: "condition" }
    ]
  },
  {
    type: "diagram",
    variant: "categorical-matrix",
    title: "候选方向按真实条件交叉比较",
    columns: ["日常频次", "供应适配", "渠道适配"],
    rows: [
      { label: "鲜软主食", detail: "企业动作可观察，购买理由仍待验证", cells: ["observed", "proposed", "unknown"] },
      { label: "全谷物", detail: "政策和标签有边界，口感与复购待验证", cells: ["proposed", "unknown", "unknown"] },
      { label: "单餐早餐", detail: "一人份线索存在，渠道效率待验证", cells: ["proposed", "unknown", "observed"] }
    ],
    legend: "proposed"
  },
  {
    type: "diagram",
    variant: "control-chain",
    title: "扩大渠道前先守住上一阶段",
    columns: ["环节", "控制动作", "守住的结果", "失控后果"],
    rows: [
      ["样品", "同配方盲测", "口感差异可感知", "概念成立但产品不成立"],
      ["试销", "同店同周期比较", "动销与损耗可解释", "销量被促销或门店差异误导"],
      ["扩店", "复购和退货复盘", "扩大后仍有经营价值", "铺货放大损耗与退货"]
    ]
  },
  {
    type: "diagram",
    variant: "steps",
    title: "先核条件，再决定是否继续",
    columns: ["步骤", "核查动作", "进入下一步的条件"],
    rows: [
      ["客户约束", "核对产线、保质期和渠道", "能力与方向没有硬冲突"],
      ["样品比较", "同条件比较感官和标签", "差异可感知且表达合规"],
      ["小范围试销", "记录动销、复购与损耗", "经营指标达到事先阈值"]
    ]
  }
];

function fixture() {
  const research = readJSON("tests/fixtures/基础有效样本/研究数据.json");
  const report = readJSON("tests/fixtures/基础有效样本/报告.json");
  research.storyline[0].business_meaning = "用于安排验证顺序。";
  research.storyline[0].limitations = "匿名技术样本。";
  research.points_of_view[0].boundaries = "匿名技术样本。";
  report.presentation_style = "visual";
  report.pages = diagrams.map((diagram, index) => ({
    ...report.pages[0],
    page_id: `diagram-${index + 1}`,
    title: diagram.title,
    content_mode: "comparison_matrix",
    visual_layout: "diagram",
    body: "图形承担主要阅读。",
    limitations: "匿名技术样本。",
    diagram: structuredClone(diagram)
  }));
  return {
    research,
    report,
    fingerprint: "d".repeat(64),
    assets: {
      echarts: read("assets/依赖/echarts.min.js"),
      lucide: read("assets/依赖/lucide.min.js")
    }
  };
}

test("Schema 和结构化渲染接受四类真实关系图", () => {
  const input = fixture();
  const schema = readJSON("schemas/报告配置.schema.json");
  assert.deepEqual(validateDocument(input.report, schema), []);
  const rendered = renderReportDocument(input);
  for (const diagram of diagrams) {
    assert.match(rendered.html, new RegExp(`data-diagram="${diagram.variant}"`));
  }
  assert.match(rendered.html, /\.diagram\{min-width/);
  assert.equal(rendered.pages.filter(page => page.kind === "main").length, diagrams.length);
});

test("图形页禁止混入表格、图表或额外字段", () => {
  for (const change of [
    page => { page.table = { columns: ["对象"], rows: [["甲"]] }; },
    page => { page.chart = { type: "bar", labels: ["甲"], values: [1], unit: "个", evidence_ids: ["ev-002"] }; },
    page => { page.diagram.extra = "不能绕过图形校验"; }
  ]) {
    const input = fixture();
    change(input.report.pages[0]);
    assert.throws(() => renderReportDocument(input), /diagram|图形|混入|字段/);
  }
});

test("没有 diagram 的视觉报告不注入兼容图形样式", () => {
  const input = fixture();
  const page = input.report.pages[0];
  delete page.diagram;
  page.visual_layout = "comparison";
  page.table = { columns: ["对象", "条件"], rows: [["甲", "同条件"], ["乙", "同条件"], ["丙", "同条件"]] };
  input.report.pages = [page];
  const html = renderReportDocument(input).html;
  assert.ok(!html.includes(".diagram{min-width"));
});

test("四类图形在桌面、窄屏和打印页面不溢出", { timeout: 90000 }, async t => {
  let chromium;
  try {
    ({ chromium } = require(require.resolve("playwright", { paths: [process.env.ANQIAN_NODE_MODULES || root] })));
  } catch {
    t.skip("需要 ANQIAN_NODE_MODULES 指向 Playwright 运行时");
    return;
  }
  const rendered = renderReportDocument(fixture());
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1512, height: 982 }, offline: true });
    const page = await context.newPage();
    await page.route("https://diagram.test/report", route => route.fulfill({ contentType: "text/html", body: rendered.html }));
    await page.goto("https://diagram.test/report");
    await page.waitForFunction(() => window.__reportReady);
    for (const width of [1512, 1280, 900, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.deepEqual((await inspectPages(page)).issues, [], `视口 ${width}`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    }
    await page.setViewportSize({ width: 1512, height: 982 });
    await page.emulateMedia({ media: "print" });
    assert.deepEqual((await inspectPages(page)).issues, []);
  } finally {
    await browser.close();
  }
});
