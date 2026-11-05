import io
import re

tab_path = "src/components/TabBar.tsx"
with io.open(tab_path, encoding="utf-8") as fh:
    text = fh.read()

text = text.replace(
    'import { useEffect, useState } from "react";',
    'import { useCallback, useEffect, useRef, useState } from "react";',
)

state_block = '''  const [menu, setMenu] = useState<MenuState | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const syncArrows = useCallback(() => {
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    setCanScrollLeft(element.scrollLeft > 2);
    setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
  }, []);

  useEffect(() => {
    syncArrows();
    const element = scrollRef.current;
    if (element === null) {
      return;
    }
    element.addEventListener("scroll", syncArrows, { passive: true });
    const observer = new ResizeObserver(syncArrows);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", syncArrows);
      observer.disconnect();
    };
  }, [syncArrows, tabs.length]);

  const scrollTabs = (direction: number) => {
    scrollRef.current?.scrollBy({ left: direction * 220, behavior: "smooth" });
  };
'''
text = text.replace('  const [menu, setMenu] = useState<MenuState | null>(null);\n', state_block, 1)

left_arrow = '''  const [canScrollRight, setCanScrollRight] = useState(false);
'''  # no-op marker to keep script simple

# Wrap the tab list into a scroll strip with arrows on both sides.
open_wrap = '''    <div className="tab-bar" role="tablist">
      <div
        className="tab-bar__strip"
        data-overflow={canScrollLeft || canScrollRight ? "true" : "false"}
      >
        <button
          type="button"
          className="tab-bar__arrow tab-bar__arrow--left"
          title="向左滚动标签"
          aria-label="向左滚动标签"
          disabled={!canScrollLeft}
          onClick={() => scrollTabs(-1)}
        >
          \\u2039
        </button>
        <div className="tab-bar__scroll" ref={scrollRef}>
'''
text = text.replace('    <div className="tab-bar" role="tablist">\n', open_wrap, 1)

close_wrap = '''        </div>
        <button
          type="button"
          className="tab-bar__arrow tab-bar__arrow--right"
          title="向右滚动标签"
          aria-label="向右滚动标签"
          disabled={!canScrollRight}
          onClick={() => scrollTabs(1)}
        >
          \\u203a
        </button>
      </div>

      <button
        type="button"
        className="tab-bar__new"
'''
text = text.replace('''      <button
        type="button"
        className="tab-bar__new"
''', close_wrap, 1)

with io.open(tab_path, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(text)

print("TabBar patched")

app_path = "src/App.tsx"
with io.open(app_path, encoding="utf-8") as fh:
    app = fh.read()

if "TransferIcon" not in app:
    app = app.replace(
        'import { TabBar, type TabItem } from "./components/TabBar";',
        'import { TabBar, type TabItem } from "./components/TabBar";\nimport { SettingsIcon, TransferIcon } from "./components/icons";',
        1,
    )

# transfer icon block
start = app.find('            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">\n              <path d="M3 6.6')
if start >= 0:
    end = app.find("</svg>", start) + len("</svg>")
    app = app[:start] + '            <TransferIcon />' + app[end:]

# settings icon block (the gear with the long path)
start = app.find('            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">\n              <circle cx="12" cy="12" r="3.2" />')
if start >= 0:
    end = app.find("</svg>", start) + len("</svg>")
    app = app[:start] + '            <SettingsIcon />' + app[end:]

with io.open(app_path, "w", encoding="utf-8", newline="\n") as fh:
    fh.write(app)

print("App icons patched")
