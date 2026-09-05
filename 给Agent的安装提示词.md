# 给 Agent 的安装提示词

将下面整段文字原样发给需要执行安装的 Agent。它适用于 Codex、Claude Code、OpenClaw，以及其他支持 Agent Skills 和 MCP 的本地 Agent。

---

请帮我从下面的公开 GitHub 仓库安装“行业调研分析”Skill，并完成运行环境与 Tavily MCP 的配置和验收：

`https://github.com/tushigan/industry-research-analysis-skill`

请直接执行，不要只给我一份教程。执行时遵守以下要求：

1. 先确认你当前是什么 Agent、运行在本机还是云端、支持哪一种 Skills 目录和 MCP 配置方式。先读取仓库的 `README.md`、`安装与MCP配置.md` 和 Skill 的 `SKILL.md`，不要猜安装路径。
2. 将仓库下载到临时目录。确认来源是上述仓库，不执行来源不明的脚本。
3. 把 `anqian-dongcha-baogao` 安装到当前 Agent 文档规定的 Skills 目录。Codex 使用 `$CODEX_HOME/skills` 或 `~/.codex/skills`；Claude Code 使用 `~/.claude/skills`；OpenClaw 必须使用当前版本的原生 `openclaw skills install`，由它选择活动工作区或共享管理目录，不要猜测 `~/.openclaw/skills`。其他 Agent 若支持 Agent Skills 开放标准，使用它自己的正式目录；若不支持，明确告诉我，不要假装安装成功。
4. Codex、Claude Code 或项目级安装，优先运行仓库提供的安装器：

   ```bash
   python3 scripts/安装Skill.py --agent <codex|claude|project> --with-runtime
   ```

   OpenClaw 请在仓库根目录运行 `openclaw skills install ./anqian-dongcha-baogao --global`；若只需当前活动工作区可去掉 `--global`。然后使用 `openclaw skills info anqian-dongcha-baogao --json` 读取实际安装位置，在该目录内安装运行依赖。其他 Agent 先查官方技能目录，再使用 `--dest`。若已存在旧版本，先备份并比较，不要直接覆盖；得到我的同意后再使用 `--force` 更新。
5. 检查 Node.js 是否达到 20 或更高版本、Python 是否达到 3.10 或更高版本。安装 Skill 自带 `package.json` 与 `requirements.txt` 中的依赖，并安装 Playwright Chromium。不要修改其他项目的依赖。
6. 检查当前 Agent 是否已经存在可用的 Tavily MCP。若已存在，先执行工具发现和一次真实搜索，不要重复注册。
7. 若尚未配置 Tavily，优先使用 Tavily Remote MCP 的 OAuth 地址 `https://mcp.tavily.com/mcp`，并使用当前 Agent 的原生 MCP 管理命令完成授权。不要让我把 API Key 粘贴到聊天、命令历史、日志或仓库。只有当前客户端不支持 OAuth 时，才引导我通过该客户端的私密凭据、系统钥匙串或本机环境变量配置 `TAVILY_API_KEY`。
8. MCP 配置完成后，不要只看“命令成功”。至少完成三级验收：
   - 配置验收：MCP 列表中存在并启用了 `tavily`；
   - 协议验收：能发现 Tavily 的搜索、提取等工具；
   - 真实请求验收：实际搜索“2025 中国休闲食品行业趋势”，返回带标题、链接和摘要的结果。
9. 验证 Skill：确认目标目录存在 `anqian-dongcha-baogao/SKILL.md`；运行 Skill 自带测试；在一个临时空目录生成测试报告、完成浏览器验收和 PDF 检查。测试文件不能写进我的业务项目。
10. 如果当前 Agent 需要重启或新开会话才能加载 Skill/MCP，请实际说明这一点，并在重启后的会话里再次确认。不要把“文件已复制”称为全部完成。
11. 最后用中文告诉我：安装到哪里、安装了哪些依赖、Tavily 是否通过真实搜索、Skill 是否已被 Agent 发现、哪些步骤仍需我手动授权。不要展示任何密钥、Token、Cookie 或完整认证链接中的凭据。

安装完成后，请用下面这句话做一次真实触发测试：

`请使用“行业调研分析”，帮我研究一个快消食品行业，目前没有具体客户，先做纯行业研究。`

---
