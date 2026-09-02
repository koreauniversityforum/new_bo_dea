# -*- coding: utf-8 -*-
"""기사 손질(prepare.py) 시험 - 브리핑 카드에 들어갈 사진·요약을 제대로 챙기는가.

    python 시험_기사손질.py

인터넷 없이 돈다. 본문 읽기(extractor)와 그림 받기(urlopen)를 가짜로 갈아 끼운다.
2026-09-02 에 밟은 함정 두 개가 여기 시험으로 남아 있다.
  - `summarizer.summarize()` 는 **후보 목록**을 준다. 목록째 넣으면 "요약 4자"가 된다.
  - 1x1 추적용 그림·오류 그림이 og:image 자리에 온다. 작으면 다음 후보로 넘어가야 한다.
"""
import io
import os
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extractor  # noqa: E402
import prepare  # noqa: E402


class 가짜응답(io.BytesIO):
    """urlopen 이 주는 것 흉내 - with 로 열고 headers 를 묻는다."""

    def __init__(self, blob, ctype):
        super().__init__(blob)
        self.headers = {"Content-Type": ctype}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()
        return False


def 그림들(**표):
    """주소 → (바이트, 종류) 로 답하는 가짜 urlopen 을 만든다. 없는 주소는 404 처럼 터진다."""
    def _open(req, timeout=0):
        url = req.full_url if hasattr(req, "full_url") else str(req)
        if url not in 표:
            raise OSError("404")
        blob, ctype = 표[url]
        return 가짜응답(blob, ctype)
    return _open


큰그림 = b"\xff\xd8" + b"x" * 9000            # 4000바이트 넘는 '진짜' 그림
작은그림 = b"\xff\xd8" + b"x" * 100           # 1x1 추적용 그림 흉내


