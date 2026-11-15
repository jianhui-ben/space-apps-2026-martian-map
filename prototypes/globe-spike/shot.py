"""SPIKE - headless Chromium (SwiftShader) checks for the globe spike. Writes shots/ and prints a JSON summary."""

import json
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8766/"
OUT = Path(__file__).resolve().parent / "shots"
OUT.mkdir(exist_ok=True)
W, H = 1280, 800


def total(page):
    return page.evaluate("Object.values(spike.layers).reduce((a, l) => a + l.ok + l.bad, 0)")


def settle(page, quiet=2.5, timeout=40):
    t0 = time.time()
    last, since = -1, time.time()
    while time.time() - t0 < timeout:
        n = total(page)
        if n != last:
            last, since = n, time.time()
        elif time.time() - since > quiet:
            return round(time.time() - t0, 1)
        page.wait_for_timeout(400)
    return f">{timeout}"


def main():
    summary = {"console": [], "failed": [], "steps": []}
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        page = b.new_page(viewport={"width": W, "height": H})
        page.on("console", lambda m: summary["console"].append(f"{m.type}: {m.text}"[:300]) if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: summary["console"].append(f"pageerror: {e}"[:300]))
        page.on("response", lambda r: summary["failed"].append(f"{r.status} {r.url}"[:200]) if r.status >= 400 else None)
        t0 = time.time()
        page.goto(URL)
        page.wait_for_function("window.spike && spike.siteReady && spike.layers.viking && spike.layers.viking.ok > 4", timeout=60000)
        s = settle(page)
        page.screenshot(path=str(OUT / "1-globe.png"))
        summary["steps"].append({"shot": "1-globe", "alt_km": round(page.evaluate("spike.altitude()") / 1000), "settle_s": s, "load_s": round(time.time() - t0, 1), "layers": page.evaluate("spike.layers")})

        # continuous wheel zoom at the screen centre (Gale is centred)
        page.mouse.move(W / 2, H / 2)
        alts, shots = [], [(800e3, "2-region"), (40e3, "3-ctx"), (6e3, "4-hirise")]
        for i in range(400):
            page.mouse.wheel(0, -300)
            page.wait_for_timeout(60)
            alt = page.evaluate("spike.altitude()")
            alts.append(round(alt))
            if shots and alt < shots[0][0]:
                target, name = shots.pop(0)
                s = settle(page)
                page.screenshot(path=str(OUT / f"{name}.png"))
                summary["steps"].append({"shot": name, "alt_m": round(page.evaluate("spike.altitude()")), "settle_s": s, "layers": page.evaluate("spike.layers"), "fps": page.evaluate("spike.fps")})
            if not shots:
                break
        summary["wheel_alt_samples_m"] = alts[:: max(1, len(alts) // 25)]
        summary["wheel_events"] = len(alts)

        # close-up oblique view of the site and the footprint
        page.evaluate("spike.setLocalView(-300, -1500, 700, -300, 0)")
        s = settle(page)
        page.wait_for_timeout(2500)
        page.screenshot(path=str(OUT / "5-site.png"))
        summary["steps"].append({"shot": "5-site", "settle_s": s, "layers": page.evaluate("spike.layers"), "fps": page.evaluate("spike.fps"), "drape": page.evaluate("spike.hiriseDrape"), "site": page.evaluate("spike.site")})

        # scripted drag of the footprint
        before = page.evaluate("spike.readout")
        a = page.evaluate("spike.footprintScreen()")
        dest = page.evaluate("spike.localScreen(250, 150)")
        page.mouse.move(a["x"], a["y"])
        page.mouse.down()
        for k in range(1, 21):
            page.mouse.move(a["x"] + (dest["x"] - a["x"]) * k / 20, a["y"] + (dest["y"] - a["y"]) * k / 20)
            page.wait_for_timeout(30)
        page.mouse.up()
        page.wait_for_timeout(800)
        after = page.evaluate("spike.readout")
        page.screenshot(path=str(OUT / "6-dragged.png"))
        summary["drag"] = {"from_px": a, "to_px": dest, "before": before, "after": after, "drags": page.evaluate("spike.drags"), "fp": page.evaluate("[spike.footprintScreen()]")}
        summary["fps_end"] = page.evaluate("spike.fps")
        b.close()
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
