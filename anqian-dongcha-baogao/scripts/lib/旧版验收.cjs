'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { writeJson, outputLocation } = require('./输入安全.cjs');
const { hashFile } = require('./输入指纹.cjs');
const { python } = require('./运行依赖.cjs');
const { verifyLegacy, legacyInputs, copyInputs, outputHashes } = require('./旧版交付.cjs');
const { checkChartRatio, checkPlanAlignment } = require('./图表占比.cjs');
const { requiresChartGate } = require('./制作模式.cjs');

function finalPlanAlignment(record, chartRatio, actualCounts = null) {
  if (!record.chart_plan) return null;
  return chartRatio.plan_alignment || (actualCounts
    ? checkPlanAlignment(record.chart_plan, actualCounts.html, actualCounts.pdf)
    : { matched: Boolean(record.chart_plan.alignment?.matched),
      errors: record.chart_plan.alignment?.matched ? [] : ['最终HTML物理页序与生成前方案不一致'] });
}

async function acceptChartOnly(root, reviewPath) {
  const { manifest, record } = verifyLegacy(root);
  if (!requiresChartGate({ delivery_scope: record.delivery_scope }, record.production_mode) || !record.chart_plan) {
    throw new Error('本次兼容交付不是带图表规划门禁的完整新稿');
  }
  const technical = JSON.parse(fs.readFileSync(path.join(root, '验收/完整验收.json'), 'utf8'));
  if (technical.status !== 'technical_passed') throw new Error('尚无可复用的当次技术验收，不能只跑图表门禁');
  const browser = JSON.parse(fs.readFileSync(path.join(root, '验收/验收结果.json'), 'utf8'));
  const pdf = JSON.parse(fs.readFileSync(path.join(root, '验收/PDF验收结果.json'), 'utf8'));
  const htmlSha256 = hashFile(path.join(root, '案前洞察.html'));
  const pdfSha256 = hashFile(path.join(root, '案前洞察.pdf'));
  const receiptsMatch = browser.status === 'passed' && pdf.status === 'passed' &&
    browser.htmlSha256 === htmlSha256 && browser.pdf?.sha256 === pdfSha256 &&
    pdf.htmlSha256 === htmlSha256 && pdf.pdfSha256 === pdfSha256 &&
    technical.input_fingerprint === record.input_fingerprint;
  if (!receiptsMatch) {
    throw new Error('HTML或PDF已变化，不能沿用旧技术验收；请重跑完整验收');
  }
  const chartRatio = await checkChartRatio({ project: path.dirname(record.reportPath), review: reviewPath });
  writeJson(path.join(root, '验收/图表占比检查.json'), chartRatio);
  const planAligned = finalPlanAlignment(record, chartRatio)?.matched;
  const gatePassed = Boolean(planAligned && chartRatio.passed);
  const quality = gatePassed ? 'chart_ratio_passed_pending_business_review' : 'planned_pending_actual_review';
  writeJson(path.join(root, '验收/完整验收.json'), { ...technical, chart_ratio: chartRatio,
    quality_status: quality, delivery_status: gatePassed ? 'blocked_pending_content_visual_business_review'
      : planAligned ? 'blocked_by_chart_ratio' : 'blocked_by_chart_plan_alignment' });
  record.status = gatePassed ? 'technical_passed' : 'blocked';
  record.quality_status = quality;
  record.outputs = outputHashes(root);
  writeJson(path.join(root, '成品清单.json'), manifest);
  return { status: gatePassed ? 'chart_gate_passed' : 'chart_gate_blocked',
    technical_status: 'technical_passed', chart_ratio: chartRatio,
    content_review: 'manual_review', visual_review: 'manual_review', business_approval: 'not_granted' };
}

async function acceptLegacy(outputDir, options = {}) {
  const root = outputLocation(outputDir);
  if (options.chartOnly) return acceptChartOnly(root, options.reviewPath);
  const { manifest, record, input } = verifyLegacy(root);
  const chartGateRequired = requiresChartGate({ delivery_scope: record.delivery_scope }, record.production_mode);
  const originalOutputs = structuredClone(record.outputs);
  record.status = 'running';
  delete record.failure;
  writeJson(path.join(root, '成品清单.json'), manifest);
  let stage, backup;
  try {
    stage = fs.mkdtempSync(path.join(path.dirname(root), '.原版验收-'));
    copyInputs(input, stage);
    const delivery = path.join(stage, '交付'), checks = path.join(delivery, '验收');
    fs.cpSync(root, delivery, { recursive: true, errorOnExist: true, force: false });
    const browser = await require('../兼容引擎/验收报告.cjs').run(stage, true, { delivery, output: checks });
    const pdf = JSON.parse(python([path.join(__dirname, '../兼容引擎/检查PDF.py'), stage, '--delivery', delivery, '--checks', checks]));
    verifyLegacy(root);
    if (legacyInputs(record.reportPath, record.researchPath, record.chart_plan?.source_path || null,
      record.production_mode).fingerprint !== record.input_fingerprint) throw new Error('验收期间原输入变化');
    let chartRatio = { status: 'quality_not_revalidated', passed: null };
    if (chartGateRequired) {
      chartRatio = { status: 'missing_registration', registration_valid: false, passed: false,
        errors: ['完整新稿缺少本轮图表占比登记，不能完成交付'] };
      writeJson(path.join(checks, '图表占比检查.json'), chartRatio);
    }
    if (chartGateRequired) chartRatio.plan_alignment = checkPlanAlignment(record.chart_plan, browser.pages,
      Array.isArray(pdf.checks) ? pdf.checks.length : pdf.pages);
    const planAligned = finalPlanAlignment(record, chartRatio)?.matched;
    const gatePassed = Boolean(chartGateRequired && planAligned && chartRatio.passed);
    const result = { status: 'technical_passed', mode: record.format, production_mode: record.production_mode,
      delivery_scope: record.delivery_scope,
      pages: browser.pages,
      charts: manifest.charts, images: browser.images.length, attachments: browser.documents.length,
      browser: browser.status, pdf: pdf.status, input_fingerprint: record.input_fingerprint,
      quality_status: chartGateRequired
        ? gatePassed ? 'chart_ratio_passed_pending_business_review' : 'planned_pending_actual_review'
        : 'quality_not_revalidated', chart_ratio: chartRatio,
      delivery_status: chartGateRequired
        ? gatePassed ? 'blocked_pending_content_visual_business_review'
          : planAligned ? 'blocked_by_chart_ratio' : 'blocked_by_chart_plan_alignment'
        : 'blocked_pending_content_visual_business_review',
      content_review: 'manual_review', visual_review: 'manual_review', business_approval: 'not_granted' };
    writeJson(path.join(checks, '完整验收.json'), result);
    record.status = chartGateRequired && !gatePassed ? 'blocked' : 'technical_passed';
    record.quality_status = result.quality_status; record.outputs = outputHashes(delivery);
    writeJson(path.join(delivery, '成品清单.json'), manifest);
    backup = `${stage}-previous`; fs.renameSync(root, backup);
    fs.renameSync(delivery, root);
    return result;
  } catch (error) {
    if (backup && !fs.existsSync(root)) fs.renameSync(backup, root);
    record.status = 'failed'; record.failure = error.message; record.outputs = originalOutputs;
    writeJson(path.join(root, '成品清单.json'), manifest);
    throw error;
  } finally { if (stage) fs.rmSync(stage, { recursive: true, force: true }); }
}
module.exports = { acceptLegacy, acceptChartOnly };
