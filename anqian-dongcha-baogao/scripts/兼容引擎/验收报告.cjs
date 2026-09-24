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
  const target = path.resolve(root, name);
  fs.mkdirSync(target, {recursive:true});
  assert.equal(fs.realpathSync(target), target, '输出目录不能为软链接');
  return target;
}

const {ready, layout, charts} = require('./浏览器检查.cjs');
const {presenterCheck} = require('./讲者验收.cjs');
const {documentsCheck} = require('./附件验收.cjs');

async function run(project, overwrite = false, options = {}) {
  const root = fs.realpathSync(path.resolve(project)), delivery = outputDirectory(root,options.delivery ?? '交付');
  const pdfPath = path.join(delivery,'案前洞察.pdf');
  if(fs.existsSync(pdfPath)) {assert(!fs.lstatSync(pdfPath).isSymbolicLink(),'PDF输出不能为软链接');assert(overwrite,'PDF已存在，请使用--overwrite明确覆盖');}
  const output = outputDirectory(root,options.output ?? '验收'), screenshots = outputDirectory(output,'截图'), vectors = outputDirectory(output,'图表');
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
    fs.copyFileSync(generated,pdfPath);result.pdf={file:path.relative(root,pdfPath).split(path.sep).join('/'),bytes:fs.statSync(pdfPath).size,sha256:sha(fs.readFileSync(pdfPath)),physicalStructure:'待独立PDF结构检查'};
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
