const path = require('node:path');
const fs = require('node:fs');
const { verifyVersion, beginAcceptance, hashFile } = require('./lib/输入指纹.cjs');
const { readJson, writeJson, outputLocation } = require('./lib/输入安全.cjs');
const { python } = require('./lib/运行依赖.cjs');
const { checkBrowser } = require('./验收浏览器.cjs');
const { exportPdf } = require('./导出PDF.cjs');
const { checkChartRatio, checkPlanAlignment } = require('./lib/图表占比.cjs');
const { requiresChartGate } = require('./lib/制作模式.cjs');

function resolveRoot(outputDir) {
  if (outputDir && !fs.existsSync(path.join(outputDir, '成品清单.json')) &&
      fs.existsSync(path.join(outputDir, '交付/成品清单.json'))) outputDir = path.join(outputDir, '交付');
  return outputLocation(outputDir);
}

function missingRegistration() {
  return { status: 'missing_registration', registration_valid: false, passed: false,
    errors: ['完整新稿缺少本轮图表占比登记，不能完成交付'] };
}

async function runChartGate(root, manifest, record, reviewPath, actualCounts = null) {
  const required = requiresChartGate({ delivery_scope: record.delivery_scope }, record.production_mode);
  if (!required) return { status: 'quality_not_revalidated', passed: null,
    scope: '非完整新稿、纯转换或历史保真回放不以本次技术验收证明图表质量。' };
  if (!manifest.chart_plan || !record.chart_plan) throw new Error('完整新稿或内容修订缺少图表方案记录');
  if (!reviewPath) {
    const result = missingRegistration();
    if (actualCounts) result.plan_alignment = checkPlanAlignment(manifest.chart_plan,
      actualCounts.html, actualCounts.pdf);
    return result;
  }
  return checkChartRatio({ project: path.dirname(record.reportPath), review: reviewPath });
}

function finalPlanAlignment(manifest, chartRatio) {
  if (!manifest.chart_plan) return null;
  if (chartRatio && !chartRatio.plan_alignment) {
    return {
      matched: false,
      expected_page_count: manifest.chart_plan.expected_page_count,
      html_page_count: null,
      pdf_page_count: null,
      errors: ['缺少HTML/PDF实际物理页对齐结果，不能沿用生成前方案结论']
    };
  }
  return chartRatio.plan_alignment || {
    matched: Boolean(manifest.chart_plan.alignment?.matched),
    expected_page_count: manifest.chart_plan.expected_page_count,
    html_page_count: manifest.chart_plan.alignment?.actual_page_count,
    pdf_page_count: null,
    errors: manifest.chart_plan.alignment?.matched ? [] : ['最终HTML物理页序与生成前方案不一致']
  };
}

function chartGateRequired(manifest) {
  return requiresChartGate({ delivery_scope: manifest.delivery_scope }, manifest.production_mode);
}

function chartCheck(manifest, chartRatio) {
  if (!chartGateRequired(manifest)) return { check_id: 'chart_ratio', layer: 'chart_ratio', status: 'warning',
    evidence: '本次不是带图表规划门禁的完整新稿，质量状态为quality_not_revalidated' };
  if (chartRatio.passed) return { check_id: 'chart_ratio', layer: 'chart_ratio', status: 'passed',
    evidence: `验收/图表占比检查.json；HTML ${chartRatio.html.qualified}/${chartRatio.html.total}，PDF ${chartRatio.pdf.qualified}/${chartRatio.pdf.total}` };
  return { check_id: 'chart_ratio', layer: 'chart_ratio', status: 'failed',
    evidence: `验收/图表占比检查.json；${chartRatio.errors?.join('；') || chartRatio.status}` };
}

