#!/usr/bin/env python3
"""检查公开仓库结构及常见敏感信息残留。"""

from __future__ import annotations

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {".md", ".py", ".cjs", ".js", ".json", ".yaml", ".yml", ".html", ".css", ".txt"}
REQUIRED = [
    "README.md",
    "给Agent的安装提示词.md",
    "安装与MCP配置.md",
    "LICENSE",
    "anqian-dongcha-baogao/SKILL.md",
    "anqian-dongcha-baogao/agents/openai.yaml",
]
PATTERNS = {
    "疑似Tavily真实密钥": re.compile(r"tvly-[A-Za-z0-9_-]{16,}"),
    "macOS个人绝对路径": re.compile(r"/Users/[^/\s]+/"),
    "Windows个人绝对路径": re.compile(r"[A-Za-z]:\\Users\\[^\\\s]+\\"),
    "飞书私有文档链接": re.compile(r"https?://[^\s)]+\.feishu\.cn/(?:docx|wiki)/"),
}


def main() -> int:
    errors: list[str] = []
    for relative in REQUIRED:
        if not (ROOT / relative).is_file():
            errors.append(f"缺少文件：{relative}")

    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if path.resolve() == Path(__file__).resolve():
            continue
        if any(part in {".git", "node_modules", ".venv"} for part in path.parts):
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        for label, pattern in PATTERNS.items():
            if pattern.search(text):
                errors.append(f"{label}：{path.relative_to(ROOT)}")

    skill = ROOT / "anqian-dongcha-baogao" / "SKILL.md"
    if skill.is_file():
        body = skill.read_text(encoding="utf-8")
        if not body.startswith("---\n") or "name: anqian-dongcha-baogao" not in body[:500]:
            errors.append("SKILL.md frontmatter 不完整")

    if errors:
        print("公开仓库校验未通过：")
        for error in errors:
            print(f"- {error}")
        return 1
    print("公开仓库校验通过：结构完整，未发现预设的敏感信息模式。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
