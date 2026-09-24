#!/usr/bin/env python3
"""跨平台安装行业调研分析 Skill，并可在 Skill 内隔离安装运行依赖。"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime


SKILL_NAME = "anqian-dongcha-baogao"
REPO_ROOT = Path(__file__).resolve().parents[1]
SOURCE = REPO_ROOT / SKILL_NAME


def agent_root(agent: str) -> Path:
    home = Path.home()
    if agent == "codex":
        return Path(os.environ.get("CODEX_HOME", home / ".codex")) / "skills"
    if agent == "claude":
        return home / ".claude" / "skills"
    if agent == "project":
        return Path.cwd() / ".agents" / "skills"
    raise ValueError(f"未知 Agent：{agent}")


def run(command: list[str], cwd: Path) -> None:
    print("执行：", " ".join(command))
    subprocess.run(command, cwd=cwd, check=True)


def install_runtime(target: Path) -> None:
    node = shutil.which("node")
    npm = shutil.which("npm")
    if not node or not npm:
        raise RuntimeError("未找到 Node.js/npm。请先安装 Node.js 24 或更高版本。")
    major = int(subprocess.check_output([node, "-p", "process.versions.node.split('.')[0]"], text=True).strip())
    if major < 24:
        raise RuntimeError(f"Node.js 版本过低：{major}，需要 24 或更高版本。")

    run([npm, "install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "playwright@1.62.1"], target)
    npx = shutil.which("npx")
    if not npx:
        raise RuntimeError("未找到 npx，无法安装 Playwright Chromium。")
    run([npx, "playwright", "install", "chromium"], target)

    python = sys.executable
    if sys.version_info < (3, 10):
        raise RuntimeError("Python 版本过低，需要 3.10 或更高版本。")
    venv = target / ".venv"
    run([python, "-m", "venv", str(venv)], target)
    venv_python = venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    run([str(venv_python), "-m", "pip", "install", "--disable-pip-version-check", "pymupdf==1.27.2"], target)
    env = os.environ.copy()
    env["ANQIAN_PYTHON"] = str(venv_python)
    subprocess.run([node, "scripts/检查运行环境.cjs"], cwd=target, env=env, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="安装行业调研分析 Skill")
    parser.add_argument("--agent", choices=["codex", "claude", "project"], help="目标 Agent")
    parser.add_argument("--dest", type=Path, help="目标 Skills 根目录；指定后覆盖 --agent 的默认目录")
    parser.add_argument("--with-runtime", action="store_true", help="在 Skill 目录内安装 Node、浏览器和 Python 依赖")
    parser.add_argument("--force", action="store_true", help="先备份旧 Skill，再更新同名入口")
    args = parser.parse_args()

    if not SOURCE.is_dir() or not (SOURCE / "SKILL.md").is_file():
        raise RuntimeError(f"仓库不完整，缺少 {SOURCE / 'SKILL.md'}")
    if not args.dest and not args.agent:
        parser.error("请使用 --agent 指定 Agent，或使用 --dest 指定其官方 Skills 根目录。")

    destination_root = args.dest.expanduser().resolve() if args.dest else agent_root(args.agent).expanduser().resolve()
    target = destination_root / SKILL_NAME
    destination_root.mkdir(parents=True, exist_ok=True)

    backup = None
    if target.exists():
        if not args.force:
            raise RuntimeError(f"目标已存在：{target}\n请先备份并比较；确认更新后再使用 --force。")
        backup_root = destination_root.parent / "skill-backups"
        backup_root.mkdir(parents=True, exist_ok=True)
        backup = backup_root / f"{SKILL_NAME}-{datetime.now().strftime('%Y%m%d-%H%M%S-%f')}"
        shutil.move(str(target), str(backup))
        print(f"旧版本已备份：{backup}")

    try:
        shutil.copytree(
            SOURCE,
            target,
            ignore=shutil.ignore_patterns("node_modules", ".venv", "__pycache__", ".DS_Store"),
        )
        print(f"Skill 已安装：{target}")

        if args.with_runtime:
            install_runtime(target)
            print("运行依赖已安装并隔离在 Skill 目录内。")
            python_path = target / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            print(f"后续验收请设置 ANQIAN_PYTHON={python_path}")
        else:
            print("未安装浏览器与 PDF 验收依赖；完整报告验收前需配置运行时。")
    except Exception:
        if target.exists():
            shutil.rmtree(target)
        if backup is not None:
            shutil.move(str(backup), str(target))
            print(f"安装失败，已恢复旧版本：{target}", file=sys.stderr)
        raise

    print("下一步：按仓库的《安装与MCP配置.md》配置 Tavily，并在新会话中验证 Skill 是否被发现。")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError, ValueError) as error:
        print(f"安装失败：{error}", file=sys.stderr)
        raise SystemExit(1)
