# 安装与运行检查

此仓库的单一 Skill 名称是 `anqian-dongcha-baogao`。不要同时安装旧版和 `-v2` 别名。下载仓库后在根目录执行：

```bash
python3 scripts/安装Skill.py --agent codex
```

可把 `codex` 换成 `claude`，或用 `--dest` 指定客户端文档确认的技能根目录。OpenClaw 请使用它的原生 Skill 安装命令；不要猜测共享目录。云端 Agent 必须确认能读取本地目录，不能仅凭文件已复制宣称可用。

目标已有同名 Skill 时，安装器默认停止。只有确认替换时才加 `--force`；旧包会移到技能根目录的上一级 `skill-backups/`，不留在技能发现路径中。安装失败会尝试恢复旧包。安装后回读 `VERSION.json`、`SKILL.md` 和脚本，并在新会话确认客户端实际发现了入口。已有本地改动应先单独核对。

已有旧版时，可直接把 [旧版升级提示词](给Agent的旧版升级提示词.md) 发给当前使用的 Agent。它要求核对所有实际入口、分别备份旧版与 `-v2` 入口、只保留一个新版入口，并从安装目录重新构建和验收；不要把旧测试回执当作升级结果。

## 运行依赖

报告构建使用 Node.js；完整浏览器与 PDF 验收需要 Playwright/Chromium 和 PyMuPDF。随包静态前端依赖离线可用。推荐先执行：

```bash
node anqian-dongcha-baogao/scripts/检查运行环境.cjs
```

安装器的 `--with-runtime` 可在 Skill 目录内安装 Playwright `1.62.1`、Chromium 和 PyMuPDF `1.27.2`；需要 Node.js 24+、Python 3.10+、npm 与 pip，并产生网络下载。已有可用依赖时不要重复安装。安装器会打印新建 Python 的位置，后续验收须将 `ANQIAN_PYTHON` 设为该路径；若使用外部 Node 依赖目录，设置 `ANQIAN_NODE_MODULES`。版本以包内 `VERSION.json` 与实际检查输出为准。

## 匿名样本与完整验收

在已安装 Skill 根目录执行，输出放在独立临时目录，不覆盖业务项目：

```bash
node scripts/生成演示项目.cjs /临时目录/行业调研样本 deck --attachment
node scripts/构建报告.cjs --research /临时目录/行业调研样本/研究数据.json --report /临时目录/行业调研样本/报告.json --out /临时目录/行业调研样本/交付
RUN_DELIVERY_TESTS=1 node --test tests/完整交付.test.cjs
```

生成器的样本是内部研究稿，故单独对它运行对客 PDF 验收会被正确阻断。上述端到端测试会在临时目录生成可验收的匿名客户样本，并实际检查浏览器、讲者台、PDF 和成品一致性。`technical_passed` 只表示技术检查，不表示内容、图表比例或业务批准。新完整报告还须执行 `SKILL.md` 指定的图形方案预检和物理页图表占比检查。

## Tavily MCP

Tavily 是来源发现工具，不是报告构建的硬依赖。先确认实际客户端能发现 MCP，再确认当前会话能调用搜索工具，最后把关键结论核回官方或一手原文。优先使用客户端支持的 OAuth；若必须用 API Key，只存入客户端私密凭据或系统钥匙串，不写进仓库、提示词、截图和日志。

本安装操作不授权上传客户资料、对外发送、购买付费数据或修改外部权限。详见 [包内运行和迁移说明](anqian-dongcha-baogao/安装与MCP配置.md)。
