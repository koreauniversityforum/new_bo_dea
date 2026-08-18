# -*- coding: utf-8 -*-
"""노션 폼 페이지용 아이콘 + 커버.

## 왜 따로 만드는가
뉴보대 로고는 **정사각(1254×1254)** 이다. 노션 커버는 **가로로 길다.** 정사각 그림을
그대로 커버에 넣으면 위아래가 잘리거나 늘어나서 학사모·글자가 날아간다.
그래서 아이콘(정사각)과 커버(가로)를 **다른 판으로** 만든다.

## 안전 구역
커버는 두 번 잘린다.
  ① 노션이 창 너비에 따라 **위아래**를 자른다(높이가 줄어든다).
  ② 카톡·슬랙 링크 미리보기가 og:image 를 **좌우**로 잘라 2:1 남짓으로 만든다.
그래서 1500×600 으로 만들되 알맹이는 **x 200~1300 · y 100~500** 안에만 둔다.
이 구역 밖은 잘려도 되는 배경만 있어야 한다.

결이 첫 게시물·프로필과 같도록 같은 유리 만드는 법을 그대로 가져다 쓴다.
"""
import importlib.util
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
FONTS = os.path.join(BASE, "newsfeed", "fonts")
OUT = os.path.join(BASE, "노션_아이콘_커버")
os.makedirs(OUT, exist_ok=True)

# 유리·물감 만드는 법은 프로필 쪽 스크립트에 있다. 베껴 쓰지 않고 불러온다
# (한쪽만 고쳐서 결이 갈리는 걸 막는다).
_spec = importlib.util.spec_from_file_location(
    "glass", os.path.join(HERE, "프로필_하이라이트_유리판_만들기.py"))
G = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(G)

INK = (11, 11, 15)
GRAY = (112, 116, 126)


def F(w, s):
    return ImageFont.truetype(os.path.join(FONTS, f"Pretendard-{w}.otf"), s)


def ttext(d, xy, text, font, fill, tracking=0, anchor="la"):
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


def _wash(size, blobs):
    """G.wash 는 1080x1350 에 묶여 있어(모듈 상수) 여기서는 크기를 받아 다시 그린다."""
    import numpy as np
    from PIL import ImageFilter
    W, H = size
    s = 4
    h, w = H // s, W // s
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    acc = np.zeros((h, w, 3), np.float32) + np.array(G.PAPER, np.float32)
    for cx, cy, r, col, a in blobs:
        sig = r / s * 0.60
        g = (np.exp(-(((xx - cx / s) ** 2 + (yy - cy / s) ** 2) / (2 * sig ** 2))) * a)[..., None]
        acc = acc * (1 - g) + np.array(col, np.float32) * g
    band = np.sin((xx * 0.9 + yy * 1.7) * 0.055) * 3.2 + np.sin((xx - yy) * 0.021) * 2.4
    acc += band[..., None]
    sm = Image.fromarray(np.clip(acc, 0, 255).astype(np.uint8), "RGB")
    return sm.filter(ImageFilter.GaussianBlur(2.5)).resize((W, H), Image.BICUBIC).convert("RGBA")


def logo():
    return G.art("뉴보대_로고.png", crop=(338, 239, 916, 822))   # 워드마크 뺀 심벌만


