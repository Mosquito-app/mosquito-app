import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire as qaRequire } from "node:module";
import { eq } from "drizzle-orm";
import { db, pool, usersTable, depositIntentsTable } from "@workspace/db";
import { hashPassword } from "../src/lib/ludo-auth";

// Recovery is limited to disposable accounts whose original checkout references
// and usernames are explicitly supplied. No balances or deposit rows are changed.
const targets = process.argv.slice(2).filter(arg => arg !== "--restore").map(arg => {
  const [username, reference] = arg.split(":");
  assert.match(username, /^qa_[0-9a-f]{8}$/);
  assert.match(reference, /^ludo_[0-9a-f]+$/);
  return { username, reference };
});
assert.equal(targets.length, 2, "Supply the two original QA username:reference pairs.");
const restoring = process.argv.includes("--restore");
const { chromium } = qaRequire(`${process.cwd()}/package.json`)("playwright-core");
const base = `https://${process.env.REPLIT_DEV_DOMAIN}`;
const privateDir = `${process.cwd()}/../../.local/browser-qa`;
const browser = restoring ? await chromium.launch({
  executablePath: "/repl/tools/bin/chromium", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
}) : null;
const players = [];
try {
  for (const [index, target] of targets.entries()) {
    const [intent] = await db.select({
      userId: depositIntentsTable.userId, status: depositIntentsTable.status,
      amountKobo: depositIntentsTable.amountKobo,
    }).from(depositIntentsTable).where(eq(depositIntentsTable.reference, target.reference));
    assert.ok(intent, "Original QA deposit intent must exist");
    assert.equal(intent.amountKobo, 200000);
    const [user] = await db.select({
      id: usersTable.id, username: usersTable.username, email: usersTable.email,
      balanceKobo: usersTable.balanceKobo,
    }).from(usersTable).where(eq(usersTable.id, intent.userId));
    assert.ok(user); assert.equal(user.username, target.username);
    assert.equal(user.email, `${target.username}@example.com`);
    console.log(`Player ${index + 1}: original QA account found; deposit ${intent.status}; balance ₦${user.balanceKobo / 100}`);
    if (!browser) continue;
    const password = randomUUID();
    const salt = randomBytes(16).toString("hex");
    await db.update(usersTable).set({
      passwordSalt: salt, passwordHash: await hashPassword(password, salt),
    }).where(eq(usersTable.id, user.id));
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`${base}/login`);
    await page.getByTestId("input-email").fill(user.email);
    await page.getByTestId("input-password").fill(password);
    const login = page.waitForResponse(r => r.url().endsWith("/api/auth/login") && r.request().method() === "POST");
    await page.getByTestId("button-login").click();
    assert.equal((await login).status(), 200);
    await page.waitForURL(`${base}/`);
    await page.getByTestId("text-wallet-balance").waitFor();
    players.push({ id: user.id, username: user.username, reference: target.reference, storage: await context.storageState() });
    console.log(`PASS Player ${index + 1} signed in through the normal login screen`);
  }
  if (browser) {
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    await writeFile(`${privateDir}/state.json`, JSON.stringify({ players, evidence: [], outcome: "awaiting-verification" }), { mode: 0o600 });
    console.log("Original QA sessions restored privately; no financial records changed.");
  }
} finally {
  await browser?.close(); await pool.end();
}
