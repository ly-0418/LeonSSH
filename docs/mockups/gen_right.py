from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1240, 1000
bg = (7, 10, 13)
img = Image.new("RGB", (W, H), bg)
d = ImageDraw.Draw(img)


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


yahei = "C:/Windows/Fonts/msyh.ttc"
yahei_b = "C:/Windows/Fonts/msyhbd.ttc"
mono = "C:/Windows/Fonts/consola.ttf"
icons = "C:/Windows/Fonts/segmdl2.ttf"

f_title = font(yahei, 15)
f_tab = font(yahei, 14)
f_cap = font(yahei_b, 16)
f_term = font(mono, 16)
f_status = font(yahei, 13)
f_small = font(yahei, 12)
f_icon = font(icons, 16)

ICON_FOLDER = "\uE8B7"
ICON_SETTINGS = "\uE713"

WIN_W, WIN_H = 1180, 430
WIN_X = (W - WIN_W) // 2


def traffic(draw, right_x, y):
    colors = [(255, 95, 87), (254, 188, 46), (40, 200, 64)]
    for i, c in enumerate(colors):
        cx = right_x - (2 - i) * 20
        draw.ellipse([cx - 6, y - 6, cx + 6, y + 6], fill=c)


def icon_button(draw, x, y, glyph):
    draw.rounded_rectangle([x, y - 12, x + 26, y + 12], radius=6, fill=(20, 29, 36), outline=(36, 50, 60))
    draw.text((x + 6, y - 9), glyph, font=f_icon, fill=(160, 175, 185))
    return x + 34


def terminal(draw, x, y, w, h):
    lines = [
        ("Last login: Wed Nov  5 19:14:02 2026 from 172.20.1.9", (170, 180, 188)),
        ("[root@middleapp ~]# ls", (225, 232, 238)),
        ("assets   hello.sh   hosts   Leon.jpg", (120, 190, 255)),
        ("[root@middleapp ~]# ", (225, 232, 238)),
    ]
    ty = y + 18
    for text, color in lines:
        draw.text((x + 22, ty), text, font=f_term, fill=color)
        ty += 26
    cx = x + 22 + draw.textlength(lines[-1][0], font=f_term)
    draw.rectangle([cx + 2, ty - 26 + 3, cx + 11, ty - 26 + 19], fill=(74, 222, 128))


def window(draw, top, variant):
    draw.rounded_rectangle(
        [WIN_X, top, WIN_X + WIN_W, top + WIN_H],
        radius=14,
        fill=(15, 21, 26),
        outline=(32, 46, 56),
        width=1,
    )
    header_h = 54
    draw.rounded_rectangle([WIN_X, top, WIN_X + WIN_W, top + header_h], radius=14, fill=(13, 18, 22))
    draw.rectangle([WIN_X, top + header_h - 14, WIN_X + WIN_W, top + header_h], fill=(13, 18, 22))

    cy = top + header_h // 2
    # right side: folder, settings, separator, traffic lights
    x = WIN_X + WIN_W - 116
    traffic(draw, x, cy)
    sep_x = x - 22
    draw.line([sep_x, top + 16, sep_x, top + 38], fill=(36, 50, 60), width=1)
    btn_x = sep_x - 84
    btn_x = icon_button(draw, btn_x, cy, ICON_FOLDER)
    icon_button(draw, btn_x, cy, ICON_SETTINGS)

    if variant == "C":
        title = "LeonSSH"
        tw = draw.textlength(title, font=f_title)
        draw.text((WIN_X + 22, cy - 9), title, font=f_title, fill=(205, 215, 222))
        draw.text((WIN_X + 22 + tw + 8, cy - 8), "●", font=font(yahei, 10), fill=(74, 222, 128))

        tab_y = top + header_h
        draw.line([WIN_X, tab_y, WIN_X + WIN_W, tab_y], fill=(28, 40, 49), width=1)
        tabs = [("本地 Docker 测试", True), ("生产网关", False), ("数据库跳板", False)]
        tx = WIN_X + 16
        for name, active in tabs:
            tw = draw.textlength(name, font=f_tab)
            w = tw + 58
            box = [tx, tab_y + 7, tx + w, tab_y + 41]
            if active:
                draw.rounded_rectangle(box, radius=8, fill=(27, 38, 47), outline=(48, 66, 78))
            draw.text((tx + 14, tab_y + 16), name, font=f_tab, fill=(230, 236, 240) if active else (130, 145, 155))
            draw.text((tx + w - 22, tab_y + 15), "✕", font=f_small, fill=(120, 134, 144))
            tx += w + 8
        draw.text((tx + 6, tab_y + 16), "+", font=f_tab, fill=(130, 145, 155))
        content_top = tab_y + 48
    else:
        tab_y = top + 12
        tabs = [("本地 Docker 测试", True), ("生产网关", False), ("数据库跳板", False)]
        tx = WIN_X + 18
        for name, active in tabs:
            tw = draw.textlength(name, font=f_tab)
            w = tw + 58
            box = [tx, tab_y, tx + w, tab_y + 34]
            if active:
                draw.rounded_rectangle(box, radius=9, fill=(27, 38, 47), outline=(48, 66, 78))
            draw.text((tx + 14, tab_y + 9), name, font=f_tab, fill=(230, 236, 240) if active else (130, 145, 155))
            draw.text((tx + w - 22, tab_y + 8), "✕", font=f_small, fill=(120, 134, 144))
            tx += w + 8
        draw.text((tx + 6, tab_y + 9), "+", font=f_tab, fill=(130, 145, 155))
        content_top = top + 58
        draw.line([WIN_X, content_top, WIN_X + WIN_W, content_top], fill=(28, 40, 49), width=1)

    terminal(draw, WIN_X, content_top + 6, WIN_W, WIN_H - (content_top - top) - 34)

    status_y = top + WIN_H - 26
    draw.line([WIN_X, status_y, WIN_X + WIN_W, status_y], fill=(24, 34, 42), width=1)
    draw.ellipse([WIN_X + 16, status_y + 10, WIN_X + 24, status_y + 18], fill=(74, 222, 128))
    draw.text((WIN_X + 32, status_y + 6), "当前会话 → 本地 Docker 测试   127.0.0.1:2222", font=f_status, fill=(150, 163, 172))


d.text((WIN_X, 24), "方案 C · 顶栏：左品牌，右侧 文件 / 设置 / 分隔线 / ●●●，页签在下一行", font=f_cap, fill=(190, 200, 208))
window(d, 58, "C")
d.text((WIN_X, 520), "方案 D · 单层顶栏：左侧页签，右侧 文件 / 设置 / ●●●（省一行高度）", font=f_cap, fill=(190, 200, 208))
window(d, 552, "D")
d.text(
    (WIN_X, 1014 - 10),
    "说明：红=关闭（有会话时先确认）、黄=最小化、绿=最大化/还原；顶栏空白处可拖动窗口。",
    font=f_small,
    fill=(120, 134, 144),
)

os.makedirs("docs/mockups", exist_ok=True)
img.save("docs/mockups/macos-titlebar-right.png")
print("saved right mockup")
