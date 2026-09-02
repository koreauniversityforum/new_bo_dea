# -*- coding: utf-8 -*-
"""인용문(쌍따옴표) 기반 관련 기사 시험 - related.quotes / find_quoted / feed 의 인용 묶음.

    python 시험_인용찾기.py

인터넷 없이 돈다(검색 두 곳을 가짜로 갈아 끼운다).
요구(2026-09-02): "인용한 쌍따옴표 내부 문장이 같은 기사들을 3개 이상 요약해서
동일한 맥락으로 피드 글을 작성" - 그 세 가지를 각각 시험한다.
  ① 발언을 제대로 뽑는가          ② 3건을 채울 때까지만 찾는가
  ③ 캡션에 그 맥락이 들어가는가   (+ 모자라면 부풀리지 않는가)
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import feed  # noqa: E402
import related  # noqa: E402

본문 = (
    '김 대표는 이날 회의에서 "지금은 속도보다 방향이 중요하다"고 말했다. '
    "그는 예산 처리 시한을 못 박지는 않았다. "
    '이어 "국민이 체감할 때까지 멈추지 않겠다"며 후속 대책을 예고했다. '
    "회의는 두 시간 넘게 이어졌다. 참석자들은 대체로 공감했다고 전했다."
)


def 가짜검색(표):
    """제목 목록을 주는 가짜 RSS. 검색어(따옴표 포함)를 그대로 열쇠로 쓴다."""
    부른것 = []

    def _google(q, days=3, timeout=20):
        부른것.append(q)
        return [{"title": t, "press": p, "link": l, "when": None,
                 "direct": False, "src": "google"} for t, p, l in 표.get(q, [])]

    def _bing(q, timeout=15):
        부른것.append(q)
        return []
    return _google, _bing, 부른것


class 발언뽑기(unittest.TestCase):
    def test_쌍따옴표_안만_뽑는다(self):
        말 = related.quotes(본문, n=5)
        self.assertIn("지금은 속도보다 방향이 중요하다", 말)
        self.assertIn("국민이 체감할 때까지 멈추지 않겠다", 말)
        self.assertTrue(all("회의는" not in x for x in 말), 말)

    def test_긴_발언이_먼저다(self):
        말 = related.quotes(본문, n=5)
        self.assertGreaterEqual(len(말[0]), len(말[-1]))

    def test_짧은_따옴표는_버린다(self):
        self.assertEqual(related.quotes('그는 "네"라고 답했다.'), [])

    def test_같은_말은_하나만(self):
        두번 = '"같은 말을 두 번 실었다" 그리고 또 "같은 말을 두 번 실었다"'
        self.assertEqual(len(related.quotes(두번)), 1)

    def test_따옴표가_없으면_빈손(self):
        self.assertEqual(related.quotes("따옴표가 없는 평범한 문장이다."), [])

    def test_검색_토막은_어절_경계로_줄인다(self):
        말 = "지금은 속도보다 방향이 중요하다는 점을 다시 강조하고 싶습니다 여러분"
        토막 = related._quote_tries(말)
        self.assertEqual(토막[0], 말)
        self.assertGreater(len(토막), 1)
        for t in 토막[1:]:
            self.assertFalse(t.endswith(" "), t)
            self.assertTrue(말.startswith(t), t)


class 인용검색(unittest.TestCase):
    def setUp(self):
        self._g, self._b = related.search_google, related.search_bing

    def tearDown(self):
        related.search_google, related.search_bing = self._g, self._b

    def test_세건을_채우면_더_안_찾는다(self):
        q = '"지금은 속도보다 방향이 중요하다"'
        g, b, 부른것 = 가짜검색({q: [
            ("A매체 기사", "조선일보", "https://chosun.com/1"),
            ("B매체 기사", "중앙일보", "https://joongang.co.kr/2"),
            ("C매체 기사", "한겨레", "https://hani.co.kr/3"),
        ]})
        related.search_google, related.search_bing = g, b
        r = related.find_quoted("지금은 속도보다 방향이 중요하다", deep=False)
        self.assertEqual(r["found"], 3)
        self.assertEqual(len(set(부른것)), 1, 부른것)   # 토막을 줄여 다시 부르지 않았다
        self.assertTrue(all(i["by_quote"] for i in r["items"]))

    def test_못_채우면_토막을_줄여_다시_찾는다(self):
        말 = "국민이 체감할 때까지 멈추지 않겠다는 뜻을 분명히 했다"
        토막 = related._quote_tries(말)
        g, b, 부른것 = 가짜검색({'"%s"' % 토막[1]: [
            ("B1", "한국일보", "https://hankookilbo.com/1"),
            ("B2", "서울신문", "https://seoul.co.kr/2"),
            ("B3", "경향신문", "https://khan.co.kr/3"),
        ]})
        related.search_google, related.search_bing = g, b
        r = related.find_quoted(말, deep=False)
        self.assertEqual(r["found"], 3)
        self.assertEqual(r["query"], 토막[1])
        self.assertGreater(len(set(부른것)), 1)

    def test_같은_기사는_한_번만(self):
        말 = "지금은 속도보다 방향이 중요하다는 이야기를 오늘 다시 했다"
        토막 = related._quote_tries(말)
        표 = {'"%s"' % t: [("같은 제목", "조선일보", "https://chosun.com/1")] for t in 토막}
        g, b, _ = 가짜검색(표)
        related.search_google, related.search_bing = g, b
        r = related.find_quoted(말, deep=False)
        self.assertEqual(r["found"], 1)

    def test_짧은_말은_아예_안_찾는다(self):
        related.search_google = lambda *a, **k: self.fail("짧은 말로 검색했습니다")
        r = related.find_quoted("네 알겠습니다")
        self.assertEqual(r["items"], [])


def 인용기사(n, body=""):
    return [{"title": "보도 %d" % i, "press": ["조선일보", "중앙일보", "한겨레", "경향신문"][i % 4],
             "link": "https://x/%d" % i, "by_quote": True, "quote_ok": i == 0,
             "quote": "지금은 속도보다 방향이 중요하다", "body": body}
            for i in range(n)]


class 캡션(unittest.TestCase):
    def _글(self, related_rows, style="news"):
        return feed.compose({"title": "김 대표 회의 발언", "body": 본문,
                             "press": "연합뉴스", "date": "2026-09-02 10:00",
                             "url": "https://n.news.naver.com/x"}, related_rows, style)

    def test_인용_묶음이_캡션에_들어간다(self):
        r = self._글(인용기사(3))
        self.assertIn("지금은 속도보다 방향이 중요하다", r["text"])
        self.assertIn("이 발언을 그대로 실은 보도 3건", r["text"])
        self.assertEqual(r["quoted"], 3)
        self.assertTrue(r["quoteEnough"])

    def test_모자라면_모자란_대로_적는다(self):
        r = self._글(인용기사(2))
        self.assertIn("이 발언을 그대로 실은 보도 2건", r["text"])
        self.assertIn("3건을 채우지 못했습니다", r["text"])
        self.assertFalse(r["quoteEnough"])

    def test_확인된_기사에는_표시가_붙는다(self):
        r = self._글(인용기사(3))
        self.assertIn("✔", r["text"])

    def test_네_가지_글투_모두에_들어간다(self):
        for style in ("news", "magazine", "brief", "cards"):
            r = self._글(인용기사(3), style)
            self.assertIn("🗣", r["text"], style)
            self.assertEqual(r["style"], style)

    def test_인용이_없으면_옛_모양_그대로(self):
        r = self._글([{"title": "그냥 관련 기사", "press": "한겨레", "link": "https://x/9"}])
        self.assertNotIn("🗣", r["text"])
        self.assertEqual(r["quoted"], 0)

    def test_본문이_있으면_함께_짚은_맥락을_뽑는다(self):
        같은맥락 = ("김 대표는 예산 처리 시한을 두고 속도보다 방향을 강조했다. "
                 "회의에서는 후속 대책과 국민 체감이 거듭 언급됐다. "
                 "참석자들은 예산 방향에 대체로 공감했다고 전했다.")
        r = self._글(인용기사(3, 같은맥락))
        self.assertIn("함께 짚은 맥락", r["text"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