function updateManifest(root, manifest, chartRatio) {
  const required = chartGateRequired(manifest);
  const finalAlignment = finalPlanAlignment(manifest, chartRatio);
  const planAligned = finalAlignment?.matched;
  const chartGatePassed = Boolean(required && manifest.chart_plan && planAligned && chartRatio.passed);
  manifest.status = required && !chartGatePassed ? 'blocked' : 'draft';
  if (required) manifest.quality_status = chartGatePassed
    ? 'chart_ratio_passed_pending_business_review' : 'planned_pending_actual_review';
  manifest.acceptance = { overall_status: 'blocked', checks: [
    { check_id: 'structure', layer: 'structure', status: 'passed', evidence: '验收/内容检查.json；结构与硬规则，不代表事实确认' },
    ...(required ? [{ check_id: 'chart_plan', layer: 'chart_plan', status: planAligned ? 'passed' : 'failed',
      evidence: planAligned ? `生成前方案与最终HTML/PDF物理页数一致（${finalAlignment.expected_page_count}页）`
        : `${finalAlignment.errors.join('；')}；见验收/图表方案对齐.json` }]
      : [{ check_id: 'chart_plan', layer: 'chart_plan', status: 'warning', evidence: '未把本次构建作为完整新稿图表质量证明' }]),
    chartCheck(manifest, chartRatio),
    { check_id: 'content', layer: 'content', status: 'manual_review', evidence: '研究负责人须复核原文、事实和推理，未自动批准' },
    { check_id: 'browser', layer: 'browser', status: 'passed', evidence: '验收/浏览器检查.json；桌面、移动、离线附件' },
    { check_id: 'pdf', layer: 'pdf', status: 'passed', evidence: '验收/PDF检查.json；实际物理页、标题、文字、矢量和链接' },
    { check_id: 'visual', layer: 'visual', status: 'manual_review', evidence: '图表登记含双人逐页结论，但工具不核验审校者身份或截图语义' },
    { check_id: 'version', layer: 'version', status: 'passed', evidence: '输入、方案、模板、依赖与实际成品 SHA256 一致' }
  ] };
  if (finalAlignment) writeJson(path.join(root, '验收/图表方案对齐.json'), {
    ...manifest.chart_plan.alignment, final_physical_pages: finalAlignment
  });
  manifest.outputs = manifest.outputs.filter(item => item.kind !== 'acceptance_report');
  const names = ['完整验收.json', '浏览器检查.json', 'PDF检查.json', '内容检查.json', '构建记录.json', '图表占比检查.json', '图表方案对齐.json'];
  let index = 1;
  for (const name of names) {
    const file = path.join(root, '验收', name);
    if (!fs.existsSync(file)) continue;
    manifest.outputs.push({ output_id: `accept-${index++}`, kind: 'acceptance_report', path: `验收/${name}`, sha256: hashFile(file) });
  }
  writeJson(path.join(root, '成品清单.json'), manifest);
}

async function acceptChartOnly(root, reviewPath) {
  const { manifest, record } = verifyVersion(root);
  const technical = readJson(path.join(root, '验收/完整验收.json'));
  if (technical.status !== 'technical_passed') throw new Error('尚无可复用的当次技术验收，不能只跑图表门禁');
  const browser = readJson(path.join(root, '验收/浏览器检查.json'));
  const pdf = readJson(path.join(root, '验收/PDF检查.json'));
  const htmlSha256 = hashFile(path.join(root, '案前洞察.html'));
  const pdfSha256 = hashFile(path.join(root, '案前洞察.pdf'));
  const receiptsMatch = browser.status === 'passed' && pdf.status === 'passed' &&
    browser.htmlSha256 === htmlSha256 && pdf.htmlSha256 === htmlSha256 &&
    pdf.pdfSha256 === pdfSha256 && technical.input_fingerprint === manifest.input_fingerprint &&
    pdf.input_fingerprint === manifest.input_fingerprint;
  if (!receiptsMatch) {
    throw new Error('HTML或PDF已变化，不能沿用旧技术验收；请重跑完整验收');
  }
  const chartRatio = await runChartGate(root, manifest, record, reviewPath);
  writeJson(path.join(root, '验收/图表占比检查.json'), chartRatio);
  const planAligned = finalPlanAlignment(manifest, chartRatio)?.matched;
  const gatePassed = Boolean(chartRatio.passed && planAligned);
  const result = { status: gatePassed ? 'chart_gate_passed' : 'chart_gate_blocked',
    technical_status: 'technical_passed', chart_ratio: chartRatio,
    content_review: 'manual_review', visual_review: 'manual_review', business_approval: 'not_granted' };
  writeJson(path.join(root, '验收/完整验收.json'), { ...technical, chart_ratio: chartRatio,
    delivery_status: gatePassed ? 'blocked_pending_content_visual_business_review'
      : planAligned ? 'blocked_by_chart_ratio' : 'blocked_by_chart_plan_alignment' });
  updateManifest(root, manifest, chartRatio);
  return result;
}

