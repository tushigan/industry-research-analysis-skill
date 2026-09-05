# 安装、环境与 MCP 配置

## 1. 适用范围

Skill 主体遵循 `SKILL.md` 形式的 Agent Skills 结构。不同 Agent 的技能目录和 MCP 配置并不完全相同，所以“任意 Agent”指支持 Agent Skills 或能加载本地指令包的 Agent；不支持这些能力的平台无法通过复制目录获得同等功能。

## 2. 安装 Skill

### Codex

```bash
python3 scripts/安装Skill.py --agent codex --with-runtime
```

默认目标：`$CODEX_HOME/skills/anqian-dongcha-baogao`；未设置 `CODEX_HOME` 时使用 `~/.codex/skills/anqian-dongcha-baogao`。

### Claude Code

```bash
python3 scripts/安装Skill.py --agent claude --with-runtime
```

默认目标：`~/.claude/skills/anqian-dongcha-baogao`。Claude Code 官方同时支持项目目录 `.claude/skills/`；如需仅当前项目生效，请使用 `--dest` 指定该目录。

### OpenClaw

```bash
openclaw skills install ./anqian-dongcha-baogao --global
openclaw skills info anqian-dongcha-baogao --json
```

OpenClaw 当前版本默认安装到活动工作区的 `skills/`；`--global` 表示安装到供本机多个 Agent 使用的共享管理目录。请以 `skills info` 返回的实际位置为准，不要猜测 `~/.openclaw/skills`。原生安装完成后，在实际 Skill 目录内按下文“手动补装”安装运行依赖。

### 其他 Agent

先查该 Agent 的官方文档。如果它支持 Agent Skills，将正式技能根目录传给安装器：

```bash
python3 scripts/安装Skill.py --dest /正式技能根目录 --with-runtime
```

不要仅凭目录名猜测。云端 Agent 可能无法读取本机个人技能目录，此时应安装为项目级 Skill，或使用平台提供的上传/同步能力。

## 3. 运行环境

### 最低要求

- Node.js 20+
- Python 3.10+
- Git 2.30+（从 GitHub 克隆时需要）

`--with-runtime` 会在安装后的 Skill 目录内执行：

1. `npm install`
2. `npx playwright install chromium`
3. 创建 `.venv`
4. 安装 `requirements.txt` 中的 PDF 检查依赖

这些依赖只写入 Skill 目录，不修改业务项目。

### 手动补装

```bash
cd /已安装的/anqian-dongcha-baogao
npm install
npx playwright install chromium
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Windows 的虚拟环境解释器通常位于 `.venv\Scripts\python.exe`。

## 4. Tavily MCP

网络研究优先使用 Tavily。先检查当前 Agent 是否已经提供同名工具，避免重复注册。

### 推荐：Remote MCP + OAuth

官方远程地址：

```text
https://mcp.tavily.com/mcp
```

该地址不包含密钥。客户端支持 OAuth 时优先采用这种方式。

#### Codex

```bash
codex mcp add tavily --url https://mcp.tavily.com/mcp
codex mcp login tavily
codex mcp get tavily
```

若已经存在 `tavily`，先执行 `codex mcp get tavily`，确认现有配置后再决定是否更新，避免创建重复条目。

#### Claude Code

```bash
claude mcp add --transport http --scope user tavily https://mcp.tavily.com/mcp
```

随后进入 Claude Code，使用 `/mcp` 选择 Tavily 并完成 OAuth 授权。

#### 支持通用 MCP JSON 的客户端

根据客户端官方格式配置远程 MCP。需要通过 stdio 桥接时，可采用 Tavily 官方示例使用的 `mcp-remote`：

```json
{
  "mcpServers": {
    "tavily": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.tavily.com/mcp"]
    }
  }
}
```

不同客户端对环境变量插值、OAuth 和配置文件位置的支持不同，必须以该客户端当前官方文档为准。

### 备选：本地 MCP + API Key

仅在 OAuth 不可用时采用。Tavily 官方本地服务要求 Node.js 20+，启动命令为：

```bash
npx -y tavily-mcp@latest
```

密钥变量名为 `TAVILY_API_KEY`。应通过客户端的私密凭据界面、操作系统钥匙串或不进入版本控制的本机环境设置提供；不要把真实值写入仓库、公开 JSON、聊天记录或截图。

## 5. 验收

### Skill 文件与单元测试

```bash
test -f /技能根目录/anqian-dongcha-baogao/SKILL.md
cd /技能根目录/anqian-dongcha-baogao
npm test
```

### 技术样本

在临时空目录执行，不能覆盖真实研究项目：

```bash
node scripts/测试样本.cjs /tmp/行业调研分析测试
node scripts/构建报告.cjs /tmp/行业调研分析测试
node scripts/验收报告.cjs /tmp/行业调研分析测试
.venv/bin/python scripts/检查PDF.py /tmp/行业调研分析测试
```

Windows 请把 `/tmp/行业调研分析测试` 改为系统临时目录，并使用 `.venv\Scripts\python.exe`。

### Tavily 三级验收

1. **配置层**：MCP 列表存在且启用 `tavily`。
2. **协议层**：能发现 Tavily Search、Extract 等工具。
3. **请求层**：执行一次真实搜索并获得标题、链接与摘要。

只有三级都通过，才能称 Tavily 已可用。部分 Agent 需要重启或新开会话才能重新加载 MCP 和 Skill。

## 6. 官方参考

- [Tavily MCP 官方仓库](https://github.com/tavily-ai/tavily-mcp)
- [Claude Code Skills 官方文档](https://code.claude.com/docs/en/skills)
- [OpenClaw Skills 官方文档](https://docs.openclaw.ai/cli/skills)
- [Agent Skills 开放标准](https://agentskills.io/)
