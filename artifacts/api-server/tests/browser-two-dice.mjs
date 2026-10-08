import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const results = new URL("../test-results/", import.meta.url);
const privateDir = new URL("../../../.local/browser-qa/", import.meta.url);
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const privatePath = new URL("two-dice-ui.json", privateDir);
const reportPath = new URL("two-dice-ui.json", results);
let report = { outcome: "running", fixtureOnly: true, players: [], evidence: [] };
const seats = [];
const browser = await chromium.launch({
  executablePath: "/repl/tools/bin/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
async function fixture(flag) {
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  const proc = spawnSync("pnpm", ["--filter", "@workspace/api-server", "test", "tests/two-dice-ui-fixture.ts", ...(flag ? [flag] : [])], { cwd: new URL("../../../", import.meta.url), encoding: "utf8" });
  console.log(proc.stdout); assert.equal(proc.status, 0, proc.stderr);
}
const json = async response => {
  const body = await response.json(); assert.equal(response.status(), 200, body.error ?? "Request failed"); return body;
};
try {
  for (let index = 0; index < 2; index++) {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: index === 0 ? { width: 1440, height: 1000 } : { width: 390, height: 844 },
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    page.on("pageerror", err => report.evidence.push({ browserError: err.message }));
    const username = `qa2_${randomUUID().slice(0, 8)}`;
    await page.goto(`${base}/register`);
    await page.getByTestId("input-username").fill(username);
    await page.getByTestId("input-email").fill(`${username}@example.com`);
    await page.getByTestId("input-password").fill(randomUUID());
    const created = page.waitForResponse(r => r.url().endsWith("/api/auth/register") && r.request().method() === "POST");
    await page.getByTestId("button-register").click();
    const response = await created; assert.equal(response.status(), 201);
    const user = (await response.json()).user;
    await page.waitForURL(`${base}/`);
    report.players.push({ id: user.id, username });
    seats.push({ context, page, user });
  }
  await writeFile(privatePath, JSON.stringify({ players: await Promise.all(seats.map(async seat => ({ id: seat.user.id, storage: await seat.context.storageState() }))) }), { mode: 0o600 });
  await fixture();
  report = JSON.parse(await readFile(reportPath, "utf8"));
  const room = { id: report.roomId, hostUserId: seats[0].user.id };
  const roomUrl = `${base}/api/rooms/${room.id}`;
  for (const seat of seats) {
    await seat.page.goto(`${base}/game/${room.id}`);
    await seat.page.getByTestId("button-roll-dice").waitFor();
    await seat.page.getByTestId("status-connection").filter({ hasText: "LIVE" }).waitFor({ state: "attached" });
  }
  async function action(seat, endpoint, selector) {
    const [response] = await Promise.all([
      seat.page.waitForResponse(r => r.url() === `${roomUrl}/${endpoint}` && r.request().method() === "POST"),
      seat.page.getByTestId(selector).click(),
    ]);
    return json(response);
  }
  const first = seats[0];
  const rolled = await action(first, "roll", "button-roll-dice");
  assert.equal(rolled.board.dice.length, 2);
  assert.deepEqual(rolled.board.remainingDice, [0, 1]);
  await first.page.getByTestId("button-die-0").click();
  assert.equal(await first.page.getByTestId("button-die-0").getAttribute("aria-pressed"), "true");
  const partial = await action(first, "move", "button-token-red-0");
  assert.equal(partial.board.redTokens[0], rolled.board.dice[0]);
  assert.deepEqual(partial.board.remainingDice, [1]); assert.equal(partial.board.turnUserId, first.user.id);
  assert.ok(await first.page.getByTestId("button-die-0").isDisabled());
  await first.page.getByTestId("button-die-1").click();
  const observedPromise = seats[1].page.waitForResponse(async r => {
    if (r.url() !== roomUrl || r.request().method() !== "GET") return false;
    try { return (await r.json()).board.redTokens[1] === 10 + rolled.board.dice[1]; } catch { return false; }
  });
  const [split, observed] = await Promise.all([action(first, "move", "button-token-red-1"), observedPromise]);
  assert.equal(split.board.redTokens[1], 10 + rolled.board.dice[1]);
  assert.equal(observed.status(), 200);
  report.evidence.push({ splitDice: rolled.board.dice, redTokensAfterSplit: split.board.redTokens, usedDieDisabled: true, opponentSynced: true });
  const next = seats.find(seat => seat.user.id === split.board.turnUserId);
  const nextColor = next.user.id === room.hostUserId ? "red" : "green";
  const nextRoll = await action(next, "roll", "button-roll-dice");
  const before = nextColor === "red" ? nextRoll.board.redTokens[0] : nextRoll.board.greenTokens[0];
  await next.page.getByTestId("button-dice-combine").click();
  const combined = await action(next, "move", `button-token-${nextColor}-0`);
  const after = nextColor === "red" ? combined.board.redTokens[0] : combined.board.greenTokens[0];
  assert.equal(after, before + nextRoll.board.dice[0] + nextRoll.board.dice[1]);
  report.evidence.push({ combinedDice: nextRoll.board.dice, destination: after });
  for (const [index, seat] of seats.entries()) {
    const overflow = await seat.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert.equal(overflow, false, `Player ${index + 1} has horizontal overflow`);
    await seat.page.screenshot({ path: new URL(`two-dice-${index === 0 ? "desktop" : "mobile"}.png`, results).pathname, fullPage: true });
  }
  assert.ok(!report.evidence.some(item => item.browserError));
  report.outcome = "passed";
  console.log("PASS real two-dice UI: split two tokens, combine sum, consumed dice disabled, opponent sync, desktop and mobile no overflow.");
} catch (error) {
  report.outcome = "failed"; report.error = error.message;
  for (const [index, seat] of seats.entries()) {
    await seat.page.screenshot({ path: new URL(`two-dice-failure-${index}.png`, results).pathname, fullPage: true });
  }
  throw error;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await browser.close();
  if (report.players.length === 2) await fixture("--cleanup");
}
