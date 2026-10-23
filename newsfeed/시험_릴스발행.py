# -*- coding: utf-8 -*-
"""릴스(영상) 발행 경로 시험 (2026-10-24) - 그물망을 타지 않고, 아무것도 실제로 올리지 않는다.

`meta_api._열기` 를 가짜로 바꿔 메타에 무엇을 어떤 차례로 보내는지 재고,
publish.py · reserve.py 는 임시 폴더에서 돌린다(레포의 발행기록·.cards 를 건드리지 않게).

재는 것
  1) 영상 머리 읽기 - MP4 v0/v1 · MOV · moov 가 끝에 있음 · 90도 돌린 폰 영상 · webm · 엉뚱한 파일
  2) 점검 - webm·너무 짧음·너무 김·스레드 5분·가로 영상 경고
  3) 인스타 릴스 - REELS 컨테이너 → 익기 → media_publish, 영상 ERROR, 2,200자
  4) 페이스북 영상 - graph-video 주소에 file_url
  5) 스레드 영상 - VIDEO 컨테이너 → 익기 → threads_publish
  6) publish.py 점검(--dry) - 메타에 POST 0번, webm 은 점검에서 막힘
  7) publish.py 실제 길(가짜 그물) - 세 창구 · 첫 댓글 · 기록 · 같은 글 두 번 막기
  8) reserve.py 발사 - 영상 예약은 --video-url 로, 카드 예약은 그대로 --images
"""
import io
import json
import os
import shutil
import struct
import sys
import tempfile
from contextlib import redirect_stdout

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), ".github", "cards"))

import meta_api as M  # noqa: E402

ok = fail = 0


