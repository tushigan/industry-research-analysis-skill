const test = require("node:test");
const assert = require("node:assert/strict");
const { validateResearch } = require("../scripts/验证研究数据.cjs");
const { migrateLegacy } = require("../scripts/迁移研究数据.cjs");
const { research, report, clientReady } = require("./fixtures/证据边界样本/研究样本.cjs");
const has = (result, code, severity = "fatal") => result.issues.some(i => i.code === code && i.severity === severity);
function table(rows, columns = ["指标", "值"], ready = true) {
  const d = ready ? clientReady() : research(), r = report();
  r.pages[0].table = { columns, rows };
  return { d, r, result: () => validateResearch(d, r) };
}
test("独立审查原复现：无据99%和绝对承诺同时阻断", () => {
  const { result } = table([["全国市场占有率", "99%"], ["结论", "本产品保证增长并导致所有消费者购买"]]);
  assert(has(result(), "claim_overreach")); assert(has(result(), "table_numeric_trace"));
  assert.equal(result().ok, false);
});
for (const value of ["99%", "约99％", "百分之九十九", "九成九", "99 percent", "99个百分点", "99万元", 99, "1:99", "99/100", "1e2%", "九十九家", "玖拾玖%", "十分之九"]) {
  test(`无据表格数字不可通过：${value}`, () => {
    assert(has(table([["全国市场份额", value]]).result(), "table_numeric_trace"));
  });
}
test("无据数字在内部稿也阻断，未复核字样不是历史豁免", () => {
  const { r, result } = table([["市场占有率", "99%"]], undefined, false);
  r.pages[0].body = ["历史原文转录，未复核，不代表当前事实或对客结论。"];
  assert(has(result(), "table_numeric_trace"));
});
test("表头、首列及图表/统计标签中的承诺均检查", () => {
  for (const sample of [table([["甲", "说明"]], ["保证增长", "值"]), table([["所有消费者购买", "说明"]])]) {
    assert(has(sample.result(), "claim_overreach"));
  }
  for (const kind of ["chart", "statistic"]) {
    const d = clientReady(), r = report();
    r.pages[0][kind] = kind === "chart" ? { type: "bar", labels: ["保证增长"], values: [19.9], unit: "CNY", evidence_ids: ["ev-002"] }
      : { label: "保证增长", value: 19.9, unit: "CNY", evidence_ids: ["ev-002"] };
    assert(has(validateResearch(d, r), "claim_overreach"));
    if (kind === "chart") r.pages[0].chart.labels = ["全国份额99%"];
    else r.pages[0].statistic.label = "全国份额99%";
    assert(has(validateResearch(d, r), "table_numeric_trace"));
  }
});
test("否定句不能掩盖同一单元格中的独立承诺", () => {
  assert(has(table([["结论", "尚未核实，但本产品保证增长"]]).result(), "claim_overreach"));
});
test("可追溯金额及列单位通过，但保留人工逐格核查警告", () => {
  for (const sample of [table([["标价", "19.9元"]]), table([["标价", 19.9]], ["指标", "价格（CNY）"])]) {
    assert.equal(sample.result().ok, true, JSON.stringify(sample.result().bySeverity.fatal));
    assert(has(sample.result(), "numeric_label_unverified", "warning"));
  }
  assert(has(table([["标价", "19.9美元"]]).result(), "table_numeric_trace"));
});
test("仅本页结构化证据支持数字，不从claim或其他页借值", () => {
  const { d, result } = table([["市场占有率", "99%"]]);
  d.evidence[0].value = 99; d.evidence[0].unit = "%";
  d.evidence[1].claim = "全国99%";
  assert(has(result(), "table_numeric_trace"));
});
test("不能吞掉小数点或额外单位，把不同口径误认为已追溯", () => {
  for (const value of [".19元", "19.9千元", "19.9元/吨", "19.9万美元"]) {
    assert(has(table([["价格", value]], ["项目", "金额（CNY）"]).result(), "table_numeric_trace"));
  }
  for (const value of ["九十九", "九十九比一", "占比九十九", "九十九 percent"]) {
    assert(has(table([["市场占比", value]]).result(), "table_numeric_trace"));
  }
});
test("比值与算式不能仅凭各操作数匹配冒充结果已追溯", () => {
  const { d, r, result } = table([["占比", "1/2"]], ["指标", "值（%）"]);
  Object.assign(d.evidence[1], { value: 1, unit: "%" });
  Object.assign(d.evidence[5], { value: 2, unit: "%" });
  for (const value of ["1/2", "1:2", "1比2", "1*2"]) {
    r.pages[0].table.rows[0][1] = value;
    assert(has(result(), "table_numeric_trace"));
  }
});
test("描述性编号允许字母前缀，不能把定量内容伪装成编号", () => {
  assert.equal(table([["row-0", "说明"]], ["编号", "说明"]).result().ok, true);
  assert(has(table([["99万元", "说明"]], ["编号", "说明"]).result(), "table_numeric_trace"));
});
test("演示规格与70行索引保持合法，不借此放行含比例的单元格", () => {
  const sample = table([["规格", "500g / 1 件", "单点"], ["页面价", "19.9 CNY", "当次条件"]], ["比较维度", "样本记录", "适用边界"]);
  assert.equal(sample.result().ok, true, JSON.stringify(sample.result().bySeverity.fatal));
  sample.r.pages[0].table.rows = Array.from({ length: 70 }, (_, i) => [String(i + 1), "匿名结构测试记录", "不代表实际商品"]);
  assert.equal(sample.result().ok, true);
  sample.r.pages[0].table.rows[30][1] = "市场份额99%";
  assert(has(sample.result(), "table_numeric_trace"));
  assert(has(table([["规格", "500g / 99%"]]).result(), "table_numeric_trace"));
});
test("序号、日期、规格和型号完整格式允许，借描述字段塞比例拒绝", () => {
  const good = table([[1, "2026-09-21", "500g × 2", "SKU-2026"], [2, "2026年9月22日", "250ml", "AB-99"]], ["序号", "日期", "规格", "型号"]);
  assert.equal(good.result().ok, true, JSON.stringify(good.result().bySeverity.fatal));
  for (const label of ["序号", "日期", "规格", "型号"]) {
    assert(has(table([["产品", "99%"]], ["项目", label]).result(), "table_numeric_trace"));
  }
  assert(has(table([[99, "说明"]], ["序号", "备注"]).result(), "table_numeric_trace"));
});
function historical() {
  return migrateLegacy({ id: "history-table", title: "匿名回放", date: "2020-01-01", attachments: [],
    sources: [{ id: "src-old", title: "匿名公开材料", publisher: "匿名", url: "https://example.com", period: "2019", scope: "待核" }],
    charts: [{ id: "chart-old", sourceIds: ["src-old"], unit: "%", option: { xAxis: { data: ["甲"] }, series: [{ type: "bar", data: [99] }] } }],
    pages: [{ id: "page-old", title: "历史转录", sourceIds: ["src-old"], blocks: [{ type: "chart", chartId: "chart-old" }] }] });
}
test("历史原配置逐格匹配只作内部警告，且未新增证据", () => {
  const { research: d, report: r } = historical(); const before = JSON.stringify(d);
  const result = validateResearch(d, r);
  assert.equal(result.ok, true, JSON.stringify(result.bySeverity.fatal));
  assert(has(result, "historical_table_unverified", "warning"));
  assert.equal(JSON.stringify(d), before); assert.equal(d.evidence.length, 0);
});
for (const edit of [({ report: r }) => { r.pages[0].table.rows[0][1] = "98"; },
  ({ research: d }) => { d.storyline[0].speaker_notes = "未复核"; },
  ({ report: r }) => { r.pages[0].body = ["正式结论"]; },
  ({ research: d }) => { d.project.status = "formal_delivery"; },
  ({ research: d }) => { d.points_of_view[0].status = "client_ready"; }]) {
  test("历史豁免不能用于改值、无配置、无提示或对客状态", () => {
    const sample = historical(); edit(sample);
    assert(has(validateResearch(sample.research, sample.report), "table_numeric_trace"));
  });
}
test("历史转录不豁免绝对断言", () => {
  const { research: d, report: r } = historical(); r.pages[0].table.rows[0][2] = "保证增长";
  assert(has(validateResearch(d, r), "claim_overreach"));
});
test("历史原表可逐格追溯；损坏原JSON仅取消例外，不抛异常", () => {
  const old = { id: "old", title: "旧表", date: "2020", sources: [], charts: [], attachments: [],
    pages: [{ id: "p", title: "旧表", sourceIds: [], blocks: [{ type: "table", headers: ["指标", "值"], rows: [["占比", "99%"]] }] }] };
  const { research: d, report: r } = migrateLegacy(old);
  assert.equal(validateResearch(d, r).ok, true);
  assert(has(validateResearch(d, r), "historical_table_unverified", "warning"));
  d.storyline[0].speaker_notes = r.pages[0].speaker_notes = r.pages[0].speaker_notes.replace('"headers"', 'broken');
  assert(has(validateResearch(d, r), "table_numeric_trace"));
  for (const value of [null, { columns: ["指标"], rows: [null] }, { columns: ["指标"], rows: [[{}]] }]) {
    r.pages[0].table = value;
    assert.doesNotThrow(() => validateResearch(d, r)); assert.equal(validateResearch(d, r).ok, false);
  }
});
