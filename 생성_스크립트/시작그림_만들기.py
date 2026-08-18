# -*- coding: utf-8 -*-
"""exe 를 켤 때 0.5초 만에 뜨는 시작 그림(`splash.png`)을 만든다.

왜 필요한가 — WebView2 창은 처음 켤 때 4~5초가 걸린다. 그동안 화면에 아무것도
없으면 눌리지 않은 줄 알고 두 번, 세 번 누르게 된다. PyInstaller 의 `--splash` 는
exe 가 뜨자마자 이 그림을 띄우고, 창이 준비되면 `pyi_splash.close()` 로 닫는다.

  python 생성_스크립트/시작그림_만들기.py
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
LOGO = os.path.join(BASE, "newsfeed", "assets", "뉴보대_로고.png")
FONTS = os.path.join(BASE, "newsfeed", "fonts")
OUT = os.path.join(BASE, "splash.png")

W, H = 460, 260
BG = (20, 22, 26)            # 화면(style.css)과 같은 어두운 바탕
FG = (232, 234, 238)
DIM = (138, 146, 160)


def font(name, size):
    p = os.path.join(FONTS, name)
    try:
        return ImageFont.truetype(p, size)
    except OSError:
        return ImageFont.load_default()


def main():
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)

    # 로고 — 배경이 어두우므로 흰 원을 깔고 그 위에 얹는다(남색 로고가 묻히지 않게)
    if os.path.exists(LOGO):
        logo = Image.open(LOGO).convert("RGBA")
        side = 96
        logo = logo.resize((side, side), Image.LANCZOS)
        cx, cy = W // 2, 92
        r = side // 2 + 12
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255))
        im.paste(logo, (cx - side // 2, cy - side // 2), logo)

    t1 = "뉴보대 카드뉴스 메이커"
    t2 = "여는 중입니다…"
    f1, f2 = font("Pretendard-Bold.otf", 22), font("Pretendard-Regular.otf", 13)
    for text, f, y, col in ((t1, f1, 168, FG), (t2, f2, 202, DIM)):
        w = d.textbbox((0, 0), text, font=f)[2]
        d.text(((W - w) // 2, y), text, font=f, fill=col)

    im.save(OUT)
    print("만들었습니다:", OUT, im.size)


if __name__ == "__main__":
    main()
