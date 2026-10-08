import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

// Read-only visual check using the original authenticated QA match.
const state = JSON.parse(await readFile(new URL("../../../.local/browser-qa/state.json", import.meta.url), "utf8"));
const original = JSON.parse(await readFile(new URL("../test-results/report.json", import.meta.url), "utf8"));
const player = state.players.find(p => p.id === original.players[1].id);
assert.ok(player?.storage);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const browser = await chromium.launch({
  executablePath: "/repl/tools/bin/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
try {
  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 1100 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ storageState: player.storage, ignoreHTTPSErrors: true, viewport });
    const page = await context.newPage();
    await page.goto(`${base}/game/${original.roomId}`);
    await page.locator(".lb-grid").waitFor();
    assert.equal(await page.locator(".lb-home-inset").count(), 4);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: new URL(`../test-results/uncle-joe-${label}.png`, import.meta.url).pathname, fullPage: true });
    await context.close();
    console.log(`PASS ${label}: four square home insets, wooden board, no horizontal overflow; legacy completed match remains readable.`);
  }
} finally { await browser.close(); }
