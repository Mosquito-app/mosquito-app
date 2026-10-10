---
name: Match timeout and sudden-death rules
description: Product rules and upgrade decisions for the 8-minute match clock and escrow settlement.
---

New matches have a strict 8-minute global clock, replacing the former 14-minute duration. Ranking at expiry is tokens finished first, then total current step progress across all four tokens. Ordinary all-tokens-finished wins still end the match early.

**Why:** The user changed the duration to exactly eight minutes and previously specified “Tokens Home First -> Total Step Progress across all 4 tokens.” Capture bonuses physically advance tokens, so they are already included in current progress rather than a separate kills score.

**How to apply:** Keep the global deadline separate from the 30-second turn clock. Rolls, doubles, turn changes, reloads and reconnects must not restart the global clock. Start it when the second player joins, not while the host is waiting.

An exact tie at expiry enters “OVERTIME / DRAW BREAK”; it is not a draw, refund or randomly selected winner. Continue normal turns until the first movement changes the ranking, then end immediately and settle the 90/10 split—even if another die or a doubles bonus remains.

**Why:** The user's written comments explicitly replaced the form's conflicting random-winner selection with sudden-death overtime.

**How to apply:** Dice rolls and turn forfeitures alone do not break a tie. Evaluate the existing board before admitting a late action; if it is already unequal at the deadline, do not let a late move change the winner. Close the room and credit both ledgers in one locked transaction.

Rank current positions, not lifetime rolled steps: base scores zero, the starting square scores one, and finish scores 58. Captures remove the captured cap's current progress.

**Why:** Releasing a cap must put it ahead of a cap still in base and can therefore break an overtime tie. Historical travel before a capture is not current board progress.

**How to apply:** Use the same server-computed scores for ranking and both clients' displays.

Legacy active rooms without a trustworthy start timestamp receive one persisted 8-minute grace window. Never infer their start from room creation, which may include waiting time, or repeatedly grant a fresh deadline on reads. Preserve deadlines already assigned to funded active rooms during duration upgrades; do not retroactively shorten or reset them.

**Why:** The previous engine did not record a global match start. Retroactive deadlines could arbitrarily settle existing funded rooms.

**How to apply:** Preserve existing positions, participants, stakes and financial history while initializing the missing timer once.
