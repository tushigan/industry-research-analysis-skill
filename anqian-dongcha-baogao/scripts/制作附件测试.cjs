const fs=require('node:fs');
const path=require('node:path');
const {get}=require('./运行依赖.cjs');
const {makeFixture}=require('./测试样本.cjs');
(async()=>{
  if(!process.argv[2])throw new Error('请提供测试项目目录');
  const root=path.resolve(process.argv[2]),config=makeFixture(root);
  const {PDFDocument,StandardFonts,rgb}=get('pdf-lib');
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  for(let i=1;i<=3;i++){
    const page=pdf.addPage([595,842]);
    page.drawText('Synthetic reference / page '+i,{x:50,y:750,size:24,font});
    page.drawText('Generated for offline reader verification. No market evidence.',{x:50,y:715,size:12,font});
    page.drawRectangle({x:50,y:500,width:100+i*80,height:80,color:rgb(.08,.52,.39)});
    page.drawText('Value '+i*10,{x:50,y:470,size:18,font});
  }
  fs.writeFileSync(path.join(root,'自制测试资料.pdf'),await pdf.save());
  config.attachments=[{id:'test-pdf',sourceKey:'test-source',title:'自制技术测试PDF',file:'自制测试资料.pdf',pages:3,citedPage:2,formatLabel:'自制测试摘要',description:'人工生成的技术测试文件，非市场资料',shareApproved:true,shareBasis:'本测试脚本生成，无第三方内容'}];
  config.pages[0].citations=[{sourceId:'test-source',page:2}];
  config.pages.push({...config.pages[2],id:'p4',title:'不同页数不改变原始引用的页码'});
  config.id='test-b-with-pdf';config.title='测试品牌乙';
  fs.writeFileSync(path.join(root,'报告.json'),JSON.stringify(config,null,2));
  console.log('已生成4页合成项目及3页自制附件，仅供技术验收。');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
