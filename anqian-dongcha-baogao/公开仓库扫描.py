"""扫描技能包中的私有资料和常见凭据痕迹，不替代人工授权复核。"""
import argparse
import json
import re
from pathlib import Path

TEXT = {".md", ".json", ".yaml", ".yml", ".toml", ".cjs", ".js", ".mjs", ".py", ".sh", ".html", ".css", ".txt"}
FORBIDDEN = ["/" + "Users" + "/", "蒙" + "小聚", "中保预包装" + "烘焙", "巴比" + "熊"]
SECRETS = [re.compile(r"sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}"),
           re.compile(r"tvly-[A-Za-z0-9_-]{20,}"),
           re.compile(r"https?://[^\s\"<>]*(?:feishu|larksuite)\.(?:cn|com)/[^\s\"<>]+")]


def scan(root):
    issues, count = [], 0
    for file in sorted(root.rglob("*")):
        relative = file.relative_to(root).as_posix()
        if file.is_symlink():
            issues.append({"file": relative, "reason": "包内不允许符号链接"})
            continue
        if not file.is_file():
            continue
        count += 1
        if file.suffix.lower() in {".pdf", ".docx", ".xlsx", ".env"} or file.name in {".DS_Store", "credentials.json"}:
            issues.append({"file": relative, "reason": "疑似私有资料或环境文件，不纳入安装包"})
        if file.suffix.lower() in TEXT:
            content = file.read_text(encoding="utf-8")
            if any(marker in content for marker in FORBIDDEN) or any(pattern.search(content) for pattern in SECRETS):
                issues.append({"file": relative, "reason": "含客户标识、个人路径、私有链接或疑似密钥；不回显内容"})
    return {"status": "failed" if issues else "passed", "files": count, "issues": issues,
            "boundary": "只扫描已知模式；人工仍需确认文件来源和分享授权"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", nargs="?", type=Path, default=Path(__file__).resolve().parent)
    args = parser.parse_args()
    result = scan(args.root.resolve())
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["status"] == "passed" else 1)
