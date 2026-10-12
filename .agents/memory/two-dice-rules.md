---
name: Two-dice rule interpretation
description: Non-obvious home-entry and upgrade decisions for the requested Uncle Joe two-dice game.
---

A pawn may leave base only by using a six from the current two-die roll. Any pair containing a six is valid; the six is consumed to enter on the starting square, and selecting both dice advances the pawn by the other die's value. Pairs without a six cannot release a pawn.

**Why:** The user confirmed any rolled six may release a pawn, while no non-six roll can. This supersedes the older 6–6 / 6–1 restriction.

**How to apply:** Keep single-die entry, combined entry, client token highlighting and server validation consistent.

Only an exact 6-6 earns a bonus roll after both dice are used. At most three consecutive 6-6 rolls are allowed in one turn; after the third, pass the turn without undoing any moves. All other rolls, including 6 plus a non-6 and non-6 doubles, pass after their legal dice are used.

**Why:** The user explicitly selected double-6-only bonuses capped at three consecutive rolls and rejected third-double forfeiture of completed moves.

**How to apply:** Count consecutive server-generated 6-6 pairs, grant repeat rolls only before the third, and never roll back token movements.

Capture only on an unprotected shared-track square. Every color's starting square and the star squares are protected; caps in base, private home lanes, and finished home are never capturable. On an eligible capture, return the rival cap to base and immediately mark the capturing cap as home. Do not add +10 movement or a capture-specific bonus roll. If this makes all four caps home, finish and settle the match immediately. Protection must use canonical engine coordinates, not the UI's rotated or recolored seats.

**Why:** The user explicitly corrected the old +10 rule and reported asymmetric capture behavior: the capturing pawn counts as home, the captured pawn returns to base, and a cap in its own house must not be captured. Display colors are presentation-only.

**How to apply:** Resolve captures server-side on unprotected shared-track squares in canonical coordinates; keep opponent resets, home counts, timeout ranking, victory detection and escrow settlement consistent across every color pairing.

Ordinary token movement should animate one square at a time. A capture-to-home is an immediate finish state, not a full-lap animation.

**Why:** The user requires the captured rival to reset and the capturing pawn to count home immediately.

**How to apply:** Animate normal server-authoritative movement along the track, but place capture-finished pawns directly in the home area.

Visible dice faces must be real selections with a clear selected state, not inert controls that look selectable.

**Why:** A mistaken single-die selection can silently leave the summed move selected, changing the landing square, capture result and turn ownership in a wagered match.

**How to apply:** Verify the selected dice sent to the server, not just the displayed face values, when testing split movements and captures.

Rule upgrades must preserve saved token positions, room ownership and stakes. A legacy single-die roll may be cleared so the player rolls a fresh pair; never recreate a paid room or discard its escrow to change rule versions.

**Why:** Existing completed and funded rooms must remain accessible after the dice response shape changes.

**How to apply:** Normalize old board JSON at the server boundary without modifying financial history.
