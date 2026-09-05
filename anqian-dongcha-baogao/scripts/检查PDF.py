"""核查导出PDF页序、文字、矢量图及链接；图片式附件不要求文字层。"""
import argparse
import json
import hashlib
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("project", type=Path)
    args = parser.parse_args()
    try:
        import pymupdf as fitz
    except ImportError:
        try:
            import fitz
        except ImportError as exc:
            raise SystemExit("需要PyMuPDF；请使用当前可用Python运行时或先安装该依赖。") from exc
    root = args.project.resolve()
    config = json.loads((root / "报告.json").read_text())
    out = root / "验收"
    out.mkdir(exist_ok=True)
    (out / "PDF验收结果.json").write_text(json.dumps({"status": "running"}))
    browser = json.loads((out / "验收结果.json").read_text())
    manifest = json.loads((root / "交付/成品清单.json").read_text())
    digest = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
    assert browser["status"] == "passed", "需先通过当前报告的浏览器验收"
    assert digest(root / "交付/案前洞察.html") == browser["htmlSha256"] == manifest["htmlSha256"], "HTML与浏览器验收版本不一致"
    assert digest(root / "交付/案前洞察.pdf") == browser["pdf"]["sha256"], "PDF与浏览器导出版本不一致"
    pdf = fitz.open(root / "交付/案前洞察.pdf")
    assert len(pdf) == len(config["pages"]), "PDF物理页数与报告不一致"
    checks = []
    compact = lambda value: "".join(value.split())
    for index, page in enumerate(pdf):
        original = config["pages"][index]
        text = page.get_text()
        assert compact(original["title"]) in compact(text), f"第{index + 1}页标题或顺序不一致"
        assert compact(original["takeaway"]) in compact(text), f"第{index + 1}页观点缺失"
        assert text.strip(), f"第{index + 1}页无可选文字"
        paths = len(page.get_drawings())
        if any(block["type"] == "chart" for block in original["blocks"]):
            assert paths > 10, f"第{index + 1}页未见足够矢量内容"
        links = [link for link in page.get_links() if link.get("uri")]
        if original.get("sourceIds"):
            assert links, f"第{index + 1}页来源链接丢失"
        page.get_pixmap(matrix=fitz.Matrix(1, 1)).save(out / f"PDF第{index + 1:02}页.png")
        checks.append({"page": index + 1, "characters": len(text), "vector_paths": paths, "links": len(links)})
    for attachment in config.get("attachments", []):
        doc = fitz.open(root / attachment["file"])
        assert len(doc) == attachment["pages"], "附件真实页数不符：" + attachment["id"]
        doc.close()
    result = {"status": "passed", "pages": len(pdf), "htmlSha256": manifest["htmlSha256"], "pdfSha256": browser["pdf"]["sha256"], "checks": checks}
    (out / "PDF验收结果.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
