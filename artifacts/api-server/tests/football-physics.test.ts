import assert from "node:assert/strict";
import { advanceFootball, HALF_MS, initialFootballState, REGULATION_MS, startFootball } from "../src/lib/football-physics";

const T = 2_000_000;
const fresh = () => { const s = initialFootballState(T); startFootball(s, T); s.pauseUntil = 0; return s; };
let checks = 0;
function check(test: () => void) { test(); checks++; }
check(() => {
  const s = fresh();
  assert.equal(s.players.length, 22);
  assert.equal(s.players.filter(p => p.team === "home").length, 11);
  assert.equal(s.players.filter(p => p.team === "away").length, 11);
  assert.equal(new Set(s.players.map(p => p.id)).size, 22);
  for (const team of ["home", "away"]) assert.equal(s.players.filter(p => p.team === team && p.role === "GK").length, 1);
});
check(() => {
  const s = fresh(), p = s.players.find(p => p.id === s.controlledHome)!;
  const before = { x: p.x, y: p.y };
  advanceFootball(s, { home: { moveX: 1, moveY: 1 } }, T + 33);
  assert.ok(Math.hypot(p.x - before.x, p.y - before.y) <= 7.2 * 0.033 + 0.00001);
  assert.equal(s.ball.ownerId, p.id);
  assert.equal(s.ball.x, p.x);
});
check(() => {
  const s = fresh();
  advanceFootball(s, { away: { moveX: 0, moveY: 0, action: "shoot" } }, T + 33);
  assert.equal(s.ball.ownerId, "home-9", "Opponent cannot shoot someone else's ball.");
  advanceFootball(s, { home: { moveX: 0, moveY: 0, action: "pass" } }, T + 66);
  assert.equal(s.ball.ownerId, null);
  assert.notEqual(s.controlledHome, "home-9");
  assert.ok(Math.hypot(s.ball.vx, s.ball.vy) > 20);
});
check(() => {
  const s = fresh();
  const defender = s.players.find(p => p.id === s.controlledAway)!;
  defender.x = 35; defender.y = 52.5;
  advanceFootball(s, { away: { moveX: 0, moveY: 0, action: "tackle" } }, T + 33);
  assert.equal(s.ball.ownerId, defender.id);
  assert.match(s.lastEvent, /TACKLE/);
});
check(() => {
  const s = fresh();
  advanceFootball(s, { home: { moveX: 0, moveY: 0, action: "switch" } }, T + 33);
  assert.notEqual(s.controlledHome, "home-9");
});
check(() => {
  const s = fresh();
  advanceFootball(s, {}, T + HALF_MS);
  assert.equal(s.phase, "second_half"); assert.equal(s.homeDirection, 1);
  assert.equal(s.remainingMs, HALF_MS); assert.equal(s.ball.ownerId, "away-9");
  assert.match(s.lastEvent, /HALF TIME/);
});
check(() => {
  const s = fresh(); s.scoreHome = 2; s.scoreAway = 1;
  s.ball = { x: 34, y: 104.9, vx: 0, vy: 38, ownerId: null };
  advanceFootball(s, {}, T + REGULATION_MS);
  assert.equal(s.phase, "finished"); assert.equal(s.winnerTeam, "home");
  assert.equal(s.scoreAway, 1, "Late physics cannot reverse full-time result.");
});
check(() => {
  const s = fresh();
  advanceFootball(s, {}, T + REGULATION_MS);
  assert.equal(s.phase, "overtime"); assert.equal(s.remainingMs, 0);
  assert.equal(s.winnerTeam, null);
  const now = T + REGULATION_MS + 3000;
  s.pauseUntil = 0; s.lastTickAt = now - 33;
  s.ball = { x: 34, y: 0.1, vx: 0, vy: -38, ownerId: null };
  advanceFootball(s, {}, now);
  assert.equal(s.phase, "finished"); assert.equal(s.scoreHome, 1); assert.equal(s.winnerTeam, "home");
  advanceFootball(s, { away: { moveX: 0, moveY: 0, action: "shoot" } }, now + 33);
  assert.equal(s.scoreHome, 1, "Golden goal ends immediately and cannot score again.");
});
check(() => {
  const s = fresh(); s.homeDirection = 1; s.ball = { x: 34, y: 0.1, vx: 0, vy: -38, ownerId: null };
  advanceFootball(s, {}, T + 33);
  assert.equal(s.scoreAway, 1, "Goal scorer follows swapped ends.");
});
check(() => {
  const s = fresh(); s.ball = { x: 4, y: 0.1, vx: 0, vy: -38, ownerId: null };
  advanceFootball(s, {}, T + 33);
  assert.equal(s.scoreHome, 0); assert.ok(s.ball.vy > 0);
});
check(() => {
  const s = fresh();
  for (let i = 1; i <= 3000; i++) {
    advanceFootball(s, { home: { moveX: Math.sin(i), moveY: Math.cos(i),
      ...(i % 25 === 0 ? { action: (i % 50 ? "pass" : "shoot") as "pass" | "shoot" } : {}) } }, T + i * 33);
    for (const p of s.players) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
      assert.ok(p.x >= 1 && p.x <= 67 && p.y >= 1 && p.y <= 104);
    }
    assert.ok(Number.isFinite(s.ball.x) && Number.isFinite(s.ball.y));
  }
});
console.log(`PASS ${checks} football engine scenarios, including 3,000 bounded physics frames.`);
