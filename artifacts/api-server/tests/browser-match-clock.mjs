import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const root = new URL("../../../", import.meta.url);
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const reportPath = new URL("../test-results/two-dice-ui.json", import.meta.url);
const finalReportPath = new URL("../test-results/match-clock-ui.json", import.meta.url);
const privateDir = new URL("../../../.local/browser-qa/", import.meta.url);
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const seats = [];
let report = { outcome: "running", fixtureOnly: true, players: [], evidence: [], browserErrors: [] };
function fixture(mode) {
  const child = spawnSync("pnpm", ["--filter", "@workspace/api-server", "test", "tests/two-dice-ui-fixture.ts", ...(mode ? [mode] : [])], { cwd: root, encoding: "utf8" });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
}
async function clock(page) {
  await page.waitForFunction(() => /^\d+:\d{2}$/.test(document.querySelector('[data-testid="text-match-countdown"]')?.textContent ?? ""));
  const text = await page.getByTestId("text-match-countdown").textContent();
  const [minutes, seconds] = text.split(":").map(Number);
  return minutes * 60 + seconds;
}
try {
  for (const [index, viewport] of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }].entries()) {
    const context = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
    if (index === 1) await context.addInitScript(() => {
      const realNow = Date.now.bind(Date);
      Date.now = () => realNow() + 3600000;
    });
    const page = await context.newPage();
    page.on("pageerror", error => report.browserErrors.push(error.message));
    const username = `qa2_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
    await page.goto(`${base}/register`);
    await page.getByTestId("input-username").fill(username);
    await page.getByTestId("input-email").fill(`${username}@example.com`);
    await page.getByTestId("input-password").fill(randomUUID());
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith("/api/auth/register") && r.request().method() === "POST"),
      page.getByTestId("button-register").click(),
    ]);
    assert.equal(response.status(), 201);
    const user = (await response.json()).user;
    await page.waitForURL(`${base}/`);
    report.players.push({ id: user.id, username });
    seats.push({ page, context, user });
  }
  await writeFile(new URL("match-clock-ui.json", privateDir), JSON.stringify({ players: await Promise.all(seats.map(async seat => ({ id: seat.user.id, storage: await seat.context.storageState() }))) }), { mode: 0o600 });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  fixture();
  report = JSON.parse(await readFile(reportPath, "utf8"));
  const roomUrl = `${base}/api/rooms/${report.roomId}`;
  await Promise.all(seats.map(async seat => {
    await seat.page.goto(`${base}/game/${report.roomId}`);
    await seat.page.locator(".lb-grid").waitFor();
    await seat.page.getByTestId("status-connection").filter({ hasText: "LIVE" }).waitFor({ state: "attached" });
  }));
  const starting = await Promise.all(seats.map(seat => clock(seat.page)));
  assert.ok(starting.every(value => value <= 480 && value >= 465));
  assert.ok(Math.abs(starting[0] - starting[1]) <= 2, "Server time compensates for one-hour client clock skew");
  const original = await (await seats[0].context.request.get(roomUrl)).json();
  await seats[0].page.waitForTimeout(1300);
  assert.ok(await clock(seats[0].page) < starting[0], "Countdown ticks live");
  await seats[1].page.reload();
  await seats[1].page.locator(".lb-grid").waitFor();
  const reloaded = await (await seats[1].context.request.get(roomUrl)).json();
  assert.equal(reloaded.board.matchDeadlineAt, original.board.matchDeadlineAt, "Reload cannot restart the clock");
  report.evidence.push({ startingClockSeconds: starting, clientClockSkewCompensated: true, countdownTicks: true, deadlineUnchangedAfterReload: true });

  fixture("--expire-tied");
  await Promise.all(seats.map(seat => seat.page.reload()));
  await Promise.all(seats.map(seat => seat.page.getByTestId("banner-overtime").waitFor({ timeout: 15000 })));
  for (const seat of seats) {
    assert.equal(await clock(seat.page), 0);
    assert.match(await seat.page.getByTestId("banner-overtime").textContent(), /OVERTIME \/ DRAW BREAK/);
  }
  assert.equal(await seats[0].page.getByTestId("button-roll-dice").isEnabled(), true);
  const [rollResponse] = await Promise.all([
    seats[0].page.waitForResponse(r => r.url() === `${roomUrl}/roll` && r.request().method() === "POST"),
    seats[0].page.getByTestId("button-roll-dice").click(),
  ]);
  assert.equal(rollResponse.status(), 200);
  const rolled = await rollResponse.json();
  assert.equal(rolled.status, "active"); assert.equal(rolled.board.isOvertime, true);
  assert.equal(rolled.board.dice.length, 2);
  assert.equal(rolled.board.winnerUserId, null, "Rolling alone does not break the tie");
  assert.deepEqual(rolled.scores.red, rolled.scores.green);
  report.evidence.push({ bothOvertimeBannersVisible: true, sharedClockAtZero: true, canRollTwoDiceInOvertime: true, rollWithoutMovementDoesNotSettle: true });
  for (const [index, seat] of seats.entries()) {
    assert.equal(await seat.page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await seat.page.screenshot({ path: new URL(`../test-results/match-clock-${index === 0 ? "desktop" : "mobile"}.png`, import.meta.url).pathname, fullPage: true });
  }
  assert.deepEqual(report.browserErrors, []);
  report.outcome = "passed";
  console.log("PASS live shared 8-minute clock, one-hour client skew, ticking countdown, reload persistence, automatic overtime on both screens, real two-dice overtime roll, desktop/mobile layout.");
} catch (error) {
  report.outcome = "failed"; report.error = error.message;
  for (const [index, seat] of seats.entries()) await seat.page.screenshot({ path: new URL(`../test-results/match-clock-failure-${index}.png`, import.meta.url).pathname, fullPage: true }).catch(() => {});
  throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await writeFile(finalReportPath, JSON.stringify(report, null, 2));
  await browser.close();
  if (report.roomId) fixture("--cleanup");
}
