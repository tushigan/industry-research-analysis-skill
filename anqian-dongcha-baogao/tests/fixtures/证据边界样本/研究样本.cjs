const base = require("../基础有效样本/研究数据.json");
const config = require("../基础有效样本/报告.json");
const clone = (value) => JSON.parse(JSON.stringify(value));
function research() { return clone(base); }
function report() { return clone(config); }
function clientReady() {
  const data = research();
  const review = { status: "reviewed", reviewer: "匿名测试审校者", basis: "仅用于门禁技术测试，不代表真实人工业务验收" };
  data.project.status = "client_discussion";
  data.evidence.forEach((e) => { e.review_status = "reviewed"; });
  data.questions.forEach((q) => { q.status = "answered"; });
  for (const records of [data.hypotheses, data.mechanisms, data.points_of_view, data.storyline]) {
    records.forEach((record) => { record.content_review = clone(review); });
  }
  data.hypotheses[0].status = "client_ready";
  data.points_of_view[0].status = "client_ready";
  data.storyline[0].page_status = "client_discussion";
  return data;
}
function surveyVisualization() {
  const data = research(); const config = report();
  const survey = data.evidence[0];
  Object.assign(survey, { value: 50, unit: "%" });
  const other = { ...survey, evidence_id: "ev-survey-2", claim: "另一选项占比" };
  data.evidence.push(other);
  data.points_of_view[0].evidence_ids = [survey.evidence_id, other.evidence_id];
  data.storyline[0].evidence_ids = [...data.points_of_view[0].evidence_ids];
  data.storyline[0].source_ids = [survey.source_id];
  config.pages[0].source_ids = [survey.source_id];
  config.pages[0].statistic = { value: 50, unit: "%", label: "技术样本选项占比", evidence_ids: [survey.evidence_id],
    sample_size: survey.sample_size, population: survey.population, period: survey.survey_period, question: survey.question_wording };
  return { data, config, survey, other };
}
module.exports = { research, report, clientReady, surveyVisualization };
