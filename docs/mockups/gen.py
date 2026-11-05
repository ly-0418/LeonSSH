from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1240, 1180
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
f_title = font(yahei, 15)
f_tab = font(yahei, 14)
f_cap = font(yahei_b, 16)
f_term = font(mono, 16)
f_status = font(yahei, 13)
f_small = font(yahei, 12)

WIN_W, WIN_H = 1180, 470
WIN_X = (W - WIN_W) // 2

def rounded(draw, box, radius, fill, outline=None):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline)

def traffic(draw, x, y):
    colors = [(255, 95, 87), (254, 188, 46), (40, 200, 64)]
    for i, c in enumerate(colors):
        cx = x + i * 20
        draw.ellipse([cx - 6, y - 6, cx + 6, y + 6], fill=c)

def terminal(draw, x, y, w, h):
    lines = [
        ("Last login: Wed Nov  5 19:14:02 2026 from 172.20.1.9", (170, 180, 188)),
        ("[root@middleapp ~]# ls", (225, 232, 238)),
        ("assets   hello.sh   hosts   Leon.jpg", (120, 190, 255)),
        ("[root@middleapp ~]# cd /opt", (225, 232, 238)),
        ("[root@middleapp opt]# ", (225, 232, 238)),
    ]
    ty = y + 18
    for text, color in lines:
        draw.text((x + 22, ty), text, font=f_term, fill=color)
        ty += 26
    # cursor block after the last prompt
    cx = x + 22 + draw.textlength(lines[-1][0], font=f_term)
    draw.rectangle([cx + 2, ty - 26 + 3, cx + 11, ty - 26 + 19], fill=(74, 222, 128))

def window(draw, top, variant):
    draw.rounded_rectangle([WIN_X, top, WIN_X + WIN_W, top + WIN_H], radius=14, fill=(15, 21, 26), outline=(32, 46, 56), width=1)
    header_h = 54
    draw.rounded_rectangle([WIN_X, top, WIN_X + WIN_W, top + header_h], radius=14, fill=(13, 18, 22))
    draw.rectangle([WIN_X, top + header_h - 14, WIN_X + WIN_W, top + header_h], fill=(13, 18, 22))
    traffic(draw, WIN_X + 22, top + header_h // 2)
    if variant == "A":
        title = "LeonSSH"
        tw = draw.textlength(title, font=f_title)
        draw.text(((WIN_W - tw) / 2 + WIN_X, top + header_h / 2 - 9), title, font=f_title, fill=(200, 210, 218))

    if variant == "A":
        tab_y = top + header_h
        draw.line([WIN_X, tab_y, WIN_X + WIN_W, tab_y], fill=(28, 40, 49), width=1)
        tabs = [("本地 Docker 测试", True), ("生产网关", False), ("数据库跳板", False)]
        x = WIN_X + 16
        for name, active in tabs:
            tw = draw.textlength(name, font=f_tab)
            w = tw + 58
            box = [x, tab_y + 7, x + w, tab_y + 41]
            if active:
                rounded(draw, box, 8, (27, 38, 47), (48, 66, 78))
            draw.text((x + 14, tab_y + 16), name, font=f_tab, fill=(230, 236, 240) if active else (130, 145, 155))
            # close glyph
            draw.text((x + w - 22, tab_y + 15), "✕", font=f_small, fill=(120, 134, 144))
            x += w + 8
        draw.text((x + 6, tab_y + 16), "+", font=f_tab, fill=(130, 145, 155))
        content_top = tab_y + 48
    else:
        tab_y = top + 12
        tabs = [("本地 Docker 测试", True), ("生产网关", False), ("数据库跳板", False)]
        x = WIN_X + 92
        for name, active in tabs:
            tw = draw.textlength(name, font=f_tab)
            w = tw + 58
            box = [x, tab_y, x + w, tab_y + 34]
            if active:
                rounded(draw, box, 9, (27, 38, 47), (48, 66, 78))
            draw.text((x + 14, tab_y + 9), name, font=f_tab, fill=(230, 236, 240) if active else (130, 145, 155))
            draw.text((x + w - 22, tab_y + 8), "✕", font=f_small, fill=(120, 134, 144))
            x += w + 8
        draw.text((x + 6, tab_y + 9), "+", font=f_tab, fill=(130, 145, 155))
        content_top = top + 58
        draw.line([WIN_X, content_top, WIN_X + WIN_W, content_top], fill=(28, 40, 49), width=1)

    terminal(draw, WIN_X, content_top + 6, WIN_W, WIN_H - (content_top - top) - 34)
    # status bar
    status_y = top + WIN_H - 26
    draw.line([WIN_X, status_y, WIN_X + WIN_W, status_y], fill=(24, 34, 42), width=1)
    draw.ellipse([WIN_X + 16, status_y + 10, WIN_X + 24, status_y + 18], fill=(74, 222, 128))
    draw.text((WIN_X + 32, status_y + 6), "当前会话 → 本地 Docker 测试   127.0.0.1:2222", font=f_status, fill=(150, 163, 172))

d.text((WIN_X, 24), "方案 A · 交通灯独立于标题行，页签在下方（接近 Safari / VS Code）", font=f_cap, fill=(190, 200, 208))
window(d, 60, "A")
d.text((WIN_X, 594), "方案 B · 交通灯与页签同一行，标题居中（接近 macOS 原生 App）", font=f_cap, fill=(190, 200, 208))
window(d, 630, "B")
d.text((WIN_X, 1128), "说明：左侧三个圆点即 macOS 的关闭 / 最小化 / 最大化；圆点区可拖动窗口。", font=f_small, fill=(120, 134, 144))

os.makedirs("docs/mockups", exist_ok=True)
img.save("docs/mockups/macos-titlebar.png")
print("saved")
