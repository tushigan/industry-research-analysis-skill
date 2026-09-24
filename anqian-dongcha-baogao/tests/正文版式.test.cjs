const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('页眉页脚不能把空正文和稀疏正文误算成高覆盖率', { skip: process.env.RUN_DELIVERY_TESTS !== '1' }, () => {
  const script = String.raw`
import importlib.util, json, tempfile
from pathlib import Path
import pymupdf
spec = importlib.util.spec_from_file_location("layout", ${JSON.stringify(path.resolve(__dirname, '../scripts/检查版式.py'))})
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with tempfile.TemporaryDirectory() as folder:
    pdf = Path(folder) / "test.pdf"
    meta = Path(folder) / "expected.json"
    doc = pymupdf.open()
    for kind in range(3):
        p = doc.new_page(width=800, height=450)
        p.insert_text((40, 35), "Header stretching across a professional report")
        p.insert_text((40, 425), "Footer with source, version and fingerprint")
        for i in range(1 if kind == 1 else 13 if kind == 2 else 0):
            p.insert_text((40, 120 + i * 16), "Body text " * (1 if kind == 1 else 10))
    doc.save(pdf)
    meta.write_text(json.dumps({"expected": {"pages": [{"bodyBounds": [.04,.2,.96,.86], "kind":"main"} for _ in range(3)]}}))
    result = module.inspect(pdf, meta)
    assert result["pages"][0]["body_text_coverage"] == 0
    assert result["pages"][1]["body_text_coverage"] < .01
    assert result["pages"][2]["body_text_coverage"] > .1
    assert {i["page"] for i in result["issues"]} == {1, 2}, result
    fallback = module.inspect(pdf)
    assert all(p["body_region_source"] == "estimated" for p in fallback["pages"])
    print(json.dumps(result))
`;
  const result = spawnSync(process.env.ANQIAN_PYTHON || 'python3', ['-B', '-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
