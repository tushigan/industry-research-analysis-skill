"use strict";

const { reviewedEvidence } = require("./证据规则.cjs");
const { validateSurveyDisplay } = require("./证据调查展示.cjs");
const { validateDisplays } = require("./研究表格.cjs");

function validateReferences(ids, path, page, graph, add) {
  graph.refs(ids, "evidence", `${path}/evidence_ids`);
  if (!ids.length) add("fatal", `${path}/evidence_ids`, "chart_no_evidence", "数值图表必须引用证据");
  ids.forEach((id, i) => {
    if (!page.evidence_ids.includes(id)) add("fatal", `${path}/evidence_ids/${i}`, "chart_page_evidence", "图表证据未纳入故事线证据");
  });
}

function numericMatches(value, unit, evidence) {
  return Number.isFinite(value) && evidence.some(e => {
    const original = e.value ?? e.observed_price;
    return Number.isFinite(original) && (e.unit || e.currency) === unit && Math.abs(original - value) <= 1e-9;
  });
}

function numericError(path, add) {
  add("fatal", path, "numeric_trace", "图表数值或单位与所引证据/计算结果不对应", "在证据的 value/unit 或 observed_price/currency 登记同口径原数；推导值需保留完整计算记录");
}

function validateNumeric(record, path, page, graph, strict, add) {
  const ids = record.evidence_ids || [];
  validateReferences(ids, path, page, graph, add);
  const values = record.values || [record.value];
  const evidence = ids.map(id => graph.evidence.get(id)).filter(Boolean);
  values.forEach((value, i) => {
    if (!numericMatches(value, record.unit, evidence)) numericError(`${path}/${record.values ? `values/${i}` : "value"}`, add);
  });
  reviewedEvidence(ids, graph, strict, path, add);
  validateSurveyDisplay(record, path, graph, add);
}

function validateChartEvidence(chart, path, story, graph, strict, add) {
  if (chart.type === "scatter") {
    chart.values.forEach((point, i) => {
      for (const [axis, field, unit] of [[0, "x_evidence_ids", chart.x_unit], [1, "evidence_ids", chart.unit]]) {
        const id = chart[field][i], evidence = graph.evidence.get(id);
        const referencePath = `${path}/${field}/${i}`, coordinatePath = `${path}/values/${i}/${axis}`;
        // Coordinate references are positional: repeated IDs are allowed, but another point's ID is not a fallback.
        if (!evidence) add("fatal", referencePath, "dangling_reference", `引用不存在：${id}`, "引用已登记的 evidence 编号");
        if (!story.evidence_ids.includes(id)) add("fatal", referencePath, "chart_page_evidence", "图表证据未纳入故事线证据");
        if (!numericMatches(point[axis], unit, evidence ? [evidence] : [])) numericError(coordinatePath, add);
        reviewedEvidence([id], graph, strict, referencePath, add);
        validateSurveyDisplay({ type: "scatter", values: [point[axis]], unit, evidence_ids: [id] }, coordinatePath, graph, add);
      }
    });
  } else if (chart.series) {
    validateReferences(chart.evidence_ids, path, story, graph, add);
    reviewedEvidence(chart.evidence_ids, graph, strict, path, add);
    chart.series.forEach((series, i) => {
      validateNumeric({ ...series, unit: chart.unit }, `${path}/series/${i}`, story, graph, strict, add);
    });
  } else validateNumeric(chart, path, story, graph, strict, add);
}

function validateChartText(chart, path, story, pov, research, graph, strict, add, checkExpression) {
  // Reuse the existing label/table checks without editing their shared module or granting historical-table exemptions.
  validateDisplays({ chart }, story, pov, research, graph, strict, path,
    (severity, location, ...rest) => add(severity, location.replace(`${path}/chart/`, `${path}/`), ...rest), checkExpression);
  const text = (value, location) => {
    validateDisplays({ table: { columns: ["图表文字"], rows: [[value]] } }, story, pov, research, graph, strict, path,
      (severity, field, ...rest) => {
        if (field === `${path}/table/rows/0/0`) add(severity, location, ...rest);
      }, checkExpression);
  };
  if (chart.title !== undefined) text(chart.title, `${path}/title`);
  if (chart.series) chart.series.forEach((series, i) => text(series.name, `${path}/series/${i}/name`));
  if (chart.x_unit !== undefined) checkExpression(chart.x_unit, null, `${path}/x_unit`, add, strict);
}

module.exports = { validateNumeric, validateChartEvidence, validateChartText };
