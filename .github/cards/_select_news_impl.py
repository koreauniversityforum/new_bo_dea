# -*- coding: utf-8 -*-
"""네이버 랭킹에서 정기 카드뉴스용 기사를 자동 선정한다.

정기 실행은 전날 기사 중 경제·시사 2건, 정치 2건, 댓글 100개 이상이면서
상위 댓글의 공감/비공감 비율이 가장 팽팽한 기사 최대 3건을 고른다.
수동 실행은 같은 규칙을 실행 시각 직전 ``--hours`` 시간에 적용한다.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from bs4 import BeautifulSoup

KST = ZoneInfo("Asia/Seoul")
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")
SECTIONS = {"정치": {"100"}, "경제·시사": {"101", "102"}}
TEMPLATES = {
    "100": "default_politics_m3", "101": "default_economy_m3",
    "102": "default_society_m3", "103": "default_life_m3",
    "104": "default_world_m3", "105": "default_it_m3",
}


def fetch(url: str, referer: str = "https://news.naver.com/", retries: int = 3) -> str:
    """네이버의 EUC-KR/UTF-8 페이지를 모두 올바르게 읽는다."""
    last = None
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": UA, "Referer": referer,
                                        "Accept-Language": "ko-KR,ko;q=0.9"})
            with urlopen(req, timeout=25) as response:
                raw = response.read()
                content_type = response.headers.get_content_charset()
            for encoding in (content_type, "utf-8", "euc-kr"):
                if not encoding:
                    continue
                try:
                    return raw.decode(encoding)
                except UnicodeDecodeError:
                    pass
            return raw.decode("utf-8", errors="replace")
        except Exception as exc:
            last = exc
            time.sleep(0.6 * (attempt + 1))
    raise RuntimeError(f"가져오기 실패: {url}: {last}")


def clean_url(url: str) -> str:
    p = urlsplit(url)
    return urlunsplit((p.scheme or "https", p.netloc, p.path, "", ""))


def article_ids(url: str) -> tuple[str, str] | None:
    m = re.search(r"/article/(?:comment/)?(\d{3})/(\d{10})", url)
    return (m.group(1), m.group(2)) if m else None


def ranking_candidates(day: str, comment: bool = False) -> list[dict]:
    page = "popularMemo" if comment else "popularDay"
    url = f"https://news.naver.com/main/ranking/{page}.naver?date={day}"
    soup = BeautifulSoup(fetch(url), "html.parser")
    out, seen = [], set()
    for box_order, box in enumerate(soup.select(".rankingnews_box")):
        source_el = box.select_one(".rankingnews_name")
        source = source_el.get_text(" ", strip=True) if source_el else "네이버 뉴스"
        for a in box.select("a.list_title"):
            href = clean_url(a.get("href", ""))
            title = a.get_text(" ", strip=True)
            if not article_ids(href) or not title or href in seen:
                continue
            seen.add(href)
            rank_el = a.find_previous("em", class_="list_ranking_num")
            rank_m = re.search(r"\d+", rank_el.get_text() if rank_el else "")
            out.append({"title": title, "url": href, "source": source,
                        "publisher_order": box_order,
                        "view_rank": int(rank_m.group()) if rank_m else 99})
    return out


def section_candidates(section: str) -> list[dict]:
    url = f"https://news.naver.com/section/{section}"
    soup = BeautifulSoup(fetch(url), "html.parser")
    out, seen = [], set()
    for rank, a in enumerate(soup.select("a.sa_text_title"), 1):
        href = clean_url(a.get("href", ""))
        title_el = a.select_one("strong.sa_text_strong")
        title = (title_el or a).get_text(" ", strip=True)
        if not article_ids(href) or not title or href in seen:
            continue
        seen.add(href)
        item = a.find_parent(class_="sa_item")
        press_el = item.select_one(".sa_text_press") if item else None
        out.append({"title": title, "url": href,
                    "source": press_el.get_text(" ", strip=True) if press_el else "네이버 뉴스",
                    "publisher_order": rank, "view_rank": rank})
    return out


def enrich(article: dict) -> dict:
    html = fetch(article["url"], referer="https://news.naver.com/")
    soup = BeautifulSoup(html, "html.parser")
    dt_el = soup.select_one("[data-date-time]")
    section = re.search(r"sectionId\s*:\s*[\"'](\d{3})", html)
    if not dt_el or not section:
        raise ValueError("기사 시각 또는 섹션을 찾지 못함")
    article = dict(article)
    article["published_at"] = datetime.strptime(
        dt_el.get("data-date-time"), "%Y-%m-%d %H:%M:%S").replace(tzinfo=KST).isoformat()
    article["section_id"] = section.group(1)
    article["office_id"], article["article_id"] = article_ids(article["url"])
    return article


def comment_stats(article: dict) -> dict:
    template = TEMPLATES.get(article.get("section_id"), "default_politics_m3")
    oid, aid = article["office_id"], article["article_id"]
    endpoint = (
        "https://apis.naver.com/commentBox/cbox5/web_naver_list_jsonp.json"
        f"?ticket=news&templateId={template}&pool=cbox5&lang=ko&country=KR"
        f"&objectId=news{oid}%2C{aid}&pageSize=20&indexSize=10&groupId="
        "&listType=OBJECT&pageType=more&page=1&sort=FAVORITE"
    )
    raw = fetch(endpoint, referer=article["url"])
    payload = json.loads(raw[raw.index("(") + 1:raw.rindex(")")])
    result = payload.get("result") or {}
    comments = result.get("commentList") or []
    agree = sum(int(x.get("sympathyCount") or 0) for x in comments)
    disagree = sum(int(x.get("antipathyCount") or 0) for x in comments)
    total_reactions = agree + disagree
    balance = (1 - abs(agree - disagree) / total_reactions) if total_reactions else 0
    article = dict(article)
    article.update({
        "comment_count": int((result.get("count") or {}).get("comment") or 0),
        "comment_agree": agree, "comment_disagree": disagree,
        "division_balance": round(balance, 6),
        "division_score": round(balance * math.log1p(total_reactions), 6),
    })
    return article


def parallel_enrich(items: Iterable[dict], workers: int = 12) -> list[dict]:
    unique = {x["url"]: x for x in items}
    out = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(enrich, x): x["url"] for x in unique.values()}
        for future in as_completed(futures):
            try:
                out.append(future.result())
            except Exception as exc:
                print(f"후보 제외 {futures[future]}: {exc}", file=sys.stderr)
    return out


def in_window(article: dict, start: datetime, end: datetime) -> bool:
    published = datetime.fromisoformat(article["published_at"])
    return start <= published <= end


def select(mode: str, hours: int, now: datetime | None = None) -> dict:
    now = now or datetime.now(KST)
    if mode == "daily":
        target = (now - timedelta(days=1)).date()
        start = datetime.combine(target, datetime.min.time(), tzinfo=KST)
        end = start + timedelta(days=1) - timedelta(microseconds=1)
        day = target.strftime("%Y%m%d")
        viewed_raw = ranking_candidates(day)
        comments_raw = ranking_candidates(day, comment=True)
    else:
        start, end = now - timedelta(hours=hours), now
        day = now.strftime("%Y%m%d")
        viewed_raw = ranking_candidates(day)
        for sid in ("100", "101", "102"):
            viewed_raw.extend(section_candidates(sid))
        comments_raw = ranking_candidates(day, comment=True)

    viewed = [x for x in parallel_enrich(viewed_raw) if in_window(x, start, end)]
    viewed.sort(key=lambda x: (x.get("view_rank", 99), x.get("publisher_order", 999)))
    picked, seen = [], set()
    for label, sids in SECTIONS.items():
        count = 0
        for article in viewed:
            if article["section_id"] not in sids or article["url"] in seen:
                continue
            picked.append(dict(article, selection=label))
            seen.add(article["url"]); count += 1
            if count == 2:
                break

    comment_candidates = [x for x in parallel_enrich(comments_raw)
                          if in_window(x, start, end) and x["url"] not in seen]
    controversial = []
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(comment_stats, x): x["url"] for x in comment_candidates}
        for future in as_completed(futures):
            try:
                article = future.result()
                if article["comment_count"] >= 100:
                    controversial.append(article)
            except Exception as exc:
                print(f"댓글 통계 제외 {futures[future]}: {exc}", file=sys.stderr)
    controversial.sort(key=lambda x: (x["division_score"], x["comment_count"]), reverse=True)
    for article in controversial[:3]:
        picked.append(dict(article, selection="찬반 쟁점"))

    keep = ("title", "source", "url", "published_at", "section_id", "view_rank",
            "comment_count", "comment_agree", "comment_disagree", "division_balance",
            "division_score", "selection")
    items = [{k: x[k] for k in keep if k in x} for x in picked[:7]]
    return {
        "date": now.strftime("%Y-%m-%d"), "generated_at": now.isoformat(timespec="seconds"),
        "mode": mode, "window_start": start.isoformat(timespec="seconds"),
        "window_end": end.isoformat(timespec="seconds"), "outro": True, "items": items,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=("daily", "recent"), default="daily")
    parser.add_argument("--hours", type=int, default=5)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    payload = select(args.mode, max(1, args.hours))
    if not payload["items"]:
        print("선정된 기사가 없습니다.", file=sys.stderr)
        return 1
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{args.mode}: {len(payload['items'])}건 / {payload['window_start']} ~ {payload['window_end']}")
    for item in payload["items"]:
        print(f"- [{item['selection']}] {item['title']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
