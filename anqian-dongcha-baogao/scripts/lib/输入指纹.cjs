const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { localFile, readJson, writeJson, assertOutputTree } = require('./输入安全.cjs');
const { validateDocument } = require('./schema-validator.cjs');
const { resolveProductionMode, requiresChartGate } = require('./制作模式.cjs');
const { validateResearch } = require('../验证研究数据.cjs');
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hashFile = file => sha256(fs.readFileSync(file));

function packageFingerprint() {
  const root = path.resolve(__dirname, '../..');
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) files.push([path.relative(root, file), hashFile(file)]);
      else throw new Error('构建工具包不能包含符号链接');
    }
  }
  for (const dir of ['scripts', 'assets', 'schemas']) walk(path.join(root, dir));
  files.push(['VERSION.json', hashFile(path.join(root, 'VERSION.json'))]);
  return sha256(JSON.stringify(files));
}
function fingerprintInputs(researchPath, reportPath, audienceMode = null, chartPlanPath = null, productionMode = null) {
  const config = readJson(reportPath);
  const resolvedAudienceMode = audienceMode || config.audience_mode || 'client';
  const root = path.dirname(fs.realpathSync(reportPath));
  const rows = [['研究数据', hashFile(researchPath)], ['报告配置', hashFile(reportPath)],
    ['audience_mode', resolvedAudienceMode], ['production_mode', productionMode || config.production_mode || 'new_report']];
  if (chartPlanPath) rows.push(['逐页图形方案', hashFile(chartPlanPath)]);
  for (const page of config.pages || []) {
    if (page.image?.path) rows.push([`image:${page.image.path}`, hashFile(localFile(root, page.image.path))]);
  }
  for (const item of config.attachments || []) {
    if (item.path) rows.push([`attachment:${item.path}`, hashFile(localFile(root, item.path))]);
  }
  rows.push(['builder', packageFingerprint()]);
  return { fingerprint: sha256(JSON.stringify(rows)), files: rows };
}
function verifyOutputs(root, manifest) {
  assertOutputTree(root);
  const errors = validateDocument(manifest, require('../../schemas/成品清单.schema.json'));
  if (errors.length) throw new Error(`成品清单结构错误：${JSON.stringify(errors)}`);
  for (const [kind, file] of [['html', '案前洞察.html'], ['research_data', '研究数据.json'],
    ['report_config', '报告配置.json'], ['speaker_notes', '逐页讲解备注.md']]) {
    const matches = manifest.outputs.filter(item => item.kind === kind);
    if (matches.length !== 1 || matches[0].path !== file) throw new Error(`成品清单缺少或重复必要输出：${kind}`);
  }
  if (new Set(manifest.outputs.map(item => item.path)).size !== manifest.outputs.length) throw new Error('成品清单输出路径重复');
  if (fs.readFileSync(localFile(root, '案前洞察.html'), 'utf8').includes('href="研究底稿.html#')) {
    const notes = manifest.outputs.filter(item => item.kind === 'research_notes');
    if (notes.length !== 1 || notes[0].path !== '研究底稿.html') throw new Error('成品清单缺少或重复必要输出：research_notes');
  }
  for (const item of manifest.outputs) {
    const file = localFile(root, item.path);
    if (hashFile(file) !== item.sha256) throw new Error(`成品内容变化：${item.path}`);
  }
}

function chartPlanSummary(plan, fromRecord = false) {
  if (!plan) return null;
  const precheck = fromRecord ? plan.precheck : plan;
  return {
    plan_id: plan.plan_id,
    source_sha256: plan.source_sha256,
    expected_page_count: precheck?.expected_page_count,
    expected_qualified: fromRecord ? precheck?.qualified : plan.expected_qualified,
    minimum: precheck?.minimum,
    target: precheck?.target,
    alignment: plan.alignment
  };
}

