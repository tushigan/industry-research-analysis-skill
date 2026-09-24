const path = require('node:path');

async function checkPresenter(page, folder) {
  const count = await page.evaluate(() => window.__report.pageCount);
  await page.evaluate(() => window.__report.goToPage(1));
  const popupPromise = page.waitForEvent('popup');
  await page.locator('#toolbar [data-action="presenter"]').click();
  const popup = await popupPromise;
  await popup.waitForFunction(() => window.__reportReady && document.querySelector('#presenter-page'));
  await popup.setViewportSize({ width: 1280, height: 850 });
  if (count > 1) {
    await popup.locator('.presenter-tools [data-action="next"]').click();
    await page.waitForFunction(() => window.__report.currentPage === 2);
  }
  const target = await page.evaluate(() => Math.max(1, window.__reportData.pages.findIndex(p => p.sources.length) + 1));
  await page.evaluate(n => window.__report.goToPage(n), target);
  await popup.waitForFunction(n => window.__report.currentPage === n, target);
  const expected = await page.evaluate(n => window.__reportData.pages[n - 1], target);
  if (expected.notes && !(await popup.locator('#presenter-notes').textContent()).includes(expected.notes)) throw new Error('讲者备注不一致');
  if (expected.sources.length && !(await popup.locator('#presenter-sources').textContent()).trim()) throw new Error('讲者来源为空');
  await popup.locator('[data-action="reset-timer"]').click();
  await popup.locator('[data-action="timer"]').click();
  await popup.waitForFunction(() => document.querySelector('#presenter-timer').textContent !== '00:00');
  await popup.locator('[data-action="timer"]').click();
  const paused = await popup.locator('#presenter-timer').textContent();
  await popup.waitForTimeout(1100);
  if (await popup.locator('#presenter-timer').textContent() !== paused) throw new Error('讲者计时未暂停');
  const panel = popup.locator('#panel-notes');
  const original = await panel.boundingBox();
  const handle = await panel.locator('.panel-handle').boundingBox();
  await popup.mouse.move(handle.x + 40, handle.y + 15);
  await popup.mouse.down(); await popup.mouse.move(handle.x - 30, handle.y + 45, { steps: 8 }); await popup.mouse.up();
  const moved = await panel.boundingBox();
  if (Math.abs(moved.x - original.x) < 20) throw new Error('讲者面板不能拖动');
  await popup.reload();
  await popup.waitForSelector('#panel-notes');
  const restored = await panel.boundingBox();
  if (Math.abs(restored.x - moved.x) > 2) throw new Error('讲者布局没有保存');
  const resize = await panel.locator('.resize-handle').boundingBox();
  await popup.mouse.move(resize.x + 6, resize.y + 6); await popup.mouse.down();
  await popup.mouse.move(resize.x - 44, resize.y + 36, { steps: 8 }); await popup.mouse.up();
  const resized = await panel.boundingBox();
  if (Math.abs(resized.width - restored.width) < 20) throw new Error('讲者面板不能调整尺寸');
  await popup.locator('[data-action="reset-layout"]').click();
  const reset = await panel.boundingBox();
  if (Math.abs(reset.x - original.x) > 2 || Math.abs(reset.width - original.width) > 2) throw new Error('讲者布局未恢复默认');
  await popup.screenshot({ path: path.join(folder, '讲者台-桌面.png') });
  await popup.setViewportSize({ width: 390, height: 844 });
  const bounds = await popup.evaluate(() => {
    const els = [...document.querySelectorAll('.presenter-panel,.presenter-tools')];
    return document.documentElement.scrollWidth <= innerWidth + 1 && els.every(el => {
      const r = el.getBoundingClientRect(); return r.width > 0 && r.left >= -1 && r.right <= innerWidth + 1;
    });
  });
  if (!bounds) throw new Error('讲者台移动布局越界');
  await popup.screenshot({ path: path.join(folder, '讲者台-手机.png'), fullPage: true });
  await popup.close();
  return { bidirectionalNavigation: 'passed', timer: 'passed', notes: 'passed', sources: 'passed',
    dragResizePersistReset: 'passed', responsive: 'passed' };
}
module.exports = { checkPresenter };