def icon(n=512):
    """정사각 아이콘. 노션은 이걸 작게(20px 남짓) 쓰니 심벌만 크게."""
    im = _wash((n, n), [(int(n * .28), int(n * .23), int(n * .65), (108, 168, 255), .92),
                        (int(n * .78), int(n * .67), int(n * .61), (150, 140, 250), .72),
                        (int(n * .50), int(n * .95), int(n * .52), (120, 205, 232), .55)])
    r = int(n * 0.335)
    c = n // 2
    G.glass(im, (c - r, c - r, c + r, c + r), radius=r, blur=int(n * .03),
            sheet=138, shadow=int(n * .07))
    ic = G.fit(logo(), int(n * 0.40))
    im.alpha_composite(ic, (c - ic.width // 2, c - ic.height // 2))
    return G.grain(im).convert("RGB")


def cover(W=1500, H=600, size=62, logo_px=150, gap=44):
    """가로 커버 — `뉴스 보는` · 로고 · `대학생` 을 한 줄로 가운데 배치.

    로고를 가운데 두고 글자를 좌우로 나눠 걸면 가로로 긴 판을 억지로 채우지 않아도
    균형이 잡힌다. 크기는 일부러 작게 잡았다(글자 62 · 로고 150) — 배너는 페이지
    제목 바로 위에 붙는 띠라서 크게 넣으면 제목과 싸운다.

    좌우로 잘려도 살아남게, 한 줄 전체를 안전 구역 안에 넣는다.
    """
    im = _wash((W, H), [(360, 140, 880, (108, 168, 255), 0.82),
                        (1160, 500, 840, (150, 140, 250), 0.62),
                        (760, 630, 700, (120, 205, 232), 0.40)])

    fL = F("Black", size)
    left, right = "뉴스 보는", "대학생"
    tr = -3
    wL = sum(fL.getlength(c) for c in left) + tr * (len(left) - 1)
    wR = sum(fL.getlength(c) for c in right) + tr * (len(right) - 1)

    # 한 줄 전체를 가운데 맞춘다: [뉴스 보는] gap [로고] gap [대학생]
    total = wL + gap + logo_px + gap + wR
    x0 = (W - total) / 2
    cy = H // 2
    cx = x0 + wL + gap + logo_px / 2

    s = int(logo_px / 2)
    G.glass(im, (int(cx - s), cy - s, int(cx + s), cy + s),
            radius=int(logo_px * 0.30), blur=22, sheet=134, shadow=34)
    ic = G.fit(logo(), int(logo_px * 0.68))
    im.alpha_composite(ic, (int(cx - ic.width / 2), cy - ic.height // 2))

    ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov, "RGBA")
    ttext(d, (x0 + wL, cy), left, fL, INK, tr, anchor="rm")
    ttext(d, (cx + logo_px / 2 + gap, cy), right, fL, INK, tr, anchor="lm")
    im.alpha_composite(ov)
    return G.grain(im).convert("RGB")


def safe_check(img, box=(200, 100, 1300, 500)):
    """알맹이가 안전 구역을 넘지 않았는지 실제 픽셀로 확인한다.

    바탕(물감)과 글자/로고를 가리는 기준은 **바탕보다 확실히 어두운 화소**.
    구역 밖에 그런 화소가 있으면 잘릴 때 알맹이가 날아간다는 뜻이다.
    """
    import numpy as np
    a = np.asarray(img.convert("L")).astype(np.int16)
    dark = a < 120                     # 먹빛 글자·남색 로고만 잡히는 문턱
    x0, y0, x1, y1 = box
    outside = dark.copy()
    outside[y0:y1, x0:x1] = False
    ys, xs = np.nonzero(outside)
    return {"어두운화소": int(dark.sum()), "구역밖": int(outside.sum()),
            "구역밖_범위": (None if not len(xs) else
                          (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())))}


if __name__ == "__main__":
    ic = icon()
    ic.save(os.path.join(OUT, "노션_아이콘_512.png"))
    cv = cover()
    cv.save(os.path.join(OUT, "노션_커버_1500x600.png"))

    print("아이콘", ic.size, "커버", cv.size)
    print("안전 구역 검사:", safe_check(cv))
    # 링크 미리보기가 2:1 로 자를 때 무엇이 남는지 같이 뽑아 둔다
    w2 = int(cv.height * 2)
    cv.crop(((cv.width - w2) // 2, 0, (cv.width + w2) // 2, cv.height)).save(
        os.path.join(OUT, "미리보기_2대1로_잘린_모습.png"))
    print("저장:", OUT)