def check(name, cond, extra=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  o {name} {extra}")
    else:
        fail += 1
        print(f"  X {name} {extra}")


# ────────────────────────────────────────────── 가짜 그물망
기록 = []
규칙 = []


class 가짜응답:
    def __init__(self, data, status=200):
        self._d = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.status = status

    def read(self):
        return self._d

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def 가짜열기(req):
    url, method = req.full_url, req.get_method()
    몸통 = req.data.decode("utf-8", "replace") if req.data else ""
    기록.append((method, url, 몸통))
    for m, 조각, 값 in 규칙:
        if m == method and 조각 in url:
            if callable(값):
                값 = 값(url, 몸통)
            if isinstance(값, Exception):
                raise 값
            return 가짜응답(값)
    raise AssertionError("시험이 모르는 호출: %s %s" % (method, url))


def 판깔기(*새규칙):
    기록.clear()
    규칙.clear()
    규칙.extend(새규칙)


M._열기 = 가짜열기
M.time.sleep = lambda s: None

계정 = {"instagram": {"id": "IG1", "token": "t-ig"},
        "facebook": {"page_id": "PG1", "page_token": "t-pg"},
        "threads": {"id": "TH1", "token": "t-th"}}
영상주소 = "https://raw.githubusercontent.com/x/y/reserved/rsv/r1/reel.mp4"


# ────────────────────────────────────────────── 가짜 영상 만들기
def 상자(종류, 몸):
    return struct.pack(">I4s", 8 + len(몸), 종류) + 몸


def mvhd(눈금, 길이, 판=0):
    if 판 == 1:
        return 상자(b"mvhd", bytes([1, 0, 0, 0]) + b"\0" * 16 + struct.pack(">IQ", 눈금, 길이) + b"\0" * 80)
    return 상자(b"mvhd", bytes([0, 0, 0, 0]) + b"\0" * 8 + struct.pack(">II", 눈금, 길이) + b"\0" * 80)


def tkhd(w, h, 돌림=False):
    a, b = (0, 0x10000) if 돌림 else (0x10000, 0)
    행렬 = struct.pack(">ii", a, b) + b"\0" * 28
    return 상자(b"tkhd", bytes([0, 0, 0, 7]) + b"\0" * 36 + 행렬 + struct.pack(">II", w << 16, h << 16))


def mp4(초=12.5, w=1080, h=1920, 판=0, 상표=b"isom", moov끝=False, 돌림=False, 오디오먼저=False):
    ftyp = 상자(b"ftyp", 상표 + b"\0\0\0\0" + 상표)
    트랙들 = []
    if 오디오먼저:
        트랙들.append(상자(b"trak", tkhd(0, 0)))
    트랙들.append(상자(b"trak", tkhd(w, h, 돌림)))
    moov = 상자(b"moov", mvhd(1000, int(초 * 1000), 판) + b"".join(트랙들))
    mdat = 상자(b"mdat", b"\0" * 5000)
    return ftyp + (mdat + moov if moov끝 else moov + mdat)


임시 = tempfile.mkdtemp(prefix="nbd_reel_")


def 파일(이름, 바이트):
    p = os.path.join(임시, 이름)
    with open(p, "wb") as f:
        f.write(바이트)
    return p


try:
    print("1) 영상 머리 읽기")
    i = M.영상정보(파일("a.mp4", mp4()))
    check("MP4 형식·길이·크기", (i["형식"], i["초"], i["너비"], i["높이"]) == ("mp4", 12.5, 1080, 1920), str(i))
    i = M.영상정보(파일("b.mp4", mp4(초=61, 판=1)))
    check("mvhd 판1(64비트 길이)", i["초"] == 61.0, str(i["초"]))
    i = M.영상정보(파일("c.mov", mp4(상표=b"qt  ")))
    check("MOV 상표", i["형식"] == "mov")
    i = M.영상정보(파일("d.mp4", mp4(moov끝=True)))
    check("moov 가 파일 끝", i["초"] == 12.5 and i["너비"] == 1080)
    i = M.영상정보(파일("e.mp4", mp4(w=1920, h=1080, 돌림=True)))
    check("90도 돌린 폰 영상은 보이는 대로", (i["너비"], i["높이"]) == (1080, 1920), "%sx%s" % (i["너비"], i["높이"]))
    i = M.영상정보(파일("f.mp4", mp4(오디오먼저=True)))
    check("소리 트랙(0×0)이 먼저여도 화면 크기", (i["너비"], i["높이"]) == (1080, 1920), "%sx%s" % (i["너비"], i["높이"]))
    i = M.영상정보(파일("g.webm", b"\x1a\x45\xdf\xa3" + b"\0" * 100))
    check("webm 알아봄", i["형식"] == "webm")
    i = M.영상정보(파일("h.mp4", b"hello world, not a video"))
    check("엉뚱한 파일은 ? (지어내지 않음)", i["형식"] == "?" and i["초"] is None)

    print("2) 점검")
    문제, 경고 = M.영상_점검(M.영상정보(os.path.join(임시, "a.mp4")))
    check("정상 세로 영상은 문제·경고 없음", not 문제 and not 경고, str((문제, 경고)))
    문제, _ = M.영상_점검(M.영상정보(os.path.join(임시, "g.webm")))
    check("webm 은 막음", any("webm" in s for s in 문제))
    문제, _ = M.영상_점검(M.영상정보(파일("short.mp4", mp4(초=2))))
    check("2초는 릴스에서 막음", any("3초" in s for s in 문제))
    문제, _ = M.영상_점검(M.영상정보(파일("long.mp4", mp4(초=16 * 60))), ("instagram",))
    check("16분은 릴스에서 막음", any("15분" in s for s in 문제))
    여섯분 = M.영상정보(파일("six.mp4", mp4(초=360)))
    check("6분: 스레드를 고르면 막음", any("스레드" in s for s in M.영상_점검(여섯분, ("instagram", "threads"))[0]))
    check("6분: 스레드를 안 고르면 통과", not M.영상_점검(여섯분, ("instagram", "facebook"))[0])
    _, 경고 = M.영상_점검(M.영상정보(파일("land.mp4", mp4(w=1920, h=1080))))
    check("가로 영상은 경고만", any("9:16" in s for s in 경고))
    문제, _ = M.영상_점검(M.영상정보(os.path.join(임시, "h.mp4")))
    check("영상이 아니면 막음", any("MP4" in s for s in 문제))

    print("3) 인스타 릴스")
    판깔기(("POST", "/IG1/media_publish", {"id": "MEDIA9"}),
          ("POST", "/IG1/media", {"id": "C1"}),
          ("GET", "/C1", {"status_code": "FINISHED"}),
          ("GET", "/MEDIA9", {"permalink": "https://www.instagram.com/reel/abc/"}))
    r = M.인스타_릴스_올리기(계정, 영상주소, "릴스 글", 로그=lambda s: None)
    만들기 = 기록[0]
    check("REELS 컨테이너", 만들기[0] == "POST" and "media_type=REELS" in 만들기[2])
    check("video_url 은 공개 주소 그대로", "video_url=" + M.urllib.parse.quote_plus(영상주소) in 만들기[2])
    check("피드에도 보이게(share_to_feed)", "share_to_feed=true" in 만들기[2])
    check("익기 → 발행 차례", [x[1].split("/")[-1].split("?")[0] for x in 기록[1:3]] == ["C1", "media_publish"])
    check("링크 받음", r["링크"].endswith("/reel/abc/") and r["id"] == "MEDIA9")
    판깔기(("POST", "/IG1/media", {"id": "C2"}),
          ("GET", "/C2", {"status_code": "ERROR", "status": "2207026"}))
    try:
        M.인스타_릴스_올리기(계정, 영상주소, "글", 로그=lambda s: None)
        check("영상 ERROR 면 멈춤", False)
    except M.MetaError as e:
        check("영상 ERROR 면 멈춤(영상이라고 말함)", "영상" in str(e) and not any("media_publish" in x[1] for x in 기록), str(e))
    판깔기()
    try:
        M.인스타_릴스_올리기(계정, 영상주소, "가" * 2201, 로그=lambda s: None)
        check("2,200자 넘으면 막음", False)
    except M.MetaError:
        check("2,200자 넘으면 막음(호출 0번)", not 기록)

    print("4) 페이스북 영상")
    판깔기(("POST", "graph-video.facebook.com", {"id": "V77"}))
    r = M.페이스북_영상_올리기(계정, 영상주소, "페북 글")
    check("graph-video 의 페이지 videos", 기록[0][1] == "https://graph-video.facebook.com/%s/PG1/videos" % M.GRAPH)
    check("file_url·description", "file_url=" in 기록[0][2] and "description=" in 기록[0][2])
    check("영상 링크", r["링크"] == "https://www.facebook.com/PG1/videos/V77")

    print("5) 스레드 영상")
    판깔기(("POST", "/TH1/threads_publish", {"id": "T5"}),
          ("POST", "/TH1/threads", {"id": "TC1"}),
          ("GET", "/TC1", {"status": "FINISHED"}),
          ("GET", "/T5", {"permalink": "https://www.threads.net/@x/post/1"}))
    r = M.스레드_영상_올리기(계정, 영상주소, "스레드 글", 로그=lambda s: None)
    check("VIDEO 컨테이너", "media_type=VIDEO" in 기록[0][2] and "video_url=" in 기록[0][2])
    check("익기 → 발행", 기록[1][1].split("?")[0].endswith("/TC1") and 기록[2][1].endswith("threads_publish"))
    check("링크", r["링크"].endswith("/post/1"))

    print("6) publish.py 점검(--dry)")
    import publish  # noqa: E402
    publish.ROOT = 임시
    os.environ["META_CONFIG"] = json.dumps({"앱": {}, "계정": {"뉴보대": 계정}})
    문구 = os.path.join(임시, "문구.txt")
    with open(문구, "w", encoding="utf-8") as f:
        f.write("오늘의 뉴스 릴스\n\n#뉴보대")

    def 돌리기(*인자):
        buf = io.StringIO()
        with redirect_stdout(buf):
            code = publish.main(list(인자))
        return code, buf.getvalue()

    판깔기(("GET", 영상주소, {}))
    code, 말 = 돌리기("--video", os.path.join(임시, "a.mp4"), "--video-url", 영상주소,
                     "--caption", 문구, "--channels", "instagram,facebook,threads", "--dry")
    check("점검 통과", code == 0, 말.strip().splitlines()[-1] if 말.strip() else "")
    check("메타에 POST 0번", not [x for x in 기록 if x[0] == "POST"], str(기록))
    check("영상 주소 열림은 확인함", any(x[0] == "GET" and x[1] == 영상주소 for x in 기록))
    check("세 창구 모두 [점검만]", 말.count("[점검만]") >= 4)
    check("영상 정보 찍음", "mp4 · 12.5초 · 1080×1920" in 말)
    check("점검은 발행기록을 안 씀", not os.path.isdir(os.path.join(임시, "발행기록")))
    판깔기(("GET", 영상주소, {}))
    code, 말 = 돌리기("--video", os.path.join(임시, "g.webm"), "--video-url", 영상주소, "--caption", 문구, "--dry")
    check("webm 은 점검에서 막힘", code == 1 and "webm" in 말 and not 기록)
    code, 말 = 돌리기("--caption", 문구, "--dry")
    check("카드도 영상도 없으면 막힘", code == 1)
    code, 말 = 돌리기("--video-url", "http://example.com/a.mp4", "--caption", 문구, "--dry")
    check("https 가 아닌 영상 주소는 막힘", code == 1)

    print("7) publish.py 실제 길(가짜 그물)")
    댓글 = os.path.join(임시, "댓글.json")
    with open(댓글, "w", encoding="utf-8") as f:
        json.dump({"ig_caption": "오늘의 뉴스 릴스", "text": "여러분은 어떻게 생각하세요?", "tags": ["#뉴보대"]}, f, ensure_ascii=False)
    판깔기(("GET", 영상주소, {}),
          ("POST", "/IG1/media_publish", {"id": "M1"}),
          ("POST", "/IG1/media", {"id": "C1"}),
          ("GET", "/C1", {"status_code": "FINISHED"}),
          ("GET", "/M1", {"permalink": "https://www.instagram.com/reel/m1/"}),
          ("POST", "/M1/comments", {"id": "CM1"}),
          ("POST", "/CM1/replies", {"id": "RP1"}),
          ("POST", "graph-video.facebook.com", {"id": "V1"}),
          ("POST", "/TH1/threads_publish", {"id": "T1"}),
          ("POST", "/TH1/threads", {"id": "TC1"}),
          ("GET", "/TC1", {"status": "FINISHED"}),
          ("GET", "/T1", {"permalink": "https://www.threads.net/t/1"}))
    인자 = ["--video", os.path.join(임시, "a.mp4"), "--video-url", 영상주소, "--caption", 문구,
           "--comment", 댓글, "--channels", "instagram,facebook,threads", "--date", "2026-10-24"]
    code, 말 = 돌리기(*인자)
    check("세 창구 성공", code == 0 and 말.count("✔") >= 3, "")
    check("인스타 본문은 해시태그 줄 뺀 글", any("/IG1/media" in x[1] and "caption=" + M.urllib.parse.quote_plus("오늘의 뉴스 릴스") in x[2] for x in 기록))
    check("첫 댓글 + 해시태그 답글", any("/M1/comments" in x[1] for x in 기록) and any("/CM1/replies" in x[1] for x in 기록))
    p = os.path.join(임시, "발행기록", "2026-10-24.json")
    rec = json.load(open(p, encoding="utf-8"))["발행"][-1] if os.path.isfile(p) else {}
    check("발행기록에 영상 주소·장수 0", rec.get("영상") == 영상주소 and rec.get("장수") == 0)
    판깔기(("GET", 영상주소, {}))
    code, 말 = 돌리기(*인자[:-2], "--date", "2026-10-24")
    check("30분 안 같은 글은 두 번 안 올림", code == 0 and "두 번 올리지 않습니다" in 말 and not [x for x in 기록 if x[0] == "POST"])
    shutil.rmtree(os.path.join(임시, "발행기록"))
    판깔기(("GET", 영상주소, {}),
          ("POST", "/IG1/media", M.MetaError("메타 오류 9004: 미디어를 가져올 수 없습니다")),
          ("POST", "graph-video.facebook.com", {"id": "V1"}))
    code, 말 = 돌리기("--video", os.path.join(임시, "a.mp4"), "--video-url", 영상주소, "--caption", 문구,
                     "--channels", "instagram,facebook", "--date", "2026-10-24")
    check("인스타가 죽어도 페이스북은 감, 결과는 실패", code == 1 and "✘ instagram" in 말 and any("graph-video" in x[1] for x in 기록))

    print("8) reserve.py 발사")
    import reserve  # noqa: E402
    rsv = os.path.join(임시, "rsv_root")
    reserve.RSV = rsv
    reserve.ROOT = os.path.join(임시, "root")
    reserve.밀기 = lambda 말: None
    reserve.작업지우기 = lambda d: None
    받은것 = []

    def 가짜받기(u, 곳):
        받은것.append(u)
        shutil.copy(os.path.join(임시, "a.mp4"), 곳)

    reserve.urllib.request.urlretrieve = 가짜받기
    부른것 = []
    publish.main = lambda argv: (부른것.append(argv), 0)[1]
    for i, post in [("r2610240900ab", {"when": "2026-10-01T09:00:00+09:00", "caption": "릴스 예약", "channels": ["instagram", "facebook"],
                                       "urls": [], "video": "https://raw.githubusercontent.com/x/y/reserved/rsv/r2610240900ab/reel.mp4",
                                       "kind": "reel", "state": "대기"}),
                    ("r2610240901cd", {"when": "2026-10-01T09:01:00+09:00", "caption": "카드 예약", "channels": ["instagram"],
                                       "urls": ["https://raw.githubusercontent.com/x/y/reserved/rsv/r2610240901cd/01.jpg"], "state": "대기"})]:
        os.makedirs(os.path.join(rsv, "rsv", i))
        post["id"] = i
        with open(os.path.join(rsv, "rsv", i, "post.json"), "w", encoding="utf-8") as f:
            json.dump(post, f, ensure_ascii=False)
        with open(os.path.join(rsv, "rsv", i, "reel.mp4" if post.get("video") else "01.jpg"), "wb") as f:
            f.write(b"x")
    buf = io.StringIO()
    with redirect_stdout(buf):
        code = reserve.발사()
    영상인자 = next((a for a in 부른것 if "--video-url" in a), None)
    카드인자 = next((a for a in 부른것 if "--images" in a), None)
    check("두 예약 모두 발행", code == 0 and len(부른것) == 2, buf.getvalue().strip().splitlines()[-1])
    check("영상 예약은 --video-url 로", 영상인자 is not None and "--images" not in 영상인자
          and 영상인자[영상인자.index("--video-url") + 1].endswith("/reel.mp4"))
    check("영상 예약은 영상 파일을 받아 둠", 영상인자 is not None and os.path.isfile(영상인자[영상인자.index("--video") + 1]))
    check("카드 예약은 그대로 --images·--urls", 카드인자 is not None and "--urls" in 카드인자 and "--video-url" not in 카드인자)
    d = json.load(open(os.path.join(rsv, "rsv", "r2610240900ab", "post.json"), encoding="utf-8"))
    check("영상 예약 완료 + 공개 자리의 영상 치움", d["state"] == "완료"
          and os.listdir(os.path.join(rsv, "rsv", "r2610240900ab")) == ["post.json"])
finally:
    shutil.rmtree(임시, ignore_errors=True)

print("\n통과 %d · 실패 %d" % (ok, fail))
sys.exit(1 if fail else 0)
