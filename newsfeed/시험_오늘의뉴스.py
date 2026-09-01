# -*- coding: utf-8 -*-
"""오늘의 뉴스(daily.py) 시험 - 봇이 남긴 JSON 을 제대로 읽어 화면 꼴로 바꾸는가.

    python 시험_오늘의뉴스.py

인터넷·봇 없이 돈다. 임시 폴더에 봇과 **같은 꼴**의 파일을 만들어 넣고 읽힌다.
봇 쪽 꼴이 바뀌면 여기부터 깨져야 한다(그게 이 시험의 목적).
"""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daily  # noqa: E402


def 봇파일(폴더, 날짜="2026-09-01"):
    """telegram_news_bot_v3.save_digest() 가 쓰는 것과 같은 꼴."""
    payload = {
        "schema": 1,
        "generated_at": 날짜 + "T08:58:00+09:00",
        "date": 날짜,
        "count": 3,
        "categories": {
            "정치": [
                {"title": "국회, 예산안 처리 합의", "url": "https://n.news.naver.com/a/1",
                 "source": "네이버 정치", "category": "정치",
                 "published": "2026-09-01 08:30", "view_rank": 1, "comment_count": 940},
                {"title": "여야 대표 회동", "url": "https://n.news.naver.com/a/2",
                 "source": "네이버 정치", "category": "정치", "view_rank": 2},
            ],
            "빈칸": [],
            "경제": [
                {"title": "환율 1,300원대 회복", "url": "https://n.news.naver.com/a/3",
                 "source": "네이버 경제", "category": "경제", "view_rank": 1},
            ],
        },
        "overlapping": [
            {"title": "Chip tariffs announced", "translated_title": "반도체 관세 발표",
             "url": "https://www.nytimes.com/x", "source": "NYT", "category": "해외",
             "sources": ["NYT", "BBC"], "source_count": 2},
        ],
    }
    os.makedirs(폴더, exist_ok=True)
    blob = json.dumps(payload, ensure_ascii=False, indent=1)
    for 이름 in (날짜 + ".json", "latest.json"):
        with open(os.path.join(폴더, 이름), "w", encoding="utf-8") as f:
            f.write(blob)
    return payload


class 읽기(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.data = os.path.join(self.tmp, "korea_news_bot", "data")
        봇파일(self.data)
        os.environ["NBD_NEWS_DATA"] = self.data
        daily._last_pull.clear()

    def tearDown(self):
        os.environ.pop("NBD_NEWS_DATA", None)

    def test_폴더를_환경변수로_찾는다(self):
        self.assertEqual(os.path.abspath(daily.data_dir()), os.path.abspath(self.data))

    def test_파일을_직접_가리켜도_받는다(self):
        os.environ["NBD_NEWS_DATA"] = os.path.join(self.data, "latest.json")
        self.assertEqual(os.path.abspath(daily.data_dir()), os.path.abspath(self.data))

    def test_최신을_읽고_묶음으로_돌려준다(self):
        r = daily.load(pull=False)
        self.assertTrue(r["ok"], r.get("error"))
        self.assertEqual(r["date"], "2026-09-01")
        이름들 = [g["name"] for g in r["groups"]]
        self.assertIn("정치", 이름들)
        self.assertIn("해외 겹친 보도", 이름들)

    def test_빈_카테고리는_빼고_준다(self):
        r = daily.load(pull=False)
        self.assertNotIn("빈칸", [g["name"] for g in r["groups"]])

    def test_기사_한_줄의_꼴(self):
        r = daily.load(pull=False)
        정치 = [g for g in r["groups"] if g["name"] == "정치"][0]
        a = 정치["items"][0]
        self.assertEqual(a["title"], "국회, 예산안 처리 합의")
        self.assertEqual(a["url"], "https://n.news.naver.com/a/1")
        self.assertEqual(a["rank"], 1)
        self.assertEqual(a["comments"], 940)
        self.assertEqual(a["origin"], "")           # 번역된 제목이 아니면 원문 칸은 빈다

    def test_해외기사는_번역제목을_앞세우고_원문을_남긴다(self):
        r = daily.load(pull=False)
        해외 = [g for g in r["groups"] if g["name"] == "해외 겹친 보도"][0]["items"][0]
        self.assertEqual(해외["title"], "반도체 관세 발표")
        self.assertEqual(해외["origin"], "Chip tariffs announced")
        self.assertEqual(해외["sources"], ["NYT", "BBC"])

    def test_날짜를_지정해_지난_것도_읽는다(self):
        r = daily.load("2026-09-01", pull=False)
        self.assertTrue(r["ok"])
        self.assertIn("2026-09-01", r["days"])

    def test_없는_날짜는_가진_것_중_최신으로_대신한다(self):
        r = daily.load("1999-01-01", pull=False)
        self.assertTrue(r["ok"])
        self.assertEqual(r["date"], "2026-09-01")

    def test_폴더가_없으면_안내문을_준다(self):
        os.environ["NBD_NEWS_DATA"] = os.path.join(self.tmp, "없는곳")
        daily.CANDIDATES.insert(0, os.path.join(self.tmp, "없는곳2"))
        try:
            r = daily.load(pull=False)
        finally:
            daily.CANDIDATES.pop(0)
        if r["ok"]:
            self.skipTest("이 컴퓨터에 진짜 봇 폴더가 있어 대신 읽혔습니다")
        self.assertIn("찾지 못했습니다", r["error"])

    def test_깨진_파일은_화면을_죽이지_않는다(self):
        with open(os.path.join(self.data, "latest.json"), "w", encoding="utf-8") as f:
            f.write("{망가진")
        r = daily.load(pull=False)
        self.assertFalse(r["ok"])
        self.assertIn("읽지 못했습니다", r["error"])

    def test_새_형식이면_알려_준다(self):
        p = os.path.join(self.data, "latest.json")
        j = json.load(open(p, encoding="utf-8"))
        j["schema"] = daily.SCHEMA + 1
        json.dump(j, open(p, "w", encoding="utf-8"), ensure_ascii=False)
        r = daily.load(pull=False)
        self.assertTrue(r["ok"])
        self.assertIn("새 형식", r["note"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
