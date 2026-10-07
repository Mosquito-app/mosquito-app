import { chromium } from "playwright-core";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const privateDir = new URL("../../../.local/browser-qa/", import.meta.url).pathname;
await mkdir(privateDir, { recursive: true, mode: 0o700 });
const stateFile = join(privateDir, "state.json");
const results = new URL("../test-results/", import.meta.url).pathname;
await mkdir(results, { recursive: true });
let state;
try { state = JSON.parse(await readFile(stateFile, "utf8")); }
catch {
  if (process.argv.includes("--continue-paid")) {
    throw new Error("The original QA sessions must be restored before verifying their payments.");
  }
  state = { players: [], evidence: [] };
}
const browser = await chromium.launch({
  executablePath: "/repl/tools/bin/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const contexts = [];
async function save() {
  for (let i = 0; i < contexts.length; i++) {
    if (state.players[i]) state.players[i].storage = await contexts[i].storageState();
  }
  await writeFile(stateFile, JSON.stringify(state), { mode: 0o600 });
  // Keep authentication cookies out of the shareable report.
  const { players, ...report } = state;
  await writeFile(join(results, "report.json"), JSON.stringify({
    ...report, players: players.map(({ storage, ...player }) => player),
  }, null, 2));
}
async function openPlayer(index) {
  const existing = state.players[index];
  const context = await browser.newContext({
    ignoreHTTPSErrors: true, viewport: { width: 1440, height: 960 },
    ...(existing?.storage ? { storageState: existing.storage } : {}),
  });
  contexts[index] = context;
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on("pageerror", err => console.log("Browser error:", err.message));
  if (!existing) {
    const username = `qa_${randomUUID().slice(0, 8)}`;
    await page.goto(`${base}/register`);
    await page.getByTestId("input-username").fill(username);
    await page.getByTestId("input-email").fill(`${username}@example.com`);
    await page.getByTestId("input-password").fill(randomUUID());
    const created = page.waitForResponse(r => r.url().endsWith("/api/auth/register") && r.request().method() === "POST");
    await page.getByTestId("button-register").click();
    const response = await created;
    assert.equal(response.status(), 201);
    const data = await response.json();
    state.players[index] = { id: data.user.id, username };
    console.log(`PASS Player ${index + 1} registered through browser`);
    await page.waitForURL(base + "/");
    await save();
  } else await page.goto(base + "/");
  await page.getByTestId("text-wallet-balance").waitFor();
  await page.screenshot({ path: join(results, `player-${index + 1}-lobby.png`), fullPage: true });
  return { context, page, player: state.players[index] };
}

async function inspect(page, label) {
  await page.screenshot({ path: join(results, `${label}.png`), fullPage: true });
  for (const frame of page.frames()) {
    console.log("Frame:", new URL(frame.url() || base).origin);
    console.log("Input metadata:", await frame.locator("input").evaluateAll(inputs => inputs.map(i => ({
      name: i.name, type: i.type, placeholder: i.placeholder, id: i.id,
    }))));
    console.log("Buttons:", await frame.locator("button").allTextContents());
    console.log("Page text:", (await frame.locator("body").innerText()).slice(0, 2500));
  }
}

async function deposit({ page, context, player }, index) {
  if (player.depositVerified) return true;
  const callback = [];
  page.on("response", async response => {
    if (response.url().endsWith("/api/deposits/verify")) {
      try { callback.push({ statusCode: response.status(), data: await response.json() }); } catch {}
    }
  });
  if (process.argv.includes("--continue-paid")) {
    assert.ok(player.reference, "A hosted test checkout reference is required.");
    const verification = page.waitForResponse(r => r.url().endsWith("/api/deposits/verify"));
    await page.goto(`${base}/?reference=${encodeURIComponent(player.reference)}`);
    const response = await verification;
    assert.equal(response.status(), 200);
    const data = await response.json();
    assert.equal(data.status, "success", "Complete the hosted test payment before continuing.");
    assert.equal(data.balanceNaira, 2000);
    await page.getByTestId("text-wallet-balance").filter({ hasText: "2,000" }).waitFor();
    const repeated = await context.request.post(`${base}/api/deposits/verify`, { data: { reference: player.reference } });
    assert.equal((await repeated.json()).balanceNaira, 2000);
    player.depositVerified = true;
    state.evidence.push({ player: index + 1, automaticVerify: data, repeatedVerifyBalance: 2000 });
    await page.screenshot({ path: join(results, `player-${index + 1}-funded.png`), fullPage: true });
    console.log(`PASS Player ${index + 1}: automatic callback verification and balance ₦2,000; repeat did not double-credit.`);
    return true;
  }
  if (!player.reference) {
    let initializedData;
    await page.route("**/api/deposits/initialize", async route => {
      // Forward the real request and read its response before the browser leaves
      // the origin. This does not stub or change the payment response.
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      initializedData = await response.json();
      player.reference = initializedData.reference;
      player.authorizationUrl = initializedData.authorizationUrl;
      await save();
      await route.fulfill({ response });
    });
    await page.getByTestId("button-deposit-open").click();
    await page.getByTestId("input-deposit-amount").fill("2000");
    const initialized = page.waitForResponse(r => r.url().endsWith("/api/deposits/initialize"));
    await page.getByTestId("button-deposit").click();
    await initialized;
    await page.waitForURL("https://checkout.paystack.com/**", { timeout: 45_000 });
  } else await page.goto(player.authorizationUrl);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(3500);
  if ((await page.locator("body").innerText()).includes("Performing security verification")) {
    try {
      await page.waitForFunction(() => !document.body.innerText.includes("Performing security verification"), { timeout: 30_000 });
    } catch { /* preserve evidence of the external verification blocker */ }
  }
  await inspect(page, `player-${index + 1}-checkout`);
  // The first run records the hosted form. Specific interactions follow once
  // its actual structure is known, instead of guessing a successful payment.
  state.outcome = "blocked";
  state.blocker = "Paystack hosted checkout shows Cloudflare security verification; test card entry is inaccessible to this automated browser.";
  if (process.argv.includes("--inspect-checkout")) return false;
  throw new Error(state.blocker);
}

try {
  const p1 = await openPlayer(0);
  const p2 = await openPlayer(1);
  const paid1 = await deposit(p1, 0);
  const paid2 = await deposit(p2, 1);
  if (paid1 && paid2) {
    const lobby = await p1.context.request.get(`${base}/api/lobby`);
    assert.ok(!(await lobby.json()).rooms.some(room => room.stakeNaira === 2000),
      "Do not join or alter another user's waiting ₦2,000 table.");
    await p1.page.getByTestId("button-stake-2000").click();
    const joined = p1.page.waitForResponse(r => r.url().endsWith("/api/rooms") && r.request().method() === "POST");
    await p1.page.getByTestId("button-find-match").click();
    const room = await (await joined).json();
    state.roomId = room.id;
    await p2.page.reload();
    await p2.page.getByTestId(`button-join-${room.id}`).click();
    await p2.page.waitForURL(`${base}/game/${room.id}`);
    const active = await p1.context.request.get(`${base}/api/rooms/${room.id}`);
    const data = await active.json();
    assert.equal(data.status, "active");
    assert.equal(data.hostUserId, p1.player.id);
    assert.equal(data.opponentUserId, p2.player.id);
    assert.equal(data.potNaira, 4000);
    for (const [index, seat] of [p1, p2].entries()) {
      await seat.page.waitForURL(`${base}/game/${room.id}`);
      const wallet = await seat.context.request.get(`${base}/api/wallet`);
      const w = await wallet.json();
      assert.equal(w.balanceNaira, 0); assert.equal(w.escrowedNaira, 2000);
      await seat.page.screenshot({ path: join(results, `player-${index + 1}-match.png`), fullPage: true });
    }
    state.outcome = "success";
    delete state.blocker;
    state.evidence.push({ roomId: room.id, status: data.status, potNaira: 4000 });
    console.log("PASS both independently funded players joined the same active ₦4,000 Ludo match");
  }
  await save();
} finally {
  await save();
  await browser.close();
}
