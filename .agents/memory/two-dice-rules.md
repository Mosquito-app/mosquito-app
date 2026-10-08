---
name: Two-dice rule interpretation
description: Non-obvious home-entry and upgrade decisions for the requested Uncle Joe two-dice game.
---

A six spent on leaving home places the cap on its starting square. If both dice are combined for entry, the second die advances it from that square. Thus 6+3 enters then advances 3, not 9; 1+5 cannot enter.

**Why:** The user requires an actual rolled six for entry. Consuming that six preserves the original starting-square rule and makes combined entry consistent with using the dice sequentially.

**How to apply:** Keep single-die entry, combined entry, client token highlighting and server validation consistent.

Doubles, not a lone six, earn a bonus roll after movement is consumed. The consecutive-doubles streak belongs to the continuous bonus-turn chain and resets on a non-double, timeout or third-double forfeiture.

**Why:** The requested replacement rules specifically grant doubles bonuses and third-consecutive-double forfeiture, replacing the former single-six bonus.

**How to apply:** Do not retain the old six-only bonus when extending two-dice gameplay.

Rule upgrades must preserve saved token positions, room ownership and stakes. A legacy single-die roll may be cleared so the player rolls a fresh pair; never recreate a paid room or discard its escrow to change rule versions.

**Why:** Existing completed and funded rooms must remain accessible after the dice response shape changes.

**How to apply:** Normalize old board JSON at the server boundary without modifying financial history.
