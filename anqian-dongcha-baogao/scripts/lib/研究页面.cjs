const { evidenceClosure } = require("./关系校验.cjs");
const { reviewedEvidence, missing, isStrict } = require("./证据规则.cjs");
const { contentReviewed } = require("./研究判断.cjs");
const { validateDisplays } = require("./研究表格.cjs");
const { pageChartEntries } = require("./图表数据.cjs");
const { validateChart, validatePageCharts } = require("./图表安全.cjs");
const { validateNumeric, validateChartEvidence, validateChartText } = require("./图表证据.cjs");

function sameSet(a, b) { return a.length === b.length && a.every((item) => b.includes(item)); }

function checkExpression(text, pov, path, add, strict) {
  const claims = String(text).split(/[。！？；，,\n]|但是|然而|不过|并且|而且|同时|因此|所以|但|却|且/)
    .filter((part) => !/不能|不得|不足以|并非|不代表|尚未|不证明|未证实|无法/.test(part));
  const strong = /必然|证明了|已证实|导致|因果关系|持续增长|持续下降|所有消费者|市场空白|零成本|保证增长|行业第一/;
  if (claims.some((part) => strong.test(part))) {
    add("fatal", path, "claim_overreach", "表达包含因果、持续趋势、总体外推或绝对承诺，当前门禁不自动认可", "缩小到观察范围；需要此类表达时另行建立专门证据与业务审校，不靠标题断言");
  }
  if (pov?.claim_type === "hypothesis" && !/假设|待验证|待核实/.test(text)) {
    add(strict ? "fatal" : "warning", path, "page_hypothesis_label", "页面中的工作假设没有可见标注");
  }
}

