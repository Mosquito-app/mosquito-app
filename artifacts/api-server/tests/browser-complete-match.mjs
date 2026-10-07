import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";

const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const original = JSON.parse(await readFile(new URL("../test-results/report.json", import.meta.url), "utf8"));
const privateState = JSON.parse(await readFile(new URL("../../../.local/browser-qa/state.json", import.meta.url), "utf8"));
assert.equal(original.players.length, 2);
const roomUrl = `${base}/api/rooms/${original.roomId}`;
const results = new URL("../test-results/", import.meta.url);
const browser = await chromium.launch({
  executablePath: "/repl/tools/bin/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const evidence = { outcome: "running", roomId: original.roomId, rolls: 0, moves: 0, timerResyncs: 0, browserErrors: [] };
const seats = [];
async function snapshot(label) {
  for (let index = 0; index < seats.length; index++) {
    await seats[index].page.screenshot({ path: new URL(`player-${index + 1}-${label}.png`, results).pathname, fullPage: true });
  }
}
async function data(response) {
  const body = await response.json();
  assert.equal(response.status(), 200, body.error ?? "Game request failed");
  return body;
}
async function uiAction(seat, endpoint, selector) {
  const response = seat.page.waitForResponse(r => r.url() === `${roomUrl}/${endpoint}` && r.request().method() === "POST");
  await seat.page.getByTestId(selector).click();
  const result = await response;
  if (result.status() === 400) {
    const error = await result.json();
    assert.match(error.error, /turn|timer/i);
    evidence.timerResyncs++;
    return data(await seats[0].context.request.get(roomUrl));
  }
  return data(result);
}
try {
  for (const originalPlayer of original.players) {
    const player = privateState.players.find(p => p.id === originalPlayer.id);
    assert.ok(player?.storage, "Original signed-in QA session is required");
    const context = await browser.newContext({ storageState: player.storage, ignoreHTTPSErrors: true, viewport: { width: 1440, height: 960 } });
    const page = await context.newPage(); page.setDefaultTimeout(20_000);
    page.on("pageerror", err => evidence.browserErrors.push(err.message));
    await page.goto(`${base}/game/${original.roomId}`);
    await page.getByTestId("button-roll-dice").waitFor();
    seats.push({ context, page, player });
  }
  let room = await data(await seats[0].context.request.get(roomUrl));
  assert.equal(room.status, "active", "Continue only the existing active funded QA match");
  console.log("Both authenticated board screens ready; playing normal UI rolls and token moves.");
  for (let step = 0; step < 1500 && room.status === "active"; step++) {
    const seat = seats.find(s => s.player.id === room.board.turnUserId);
    assert.ok(seat);
    if (!room.board.hasRolled) {
      room = await uiAction(seat, "roll", "button-roll-dice");
      evidence.rolls++;
      if (evidence.rolls % 25 === 0) {
        console.log(`Progress: ${evidence.rolls} server rolls, ${evidence.moves} legal moves; red=${room.board.redTokens}, green=${room.board.greenTokens}`);
      }
    } else {
      assert.ok(room.board.dice >= 1 && room.board.dice <= 6);
      const color = seat.player.id === room.hostUserId ? "red" : "green";
      const tokens = color === "red" ? room.board.redTokens : room.board.greenTokens;
      const legal = tokens.map((position, index) => ({ position, index }))
        .filter(t => t.position === -1 ? room.board.dice === 6 : t.position < 57 && t.position + room.board.dice <= 57)
        .sort((a, b) => b.position - a.position);
      assert.ok(legal.length, "Server must not leave a rolled turn with no legal moves");
      room = await uiAction(seat, "move", `button-token-${color}-${legal[0].index}`);
      evidence.moves++;
    }
  }
  assert.equal(room.status, "completed", "Match must finish through normal legal moves");
  const winnerId = room.board.winnerUserId;
  assert.ok(seats.some(s => s.player.id === winnerId));
  for (const seat of seats) {
    // Wait for the other board's real-time completion notification; no reload.
    await seat.page.getByText("Match closed. Settlement shows in your wallet.").waitFor();
    await seat.page.getByTestId("button-roll-dice").isDisabled().then(disabled => assert.ok(disabled));
    const wallet = await data(await seat.context.request.get(`${base}/api/wallet`));
    assert.equal(wallet.balanceNaira, seat.player.id === winnerId ? 3600 : 0);
    assert.equal(wallet.escrowedNaira, 0);
  }
  await snapshot("completed");
  for (const seat of seats) {
    // Replaying a finished room must be rejected, without awarding again.
    const roll = await seat.context.request.post(`${roomUrl}/roll`);
    assert.equal(roll.status(), 400);
    const move = await seat.context.request.post(`${roomUrl}/move`, { data: { tokenIndex: 0 } });
    assert.equal(move.status(), 400);
    await seat.page.goto(`${base}/`);
    await seat.page.getByTestId("text-wallet-balance").filter({ hasText: seat.player.id === winnerId ? "3,600" : "0" }).waitFor();
    const wallet = await data(await seat.context.request.get(`${base}/api/wallet`));
    assert.equal(wallet.balanceNaira, seat.player.id === winnerId ? 3600 : 0);
    assert.equal(wallet.escrowedNaira, 0);
  }
  await snapshot("settled-wallet");
  assert.deepEqual(evidence.browserErrors, []);
  Object.assign(evidence, {
    outcome: "passed", status: room.status, winnerId, prizeNaira: room.prizeNaira,
    commissionNaira: room.commissionNaira, replayRollRejected: true, replayMoveRejected: true, escrowNaira: 0,
  });
  console.log(`PASS completed match via browser UI: ${evidence.rolls} server rolls and ${evidence.moves} legal moves; winner ₦3,600, no escrow left; replays rejected.`);
} catch (error) {
  evidence.outcome = "failed"; evidence.error = error.message;
  await snapshot("completion-failure");
  throw error;
} finally {
  await writeFile(new URL("match-completion.json", results), JSON.stringify(evidence, null, 2));
  await browser.close();
}
