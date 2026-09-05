# 行业调研分析 Skill

面向快消食品行业的深度研究与案前洞察 Skill。它帮助 Agent 将行业、竞争、产品、渠道和消费者证据整理成可追溯的商业判断，并按需生成图表主导的单文件 HTML、PDF 阅读版和逐页讲解备注。

支持两种模式：

- **纯行业研究**：没有具体客户，目标是快速、系统地理解一个行业或品类。
- **客户案前研究**：结合会议、品牌和产品资料，为首次或早期客户交流准备专业洞察。

中文触发词：`行业调研分析`。

## 最简单的分享方式

把下面这个文件的完整内容发给同事使用的 Agent：

[给Agent的安装提示词.md](给Agent的安装提示词.md)

Agent 会被要求实际完成安装、依赖检查、Tavily MCP 配置引导和真实验收，而不是只返回一份操作教程。

## 仓库结构

```text
anqian-dongcha-baogao/   Skill 本体、模板、构建器和验收工具
scripts/安装Skill.py     跨平台安装器
scripts/校验公开仓库.py   发布前结构与敏感信息检查
安装与MCP配置.md          人工安装、运行环境和 Tavily 配置说明
给Agent的安装提示词.md    可以直接转发给任意 Agent 的安装任务
```

## 快速安装

下载或克隆仓库后，在仓库根目录执行：

```bash
python3 scripts/安装Skill.py --agent codex --with-runtime
```

将 `codex` 改为 `claude` 或 `project`。OpenClaw 请使用它的原生 `openclaw skills install`，不要猜测共享技能目录。其他支持 [Agent Skills 开放标准](https://agentskills.io/) 的工具，使用 `--dest` 指定其文档规定的技能目录：

```bash
python3 scripts/安装Skill.py --dest /你的/Agent/技能目录 --with-runtime
```

安装器不会写入 API Key，也不会自动修改 MCP 配置。Tavily 的安全配置和验收方法见 [安装与MCP配置.md](安装与MCP配置.md)。

## 使用方式

自然语言触发：

```text
请使用“行业调研分析”，帮我系统研究中国预包装烘焙行业。目前没有具体客户，先做纯行业研究。
```

显式调用：

```text
请使用 $anqian-dongcha-baogao，基于会议原文和公开资料做客户案前研究。
```

## 基本环境

- Agent 需要能够读取 `SKILL.md` 及同目录支持文件。
- Node.js 20 或更高版本：报告构建和浏览器验收。
- Python 3.10 或更高版本：安装器和 PDF 结构检查。
- Tavily MCP：推荐，用于实时网络研究；不可用时 Skill 会要求说明替代来源。

第三方前端依赖已经随 Skill 保留，并附带各自许可证及来源说明。详细安装和验证命令见 [安装与MCP配置.md](安装与MCP配置.md)。

## 安全边界

- 仓库不包含任何 API Key、Token、账号、Cookie、个人绝对路径或客户原始材料。
- 不要把密钥写入仓库、提示词、截图或日志。
- 优先使用 Tavily Remote MCP 的 OAuth；只有客户端不支持时，才通过客户端的私密凭据机制配置 API Key。
- 安装成功、MCP 已登记和真实搜索可用是三个不同的验收层级，必须分别检查。

## 许可证

本项目自身代码和文档采用 [MIT License](LICENSE)。ECharts、Lucide 和 PDF.js 等第三方资源继续适用其各自许可证，详见 `anqian-dongcha-baogao/assets/依赖/`。
