# -*- coding: utf-8 -*-
"""뉴보대 인스타 프로필 사진 + 하이라이트 커버 4종 생성."""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = r"C:\Users\박현수\Desktop\College\대학교\대외활동\2026\한대포 임시\뉴보대"
OUT = os.path.join(BASE, "프로필_하이라이트")
os.makedirs(OUT, exist_ok=True)

NAVY = (4, 41, 110)
BLUE = (0, 80, 235)
WHITE = (255, 255, 255)
PAPER = (246, 248, 252)

S = 4  # supersampling


def icon_only():
    """뉴보대 로고에서 워드마크를 뺀 아이콘 부분만 잘라낸다 (실측: y 239~821)."""
    im = Image.open(os.path.join(BASE, "newsfeed", "assets", "뉴보대_로고.png")).convert("RGBA")
    return im.crop((338, 239, 916, 822))  # 실측한 아이콘 bbox


def hdp_mark():
    """한대포 로고에서 심볼만 (워드마크 제외, 실측: y 0~600)."""
    im = Image.open(os.path.join(BASE, "newsfeed", "assets", "한국대학생포럼_로고.png")).convert("RGBA")
    im = im.crop((0, 0, im.width, 620))
    return im.crop(im.getchannel("A").getbbox())


def fit(img, box):
    """비율 유지하며 box(정사각 한 변) 안에 맞춘다."""
    w, h = img.size
    k = box / max(w, h)
    return img.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)


def paste_center(canvas, img, cy=None):
    cx = canvas.width // 2
    cy = canvas.height // 2 if cy is None else cy
    canvas.alpha_composite(img, (cx - img.width // 2, cy - img.height // 2))


# ---------------------------------------------------------------- 프로필 사진
def profile(variant):
    """1080x1080. 인스타는 원형으로 자르므로 모서리에는 아무것도 두지 않는다."""
    n = 1080 * S
    im = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    ic = icon_only()

    if variant == "A":       # 흰 바탕, 아이콘만
        d.ellipse((0, 0, n, n), fill=WHITE + (255,))
        paste_center(im, fit(ic, int(n * 0.62)))
    elif variant == "B":     # 흰 바탕 + 남색 테두리 링
        d.ellipse((0, 0, n, n), fill=WHITE + (255,))
        r = int(n * 0.030)
        d.ellipse((r // 2, r // 2, n - r // 2, n - r // 2), outline=NAVY + (255,), width=r)
        paste_center(im, fit(ic, int(n * 0.56)))
    elif variant == "C":     # 남색 바탕 + 흰 원 안에 아이콘
        d.ellipse((0, 0, n, n), fill=NAVY + (255,))
        m = int(n * 0.085)
        d.ellipse((m, m, n - m, n - m), fill=WHITE + (255,))
        paste_center(im, fit(ic, int(n * 0.56)))

    return im.resize((1080, 1080), Image.LANCZOS)


# ------------------------------------------------------------ 하이라이트 글리프
def g_form(d, cx, cy, s, col):
    """제출 양식 — 모서리 접힌 문서 + 체크."""
    lw = int(s * 0.062)
    x0, y0 = cx - s * 0.34, cy - s * 0.46
    x1, y1 = cx + s * 0.34, cy + s * 0.46
    fold = s * 0.24
    d.polygon([(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1)],
              outline=col + (255,), width=lw)
    d.line([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)],
           fill=col + (255,), width=lw, joint="curve")
    # 줄 2개만 두고 그 아래에 체크. 3줄 + 체크는 작은 원에서 서로 겹쳐 뭉갠다.
    for i in range(2):
        yy = y0 + s * 0.38 + i * s * 0.14
        d.line((x0 + s * 0.12, yy, x1 - s * 0.12, yy), fill=col + (255,), width=int(lw * 0.8))
    d.line([(cx - s * 0.17, cy + s * 0.24), (cx - s * 0.05, cy + s * 0.35),
            (cx + s * 0.18, cy + s * 0.11)], fill=col + (255,), width=int(lw * 1.25), joint="curve")


def g_calendar(d, cx, cy, s, col):
    """월간이슈 — 달력."""
    lw = int(s * 0.062)
    x0, y0 = cx - s * 0.44, cy - s * 0.34
    x1, y1 = cx + s * 0.44, cy + s * 0.44
    d.rounded_rectangle((x0, y0, x1, y1), radius=s * 0.08, outline=col + (255,), width=lw)
    d.line((x0 + lw / 2, y0 + s * 0.23, x1 - lw / 2, y0 + s * 0.23), fill=col + (255,), width=lw)
    for x in (cx - s * 0.22, cx + s * 0.22):  # 고리
        d.line((x, y0 - s * 0.15, x, y0 + s * 0.05), fill=col + (255,), width=lw)
    for r in range(2):
        for c in range(3):
            px = cx - s * 0.25 + c * s * 0.25
            py = y0 + s * 0.38 + r * s * 0.21
            rr = s * 0.052
            filled = (r, c) == (1, 1)
            d.ellipse((px - rr, py - rr, px + rr, py + rr),
                      fill=col + (255,) if filled else None,
                      outline=col + (255,), width=int(lw * 0.8))


def cover(glyph=None, art=None):
    """1080x1920 스토리 규격. 남색 바탕 + 흰 원 + 가운데 그림.

    네 장을 같은 틀로 찍어서, 프로필에 나란히 걸렸을 때 한 세트로 보이게 한다.
    인스타는 이 이미지의 가운데를 원형으로 자른다.
    """
    W, H = 1080 * S, 1920 * S
    im = Image.new("RGBA", (W, H), NAVY + (255,))
    d = ImageDraw.Draw(im)
    cx, cy = W // 2, H // 2
    disc = int(1080 * S * 0.72)  # 흰 원 지름
    d.ellipse((cx - disc // 2, cy - disc // 2, cx + disc // 2, cy + disc // 2),
              fill=WHITE + (255,))
    if art is not None:
        paste_center(im, fit(art, int(disc * 0.62)), cy)
    else:
        glyph(d, cx, cy, disc * 0.34, NAVY)
    return im.resize((1080, 1920), Image.LANCZOS)


if __name__ == "__main__":
    for v in "ABC":
        profile(v).save(os.path.join(OUT, f"뉴보대_프로필사진_{v}.png"))
    profile("C").save(os.path.join(OUT, "뉴보대_프로필사진_1080.png"))  # 이걸 올리면 됩니다

    cover(art=icon_only()).save(os.path.join(OUT, "하이라이트_1_뉴보대.png"))
    cover(glyph=g_form).save(os.path.join(OUT, "하이라이트_2_양식.png"))
    cover(glyph=g_calendar).save(os.path.join(OUT, "하이라이트_3_월간이슈.png"))
    cover(art=hdp_mark()).save(os.path.join(OUT, "하이라이트_4_한대포.png"))
    print("saved to", OUT)
