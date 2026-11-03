"""Bundle existing Canva exports, captions and source links without editing media."""
from pathlib import Path
from html import escape
import hashlib
import json
import zipfile

ROOT = Path(__file__).resolve().parents[3]
DOCS = ROOT / "docs/marketing/instagram-2026-11"
campaign = json.loads((DOCS / "campaign.json").read_text())
plan = json.loads((DOCS / "native-v5-plan.json").read_text())
package = ROOT / campaign["packageDirectory"]
manifest = json.loads((package / "manifest.json").read_text())
media = json.loads((ROOT / "artifacts/instagram-canva-20261103/production/revision5/exports/media-manifest.json").read_text())
if campaign["version"] != 5 or campaign["paidBudget"] is not None or len(manifest) != 18:
    raise ValueError("Expected complete unpublished revision 5")
out = ROOT / "artifacts/instagram-canva-20261103/review-native-v5/BAZAAR-Instagram-14-days-v5.zip"
out.parent.mkdir(parents=True, exist_ok=True)
sha = lambda data: hashlib.sha256(data).hexdigest()
items = {x["id"]: x for x in campaign["items"] + campaign["ads"]}
entries, covered, sections = [], set(), []
with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_STORED) as archive:
    for row in manifest:
        content = {k: v for k, v in row.items() if k != "approvalHash"}
        if sha(json.dumps(content, ensure_ascii=False, separators=(",", ":")).encode()) != row["approvalHash"]:
            raise ValueError("Changed package: " + row["id"])
        item = items[row["originalId"]]
        folder = f"Ads/{row['id']}" if row["paid"] else f"Day-{item['day']:02d}/{row['id']}"
        links = []
        for file in row["files"]:
            data = (package / file["file"]).read_bytes()
            if sha(data) != file["sha256"]:
                raise ValueError("Changed file: " + file["file"])
            name = folder + "/" + file["file"]
            archive.writestr(name, data)
            entries.append({"file": name, "sha256": file["sha256"], "packageId": row["id"]})
            if name.endswith(".png"):
                covered.add(file["sha256"])
            links.append(f'<li><a href="{escape(name)}">{escape(file["file"])}</a></li>')
        source = next((x["editUrl"] for x in plan["splitDesigns"] if x["key"] == row["originalId"]), plan["designs"]["stories"]["urls"]["edit_url"])
        sections.append(f'<section><h2>{"Реклама" if row["paid"] else "День " + str(item["day"])} · {escape(item["title"]["ru"])}</h2><p><a href="{escape(source)}">Редактируемый исходник Canva</a></p><ul>{"".join(links)}</ul><pre>{escape(item["caption"]["ru"])}</pre></section>')
    extras = []
    for page in media["pages"]:
        data = (ROOT / page["file"]).read_bytes()
        if sha(data) != page["sha256"]:
            raise ValueError("Changed native PNG")
        if page["sha256"] not in covered:
            name = f"Extra-adaptations/{page['group']}-{page['page']:02d}-{page['itemId']}.png"
            archive.writestr(name, data)
            entries.append({"file": name, "sha256": page["sha256"], "nativePage": f"{page['group']}/{page['page']}"})
            covered.add(page["sha256"])
            extras.append(f'<li><a href="{escape(name)}">{escape(name)}</a></li>')
    if not {x["sha256"] for x in media["pages"]}.issubset(covered):
        raise ValueError("Some native PNG pages are absent")
    readme = """BAZAAR · двухнедельный выпуск · редакция 5

Откройте START.html: материалы разложены по дням, рекламные варианты — в Ads.
6 Reels по 20 секунд, 4 карусели на 18 слайдов, 42 Stories, 4 рекламных видео по 15 секунд.
Включены все 98 полноразмерных PNG Canva, в том числе дополнительные адаптации. Одинаковые изображения могут использоваться в нескольких назначениях.
PNG/MP4 — экспортные файлы. Заголовки, подписи, оригинальный логотип и фото редактируются раздельно в исходниках Canva.

Папка исходников: https://www.canva.com/folder/FAHZ49Cy4UY
Полная галерея и сетка: http://127.0.0.1:3136/

Порядок относительный: дни 1–14. Даты не назначены, публикации не запланированы.
Гипотеза времени по Бишкеку: два кадра Stories в 12:30, лента в 19:30, третий кадр в 19:45.
В дни только Stories — три кадра в 12:30. Корректировать по данным аккаунта после первой недели.

В файлах copy.txt отделены подпись, тексты карточек и служебные заметки. Заметки для ведущего аккаунта не публиковать.
Опросы, вопросы и ссылку регистрации добавить настоящими стикерами Instagram, по инструкции каждого дня. Нарисованных кнопок нет.
Видео без звука. SRT приложен отдельно; надписи уже есть в ролике. Скриншоты приложения — отдельные сцены/страницы с демонстрационными данными.
Основной язык — русский. Названия BAZAAR, Новичок, Бизнесмен и Монополист сохраняются.

Все комплекты — на просмотр. Сохранение Canva не означает согласования публикаций.
Платный бюджет не согласован; рекламные кампании не созданы и не запускаются.
Новая серверная атрибуция находится локально в main и не развёрнута в production.

Обработка входящих: уточнить город, ассортимент, число магазинов и задачу; согласовать показ или регистрацию.
Одна заявка — один уникальный бизнес с понятной задачей и согласованным следующим шагом.
Основные показатели: квалифицированные заявки, стоимость такой заявки, регистрации и стоимость регистрации.
Платный источник Direct подтверждать данными объявления/диалога Meta; ключевое слово само по себе его не доказывает.
Не рассылать массовые Direct, не покупать подписчиков, не придумывать отзывы и результаты клиентов.
"""
    source_links = "".join(f'<li><a href="{escape(d["urls"]["edit_url"])}">{escape(d["title"])}</a> · {len(d["pages"])} страниц</li>' for d in plan["designs"].values())
    html = f'<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BAZAAR · 14 дней</title><style>body{{max-width:1000px;margin:32px auto;padding:16px;font:17px/1.5 system-ui}}section{{border-top:1px solid #ddd;margin-top:24px}}pre{{white-space:pre-wrap;font:inherit}}a{{color:#063cd8}}</style><h1>BAZAAR · выпуск на 14 дней</h1><p>6 Reels · 4 карусели · 42 Stories · 4 рекламных варианта. На просмотр, без публикации.</p><p><a href="README.txt">Инструкция и измерение результата</a></p><h2>Редактируемые исходники</h2><ul>{source_links}</ul>{"".join(sections)}<h2>Дополнительные адаптации</h2><ul>{"".join(extras)}</ul></html>'
    archive.writestr("README.txt", readme)
    archive.writestr("START.html", html)
    assignments = [{"group": page["group"], "page": page["page"], "file": next(x["file"] for x in entries if x["sha256"] == page["sha256"]), "sha256": page["sha256"]} for page in media["pages"]]
    archive.writestr("release-index.json", json.dumps({"revision": 5, "entries": entries, "nativePages": assignments, "canvaFolder": plan["canvaFolder"], "nativePagesCovered": 98, "publicationEnabled": False, "paidBudget": None}, ensure_ascii=False, indent=2))
with zipfile.ZipFile(out) as archive:
    if archive.testzip():
        raise ValueError("Archive CRC verification failed")
    for entry in entries:
        if sha(archive.read(entry["file"])) != entry["sha256"]:
            raise ValueError("Archive hash mismatch")
evidence = {"revision": 5, "file": str(out.relative_to(ROOT)), "bytes": out.stat().st_size, "sha256": sha(out.read_bytes()), "files": len(entries) + 3, "packages": 18, "nativePagesCovered": 98, "extraAdaptations": len(extras), "crcAndAllMediaHashes": "passed", "publicationEnabled": False, "paidBudget": None}
(DOCS / "native-v5-bundle.json").write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n")
print(json.dumps(evidence, ensure_ascii=False))
