"use strict";

const list = value => Array.isArray(value) ? value : [];

function pageChartEntries(page) {
  if (!page || typeof page !== "object") return [];
  return [...(Object.hasOwn(page, "chart") ? [{ chart: page.chart, path: "/chart" }] : []),
    ...list(page.charts).map((chart, i) => ({ chart, path: `/charts/${i}` }))];
}

function pageCharts(page) { return pageChartEntries(page).map(entry => entry.chart); }

function chartEvidenceIds(chart) {
  return [...new Set([...list(chart?.evidence_ids),
    ...list(chart?.series).flatMap(series => list(series?.evidence_ids)), ...list(chart?.x_evidence_ids)])];
}

// Inspect descriptors before reading data so functions/accessors never reach option generation.
function inertChartIssue(value, path = "/chart", seen = new Set(), budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 20000 || depth > 12) return { path, message: "图表输入过大或嵌套过深" };
  if (value === null || ["string", "boolean"].includes(typeof value) || Number.isFinite(value)) return null;
  if (typeof value !== "object") return { path, message: "图表只接受普通 JSON 数据，不接受函数或非有限数字" };
  if (seen.has(value) || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) {
    return { path, message: "图表不接受循环引用或特殊对象" };
  }
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value) && Object.keys(descriptors).filter(key => /^(0|[1-9]\d*)$/.test(key)).length !== value.length) {
    return { path, message: "图表不接受稀疏数组" };
  }
  for (const key of Reflect.ownKeys(descriptors)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = descriptors[key];
    const childPath = `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (typeof key !== "string" || descriptor.get || descriptor.set ||
        (Array.isArray(value) && !/^(0|[1-9]\d*)$/.test(key))) {
      return { path: childPath, message: "图表不接受访问器、符号或数组附加字段" };
    }
    const issue = inertChartIssue(descriptor.value, childPath, seen, budget, depth + 1);
    if (issue) return issue;
  }
  seen.delete(value);
  return null;
}

module.exports = { pageChartEntries, pageCharts, chartEvidenceIds, inertChartIssue };
