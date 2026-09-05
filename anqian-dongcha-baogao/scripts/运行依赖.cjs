'use strict';
const path=require('node:path');
const {createRequire}=require('node:module');
function get(name){
  if(process.env.ANQIAN_NODE_MODULES){
    const base=path.resolve(process.env.ANQIAN_NODE_MODULES);
    return createRequire(path.join(base,'__anqian__.cjs'))(name);
  }
  try{return require(name);}catch(error){
    if(error.code!=='MODULE_NOT_FOUND')throw error;
    throw new Error('缺少依赖 '+name+'。请使用当前环境已配置的运行时，或设置ANQIAN_NODE_MODULES为含该依赖的node_modules目录；不要猜测其他Agent的路径。');
  }
}
module.exports={get};
