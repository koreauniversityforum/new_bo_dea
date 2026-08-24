# -*- coding: utf-8 -*-
"""메타 계정 잇기 - 인스타 · 페이스북 페이지 · 스레드 토큰을 받아 저장한다.

사람 손이 필요한 건 **여기 한 번뿐**이다. 이후 올리기·갱신은 자동으로 돈다.

    python 메타_연결.py 앱                  앱 ID·비밀 적어 두기 (맨 처음 한 번)
    python 메타_연결.py 호스팅              그림을 어디에 공개할지 정하기
    python 메타_연결.py 연결 news_univ      계정 하나 잇기 (브라우저 왕복 2번)
    python 메타_연결.py 목록                지금 이어진 것 보기
    python 메타_연결.py 확인 news_univ      토큰이 살아 있는지 실제로 두드려 보기

## 왜 주소를 손으로 붙여넣게 하나
메타는 로그인 후 돌아올 주소(redirect URI)가 **HTTPS** 여야 한다고 못 박는다. 노트북에
https 서버를 세우는 건 인증서까지 만들어야 해서 배보다 배꼽이다. 그래서 이미 가진
깃허브 페이지 주소를 돌아올 자리로 쓰고, 주소창을 통째로 복사해 오게 한다.
🔴 그 주소에서 **404 가 떠도 정상이다.** 우리가 필요한 건 주소창의 `code=…` 뿐이다.
"""
from __future__ import annotations

import sys
import webbrowser

import meta_api as M


def 물음(말, 기본=""):
    s = input(말 + ((" [%s]" % 기본) if 기본 else "") + ": ").strip()
    return s or 기본


def 앱넣기():
    d = M.설정읽기()
    앱 = d["앱"]
    print("메타 개발자 대시보드(developers.facebook.com) → 내 앱 → 설정 → 기본 설정 에서 가져오세요.\n")
    앱["app_id"] = 물음("페이스북 앱 ID", 앱.get("app_id", ""))
    앱["app_secret"] = 물음("페이스북 앱 시크릿", 앱.get("app_secret", ""))
    print("\n스레드는 같은 앱 안에서도 ID·시크릿이 **따로** 나옵니다 "
          "(앱 → 유스 케이스 → Threads API → 설정).")
    print("스레드를 안 쓸 거면 그냥 엔터를 치세요.")
    앱["threads_app_id"] = 물음("스레드 앱 ID", 앱.get("threads_app_id", ""))
    앱["threads_app_secret"] = 물음("스레드 앱 시크릿", 앱.get("threads_app_secret", ""))
    앱["redirect_uri"] = 물음(
        "\n돌아올 주소(redirect URI)\n"
        "  ※ 앱 설정의 「유효한 OAuth 리디렉션 URI」에 **똑같이** 넣어야 합니다\n"
        "  주소",
        앱.get("redirect_uri",
               "https://koreauniversityforum.github.io/new_bo_dea/connect.html"))
    print("\n저장:", M.설정쓰기(d))
    print("다음 → python 메타_연결.py 호스팅")


def 호스팅넣기():
    d = M.설정읽기()
    h = d["호스팅"]
    print("""인스타와 스레드는 그림을 바이트로 못 받습니다. **공개 HTTPS 주소**를 줘야 하고
메타 서버가 그 주소를 직접 읽어 갑니다. 어디에 잠깐 올려 둘지 고르세요.

  1) 깃허브페이지  이미 쓰는 new_bo_dea 의 docs/ 에 잠깐 올렸다 지웁니다 (추가 준비 0)
                   - 배포에 30초~2분 걸리고, 깃 이력에는 그림이 남습니다
  2) 직접          젯슨처럼 이미 공개된 폴더가 있을 때 (가장 빠릅니다)
  3) 터널          cloudflared 로 그 순간만 주소를 엽니다 (아무 것도 안 남습니다)
""")
    고름 = 물음("번호", {"깃허브페이지": "1", "직접": "2", "터널": "3"}.get(h.get("방식"), "1"))
    if 고름 == "2":
        h["방식"] = "직접"
        h["폴더"] = 물음("공개 폴더(로컬 경로)", h.get("폴더", ""))
        h["공개주소"] = 물음("그 폴더가 보이는 주소", h.get("공개주소", ""))
    elif 고름 == "3":
        h["방식"] = "터널"
    else:
        h["방식"] = "깃허브페이지"
        h["저장소"] = 물음("저장소 폴더", h.get("저장소", M.os.path.dirname(M.BASE)))
        h["공개주소"] = 물음("페이지 주소", h.get(
            "공개주소", "https://koreauniversityforum.github.io/new_bo_dea/"))
        h["하위"] = h.get("하위", "docs/올림")
    print("\n저장:", M.설정쓰기(d))


def 열고받기(주소, 무엇):
    print("\n── %s ──" % 무엇)
    print("아래 주소를 브라우저에서 열고 로그인·동의하세요.\n\n%s\n" % 주소)
    try:
        webbrowser.open(주소)
    except Exception:
        pass
    print("동의가 끝나면 주소창이 돌아올 주소로 바뀝니다 (404 여도 정상입니다).")
    붙임 = input("그 주소창을 통째로 복사해 붙여넣으세요: ").strip()
    return M.코드뽑기(붙임)


