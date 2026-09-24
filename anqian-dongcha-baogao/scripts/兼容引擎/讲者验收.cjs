'use strict';
const path = require('node:path');
const assert = require('node:assert/strict');
const {ready} = require('./浏览器检查.cjs');

async function presenterCheck(page, config, output) {
  const n = config.pages.length;
  if (!config.presenter) {
    assert(await page.locator('[data-action="presenter"]').isHidden());
    const disabled = await page.context().newPage(), url = new URL(page.url());url.search = '?presenter=1';
    await disabled.goto(url.href);await ready(disabled);
    assert.equal(await disabled.locator('.desk').count(), 0, '禁用讲者配置未生效');
    assert(await disabled.locator('#report').isVisible());await disabled.close();
    return {enabled:false,parameterIgnored:true};
  }
  await page.evaluate(() => window.go(0));
  const pending = page.waitForEvent('popup');
  await page.locator('[data-action="presenter"]').click();const desk = await pending;
  try {
    await desk.setViewportSize({width:1250,height:850});await ready(desk);
    await desk.locator('#layout-reset').click();await desk.waitForTimeout(200);
    const geometry = () => desk.locator('#current-panel').evaluate(el => ({left:el.offsetLeft,top:el.offsetTop,width:el.offsetWidth,height:el.offsetHeight}));
    const defaults = await geometry();
    const target = Math.min(1,n-1);
    if (n > 1) {
      await desk.locator('#desk-next').click();
      await page.waitForFunction(n => document.getElementById('page-num').textContent === '2 / ' + n, n);
      await page.locator('[data-action="prev"]').click();
      await desk.waitForFunction(n => document.getElementById('desk-page').textContent === '1 / ' + n, n);
      await page.locator('[data-action="next"]').click();
      await desk.waitForFunction(n => document.getElementById('desk-page').textContent === '2 / ' + n, n);
    }
    assert.equal(await desk.locator('#notes-text').textContent(), config.pages[target].notes);
    const previews = [];
    for (const [i,selector] of ['#current-panel iframe','#next-panel iframe'].entries()) {
      const iframe = await desk.locator(selector).elementHandle();const frame = await iframe.contentFrame();
      const expected = Math.min(target+i,n-1);
      await frame.waitForURL(url => url.searchParams.get('embed') === '1' && url.searchParams.get('page') === String(expected));
      await frame.waitForFunction(() => window.reportReady);
      const snapshot = await frame.evaluate(() => [...document.querySelectorAll('.page')].map((el,index) => ({index,visible:el.getBoundingClientRect().width > 0,text:el.innerText.trim().length})).filter(el => el.visible));
      assert.deepEqual(snapshot.map(item => item.index), [expected]);assert(snapshot[0].text > 0);
      assert(await frame.locator('.page').nth(expected).locator('h1').isVisible());
      const bitmap = (await desk.locator(selector).screenshot()).toString('base64');
      const marked = await desk.evaluate(async encoded => {
        const image = new Image();image.src = 'data:image/png;base64,'+encoded;await image.decode();
        const canvas = document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx = canvas.getContext('2d');ctx.drawImage(image,0,0);
        const data = ctx.getImageData(0,0,canvas.width,canvas.height).data;let count=0;
        for(let j=0;j<data.length;j+=16)if(data[j]<235||data[j+1]<235||data[j+2]<235)count++;
        return count;
      },bitmap);
      assert(marked > 10,'讲者预览截图为空');
      previews.push({...snapshot[0],marked});
    }
    await desk.locator('#timer-reset').click();await desk.locator('#timer-run').click();await desk.waitForTimeout(1200);await desk.locator('#timer-run').click();
    const timer = await desk.locator('#timer').innerText();assert.notEqual(timer,'00:00');
    const box = await desk.locator('#current-panel h2').boundingBox();
    await desk.mouse.move(box.x+60,box.y+16);await desk.mouse.down();await desk.mouse.move(box.x+100,box.y+42);await desk.mouse.up();
    const dragged = await geometry();assert(dragged.left !== defaults.left || dragged.top !== defaults.top,'拖动没有改变位置');
    const panel = await desk.locator('#current-panel').boundingBox();
    await desk.mouse.move(panel.x+panel.width-3,panel.y+panel.height-3);await desk.mouse.down();await desk.mouse.move(panel.x+panel.width-70,panel.y+panel.height-40,{steps:5});await desk.mouse.up();
    await desk.waitForTimeout(300);const resized = await geometry();
    assert(resized.width !== dragged.width || resized.height !== dragged.height,'尺寸拖动未生效');
    await desk.reload();await ready(desk);assert.deepEqual(await geometry(),resized,'刷新后布局未保留');
    assert.equal(await desk.locator('#timer').innerText(),timer,'刷新后计时未保留');
    await desk.locator('#layout-reset').click();await desk.waitForTimeout(200);assert.deepEqual(await geometry(),defaults,'布局重置未恢复');
    await desk.locator('#timer-reset').click();assert.equal(await desk.locator('#timer').innerText(),'00:00');
    await desk.screenshot({path:path.join(output,'讲者窗口.png')});
    return {enabled:true,bidirectional:n>1,notes:true,previews,timer,dragged,resized,persisted:true,reset:true};
  } catch(error) {
    await desk.screenshot({path:path.join(output,'讲者失败现场.png')}).catch(()=>{});
    throw error;
  } finally {await desk.close();}
}

module.exports = {presenterCheck};
