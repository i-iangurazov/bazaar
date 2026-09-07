"""Inspect PDFs from test:browser:print-navigation. Requires PyMuPDF (`pip install pymupdf`).

Checks the actual paginated PDF, rather than relying on screen-media DOM geometry.
Usage: python3 scripts/qa/verify-movement-pdfs.py artifacts/movement-print-command/latest
"""
import hashlib
import json
import re
import sys
from pathlib import Path

import fitz

root = Path(sys.argv[1])
manifest = json.loads((root / "browser.json").read_text())
results = []
renderings = {}
for fixture in manifest["pdfs"]:
    document = fitz.open(root / fixture["file"])
    markers = []
    hashes = []
    assert len(document) > 1, "Exercise repeated headers and page breaks"
    for index, page in enumerate(document):
        assert abs(page.rect.width - 595.28) < 1 and abs(page.rect.height - 841.89) < 1
        pixmap = page.get_pixmap()
        hashes.append(hashlib.sha256(pixmap.samples).hexdigest())
        # Inspect every edge pixel, not just the white body inside the dark page canvas.
        for x in range(pixmap.width):
            assert pixmap.pixel(x, 0) == (255, 255, 255)
            assert pixmap.pixel(x, pixmap.height - 1) == (255, 255, 255)
        for y in range(pixmap.height):
            assert pixmap.pixel(0, y) == (255, 255, 255)
            assert pixmap.pixel(pixmap.width - 1, y) == (255, 255, 255)

        horizontal_rules = []
        for drawing in page.get_drawings():
            rect = drawing["rect"]
            fill = drawing.get("fill")
            if fill and any(channel < .99 for channel in fill):
                assert min(rect.width, rect.height) <= 1.1, f"Large filled frame/background: {rect}"
                if rect.width > 200 and rect.height <= 1.1:
                    horizontal_rules.append(rect)
            if drawing.get("color"):
                assert drawing.get("width", 0) <= 1.1, "Heavy outline"

        words = page.get_text("words")
        for word in words:
            rect = fitz.Rect(word[:4])
            assert rect.x0 >= 33 and rect.y0 >= 33, f"Content clips left/top A4 margin: {word}"
            assert rect.x1 <= page.rect.width - 33 and rect.y1 <= page.rect.height - 33, f"Content clips right/bottom A4 margin: {word}"
            for line in horizontal_rules:
                # Thin row borders must not run through text or repeated headers.
                crosses = line.x0 < rect.x1 and line.x1 > rect.x0 and rect.y0 + .5 < line.y0 < rect.y1 - .5
                assert not crosses, f"Horizontal rule overlaps text on page {index + 1}: {word}"
            if re.fullmatch(r"ROW\d{3}", word[4]):
                markers.append(word[4])
                top = max(line.y1 for line in horizontal_rules if line.y1 <= rect.y0)
                bottom = min(line.y0 for line in horizontal_rules if line.y0 >= rect.y1)
                row_text = " ".join(page.get_textbox(fitz.Rect(33, top, page.rect.width - 33, bottom)).split())
                number = int(word[4][3:])
                expected_name = f"ROW{number:03} Тестовый товар"
                if (number - 1) % 11 == 0:
                    expected_name += " с длинным названием для проверки переноса текста"
                assert expected_name in row_text, f"Product row split/clipped at page break: {word[4]}"

        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    assert span["color"] == 0, f"Print text is not black: {span['text']}"
        if any(re.fullmatch(r"ROW\d{3}", word[4]) for word in words):
            assert "ТОВАР" in page.get_text(), "Missing repeated table header"
        if fixture["dark"] and fixture["backgrounds"]:
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(root / f"{Path(fixture['file']).stem}-page{index + 1}.png")

    assert markers == [f"ROW{index + 1:03}" for index in range(fixture["count"])], "Lost, duplicated or reordered rows"
    text = "\n".join(page.get_text() for page in document)
    assert not re.search(r"SKU-ONLY-IN-DATA|999000|штрихкод|MUST BE HIDDEN", text)
    for required in ["Количество", "Ед.", "Ответственный", "Дата подписи", "PRINT-TEST"]:
        assert required.casefold() in text.casefold(), f"Required document information missing: {required}"
    renderings.setdefault(fixture["type"], []).append(hashes)
    results.append({"file": fixture["file"], "pages": len(document), "rows": len(markers), "result": "PASS"})

for variants in renderings.values():
    assert all(variant == variants[0] for variant in variants), "Theme/background-graphics changes printed pixels"
(root / "pdf-verification.json").write_text(json.dumps(results, indent=2))
print(json.dumps({"pdfs": len(results), "pages": sum(result["pages"] for result in results), "result": "PASS"}))
