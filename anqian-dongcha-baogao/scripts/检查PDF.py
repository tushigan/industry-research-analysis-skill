"""逐页检查物理页、标题、文字、矢量、链接及内容越界，不代表业务审校。"""
import argparse
import json
from pathlib import Path
import pymupdf


def check_pdf(pdf_path, expected, screenshot_dir=None):
    issues, checks = [], []
    if not expected.get("fingerprint"):
        issues.append("HTML 版本指纹缺失")
    with pymupdf.open(pdf_path) as doc:
        pages = expected["pages"]
        if len(doc) != len(pages):
            issues.append(f"PDF 实际 {len(doc)} 页，HTML 为 {len(pages)} 页")
        compact = lambda value: "".join(value.split())
        for index, page in enumerate(doc):
            item = pages[index] if index < len(pages) else {}
            text = page.get_text()
            title = item.get("title", "")
            if not text.strip() or (title and compact(title) not in compact(text)):
                issues.append(f"第 {index + 1} 页缺文字层、标题或顺序不一致")
            paths = len(page.get_drawings())
            if item.get("charts") and paths < 5:
                issues.append(f"第 {index + 1} 页缺矢量图表")
            links = [link.get("uri") for link in page.get_links() if link.get("uri")]
            destinations = [link.get("page", -1) + 1 for link in page.get_links()
                            if link.get("kind") in (pymupdf.LINK_GOTO, pymupdf.LINK_NAMED) and link.get("page", -1) >= 0]
            for destination in item.get("destinations", []):
                if destination not in destinations:
                    issues.append(f"第 {index + 1} 页目录未跳转到实际第 {destination} 页")
            for destination in set(item.get("referenceDestinations", [])):
                if destination not in destinations:
                    issues.append(f"第 {index + 1} 页内部引用未跳转到实际第 {destination} 页")
            for url in item.get("links", []):
                if url not in links:
                    issues.append(f"第 {index + 1} 页来源链接缺失：{url}")
            for heading in item.get("tableHeaders", []):
                if compact(heading) not in compact(text):
                    issues.append(f"第 {index + 1} 页缺少重复表头：{heading}")
            expected_ratio = item.get("width", 0) / max(item.get("height", 1), 1)
            if expected_ratio and abs(page.rect.width / page.rect.height - expected_ratio) > 0.02:
                issues.append(f"第 {index + 1} 页物理尺寸与 HTML 不一致")
            for block in page.get_text("blocks"):
                x0, y0, x1, y1 = block[:4]
                if x0 < -1 or y0 < -1 or x1 > page.rect.width + 1 or y1 > page.rect.height + 1:
                    issues.append(f"第 {index + 1} 页文字超出纸张")
            if screenshot_dir:
                destination = Path(screenshot_dir)
                destination.mkdir(parents=True, exist_ok=True)
                page.get_pixmap(matrix=pymupdf.Matrix(1, 1)).save(destination / f"PDF-{index + 1:02}.png")
            checks.append({"page": index + 1, "characters": len(text), "vector_paths": paths,
                           "links": len(links), "width": page.rect.width, "height": page.rect.height})
    return {"status": "failed" if issues else "passed", "issues": issues, "checks": checks,
            "source_fingerprint": expected.get("fingerprint")}


if __name__ == "__main__":
    import os
    import subprocess
    import sys

    # Project-directory calls use the atomic acceptance path so PDF checks cannot stale its fingerprint.
    if len(sys.argv) >= 2 and Path(sys.argv[1]).is_dir():
        if any(arg != "--overwrite" for arg in sys.argv[2:]):
            raise SystemExit("项目目录模式仅接受 --overwrite")
        command = [os.environ.get("ANQIAN_NODE", "node"), str(Path(__file__).with_name("验收报告.cjs")), sys.argv[1]]
        raise SystemExit(subprocess.run(command, check=False).returncode)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("expected", type=Path)
    parser.add_argument("--screenshots", type=Path)
    args = parser.parse_args()
    result = check_pdf(args.pdf, json.loads(args.expected.read_text()), args.screenshots)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["status"] == "passed" else 1)
