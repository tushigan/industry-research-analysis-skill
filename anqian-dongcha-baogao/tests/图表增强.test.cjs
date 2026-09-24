const test = require("node:test");
const assert = require("node:assert/strict");
const { validateChart, validatePageCharts, pageCharts, chartEvidenceIds } = require("../scripts/lib/图表安全.cjs");
const { validateDocument } = require("../scripts/lib/schema-validator.cjs");
const { validateResearch } = require("../scripts/验证研究数据.cjs");
const { resolveProductionMode } = require("../scripts/lib/制作模式.cjs");
const schema = require("../schemas/报告配置.schema.json");
const { clientReady, report, surveyVisualization } = require("./fixtures/证据边界样本/研究样本.cjs");
const single = () => ({ type: "bar", labels: ["甲", "乙"], values: [10, 20], unit: "CNY", evidence_ids: ["ev-a1", "ev-a2"] });
const multi = () => ({ type: "bar", title: "匿名同口径比较", labels: ["甲", "乙"], unit: "CNY",
  evidence_ids: ["ev-a1", "ev-a2", "ev-b1", "ev-b2"], series: [
    { name: "系列甲", type: "bar", values: [10, 20], evidence_ids: ["ev-a1", "ev-a2"] },
    { name: "系列乙", type: "line", values: [30, 40], evidence_ids: ["ev-b1", "ev-b2"] }
  ] });
const scatter = () => ({ type: "scatter", title: "匿名双轴观察", labels: ["甲", "乙"], values: [[1, 10], [2, 20]],
  unit: "CNY", x_unit: "kg", evidence_ids: ["ev-a1", "ev-a2"], x_evidence_ids: ["ev-x1", "ev-x2"] });
function sample(chart = multi()) {
  const data = clientReady(), config = report();
  for (const [id, value, unit] of [["a1", 10, "CNY"], ["a2", 20, "CNY"], ["b1", 30, "CNY"],
    ["b2", 40, "CNY"], ["x1", 1, "kg"], ["x2", 2, "kg"]]) {
    data.evidence.push({ ...data.evidence[2], evidence_id: `ev-${id}`, value, unit });
  }
  const ids = data.evidence.slice(-6).map(e => e.evidence_id);
  data.points_of_view[0].evidence_ids = [...ids]; data.storyline[0].evidence_ids = [...ids];
  data.storyline[0].source_ids = [data.evidence[2].source_id];
  Object.assign(config.pages[0], { source_ids: [...data.storyline[0].source_ids], speaker_notes: "匿名图表技术样本。", content_mode: "chart", chart });
  return { data, config, result: () => validateResearch(data, config) };
}
const has = (result, code, path) => result.issues.some(i => i.severity === "fatal" && i.code === code && (!path || i.path.endsWith(path)));
const passes = result => assert.equal(result.ok, true, JSON.stringify(result.bySeverity.fatal));
const chartSchema = chart => validateDocument(chart, { $ref: "#/$defs/chart", $defs: schema.$defs });

test("production_mode与delivery_scope为必填枚举，不能由构建器猜测", () => {
  const config = report(); assert.deepEqual(validateDocument(config, schema), []);
  for (const field of ["production_mode", "delivery_scope"]) {
    const missing = structuredClone(config); delete missing[field];
    assert(validateDocument(missing, schema).some(issue => issue.path === `/${field}`));
  }
  for (const scope of ["complete", "preview"]) {
    config.delivery_scope = scope; assert.deepEqual(validateDocument(config, schema), []);
  }
  for (const scope of ["formal", "", null, 1]) {
    config.delivery_scope = scope;
    assert(validateDocument(config, schema).some(issue => issue.path === "/delivery_scope"));
  }
});

test("外部production_mode只能重复报告声明，不能把新稿降级成历史用途", () => {
  const config = report();
  config.production_mode = "content_revision";
  assert.equal(resolveProductionMode(config, "content_revision"), "content_revision");
  assert.throws(() => resolveProductionMode(config, "historical_replay"), /与报告声明.*不一致/);
  config.production_mode = "historical_replay";
  assert.throws(() => resolveProductionMode(config, "new_report", { legacy: true }), /与报告声明.*不一致/);
});

