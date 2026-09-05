#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {pathToFileURL} = require('node:url');
const {get} = require('./运行依赖.cjs');
const {assertFresh} = require('./输入指纹.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function outputDirectory(root, name) {
  const target = path.join(root, name);
  fs.mkdirSync(target, {recursive:true});
  assert.equal(fs.realpathSync(target), target, '输出目录不能为软链接');
  return target;
}

async function ready(page) {
  await page.waitForFunction(() => window.reportReady === true);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every(img => img.complete));
  await page.waitForTimeout(250);
}

async function layout(page) {
  return page.evaluate(() => {
    const visible = el => el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
    return {bodyOverflow:document.documentElement.scrollWidth > innerWidth + 1, pages:[...document.querySelectorAll('.page')].map(p => {
      const r = p.getBoundingClientRect(), footer = p.querySelector('footer'), fr = footer?.getBoundingClientRect();
      const issues = [];
      if (p.scrollWidth > p.clientWidth + 1 || p.scrollHeight > p.clientHeight + 1) issues.push('页面内容超出边界');
      if (fr && fr.bottom > r.bottom + 1) issues.push('页脚超出页面');
      const header = p.querySelector('header')?.getBoundingClientRect();
      const body = p.querySelector('.body')?.getBoundingClientRect();
      const takeaway = p.querySelector('.takeaway')?.getBoundingClientRect();
      if (header && body && header.bottom > body.top + 1) issues.push('标题与正文重叠');
      if (body && takeaway && body.bottom > takeaway.top + 1) issues.push('正文与结论重叠');
      if (takeaway && fr && takeaway.bottom > fr.top + 1) issues.push('结论与页脚重叠');
      const textRects = [], walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode, el = node.parentElement;
        if (!node.textContent.trim() || !el || el.closest('svg,script,style') || !visible(el)) continue;
        const range = document.createRange();range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height) continue;
          const label = node.textContent.trim().slice(0, 30);
          if (rect.left < r.left - 1 || rect.right > r.right + 1 || rect.bottom > r.bottom + 1) issues.push('文字越界：' + label);
          if (fr && !footer.contains(node) && rect.bottom > fr.top + 1) issues.push('文字侵入页脚：' + label);
          const block = el.closest('p,h1,h2,h3,li,td,th,figcaption,.takeaway,.mast,footer');
          if (block && getComputedStyle(block).overflow !== 'visible') {
            const br = block.getBoundingClientRect();
            if (rect.right > br.right + 1 || rect.bottom > br.bottom + 1) issues.push('文字被容器裁切：' + label);
          }
          textRects.push({node,rect,label});
        }
      }
      // 比较真实文字行框，避免只检查容器存在却漏掉卡片中文字互相覆盖。
      for (let i = 0; i < textRects.length; i++) for (let j = i + 1; j < textRects.length; j++) {
        const a = textRects[i], b = textRects[j];
        if (a.node === b.node) continue;
        const x = Math.min(a.rect.right,b.rect.right)-Math.max(a.rect.left,b.rect.left);
        const y = Math.min(a.rect.bottom,b.rect.bottom)-Math.max(a.rect.top,b.rect.top);
        if (x > 2 && y > 3) issues.push('文字重叠：' + a.label + ' / ' + b.label);
      }
      return {id:p.id,issues:[...new Set(issues)]};
    })};
  });
}

async function charts(page, ids) {
  return page.evaluate(async ids => {
    const result = [];
    for (const id of ids) {
      const el = document.getElementById(id), svg = el?.querySelector('svg');
      if (!svg) {result.push({id,ok:false,reason:'没有SVG'});continue;}
      const rect = svg.getBoundingClientRect();
      const copy = svg.cloneNode(true);copy.setAttribute('xmlns','http://www.w3.org/2000/svg');
      const serialized = new XMLSerializer().serializeToString(copy);
      const img = new Image();img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(serialized);
      await img.decode();
      const canvas = document.createElement('canvas');canvas.width = Math.max(1,Math.round(rect.width));canvas.height = Math.max(1,Math.round(rect.height));
      const ctx = canvas.getContext('2d');ctx.fillStyle = '#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
      let marked = 0;
      for (let i = 0; i < pixels.length; i += 16) if (pixels[i] < 240 || pixels[i+1] < 240 || pixels[i+2] < 240) marked++;
      result.push({id,ok:rect.width > 0 && rect.height > 0 && marked > 10,marked,width:rect.width,height:rect.height,svg:serialized});
    }
    return result;
  }, ids);
}

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

