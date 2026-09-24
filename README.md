# 行业调研分析 Skill

面向快消食品的行业研究与客户案前洞察。当前仓库提供 `0.6.0` 版本，保留原版报告的图表和内容，同时支持结构化证据核对、新报告的逐页图形规划，以及 HTML/PDF 实际物理页的图表占比验收。

**技术检查通过不等于事实正确、内容审校通过或业务批准。**新制作的完整报告必须先通过逐页图形方案预检，再构建、逐页复核并分别验收 HTML 与 PDF；历史保真回放和单纯格式转换不冒充新报告质量达标。

## 安装

先阅读 [安装与MCP配置.md](安装与MCP配置.md)。Codex 示例：

```bash
python3 scripts/安装Skill.py --agent codex
```

已存在同名入口时，安装器默认拒绝覆盖。明确更新时使用 `--force`，旧包会备份到技能发现目录之外。浏览器和 PDF 验收依赖可以使用现场已有运行时；需要在安装目录内安装时加 `--with-runtime`。安装后仍需在实际入口运行匿名样本并检查浏览器与 PDF。

## 使用

Skill 入口为 `anqian-dongcha-baogao/SKILL.md`，触发词为“行业调研分析”。完整规则和命令见 [Skill 说明](anqian-dongcha-baogao/SKILL.md) 与 [包内 README](anqian-dongcha-baogao/README.md)。

可将 [给Agent的安装提示词.md](给Agent的安装提示词.md) 发给支持本地 Skill 的 Agent，由它先核对安装路径、依赖与真实运行结果。

**已经安装旧版？**直接把 [给Agent的旧版升级提示词.md](给Agent的旧版升级提示词.md) 发给当前使用的 Agent。它会先查找并备份旧入口，再更新、验收，并处理旧版与 `-v2` 两个入口同时出现的情况。

## 发布边界

仓库仅包含 Skill 代码、模板、规则和匿名测试材料，不包含客户项目、报告成品或本机备份。推送前运行：

```bash
python3 scripts/校验公开仓库.py
python3 anqian-dongcha-baogao/公开仓库扫描.py anqian-dongcha-baogao
```

扫描只检查已知敏感模式，不能替代人工复核。Tavily 仅用于来源发现；配置、工具可用、实际搜索须分别验证。任何密钥都不应写进仓库或报告。

项目自身采用 [MIT License](LICENSE)；随包第三方静态资源遵循各自许可证。
