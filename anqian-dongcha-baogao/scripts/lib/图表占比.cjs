'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { localFile, readJson, within } = require('./输入安全.cjs');
const { hashFile } = require('./输入指纹.cjs');
const { dependency, python } = require('./运行依赖.cjs');

const SCOPE = '仅检查登记完整性、文件指纹和比例算术；不理解图形语义，不验证审校者真实身份，不代表视觉验收或业务批准。';
const STATUSES = ['qualified', 'unqualified', 'unknown'];
const text = value => typeof value === 'string' && Boolean(value.trim());
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const minimumQualified = total => Math.ceil(2 * total / 3);
const ratioPassed = (qualified, total) => Number.isInteger(total) && total > 0 && 3 * qualified >= 2 * total;
function fields(value, allowed, label) {
  assert(object(value), `${label}必须是对象`);
  assert(Object.keys(value).every(key => allowed.includes(key)), `${label}包含未知字段`);
}
function fileAt(root, relative) {
  assert(text(relative) && !relative.split('/').includes('..') && !relative.includes('\0'),
    '路径必须是项目内相对路径，不能含 ..');
  return localFile(root, relative);
}
function fingerprint(root, entry, label, snapshots) {
  fields(entry, ['path', 'sha256'], label);
  assert(/^[a-f0-9]{64}$/.test(entry.sha256), `${label}缺少有效SHA256`);
  const file = fileAt(root, entry.path);
  assert(hashFile(file) === entry.sha256, `${label}指纹失效，文件已变化：${entry.path}`);
  snapshots.set(file, entry.sha256);
  return file;
}
function manifestBinding(root, files, snapshots) {
  const delivery = path.dirname(files.html);
  assert(path.dirname(files.pdf) === delivery, '登记的HTML与PDF不在同一交付目录');
  const manifestFile = fileAt(root, path.relative(root, path.join(delivery, '成品清单.json')));
  const manifest = readJson(manifestFile);
  snapshots.set(manifestFile, hashFile(manifestFile));
  const legacy = manifest.compatibility?.format === 'legacy-preserved-v1';
  let record = manifest.compatibility;
  if (!legacy) {
    const recordFile = fileAt(root, path.relative(root, path.join(delivery, '验收/构建记录.json')));
    record = readJson(recordFile);
    snapshots.set(recordFile, hashFile(recordFile));
    assert(text(manifest.input_fingerprint) && record.input_fingerprint === manifest.input_fingerprint,
      '构建记录与成品清单版本不一致');
  }
  assert(object(record) && Array.isArray(record.files), '缺少构建时报告指纹');
  if (legacy && record.chart_plan && record.chart_plan.source_path) {
    const planFile = fileAt(root, path.relative(root, record.chart_plan.source_path));
    assert(hashFile(planFile) === record.chart_plan.source_sha256, '逐页图形方案相对构建记录已过期');
    snapshots.set(planFile, record.chart_plan.source_sha256);
  }
  const sourcePath = record.reportPath;
  assert(text(sourcePath), '构建记录缺少报告路径');
  const source = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(root, sourcePath);
  assert(within(root, source), '构建记录报告路径逃逸');
  assert(fs.realpathSync(fileAt(root, path.relative(root, source))) === fs.realpathSync(files.report),
    '登记的报告不是成品清单对应的报告');
  const hashes = record.files.filter(row => Array.isArray(row) && row[0] === (legacy ? '报告.json' : '报告配置'));
  assert(hashes.length === 1 && hashes[0][1] === hashFile(files.report), '报告相对构建记录已过期，须重建后登记');
  const outputs = legacy ? record.outputs : manifest.outputs;
  assert(Array.isArray(outputs), '成品清单缺少输出');
  for (const kind of ['html', 'pdf']) {
    const entries = outputs.filter(entry => legacy
      ? entry.path === `案前洞察.${kind}` : entry.kind === kind);
    assert(entries.length === 1, `成品清单缺少或重复${kind}`);
    const entry = entries[0], target = fileAt(root, path.relative(root, path.join(delivery, entry.path)));
    assert(fs.realpathSync(target) === fs.realpathSync(files[kind]) && entry.sha256 === hashFile(target),
      `成品清单${kind}路径或指纹不一致`);
  }
  if (legacy) assert(manifest.htmlSha256 === hashFile(files.html), '兼容成品清单HTML指纹不一致');
  return { manifest, record, legacy };
}

