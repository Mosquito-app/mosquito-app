import assert from "node:assert/strict";
import { advanceFootball, HALF_MS, ADDED_MS, BREAK_MS, FIRST_HALF_END_MS, SECOND_HALF_START_MS,
  initialFootballState, normalizeFootballState, REGULATION_MS, startFootball } from "../src/lib/football-physics";

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
  assert.equal(REGULATION_MS, 360000);
  assert.equal(s.halfDurationMs, 180000);
  assert.equal(s.addedTimeMs, 0); assert.equal(s.halftimeBreakMs, 0);
  advanceFootball(s, {}, T + HALF_MS);
  assert.equal(s.phase, "second_half"); assert.equal(s.homeDirection, 1);
  assert.equal(s.phaseRemainingMs, HALF_MS);
  assert.equal(s.remainingMs, HALF_MS); assert.equal(s.ball.ownerId, "away-9");
});
check(() => {
  // Already-funded version-2 rooms keep the schedule both players accepted.
  const s = fresh();
  s.timingVersion = 2;
  for (const key of ["halfDurationMs", "addedTimeMs", "halftimeBreakMs"] as const) delete (s as any)[key];
  normalizeFootballState(s);
  assert.equal(s.halfDurationMs, 240000);
  assert.equal(s.addedTimeMs, 60000); assert.equal(s.halftimeBreakMs, 40000);
  advanceFootball(s, {}, T + 240000);
  assert.equal(s.phase, "first_added"); assert.equal(s.phaseRemainingMs, 60000);
  const positions = JSON.stringify(s.players.map(p => [p.x, p.y]));
  advanceFootball(s, { home: { moveX: 1, moveY: 1, action: "shoot" } }, T + 300000);
  assert.equal(s.phase, "halftime"); assert.equal(s.phaseRemainingMs, 40000);
  assert.equal(JSON.stringify(s.players.map(p => [p.x, p.y])), positions, "Halftime must freeze play.");
  advanceFootball(s, {}, T + 340000);
  assert.equal(s.phase, "second_half"); assert.equal(s.homeDirection, 1);
  assert.equal(s.remainingMs, 300000); assert.equal(s.ball.ownerId, "away-9");
  advanceFootball(s, {}, T + 580000);
  assert.equal(s.phase, "second_added"); assert.equal(s.phaseRemainingMs, 60000);
});
check(() => {
  const s = fresh();
  advanceFootball(s, { home: { moveX: 1, moveY: 0 } }, T + 33);
  const p = s.players.find(p => p.id === s.controlledHome)!;
  assert.equal(p.animation, "run"); assert.equal(p.facing, Math.PI / 2);
  advanceFootball(s, { home: { moveX: 0, moveY: 0, action: "shoot" } }, T + 66);
  assert.equal(p.animation, "kick"); assert.ok(p.animationUntil > T + 66);
  assert.ok(s.ball.z > 0.22 && s.ball.vz > 0, "Shots have server-generated elevation and velocity.");
  advanceFootball(s, { away: { moveX: 0, moveY: 0, action: "tackle" } }, T + 99);
  assert.equal(s.players.find(p => p.id === s.controlledAway)!.animation, "slide");
});
check(() => {
  const s = fresh();
  s.ball = { x: 34, y: 0.1, z: 4, vx: 0, vy: -38, vz: 0, ownerId: null };
  advanceFootball(s, {}, T + 33);
  assert.equal(s.scoreHome, 0, "Shots over the crossbar must not score.");
  assert.ok(s.ball.vy > 0);
});
check(() => {
  const s = fresh();
  s.ball = { x: 34, y: 9, z: 1.2, vx: 0, vy: -30, vz: 0, ownerId: null };
  s.ballFreeAt = T + 5000;
  advanceFootball(s, {}, T + 33);
  const keeper = s.players.find(p => p.id === "away-1")!;
  assert.equal(keeper.animation, "dive"); assert.ok(keeper.animationUntil > T + 33);
});
check(() => {
  const s = fresh();
  for (const key of ["timingVersion", "halfDurationMs", "addedTimeMs", "halftimeBreakMs", "phaseRemainingMs"] as const) delete (s as any)[key];
  normalizeFootballState(s);
  assert.equal(s.timingVersion, 1);
  advanceFootball(s, {}, T + 180000);
  assert.equal(s.phase, "second_half");
  s.scoreAway = 1;
  advanceFootball(s, {}, T + 360000);
  assert.equal(s.phase, "finished"); assert.equal(s.winnerTeam, "away", "Legacy funded matches keep their original deadline.");
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
    assert.ok(Number.isFinite(s.ball.x) && Number.isFinite(s.ball.y) && Number.isFinite(s.ball.z) && Number.isFinite(s.ball.vz));
    assert.ok(s.ball.z >= 0.22);
  }
});
console.log(`PASS ${checks} football engine scenarios, including 3,000 bounded physics frames.`);
