# -*- coding: utf-8 -*-
"""요약기 이식 대조 시험 — summarizer.py(원본) 대 폰판_소스/summarizer.js(이식본).

폰판은 서버가 없어서 요약을 브라우저에서 돌린다. 두 구현이 갈라지면 폰에서만
다른 문구가 나오는데, 그건 화면을 봐도 눈치채기 어렵다. 그래서 같은 기사에
같은 결과가 나오는지 항목 단위로 맞춰 본다.

실행: python 시험_요약기_대조.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
import summarizer  # noqa: E402

JS = os.path.join(BASE, "폰판_소스", "summarizer.js")

SAMPLES = [
    # 1) 기관 행사 — 인물+직함, 행사명이 있는 전형적인 보도자료형
    ("한국대학생포럼, 긴급 간담회 열어",
     """(서울=뉴스1) 김현수 기자 = 한국대학생포럼은 18일 서울 여의도에서 대학생 등록금
     문제를 주제로 긴급 간담회를 열었다. 이날 간담회에는 전국 30개 대학 총학생회
     관계자 50여 명이 참석했다. 박현수 회장은 "등록금 인상은 학생들의 학습권을 흔드는
     문제"라며 "대학과 정부가 함께 해법을 찾아야 한다"고 말했다. 포럼은 이번 간담회에서
     나온 의견을 모아 다음 달 정책 제안서를 국회에 전달할 계획이다. 참석자들은 대학
     재정 투명성 공개를 요구하는 공동 성명도 채택했다. ⓒ 뉴스1 무단 전재 및 재배포 금지"""),
    # 2) 정치 — 부제(데크) 줄과 인용이 섞인 형태
    ("윤상현, 선관위 개혁 촉구",
     """원산 일대서 1발…軍 "분석중"…탄도미사일은 42일만
     윤상현 국민의힘 의원은 17일 선거관리위원회의 채용 비리 의혹과 관련해 전면적인
     조직 개혁을 촉구했다. 윤 의원은 이날 국회에서 열린 기자회견에서 "선관위의 중립성이
     무너졌다"고 비판했다. 그는 "국민 신뢰를 회복하려면 외부 감사를 상시화해야 한다"고
     강조했다. 선관위는 이에 대해 "제도 개선안을 마련해 이달 중 발표하겠다"고 밝혔다.
     야당은 국정조사 추진을 예고하며 공방이 이어지고 있다."""),
    # 3) 경제 — 숫자·긍정어 위주, 직함 없는 기업 기사
    ("",
     """국내 이차전지 수출이 지난달 기준 사상 최대를 기록했다. 산업통상자원부는 7월
     이차전지 수출액이 12억 달러로 지난해 같은 달보다 24% 증가했다고 18일 밝혔다.
     북미 지역 수출이 전체의 절반을 넘어섰고, 유럽 수출도 두 자릿수 성장을 이어갔다.
     업계는 하반기에도 증가세가 이어질 것으로 기대하고 있다. 다만 원자재 가격 상승과
     현지 생산 확대가 변수로 꼽힌다. 정부는 소재 국산화를 지원하는 대책을 마련해
     이달 안에 발표할 예정이다."""),
    # 4) 본문만 있고 제목이 없는 짧은 글
    ("", """서울시는 다음 달부터 청년 월세 지원 신청을 받는다고 밝혔다. 지원 대상은 만
     19세에서 39세 무주택 청년이며, 월 20만원을 최대 12개월간 지원한다. 신청은 서울시
     복지포털에서 할 수 있다. 시는 올해 2만 명을 지원할 계획이다."""),
]

KEYS = ["titles", "hooks", "summaries", "keywords", "sentences"]


def js_analyze(payload):
    """node 로 이식본을 돌려 결과를 받아온다."""
    code = (
        "const S=require(process.argv[1]);"
        "const jobs=JSON.parse(process.argv[2]);"
        "console.log(JSON.stringify(jobs.map(j=>S.analyze(j[1],j[0]))));"
    )
    out = subprocess.run(
        ["node", "-e", code, JS, json.dumps(payload, ensure_ascii=False)],
        capture_output=True, text=True, encoding="utf-8",
    )
    if out.returncode != 0:
        print("node 실행 실패:\n" + (out.stderr or "")[:2000])
        sys.exit(1)
    return json.loads(out.stdout)


def main():
    if not os.path.isfile(JS):
        print("이식본을 찾지 못했습니다: " + JS)
        return 1
    py = [summarizer.analyze(body, title) for title, body in SAMPLES]
    js = js_analyze([[t, b] for t, b in SAMPLES])

    bad = 0
    for i, (a, b) in enumerate(zip(py, js), 1):
        for k in KEYS:
            if a.get(k) != b.get(k):
                bad += 1
                print(f"\n[{i}번 기사] {k} 불일치")
                print("  파이썬: " + json.dumps(a.get(k), ensure_ascii=False))
                print("  자바스: " + json.dumps(b.get(k), ensure_ascii=False))
    total = len(SAMPLES) * len(KEYS)
    print(f"\n대조 {total}건 중 불일치 {bad}건")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
