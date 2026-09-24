const { reviewedEvidence } = require("./证据规则.cjs");
const { historicalTable } = require("./研究历史表格.cjs");
const numberPattern = /[-+]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:e[-+]?\d+)?/gi;
const chinese = "零〇一二两三四五六七八九十百千万亿壹贰貳叁參肆伍陆陸柒捌玖拾佰仟";
const unitPattern = /^[A-Za-z%\u4e00-\u9fff]+(?:\/[A-Za-z\u4e00-\u9fff]+)?/;
const normalize = value => String(value ?? "").normalize("NFKC").trim();
const unitName = value => value.split("/").map(part => ({ "元": "CNY", "人民币": "CNY", "美元": "USD", "percent": "%" })[part.toLowerCase()] || part).join("/");

function descriptive(value, heading, index) {
  if (/[%％]|百分|percent|成|比率|占比/i.test(value)) return false;
  if (/^(序号|编号|序)$/.test(heading) && /^\d+$/.test(value)) return Number(value) === index + 1;
  if (/^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{4}年\d{1,2}月(?:\d{1,2}日)?)$/.test(value)) return true;
  if (/^(日期|年份|年度|时期|统计期|时间)$/.test(heading) && /^\d{4}(?:年)?$/.test(value)) return true;
  if (/^(规格|包装规格|净含量|尺寸)$/.test(heading) && /^\d+(?:\.\d+)?\s*(?:kg|g|ml|l|克|千克|毫升|升|mm|cm)(?:\s*(?:[x×*]\s*\d+\s*(?:袋|盒|包|件)?|\/\s*\d+\s*(?:袋|盒|包|件)))?$/i.test(value)) return true;
  if (/^(编号|型号|产品编号|SKU)$/i.test(heading) && /^[A-Za-z]+[-_][A-Za-z0-9-]+$/.test(value)) return true;
  return /^(?:选项|样本|系列)[A-Za-z]?\d+$/.test(value);
}

function tokens(value, context) {
  const text = value;
  const parenthesized = context.match(/[（(]([^()（）]+)[）)]/);
  const fallback = parenthesized?.[1] || context.match(/(?:CNY|USD|万元|亿元|元|%|kg|ml|人数|家数)/)?.[0];
  const inherited = ({ 人数: "人", 家数: "家" })[fallback] || fallback;
  return Array.from(text.matchAll(numberPattern), match => ({ value: Number(match[0].replaceAll(",", "")),
    unit: unitName(text.slice(match.index + match[0].length).trimStart().match(unitPattern)?.[0] || inherited || "") }));
}

function validateDisplays(page, story, pov, research, graph, strict, path, add, checkExpression) {
  const ids = story.evidence_ids;
  const evidence = ids.map(id => graph.evidence.get(id)).filter(Boolean);
  const historical = page.table && historicalTable(page, story, pov, research, strict);
  let quantitative = false;
  function cell(value, heading, rowLabel, index, location, legacy = false) {
    const text = normalize(value);
    // Negation in one clause must not hide a separate positive claim.
    text.split(/[，,]|但是|但|然而/).forEach(clause => checkExpression(clause, null, location, add, strict));
    if (descriptive(text, heading, index) || descriptive(text, rowLabel, index)) return;
    const chineseQuantity = new RegExp(`(?:百分之|千分之|万分之)[${chinese}]+|[${chinese}]+(?:成|分之|个百分点|家|人|个|件|倍|元|吨|%|percent)|^[${chinese}]+$`).test(text) ||
      (/占比|份额|比例|percent/.test(`${text} ${heading} ${rowLabel}`) && new RegExp(`[${chinese}]+`).test(text));
    if (chineseQuantity) {
      quantitative = true;
      if (!legacy) add('fatal', location, 'table_numeric_trace', '不自动换算中文数量级、成数或分数，不能据此声称数值已追溯', '改为人工复算后的阿拉伯数字及完整单位，再逐值核对证据');
      return;
    }
    const numbers = tokens(text, `${heading} ${rowLabel}`);
    if (!numbers.length) {
      if (/[%‰‱]|percent|百分之|千分之|万分之|分之/i.test(text) && /[零〇一二两三四五六七八九十百千万亿壹贰貳叁參肆伍陆陸柒捌玖拾佰仟]/.test(text)) {
        add("fatal", location, "table_numeric_trace", "比例使用了不能可靠解析的数值写法，不能跳过证据追溯", "改为明确数值和单位，并逐值引用证据");
      }
      return;
    }
    quantitative = true;
    const expression = /\d\s*[:/比*×÷]\s*[-+]?\d/.test(text);
    const matched = !expression && numbers.every(n => n.unit && evidence.some(e => {
      const v = e.value ?? e.observed_price, unit = unitName(normalize(e.unit || e.currency || ""));
      return Number.isFinite(v) && unit === n.unit && Math.abs(v - n.value) <= 1e-9;
    }));
    if (!matched && !legacy) add("fatal", location, "table_numeric_trace", "表格或图表标签中的数字/单位没有对应本页结构化证据", "逐值登记真实证据与单位；不能把表格、备注或原配置当作已核实证据");
  }
  if (page.table) {
    const { columns, rows } = page.table;
    const ordered = columns[0] === "比较维度" && rows.length > 1 && rows.every((row, i) => normalize(row[0]) === String(i + 1));
    columns.forEach((label, j) => cell(label, "", "", -1, `${path}/table/columns/${j}`, historical));
    rows.forEach((row, i) => {
      if (row.length !== columns.length) add("fatal", `${path}/table/rows/${i}`, "table_shape", "表格行与列数不一致");
      row.forEach((value, j) => cell(value, ordered && j === 0 ? "序号" : columns[j] || "", typeof row[0] === "string" ? row[0] : "", i, `${path}/table/rows/${i}/${j}`, historical));
    });
    if (historical) add("warning", `${path}/table`, "historical_table_unverified", "历史表格与保存的原配置一致，但原值未复核，仅允许内部转录，不构成研究证据", "回到原始来源核对数值、单位和计算，再建立逐值证据；不得对客使用此例外");
  }
  if (page.chart) {
    page.chart.labels.forEach((label, i) => cell(label, "年份", "", -1, `${path}/chart/labels/${i}`));
    checkExpression(page.chart.unit, null, `${path}/chart/unit`, add, strict);
  }
  if (page.statistic) cell(page.statistic.label, "", "", -1, `${path}/statistic/label`);
  if (quantitative && !historical) reviewedEvidence(ids, graph, strict, path, add);
  if (page.table && quantitative) add("warning", `${path}/table`, "numeric_label_unverified", "表格数字匹配不证明指标、标签、时期及分母对应，当前表格接口没有逐单元格证据绑定", "人工逐格核对原文与证据，不宣称自动语义核实");
}

module.exports = { validateDisplays };