function verifyChartPlanContract(root, manifest, record) {
  const report = readJson(record.reportPath);
  const research = readJson(record.researchPath);
  const validation = validateResearch(research, report);
  if (!validation.ok) {
    const fatal = validation.issues.filter(issue => issue.severity === 'fatal');
    throw new Error(`源研究与报告语义校验失败：${fatal.map(issue => `${issue.code}:${issue.message}`).join('；')}`);
  }
  const deliveredReport = readJson(localFile(root, '报告配置.json'));
  if (JSON.stringify(deliveredReport) !== JSON.stringify(report)) {
    throw new Error('交付内报告配置与当前源报告不一致：原始输入已变化，必须重建');
  }
  const deliveredReportHash = hashFile(localFile(root, '报告配置.json'));
  const sourceReportHash = hashFile(record.reportPath);
  const recordedReportHashes = record.files.filter(row => Array.isArray(row) && row[0] === '报告配置');
  if (recordedReportHashes.length !== 1 || recordedReportHashes[0][1] !== sourceReportHash ||
      deliveredReportHash !== sourceReportHash) {
    throw new Error('报告配置副本、源报告和构建记录指纹不一致：输入已变化，必须重新构建');
  }
  const mode = resolveProductionMode(report, record.production_mode);
  if (manifest.delivery_scope !== record.delivery_scope) {
    throw new Error('构建记录与成品清单交付范围不一致');
  }
  if (record.delivery_scope !== report.delivery_scope) {
    throw new Error('构建记录与报告交付范围不一致');
  }
  const required = requiresChartGate({ delivery_scope: record.delivery_scope }, mode);
  const manifestHasPlan = Boolean(manifest.chart_plan);
  const recordHasPlan = Boolean(record.chart_plan);
  if (manifestHasPlan !== recordHasPlan) throw new Error('构建记录与成品清单图表方案记录不一致');
  if (required && !manifestHasPlan) {
    throw new Error('完整新稿或内容修订缺少图表方案记录，拒绝降级为未重新证明质量');
  }
  if (!required && manifestHasPlan) {
    throw new Error('纯转换、历史回放或代表页不应登记完整新稿图表方案');
  }
  if (!manifestHasPlan) return { required, report };
  if (JSON.stringify(chartPlanSummary(manifest.chart_plan)) !==
      JSON.stringify(chartPlanSummary(record.chart_plan, true))) {
    throw new Error('构建记录与成品清单图表方案内容不一致');
  }
  const planOutputs = manifest.outputs.filter(item => item.kind === 'chart_plan');
  if (planOutputs.length !== 1 || planOutputs[0].path !== '验收/逐页图形方案.json') {
    throw new Error('成品清单缺少或重复逐页图形方案输出');
  }
  const deliveredPlan = readJson(localFile(root, planOutputs[0].path));
  const sourcePlan = readJson(record.chart_plan.source_path);
  if (JSON.stringify(deliveredPlan) !== JSON.stringify(sourcePlan)) {
    throw new Error('交付内逐页图形方案与生成前方案不一致');
  }
  return { required, report };
}

function verifyVersion(root) {
  if (require('./旧版交付.cjs').isLegacyDelivery(root)) return require('./旧版交付.cjs').verifyLegacy(root);
  assertOutputTree(root);
  const manifest = readJson(path.join(root, '成品清单.json'));
  const record = readJson(path.join(root, '验收/构建记录.json'));
  if (record.input_fingerprint !== manifest.input_fingerprint) throw new Error('构建记录与成品清单指纹不一致');
  if (record.audience_mode !== manifest.audience_mode) throw new Error('构建记录与成品清单用途不一致');
  if (record.production_mode !== manifest.production_mode) throw new Error('构建记录与成品清单制作模式不一致');
  verifyChartPlanContract(root, manifest, record);
  verifyOutputs(root, manifest);
  const current = fingerprintInputs(record.researchPath, record.reportPath, record.audience_mode,
    record.chart_plan?.source_path || null, record.production_mode);
  if (current.fingerprint !== manifest.input_fingerprint) throw new Error('输入或构建器已经变化，请重新构建，不能沿用旧验收');
  return { manifest, record };
}
function beginAcceptance(root) {
  const result = verifyVersion(root);
  result.manifest.outputs = result.manifest.outputs.filter(item => item.kind !== 'acceptance_report');
  result.manifest.status = 'draft';
  result.manifest.acceptance.overall_status = 'not_run';
  for (const check of result.manifest.acceptance.checks) {
    if (['browser', 'pdf', 'visual', 'version'].includes(check.layer)) check.status = 'not_run';
  }
  writeJson(path.join(root, '成品清单.json'), result.manifest);
  return result;
}
module.exports = { sha256, hashFile, packageFingerprint, fingerprintInputs, verifyOutputs, verifyVersion,
  verifyChartPlanContract, beginAcceptance };
