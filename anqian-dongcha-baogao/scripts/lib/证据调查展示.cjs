const { evidenceClosure } = require("./关系校验.cjs");
const { missing } = require("./证据规则.cjs");

const STATISTIC_FIELDS = { sample_size: "sample_size", population: "population",
  period: "survey_period", question: "question_wording" };

function validateSurveyDisplay(record, path, graph, add) {
  const surveys = evidenceClosure(record.evidence_ids || [], graph)
    .filter((e) => e.evidence_type === "consumer_survey");
  const statistic = !Array.isArray(record.values);
  if (statistic) {
    for (const [field, evidenceField] of Object.entries(STATISTIC_FIELDS)) {
      const provided = Object.hasOwn(record, field);
      if (!surveys.length) {
        if (provided) add("fatal", `${path}/${field}`, "survey_statistic_unlinked", "统计卡展示了调查信息，但没有可追溯的消费者调查证据", "引用对应调查；非调查数字不要附加调查样本信息");
        continue;
      }
      if (!provided) {
        add("fatal", `${path}/${field}`, "survey_statistic_missing", "调查统计卡缺少样本量、对象、时期或原始问法", `从引用调查的 ${evidenceField} 显式填写 ${field}，校验器不修改输入`);
        continue;
      }
      if (surveys.some((e) => record[field] !== e[evidenceField])) {
        add("fatal", `${path}/${field}`, "survey_statistic_mismatch", "统计卡调查信息与引用证据不一致，不能显示另一调查的样本或问法", "逐项使用原调查字段；多个调查口径不同应拆卡，不拼接样本量");
      }
    }
  }
  if (record.type === "pie" && surveys.length) {
    for (const survey of surveys) {
      if (survey.response_mode !== "single") add("fatal", path, "survey_pie_response_mode", "多选或开放题调查不能画饼图，合计100也不能豁免", "改用柱图或表格，保留原始问法和分母");
      if (missing(survey.denominator) || !Number.isFinite(survey.denominator_count) || survey.denominator_count <= 0) {
        add("fatal", path, "survey_pie_denominator", "调查饼图未登记明确的分母定义及分母人数", "在调查证据填写 denominator 与 denominator_count，不把样本量自动当成本题有效分母");
      }
    }
    const keys = ["source_id", "sample_size", "population", "survey_period", "question_wording", "response_mode",
      "weighting", "denominator", "denominator_count"];
    if (surveys.some((e) => keys.some((field) => e[field] !== surveys[0][field]))) {
      add("fatal", path, "survey_pie_incomparable", "饼图混入不同调查、问法、分母或加权口径", "只比较同一题同一分母下的互斥且完整选项；不同口径分开显示");
    }
  }
  add("warning", path, "numeric_label_unverified", "当前接口只检查数字、单位及引用集合，未建立标签到证据的逐点绑定，数值相等不能证明标签对应正确", "人工逐点核对标签、原文数值和证据编号；饼图还须确认类别互斥且完整，不宣称已自动完成语义核实");
}

module.exports = { validateSurveyDisplay };
