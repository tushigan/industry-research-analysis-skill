"use strict";

const { pageChartEntries, pageCharts, chartEvidenceIds, inertChartIssue } = require("./图表数据.cjs");
const ALLOWED = new Set(["type", "title", "labels", "values", "series", "unit", "evidence_ids", "x_unit", "x_evidence_ids"]);
const SERIES_ALLOWED = new Set(["name", "type", "values", "evidence_ids"]);
function validateChart(chart) {
  const issues = [];
  const fail = (path, message, fix) => issues.push({ severity: "fatal", path, message, fix });
  const unsafe = inertChartIssue(chart);
  if (unsafe) {
    fail(unsafe.path, unsafe.message, "提供不含脚本、函数、访问器或特殊对象的简化图表数据");
    return issues;
  }
  if (!chart || typeof chart !== "object" || Array.isArray(chart)) {
    fail("/chart", "图表必须是简化配置对象", "提供 type、labels、values、unit 和 evidence_ids");
    return issues;
  }
  for (const key of Object.keys(chart)) {
    if (!ALLOWED.has(key)) fail(`/chart/${key}`, "图表包含未允许的字段", "移除原始 ECharts 配置、函数、脚本和图像");
  }
  if (!["bar", "line", "pie", "scatter"].includes(chart.type)) fail("/chart/type", "不支持的图表类型", "使用 bar、line、pie 或 scatter");
  if (Object.hasOwn(chart, "title") && (typeof chart.title !== "string" || !chart.title.trim())) {
    fail("/chart/title", "图表标题必须是非空文本", "提供标题文字或省略 title");
  }
  if (!Array.isArray(chart.labels) || !chart.labels.length || chart.labels.length > 40 ||
      chart.labels.some(x => typeof x !== "string" || !x.trim() || x.length > 80)) {
    fail("/chart/labels", "分类应为 1 至 40 个非空短文本", "缩短标签或分成多张图，每个标签不超过 80 字");
  }
  const textUnit = (value, path) => {
    if (typeof value !== "string" || !value.trim() || value.length > 40) fail(path, "缺少有效单位", "填写最多 40 字的统计单位");
  };
  const evidenceIds = (ids, path, perPoint = false) => {
    if (!Array.isArray(ids) || !ids.length || ids.some(x => typeof x !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(x))) {
      fail(path, "图表必须引用证据编号", "填写研究数据中可回查的 evidence_id");
    }
    if (perPoint && ids?.length !== chart.labels?.length) fail(path, "逐点证据与坐标数量不一致", "每个点每个轴分别填写一个对应证据编号");
    if (!perPoint && Array.isArray(ids) && new Set(ids).size !== ids.length) fail(path, "引用编号重复", "引用集合去重；散点逐点绑定可以复用证据");
  };
  const numbers = (values, path) => {
    if (!Array.isArray(values) || !values.length || values.length > 40 || values.some(x => !Number.isFinite(x))) {
      fail(path, "数值必须是 1 至 40 个有限数字", "不要使用数字字符串、空值或函数");
    }
    if (chart.labels?.length !== values?.length) fail(path, "分类与数值数量不一致", "逐项对应分类与数值");
  };
  textUnit(chart.unit, "/chart/unit");
  evidenceIds(chart.evidence_ids, "/chart/evidence_ids", chart.type === "scatter");
  const hasValues = Object.hasOwn(chart, "values"), hasSeries = Object.hasOwn(chart, "series");
  if (hasValues === hasSeries) fail("/chart", "values 与 series 必须且只能提供一个", "旧单图使用 values，多系列使用 series");
  if (chart.type !== "scatter") {
    for (const key of ["x_unit", "x_evidence_ids"]) {
      if (Object.hasOwn(chart, key)) fail(`/chart/${key}`, "只有散点图接受独立横轴单位和证据", "不同单位的数据拆图，不隐式创建双轴");
    }
  }
  if (hasSeries) {
    if (!["bar", "line"].includes(chart.type)) fail("/chart/series", "只有柱图和线图支持同单位多系列", "不同单位拆图，不支持饼图系列或隐式双轴");
    if (!Array.isArray(chart.series) || !chart.series.length || chart.series.length > 4) {
      fail("/chart/series", "多系列应包含 1 至 4 个系列", "减少系列或拆成多张图");
    }
    if (Array.isArray(chart.series)) chart.series.forEach((series, i) => {
      const path = `/chart/series/${i}`;
      if (!series || typeof series !== "object" || Array.isArray(series)) {
        fail(path, "系列必须是结构化对象", "提供 name、type、values 和 evidence_ids"); return;
      }
      for (const key of Object.keys(series)) if (!SERIES_ALLOWED.has(key)) fail(`${path}/${key}`, "系列包含未允许的字段", "只保留 name、type、values 和 evidence_ids，不接受原始 ECharts 选项");
      if (typeof series.name !== "string" || !series.name.trim() || series.name.length > 80) fail(`${path}/name`, "系列名应为非空短文本", "使用最多 80 字的系列名");
      if (!["bar", "line"].includes(series.type)) fail(`${path}/type`, "系列类型只允许 bar 或 line", "为系列显式指定柱图或线图");
      numbers(series.values, `${path}/values`); evidenceIds(series.evidence_ids, `${path}/evidence_ids`);
    });
  } else if (chart.type === "scatter") {
    textUnit(chart.x_unit, "/chart/x_unit"); evidenceIds(chart.x_evidence_ids, "/chart/x_evidence_ids", true);
    if (!Array.isArray(chart.values) || !chart.values.length || chart.values.length > 40 || chart.values.length !== chart.labels?.length) {
      fail("/chart/values", "散点应为与 labels 对应的 1 至 40 组坐标", "逐点提供 [x, y] 数值对");
    }
    if (Array.isArray(chart.values)) chart.values.forEach((point, i) => {
      if (!Array.isArray(point) || point.length !== 2 || point.some(x => !Number.isFinite(x))) {
        fail(`/chart/values/${i}`, "散点坐标必须是两个有限数字 [x, y]", "分别填写可追溯的横轴和纵轴数值");
      }
    });
  } else {
    numbers(chart.values, "/chart/values");
  }
  if (chart.type === "pie" && Array.isArray(chart.values)) {
    if (chart.values.some(x => x < 0) || !(chart.values.reduce((a, b) => a + b, 0) > 0)) {
      fail("/chart/values", "饼图不能使用负值或零总量", "换用适合的柱图，或核对构成数据");
    }
    if (chart.labels?.length > 8) fail("/chart/labels", "饼图分类过多", "改用柱图或提供有证据的合并分类");
    if (["%", "％", "百分比"].includes(chart.unit) && Math.abs(chart.values.reduce((a, b) => a + b, 0) - 100) > 0.05) {
      fail("/chart/values", "百分比饼图合计不为 100%", "多选题不使用构成饼图；核对分母与舍入");
    }
  }
  return issues;
}

