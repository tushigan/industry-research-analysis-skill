const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateResearch } = require("../scripts/验证研究数据.cjs");
const { research, report, clientReady, surveyVisualization } = require("./fixtures/证据边界样本/研究样本.cjs");
const has = (result, code, severity = "fatal") => result.issues.some((i) => i.code === code && i.severity === severity);
const validate = (change, ready = false) => { const d = ready ? clientReady() : research(); change(d); return validateResearch(d); };

test("六类证据完整样本通过，研究阶段明确警告", () => {
  const result = validateResearch(research(), report());
  assert.equal(result.ok, true, JSON.stringify(result.bySeverity.fatal));
  assert.equal(new Set(research().evidence.map((e) => e.evidence_type)).size, 6);
  assert(result.counts.warning > 0);
  assert(has(result, "research_stage", "warning"));
  assert(has(result, "formula_not_executed", "info"));
  assert.equal(result.issues.length, Object.values(result.counts).reduce((a, b) => a + b));
  assert(result.issues.every((i) => i.file && i.path && i.suggestion));
});

for (const [index, field] of [[0, "sample_size"], [0, "response_mode"], [0, "weighting"], [0, "error_information"],
  [1, "specification"], [1, "quantity"], [1, "shipping"], [1, "region"], [1, "observed_at"],
  [1, "promotion_eligibility"], [2, "report_period"], [2, "self_reported"], [3, "denominator"],
  [4, "participant_role"], [5, "conversions"], [5, "comparison_conditions"]]) {
  test(`类型必填字段缺失拒绝：${index}/${field}`, () => {
    assert.equal(validate((d) => { delete d.evidence[index][field]; }).ok, false);
  });
}
test("商品与企业无调查 N 可以通过", () => {
  const d = research();
  assert.equal(d.evidence[1].sample_size, undefined);
  assert.equal(d.evidence[2].sample_size, undefined);
  assert.equal(validateResearch(d).ok, true);
});
test("机构公开材料独立于企业自报，保留文件范围并禁止自报标签", () => {
  const d = research();
  d.evidence[2].evidence_type = "public_document";
  d.evidence[2].self_reported = false;
  assert.equal(validateResearch(d).ok, true);
  d.evidence[2].self_reported = true;
  assert(has(validateResearch(d), "public_document_self_reported"));
  d.evidence[2].self_reported = false;
  delete d.evidence[2].definition_scope;
  assert.equal(validateResearch(d).ok, false);
});
test("类型错误给出具体字段路径，而非只有 oneOf 失败", () => {
  const result = validate((d) => { delete d.evidence[0].sample_size; });
  assert(result.issues.some((i) => i.path.endsWith("/evidence/0/sample_size")));
});
test("未知类型、负样本与字符串数值拒绝", () => {
  for (const value of [0, -1, "120"]) assert.equal(validate((d) => { d.evidence[0].sample_size = value; }).ok, false);
  assert.equal(validate((d) => { d.evidence[0].evidence_type = "invented"; }).ok, false);
});
test("价格条件未披露不得参与同条件比较", () => {
  assert(has(validate((d) => { d.evidence[1].region = "未披露"; }), "price_comparison_disabled"));
});

