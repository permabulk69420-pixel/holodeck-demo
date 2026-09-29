import sys, base64, json, os
from playwright.sync_api import sync_playwright
# usage: cw_shoot.py OUTDIR X Y Z SIZE T
out, x, y, z, size, t = sys.argv[1], *map(float, sys.argv[2:5]), int(sys.argv[5]), float(sys.argv[6])
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/opt/pw-browsers/chromium",
        args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 400, "height": 300})
    logs = []
    pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
    pg.on("pageerror", lambda e: logs.append("PAGEERROR " + str(e)))
    pg.goto("http://localhost:5199/capture.html")
    try:
        pg.wait_for_function("window.captureReady===true", timeout=120000)
    except Exception as e:
        print("not ready", e); print("\n".join(logs[:20])); sys.exit(1)
    faces = pg.evaluate(f"window.shoot({x},{y},{z},{size},{t})")
    for k, v in faces.items():
        open(f"{out}/{k}.png", "wb").write(base64.b64decode(v.split(",")[1]))
    print("ok", list(faces), "\n".join(l for l in logs if "error" in l.lower())[:500])
    b.close()
