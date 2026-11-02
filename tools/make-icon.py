"""Generates the 1024x1024 application icon used by `pnpm tauri icon`.

Run:  python tools/make-icon.py
Then: pnpm tauri icon ./assets/icon.png
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SIZE = 1024
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "icon.png"

TOP = (16, 26, 40)
BOTTOM = (9, 20, 31)
BORDER = (33, 60, 88, 255)
GREEN = (74, 222, 128, 255)
CYAN = (56, 189, 248, 255)

FONT_CANDIDATES = [
    r"C:\Windows\Fonts\consolab.ttf",
    r"C:\Windows\Fonts\consola.ttf",
    r"C:\Windows\Fonts\CascadiaMono.ttf",
]


def vertical_gradient(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int]) -> Image.Image:
    image = Image.new("RGBA", (size, size))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / (size - 1)
        color = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
        draw.line([(0, y), (size, y)], fill=color)
    return image


def load_font(size: int) -> ImageFont.FreeTypeFont:
    for candidate in FONT_CANDIDATES:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size)


def main() -> None:
    canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([64, 64, SIZE - 64, SIZE - 64], radius=208, fill=255)
    canvas.paste(vertical_gradient(SIZE, TOP, BOTTOM), (0, 0), mask)

    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        [64, 64, SIZE - 64, SIZE - 64], radius=208, outline=BORDER, width=6
    )

    font = load_font(470)
    prompt = ">"
    caret_width, caret_height = 132, 34
    gap = 30
    prompt_width = draw.textlength(prompt, font=font)
    start_x = (SIZE - (prompt_width + gap + caret_width)) / 2
    baseline = SIZE * 0.635

    draw.text((start_x, baseline), prompt, font=font, fill=GREEN, anchor="ls")

    block_left = start_x + prompt_width + gap
    block_top = baseline - caret_height - 4
    draw.rounded_rectangle(
        [block_left, block_top, block_left + caret_width, block_top + caret_height],
        radius=9,
        fill=CYAN,
    )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
