"""只统计正文文字的实际覆盖面积；页眉页脚不再撑大稀疏页指标。"""
import json
import sys
import pymupdf


def covered_area(rectangles):
    xs = sorted({x for rect in rectangles for x in (rect.x0, rect.x1)})
    area = 0
    for left, right in zip(xs, xs[1:]):
        intervals = sorted((r.y0, r.y1) for r in rectangles if r.x0 < right and r.x1 > left)
        height, end = 0, float("-inf")
        for bottom, top in intervals:
            height += max(0, top - max(bottom, end))
            end = max(end, top)
        area += (right - left) * height
    return area


def inspect(pdf_file, metadata_file=None):
    issues, pages, expected = [], [], []
    if metadata_file:
        with open(metadata_file, encoding="utf-8") as handle:
            expected = json.load(handle).get("expected", {}).get("pages", [])
    with pymupdf.open(pdf_file) as doc:
        if metadata_file and len(expected) != len(doc):
            issues.append({"severity": "fatal", "message": "正文区域记录与 PDF 页数不一致"})
        for index, page in enumerate(doc):
            meta = expected[index] if index < len(expected) else {}
            bounds = meta.get("bodyBounds")
            valid = (isinstance(bounds, list) and len(bounds) == 4 and
                     all(isinstance(v, (int, float)) and 0 <= v <= 1 for v in bounds) and
                     bounds[0] < bounds[2] and bounds[1] < bounds[3])
            if not valid:
                bounds = [0.04, 0.22, 0.96, 0.88]
                issues.append({"severity": "warning", "page": index + 1,
                               "message": "缺少有效正文区域记录，使用估计范围；需人工核对"})
            region = pymupdf.Rect(bounds[0] * page.rect.width, bounds[1] * page.rect.height,
                                  bounds[2] * page.rect.width, bounds[3] * page.rect.height)
            blocks = page.get_text("dict")["blocks"]
            text_rects = []
            for block in blocks:
                for line in block.get("lines", []):
                    for span in line["spans"]:
                        if not span["text"].strip():
                            continue
                        rect = pymupdf.Rect(span["bbox"])
                        if not page.rect.contains(rect):
                            issues.append({"severity": "fatal", "page": index + 1, "message": "文字超出纸张边界"})
                        clipped = rect & region
                        if not clipped.is_empty:
                            text_rects.append(clipped)
            graphics = sum(1 for drawing in page.get_drawings()
                           if region.contains(drawing["rect"]) and drawing["rect"].get_area() > 25)
            images = sum(1 for block in blocks if block["type"] == 1 and region.intersects(pymupdf.Rect(block["bbox"])))
            ratio = covered_area(text_rects) / region.get_area()
            if not blocks and not page.get_drawings():
                issues.append({"severity": "fatal", "page": index + 1, "message": "整页空白"})
            if ratio < 0.06 and not images:
                issues.append({"severity": "warning", "page": index + 1,
                               "message": "正文文字稀疏，需结合图形人工复核；装饰线框不算内容质量"})
            pages.append({"page": index + 1, "kind": meta.get("kind", "unknown"),
                          "body_region_source": "browser" if valid else "estimated",
                          "body_text_coverage": round(ratio, 4), "body_text_spans": len(text_rects),
                          "body_drawing_count": graphics, "body_image_count": images})
    return {"status": "failed" if any(i["severity"] == "fatal" for i in issues) else "passed",
            "issues": issues, "pages": pages, "visual_review": "manual_review"}


if __name__ == "__main__":
    result = inspect(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result["status"] == "passed" else 1)