async function acceptReport(outputDir, options = {}) {
  const root = resolveRoot(outputDir);
  if (require('./lib/旧版交付.cjs').isLegacyDelivery(root)) return require('./lib/旧版验收.cjs').acceptLegacy(root, options);
  if (options.chartOnly) return acceptChartOnly(root, options.reviewPath);
  const initial = beginAcceptance(root);
  initial.manifest.status = 'draft';
  initial.manifest.acceptance.overall_status = 'not_run';
  writeJson(path.join(root, '成品清单.json'), initial.manifest);
  writeJson(path.join(root, '验收/完整验收.json'), { status: 'running' });
  try {
    const browser = await checkBrowser(root);
    const pdf = await exportPdf(root);
    const layout = JSON.parse(python([path.join(__dirname, '检查版式.py'), path.join(root, '案前洞察.pdf'), path.join(root, '验收/PDF检查.json')]));
    const { manifest, record } = verifyVersion(root);
    const chartRatio = await runChartGate(root, manifest, record, options.reviewPath, {
      html: browser.printed.pages.length, pdf: pdf.checks.length
    });
    writeJson(path.join(root, '验收/图表占比检查.json'), chartRatio);
    const result = { status: 'technical_passed', input_fingerprint: manifest.input_fingerprint,
      pages: manifest.page_count, browser: browser.status, pdf: pdf.status, layout,
      chart_ratio: chartRatio,
      delivery_status: chartGateRequired(manifest) && !finalPlanAlignment(manifest, chartRatio)?.matched
        ? 'blocked_by_chart_plan_alignment'
        : chartGateRequired(manifest) && !chartRatio.passed ? 'blocked_by_chart_ratio' : 'blocked_pending_content_visual_business_review',
      content_review: 'manual_review', visual_review: 'manual_review', business_approval: 'not_granted',
      second_project_migration: 'not_run' };
    writeJson(path.join(root, '验收/完整验收.json'), result);
    updateManifest(root, manifest, chartRatio);
    return result;
  } catch (error) {
    const manifest = readJson(path.join(root, '成品清单.json'));
    manifest.status = 'blocked'; manifest.acceptance.overall_status = 'failed';
    writeJson(path.join(root, '成品清单.json'), manifest);
    writeJson(path.join(root, '验收/完整验收.json'), { status: 'failed', message: error.message });
    throw error;
  }
}

function parseCli(argv) {
  if (!argv.length || argv.includes('--help')) return { help: true };
  const result = { outputDir: argv[0], options: { chartOnly: false } };
  if (result.outputDir.startsWith('--')) throw new Error('第一个参数必须是项目目录或交付目录');
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--overwrite') continue;
    if (argv[i] === '--chart-only') { result.options.chartOnly = true; continue; }
    if (argv[i] === '--review' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      result.options.reviewPath = argv[++i]; continue;
    }
    throw new Error(`未知参数：${argv[i]}`);
  }
  if (result.options.chartOnly && !result.options.reviewPath) throw new Error('--chart-only必须同时指定--review');
  return result;
}

if (require.main === module) {
  try {
    const cli = parseCli(process.argv.slice(2));
    if (cli.help) console.log('用法：node 验收报告.cjs 项目目录或交付目录 [--review 图表占比登记.json]\n或追加 --chart-only 仅重跑图表门禁\ntechnical_passed只代表浏览器/PDF/指纹检查；完整新稿缺登记或任一格式不足时交付状态阻断。');
    else acceptReport(cli.outputDir, cli.options).then(result => {
      console.log(JSON.stringify(result, null, 2));
      if (result.status === 'chart_gate_blocked' || (result.chart_ratio && result.chart_ratio.passed === false) ||
          /^blocked_by_chart_/.test(result.delivery_status || '')) process.exitCode = 1;
    }).catch(error => { console.error(error.message); process.exitCode = 2; });
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
module.exports = { acceptReport, run: acceptReport, runChartGate, updateManifest, parseCli,
  finalPlanAlignment };
