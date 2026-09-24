# 安装与 MCP 配置

本说明面向本地 `0.6.0` 图表规划与交付门禁版，本文不是某台机器安装完成或替代通过的声明。
实际版本以 `VERSION.json` 为准，是否可替换以当次完整验收记录和用户授权为准。

## 先说边界

这份包只提供 `SKILL.md`、数据契约、脚本、匿名样本和随包静态依赖。它不会替客户端自动写入配置，也不会替用户申请权限、复制密钥、启用联网或上传资料。

| 客户端 | Skill 入口 | 本包不负责 |
|---|---|---|
| Codex | `$CODEX_HOME/skills/anqian-dongcha-baogao-v2/SKILL.md`；未设置 `CODEX_HOME` 时通常是 `~/.codex/skills/...` | Codex 的登录、MCP 配置、外部写入和客户端重载 |
| Claude Code | `~/.claude/skills/anqian-dongcha-baogao-v2/SKILL.md` | Claude Code 的设置、MCP 配置、权限和会话重载 |
| OpenClaw | 通过 `openclaw skills install <本地包目录> --as anqian-dongcha-baogao-v2` 安装到当前工作区；需要共享安装时再按 OpenClaw 选项使用 `--global` | OpenClaw 的 Agent 选择、MCP 配置、权限和外部系统操作 |

三种客户端都必须看到完整包根目录下的 `SKILL.md`。`agents/openai.yaml` 是 Codex 侧的界面元数据，Claude Code 和 OpenClaw 不依赖它。
以下客户端路径和示例为v2入口；经批准替换后，稳定旧入口 `anqian-dongcha-baogao` 与v2入口使用同一套实现，不再让两者分别运行不同年代的报告引擎。

## 验收前隔离测试

在客户端技能发现路径之外测试完整源码包，不覆盖现有两个安装入口。需要临时客户端测试时，先取得安装授权并确认当前入口及恢复方式。
包必须包含 `scripts/兼容引擎/`、`assets/兼容模板/`、结构化引擎及 `assets/依赖/`，只复制入口脚本不能独立运行。
原版保真引擎已经内置，运行不需要旧安装包，也不需要从旧目录复制依赖；两种模式复用本包静态依赖。
目标位置已有同名目录时先核对版本、来源和本地改动，不直接覆盖。

## 有条件替换与恢复

1. 替换前完成两种输入模式、旧项目目录命令、两份真实食品报告及图文附件样本的完整回放；核对原文、图表配置、布局、图片和附件，并实际检查桌面、手机、讲者台与PDF。客户名称和实测信息留在项目回归记录，不进入公开包。完整回归和独立复审仍有缺项时保留候选状态，不安装替换。
2. 核实用户授权、客户端实际发现的稳定旧入口与v2安装路径、版本及文件指纹。安装范围只限已授权客户端，不把一个客户端的结果冒充所有客户端均已验证。
3. 将待替换原包完整备份到所有客户端技能发现路径之外，记录原路径、备份路径、版本、文件指纹和恢复方法。不能把备份仅改名后放在 `skills/` 下，避免旧包仍被发现并误调用；已有v2也须保留可恢复副本。
4. 部署同一个经验证实现到稳定旧入口 `anqian-dongcha-baogao` 与新版入口 `anqian-dongcha-baogao-v2`。允许入口名称及对应界面标识不同，代码、模板、静态依赖和版本必须一致；稳定旧名只作兼容别名（stable alias），不得继续转调被备份的原安装包。
5. 重新确认两个入口被客户端发现，并分别从实际安装目录在独立测试项目中完成构建和验收。旧命令与高级接口均需覆盖；磁盘文件存在、入口可见、源码测试通过，均不能单独证明安装成功。
6. 任一入口失败时停止宣称替换完成，保留失败记录。按备份记录恢复各入口原包并重载客户端，再核对版本、指纹和发现结果；恢复安装包不改动用户研究原件或既有交付。

备份路径和具体复制方式按现场安装状态选择，不在文档中硬编码某台机器的用户路径。不因阅读本指南自动执行安装或替换。

## 客户端入口

### Codex

把整个目录放到：

```text
${CODEX_HOME:-$HOME/.codex}/skills/anqian-dongcha-baogao-v2/
```

确认 `SKILL.md` 直接位于该目录下，且文件开头有 YAML 头部，包含
`name: anqian-dongcha-baogao-v2` 和非空的 `description`。单纯复制目录不等于客户端已经识别。

在下一轮对话或重新打开的会话中，确认能找到“行业调研分析（新版）”，并明确调用：