test("共享 helper 保留单图、顺序遍历多图并收集所有系列及双轴证据", () => {
  const a = single(), b = multi(), c = scatter();
  assert.deepEqual(pageCharts({}), []); assert.deepEqual(pageCharts({ chart: a }), [a]);
  assert.deepEqual(pageCharts({ charts: [a, b, c] }), [a, b, c]);
  assert.deepEqual(chartEvidenceIds(a), a.evidence_ids);
  b.evidence_ids = ["ev-a1"];
  assert.deepEqual(chartEvidenceIds(b), ["ev-a1", "ev-a2", "ev-b1", "ev-b2"]);
  assert.deepEqual(chartEvidenceIds(c), ["ev-a1", "ev-a2", "ev-x1", "ev-x2"]);
  assert.deepEqual(chartEvidenceIds({}), []);
});
for (const make of [single, multi, scatter]) test(`有效图表结构、schema和formal证据通过：${make.name}`, () => {
  const chart = make(), before = structuredClone(chart);
  assert.deepEqual(validateChart(chart), []); assert.deepEqual(chartSchema(chart), []);
  passes(sample(chart).result()); assert.deepEqual(chart, before);
});
test("旧单图与统计卡保留非逐点引用集合的兼容性", () => {
  const chart = single(); chart.evidence_ids.reverse();
  passes(sample(chart).result());
  const s = sample(); delete s.config.pages[0].chart; s.config.pages[0].content_mode = "insight";
  s.config.pages[0].statistic = { value: 10, unit: "CNY", label: "标价", evidence_ids: ["ev-a1"] };
  passes(s.result());
});
const invalid = [
  ["values与series互斥", c => { c.values = [10, 20]; }],
  ["缺少values与series", c => { delete c.series; }],
  ["饼图不接受系列", c => { c.type = "pie"; }],
  ["不允许双轴", c => { c.series[1].yAxisIndex = 1; }],
  ["不允许系列单位覆盖", c => { c.series[1].unit = "%"; }],
  ["不允许formatter", c => { c.series[1].formatter = "{c}"; }],
  ["不允许原始option", c => { c.option = {}; }],
  ["不允许scripts", c => { c.scripts = "globalThis.bad = true"; }],
  ["系列类型受限", c => { c.series[1].type = "scatter"; }],
  ["系列名不能为空", c => { c.series[1].name = ""; }],
  ["系列数字不是字符串", c => { c.series[1].values[1] = "40"; }],
  ["系列证据不能为空", c => { c.series[1].evidence_ids = []; }],
  ["顶层证据必填", c => { delete c.evidence_ids; }],
  ["非散点不带x轴字段", c => { c.x_unit = "kg"; }]
];
for (const [name, change] of invalid) test(`安全层与schema拒绝：${name}`, () => {
  const chart = multi(); change(chart);
  assert(validateChart(chart).length); assert(chartSchema(chart).length);
  assert.equal(sample(chart).result().ok, false);
});
test("数组上限、标签长度和系列逐项长度在安全层及研究入口拦截", () => {
  for (const change of [c => { c.series = Array.from({ length: 5 }, () => structuredClone(c.series[0])); },
    c => { c.labels = Array(41).fill("甲"); }, c => { c.series[1].values.pop(); },
    c => { c.labels[0] = "甲".repeat(81); }, c => { c.unit = "元".repeat(41); },
    c => { c.title = " "; }, c => { c.series[1].name = " "; }]) {
    const chart = multi(); change(chart); assert(validateChart(chart).length); assert.equal(sample(chart).result().ok, false);
  }
  assert.equal(schema.$defs.chart.properties.labels.maxItems, 40);
  assert.equal(schema.$defs.chart.properties.series.maxItems, 4);
  assert.equal(schema.$defs.page.properties.charts.maxItems, 3);
});
test("最大4系列及40分类允许，line顶层与负值不被额外禁止", () => {
  const chart = multi(); chart.type = "line"; chart.labels = Array.from({ length: 40 }, (_, i) => `样本${i + 1}`);
  chart.series = Array.from({ length: 4 }, (_, i) => ({ name: `系列${i + 1}`, type: i % 2 ? "line" : "bar",
    values: Array(40).fill(i === 3 ? -10 : 10), evidence_ids: [i === 3 ? "ev-b1" : "ev-a1"] }));
  const s = sample(chart); s.data.evidence.at(-4).value = -10;
  assert.deepEqual(validateChart(chart), []); assert.deepEqual(chartSchema(chart), []); passes(s.result());
});
test("安全层拒绝函数、访问器、非有限数、稀疏和异常结构，不执行输入", () => {
  let executed = false;
  const accessor = multi(); Object.defineProperty(accessor.series[1], "values", { get() { executed = true; throw Error("执行了"); } });
  for (const chart of [null, [], {}, accessor, { ...single(), values: new Array(2) },
    { ...single(), values: [NaN, 20] }, { ...single(), values: [Infinity, 20] },
    { ...single(), title: () => { executed = true; } }, { ...multi(), series: [null] }]) {
    assert.doesNotThrow(() => validateChart(chart)); assert(validateChart(chart).length);
  }
  assert.equal(executed, false);
});
test("各系列逐值核验，不从顶层或别的系列借相同数字", () => {
  const s = sample(); s.config.pages[0].chart.series[1].values[1] = 20;
  assert(has(s.result(), "numeric_trace", "/chart/series/1/values/1"));
  s.config.pages[0].chart.series[1].values[1] = 40;
  s.data.evidence.at(-3).unit = "%";
  assert(has(s.result(), "numeric_trace", "/chart/series/1/values/1"));
});
test("每个系列都检查悬空、未入故事线、formal复核和来源", () => {
  const s = sample(); s.config.pages[0].chart.series[1].evidence_ids[1] = "ev-missing";
  assert(has(s.result(), "dangling_reference", "/chart/series/1/evidence_ids/1"));
  s.config.pages[0].chart.series[1].evidence_ids[1] = "ev-b2";
  s.data.storyline[0].evidence_ids = s.data.storyline[0].evidence_ids.filter(id => id !== "ev-b2");
  assert(has(s.result(), "chart_page_evidence", "/chart/series/1/evidence_ids/1"));
  s.data.evidence.at(-3).review_status = "unreviewed";
  assert(has(s.result(), "evidence_not_reviewed", "/chart/series/1"));
  s.data.sources[2].data_period = "未披露";
  assert(has(s.result(), "source_incomplete", "/chart/series/1"));
});
test("散点两轴逐点绑定证据，交换证据或任一轴改值/单位都失败", () => {
  for (const [field, axis] of [["x_evidence_ids", 0], ["evidence_ids", 1]]) {
    const s = sample(scatter()), chart = s.config.pages[0].chart;
    chart[field].reverse(); assert(has(s.result(), "numeric_trace", `/chart/values/0/${axis}`));
    chart[field].reverse(); chart.values[1][axis] = 999;
    assert(has(s.result(), "numeric_trace", `/chart/values/1/${axis}`));
    const changed = sample(scatter()); changed.config.pages[0].chart[axis === 0 ? "x_unit" : "unit"] = "%";
    assert(has(changed.result(), "numeric_trace", `/chart/values/0/${axis}`));
  }
});
test("散点重复坐标允许显式复用同一证据，仍不跨点借证", () => {
  const chart = scatter(); chart.values[1] = [...chart.values[0]];
  chart.x_evidence_ids[1] = chart.x_evidence_ids[0]; chart.evidence_ids[1] = chart.evidence_ids[0];
  assert.deepEqual(chartSchema(chart), []); passes(sample(chart).result());
});
test("散点坐标长度及两组逐点证据都必须完整", () => {
  for (const change of [c => { delete c.x_unit; }, c => { delete c.x_evidence_ids; },
    c => { c.x_evidence_ids.pop(); }, c => { c.evidence_ids.push("ev-b1"); },
    c => { c.values[1] = [2]; }, c => { c.values[1].push(3); },
    c => { c.values[1][0] = "2"; }, c => { c.series = multi().series; }]) {
    const chart = scatter(); change(chart); assert(validateChart(chart).length); assert.equal(sample(chart).result().ok, false);
  }
});
test("散点横轴也检查未入故事线、来源、推导上游复核及准确索引", () => {
  const s = sample(scatter()); s.config.pages[0].chart.x_evidence_ids[1] = "missing";
  assert(has(s.result(), "dangling_reference", "/chart/x_evidence_ids/1"));
  s.config.pages[0].chart.x_evidence_ids[1] = "ev-x2";
  s.data.storyline[0].evidence_ids = s.data.storyline[0].evidence_ids.filter(id => id !== "ev-x2");
  assert(has(s.result(), "chart_page_evidence", "/chart/x_evidence_ids/1"));
  const derived = s.data.evidence[5];
  Object.assign(derived, { value: 2, unit: "kg" }); s.config.pages[0].chart.x_evidence_ids[1] = derived.evidence_id;
  s.data.evidence[1].review_status = "rejected";
  assert(has(s.result(), "evidence_not_reviewed", "/chart/x_evidence_ids/1"));
});
test("同页1至3图兼容chart页，所有图都校验，输入不被修改", () => {
  const s = sample(), page = s.config.pages[0]; delete page.chart;
  for (const charts of [[single()], [multi(), scatter()], [single(), multi(), scatter()]]) {
    page.charts = charts; page.visual_layout = "charts";
    const before = JSON.stringify(s); assert.deepEqual(validatePageCharts(page), []);
    assert.deepEqual(validateDocument(s.config, schema), []); passes(s.result()); assert.equal(JSON.stringify(s), before);
  }
  page.charts[2].values[1][0] = 999;
  assert(has(s.result(), "numeric_trace", "/charts/2/values/1/0"));
  page.charts[1].series[1].evidence_ids[1] = "missing";
  assert(has(s.result(), "dangling_reference", "/charts/1/series/1/evidence_ids/1"));
});
test("chart与charts不能共存，多图空值、超过3图和空图表页拒绝", () => {
  for (const charts of [[], [single(), single(), single(), single()], null]) {
    const s = sample(), page = s.config.pages[0]; delete page.chart; page.charts = charts;
    assert(validatePageCharts(page).length); assert.equal(s.result().ok, false);
  }
  const s = sample(); s.config.pages[0].charts = [single()];
  assert(validateDocument(s.config, schema).length); assert(validatePageCharts(s.config.pages[0]).length);
  assert.equal(s.result().ok, false);
  delete s.config.pages[0].chart; delete s.config.pages[0].charts;
  assert(has(s.result(), "chart_missing"));
});
test("新图表所有标题、系列名、标签与轴单位沿用表达及数字门禁", () => {
  for (const [change, tail, code] of [
    [c => { c.title = "保证增长"; }, "/title", "claim_overreach"],
    [c => { c.series[1].name = "全国份额99%"; }, "/series/1/name", "table_numeric_trace"],
    [c => { c.labels[1] = "所有消费者"; }, "/labels/1", "claim_overreach"],
    [c => { c.unit = "保证增长"; }, "/unit", "claim_overreach"]
  ]) {
    const s = sample(), chart = s.config.pages[0].chart; change(chart);
    delete s.config.pages[0].chart; s.config.pages[0].charts = [single(), chart];
    assert(has(s.result(), code, `/charts/1${tail}`));
  }
  const s = sample(scatter()); s.config.pages[0].chart.x_unit = "保证增长";
  assert(has(s.result(), "claim_overreach", "/chart/x_unit"));
});
test("多图的调查饼图仍检查分母、题型和逐点语义警告", () => {
  const { data, config, survey, other } = surveyVisualization(); delete config.pages[0].statistic;
  config.pages[0].charts = [
    { type: "bar", labels: ["甲", "乙"], values: [50, 50], unit: "%", evidence_ids: [survey.evidence_id, other.evidence_id] },
    { type: "pie", labels: ["甲", "乙"], values: [50, 50], unit: "%", evidence_ids: [survey.evidence_id, other.evidence_id] }
  ];
  let result = validateResearch(data, config);
  assert(has(result, "survey_pie_denominator", "/charts/1"));
  for (const e of [survey, other]) Object.assign(e, { denominator: "该题有效受访者", denominator_count: 120 });
  result = validateResearch(data, config); passes(result);
  assert(result.issues.some(i => i.code === "numeric_label_unverified" && i.path.endsWith("/charts/1")));
  survey.response_mode = "multiple";
  assert(has(validateResearch(data, config), "survey_pie_response_mode", "/charts/1"));
});
test("各系列及散点两轴继续经过调查展示检查并保留语义核验提醒", () => {
  for (const [chart, paths] of [[multi(), ["/chart/series/0", "/chart/series/1"]],
    [scatter(), ["/chart/values/0/0", "/chart/values/0/1", "/chart/values/1/0", "/chart/values/1/1"]]]) {
    const result = sample(chart).result(); passes(result);
    for (const path of paths) assert(result.issues.some(i => i.code === "numeric_label_unverified" && i.path.endsWith(path)), path);
  }
});
test("多系列与散点横轴的调查证据也追溯上游，拒绝formal未复核", () => {
  for (const make of [multi, scatter]) {
    const s = sample(make()), chart = s.config.pages[0].chart;
    const survey = s.data.evidence[0]; Object.assign(survey, { value: 60, unit: "%", review_status: "reviewed" });
    s.data.points_of_view[0].evidence_ids.push(survey.evidence_id); s.data.storyline[0].evidence_ids.push(survey.evidence_id);
    s.data.storyline[0].source_ids.push(survey.source_id); s.config.pages[0].source_ids.push(survey.source_id);
    if (chart.series) {
      chart.unit = "%"; chart.evidence_ids = [survey.evidence_id];
      chart.series.forEach(series => { series.evidence_ids = [survey.evidence_id]; series.values = [60, 60]; });
    } else {
      chart.x_unit = "%"; chart.x_evidence_ids = [survey.evidence_id, survey.evidence_id];
      chart.values.forEach(point => { point[0] = 60; });
    }
    passes(s.result()); survey.review_status = "unreviewed";
    assert(has(s.result(), "evidence_not_reviewed", chart.series ? "/chart/series/1" : "/chart/x_evidence_ids/1"));
  }
});
test("饼图负值、零总量、超8分类和百分比总量规则保留", () => {
  for (const values of [[-1, 101], [0, 0], [40, 50], Array(9).fill(100 / 9)]) {
    const chart = { type: "pie", labels: values.map(() => "分类"), values, unit: "%", evidence_ids: ["ev-a1"] };
    assert(validateChart(chart).length);
  }
  assert.deepEqual(validateChart({ type: "pie", labels: ["甲", "乙"], values: [40, 60], unit: "%", evidence_ids: ["ev-a1", "ev-a2"] }), []);
});
