const fs = require('node:fs');
const path = require('node:path');
const { readJson, writeJson, outputLocation, localFile } = require('./lib/输入安全.cjs');
const { scanCustomerCopy, scanRenderedResearch, feedbackFromIssues, resolveAudienceMode } = require('./lib/客户成稿.cjs');
const { fingerprintInputs, hashFile, verifyOutputs } = require('./lib/输入指纹.cjs');
const { prepareAttachments, prepareImages, pdfResources } = require('./lib/附件.cjs');
const { parseArgs } = require('./lib/命令参数.cjs');
const { resolveProductionMode, requiresChartGate } = require('./lib/制作模式.cjs');
const PACKAGE = path.resolve(__dirname, '..');
const inlineJson = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

function payload(html, attachments) {
  if (!attachments.length) return html;
  const base = path.join(PACKAGE, 'assets/依赖/PDF阅读器');
  const data = { documents: attachments, resources: pdfResources(),
    pdfjs: fs.readFileSync(path.join(base, 'pdf.min.mjs')).toString('base64'),
    worker: fs.readFileSync(path.join(base, 'pdf.worker.min.mjs')).toString('base64') };
  const reader = fs.readFileSync(path.join(PACKAGE, 'assets/报告模板/附件阅读器.js'), 'utf8');
  return html.replace(/<\/body>\s*<\/html>\s*$/, () => `<script id="attachment-payload" type="application/json">${inlineJson(data)}</script><script>${reader}</script></body></html>`);
}
function chartPlanForBuild({ research, report, reportPath, chartPlanPath, productionMode }) {
  const required = requiresChartGate(report, productionMode);
  const root = path.dirname(reportPath);
  const candidate = chartPlanPath || path.join(root, '逐页图形方案.json');
  if (!required && !chartPlanPath) return { required: false, quality_status: 'quality_not_revalidated' };
  if (!required && chartPlanPath && !['new_report', 'content_revision'].includes(productionMode)) {
    throw new Error(`${productionMode}不是新制作质量验收，不能用逐页图形方案把它标成达标稿`);
  }
  if (!fs.existsSync(candidate)) throw new Error('完整稿构建前缺少逐页图形方案.json，已在生成HTML/PDF前阻断');
  const source = localFile(root, path.relative(root, candidate));
  const plan = readJson(source);
  const { checkChartPlan } = require('./lib/图表方案.cjs');
  const precheck = checkChartPlan({ plan, research, report });
  if (!precheck.passed) {
    const error = new Error(`图表方案预检未通过：${precheck.status}；${precheck.errors.join('；') || `距离目标还差${precheck.shortfall}页`}`);
    error.code = 'CHART_PLAN_PRECHECK'; error.chartPlan = precheck; throw error;
  }
  return { required, source, plan, precheck, source_sha256: hashFile(source),
    quality_status: 'planned_pending_actual_review' };
}
function buildReport({ researchPath, reportPath, outputDir, overwrite = false, audienceMode = null,
  chartPlanPath = null, productionMode = null }) {
  if (reportPath && require('./lib/旧版输入.cjs').isLegacyConfig(readJson(reportPath))) {
    return require('./lib/旧版交付.cjs').buildLegacy({ researchPath, reportPath, outputDir, overwrite,
      chartPlanPath, productionMode });
  }
  if (!researchPath || !reportPath || !outputDir) throw new Error('需要研究数据、报告配置和独立输出目录');
  researchPath = fs.realpathSync(researchPath); reportPath = fs.realpathSync(reportPath);
  const target = outputLocation(outputDir, [researchPath, reportPath]);
  const research = readJson(researchPath), report = readJson(reportPath);
  const resolvedProductionMode = resolveProductionMode(report, productionMode);
  report.production_mode = resolvedProductionMode;
  const resolvedAudienceMode = resolveAudienceMode(research, report, audienceMode);
  // Customer is the default. Internal mode is explicit and is only for audit/replay artifacts.
  const expressionIssues = resolvedAudienceMode === 'client'
    ? [...scanCustomerCopy(report), ...scanRenderedResearch(research, report, resolvedAudienceMode)]
    : [];
  if (expressionIssues.length) {
    writeJson(path.join(path.dirname(reportPath), '成稿表达反馈.json'),
      feedbackFromIssues(expressionIssues, { reportPath, mode: 'client' }));
    const error = new Error(`客户成稿表达不合规：${expressionIssues.length}处`);
    error.code = 'CUSTOMER_COPY_EXPRESSION';
    error.expressionIssues = expressionIssues;
    throw error;
  }
  const chartPlan = chartPlanForBuild({ research, report, reportPath, chartPlanPath, productionMode: resolvedProductionMode });
  const inputs = fingerprintInputs(researchPath, reportPath, resolvedAudienceMode, chartPlan.source || null,
    resolvedProductionMode);
  const { validateResearch } = require('./验证研究数据.cjs');
  const validation = validateResearch(research, report);
  if (!validation.ok) {
    const error = new Error(`研究校验未通过：${JSON.stringify(validation.issues)}`);
    error.validation = validation; throw error;
  }
  const { validateChart, pageCharts } = require('./lib/图表安全.cjs');
  for (const page of report.pages) {
    for (const chart of pageCharts(page)) {
      const issues = validateChart(chart);
      if (issues.some(issue => issue.severity === 'fatal')) throw new Error(`图表校验失败：${JSON.stringify(issues)}`);
    }
  }
  const root = path.dirname(reportPath);
  const attachments = prepareAttachments(report, root);
  const renderConfig = prepareImages(report, root);
  const { renderReport } = require('./lib/渲染报告.cjs');
  const assets = Object.fromEntries(['echarts', 'lucide'].map(name => [name,
    fs.readFileSync(path.join(PACKAGE, `assets/依赖/${name}.min.js`), 'utf8')]));
  let rendered;
  const html = payload(renderReport({ research, report: { ...renderConfig, audience_mode: resolvedAudienceMode,
      production_mode: resolvedProductionMode, delivery_scope: report.delivery_scope },
    fingerprint: inputs.fingerprint, reportConfigSha256: hashFile(reportPath),
    chartPlanRequired: Boolean(chartPlan.plan), chartPlanSha256: chartPlan.source_sha256 || null, assets, attachments,
    onRendered: data => { rendered = data; } }), attachments);
  if (!rendered?.pageCount) throw new Error('渲染器没有生成报告页面元数据');
  const alignment = chartPlan.plan
    ? require('./lib/图表方案.cjs').comparePlanToActual(chartPlan.plan, rendered.pages) : null;
  if (fs.existsSync(target)) {
    if (!overwrite) throw new Error('输出目录已存在；默认拒绝覆盖。核对后使用 --overwrite');
    if (fs.lstatSync(target).isSymbolicLink()) throw new Error('输出目录不能是符号链接');
    const previous = readJson(path.join(target, '成品清单.json'));
    verifyOutputs(target, previous);
    const known = new Set(['成品清单.json', '验收', ...previous.outputs.map(item => item.path)]);
    if (fs.readdirSync(target).some(name => !known.has(name))) throw new Error('输出目录有非构建文件，拒绝覆盖');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(target), '.报告构建-'));
  let backup;
  try {
    fs.mkdirSync(path.join(stage, '验收'));
    fs.writeFileSync(path.join(stage, '案前洞察.html'), html);
    if (chartPlan.plan) {
      writeJson(path.join(stage, '验收/逐页图形方案.json'), chartPlan.plan);
      writeJson(path.join(stage, '验收/图表方案对齐.json'), alignment);
    }
    if (rendered.notebookHTML) fs.writeFileSync(path.join(stage, '研究底稿.html'), rendered.notebookHTML);
    fs.copyFileSync(researchPath, path.join(stage, '研究数据.json'));
    fs.copyFileSync(reportPath, path.join(stage, '报告配置.json'));
    const notes = rendered.pages.map((page, index) => `## ${index + 1}. ${page.title}\n\n${page.notes}\n\n来源：${page.sources.map(source => source.source_id).join('、')}\n`).join('\n');
    const notesHeader = resolvedAudienceMode === 'client'
      ? '# 逐页讲解备注\n\n'
      : `# 逐页讲解备注\n\n输入指纹：${inputs.fingerprint}\n\n`;
    fs.writeFileSync(path.join(stage, '逐页讲解备注.md'), `${notesHeader}${notes}`);
    const physical = rendered.pageCount;
    if (!physical) throw new Error('渲染器没有生成报告页面');
    const outputs = [['html','案前洞察.html'],['research_data','研究数据.json'],['report_config','报告配置.json'],['speaker_notes','逐页讲解备注.md']]
      .map(([kind, file], i) => ({ output_id: `out-${i + 1}`, kind, path: file, sha256: hashFile(path.join(stage, file)) }));
    if (rendered.notebookHTML) outputs.push({ output_id: 'out-notebook', kind: 'research_notes', path: '研究底稿.html', sha256: hashFile(path.join(stage, '研究底稿.html')) });
    if (chartPlan.plan) {
      outputs.push({ output_id: 'out-chart-plan', kind: 'chart_plan', path: '验收/逐页图形方案.json',
        sha256: hashFile(path.join(stage, '验收/逐页图形方案.json')) });
      outputs.push({ output_id: 'out-chart-alignment', kind: 'acceptance_report', path: '验收/图表方案对齐.json',
        sha256: hashFile(path.join(stage, '验收/图表方案对齐.json')) });
    }
    const manifest = { schema_version: '0.1', manifest_id: `delivery-${inputs.fingerprint.slice(0, 12)}`,
      project_id: research.project.project_id, report_config_id: report.report_config_id,
      input_fingerprint: inputs.fingerprint, audience_mode: resolvedAudienceMode, production_mode: resolvedProductionMode,
      delivery_scope: report.delivery_scope,
      outputs, page_count: physical, status: 'draft', quality_status: chartPlan.quality_status,
      ...(chartPlan.plan ? { chart_plan: { status: 'passed', plan_id: chartPlan.plan.plan_id,
        source_sha256: chartPlan.source_sha256, expected_page_count: chartPlan.precheck.expected_page_count,
        expected_qualified: chartPlan.precheck.qualified, minimum: chartPlan.precheck.minimum,
        target: chartPlan.precheck.target, alignment } } : {}),
      acceptance: { overall_status: 'not_run', checks: [
        { check_id: 'structure', layer: 'structure', status: 'passed', evidence: '研究与报告配置结构及引用检查通过' },
        ...(chartPlan.plan ? [{ check_id: 'chart_plan', layer: 'chart_plan', status: 'passed',
          evidence: `生成前预检通过；预计${chartPlan.precheck.expected_page_count}页、${chartPlan.precheck.qualified}页图表主导；实际页序${alignment.matched ? '一致' : '有变化，见验收/图表方案对齐.json'}` }]
          : [{ check_id: 'chart_plan', layer: 'chart_plan', status: 'warning', evidence: '非完整稿或历史用途，没有把本次构建作为新制作报告质量证明' }]),
        { check_id: 'content', layer: 'content', status: 'manual_review', evidence: '硬规则已检查；事实和观点仍需研究负责人审校' },
        { check_id: 'visual', layer: 'visual', status: 'not_run', evidence: '尚未进行实际页面查看' }
      ] } };
    writeJson(path.join(stage, '成品清单.json'), manifest);
    writeJson(path.join(stage, '验收/内容检查.json'), validation);
    writeJson(path.join(stage, '验收/构建记录.json'), { researchPath, reportPath, audience_mode: resolvedAudienceMode, files: inputs.files,
      input_fingerprint: inputs.fingerprint, report_type: report.report_type, page_mode: report.page_mode,
      quality_status: chartPlan.quality_status, production_mode: resolvedProductionMode,
      delivery_scope: report.delivery_scope,
      ...(chartPlan.plan ? { chart_plan: { plan_id: chartPlan.plan.plan_id,
        source_path: chartPlan.source, source_sha256: chartPlan.source_sha256,
        precheck: chartPlan.precheck, alignment } } : {}),
      attachments: attachments.map(({ data_base64, ...item }) => item) });
    if (fingerprintInputs(researchPath, reportPath, resolvedAudienceMode, chartPlan.source || null,
      resolvedProductionMode).fingerprint !== inputs.fingerprint) throw new Error('构建过程中输入发生变化，未替换原成品');
    if (fs.existsSync(target)) { backup = `${stage}-previous`; fs.renameSync(target, backup); }
    fs.renameSync(stage, target);
    // Preserve the prior delivery when explicitly rebuilding, including any earlier acceptance evidence.
    return { outputDir: target, fingerprint: inputs.fingerprint, page_count: physical, backup: backup || null,
      validation: validation.counts, audience_mode: resolvedAudienceMode, status: 'built_not_accepted' };
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    if (backup && !fs.existsSync(target)) fs.renameSync(backup, target);
    throw error;
  }
}
function build(project, overwrite = false) {
  const root = fs.realpathSync(project), reportPath = path.join(root, '报告.json');
  const legacy = require('./lib/旧版输入.cjs').isLegacyConfig(readJson(reportPath));
  const candidate = path.join(root, '研究数据.json');
  return buildReport({ reportPath, researchPath: !legacy || fs.existsSync(candidate) ? candidate : undefined,
    outputDir: path.join(root, '交付'), overwrite });
}
if (require.main === module) {
  try {
    const argv = process.argv.slice(2);
    if (argv.includes('--help')) console.log('用法：node 构建报告.cjs 项目目录 [--production new_report|content_revision|pure_conversion|historical_replay] [--plan 逐页图形方案.json] [--overwrite]\n或 --research 研究数据.json --report 报告.json --out 交付目录 [--audience client|internal] [--production ...] [--plan ...] [--overwrite]\n完整新稿和内容修订必须声明production_mode并先通过逐页方案；纯转换和历史回放只标记未重新证明质量。');
    else if (argv[0] && !argv[0].startsWith('--')) {
      const rest = argv.slice(1);
      const args = parseArgs(rest, { '--production': 'string', '--plan': 'string', '--overwrite': 'boolean' });
      const root = fs.realpathSync(argv[0]), reportPath = path.join(root, '报告.json');
      const legacy = require('./lib/旧版输入.cjs').isLegacyConfig(readJson(reportPath));
      const candidate = path.join(root, '研究数据.json');
      console.log(JSON.stringify(buildReport({ reportPath, researchPath: !legacy || fs.existsSync(candidate) ? candidate : undefined,
        outputDir: path.join(root, '交付'), overwrite: args.overwrite, productionMode: args.production || null,
        chartPlanPath: args.plan || null }), null, 2));
    } else {
      const args = parseArgs(argv, { '--research': 'string', '--report': 'string', '--out': 'string', '--audience': 'string', '--production': 'string', '--plan': 'string', '--overwrite': 'boolean' });
      console.log(JSON.stringify(buildReport({ researchPath: args.research, reportPath: args.report, outputDir: args.out,
        audienceMode: args.audience || null, productionMode: args.production || null,
        chartPlanPath: args.plan || null, overwrite: args.overwrite }), null, 2));
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { buildReport, build };
