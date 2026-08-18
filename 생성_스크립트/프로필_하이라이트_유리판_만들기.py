# -*- coding: utf-8 -*-
"""뉴보대 프로필 사진 + 하이라이트 커버 4종 — 애플 Liquid Glass 판 (예시).

첫 게시물 5장과 같은 결로 맞춘 것. 기존 남색판은 그대로 두고 별도 폴더에 낸다.
유리·물감 만드는 법은 `첫게시물_5장_만들기.py` 와 같다.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageChops

BASE = r"C:\Users\박현수\Desktop\College\대학교\대외활동\2026\한대포 임시\뉴보대"
OUT = os.path.join(BASE, "프로필_하이라이트_유리예시")
os.makedirs(OUT, exist_ok=True)

PAPER = (237, 239, 243)
INK = (14, 16, 24)
NAVY = (16, 45, 106)          # 로고와 같은 남색 — 커버 글리프는 이 색으로 그린다

# 🔴 커버는 결국 **110px 원**으로 붙는다. 처음엔 물감만 진하게 해 봤는데 탁해지기만 했다.
#    진짜 원인은 글리프가 가는 선이라 1px 밑으로 내려가 회색으로 뭉개진 것.
#    → 선을 1.6배로 굵히고 먹색 대신 남색으로. (2.1배는 '양식' 의 줄이 서로 붙어 덩어리가 된다.)
GLYPH_W = 1.6
WASH_K = 0.30                 # 물감을 이만큼 원색 쪽으로 당긴다 (0.65 는 회갈색으로 죽음)
WASH_BLUE = (150, 194, 255)
WASH_CYAN = (168, 228, 240)
WASH_MINT = (166, 232, 205)
WASH_LILAC = (198, 190, 255)
WASH_PINK = (255, 198, 224)
WASH_WARM = (255, 224, 186)


def wash(size, blobs):
    W, H = size
    s = 4
    h, w = H // s, W // s
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    acc = np.zeros((h, w, 3), np.float32) + np.array(PAPER, np.float32)
    for cx, cy, r, col, a in blobs:
        sig = r / s * 0.60
        g = (np.exp(-(((xx - cx / s) ** 2 + (yy - cy / s) ** 2) / (2 * sig ** 2))) * a)[..., None]
        acc = acc * (1 - g) + np.array(col, np.float32) * g
    band = np.sin((xx * 0.9 + yy * 1.7) * 0.055) * 3.2 + np.sin((xx - yy) * 0.021) * 2.4
    acc += band[..., None]
    sm = Image.fromarray(np.clip(acc, 0, 255).astype(np.uint8), "RGB")
    return sm.filter(ImageFilter.GaussianBlur(2.5)).resize((W, H), Image.BICUBIC).convert("RGBA")


def rr_mask(size, box, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle(box, radius=radius, fill=255)
    return m


def glass(im, box, radius, blur=38, sheet=124, shadow=44):
    """그림자 → 흐린 배경 → 흰 막 → 위쪽만 밝은 테두리."""
    x0, y0, x1, y1 = box
    if shadow:
        sh = Image.new("RGBA", im.size, (0, 0, 0, 0))
        ImageDraw.Draw(sh).rounded_rectangle((x0, y0 + 16, x1, y1 + 22), radius=radius,
                                             fill=(28, 34, 48, shadow))
        im.alpha_composite(sh.filter(ImageFilter.GaussianBlur(24)))

    panel = im.filter(ImageFilter.GaussianBlur(blur)).convert("RGBA")
    n = y1 - y0
    g = Image.new("L", (1, n))
    for i in range(n):
        g.putpixel((0, i), int(sheet * (1 - 0.34 * i / max(1, n))))
    milk = Image.new("RGBA", (x1 - x0, n), (255, 255, 255, 255))
    milk.putalpha(g.resize((x1 - x0, n)))
    panel.alpha_composite(milk, (x0, y0))

    g2 = Image.new("L", (1, n))               # 윗면 빛줄기 (한 방향으로만 옅어져야 자국이 안 남음)
    for i in range(n):
        g2.putpixel((0, i), int(104 * max(0.0, 1 - (i / n) * 5.5) ** 1.8))
    st = Image.new("RGBA", (x1 - x0, n), (255, 255, 255, 255))
    st.putalpha(g2.resize((x1 - x0, n)))
    panel.alpha_composite(st, (x0, y0))

    im.paste(panel, (0, 0), rr_mask(im.size, box, radius))

    line = Image.new("L", im.size, 0)
    ImageDraw.Draw(line).rounded_rectangle(box, radius=radius, outline=255, width=2)
    W, H = im.size
    gt, gb = Image.new("L", (1, H)), Image.new("L", (1, H))
    for i in range(H):
        t = min(max((i - y0) / max(1, n), 0), 1)
        gt.putpixel((0, i), int(236 * (1 - t) ** 1.5))
        gb.putpixel((0, i), int(30 * t ** 2.2))
    for col, gg in (((255, 255, 255), gt), ((40, 46, 62), gb)):
        e = Image.new("RGBA", im.size, col + (255,))
        e.putalpha(ImageChops.multiply(line, gg.resize((W, H))))
        im.alpha_composite(e)
    return im


def grain(im, amount=3):
    a = np.array(im).astype(np.int16)
    n = np.random.default_rng(11).integers(-amount, amount + 1, (a.shape[0], a.shape[1], 1))
    a[..., :3] = np.clip(a[..., :3] + n.astype(np.int16), 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def art(name, crop=None, box=None):
    im = Image.open(os.path.join(BASE, "newsfeed", "assets", name)).convert("RGBA")
    if crop:
        im = im.crop(crop)
    if box:
        im = im.crop(im.getchannel("A").getbbox())
    return im


def fit(img, box):
    k = box / max(img.size)
    return img.resize((max(1, round(img.width * k)), max(1, round(img.height * k))), Image.LANCZOS)


# ------------------------------------------------------------------ 글리프
def g_form(d, cx, cy, s, col):
    lw = int(s * 0.062 * GLYPH_W)
    x0, y0 = cx - s * 0.34, cy - s * 0.46
    x1, y1 = cx + s * 0.34, cy + s * 0.46
    fold = s * 0.24
    d.polygon([(x0, y0), (x1 - fold, y0), (x1, y0 + fold), (x1, y1), (x0, y1)],
              outline=col + (255,), width=lw)
    d.line([(x1 - fold, y0), (x1 - fold, y0 + fold), (x1, y0 + fold)],
           fill=col + (255,), width=lw, joint="curve")
    for i in range(2):                       # 줄 3개 + 체크는 작은 원에서 겹쳐 뭉갠다
        yy = y0 + s * 0.38 + i * s * 0.14
        d.line((x0 + s * 0.12, yy, x1 - s * 0.12, yy), fill=col + (255,), width=int(lw * 0.8))
    d.line([(cx - s * 0.17, cy + s * 0.24), (cx - s * 0.05, cy + s * 0.35),
            (cx + s * 0.18, cy + s * 0.11)], fill=col + (255,), width=int(lw * 1.25), joint="curve")


def g_calendar(d, cx, cy, s, col):
    lw = int(s * 0.062 * GLYPH_W)
    x0, y0 = cx - s * 0.44, cy - s * 0.34
    x1, y1 = cx + s * 0.44, cy + s * 0.44
    d.rounded_rectangle((x0, y0, x1, y1), radius=s * 0.08, outline=col + (255,), width=lw)
    d.line((x0 + lw / 2, y0 + s * 0.23, x1 - lw / 2, y0 + s * 0.23), fill=col + (255,), width=lw)
    for x in (cx - s * 0.22, cx + s * 0.22):
        d.line((x, y0 - s * 0.15, x, y0 + s * 0.05), fill=col + (255,), width=lw)
    for r in range(2):
        for c in range(3):
            px, py, rr = cx - s * 0.25 + c * s * 0.25, y0 + s * 0.38 + r * s * 0.21, s * 0.052
            d.ellipse((px - rr, py - rr, px + rr, py + rr),
                      fill=col + (255,) if (r, c) == (1, 1) else None,
                      outline=col + (255,), width=int(lw * 0.8))


# ------------------------------------------------------- 프로필 / 커버
def profile():
    """1080x1080. 인스타는 원으로 자르므로 모서리에는 아무것도 두지 않는다.

    🔴 물감은 커버보다 진하게 잡는다. 프로필은 **흰 배경에 110px 남짓**으로 붙는데,
    커버와 같은 연한 파스텔로 두면 원 테두리가 배경에 녹아 사라진다.
    (연함/중간/진함 3안을 110·56px 로 줄여 보고 '중간'을 골랐다 — 진하게 가면
     유리가 아니라 파란 원판으로 보인다.)
    """
    N = 1080
    im = wash((N, N), [(300, 250, 700, (108, 168, 255), 0.92),
                       (840, 720, 660, (150, 140, 250), 0.72),
                       (540, 1030, 560, (120, 205, 232), 0.55)])
    r = int(N * 0.335)
    c = N // 2
    glass(im, (c - r, c - r, c + r, c + r), radius=r, blur=32, sheet=138, shadow=38)
    ic = fit(art("뉴보대_로고.png", crop=(338, 239, 916, 822)), int(N * 0.40))
    im.alpha_composite(ic, (c - ic.width // 2, c - ic.height // 2))
    return grain(im).convert("RGB")


def cover(kind, blobs, glyph=None, artwork=None):
    """1080x1920 스토리 규격. 인스타는 가운데를 원으로 자른다."""
    W, H = 1080, 1920
    im = wash((W, H), blobs)
    cx, cy = W // 2, H // 2
    r = 340
    glass(im, (cx - r, cy - r, cx + r, cy + r), radius=r, blur=32, sheet=132, shadow=40)
    if artwork is not None:
        a = fit(artwork, int(r * 1.18))
        im.alpha_composite(a, (cx - a.width // 2, cy - a.height // 2))
    else:
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        glyph(ImageDraw.Draw(ov, "RGBA"), cx, cy, r * 0.62, NAVY)
        im.alpha_composite(ov)
    return grain(im).convert("RGB")


def deep(col, k=WASH_K):
    """파스텔을 원색 쪽으로 당긴다. 110px 로 줄었을 때 원 테두리가 흰 배경에 녹지 않게."""
    return tuple(max(0, min(255, int(c * (1 - k * 0.42)))) for c in col)


if __name__ == "__main__":
    profile().save(os.path.join(OUT, "뉴보대_프로필사진_1080.png"))

    B = [(210, 480, 720, deep(WASH_BLUE), 0.92), (900, 1300, 700, deep(WASH_CYAN), 0.72)]
    M = [(210, 480, 720, deep(WASH_MINT), 0.92), (900, 1300, 700, deep(WASH_CYAN), 0.72)]
    L = [(210, 480, 720, deep(WASH_LILAC), 0.92), (900, 1300, 700, deep(WASH_PINK), 0.72)]
    Wm = [(210, 480, 720, deep(WASH_WARM), 0.92), (900, 1300, 700, deep(WASH_LILAC), 0.72)]

    cover("news", B, artwork=art("뉴보대_로고.png", crop=(338, 239, 916, 822))).save(
        os.path.join(OUT, "하이라이트_1_뉴보대.png"))
    cover("form", M, glyph=g_form).save(os.path.join(OUT, "하이라이트_2_양식.png"))
    cover("cal", L, glyph=g_calendar).save(os.path.join(OUT, "하이라이트_3_월간이슈.png"))
    cover("hdp", Wm, artwork=art("한국대학생포럼_로고.png", crop=(0, 0, 702, 620), box=True)).save(
        os.path.join(OUT, "하이라이트_4_한대포.png"))
    print("saved to", OUT)
