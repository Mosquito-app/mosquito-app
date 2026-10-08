import type { FootballPlayer, FootballState, FootballTeam } from "@workspace/db";

export const PITCH = { width: 68, length: 105, goalWidth: 18 };
export const HALF_MS = 180_000;
export const REGULATION_MS = HALF_MS * 2;
export type FootballInput = { moveX: number; moveY: number; action?: "pass" | "shoot" | "tackle" | "switch" };
export type FootballInputs = Partial<Record<FootballTeam, FootballInput>>;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const distance = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const other = (team: FootballTeam): FootballTeam => team === "home" ? "away" : "home";
export const direction = (s: FootballState, team: FootballTeam) => team === "home" ? s.homeDirection : -s.homeDirection;
const control = (s: FootballState, team: FootballTeam) => team === "home" ? s.controlledHome : s.controlledAway;
const setControl = (s: FootballState, team: FootballTeam, id: string) => { if (team === "home") s.controlledHome = id; else s.controlledAway = id; };
const formation = [
  [34, 6, "GK"], [10, 23, "DEF"], [26, 21, "DEF"], [42, 21, "DEF"], [58, 23, "DEF"],
  [15, 39, "MID"], [34, 36, "MID"], [53, 39, "MID"],
  [34, 48, "FWD"], [14, 47, "FWD"], [54, 47, "FWD"],
] as const;

function resetFormation(s: FootballState) {
  for (const p of s.players) {
    const [x, y] = formation[p.number - 1];
    p.x = x; p.y = direction(s, p.team) === -1 ? 105 - y : y;
  }
}
export function kickoff(s: FootballState, team: FootballTeam, now: number, pauseMs = 2500) {
  resetFormation(s);
  const kicker = s.players.find(p => p.team === team && p.number === 9)!;
  kicker.x = 34; kicker.y = 52.5;
  s.ball = { x: 34, y: 52.5, vx: 0, vy: 0, ownerId: kicker.id };
  s.controlledHome = "home-9"; s.controlledAway = "away-9";
  s.pauseUntil = now + pauseMs; s.lastTouchId = kicker.id; s.ballFreeAt = now;
}
export function initialFootballState(now = Date.now()): FootballState {
  const s: FootballState = {
    players: (["home", "away"] as const).flatMap(team => formation.map(([, , role], n) => ({
      id: `${team}-${n + 1}`, team, number: n + 1, role, x: 0, y: 0,
    }))),
    ball: { x: 34, y: 52.5, vx: 0, vy: 0, ownerId: null },
    scoreHome: 0, scoreAway: 0, controlledHome: "home-9", controlledAway: "away-9",
    phase: "waiting", homeDirection: -1, startedAt: null, serverTimeAt: new Date(now).toISOString(),
    elapsedMs: 0, remainingMs: REGULATION_MS, lastTickAt: now, pauseUntil: now,
    ballFreeAt: now, lastTouchId: null, lastActionHomeAt: 0, lastActionAwayAt: 0,
    lastEvent: "Waiting for a second player. Stakes lock only at kickoff.", sequence: 0, winnerTeam: null,
  };
  resetFormation(s);
  return s;
}
export function startFootball(s: FootballState, now = Date.now()) {
  s.phase = "first_half"; s.startedAt = new Date(now).toISOString(); s.lastTickAt = now;
  s.lastEvent = "KICKOFF · First half"; kickoff(s, "home", now);
}
function finish(s: FootballState, winner: FootballTeam, event: string) {
  s.phase = "finished"; s.winnerTeam = winner; s.lastEvent = event;
  s.ball.vx = 0; s.ball.vy = 0;
}

/** Clock is checked BEFORE inputs/physics, so a late shot cannot reverse a
 * full-time result. Overtime has no arbitrary timeout or random winner. */
