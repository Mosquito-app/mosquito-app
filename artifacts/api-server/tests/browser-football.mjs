import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const base = process.argv[2];
const browserServer = await chromium.launchServer({ executablePath: "/repl/tools/bin/chromium", headless: true,
  args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const browser = await chromium.connect(browserServer.wsEndpoint());
const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const home = await desktop.newPage(), away = await mobile.newPage();
const frames = [new Map(), new Map()], inputs = [[], []], errors = [];
for (const [i, page] of [home, away].entries()) {
  page.on("pageerror", e => errors.push(e.message));
  page.on("websocket", ws => {
    ws.on("framereceived", ({ payload }) => {
      try { const msg = JSON.parse(String(payload)); if (msg.type === "football.snapshot") frames[i].set(msg.room.state.sequence, msg.room.state); } catch {}
    });
    ws.on("framesent", ({ payload }) => {
      try { const msg = JSON.parse(String(payload)); if (msg.type === "football.input") inputs[i].push(msg); } catch {}
    });
  });
}
async function login(page, team) {
  await page.goto(`${base}/login`);
  await page.getByTestId("input-email").fill(`football_browser_${team}@example.test`);
  await page.getByTestId("input-password").fill("football-qa-fixture-only");
  await page.getByTestId("button-login").click();
  await page.getByTestId("card-game-11v11-football-duel").waitFor();
}
async function state(page, roomId) {
  return (await api(page, `/api/football/rooms/${roomId}`)).state;
}
async function api(page, path) {
  // Use the browser's actual cookie behavior, as the app does. Chromium permits
  // secure localhost cookies; APIRequestContext has a different HTTP policy.
  const result = await page.evaluate(async path => {
    const r = await fetch(path, { credentials: "same-origin" });
    return { status: r.status, data: await r.json() };
  }, path);
  assert.equal(result.status, 200, `Browser API request failed: ${path}`);
  return result.data;
}
async function until(test, message, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error(message);
}
try {
  await Promise.all([login(home, "home"), login(away, "away")]);
  await until(async () => /2,000/.test(await home.getByTestId("text-wallet-balance").innerText()), "Initial wallet query did not load");
  await home.getByTestId("card-game-11v11-football-duel").click();
  await home.getByTestId("card-football-club-man_city").click();
  await home.getByTestId("button-stake-1000").click();
  await home.getByTestId("button-find-match").click();
  await home.getByTestId("panel-football-waiting").waitFor();
  const roomId = new URL(home.url()).pathname.split("/").at(-1);
  const prepare = async stage => {
    const fixture = await home.request.post(`${base}/__qa/prepare-stage`, { data: { roomId, stage } });
    assert.equal(fixture.status(), 200);
    const target = (await fixture.json()).sequence;
    await until(() => [...frames[0].keys()].some(k => k >= target) && [...frames[1].keys()].some(k => k >= target),
      "Isolated stage ownership handoff failed");
  };
  const waitingWallet = await api(home, "/api/wallet");
  assert.equal(waitingWallet.balanceNaira, 2000); assert.equal(waitingWallet.escrowedNaira, 0);
  // A signed-in friend can join from the invite, not only from the lobby.
  await away.goto(`${base}/football/${roomId}`);
  await away.getByTestId("card-football-invite-club-liverpool").click();
  await away.getByTestId("button-join-football-invite").click();
  await Promise.all([home.getByTestId("panel-football-score").waitFor(), away.getByTestId("panel-football-score").waitFor()]);
  await away.getByTestId("panel-football-gate").waitFor();
  assert.match(await away.getByTestId("panel-football-gate").innerText(), /Rotate to landscape/);
  assert.equal(await away.getByTestId("button-football-shoot").isDisabled(), true);
  await away.setViewportSize({ width: 844, height: 390 });
  await Promise.all([home.getByTestId("button-football-enter").click(), away.getByTestId("button-football-enter").click()]);
  await until(async () => await home.getByTestId("panel-football-gate").count() === 0 &&
    await away.getByTestId("panel-football-gate").count() === 0, "Landscape enter gate never cleared");
  await until(() => frames[0].size > 10 && frames[1].size > 10, "No real football frames on both sockets");
  const shared = [...frames[0].keys()].filter(k => frames[1].has(k));
  assert.ok(shared.length >= 3);
  for (const k of shared) assert.deepEqual(frames[0].get(k), frames[1].get(k), "Two screens received different authoritative state.");
  assert.equal((await state(home, roomId)).players.length, 22);
  const pitch = p => p.getByTestId("canvas-football-pitch").locator("canvas");
  await until(async () => (await pitch(home).getAttribute("data-player-count")) === "22" &&
    (await pitch(away).getAttribute("data-player-count")) === "22", "WebGL scene did not instantiate 22 models", 20000);
  assert.match(await pitch(home).evaluate(c => c.getContext("webgl2").getParameter(c.getContext("webgl2").VERSION)), /WebGL 2/);
  const clubs = await state(home, roomId);
  assert.equal(clubs.homeClub, "man_city"); assert.equal(clubs.awayClub, "liverpool");
  await until(async () => { const s = await state(home, roomId); return Date.parse(s.serverTimeAt) >= s.pauseUntil; }, "Kickoff pause never ended");
  const before = await state(home, roomId), selected = before.controlledHome;
  const p0 = before.players.find(p => p.id === selected);
  await home.keyboard.down("w"); await home.waitForTimeout(350); await home.keyboard.up("w");
  const moved = (await state(home, roomId)).players.find(p => p.id === selected);
  assert.ok(moved.y < p0.y - 0.5, "Keyboard did not move the server player.");
  // Actual mobile touch drag + release. Away view is rotated, so right means -x in world.
  await away.bringToFront();
  const joy = away.getByTestId("control-joystick");
  const bounds = await joy.boundingBox(); assert.ok(bounds);
  const viewHeight = await away.evaluate(() => innerHeight);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewHeight, "Touch joystick below viewport");
  const cdp = await mobile.newCDPSession(away);
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  const oldAway = await state(away, roomId), awayId = oldAway.controlledAway;
  const a0 = oldAway.players.find(p => p.id === awayId);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 1, x, y }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ id: 1, x: x + 42, y }] });
  await away.waitForTimeout(400);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const a1 = (await state(away, roomId)).players.find(p => p.id === awayId);
  assert.ok(a1.x < a0.x - 0.5, "Touch joystick did not move the server player.");
  await away.waitForTimeout(400);
  const a2 = (await state(away, roomId)).players.find(p => p.id === awayId);
  assert.ok(Math.abs(a2.x - a1.x) < 0.35, "Touch release left movement stuck.");
  await away.setViewportSize({ width: 390, height: 844 });
  await away.getByTestId("panel-football-gate").waitFor();
  assert.equal(await away.getByTestId("button-football-shoot").isDisabled(), true);
  await until(() => inputs[1].some(p => p.moveX === 0 && p.moveY === 0), "Portrait gate did not zero movement");
  await away.setViewportSize({ width: 844, height: 390 });
  if (await away.getByTestId("button-football-enter").count()) await away.getByTestId("button-football-enter").click();
  await until(async () => await away.getByTestId("panel-football-gate").count() === 0, "Landscape resume blocked");
  await prepare("pass");
  await home.bringToFront();
  await home.getByTestId("button-football-pass").click();
  await until(() => [...frames[0].values()].some(s => s.lastEvent === "PASS"), "Pass button did not reach server");
  const slide = await away.getByTestId("button-football-slide").boundingBox(); assert.ok(slide);
  await away.bringToFront();
  assert.equal(await away.evaluate(() => document.visibilityState), "visible");
  const beforeSwitch = await state(away, roomId), selectedAway = beforeSwitch.controlledAway;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ id: 2, x: slide.x + slide.width / 2, y: slide.y + slide.height / 2 }] });
  await away.waitForTimeout(550);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await until(() => inputs[1].some(p => p.action === "switch"), "Mobile hold did not send switch");
  await until(() => [...frames[1].values()].some(s => s.sequence > beforeSwitch.sequence && s.controlledAway !== selectedAway), "Mobile switch never changed the server-selected player");
  const shootBounds = await away.getByTestId("button-football-shoot").boundingBox();
  assert.ok(shootBounds && shootBounds.y + shootBounds.height <= await away.evaluate(() => innerHeight), "Mobile action buttons below viewport");
  assert.equal(await away.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mkdir("test-results", { recursive: true });
  await away.screenshot({ path: "test-results/football-mobile.png" });
  await home.screenshot({ path: "test-results/football-desktop.png", fullPage: true });
  assert.equal(clubs.halfDurationMs, 180000);
  assert.equal(clubs.addedTimeMs, 0); assert.equal(clubs.halftimeBreakMs, 0);
  await prepare("second_half");
  await until(async () => /2ND HALF/.test(await home.getByTestId("text-football-clock").innerText()), "Second-half clock did not update");
  assert.equal((await state(home, roomId)).homeDirection, 1);
  await prepare("dive");
  await away.bringToFront();
  await until(async () => (await pitch(away).getAttribute("data-animation-kinds") ?? "").includes("dive"), "Keeper dive pose did not render");
  await prepare("tackle");
  await away.getByTestId("button-football-slide").tap();
  await until(() => inputs[1].some(p => p.action === "tackle") &&
    [...frames[1].values()].some(s => s.players.some(p => p.animation === "slide")), "Slide animation did not originate on server");
  // Accelerate ONLY the isolated test room to a tied overtime goal opportunity.
  const fixture = await home.request.post(`${base}/__qa/prepare-golden`, { data: { roomId } });
  assert.equal(fixture.status(), 200);
  await Promise.all([home.getByTestId("text-football-golden").waitFor(), away.getByTestId("text-football-golden").waitFor()]);
  await home.getByTestId("button-football-shoot").click();
  await Promise.all([home.getByTestId("text-football-result").waitFor(), away.getByTestId("text-football-result").waitFor()]);
  assert.match(await home.getByTestId("text-football-result").innerText(), /1,800.*Mosquito Wallet/);
  assert.equal(await away.getByTestId("button-football-shoot").isDisabled(), true);
  await home.reload(); await home.getByTestId("text-football-result").waitFor();
  await home.getByTestId("button-football-lobby-done").click();
  await until(async () => /2,800/.test(await home.getByTestId("text-wallet-balance").innerText()), "Winner wallet did not refresh");
  assert.deepEqual(errors, []);
  await writeFile("test-results/football-browser.json", JSON.stringify({
    passed: true, syntheticStakes: true, sharedFrameCount: shared.length,
    checks: ["22 WebGL models", "WebGL2 context", "club selection cards", "free waiting room", "invite join", "synchronized snapshots", "keyboard movement", "mobile landscape touch and release", "portrait gating and landscape resume", "pass", "switch", "slide", "keeper dive", "six-minute clock and ends switched", "3D golden goal", "result persistence", "wallet refresh", "no horizontal overflow"],
    winnerPrizeNaira: 1800, commissionNaira: 200,
  }, null, 2));
  console.log("PASS desktop + actual mobile touch football QA, identical server frames, pass/switch/shoot, golden goal, result reload and wallet refresh.");
} catch (error) {
  await mkdir("test-results", { recursive: true });
  await Promise.all([home.screenshot({ path: "test-results/football-failure-desktop.png", fullPage: true }), away.screenshot({ path: "test-results/football-failure-mobile.png", fullPage: true })]);
  throw error;
} finally {
  // Bound SwiftShader teardown; kill only the browser this test owns.
  try { await Promise.race([browser.close(), new Promise(resolve => setTimeout(resolve, 5000))]); }
  finally { browserServer.process().kill("SIGKILL"); }
}
