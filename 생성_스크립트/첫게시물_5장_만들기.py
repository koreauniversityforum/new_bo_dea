# -*- coding: utf-8 -*-
"""뉴보대 첫 게시물 캐러셀 5장 (1080x1350) — 애플 Liquid Glass 풍.

표지 – 시사 – 경제 – 정치 – 팔로우 뒷장.
문구는 확정된 소개 캡션(바탕화면 `뉴보대 인스타 소개 피드 글.md`)에서 그대로 가져온다.
업로드 주기는 일부러 어디에도 넣지 않는다.

참고한 결(사용자 제공 핀터레스트 6장)
  · 바탕은 **밝은 실버**. 어두운 판이 아니다.
  · 색은 채도를 낮춰 크게 번지는 물감처럼. 유리 뒤로 비쳐야 유리로 보인다.
  · 유리는 ① 흐린 배경 ② 흰 막 ③ **위쪽만 밝은 테두리** ④ 아래로 떨어지는 그림자,
    네 겹이 다 있어야 한다. 하나라도 빠지면 그냥 반투명 네모다.
  · 글자는 먹빛 굵은 산세리프 + 회색 보조. 자간을 좁힌다.
  · 누르는 곳은 알약(캡슐) 하나만 색을 쓴다.

주의: RGBA 이미지에 반투명으로 직접 그리면 PIL 은 합성하지 않고 알파를 덮어쓴다.
      반투명은 전부 별도 레이어(`ov`)에 그려서 alpha_composite 해야 한다.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

BASE = r"C:\Users\박현수\Desktop\College\대학교\대외활동\2026\한대포 임시\뉴보대"
FONTS = os.path.join(BASE, "newsfeed", "fonts")
OUT = os.path.join(BASE, "첫게시물")
os.makedirs(OUT, exist_ok=True)

W, H = 1080, 1350
PAPER = (237, 239, 243)          # 실버 바탕
INK = (11, 11, 15)               # 먹빛 본문
GRAY = (112, 116, 126)
GRAY2 = (150, 155, 166)
APPLE_BLUE = (0, 113, 227)       # 애플 파랑(밝은 배경용)

WASH_BLUE = (150, 194, 255)
WASH_CYAN = (168, 228, 240)
WASH_MINT = (166, 232, 205)
WASH_WARM = (255, 224, 186)
WASH_LILAC = (198, 190, 255)
WASH_PINK = (255, 198, 224)


def F(weight, size):
    return ImageFont.truetype(os.path.join(FONTS, f"Pretendard-{weight}.otf"), size)


# ----------------------------------------------------------------- 글자
def ttext(d, xy, text, font, fill, tracking=0, anchor="la"):
    """자간을 준다. PIL 에는 자간이 없어서 글자를 하나씩 놓는다."""
    adv = [font.getlength(c) for c in text]
    total = sum(adv) + tracking * (len(text) - 1)
    x, y = xy
    if anchor[0] == "m":
        x -= total / 2
    elif anchor[0] == "r":
        x -= total
    for c, a in zip(text, adv):
        d.text((x, y), c, font=font, fill=fill, anchor="l" + anchor[1])
        x += a + tracking
    return total


def block(d, texts, font, x, y, gap, fill, tracking=0, anchor="la"):
    for i, t in enumerate(texts):
        ttext(d, (x, y + i * gap), t, font, fill, tracking, anchor)
    return y + len(texts) * gap


def tw(text, font, tracking=0):
    return sum(font.getlength(c) for c in text) + tracking * (len(text) - 1)


# ------------------------------------------------------------- 배경(물감)
def wash(blobs):
    """밝은 바탕 위에 파스텔을 **섞는다** (blobs: [(cx,cy,r,color,진하기)]).

    어두운 판에서 쓰던 '더하기'는 밝은 바탕에서 하얗게 타 버린다.
    여기서는 바탕색과 물감색을 가우시안 비율로 섞어야 파스텔이 남는다.
    """
    s = 4
    h, w = H // s, W // s
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    acc = np.zeros((h, w, 3), np.float32) + np.array(PAPER, np.float32)
    for cx, cy, r, col, a in blobs:
        sig = r / s * 0.60
        g = (np.exp(-(((xx - cx / s) ** 2 + (yy - cy / s) ** 2) / (2 * sig ** 2))) * a)[..., None]
        acc = acc * (1 - g) + np.array(col, np.float32) * g

    # 새틴 결 — 아주 옅은 사선 띠. 참고 이미지의 은빛 천 느낌이 여기서 나온다.
    band = np.sin((xx * 0.9 + yy * 1.7) * 0.055) * 3.4 + np.sin((xx - yy) * 0.021) * 2.6
    acc += band[..., None]

    # 가장자리를 아주 살짝 눌러 가운데를 띄운다
    vy = np.linspace(-1, 1, h)[:, None]
    vx = np.linspace(-1, 1, w)[None, :]
    acc *= np.clip(1 - 0.055 * (vx ** 2 + vy ** 2 * 0.9), 0, 1)[..., None]

    sm = Image.fromarray(np.clip(acc, 0, 255).astype(np.uint8), "RGB")
    sm = sm.filter(ImageFilter.GaussianBlur(2.5))
    return sm.resize((W, H), Image.BICUBIC).convert("RGBA")


def grain(im, amount=3):
    """아주 옅은 입자. 그라데이션의 띠(밴딩)를 덮는다."""
    n = np.random.default_rng(11).integers(-amount, amount + 1, (H, W, 1)).astype(np.int16)
    a = np.array(im).astype(np.int16)
    a[..., :3] = np.clip(a[..., :3] + n, 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


# --------------------------------------------------------------- 유리
def rr_mask(size, box, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius=radius, fill=255)
    return m


def glass(im, box, radius, blur=40, sheet=118, shadow=44, spec=True):
    """네 겹으로 쌓는다: 그림자 → 흐린 배경 → 흰 막 → 위쪽 테두리(+빛줄기)."""
    x0, y0, x1, y1 = box

    # ① 아래로 떨어지는 그림자
    if shadow:
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((x0, y0 + 16, x1, y1 + 22), radius=radius,
                                             fill=(28, 34, 48, shadow))
        im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(26)))

    # ② 흐린 배경 + ③ 흰 막
    panel = im.filter(ImageFilter.GaussianBlur(blur)).convert("RGBA")
    grad = Image.new("L", (1, y1 - y0))
    for i in range(y1 - y0):
        grad.putpixel((0, i), int(sheet * (1 - 0.34 * i / max(1, y1 - y0))))
    milk = Image.new("RGBA", (x1 - x0, y1 - y0), (255, 255, 255, 255))
    milk.putalpha(grad.resize((x1 - x0, y1 - y0)))
    panel.alpha_composite(milk, (x0, y0))

    # ④ 안쪽 윗면 빛줄기 — '액체 유리'의 젖은 느낌은 거의 이것 하나에서 온다.
    #    🔴 타원으로 그렸더니 그 아래에 웃는 모양 얼룩이 남았다. 위에서 아래로
    #    한 방향으로만 옅어지는 띠여야 자국이 안 생긴다.
    if spec:
        n = y1 - y0
        g = Image.new("L", (1, n))
        for i in range(n):
            t = i / n
            g.putpixel((0, i), int(104 * max(0.0, 1 - t * 5.5) ** 1.8))
        st = Image.new("RGBA", (x1 - x0, n), (255, 255, 255, 255))
        st.putalpha(g.resize((x1 - x0, n)))
        panel.alpha_composite(st, (x0, y0))

    im.paste(panel, (0, 0), rr_mask(im.size, box, radius))

    # 테두리: 위는 흰빛, 아래는 옅은 그늘. 균일한 선이면 유리로 안 보인다.
    line = Image.new("L", im.size, 0)
    ImageDraw.Draw(line).rounded_rectangle(box, radius=radius, outline=255, width=2)
    gtop, gbot = Image.new("L", (1, H)), Image.new("L", (1, H))
    for i in range(H):
        t = min(max((i - y0) / max(1, y1 - y0), 0), 1)
        gtop.putpixel((0, i), int(232 * (1 - t) ** 1.5))
        gbot.putpixel((0, i), int(30 * t ** 2.2))
    for col, g in (((255, 255, 255), gtop), ((40, 46, 62), gbot)):
        e = Image.new("RGBA", im.size, col + (255,))
        e.putalpha(ImageChops.multiply(line, g.resize((W, H))))
        im.alpha_composite(e)
    return im


def capsule(im, ov, cx, cy, text, font, tracking=1, pad=44, fg=INK,
            solid=None, glassy=True):
    """알약. solid 를 주면 색 알약(누르는 곳), 아니면 유리 알약."""
    w = tw(text, font, tracking)
    h = font.size + 44
    box = (int(cx - w / 2 - pad), int(cy - h / 2), int(cx + w / 2 + pad), int(cy + h / 2))
    if solid:
        d2 = ImageDraw.Draw(ov, "RGBA")
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((box[0], box[1] + 12, box[2], box[3] + 16),
                                             radius=h // 2, fill=solid + (86,))
        im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(18)))
        d2.rounded_rectangle(box, radius=h // 2, fill=solid + (255,))
    elif glassy:
        glass(im, box, radius=h // 2, blur=26, sheet=126, shadow=30)
        d2 = ImageDraw.Draw(ov, "RGBA")
    ttext(ImageDraw.Draw(ov, "RGBA"), (cx, cy + 2), text, font, fg, tracking, anchor="mm")
    return box


def logo_icon():
    im = Image.open(os.path.join(BASE, "newsfeed", "assets", "뉴보대_로고.png")).convert("RGBA")
    return im.crop((338, 239, 916, 822))  # 워드마크 뺀 아이콘만 (실측 bbox)


# ------------------------------------------------------------------ 1. 표지
def cover():
    im = wash([(250, 210, 700, WASH_BLUE, 0.80),
               (900, 470, 620, WASH_CYAN, 0.62),
               (560, 1210, 760, WASH_LILAC, 0.50),
               (120, 900, 520, WASH_WARM, 0.30)])
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    # 로고를 담는 스퀘어클 유리
    s = 132
    cx, cy = W // 2, 348
    glass(im, (cx - s, cy - s, cx + s, cy + s), radius=64, blur=34, sheet=130)
    ic = logo_icon()
    k = 176 / max(ic.size)
    ic = ic.resize((round(ic.width * k), round(ic.height * k)), Image.LANCZOS)
    ov.alpha_composite(ic, (cx - ic.width // 2, cy - ic.height // 2))

    d = ImageDraw.Draw(ov, "RGBA")
    ttext(d, (W // 2, 588), "뉴스 보는", F("Black", 116), INK, -6, anchor="ma")
    ttext(d, (W // 2, 716), "대학생", F("Black", 116), INK, -6, anchor="ma")
    block(d, ["기사는 매일 쏟아지는데,",
              "정작 알아야 할 것들은 조용히 지나갑니다.",
              "우리는 그중 몇 건을 골라 정리합니다."],
          F("Medium", 38), W // 2, 892, 58, GRAY, -0.5, anchor="ma")

    capsule(im, ov, W // 2, 1132, "한국대학생포럼 뉴스 프로젝트", F("Medium", 30))
    ttext(d, (W // 2, H - 84), "@news_univ", F("Medium", 27), GRAY2, 3, anchor="ms")
    im.alpha_composite(ov)
    return grain(im)


# --------------------------------------------------------- 2~4. 갈래 3장
def topic(idx, name, body, cols, dot):
    a, b = cols
    im = wash([(190, 250, 640, a, 0.78),
               (960, 820, 700, b, 0.60),
               (520, 1300, 700, WASH_LILAC, 0.34)])
    # 판을 세로로 짧게 잡는다. 처음엔 1116 까지 내렸더니 아래 3분의 1이 통째로 비어
    # 만들다 만 것처럼 보였다.
    P = (72, 258, 1008, 1078)
    glass(im, P, radius=76)
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov, "RGBA")
    x = P[0] + 80

    d.ellipse((x, 340, x + 20, 360), fill=dot + (255,))
    ttext(d, (x + 36, 338), f"0{idx}", F("Bold", 28), GRAY, 3)
    ttext(d, (P[2] - 80, 338), "뉴스 보는 대학생", F("Medium", 27), GRAY2, 1, anchor="ra")

    ttext(d, (x, 664), name, F("Black", 184), INK, -10, anchor="ls")
    d.line((x, 736, P[2] - 80, 736), fill=(20, 24, 34, 34), width=2)
    block(d, body, F("Medium", 50), x, 800, 74, (74, 78, 90), -0.5)

    ttext(d, (W // 2, H - 84), "@news_univ", F("Medium", 27), GRAY2, 3, anchor="ms")
    im.alpha_composite(ov)
    return grain(im)


# ------------------------------------------------------------- 5. 뒷장
def outro():
    im = wash([(900, 240, 660, WASH_BLUE, 0.80),
               (170, 780, 640, WASH_CYAN, 0.58),
               (620, 1300, 720, WASH_PINK, 0.34)])
    P = (72, 206, 1008, 1152)
    glass(im, P, radius=76)
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov, "RGBA")
    x = P[0] + 80

    block(d, ["우리는 기자가 아닙니다.", "전문가도 아닙니다."],
          F("Medium", 40), x, 286, 60, GRAY2, -0.5)
    block(d, ["같은 강의실에 앉아", "같은 뉴스를 마주하는", "대학생입니다."],
          F("Black", 86), x, 434, 114, INK, -5)
    d.line((x, 812, P[2] - 80, 812), fill=(20, 24, 34, 34), width=2)
    block(d, ["찾아가지 않아도,", "피드를 넘기다 마주치게 됩니다."],
          F("Medium", 42), x, 862, 64, (74, 78, 90), -0.5)

    # 색을 쓰는 곳은 여기 하나뿐 — 누를 곳이 하나라는 뜻이 된다
    im.alpha_composite(ov)
    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # 알약도 글자와 같은 세로선에서 시작한다(가운데 두면 왼쪽 정렬한 본문과 어긋난다)
    cta, cf, cpad = "팔로우  @news_univ", F("Bold", 34), 56
    capsule(im, ov, x + tw(cta, cf) / 2 + cpad, 1058, cta, cf, tracking=0, pad=cpad,
            fg=(255, 255, 255), solid=APPLE_BLUE)
    ttext(ImageDraw.Draw(ov, "RGBA"), (W // 2, H - 84),
          "한국대학생포럼  @universityforum_korea", F("Medium", 27), GRAY2, 2, anchor="ms")
    im.alpha_composite(ov)
    return grain(im)


if __name__ == "__main__":
    cover().convert("RGB").save(os.path.join(OUT, "01_표지.png"))
    topic(1, "시사", ["지금 무슨 일이", "일어나고 있는지"],
          (WASH_BLUE, WASH_CYAN), (0, 122, 255)).convert("RGB").save(
        os.path.join(OUT, "02_시사.png"))
    topic(2, "경제", ["그 일이 우리 생활과", "어디서 맞닿는지"],
          (WASH_MINT, WASH_CYAN), (0, 168, 132)).convert("RGB").save(
        os.path.join(OUT, "03_경제.png"))
    topic(3, "정치", ["누가 무엇을 결정했고,", "무엇을 미뤘는지"],
          (WASH_LILAC, WASH_PINK), (124, 92, 240)).convert("RGB").save(
        os.path.join(OUT, "04_정치.png"))
    outro().convert("RGB").save(os.path.join(OUT, "05_뒷장.png"))
    print("saved to", OUT)