for (const [collection, field, value] of [["evidence", "source_id", "missing"], ["evidence", "question_ids", ["missing"]],
  ["calculations", "input_evidence_ids", ["missing"]], ["hypotheses", "supporting_evidence_ids", ["missing"]],
  ["hypotheses", "counter_evidence_ids", ["missing"]], ["hypotheses", "competing_mechanism_ids", ["missing"]],
  ["mechanisms", "supporting_evidence_ids", ["missing"]], ["literature_comparisons", "source_id", "missing"],
  ["literature_comparisons", "evidence_ids", ["missing"]], ["points_of_view", "evidence_ids", ["missing"]],
  ["storyline", "point_of_view_id", "missing"], ["storyline", "source_ids", ["missing"]]]) {
  test(`悬空引用 ${collection}/${field}`, () => assert(has(validate((d) => { d[collection][0][field] = value; }), "dangling_reference")));
}
test("重复实体、重复引用与计算循环拒绝", () => {
  assert(has(validate((d) => { d.sources.push({ ...d.sources[0] }); }), "duplicate_id"));
  assert(has(validate((d) => { d.hypotheses[0].competing_mechanism_ids = ["mech-001", "mech-001"]; }), "duplicate_reference"));
  assert(has(validate((d) => { d.evidence[5].input_evidence_ids = ["ev-006"]; }), "calculation_cycle"));
});
test("搜索摘要和客户陈述不能升为事实", () => {
  for (const kind of ["search_summary", "client_statement"]) {
    assert(has(validate((d) => { d.sources[1].source_kind = kind; }), "unsupported_fact"));
  }
  assert(has(validate((d) => { d.sources[1].access_method = "Tavily 搜索摘要"; }), "unsupported_fact"));
});
test("推导结果必须与原始事实分开", () => {
  assert(has(validate((d) => { d.evidence[5].claim_type = "fact"; }), "derived_as_fact"));
});
test("完整对客技术样本通过，但仍提示人工核验边界", () => {
  const result = validateResearch(clientReady(), report());
  assert.equal(result.ok, true, JSON.stringify(result.bySeverity.fatal));
  assert(has(result, "manual_review", "info"));
});
for (const status of ["unreviewed", "restricted", "rejected"]) {
  test(`对客拒绝证据状态 ${status}`, () => assert(has(validate((d) => { d.evidence[1].review_status = status; }, true), "evidence_not_reviewed")));
}
test("client_ready 不能绕过项目草稿状态", () => {
  const result = validate((d) => { d.points_of_view[0].status = "client_ready"; });
  assert(has(result, "evidence_not_reviewed"));
  assert(has(result, "content_not_reviewed"));
});
test("缺分析层次和替代解释：草稿警告，对客失败", () => {
  const edit = (d) => { delete d.points_of_view[0].analysis_level; d.points_of_view[0].alternative_explanations = []; };
  assert(has(validate(edit), "pov_incomplete", "warning"));
  assert.equal(validate(edit).ok, true);
  assert(has(validate(edit, true), "pov_incomplete"));
});
test("假说可推翻条件与两个竞争解释门禁", () => {
  assert(has(validate((d) => { d.hypotheses[0].falsifier = "待补"; }, true), "hypothesis_incomplete"));
  assert(has(validate((d) => { d.hypotheses[0].competing_mechanism_ids = ["mech-001"]; }), "competing_mechanisms", "warning"));
  assert(has(validate((d) => { d.hypotheses[0].competing_mechanism_ids = ["mech-001"]; }, true), "competing_mechanisms"));
});
test("证据不能同时支持和反驳，竞争机制不能偷换层次", () => {
  assert(has(validate((d) => { d.hypotheses[0].counter_evidence_ids = ["ev-002"]; }), "support_counter_overlap"));
  assert(has(validate((d) => { d.mechanisms[0].analysis_level = "market"; }, true), "mechanism_level"));
});
test("既有研究跨层次比较必须解释，不可比较可保留", () => {
  assert(has(validate((d) => { delete d.literature_comparisons[0].level_difference; }), "cross_level_comparison"));
  assert.equal(validate((d) => { delete d.literature_comparisons[0].level_difference; d.literature_comparisons[0].relation = "not_comparable"; }).ok, true);
});
test("事实观点不得混入推导，假设与建议必须可见标注", () => {
  assert(has(validate((d) => { d.points_of_view[0].claim_type = "fact"; }), "pov_fact_support"));
  assert(has(validate((d) => { d.points_of_view[0].claim_type = "hypothesis"; }, true), "hypothesis_label"));
  assert(has(validate((d) => { d.points_of_view[0].claim_type = "recommendation"; }, true), "recommendation_label"));
});
test("无证建议、未复核观点和缺原文位置不能对客", () => {
  assert(has(validate((d) => { d.points_of_view[0].evidence_ids = []; }, true), "pov_no_evidence"));
  assert(has(validate((d) => { d.points_of_view[0].status = "draft"; }, true), "pov_not_ready"));
  assert(has(validate((d) => { delete d.sources[1].original_location; }, true), "original_location"));
});
test("报告标题、来源和备注不得脱离故事线", () => {
  for (const [field, value, code] of [["title", "新标题", "title_mismatch"], ["source_ids", ["src-001"], "report_source_mismatch"],
    ["speaker_notes", "引用 ev-001", "notes_evidence_mismatch"], ["speaker_notes", "   ", "notes_missing"]]) {
    const r = report(); r.pages[0][field] = value;
    assert(has(validateResearch(research(), r), code));
  }
  assert(has(validate((d) => { d.storyline[0].source_ids = ["src-002"]; }), "page_source_mismatch"));
  assert(has(validate((d) => { d.storyline[0].evidence_ids = ["ev-002"]; }), "pov_page_evidence"));
});
test("过强因果、总体与持续趋势表达拒绝，否定提醒不误杀", () => {
  for (const title of ["单次观察证明了市场空白", "优惠导致所有消费者选择", "价格持续下降"]) {
    assert(has(validate((d) => { d.storyline[0].title = title; }), "claim_overreach"));
  }
  assert.equal(validate((d) => { d.storyline[0].title = "单次观察不能证明持续增长"; }).ok, true);
});
test("图表数字必须对上证据数值、单位及页面引用", () => {
  const r = report(); r.pages[0].chart = { type: "bar", labels: ["匿名样本"], values: [19.9], unit: "CNY", evidence_ids: ["ev-002"] };
  assert.equal(validateResearch(research(), r).ok, true);
  r.pages[0].chart.values = [999]; assert(has(validateResearch(research(), r), "numeric_trace"));
  r.pages[0].chart.values = [19.9]; r.pages[0].chart.unit = "USD"; assert(has(validateResearch(research(), r), "numeric_trace"));
  r.pages[0].chart.evidence_ids = ["missing"]; assert(has(validateResearch(research(), r), "dangling_reference"));
});
test("推导图表追溯输入且不执行计算表达式", () => {
  const d = research(); const r = report();
  d.evidence[5].value = 39.8;
  d.evidence[5].formula = "globalThis.__researchExecuted = true";
  r.pages[0].chart = { type: "bar", labels: ["换算"], values: [39.8], unit: "CNY/kg", evidence_ids: ["ev-006"] };
  assert.equal(validateResearch(d, r).ok, true);
  assert.equal(globalThis.__researchExecuted, undefined);
  d.evidence[1].review_status = "rejected";
  assert(has(validateResearch(d, r), "evidence_not_reviewed"));
});
test("statistic 数字追溯拒绝孤立值、字符串和错误单位", () => {
  const r = report(); r.pages[0].statistic = { value: 19.9, unit: "CNY", label: "标价", evidence_ids: ["ev-002"] };
  assert.equal(validateResearch(research(), r).ok, true);
  for (const value of [88, "19.9", "约20"]) {
    r.pages[0].statistic.value = value;
    assert(has(validateResearch(research(), r), "numeric_trace"));
  }
  r.pages[0].statistic.value = 19.9; r.pages[0].statistic.unit = "USD";
  assert(has(validateResearch(research(), r), "numeric_trace"));
});
test("报告分类和正文数组也接受表达检查", () => {
  const r = report(); r.pages[0].fact_nature = "external_fact";
  assert(has(validateResearch(research(), r), "fact_nature_mismatch"));
  delete r.pages[0].fact_nature; r.pages[0].body = ["持续增长，证明了市场空白"];
  assert(has(validateResearch(research(), r), "claim_overreach"));
});
for (const [field, wrong] of [["sample_size", 999], ["population", "另一群人"], ["period", "另一时期"], ["question", "另一问法"]]) {
  test(`调查统计卡核对 ${field}，不能缺失或借用另一调查`, () => {
    const { data, config } = surveyVisualization();
    assert.equal(validateResearch(data, config).ok, true);
    config.pages[0].statistic[field] = wrong;
    assert(has(validateResearch(data, config), "survey_statistic_mismatch"));
    delete config.pages[0].statistic[field];
    assert(has(validateResearch(data, config), "survey_statistic_missing"));
  });
}
test("调查元数据无调查证据时拒绝，多个调查口径冲突也拒绝", () => {
  const d = research(); const r = report();
  r.pages[0].statistic = { value: 19.9, unit: "CNY", label: "价格", evidence_ids: ["ev-002"], sample_size: 999 };
  assert(has(validateResearch(d, r), "survey_statistic_unlinked"));
  const { data, config, other } = surveyVisualization();
  config.pages[0].statistic.evidence_ids.push(other.evidence_id); other.sample_size = 998;
  assert(has(validateResearch(data, config), "survey_statistic_mismatch"));
});
test("推导统计卡仍向上核对调查元数据", () => {
  const { data, config } = surveyVisualization(); const derived = data.evidence[5];
  Object.assign(derived, { input_evidence_ids: ["ev-001"], value: 50, unit: "%" });
  data.points_of_view[0].evidence_ids = [derived.evidence_id]; data.storyline[0].evidence_ids = [derived.evidence_id];
  data.storyline[0].source_ids = ["src-001", derived.source_id]; config.pages[0].source_ids = [...data.storyline[0].source_ids];
  config.pages[0].statistic.evidence_ids = [derived.evidence_id];
  assert.equal(validateResearch(data, config).ok, true);
  config.pages[0].statistic.sample_size = 999;
  assert(has(validateResearch(data, config), "survey_statistic_mismatch"));
});
function pieSample() {
  const sample = surveyVisualization(); delete sample.config.pages[0].statistic;
  sample.config.pages[0].chart = { type: "pie", labels: ["选项甲", "选项乙"], values: [50, 50], unit: "%",
    evidence_ids: [sample.survey.evidence_id, sample.other.evidence_id] };
  return sample;
}
test("合计100仍拒绝多选、开放题和未登记分母的调查饼图", () => {
  for (const mode of ["multiple", "open"]) {
    const { data, config, survey } = pieSample(); survey.response_mode = mode;
    assert(has(validateResearch(data, config), "survey_pie_response_mode"));
  }
  const { data, config } = pieSample();
  assert(has(validateResearch(data, config), "survey_pie_denominator"));
});
test("饼图分母与调查口径一致才通过，并保留逐点语义警告", () => {
  const { data, config, survey, other } = pieSample();
  for (const e of [survey, other]) Object.assign(e, { denominator: "该题全部有效受访者", denominator_count: 120 });
  const result = validateResearch(data, config);
  assert.equal(result.ok, true, JSON.stringify(result.bySeverity.fatal));
  assert(has(result, "numeric_label_unverified", "warning"));
  for (const [field, value] of [["denominator", "不同分母"], ["denominator_count", 80], ["survey_period", "另一时期"]]) {
    const changed = structuredClone(data); changed.evidence.at(-1)[field] = value;
    assert(has(validateResearch(changed, config), "survey_pie_incomparable"));
  }
});
test("相同数值被换上错误标签，仍明确警告而非宣称语义已核实", () => {
  const { data, config } = pieSample(); config.pages[0].chart.type = "bar";
  config.pages[0].chart.labels = ["未经证据证明的标签", "另一错误标签"];
  const result = validateResearch(data, config);
  assert.equal(result.ok, true); assert(has(result, "numeric_label_unverified", "warning"));
});
test("附件双契约映射一致，页数路径分享或引用页不符即阻断", () => {
  const d = research(); const r = report();
  d.attachments = [{ attachment_id: "a-1", file_name: "sample.pdf", file_path: "assets/sample.pdf", page_count: 2,
    cited_pages: [1], format_label: "PDF", share_approved: true, share_basis: "自制测试" }];
  r.attachments = [{ attachment_id: "a-1", path: "assets/sample.pdf", title: "测试附件", page_count: 2,
    referenced_pages: [1], format: "pdf", share_approved: true, share_basis: "自制测试", source_id: "src-002" }];
  assert.equal(validateResearch(d, r).ok, true);
  for (const [field, value] of [["path", "other.pdf"], ["page_count", 3], ["referenced_pages", [2]],
    ["share_approved", false], ["share_basis", "不同依据"]]) {
    const copy = structuredClone(r); copy.attachments[0][field] = value;
    assert(has(validateResearch(d, copy), "attachment_mismatch"));
  }
  r.attachments[0].source_id = "missing";
  assert(has(validateResearch(d, r), "dangling_reference"));
});
test("单条 client_ready 仍检查源头时期与推导条件", () => {
  const d = clientReady(); d.project.status = "internal_draft";
  d.sources[1].data_period = "未披露";
  assert(has(validateResearch(d), "source_incomplete"));
  d.sources[1].data_period = "历史时点"; d.evidence[5].comparison_conditions = "待补";
  assert(has(validateResearch(d), "calculation_trace"));
});
test("恶意形状不抛异常，不执行访问器", () => {
  const cyclic = {}; cyclic.self = cyclic;
  const accessor = { get project() { throw new Error("must not run"); } };
  for (const input of [null, undefined, [], {}, 1, "x", NaN, Infinity, 1n, cyclic, accessor, new Date(),
    { ...research(), evidence: [null] }, { ...research(), hypotheses: {} }, new Array(2)]) {
    assert.doesNotThrow(() => validateResearch(input));
    assert.equal(validateResearch(input).ok, false);
  }
  assert.equal(validateResearch(research(), []).ok, false);
});
test("命令行真实读取，成功0、文件/JSON/参数错误1，双格式输出", () => {
  const script = path.resolve(__dirname, "../scripts/验证研究数据.cjs");
  const file = path.resolve(__dirname, "fixtures/基础有效样本/研究数据.json");
  const good = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
  assert.equal(good.status, 0); assert.equal(JSON.parse(good.stdout).ok, true); assert.match(good.stderr, /warning/);
  for (const args of [[], ["/not-existing-research.json"], [script], [file, file]]) {
    const bad = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    assert.equal(bad.status, 1); assert.equal(JSON.parse(bad.stdout).ok, false); assert.match(bad.stderr, /fatal/);
  }
});
