'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson, localFile, outputLocation, assertOutputTree } = require('./输入安全.cjs');
const { hashFile, packageFingerprint, sha256 } = require('./输入指纹.cjs');
const { validateLegacy, legacyFiles } = require('./旧版输入.cjs');
const { feedbackFromIssues } = require('./客户成稿.cjs');
const FORMAT = 'legacy-preserved-v1';
const { resolveProductionMode, requiresChartGate } = require('./制作模式.cjs');
const { checkChartPlan, comparePlanToActual } = require('./图表方案.cjs');

function legacyInputs(reportPath, researchPath, chartPlanPath = null, productionMode = null) {
  const source = fs.realpathSync(reportPath), root = path.dirname(source);
  const config = validateLegacy(readJson(source), root);
  const resolvedProductionMode = resolveProductionMode(config, productionMode, { legacy: true });
  const files = [['报告.json', hashFile(source)], ...legacyFiles(config).map(name => [name, hashFile(localFile(root, name))])];
  if (researchPath) {
    readJson(fs.realpathSync(researchPath));
    files.push(['结构化研究底稿', hashFile(fs.realpathSync(researchPath))]);
  }
  if (chartPlanPath) files.push(['逐页图形方案', hashFile(fs.realpathSync(chartPlanPath))]);
  files.push(['production_mode', resolvedProductionMode]);
  files.push(['delivery_scope', config.delivery_scope]);
  files.push(['builder', packageFingerprint()]);
  return { config, source, root, files, fingerprint: sha256(JSON.stringify(files)),
    productionMode: resolvedProductionMode, deliveryScope: config.delivery_scope };
}
function copyInputs(input, stage) {
  fs.copyFileSync(input.source, path.join(stage, '报告.json'));
  const copied = new Set();
  for (const name of legacyFiles(input.config)) {
    const target = path.join(stage, name);
    if (copied.has(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(localFile(input.root, name), target, fs.constants.COPYFILE_EXCL);
    copied.add(target);
  }
}
function outputHashes(root) {
  const result = [];
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      if (name === '成品清单.json') continue;
      if (entry.isDirectory()) walk(name);
      else result.push({ path: name, sha256: hashFile(localFile(root, name)) });
    }
  }
  assertOutputTree(root); walk(''); return result;
}
function isLegacyDelivery(root) {
  const file = path.join(root, '成品清单.json');
  return fs.existsSync(file) && readJson(file).compatibility?.format === FORMAT;
}
function verifyLegacy(root) {
  assertOutputTree(root);
  const manifest = readJson(path.join(root, '成品清单.json')), record = manifest.compatibility;
  if (record?.format !== FORMAT) throw new Error('缺少原版兼容交付记录');
  const input = legacyInputs(record.reportPath, record.researchPath, record.chart_plan?.source_path || null,
    record.production_mode);
  const resolvedMode = input.productionMode;
  if (!['complete', 'preview'].includes(record.delivery_scope)) {
    throw new Error('兼容交付记录缺少合法 delivery_scope 交付范围');
  }
  if (record.delivery_scope !== input.deliveryScope) throw new Error('兼容交付记录与源报告交付范围不一致');
  if (JSON.stringify(readJson(path.join(root, '研究数据.json'))) !== JSON.stringify(input.config)) {
    throw new Error('兼容交付内报告配置与当前源报告不一致：原始输入已变化，必须重建');
  }
  const requiresGate = requiresChartGate({ delivery_scope: record.delivery_scope }, resolvedMode);
  if (requiresGate && !record.chart_plan) throw new Error('兼容完整新稿或内容修订缺少图表方案记录');
  if (!requiresGate && record.chart_plan) throw new Error('纯转换或历史回放不应登记完整新稿图表方案');
  if (input.fingerprint !== record.input_fingerprint) throw new Error('原版输入、资产或构建器已变化，必须重建');
  if (record.chart_plan) {
    if (!record.chart_plan.source_path || hashFile(record.chart_plan.source_path) !== record.chart_plan.source_sha256) {
      throw new Error('逐页图形方案已经变化，必须重建');
    }
    if (!record.researchPath) throw new Error('兼容完整新稿或内容修订缺少结构化研究底稿记录');
    const plan = readJson(record.chart_plan.source_path), research = readJson(record.researchPath);
    const report = { report_config_id: input.config.id, production_mode: resolvedMode,
      delivery_scope: record.delivery_scope,
      pages: input.config.pages.map(page => ({ page_id: page.id })) };
    const precheck = checkChartPlan({ plan, research, report });
    const alignment = comparePlanToActual(plan, input.config.pages.map(page => ({ id: page.id })));
    const expected = { plan_id: plan.plan_id, source_sha256: hashFile(record.chart_plan.source_path),
      expected_page_count: precheck.expected_page_count, expected_qualified: precheck.qualified,
      minimum: precheck.minimum, target: precheck.target, alignment };
    const actual = { plan_id: record.chart_plan.plan_id, source_sha256: record.chart_plan.source_sha256,
      expected_page_count: record.chart_plan.expected_page_count,
      expected_qualified: record.chart_plan.expected_qualified, minimum: record.chart_plan.minimum,
      target: record.chart_plan.target, alignment: record.chart_plan.alignment };
    if (!precheck.passed || JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('兼容构建记录中的图表方案内容不一致');
    }
    const deliveredPlan = readJson(path.join(root, '验收/逐页图形方案.json'));
    if (JSON.stringify(deliveredPlan) !== JSON.stringify(plan)) {
      throw new Error('兼容交付内逐页图形方案与生成前方案不一致');
    }
  }
  if (JSON.stringify(outputHashes(root)) !== JSON.stringify(record.outputs)) throw new Error('原版交付有手改、缺失或未知文件，拒绝覆盖');
  if (manifest.htmlSha256 !== hashFile(path.join(root, '案前洞察.html'))) throw new Error('原版HTML哈希不一致');
  return { manifest, record, input };
}
function legacyChartPlan({ input, researchPath, chartPlanPath, productionMode }) {
  const mode = resolveProductionMode(input.config, productionMode, { legacy: true });
  const complete = requiresChartGate(input.config, mode);
  if (!complete) {
    if (chartPlanPath) throw new Error(`${mode}与${input.config.delivery_scope}不是完整新制作质量验收，不能用逐页图形方案把它标成达标稿`);
    return { mode, quality_status: 'quality_not_revalidated', plan: null };
  }
  if (!researchPath) throw new Error('兼容模式新稿或内容修订必须同时提供结构化研究底稿，才能核对证据编号');
  const source = fs.realpathSync(chartPlanPath || path.join(input.root, '逐页图形方案.json'));
  const plan = readJson(source), research = readJson(fs.realpathSync(researchPath));
  const report = { report_config_id: input.config.id, production_mode: mode,
    delivery_scope: input.config.delivery_scope,
    pages: input.config.pages.map(page => ({ page_id: page.id })) };
  const precheck = checkChartPlan({ plan, research, report });
  if (!precheck.passed) throw new Error(`图表方案预检未通过：${precheck.status}；${precheck.errors.join('；') || `距离目标还差${precheck.shortfall}页`}`);
  const alignment = comparePlanToActual(plan, input.config.pages.map(page => ({ id: page.id })));
  return { mode, plan, source, source_sha256: hashFile(source), precheck, alignment,
    quality_status: 'planned_pending_actual_review' };
}
function buildLegacy({ reportPath, researchPath, outputDir, overwrite = false, chartPlanPath = null, productionMode = null }) {
  let input;
  try {
    input = legacyInputs(reportPath, researchPath, chartPlanPath, productionMode);
  } catch (error) {
    if (error.code === 'CUSTOMER_COPY_EXPRESSION' && error.expressionIssues?.length) {
      writeJson(path.join(path.dirname(reportPath), '成稿表达反馈.json'),
        feedbackFromIssues(error.expressionIssues, { reportPath: fs.realpathSync(reportPath), mode: 'legacy_preserved' }));
    }
    throw error;
  }
  const chartPlan = legacyChartPlan({ input, researchPath, chartPlanPath, productionMode });
  const target = outputLocation(outputDir, [input.source, ...(researchPath ? [researchPath] : [])]);
  if (fs.existsSync(target)) {
    if (!overwrite) throw new Error('输出目录已存在；核对后使用 --overwrite');
    // A version change may require rebuilding, but never permits overwriting user edits.
    assertOutputTree(target);
    const previous = readJson(path.join(target, '成品清单.json'));
    if (previous.compatibility?.format !== FORMAT || JSON.stringify(outputHashes(target)) !== JSON.stringify(previous.compatibility.outputs)) {
      throw new Error('旧交付未登记或已手改，拒绝覆盖');
    }
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(target), '.原版构建-'));
  let backup;
  try {
    copyInputs(input, stage);
    const manifest = require('../兼容引擎/构建报告.cjs').build(stage);
    const delivery = path.join(stage, '交付');
    if (researchPath) fs.copyFileSync(researchPath, path.join(delivery, '结构化研究底稿.json'));
    fs.mkdirSync(path.join(delivery, '验收'));
    if (chartPlan.plan) {
      writeJson(path.join(delivery, '验收/逐页图形方案.json'), chartPlan.plan);
      writeJson(path.join(delivery, '验收/图表方案对齐.json'), chartPlan.alignment);
    }
    writeJson(path.join(delivery, '验收/内容检查.json'), { status: 'legacy_structure_only',
      preservation: '原配置与素材保真；没有把历史数据升级为当前事实',
      evidence_review: 'not_revalidated', business_approval: 'not_granted' });
    manifest.compatibility = { format: FORMAT, reportPath: input.source,
      researchPath: researchPath ? fs.realpathSync(researchPath) : null,
      input_fingerprint: input.fingerprint, files: input.files, status: 'built_not_accepted',
      production_mode: chartPlan.mode, delivery_scope: input.deliveryScope,
      quality_status: chartPlan.quality_status,
      ...(chartPlan.plan ? { chart_plan: { status: 'passed', plan_id: chartPlan.plan.plan_id,
        source_path: chartPlan.source, source_sha256: chartPlan.source_sha256,
        expected_page_count: chartPlan.precheck.expected_page_count,
        expected_qualified: chartPlan.precheck.qualified, minimum: chartPlan.precheck.minimum,
        target: chartPlan.precheck.target, alignment: chartPlan.alignment } } : {}),
      content_review: 'manual_review', business_approval: 'not_granted', outputs: [] };
    writeJson(path.join(delivery, '成品清单.json'), manifest);
    manifest.compatibility.outputs = outputHashes(delivery);
    writeJson(path.join(delivery, '成品清单.json'), manifest);
    if (legacyInputs(reportPath, researchPath, chartPlan.source || null, chartPlan.mode).fingerprint !== input.fingerprint) throw new Error('构建期间输入变化，未替换原交付');
    if (fs.existsSync(target)) { backup = `${stage}-previous`; fs.renameSync(target, backup); }
    fs.renameSync(delivery, target);
    return { ...manifest, outputDir: target, fingerprint: input.fingerprint, page_count: manifest.pages,
      document_count: manifest.documents.length, backup: backup || null, status: 'built_not_accepted', mode: FORMAT,
      production_mode: chartPlan.mode, delivery_scope: input.deliveryScope,
      quality_status: chartPlan.quality_status };
  } catch (error) {
    if (backup && !fs.existsSync(target)) fs.renameSync(backup, target);
    throw error;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
module.exports = { FORMAT, legacyInputs, copyInputs, outputHashes, isLegacyDelivery, verifyLegacy, buildLegacy,
  legacyChartPlan };
