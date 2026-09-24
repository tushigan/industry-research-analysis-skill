const fs = require('node:fs');
const path = require('node:path');
const { beginAcceptance, hashFile } = require('./lib/输入指纹.cjs');
const { writeJson, outputLocation } = require('./lib/输入安全.cjs');
const { withReport, inspectPages, screenshots } = require('./lib/浏览器检查.cjs');
const { checkPresenter } = require('./lib/讲者检查.cjs');

async function checkBrowser(outputDir) {
  const root = outputLocation(outputDir);
  if (require('./lib/旧版交付.cjs').isLegacyDelivery(root)) return require('./lib/旧版验收.cjs').acceptLegacy(root);
  const { manifest } = beginAcceptance(root);
  const folder = path.join(root, '验收');
  writeJson(path.join(folder, '浏览器检查.json'), { status: 'running' });
  try {
    const result = await withReport(root, async ({ context, page, errors, network }) => {
      const meta = await page.evaluate(() => window.__report);
      await page.emulateMedia({ media: 'print' });
      const printed = await inspectPages(page);
      await page.emulateMedia({ media: 'screen' });
      const desktop = await inspectPages(page);
      await screenshots(page, folder, '桌面');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const mobile = await inspectPages(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      await screenshots(page, folder, '手机');
      await page.setViewportSize({ width: 1440, height: 1000 });
      const presenter = await checkPresenter(page, folder);
      const attachments = [];
      const payload = await page.locator('#attachment-payload').count();
      if (payload) {
        const docs = await page.locator('#attachment-payload').evaluate(el => JSON.parse(el.textContent).documents.map(d => ({ id: d.attachment_id, pages: d.page_count })));
        for (const doc of docs) {
          await page.evaluate(id => window.__attachments.open(id, 1), doc.id);
          await page.waitForFunction(() => document.querySelector('#attachment-reader')?.dataset.renderedPage === '1');
          const pixels = await page.locator('#attachment-reader canvas').evaluate(canvas => {
            const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            let ink = 0; for (let i = 0; i < data.length; i += 4) if (data[i] < 230 || data[i + 1] < 230 || data[i + 2] < 230) ink++;
            return ink;
          });
          if (pixels < 20) throw new Error('内嵌附件画布为空');
          await page.locator('#attachment-reader [data-action="last"]').click();
          await page.waitForFunction(n => document.querySelector('#attachment-reader').dataset.renderedPage === String(n), doc.pages);
          await page.locator('#attachment-reader [data-action="in"]').click();
          await page.waitForFunction(() => document.querySelector('#attachment-zoom').textContent === '125%' && document.querySelector('#attachment-reader').dataset.renderedPage);
          const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#attachment-download').click()]);
          if (await download.failure()) throw new Error('附件下载失败');
          await page.locator('#attachment-reader [data-action="close"]').click();
          attachments.push({ id: doc.id, pages: doc.pages, pixels, navigation: 'passed', download: 'passed' });
        }
      }
      const issues = [...printed.issues, ...desktop.issues, ...mobile.issues, ...errors];
      if (overflow) issues.push('移动视口水平溢出');
      if (network.length) issues.push('离线 HTML 尝试访问外部资源');
      const expectedMode = manifest.production_mode, expectedScope = manifest.delivery_scope;
      const expectedReportHash = manifest.outputs.find(item => item.kind === 'report_config')?.sha256;
      const expectedPlan = Boolean(manifest.chart_plan);
      if (meta.fingerprint !== manifest.input_fingerprint || printed.pages.length !== manifest.page_count ||
          meta.productionMode !== expectedMode || meta.deliveryScope !== expectedScope ||
          meta.reportConfigSha256 !== expectedReportHash || Boolean(meta.chartPlanRequired) !== expectedPlan ||
          (expectedPlan && meta.chartPlanSha256 !== manifest.chart_plan.source_sha256)) {
        issues.push(`页面指纹、制作模式、交付范围、报告配置或图形方案指纹不一致：${JSON.stringify({
          fingerprint: [meta.fingerprint, manifest.input_fingerprint], pageCount: [printed.pages.length, manifest.page_count],
          productionMode: [meta.productionMode, expectedMode], deliveryScope: [meta.deliveryScope, expectedScope],
          reportConfigSha256: [meta.reportConfigSha256, expectedReportHash], chartPlanRequired: [Boolean(meta.chartPlanRequired), expectedPlan],
          chartPlanSha256: [meta.chartPlanSha256, manifest.chart_plan?.source_sha256]
        })}`);
      }
      return { status: issues.length ? 'failed' : 'passed', issues, meta, printed, desktop, mobile, attachments, presenter,
        htmlSha256: hashFile(path.join(root, '案前洞察.html')), externalRequests: network.length };
    });
    writeJson(path.join(folder, '浏览器检查.json'), result);
    if (result.status !== 'passed') throw new Error(result.issues.join('\n'));
    return result;
  } catch (error) {
    writeJson(path.join(folder, '浏览器检查.json'), { status: 'failed', message: error.message });
    writeJson(path.join(folder, '浏览器失败.json'), { status: 'failed', message: error.message }); throw error;
  }
}
if (require.main === module) checkBrowser(process.argv[2]).then(r => console.log(JSON.stringify(r, null, 2))).catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { checkBrowser };