```text
$anqian-dongcha-baogao-v2 用自带匿名样本生成报告，测试HTML、PDF、讲者台和内嵌资料，并展示分层验收结果。
```

分别记录文件校验、客户端入口发现和实际测试结果，不能互相替代。版本以 VERSION.json 为准；
入口可见不代表浏览器/PDF运行时或Tavily已经可用。列表未刷新时重新打开或重载会话。

### Claude Code

把整个目录放到：

```text
$HOME/.claude/skills/anqian-dongcha-baogao-v2/
```

确认 `SKILL.md` 直接位于该目录下，再重新打开 Claude Code 会话。Claude Code 使用 `SKILL.md` 的规则；`agents/openai.yaml` 不会替代 Claude Code 自己的配置。

### OpenClaw

优先使用 OpenClaw 的本地 Skill 安装命令，不要手动覆盖旧目录：

```bash
openclaw skills install /path/to/anqian-dongcha-baogao-v2 --as anqian-dongcha-baogao-v2
openclaw skills info anqian-dongcha-baogao-v2
```

如果需要安装到共享 Skill 目录，按当前 OpenClaw 版本的说明增加 `--global`。如果同名 Skill 已存在，先看 `info` 和版本，再决定是否更新；本包不自动覆盖。

## 运行时

两种模式优先复用现场已有的 Node.js、Playwright/Chromium 与 Python/PyMuPDF。
具体版本以 `VERSION.json` 和运行环境检查结果为准，不把文档中的版本当作已安装版本。运行时或静态依赖版本变化后重新做离线、浏览器和 PDF 检查。

报告结构校验与HTML构建使用Node内置模块；结构化模式预处理PDF附件还需要PyMuPDF，原版保真附件的真实页数与渲染在验收时核对。
实际浏览器和PDF验收需要Playwright、已安装的Chromium和可导入pymupdf的Python。
先执行 `node scripts/检查运行环境.cjs`，失败时按具体缺项配置，不能把缺依赖当验收通过。

- `ANQIAN_NODE_MODULES`：可选，指向包含Playwright的node_modules目录。Codex中优先用工作区依赖工具定位，不把某个人的绝对路径写进包。
- `ANQIAN_PYTHON`：可选，指向实际能导入pymupdf的Python；默认使用python3。不能仅凭“捆绑Python”名称认定已含PDF库。
- 无现成依赖时，在用户授权的环境中安装Playwright/Chromium和PyMuPDF；不擅自修改全局环境或客户端配置。
- ECharts、Lucide与PDF.js静态发行文件随包内嵌，HTML打开时不从CDN加载。

上述客户端步骤只提供本地入口指引；每台机器的安装及替换状态须有当地实际检查记录。

## 两种模式的试运行

在待测包根目录执行，所有输入、输出与截图放在独立项目中：

```sh
node scripts/构建报告.cjs /原版测试项目
node scripts/验收报告.cjs /原版测试项目
python3 scripts/检查PDF.py /原版测试项目
node scripts/构建报告.cjs --research /结构化测试项目/研究数据.json --report /结构化测试项目/报告.json --out /结构化测试项目/交付
node scripts/验收报告.cjs /结构化测试项目/交付
```

原版只需原 `报告.json` 与所需本地图片、获准PDF；高级 `buildReport` 及 `--report/--out` 调用可省略研究输入。
Python项目目录调用进入统一浏览器/PDF验收，需完整运行时；它不是免浏览器的安装捷径。
历史迁移默认保真，`--mode structured` 只做结构化分析。结构化模式保留严格证据校验及visual完整正文、精简来源索引和完整独立底稿。
两种模式都不将历史材料自动升级为当前事实或业务批准。

## Tavily MCP

Tavily 只用于来源发现和补充检索，不是报告构建的硬依赖。每次真正使用前按三层检查：

1. 配置层：在实际使用的 Codex、Claude Code 或 OpenClaw 客户端中确认能发现 Tavily MCP；
2. 工具层：确认当前会话能调用搜索工具并拿到结果；
3. 证据层：把结果回到官方或一手原文，登记来源、访问日期、数据时期和限制。

搜索摘要不能直接进入关键结论。Tavily 的密钥、令牌和配置值不得写入本包、日志、报告或测试
样本。当前项目不把 Tavily 写成“已验证可用”，具体任务仍需现场探测。

## 外部写入边界

安装或启用本 Skill 不等于获得以下权限：

- 对外发送或发布；
- 上传飞书或其他云端系统；
- 购买付费数据；
- 修改外部权限；
- 自动共享客户资料。

这些动作必须由具体任务明确授权，并在真实结果回读后单独报告。