async function run(project, overwrite = false) {
  const root = fs.realpathSync(path.resolve(project)), delivery = outputDirectory(root,'交付');
  const pdfPath = path.join(delivery,'案前洞察.pdf');
  if(fs.existsSync(pdfPath)) {assert(!fs.lstatSync(pdfPath).isSymbolicLink(),'PDF输出不能为软链接');assert(overwrite,'PDF已存在，请使用--overwrite明确覆盖');}
  const output = outputDirectory(root,'验收'), screenshots = outputDirectory(output,'截图'), vectors = outputDirectory(output,'图表');
  const result = {status:'running',startedAt:new Date().toISOString(),offline:true,externalRequests:0,errors:[],consoleErrors:[]};
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'anqian-offline-'));
  let browser, page;
  try {
    const config = read(path.join(root,'报告.json')), manifest = read(path.join(delivery,'成品清单.json'));
    const bytes = fs.readFileSync(path.join(delivery,'案前洞察.html'));
    assert.equal(sha(bytes),manifest.htmlSha256,'HTML校验值与成品清单不同');
    assertFresh(root,config,manifest);
    assert.equal(manifest.pages,config.pages.length);assert.equal(manifest.charts,config.charts.length);
    result.htmlSha256 = manifest.htmlSha256;
    const isolated = path.join(temporary,'案前洞察.html');fs.copyFileSync(path.join(delivery,'案前洞察.html'),isolated);
    const {chromium} = get('playwright');
    browser = await chromium.launch({headless:true});
    const context = await browser.newContext({viewport:{width:1500,height:1000},offline:true,acceptDownloads:true,deviceScaleFactor:1});
    context.on('request', request => {if(/^https?:/.test(request.url()))result.externalRequests++;});
    context.on('page', p => {p.on('pageerror',error => result.errors.push(error.message));p.on('console',message => {if(message.type()==='error')result.consoleErrors.push(message.text());});});
    page = await context.newPage();await page.goto(pathToFileURL(isolated).href);await ready(page);
    result.pages = await page.locator('.page').count();assert.equal(result.pages,manifest.pages);
    assert.deepEqual(await page.evaluate(() => window.PAGE_NOTES),config.pages.map(item => item.notes));
    assert.deepEqual(await page.evaluate(() => window.REPORT_DATA.charts),config.charts.map(({id,option}) => ({id:'chart-'+id,option})));
    result.images = await page.locator('img').evaluateAll(images => images.map(img => ({alt:img.alt,loaded:img.complete&&img.naturalWidth>0&&img.naturalHeight>0})));
    assert(result.images.every(img => img.loaded),'存在未加载图片');
    result.layouts = {};
    for (const width of [1500,1280,390,768]) {
      await page.setViewportSize({width,height:width<1000?844:1000});await ready(page);
      result.layouts[width] = await layout(page);
      const measured = await charts(page,config.charts.map(item => 'chart-'+item.id));assert(measured.every(item => item.ok),'SVG图表未真实呈现');
      result.layouts[width].charts = measured.map(({svg,...item}) => item);
      if(width===1500||width===390) {
        await page.locator('#toolbar').evaluate(el => el.style.visibility='hidden');
        for(let i=0;i<manifest.pages;i++)await page.locator('.page').nth(i).screenshot({path:path.join(screenshots,'宽'+width+'-第'+String(i+1).padStart(2,'0')+'页.png')});
        await page.locator('#toolbar').evaluate(el => el.style.visibility='');
      }
      assert(!result.layouts[width].bodyOverflow&&result.layouts[width].pages.every(item => !item.issues.length),'宽'+width+'页面存在溢出或文字重叠，详见验收结果');
    }
    await page.setViewportSize({width:1500,height:1000});await ready(page);
    result.presenter = await presenterCheck(page,config,screenshots);
    result.documents = await documentsCheck(page,config,manifest,root,temporary,screenshots);
    await page.evaluate(() => document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()));
    await page.setViewportSize({width:1500,height:1000});await page.emulateMedia({media:'print'});
    await page.evaluate(() => window.reportCharts.forEach(({instance}) => instance.resize()));await ready(page);
    result.print = await layout(page);assert(result.print.pages.every(item => !item.issues.length),'打印页面存在溢出或文字重叠');
    result.print.documentFlow = await page.evaluate(() => ({
      documentHeight:document.documentElement.scrollHeight,
      expectedHeight:Math.max(innerHeight,document.getElementById('report').getBoundingClientRect().height),
      helperCanvases:[...document.querySelectorAll('.hiddenCanvasElement')].map(el => ({display:getComputedStyle(el).display,height:el.getBoundingClientRect().height}))
    }));
    assert(result.print.documentFlow.documentHeight <= result.print.documentFlow.expectedHeight + 1,'打印正文之外的辅助元素产生多余页面');
    const printCharts = await charts(page,config.charts.map(item => 'chart-'+item.id));assert(printCharts.every(item => item.ok),'打印前SVG图表为空');
    result.printCharts = printCharts.map(({svg,...item},index) => {const name = '图表-'+String(index+1).padStart(2,'0')+'.svg';fs.writeFileSync(path.join(vectors,name),svg);return {...item,file:'图表/'+name,sha256:sha(Buffer.from(svg))};});
    assert.equal(result.externalRequests,0,'离线成品仍请求网络');assert.deepEqual(result.errors,[],'存在浏览器脚本错误');assert.deepEqual(result.consoleErrors,[],'存在浏览器错误输出');
    const generated = path.join(temporary,'导出.pdf');await page.pdf({path:generated,printBackground:true,preferCSSPageSize:true});
    fs.copyFileSync(generated,pdfPath);result.pdf={file:'交付/案前洞察.pdf',bytes:fs.statSync(pdfPath).size,sha256:sha(fs.readFileSync(pdfPath)),physicalStructure:'待独立PDF结构检查'};
    result.status = 'passed';
  } catch(error) {
    result.status = 'failed';result.failure = error.message;
    if(page&&!page.isClosed())await page.screenshot({path:path.join(screenshots,'失败现场.png')}).catch(()=>{});
    throw error;
  } finally {
    if(browser)await browser.close();
    fs.rmSync(temporary,{recursive:true,force:true});
    result.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(output,'验收结果.json'),JSON.stringify(result,null,2));
  }
  return result;
}
module.exports={run};
if(require.main===module){
  if(process.argv.includes('--help')){console.log('用法：node 验收报告.cjs 项目目录 [--overwrite]\n断网验收单文件HTML，保存逐页截图与验收结果，并导出PDF。');process.exit(0);}
  if(!process.argv[2]||process.argv[2].startsWith('--')){console.error('请提供项目目录');process.exitCode=1;}
  else run(process.argv[2],process.argv.includes('--overwrite')).then(result=>console.log(JSON.stringify({status:result.status,pages:result.pages,pdf:result.pdf},null,2))).catch(error=>{console.error('验收未通过：'+error.message);process.exitCode=1;});
}