function validatePages(research, report, graph, add) {
  const projectStrict = isStrict(research);
  // These records are also rendered in footnotes, presenter panels and body fallbacks.
  for (const collection of ['evidence', 'points_of_view', 'sources']) {
    research[collection].forEach((record, i) => {
      for (const [field, value] of Object.entries(record)) {
        if (typeof value === 'string') checkExpression(value, null, `研究数据.json/${collection}/${i}/${field}`, add, projectStrict);
      }
    });
  }
  if (!research.questions.length || !research.points_of_view.length || !research.storyline.length) {
    add(projectStrict ? "fatal" : "warning", "研究数据.json", "research_incomplete", "研究问题、观点或故事线尚未形成，不能作为完整洞察报告");
  }
  research.questions.forEach((q, i) => {
    if (q.status === "open" || q.status === "in_progress") add("warning", `研究数据.json/questions/${i}/status`, "question_gap", "研究问题仍有未回答范围", "在成品中保留未回答范围，不能用问题页冒充洞察");
  });
  research.storyline.forEach((page, i) => {
    const path = `研究数据.json/storyline/${i}`;
    const strict = projectStrict || page.page_status !== "research_stage";
    const pov = graph.points_of_view.get(page.point_of_view_id);
    if (strict && pov?.status !== "client_ready") add("fatal", `${path}/point_of_view_id`, "pov_not_ready", "对客页面使用了未达到 client_ready 的观点");
    if (!page.evidence_ids.length) add(strict ? "fatal" : "warning", `${path}/evidence_ids`, "page_no_evidence", "没有证据的页面只能保留为内部研究阶段稿");
    if (pov && !sameSet(page.evidence_ids, pov.evidence_ids)) add("fatal", `${path}/evidence_ids`, "pov_page_evidence", "页面和观点卡不是同一组证据", "同步观点卡与故事线的证据，另一个判断应拆成独立页面");
    const sources = [...new Set(evidenceClosure(page.evidence_ids, graph).map((e) => e.source_id))];
    if (!sameSet(page.source_ids, sources)) add("fatal", `${path}/source_ids`, "page_source_mismatch", "页面来源与证据及计算上游来源不一致", "列出本页证据及计算输入对应的完整来源，不混入无关来源");
    for (const field of ["title", "speaker_notes", "limitations", "business_meaning"]) {
      if (missing(page[field])) add(strict ? "fatal" : "warning", `${path}/${field}`, "page_incomplete", "页面标题、备注、限制或经营含义不完整");
    }
    if (page.claim_type && pov && page.claim_type !== pov.claim_type) add("fatal", `${path}/claim_type`, "page_claim_type", "页面陈述类型与观点卡不一致");
    for (const field of ["title", "speaker_notes", "business_meaning", "limitations"]) checkExpression(page[field], pov, `${path}/${field}`, add, strict);
    reviewedEvidence(page.evidence_ids, graph, strict, path, add);
    if (strict) contentReviewed(page, path, add, true);
    else add("warning", path, "research_stage", "页面仍为内部研究阶段稿，不代表对客内容已审校");
  });
  if (!report) return;
  for (const field of ['title', 'working_judgment', 'audience']) checkExpression(report[field], null, `报告.json/${field}`, add, projectStrict);
  report.attachments.forEach((item, i) => checkExpression(item.title, null, `报告.json/attachments/${i}/title`, add, projectStrict));
  if (projectStrict && !report.pages.length) add("fatal", "报告.json/pages", "empty_report", "对客报告不能为空");
  report.pages.forEach((page, i) => {
    const path = `报告.json/pages/${i}`;
    for (const issue of validatePageCharts(page, path)) add(issue.severity, issue.path, "chart_invalid", issue.message, issue.fix);
    const story = graph.storyline.get(page.storyline_page_id);
    if (!story) return;
    const pov = graph.points_of_view.get(story.point_of_view_id);
    const strict = projectStrict || story.page_status !== "research_stage" || pov?.status === "client_ready";
    if (page.title !== story.title) add("fatal", `${path}/title`, "title_mismatch", "报告标题与故事线标题不一致", "修改源故事线后同步报告配置，不在输出端单独改结论");
    if (!sameSet(page.source_ids, story.source_ids)) add("fatal", `${path}/source_ids`, "report_source_mismatch", "报告来源与故事线来源不一致");
    if (missing(page.speaker_notes)) add("fatal", `${path}/speaker_notes`, "notes_missing", "报告缺少讲解备注");
    for (const field of ["title", "speaker_notes", "body", "sourceNote", "limitations"]) {
      if (typeof page[field] === "string") checkExpression(page[field], pov, `${path}/${field}`, add, strict);
      else if (Array.isArray(page[field])) page[field].forEach((text, j) => checkExpression(text, pov, `${path}/${field}/${j}`, add, strict));
    }
    if (page.image) checkExpression(page.image.alt, null, `${path}/image/alt`, add, strict);
    if (page.statistic) for (const field of ['question', 'population', 'period', 'limitations']) {
      checkExpression(page.statistic[field], null, `${path}/statistic/${field}`, add, strict);
    }
    for (const id of page.speaker_notes.match(/\bev-[A-Za-z0-9._-]+/g) || []) {
      if (!story.evidence_ids.includes(id)) add("fatal", `${path}/speaker_notes`, "notes_evidence_mismatch", "备注引用了页面证据之外的编号");
    }
    const charts = pageChartEntries(page);
    for (const entry of charts) {
      if (validateChart(entry.chart).length) continue;
      validateChartEvidence(entry.chart, `${path}${entry.path}`, story, graph, strict, add);
      validateChartText(entry.chart, `${path}${entry.path}`, story, pov, research, graph, strict, add, checkExpression);
    }
    if (page.statistic) validateNumeric(page.statistic, `${path}/statistic`, story, graph, strict, add);
    validateDisplays({ ...page, chart: undefined }, story, pov, research, graph, strict, path, add, checkExpression);
    const nature = { fact: "external_fact", judgment: "research_judgment", hypothesis: "working_hypothesis",
      recommendation: "recommendation", client_statement: "client_statement" };
    if (page.fact_nature && pov && page.fact_nature !== nature[pov.claim_type]) {
      add("fatal", `${path}/fact_nature`, "fact_nature_mismatch", "报告事实类型与观点卡不一致");
    }
    if (page.content_mode === "chart" && !charts.length) add("fatal", `${path}/chart`, "chart_missing", "图表页没有图表数据");
  });
}

module.exports = { validatePages, validateNumeric };
