# -*- coding: utf-8 -*-
"""렌더 결과와 기사 정보를 GitHub Pages의 docs/오늘.json으로 합친다."""
import argparse
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--articles", required=True)
    p.add_argument("--rendered", required=True)
    p.add_argument("--caption", required=True)
    p.add_argument("--repo", required=True)
    p.add_argument("--output", required=True)
    a = p.parse_args()

    articles = json.loads(Path(a.articles).read_text(encoding="utf-8"))
    rendered = json.loads(Path(a.rendered).read_text(encoding="utf-8"))["cards"]
    caption = Path(a.caption).read_text(encoding="utf-8").strip()
    items = articles.get("items") or []
    date = articles.get("date") or ""
    base = f"https://raw.githubusercontent.com/{a.repo}/cards/{date}/"
    cards, item_index = [], 0
    for card in rendered:
        row = {
            "no": card["no"], "kind": card["kind"], "label": card["label"],
            "file": card["jpg"], "url": base + card["jpg"],
            "png": base + card["png"], "pngBytes": card["pngBytes"],
        }
        if card["kind"] not in ("cover", "outro") and item_index < len(items):
            item = items[item_index]
            row.update({
                "title": item.get("title", ""), "summary": item.get("summary", ""),
                "summary_long": item.get("summary_long", ""),
                "press": item.get("press") or item.get("source", ""),
                "source": item.get("source", ""), "link": item.get("url", ""),
                "selection": item.get("selection", ""),
            })
            body = row["summary_long"] or row["summary"]
            row["feed"] = f"{row['label']}. {row['title']}\n\n{body}\n\n출처: {row['press']} / {row['link']}".strip()
            item_index += 1
        elif card["kind"] == "cover":
            row["feed"] = "오늘의 뉴스 " + date + "\n\n" + "\n".join(
                "· " + (item.get("title") or "") for item in items)
        cards.append(row)

    out = {
        key: articles.get(key, "")
        for key in ("date", "generated_at", "mode", "window_start", "window_end")
    }
    out.update({"outro": articles.get("outro", True), "items": items,
                "cards": cards, "caption": caption})
    target = Path(a.output)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"카드 {len(cards)}장 · 기사 {len(items)}건 · {target}")


if __name__ == "__main__":
    main()
