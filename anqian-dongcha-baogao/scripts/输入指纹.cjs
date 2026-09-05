'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function fingerprint(root,config){
  root=fs.realpathSync(root);
  const names=new Set(['报告.json']);
  for(const page of config.pages)for(const block of page.blocks)if(block.type==='image')names.add(block.file);
  for(const item of config.attachments)names.add(item.file);
  const files=[...names].sort().map(name=>{
    const file=fs.realpathSync(path.resolve(root,name));
    if(!file.startsWith(root+path.sep)||!fs.statSync(file).isFile())throw new Error('输入文件必须在项目目录内');
    return {file:name,sha256:sha(fs.readFileSync(file))};
  });
  return sha(JSON.stringify(files));
}
function assertFresh(root,config,manifest){
  if(fingerprint(root,config)!==manifest.inputSha256)throw new Error('输入资料已变化或缺少输入指纹，请先重新构建报告');
}
module.exports={fingerprint,assertFresh};