class 손질(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.사진 = os.path.join(self.tmp, "사진")
        self._extract = extractor.extract
        self._urlopen = prepare.urllib.request.urlopen

    def tearDown(self):
        extractor.extract = self._extract
        prepare.urllib.request.urlopen = self._urlopen

    def _본문(self, **표):
        extractor.extract = lambda url: 표[url]

    def test_요약은_후보_목록의_첫째만_쓴다(self):
        본문 = ("정부가 추석을 앞두고 성수품 공급을 평시보다 1.6배 늘린다고 밝혔다. "
                "할인 지원 예산은 590억원으로 역대 최대다. 사과와 배, 한우와 계란이 대상이다. "
                "농림축산식품부는 다음 주부터 공급을 시작한다고 덧붙였다.")
        self._본문(**{"u1": {"body": 본문, "press": "머니투데이", "images": []}})
        it = {"url": "u1", "title": "추석 성수품 16만t 푼다"}
        prepare.한건(it, self.사진, "01")
        self.assertIsInstance(it["summary"], str)
        self.assertGreater(len(it["summary"]), 20, it["summary"])
        self.assertNotIn("[", it["summary"])          # 목록째 들어가면 대괄호가 남는다
        self.assertEqual(it["press"], "머니투데이")

    def test_사진을_파일로_받고_이름만_남긴다(self):
        self._본문(**{"u1": {"body": "", "images": ["https://img/a.jpg"]}})
        prepare.urllib.request.urlopen = 그림들(**{"https://img/a.jpg": (큰그림, "image/jpeg")})
        it = {"url": "u1", "title": "제목"}
        prepare.한건(it, self.사진, "01")
        self.assertEqual(it["photo"], "01.jpg")
        self.assertTrue(os.path.isfile(os.path.join(self.사진, "01.jpg")))

    def test_작은_그림은_거르고_다음_후보로_간다(self):
        self._본문(**{"u1": {"body": "", "images": ["https://img/1x1.gif", "https://img/b.png"]}})
        prepare.urllib.request.urlopen = 그림들(**{
            "https://img/1x1.gif": (작은그림, "image/gif"),
            "https://img/b.png": (큰그림, "image/png"),
        })
        it = {"url": "u1", "title": "제목"}
        prepare.한건(it, self.사진, "01")
        self.assertEqual(it["photo"], "01.png")

    def test_그림이_아니면_거른다(self):
        self._본문(**{"u1": {"body": "", "images": ["https://img/a.html"]}})
        prepare.urllib.request.urlopen = 그림들(**{"https://img/a.html": (큰그림, "text/html")})
        it = {"url": "u1", "title": "제목"}
        prepare.한건(it, self.사진, "01")
        self.assertNotIn("photo", it)

    def test_본문_실패는_그_기사만_비우고_넘어간다(self):
        def _extract(url):
            if url == "u1":
                raise RuntimeError("접속 거부")
            return {"body": "", "press": "한겨레", "images": []}
        extractor.extract = _extract
        items = [{"url": "u1", "title": "가"}, {"url": "u2", "title": "나"}]
        prepare.손질(items, self.사진)
        self.assertIn("prep_error", items[0])
        self.assertEqual(items[1]["press"], "한겨레")

    def test_주소가_없으면_건드리지_않는다(self):
        extractor.extract = lambda url: self.fail("주소가 없는데 본문을 읽으려 했습니다")
        it = {"url": "", "title": "가"}
        prepare.한건(it, self.사진, "01")
        self.assertEqual(it, {"url": "", "title": "가"})

    def test_사진_이름은_기본이_순번(self):
        self._본문(**{"u1": {"body": "", "images": ["https://img/a.jpg"]},
                    "u2": {"body": "", "images": ["https://img/a.jpg"]}})
        prepare.urllib.request.urlopen = 그림들(**{"https://img/a.jpg": (큰그림, "image/jpeg")})
        items = [{"url": "u1", "title": "가"}, {"url": "u2", "title": "나"}]
        prepare.손질(items, self.사진)
        self.assertEqual([x["photo"] for x in items], ["01.jpg", "02.jpg"])

    def test_이름짓기를_바꿔_끼울_수_있다(self):
        # 앱은 순번이 아니라 주소로 이름을 짓는다(부를 때마다 1번부터 시작하므로).
        self._본문(**{"u1": {"body": "", "images": ["https://img/a.jpg"]}})
        prepare.urllib.request.urlopen = 그림들(**{"https://img/a.jpg": (큰그림, "image/jpeg")})
        items = [{"url": "u1", "title": "가"}]
        prepare.손질(items, self.사진, 이름짓기=lambda i, it: "abc123")
        self.assertEqual(items[0]["photo"], "abc123.jpg")

    def test_묵은_사진만_지운다(self):
        os.makedirs(self.사진, exist_ok=True)
        옛것 = os.path.join(self.사진, "옛.jpg")
        새것 = os.path.join(self.사진, "새.jpg")
        for p in (옛것, 새것):
            with open(p, "wb") as f:
                f.write(큰그림)
        오래전 = time.time() - 10 * 86400
        os.utime(옛것, (오래전, 오래전))
        self.assertEqual(prepare.묵은사진지우기(self.사진, 날수=3), 1)
        self.assertFalse(os.path.exists(옛것))
        self.assertTrue(os.path.exists(새것))

    def test_긴요약은_세문장짜리_문단_둘(self):
        본문 = ("정부가 추석을 앞두고 성수품 공급을 평시보다 1.6배 늘린다고 밝혔다. "
              "할인 지원 예산은 590억원으로 역대 최대다. 사과와 배, 한우와 계란이 대상이다. "
              "대형마트에서는 국산 농축산물을 최대 40% 싸게 판다. "
              "직거래장터는 전국 스무 곳에서 열린다. "
              "농식품부는 장바구니 부담을 덜겠다고 말했다. "
              "지난해에도 비슷한 대책이 나왔지만 체감 효과는 크지 않았다.")
        긴 = prepare.긴요약(본문, "추석 성수품 대책")
        문단 = [p for p in 긴.split("\n\n") if p.strip()]
        self.assertEqual(len(문단), 2, 긴)
        for p in 문단:
            self.assertGreaterEqual(len([s for s in p.split(". ") if s.strip()]), 2, p)
        self.assertGreater(len(긴), 120, 긴)

    def test_긴요약은_같은_말을_두_번_넣지_않는다(self):
        본문 = ("할인 지원 예산은 590억원으로 역대 최대다. "
              "역대 최대인 할인 지원 예산 590억원이 편성됐다. "
              "사과와 배, 한우와 계란이 대상이다. "
              "대형마트에서는 국산 농축산물을 최대 40% 싸게 판다. "
              "직거래장터는 전국 스무 곳에서 열린다. "
              "농식품부는 장바구니 부담을 덜겠다고 말했다.")
        긴 = prepare.긴요약(본문, "추석 대책")
        self.assertEqual(긴.count("590억원"), 1, 긴)

    def test_본문이_짧으면_있는_만큼만(self):
        긴 = prepare.긴요약("한 문장뿐인 짧은 기사다.", "제목")
        self.assertNotIn("\n\n", 긴)

    def test_본문이_없으면_빈_문자열(self):
        self.assertEqual(prepare.긴요약("", "제목"), "")

    def test_손질이_긴요약도_채운다(self):
        본문 = ("정부가 추석을 앞두고 성수품 공급을 평시보다 1.6배 늘린다고 밝혔다. "
              "할인 지원 예산은 590억원으로 역대 최대다. 사과와 배, 한우와 계란이 대상이다. "
              "대형마트에서는 국산 농축산물을 최대 40% 싸게 판다. "
              "직거래장터는 전국 스무 곳에서 열린다. "
              "농식품부는 장바구니 부담을 덜겠다고 말했다. "
              "지난해에도 비슷한 대책이 나왔지만 체감 효과는 크지 않았다.")
        self._본문(**{"u1": {"body": 본문, "press": "머니투데이", "images": []}})
        it = {"url": "u1", "title": "추석 성수품"}
        prepare.한건(it, self.사진, "01")
        self.assertIn("summary_long", it)
        self.assertGreater(len(it["summary_long"]), len(it["summary"]))

    def test_없는_폴더에_묵은사진지우기를_불러도_안_터진다(self):
        self.assertEqual(prepare.묵은사진지우기(os.path.join(self.tmp, "없음")), 0)


if __name__ == "__main__":
    unittest.main(verbosity=2)