function pageDelta(actual, expected) {
  if (actual === expected) return '一致';
  return actual > expected ? `新增${actual - expected}个物理页` : `减少${expected - actual}个物理页`;
}

function checkPlanAlignment(chartPlan, htmlTotal, pdfTotal) {
  if (!chartPlan) return null;
  const expected = chartPlan.expected_page_count;
  const errors = [];
  if (!chartPlan.alignment?.matched) errors.push('最终HTML物理页序与生成前方案不一致');
  if (expected !== htmlTotal) {
    errors.push(`逐页图形方案预计${expected}页，HTML实际${htmlTotal}页；HTML比方案${pageDelta(htmlTotal, expected)}`);
  }
  if (expected !== pdfTotal) {
    errors.push(`逐页图形方案预计${expected}页，PDF实际${pdfTotal}页；PDF比方案${pageDelta(pdfTotal, expected)}`);
  }
  return { matched: errors.length === 0, expected_page_count: expected,
    html_page_count: htmlTotal, pdf_page_count: pdfTotal,
    html_page_delta: htmlTotal - expected, pdf_page_delta: pdfTotal - expected, errors };
}
async function htmlPages(file) {
  const browser = await dependency('playwright').chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, offline: true });
    const url = pathToFileURL(file).href, errors = [];
    await context.route('**/*', route => route.request().url() === url
      ? route.continue() : route.abort());
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => window.__reportReady === true || window.reportReady === true ||
      Boolean(document.querySelector('#report-error')?.textContent), null, { timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('#report > .report-page, #report > .page')];
      return {
        error: document.querySelector('#report-error')?.textContent,
        total: document.querySelectorAll('.report-page, .page').length,
        pages: nodes.map((node, index) => ({ page: index + 1, page_id: node.dataset.pageId,
          visible: node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0 &&
            getComputedStyle(node).visibility !== 'hidden' && getComputedStyle(node).opacity !== '0' }))
      };
    });
    assert(!errors.length && !result.error, `HTML渲染失败：${[...errors, result.error].filter(Boolean).join('；')}`);
    assert(result.pages.length > 0 && result.total === result.pages.length, 'HTML物理页缺失、嵌套或不在report容器内');
    assert(result.pages.every(p => text(p.page_id) && p.visible), 'HTML存在缺少页面ID或不可见的物理页');
    assert(new Set(result.pages.map(p => p.page_id)).size === result.pages.length, 'HTML物理页面ID重复');
    return result.pages.map(({ page, page_id }) => ({ page, page_id }));
  } finally { await browser.close(); }
}
function pdfPages(file) {
  const details = JSON.parse(python(['-c', [
    'import sys,json,pymupdf',
    'with pymupdf.open(sys.argv[1]) as doc:',
    ' print(json.dumps({"pdf":doc.is_pdf,"encrypted":doc.needs_pass,"pages":doc.page_count}))'
  ].join('\n'), file]));
  assert(details.pdf && !details.encrypted && Number.isInteger(details.pages) && details.pages > 0,
    'PDF必须是未加密且非空的实际PDF');
  return details.pages;
}
function checkReview(record, label) {
  fields(record, ['reviewer', 'verdict', 'reason'], label);
  assert(text(record.reviewer) && text(record.reason), `${label}缺少审校者或理由`);
  assert(STATUSES.includes(record.verdict), `${label}审校状态非法`);
  return record.reviewer.trim().normalize('NFKC').toLowerCase();
}
function checkPages(root, rows, actual, format, snapshots, images) {
  assert(Array.isArray(rows), `${format}缺少逐页登记`);
  const count = typeof actual === 'number' ? actual : actual.length, seen = new Set();
  let qualified = 0, unknown = 0;
  for (const row of rows) {
    fields(row, ['page', 'page_id', 'status', 'conclusion', 'reason', 'screenshot', 'primary', 'independent'], format);
    const label = `${format}第${row.page}页`;
    assert(Number.isInteger(row.page) && row.page >= 1 && row.page <= count, `${label}是假页码`);
    assert(!seen.has(row.page), `${label}重复登记`);
    seen.add(row.page);
    if (format === 'html') assert(row.page_id === actual[row.page - 1].page_id, `${label}页面ID与实际物理页序不一致`);
    else assert(row.page_id === undefined, `${label}用实际PDF页码定位，不接受HTML页面ID`);
    assert(STATUSES.includes(row.status), `${label}状态非法`);
    assert(text(row.conclusion) && text(row.reason), `${label}缺少图形结论或理由`);
    const image = fingerprint(root, row.screenshot, `${label}截图`, snapshots);
    assert(/\.(png|jpe?g)$/i.test(image), `${label}截图必须是PNG或JPEG`);
    images.add(image);
    const primary = row.primary === undefined ? null : checkReview(row.primary, `${label}主审`);
    const independent = row.independent === undefined ? null : checkReview(row.independent, `${label}独立复核`);
    if (primary && independent) assert(primary !== independent, `${label}独立审校者不能与主审相同`);
    if (row.status === 'qualified') {
      assert(primary && independent, `${label}合格登记缺少主审或独立复核`);
      assert(row.primary.verdict === 'qualified' && row.independent.verdict === 'qualified',
        `${label}合格登记缺少双方肯定记录`);
      qualified++;
    }
    if (row.status === 'unknown') unknown++;
  }
  assert(seen.size === count, `${format}遗漏物理页登记：${Array.from({ length: count }, (_, i) => i + 1).filter(p => !seen.has(p)).join(',')}`);
  const minimum = minimumQualified(count);
  return { total: count, qualified, unqualified: count - qualified - unknown, unknown,
    minimum, shortfall: Math.max(0, minimum - qualified), ratio: qualified / count,
    passed: ratioPassed(qualified, count) };
}
function validateImages(images) {
  python(['-c', [
    'import sys,json,pymupdf',
    'for name in json.loads(sys.argv[1]):',
    ' pix=pymupdf.Pixmap(name)',
    ' assert pix.width > 0 and pix.height > 0, "截图不能解码"'
  ].join('\n'), JSON.stringify([...images])]);
}
async function checkChartRatio({ project, review }) {
  const base = { scope: SCOPE, semantic_review: 'not_performed', reviewer_identity: 'not_verified',
    business_approval: 'not_granted' };
  try {
    assert(text(project) && text(review), '需要 --project <项目目录> --review <登记JSON>');
    const root = fs.realpathSync(project);
    assert(fs.statSync(root).isDirectory(), 'project必须是项目目录');
    const reviewFile = fileAt(root, path.isAbsolute(review) ? path.relative(root, review) : review);
    const snapshots = new Map([[reviewFile, hashFile(reviewFile)]]), data = readJson(reviewFile);
    fields(data, ['schema_version', 'artifacts', 'html_pages', 'pdf_pages'], '登记');
    assert(data.schema_version === '1.0', '不支持的登记格式版本');
    fields(data.artifacts, ['report', 'html', 'pdf'], 'artifacts');
    const files = Object.fromEntries(['report', 'html', 'pdf'].map(kind =>
      [kind, fingerprint(root, data.artifacts[kind], kind, snapshots)]));
    const binding = manifestBinding(root, files, snapshots);
    const actualPdf = pdfPages(files.pdf), actualHtml = await htmlPages(files.html), images = new Set();
    const html = checkPages(root, data.html_pages, actualHtml, 'html', snapshots, images);
    const pdf = checkPages(root, data.pdf_pages, actualPdf, 'pdf', snapshots, images);
    validateImages(images);
    for (const [file, digest] of snapshots) {
      fileAt(root, path.relative(root, file));
      assert(hashFile(file) === digest, '检查期间文件发生变化，请重新登记检查');
    }
    const chartPlan = binding.legacy ? binding.record.chart_plan : binding.manifest.chart_plan;
    const planAlignment = checkPlanAlignment(chartPlan, html.total, pdf.total);
    const ratiosPassed = html.passed && pdf.passed;
    const passed = ratiosPassed && (!planAlignment || planAlignment.matched);
    const errors = planAlignment?.errors || [];
    const status = planAlignment && !planAlignment.matched ? 'plan_alignment_mismatch'
      : ratiosPassed ? 'passed' : 'ratio_insufficient';
    return { ...base, status, registration_valid: true, passed, artifacts: data.artifacts,
      html, pdf, html_page_order: actualHtml, ...(planAlignment ? { plan_alignment: planAlignment } : {}), errors };
  } catch (error) {
    return { ...base, status: 'invalid_registration', registration_valid: false, passed: false,
      errors: [error.message] };
  }
}
module.exports = { checkChartRatio, htmlPages, pdfPages, minimumQualified, ratioPassed,
  checkPlanAlignment, SCOPE };
