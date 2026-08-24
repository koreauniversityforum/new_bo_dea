# -*- coding: utf-8 -*-
"""추천 노래(bgm.js) 규칙 시험 — node 로 bgm.js 를 그대로 불러 확인한다.

규칙을 파이썬으로 옮겨 적으면 두 벌이 갈라진다(이 프로젝트에서 이미 겪었다).
그래서 **실제로 화면이 쓰는 그 파일**을 node 로 불러서 시험한다.

실행: python 시험_추천노래.py
필요: node (없으면 건너뛴다고 알리고 끝낸다)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
BGM = os.path.join(BASE, "static", "bgm.js")

# (제목, 본문, 갈래, 이 무드가 나와야 함)
CASES = [
    # ── 무거운 소식에 밝은 곡을 추천하면 이 기능에서 제일 크게 잘못된다 ──
    ("전세사기 피해자 3명 숨져… 유가족 오열", "", "", "heavy"),
    ("공사장 붕괴로 2명 사망 1명 실종", "", "사회", "heavy"),
    ("코스피 폭락, 개인 투자자 손실 눈덩이", "", "경제", "heavy"),
    # ── 긴박 ──
    ("속보: 국회 본회의 탄핵안 표결 시작", "", "정치", "tense"),
    ("단독 입수 문건, 오늘 판결 앞두고 공개", "", "", "tense"),
    # ── 밝음 ──
    ("반도체 수출 최고 기록 달성", "", "경제", "bright"),
    ("한국 양궁 전 종목 우승", "", "", "bright"),
    # ── 따뜻함 ──
    ("대학생들 연탄 나눔 봉사 이어져", "", "", "warm"),
    ("익명 기부자 5년째 후원", "", "사회", "warm"),
    # ── 설명 ──
    ("금리 인하 쟁점 한눈에 정리", "", "경제", "explain"),
    ("전세 제도 왜 이렇게 됐나, 배경 분석", "", "", "explain"),
    # ── 기술 ──
    ("AI 반도체 스타트업 투자 이어져", "", "IT·과학", "future"),
    ("누리호 위성 궤도 안착", "", "", "future"),
    # ── 아무 단서도 없을 때: 갈래 밑점수로만 ──
    ("", "", "정치", "calm"),
    ("", "", "IT·과학", "future"),
]

JS = r"""
const B = require(process.argv[1]);
const cases = JSON.parse(process.argv[2]);
const out = cases.map(([t, b, c]) => {
  const r = B.pick({ title: t, body: b, cat: c });
  return { key: r.key, mood: r.mood, queries: r.queries, why: r.why, alt: r.alt.key };
});
console.log(JSON.stringify(out));
"""


def main() -> int:
    if not shutil.which("node"):
        print("node 가 없어 건너뜁니다 (설치돼 있으면 규칙까지 시험합니다).")
        return 0
    if not os.path.exists(BGM):
        print("[실패] bgm.js 가 없습니다: %s" % BGM)
        return 1

    payload = json.dumps([[t, b, c] for t, b, c, _ in CASES], ensure_ascii=False)
    r = subprocess.run(["node", "-e", JS, BGM, payload],
                       capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        print("[실패] node 실행 오류\n%s" % r.stderr[:1500])
        return 1

    got = json.loads(r.stdout)
    bad = 0

    for (title, body, cat, want), g in zip(CASES, got):
        ok = g["key"] == want
        if not ok:
            bad += 1
        print("%s %-10s %-34s → %-8s (기대 %s)"
              % ("OK  " if ok else "틀림", cat or "-", (title or "(제목 없음)")[:32], g["key"], want))
        if not ok:
            print("       근거로 잡힌 말: %s" % (", ".join(g["why"]) or "없음"))

    # ── 지어내기 방지: 검색어에 곡 제목처럼 보이는 것이 섞이지 않았는지 ──
    print()
    for g in got:
        if not g["queries"]:
            print("[실패] 검색어가 비었습니다: %s" % g["key"])
            bad += 1
        for q in g["queries"]:
            # 검색어는 짧은 말이어야 한다. 따옴표·대시가 붙으면 곡 제목을 지어낸 것이다.
            if any(ch in q for ch in ('"', "'", " - ", "—")):
                print("[실패] 곡 제목처럼 보이는 검색어: %r" % q)
                bad += 1

    # ── 무거운 소식에는 밝은 결이 대안으로도 붙으면 안 된다 ──
    for (title, _b, _c, want), g in zip(CASES, got):
        if want == "heavy" and g["alt"] in ("bright",):
            print("[실패] 무거운 소식인데 대안이 밝은 결입니다: %s" % title)
            bad += 1

    print()
    if bad:
        print("실패 %d 건" % bad)
        return 1
    print("모두 통과 (%d 건)" % len(CASES))
    return 0


if __name__ == "__main__":
    sys.exit(main())
