# -*- coding: utf-8 -*-
"""발행 결과를 메일로 알린다 (Actions 안에서). 별도 앱 없이 폰의 메일 앱 알림으로 받는다.

    python notify.py --log .cards/결과.txt --kind 발행 --code 0
    python notify.py --log 결과.txt --kind 예약 --code 1

## 시크릿 (new_bo_dea)
MAIL_USER    보내는 지메일 주소
MAIL_APP_PW  그 계정의 「앱 비밀번호」 16자리(구글 계정 → 보안 → 2단계 인증 → 앱 비밀번호)
MAIL_TO      받는 주소(쉼표로 여럿). 비우면 MAIL_USER 로 보낸다
셋 다 로그에 찍지 않는다. 설정이 없거나 메일이 막혀도 **발행 결과에는 손대지 않는다**(늘 0 으로 끝남).
"""
from __future__ import annotations

import argparse
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage

# 결과 로그에서 사람이 볼 줄만 고른다(창구별 ✔/✘ + 링크, 첫 댓글 경고, 막힌 까닭, 예약 머리)
고를머리 = ("✔", "✘", "‼", "⚠", "──────── 예약", "발행할 예약", "정말 또 올리려면")


def 요약(로그):
    줄들 = []
    for s in 로그.splitlines():
        t = s.strip()
        if t.startswith("✔") and " 올림 " in t:     # 진행 중 줄 - 같은 내용이 「마무리」에 또 나온다
            continue
        if t.startswith(고를머리) and t not in 줄들:
            줄들.append(t)
    return 줄들


def main(argv=None):
    ap = argparse.ArgumentParser(description="발행 결과 메일")
    ap.add_argument("--log", required=True)
    ap.add_argument("--kind", default="발행")
    ap.add_argument("--code", default="0")
    a = ap.parse_args(argv)

    user = os.environ.get("MAIL_USER", "").strip()
    pw = os.environ.get("MAIL_APP_PW", "").replace(" ", "").strip()
    to = [x.strip() for x in (os.environ.get("MAIL_TO") or user).split(",") if x.strip()]
    if not (user and pw and to):
        print("알림 메일 설정(MAIL_USER·MAIL_APP_PW)이 없어 메일을 건너뜁니다.")
        return 0

    try:
        with open(a.log, encoding="utf-8", errors="replace") as f:
            로그 = f.read()
    except OSError:
        로그 = ""
    줄들 = 요약(로그)
    ok = a.code == "0"
    if any(t.startswith("‼ 같은 글") for t in 줄들):
        머리 = "↩ 이미 올라간 글이라 다시 올리지 않음"
    elif ok:
        머리 = "✅ %s 완료" % a.kind
    else:
        머리 = "⚠️ %s 실패" % a.kind
    if any(t.startswith("⚠") for t in 줄들) and ok:
        머리 += " (첫 댓글 경고)"

    run = ""
    if os.environ.get("GITHUB_RUN_ID"):
        run = "%s/%s/actions/runs/%s" % (os.environ.get("GITHUB_SERVER_URL", "https://github.com"),
                                         os.environ.get("GITHUB_REPOSITORY", ""), os.environ["GITHUB_RUN_ID"])
    몸 = [머리, ""] + (줄들 or ["(결과 줄을 찾지 못했습니다 - 아래 실행 기록을 보세요)"])
    if run:
        몸 += ["", "실행 기록: " + run]
    몸 += ["", "- 뉴보대 발행 알림 (GitHub Actions)"]

    m = EmailMessage()
    m["Subject"] = "[뉴보대] " + 머리
    m["From"] = "뉴보대 발행 <%s>" % user
    m["To"] = ", ".join(to)
    m.set_content("\n".join(몸))
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=30) as s:
            s.login(user, pw)
            s.send_message(m)
        print("알림 메일을 보냈습니다 (%d곳)." % len(to))
    except Exception as e:                  # 메일이 막혀도 발행은 이미 끝났다
        왜 = type(e).__name__
        if isinstance(e, smtplib.SMTPAuthenticationError):
            왜 += " - MAIL_APP_PW 가 그 계정의 앱 비밀번호가 맞는지 보세요"
        print("::warning::알림 메일을 못 보냈습니다: %s" % 왜)
    return 0


if __name__ == "__main__":
    sys.exit(main())