export function updateFootballClock(s: FootballState, now: number) {
  s.serverTimeAt = new Date(now).toISOString();
  if (!s.startedAt || s.phase === "waiting" || s.phase === "finished") return;
  s.elapsedMs = Math.max(0, now - Date.parse(s.startedAt));
  s.remainingMs = Math.max(0, REGULATION_MS - s.elapsedMs);
  if (s.elapsedMs >= REGULATION_MS && s.phase !== "overtime") {
    if (s.scoreHome !== s.scoreAway) {
      finish(s, s.scoreHome > s.scoreAway ? "home" : "away", "FULL TIME · Mosquito Wallet settlement");
    } else {
      s.phase = "overtime"; s.lastEvent = "GOLDEN GOAL · Next goal wins";
      kickoff(s, "home", now);
    }
  } else if (s.elapsedMs >= HALF_MS && s.phase === "first_half") {
    s.phase = "second_half"; s.homeDirection = 1;
    s.lastEvent = "HALF TIME · Ends switched · Second half";
    kickoff(s, "away", now);
  }
}
function moveToward(p: FootballPlayer, x: number, y: number, speed: number, dt: number) {
  const dx = x - p.x, dy = y - p.y, len = Math.hypot(dx, dy);
  if (len < 0.05) return;
  const step = Math.min(len, speed * dt);
  p.x = clamp(p.x + dx / len * step, 1, 67);
  p.y = clamp(p.y + dy / len * step, 1, 104);
}
function kick(s: FootballState, p: FootballPlayer, x: number, y: number, speed: number, now: number) {
  const dx = x - p.x, dy = y - p.y, len = Math.max(0.01, Math.hypot(dx, dy));
  s.ball.ownerId = null; s.ball.x = p.x; s.ball.y = p.y;
  s.ball.vx = dx / len * speed; s.ball.vy = dy / len * speed;
  s.lastTouchId = p.id; s.ballFreeAt = now + 240;
}
function pass(s: FootballState, p: FootballPlayer, now: number, input?: FootballInput) {
  const dir = direction(s, p.team);
  const candidates = s.players.filter(t => t.team === p.team && t.id !== p.id && t.role !== "GK");
  candidates.sort((a, b) => {
    const rate = (t: FootballPlayer) => distance(t, p) +
      ((t.y - p.y) * dir > -3 ? 0 : 28) -
      (input ? ((t.x - p.x) * input.moveX + (t.y - p.y) * input.moveY) * 0.8 : 0);
    return rate(a) - rate(b);
  });
  const target = candidates[0];
  if (target) { kick(s, p, target.x, target.y, 24, now); setControl(s, p.team, target.id); s.lastEvent = "PASS"; }
}
function shoot(s: FootballState, p: FootballPlayer, now: number, aimX: number) {
  kick(s, p, 34 + clamp(aimX, -1, 1) * 7.5, direction(s, p.team) === -1 ? -2 : 107, 38, now);
  s.lastEvent = "SHOT ON GOAL";
}
function action(s: FootballState, team: FootballTeam, input: FootballInput, now: number) {
  if (!input.action) return;
  const last = team === "home" ? s.lastActionHomeAt : s.lastActionAwayAt;
  if (now - last < 380) return;
  if (team === "home") s.lastActionHomeAt = now; else s.lastActionAwayAt = now;
  const p = s.players.find(p => p.id === control(s, team))!;
  if (input.action === "switch") {
    const owner = s.players.find(t => t.id === s.ball.ownerId && t.team === team);
    const teammates = s.players.filter(t => t.team === team && t.role !== "GK");
    teammates.sort((a, b) => distance(a, s.ball) - distance(b, s.ball));
    const nearest = owner && owner.id !== p.id ? owner : teammates.find(t => t.id !== p.id);
    if (nearest) setControl(s, team, nearest.id);
    return;
  }
  if (input.action === "tackle") {
    const victim = s.players.find(t => t.id === s.ball.ownerId && t.team !== team);
    if (victim && distance(p, victim) <= 3.4) {
      s.ball.ownerId = p.id; s.lastTouchId = p.id; s.lastEvent = "SLIDE TACKLE · Possession won";
    } else moveToward(p, p.x + input.moveX * 2, p.y + input.moveY * 2, 10, 0.14);
    return;
  }
  if (s.ball.ownerId !== p.id) return;
  if (input.action === "pass") pass(s, p, now, input);
  else shoot(s, p, now, input.moveX);
}
function runTeamAI(s: FootballState, dt: number, now: number) {
  const owner = s.players.find(p => p.id === s.ball.ownerId);
  for (const team of ["home", "away"] as const) {
    const dir = direction(s, team);
    const teammates = s.players.filter(p => p.team === team);
    const chasing = teammates.filter(p => p.role !== "GK" && p.id !== control(s, team))
      .sort((a, b) => distance(a, s.ball) - distance(b, s.ball)).slice(0, 2).map(p => p.id);
    for (const p of teammates) {
      if (p.id === control(s, team)) continue;
      if (p.role === "GK") {
        moveToward(p, clamp(s.ball.x, 26, 42), dir === -1 ? 102 : 3, 6.2, dt);
      } else if (owner?.id === p.id) {
        moveToward(p, clamp(p.x + (p.x > 34 ? -1 : 1), 15, 53), dir === -1 ? 6 : 99, 5.5, dt);
        const goalDistance = dir === -1 ? p.y : 105 - p.y;
        if (now >= s.ballFreeAt && goalDistance < 23) {
          shoot(s, p, now, p.x < 34 ? -0.72 : 0.72);
          s.ballFreeAt = now + 300;
        }
      } else if (!owner || owner.team !== team) {
        if (chasing.includes(p.id)) {
          moveToward(p, s.ball.x, s.ball.y, 6.0, dt);
          if (owner && owner.team !== team && distance(p, owner) < 1.0 && now >= s.ballFreeAt) {
            s.ball.ownerId = p.id; s.lastTouchId = p.id; s.ballFreeAt = now + 650;
          }
        } else {
          const [x, y] = formation[p.number - 1];
          const baseY = dir === -1 ? 105 - y : y;
          moveToward(p, x, clamp(baseY + (s.ball.y - 52.5) * 0.28, 7, 98), 3.7, dt);
        }
      } else {
        const [x, y] = formation[p.number - 1];
        const baseY = dir === -1 ? 105 - y : y;
        moveToward(p, x + (s.ball.x - 34) * 0.15,
          clamp(baseY + dir * 18 + (s.ball.y - 52.5) * 0.20, 5, 100), 4.6, dt);
      }
    }
  }
}
function ballPhysics(s: FootballState, dt: number, now: number) {
  const owner = s.players.find(p => p.id === s.ball.ownerId);
  if (owner) { s.ball.x = owner.x; s.ball.y = owner.y; s.ball.vx = 0; s.ball.vy = 0; return; }
  const oldX = s.ball.x, oldY = s.ball.y;
  s.ball.x += s.ball.vx * dt; s.ball.y += s.ball.vy * dt;
  // Continuous goal-line intersection, not client coordinates or endpoints.
  if (s.ball.y < 0 || s.ball.y > 105) {
    const line = s.ball.y < 0 ? 0 : 105;
    const t = (line - oldY) / (s.ball.y - oldY);
    const crossingX = oldX + (s.ball.x - oldX) * clamp(t, 0, 1);
    if (Math.abs(crossingX - 34) <= PITCH.goalWidth / 2) {
      const scoring: FootballTeam = (line === 0 ? -1 : 1) === s.homeDirection ? "home" : "away";
      if (scoring === "home") s.scoreHome++; else s.scoreAway++;
      if (s.phase === "overtime") finish(s, scoring, "GOLDEN GOAL · Mosquito Wallet settlement");
      else { s.lastEvent = `GOAL · ${scoring === "home" ? "Home" : "Away"} scores`; kickoff(s, other(scoring), now); }
      return;
    }
    s.ball.y = clamp(s.ball.y, 0.1, 104.9); s.ball.vy *= -0.65;
  }
  if (s.ball.x < 0 || s.ball.x > 68) { s.ball.x = clamp(s.ball.x, 0.1, 67.9); s.ball.vx *= -0.65; }
  // Arcade rebound sidelines replace stoppages; no offsides or foul simulation.
  const drag = Math.exp(-0.50 * dt);
  s.ball.vx *= drag; s.ball.vy *= drag;
  if (now < s.ballFreeAt) return;
  const receivers = s.players.filter(p => distance(p, s.ball) < (p.role === "GK" ? 1.8 : 1.35));
  receivers.sort((a, b) => distance(a, s.ball) - distance(b, s.ball));
  if (receivers[0]) {
    const p = receivers[0]; s.ball.ownerId = p.id; s.lastTouchId = p.id;
    s.ballFreeAt = now + 350;
    if (p.role !== "GK") setControl(s, p.team, p.id);
    else { pass(s, p, now); s.ballFreeAt = now + 300; }
  }
}

/** Only the server calls this. Clients submit directions/actions, never state. */
export function advanceFootball(s: FootballState, inputs: FootballInputs, now = Date.now()) {
  const dt = clamp((now - s.lastTickAt) / 1000, 0, 0.10);
  updateFootballClock(s, now); s.lastTickAt = now; s.sequence++;
  if (s.phase === "waiting" || s.phase === "finished" || now < s.pauseUntil) return;
  for (const team of ["home", "away"] as const) {
    const input = inputs[team];
    if (!input) continue;
    const p = s.players.find(p => p.id === control(s, team))!;
    const norm = Math.max(1, Math.hypot(input.moveX, input.moveY));
    moveToward(p, p.x + input.moveX / norm, p.y + input.moveY / norm, 7.2, dt);
    action(s, team, input, now);
  }
  runTeamAI(s, dt, now);
  ballPhysics(s, dt, now);
}