function validatePageCharts(page, path = "") {
  const issues = [];
  if (Object.hasOwn(page, "chart") && Object.hasOwn(page, "charts")) {
    issues.push({ severity: "fatal", path: `${path}/charts`, message: "chart 与 charts 不能同时提供", fix: "单图保留 chart，多图使用 charts" });
  }
  if (Object.hasOwn(page, "charts") && (!Array.isArray(page.charts) || page.charts.length < 1 || page.charts.length > 3)) {
    issues.push({ severity: "fatal", path: `${path}/charts`, message: "同页图表数组必须包含 1 至 3 张图", fix: "减少图表或拆页，不能提供空 charts" });
  }
  for (const entry of pageChartEntries(page)) {
    for (const issue of validateChart(entry.chart)) issues.push({ ...issue, path: `${path}${entry.path}${issue.path.slice("/chart".length)}` });
  }
  return issues;
}

function chartOption(chart) {
  const issues = validateChart(chart);
  if (issues.length) throw new Error(issues.map(x => `${x.path}: ${x.message}`).join("; "));
  const base = { animation: false, color: ["#148565", "#df715b", "#d4ad55", "#5b81a2", "#79716b"],
    textStyle: { fontFamily: "sans-serif", fontSize: 13 }, aria: { enabled: true },
    tooltip: { show: false } };
  if (chart.type === "pie") return { ...base, legend: { bottom: 0, type: "scroll" },
    series: [{ type: "pie", radius: "62%", center: ["50%", "44%"],
      label: { show: true, formatter: "{b}: {c}" },
      data: chart.labels.map((name, i) => ({ name, value: chart.values[i] })) }] };
  if (chart.type === "scatter") return { ...base,
    grid: { left: 28, right: 24, top: 38, bottom: 48, containLabel: true },
    xAxis: { type: "value", name: chart.x_unit, nameLocation: "middle", nameGap: 30, scale: false },
    yAxis: { type: "value", name: chart.unit, scale: false },
    series: [{ type: "scatter", symbolSize: 12,
      label: { show: chart.labels.length <= 12, position: "top", formatter: "{b}" },
      data: chart.values.map((value, i) => ({ name: chart.labels[i], value })) }] };
  const series = chart.series || [{ type: chart.type, values: chart.values }];
  return { ...base,
    ...(chart.series ? { legend: { top: 0, selectedMode: false, textStyle: { width: 100, overflow: "break" } } } : {}),
    grid: { left: 28, right: 22, top: chart.series ? 62 : 38, bottom: 42, containLabel: true },
    xAxis: { type: "category", data: chart.labels, axisLabel: { interval: 0, rotate: chart.labels.length > 6 ? 35 : 0, width: 90, overflow: "break" } },
    yAxis: { type: "value", name: chart.unit, scale: false },
    series: series.map(item => ({ ...(item.name ? { name: item.name } : {}), type: item.type,
      data: item.values, barMaxWidth: 65, symbolSize: 7,
      label: { show: chart.labels.length <= 12, position: "top" } })) };
}
module.exports = { validateChart, validatePageCharts, chartOption, pageCharts, chartEvidenceIds };
