---
name: Two-dice rule interpretation
description: Non-obvious home-entry and upgrade decisions for the requested Uncle Joe two-dice game.
---

A pawn may leave base only on a full roll of 6–6 or 6–1 (either order), consuming an unused six. A six spent on leaving home places the cap on its starting square. If both dice are combined for entry, the second die advances it from that square. Thus 6+1 enters then advances 1 and 6+6 enters then advances 6; 6+2 through 6+5 and 1+5 cannot enter.

**Why:** The user explicitly narrowed Uncle Joe base-entry rolls to 6–6 or 6–1. Consuming the six preserves the starting-square rule and makes combined entry consistent with using the dice sequentially.

**How to apply:** Keep single-die entry, combined entry, client token highlighting and server validation consistent.

Doubles and captures earn a bonus roll after movement is consumed; a lone six does not. The consecutive-doubles streak belongs to the continuous bonus-turn chain and resets on a non-double, timeout or third-double forfeiture.

**Why:** The user requires doubles bonuses and a capture bonus roll, replacing the former single-six bonus. The existing three-consecutive-double forfeiture remains unless explicitly changed.

**How to apply:** Do not retain the old six-only bonus when extending two-dice gameplay.

An unsafe-square capture returns opposing caps to base and advances the capturing cap another ten spaces, stopping at finish. It earns a bonus roll after the current dice are consumed; a simultaneous double and capture grant one bonus roll, not two.

**Why:** The user explicitly chose physical ten-space advancement, capped at finish, rather than timeout-ranking points.

**How to apply:** Keep bonuses server-owned, carry the capture entitlement across a split roll, and clear it on the next roll or turn timeout. Current-position ranking automatically includes the bonus movement.

Visible dice faces must be real selections with a clear selected state, not inert controls that look selectable.

**Why:** A mistaken single-die selection can silently leave the summed move selected, changing the landing square, capture result and turn ownership in a wagered match.

**How to apply:** Verify the selected dice sent to the server, not just the displayed face values, when testing split movements and captures.

Rule upgrades must preserve saved token positions, room ownership and stakes. A legacy single-die roll may be cleared so the player rolls a fresh pair; never recreate a paid room or discard its escrow to change rule versions.

**Why:** Existing completed and funded rooms must remain accessible after the dice response shape changes.

**How to apply:** Normalize old board JSON at the server boundary without modifying financial history.
