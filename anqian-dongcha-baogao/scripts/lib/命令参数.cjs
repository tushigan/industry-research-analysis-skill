function parseArgs(argv, allowed) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!(key in allowed)) throw new Error(`未知参数：${key}`);
    if (allowed[key] === 'boolean') options[key.slice(2)] = true;
    else {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`缺少参数值：${key}`);
      options[key.slice(2)] = argv[++i];
    }
  }
  return options;
}
module.exports = { parseArgs };
