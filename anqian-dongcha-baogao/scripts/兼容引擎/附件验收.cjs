'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function pdfRendered(page, item, number) {
  const handle = await page.waitForFunction(({id,number}) => {
    const dialog = document.getElementById('reference-dialog');
    if (dialog.dataset.renderError) return {error:dialog.dataset.renderError};
    if (dialog.dataset.renderedDocument !== id || dialog.dataset.renderedPage !== String(number)) return false;
    const canvas = document.querySelector('#reference-paper canvas');
    if (!canvas || !canvas.width || !canvas.height) return false;
    const values = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let marked = 0;
    for (let i = 0; i < values.length; i += 16) if (values[i] < 240 || values[i+1] < 240 || values[i+2] < 240) marked++;
    return {marked,textCharacters:document.querySelector('.pdf-text-layer')?.textContent.trim().length || 0};
  }, {id:item.id,number}, {timeout:60000});
  const result = await handle.jsonValue();
  assert(!result.error, '附件渲染失败：' + (result.error || ''));
  assert(result.marked > 10, item.id + ' 第' + number + '页画面为空');
  assert.equal(await page.locator('#reference-page').inputValue(), String(number));
  assert.equal(await page.locator('#reference-dialog').getAttribute('data-page'), String(number));
  assert((await page.locator('#reference-new-tab').getAttribute('href')).endsWith('#page=' + number), '新窗口页码未同步');
  return {...result,page:number,scanOrNoText:result.textCharacters === 0};
}

async function documentsCheck(page, config, manifest, root, temporary, screenshots) {
  const docs = await page.evaluate(() => window.reportDocuments || []);
  assert.deepEqual(docs,manifest.documents);assert.equal(docs.length,config.attachments.length);
  if (!docs.length) {assert(await page.locator('[data-open-library]').isHidden());return [];}
  const verified = [];
  await page.locator('[data-open-library]').click();
  for (const [index,item] of docs.entries()) {
    await page.locator('#reference-list button').nth(index).click();
    const renders = [await pdfRendered(page,item,1)];
    assert((await page.locator('#reference-detail').textContent()).includes(item.formatLabel));
    await page.locator('#reference-cited').click();renders.push(await pdfRendered(page,item,item.citedPage));
    await page.locator('#reference-page').fill(String(item.pages));await page.locator('#reference-page').press('Tab');renders.push(await pdfRendered(page,item,item.pages));
    assert(await page.locator('#reference-next').isDisabled());
    await page.locator('#reference-full').click();await pdfRendered(page,item,1);assert(await page.locator('#reference-prev').isDisabled());
    if (item.pages > 1) {
      await page.locator('#reference-next').click();await pdfRendered(page,item,2);
      await page.locator('#reference-prev').click();await pdfRendered(page,item,1);
      const steps = Math.min(3,item.pages-1);
      for(let i=0;i<steps;i++) await page.locator('#reference-next').click();
      await pdfRendered(page,item,steps+1);
    }
    const current = Number(await page.locator('#reference-page').inputValue());
    const before = await page.locator('#reference-paper canvas').evaluate(el => el.width);
    await page.locator('#reference-zoom-in').click();await pdfRendered(page,item,current);
    assert(await page.locator('#reference-paper canvas').evaluate(el => el.width) > before,'缩放没有改变画布');
    await page.locator('#reference-zoom-out').click();await pdfRendered(page,item,current);
    await page.locator('#reference-fit').click();await pdfRendered(page,item,current);
    assert.equal(await page.locator('#reference-zoom-label').textContent(),'100%');
    await page.screenshot({path:path.join(screenshots,'资料-'+String(index+1).padStart(2,'0')+'.png')});
    const pending = page.waitForEvent('download');await page.locator('#reference-download').click();const download = await pending;
    const downloaded = path.join(temporary,'下载-'+index+'.pdf');await download.saveAs(downloaded);
    const original = config.attachments.find(source => source.id === item.id);
    const originalPath = fs.realpathSync(path.resolve(root,original.file));assert(originalPath.startsWith(root+path.sep),'附件原文件超出项目目录');
    const bytes = fs.readFileSync(downloaded), digest = sha(bytes);
    assert.equal(download.suggestedFilename(),item.filename);assert.equal(bytes.length,item.bytes);assert.equal(digest,item.sha256);assert.equal(digest,sha(fs.readFileSync(originalPath)));
    verified.push({id:item.id,renders,downloadSha256:digest,zoom:true,navigation:true});
  }
  const before = await page.locator('#page-num').textContent();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#page-num').textContent(),before);
  await page.locator('#reference-close').click();assert.equal(await page.locator('#page-num').textContent(),before);
  const links = await page.locator('.page a[data-document]:not([data-online])').count();
  for (let i = 0; i < links; i++) {
    const link = page.locator('.page a[data-document]:not([data-online])').nth(i);
    const id = await link.getAttribute('data-document'), item = docs.find(doc => doc.id === id);
    const number = Number(await link.getAttribute('data-pdf-page')) || item.citedPage;
    await link.scrollIntoViewIfNeeded();await page.waitForTimeout(350);
    const mainPage = await page.locator('#page-num').textContent();
    await link.click();await pdfRendered(page,item,number);await page.locator('#reference-close').click();
    assert.equal(await page.locator('#page-num').textContent(),mainPage,'关闭资料改变了主报告页');
  }
  await page.setViewportSize({width:390,height:844});await page.locator('[data-open-library]').click();
  await page.waitForTimeout(400);
  const selectedId = await page.locator('#reference-dialog').getAttribute('data-document');
  const selected = docs.find(item => item.id === selectedId);
  await pdfRendered(page,selected,Number(await page.locator('#reference-page').inputValue()));
  const mobile = await page.locator('#reference-dialog').evaluate(el => {
    const r = el.getBoundingClientRect(), tools = el.querySelector('.reference-tools');
    return {inside:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,toolsFit:tools.scrollWidth<=tools.clientWidth+1,canvas:!!el.querySelector('canvas')};
  });
  assert(mobile.inside&&mobile.toolsFit&&mobile.canvas,'手机资料阅读器越界或为空');
  await page.screenshot({path:path.join(screenshots,'资料-手机.png')});
  await page.locator('#reference-close').click();
  return verified;
}

module.exports = {documentsCheck};
