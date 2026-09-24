const fs = require('node:fs');
const path = require('node:path');
const { beginAcceptance, verifyVersion, hashFile } = require('./lib/输入指纹.cjs');
const { outputLocation, writeJson } = require('./lib/输入安全.cjs');
const { python } = require('./lib/运行依赖.cjs');
const { withReport, inspectPages } = require('./lib/浏览器检查.cjs');

async function exportPdf(outputDir) {
  const root = outputLocation(outputDir);
  if (require('./lib/旧版交付.cjs').isLegacyDelivery(root)) return require('./lib/旧版验收.cjs').acceptLegacy(root);
  const pdf = path.join(root, '案前洞察.pdf');
  function checkExistingPdf(manifest) {
    if (fs.existsSync(pdf) && !manifest.outputs.some(item => item.kind === 'pdf' && item.path === '案前洞察.pdf')) {
      throw new Error('已有同名PDF未登记为本次构建产物，拒绝覆盖；请改用新的交付目录');
    }
  }
  const current = verifyVersion(root);
  checkExistingPdf(current.manifest);
  if (current.manifest.audience_mode !== 'client') {
    const receipt = {
      status: 'blocked',
      reason: '内部研究底稿不能导出为客户PDF',
      audience_mode: current.manifest.audience_mode,
      handling: '如需客户交付，请将报告配置改为客户模式，清理内部过程话术后重新构建并通过客户成稿表达检查'
    };
    writeJson(path.join(root, '验收/PDF检查.json'), receipt);
    throw new Error('内部研究底稿不能导出为客户PDF');
  }
  const { manifest } = beginAcceptance(root);
  const stage = fs.mkdtempSync(path.join(root, '验收/.pdf-'));
  writeJson(path.join(root, '验收/PDF检查.json'), { status: 'running' });
  try {
    const expected = await withReport(root, async ({ page, errors, network }) => {
      await page.emulateMedia({ media: 'print' });
      const inspection = await inspectPages(page);
      if (inspection.issues.length) throw new Error(inspection.issues.join('\n'));
      await page.pdf({ path: path.join(stage, 'report.pdf'), preferCSSPageSize: true, printBackground: true,
        displayHeaderFooter: false, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
      if (errors.length || network.length) throw new Error('PDF 页面有脚本错误或外部资源请求');
      return inspection;
    });
    if (expected.fingerprint !== manifest.input_fingerprint) {
      throw new Error('PDF来源HTML与成品清单输入指纹不一致');
    }
    writeJson(path.join(stage, 'expected.json'), expected);
    const result = JSON.parse(python([path.join(__dirname, '检查PDF.py'), path.join(stage, 'report.pdf'),
      path.join(stage, 'expected.json'), '--screenshots', path.join(root, '验收')]));
    const verified = verifyVersion(root).manifest;
    checkExistingPdf(verified);
    if (verified.outputs.some(item => item.kind === 'pdf' && item.path === '案前洞察.pdf')) {
      fs.renameSync(path.join(stage, 'report.pdf'), pdf);
    } else fs.copyFileSync(path.join(stage, 'report.pdf'), pdf, fs.constants.COPYFILE_EXCL);
    const sha256 = hashFile(pdf);
    manifest.outputs = manifest.outputs.filter(item => item.kind !== 'pdf');
    manifest.outputs.push({ output_id: 'out-pdf', kind: 'pdf', path: '案前洞察.pdf', sha256 });
    writeJson(path.join(root, '成品清单.json'), manifest);
    const receipt = { ...result, input_fingerprint: manifest.input_fingerprint, htmlSha256: hashFile(path.join(root, '案前洞察.html')), pdfSha256: sha256, expected };
    writeJson(path.join(root, '验收/PDF检查.json'), receipt);
    return receipt;
  } catch (error) {
    writeJson(path.join(root, '验收/PDF检查.json'), { status: 'failed', message: error.message });
    throw error;
  } finally { fs.rmSync(stage, { recursive: true, force: true }); }
}
if (require.main === module) exportPdf(process.argv[2]).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { exportPdf };
