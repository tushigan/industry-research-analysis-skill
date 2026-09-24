"use strict";
const { escapeHTML: esc } = require("./渲染安全.cjs");

// Conservative character budgets establish physical pages before the browser/PDF pass.
function textHeight(text, width, font = 17, line = 29) {
  const lines = String(text).split("\n").reduce((sum, part) => sum + Math.max(1, Math.ceil(Array.from(part).length / Math.floor(width / font))), 0);
  return lines * line + 16;
}
function textBlocks(text, width, className = "body-text", font = 17, line = 29) {
  const result = [];
  for (const paragraph of (Array.isArray(text) ? text : [text]).filter(Boolean)) {
    const chars = Array.from(String(paragraph));
    const size = Math.max(80, Math.floor(width / font) * 7);
    for (let i = 0; i < chars.length; i += size) {
      const chunk = chars.slice(i, i + size).join("");
      result.push({ html: `<p class="${className}">${esc(chunk)}</p>`, height: textHeight(chunk, width, font, line) });
    }
  }
  return result;
}
function tableBlocks(table, width, capacity) {
  if (!Array.isArray(table.columns) || !table.columns.length || table.columns.length > 8 ||
      table.columns.some(x => typeof x !== "string") || !Array.isArray(table.rows)) throw new Error("表格需要 1 至 8 个文字列名与二维 rows");
  const cellWidth = width / table.columns.length - 24;
  const rowHeight = row => Math.max(...row.map(x => textHeight(x, cellWidth, 15, 25))) + 8;
  const headerHeight = rowHeight(table.columns);
  const head = `<thead><tr>${table.columns.map(x => `<th scope="col">${esc(x)}</th>`).join("")}</tr></thead>`;
  const blocks = []; let rows = [], height = headerHeight + 18;
  const flush = () => {
    blocks.push({ html: `<table>${head}<tbody>${rows.join("")}</tbody></table>`, height });
    rows = []; height = headerHeight + 18;
  };
  for (const row of table.rows) {
    if (!Array.isArray(row) || row.length !== table.columns.length || row.some(x => x !== null && !["string", "number", "boolean"].includes(typeof x))) {
      throw new Error("表格行必须与列数一致且只能包含文字、数字、布尔值或空值");
    }
    const h = rowHeight(row);
    if (h + headerHeight + 18 > capacity) throw new Error("表格单行超出一页，请缩短单元格或拆分数据记录");
    if (rows.length && height + h > capacity) flush();
    rows.push(`<tr>${row.map(x => `<td>${esc(x)}</td>`).join("")}</tr>`); height += h;
  }
  if (rows.length || !table.rows.length) flush();
  return blocks;
}
function paginate(blocks, capacity) {
  const pages = []; let current = [], used = 0;
  for (const block of blocks) {
    if (block.height > capacity) throw new Error("单个内容块超出页面容量，请拆分配置");
    if (current.length && used + block.height > capacity) { pages.push(current); current = []; used = 0; }
    current.push(block); used += block.height;
  }
  if (current.length || !pages.length) pages.push(current);
  return pages;
}
module.exports = { textHeight, textBlocks, tableBlocks, paginate };