def 잇기(키):
    d = M.설정읽기()
    앱 = M.앱정보(d)
    계정 = d["계정"].setdefault(키, {"이름": 키})

    print("\n[%s] 를 잇습니다. 브라우저 왕복이 두 번 있습니다 "
          "(① 인스타+페이스북 ② 스레드).\n" % 키)
    print("🔴 먼저 확인: 이 계정이 앱의 **테스터**로 등록돼 있어야 심사 없이 올릴 수 있습니다.")
    print("   (앱 대시보드 → 앱 역할 → 테스터 초대 → 해당 계정에서 수락)")

    # ① 페이스북 로그인 - 인스타와 페이지를 한 번에
    if 물음("\n인스타·페이스북을 지금 이을까요? (y/n)", "y").lower().startswith("y"):
        code = 열고받기(M.페이스북_동의주소(앱), "인스타그램 + 페이스북 페이지")
        토큰, 초 = M.페이스북_토큰(앱, code)
        대상 = M.대상찾기(토큰)
        if not 대상:
            print("‼ 관리하는 페이지가 없습니다. 인스타 프로 계정이 페이스북 페이지에 "
                  "연결돼 있어야 합니다.")
        else:
            print("\n올릴 수 있는 페이지:")
            for i, t in enumerate(대상, 1):
                print("  %d) %s  (페이지 %s)  인스타: %s"
                      % (i, t["page_name"], t["page_id"], t["ig_username"] or "연결 없음"))
            n = int(물음("번호", "1")) - 1
            t = 대상[n]
            if t["ig_id"]:
                계정["instagram"] = {"id": t["ig_id"], "username": t["ig_username"],
                                    "token": t["page_token"]}
            else:
                print("  (인스타가 이 페이지에 안 붙어 있어 인스타는 건너뜁니다)")
            계정["facebook"] = {"page_id": t["page_id"], "name": t["page_name"],
                               "page_token": t["page_token"], "user_token": 토큰,
                               "만료": M.만료일(초)}
            print("  ✔ 페이스북 페이지: %s / 인스타: %s"
                  % (t["page_name"], t["ig_username"] or "-"))

    # ② 스레드 로그인 - 완전히 따로다
    if 물음("\n스레드도 이을까요? (y/n)", "y").lower().startswith("y"):
        code = 열고받기(M.스레드_동의주소(앱), "스레드")
        토큰, 초 = M.스레드_토큰(앱, code)
        tid, 이름 = M.스레드_나(토큰)
        계정["threads"] = {"id": tid, "username": 이름, "token": 토큰, "만료": M.만료일(초)}
        print("  ✔ 스레드: @%s" % 이름)

    print("\n저장:", M.설정쓰기(d))
    보기()


def 보기():
    d = M.설정읽기()
    if not d["계정"]:
        print("이어진 계정이 없습니다. `python 메타_연결.py 연결 <이름>` 을 하세요.")
        return
    print("\n%-24s %-10s %s" % ("계정", "창구", "상태"))
    print("-" * 72)
    for 키, a in d["계정"].items():
        줄 = []
        if a.get("instagram"):
            줄.append(("인스타", "@%s" % a["instagram"].get("username", "?")))
        if a.get("facebook"):
            남 = M.남은날(a["facebook"])
            줄.append(("페이스북", "%s (사용자토큰 %s일 남음)"
                       % (a["facebook"].get("name", "?"), 남 if 남 is not None else "?")))
        if a.get("threads"):
            남 = M.남은날(a["threads"])
            줄.append(("스레드", "@%s (%s일 남음)"
                       % (a["threads"].get("username", "?"), 남 if 남 is not None else "?")))
        if not 줄:
            줄 = [("-", "연결 없음")]
        for i, (창구, 말) in enumerate(줄):
            print("%-24s %-10s %s" % (키 if i == 0 else "", 창구, 말))
    print("\n설정 파일:", M.설정경로)


def 두드려보기(키):
    d = M.설정읽기()
    a = M.계정가져오기(키, d)
    ok = True
    ig = a.get("instagram")
    if ig:
        try:
            r = M._호출("GET", M.FB + "/" + ig["id"],
                       {"fields": "username,followers_count"}, token=ig["token"])
            print("  ✔ 인스타 @%s (팔로워 %s)" % (r.get("username"), r.get("followers_count")))
        except M.MetaError as e:
            ok = False
            print("  ✘ 인스타: %s" % e)
    fb = a.get("facebook")
    if fb:
        try:
            r = M._호출("GET", M.FB + "/" + fb["page_id"], {"fields": "name,fan_count"},
                       token=fb["page_token"])
            print("  ✔ 페이스북 %s (좋아요 %s)" % (r.get("name"), r.get("fan_count")))
        except M.MetaError as e:
            ok = False
            print("  ✘ 페이스북: %s" % e)
    th = a.get("threads")
    if th:
        try:
            tid, 이름 = M.스레드_나(th["token"])
            print("  ✔ 스레드 @%s" % 이름)
        except M.MetaError as e:
            ok = False
            print("  ✘ 스레드: %s" % e)
    return ok


def main(argv):
    쓰임 = __doc__.split("## ")[0]
    if not argv:
        print(쓰임)
        보기()
        return 0
    명령 = argv[0]
    try:
        if 명령 == "앱":
            앱넣기()
        elif 명령 == "호스팅":
            호스팅넣기()
        elif 명령 == "연결":
            if len(argv) < 2:
                print("계정 이름이 필요합니다. 예: python 메타_연결.py 연결 news_univ")
                return 2
            잇기(argv[1])
        elif 명령 == "목록":
            보기()
        elif 명령 == "확인":
            키들 = argv[1:] or list(M.설정읽기()["계정"])
            for k in 키들:
                print("\n[%s]" % k)
                두드려보기(k)
        else:
            print(쓰임)
            return 2
    except M.MetaError as e:
        print("\n‼ %s" % e)
        return 1
    except KeyboardInterrupt:
        print("\n그만둡니다.")
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
