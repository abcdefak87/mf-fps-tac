#!/usr/bin/env python3
"""Smoke-test the game in headless chromium: console errors + __shotReady + PNG."""
import asyncio, sys, pathlib
from playwright.async_api import async_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8321/?shot=combat&seed=1"
OUT = sys.argv[2] if len(sys.argv) > 2 else "/tmp/fps-entry/tools/shot.png"
WAIT_READY = len(sys.argv) <= 3 or sys.argv[3] != "noready"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader",
                                                "--enable-unsafe-swiftshader", "--hide-scrollbars"])
        page = await browser.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        page.on("console", lambda m: errors.append(f"[{m.type}] {m.text}") if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: errors.append(f"[pageerror] {e}"))
        await page.goto(URL)
        if WAIT_READY:
            try:
                await page.wait_for_function("window.__shotReady === true", timeout=25000)
            except Exception as e:
                errors.append(f"[timeout] __shotReady: {e}")
        else:
            await page.wait_for_timeout(int(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[3] != "noready" else 4000)
        await page.screenshot(path=OUT)
        state = await page.evaluate("""() => {
          const g = window.__game;
          if (!g) return {game: false};
          return {game: true, phase: g.G.phase, round: g.G.round,
                  agents: g.agents.map(a => ({n: a.name, t: a.team, alive: a.alive, s: a.state,
                    pos: [a.body.position.x.toFixed(1), a.body.position.z.toFixed(1)]})),
                  player: {hp: g.playerAgent.health, alive: g.playerAgent.alive,
                    pos: [g.player.body.position.x.toFixed(1), g.player.body.position.z.toFixed(1)]},
                  bomb: g.G.bomb && g.G.bomb.state};
        }""")
        print("STATE:", state)
        print("ERRORS:" if errors else "NO ERRORS")
        for e in errors[:30]:
            print(" ", e)
        await browser.close()

asyncio.run(main())
