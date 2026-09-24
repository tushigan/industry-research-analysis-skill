const { validateDocument } = require("./schema-validator.cjs");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === "string" && value.trim() ? value : "未披露";
const original = value => value === undefined ? "未披露" : typeof value === "string" ? value : JSON.stringify(value);
const axis = (value, index = 0) => Array.isArray(value) ? value[index] : value;

function readSnapshot(notes, prefix) {
  const blocks = notes.split("\n\n").filter(part => part.startsWith(prefix));
  if (blocks.length !== 1) return null;
  try { return JSON.parse(blocks[0].slice(prefix.length)); } catch { return null; }
}

// Reconstruct only the archived display, never promote its numbers to evidence.
function historicalTable(page, story, pov, research, strict) {
  if (strict || pov?.status !== "draft" || research.project.status !== "internal_draft" ||
      story.page_status !== "research_stage" || page.speaker_notes !== story.speaker_notes ||
      ![].concat(page.body || []).some(line => /历史.*未复核/.test(line))) return false;
  const blocks = readSnapshot(story.speaker_notes, "历史内容块原文：");
  const charts = readSnapshot(story.speaker_notes, "历史图表配置（未复核，不代表重新制图）：");
  const arraySchema = { type: "array", items: { type: "object" } };
  if (validateDocument(blocks, arraySchema).length || validateDocument(charts, arraySchema).length) return false;
  const ids = [...new Set(blocks.filter(b => b.type === "chart").map(b => b.chartId))];
  if (!ids.length) return blocks.some(b => b.type === "table" && same(page.table, { columns: b.headers, rows: b.rows }));
  const chartSchema = { type: "object", required: ["id", "option"], properties: {
    id: { type: "string" }, option: { type: "object", properties: {
      series: { type: "array", items: { type: "object", properties: { data: { type: "array" } } } }
    } }
  } };
  if (charts.length !== ids.length || new Set(charts.map(c => c.id)).size !== charts.length ||
      charts.some(c => validateDocument(c, chartSchema).length || !ids.includes(c.id))) return false;
  const rows = [];
  for (const id of ids) {
    const chart = charts.find(c => c.id === id), start = rows.length;
    list(chart.option.series).forEach((series, s) => {
      const x = axis(chart.option.xAxis, series.xAxisIndex), y = axis(chart.option.yAxis, series.yAxisIndex);
      const labels = list(x?.data).length ? x.data : list(y?.data);
      const units = [`原声明：${text(chart.unit)}`, `横轴：${text(x?.name)}`, `纵轴：${text(y?.name)}`].join("；");
      list(series.data).forEach((item, i) => {
        const object = item !== null && typeof item === "object" && !Array.isArray(item);
        rows.push([`${chart.id} / ${series.name || `系列${s + 1}`} / ${original(labels[i])}`,
          original(object ? item.value : item), original(object ? item.name : undefined), units]);
      });
    });
    if (start === rows.length) rows.push([chart.id, "未披露", "无可转录数据；原配置见迁移记录", text(chart.unit)]);
  }
  return same(page.table, { columns: ["历史图 / 系列 / 项目", "原始绘图值", "原始标签", "单位 / 轴名称"], rows });
}

module.exports = { historicalTable };
