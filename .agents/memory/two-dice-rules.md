---
name: Two-dice rule interpretation
description: Non-obvious home-entry and upgrade decisions for the requested Uncle Joe two-dice game.
---

A pawn may leave base only by using a six from the current two-die roll. Any pair containing a six is valid; the six is consumed to enter on the starting square, and selecting both dice advances the pawn by the other die's value. Pairs without a six cannot release a pawn.

**Why:** The user's latest rule specifies that any six releases a pawn, while no non-six roll can. This supersedes the older 6–6 / 6–1 restriction.

**How to apply:** Keep single-die entry, combined entry, client token highlighting and server validation consistent.

After the current dice are fully used, a roll containing at least one six grants exactly one bonus roll. Non-six doubles do not grant a bonus or trigger a third-double forfeit. A capture by itself does not grant an extra roll.

**Why:** The user's latest instruction says an extra roll is granted only when a six is rolled, overriding earlier doubles and capture bonus-turn rules.

**How to apply:** Determine the bonus from the server-generated dice pair, not the move or capture outcome; pass the turn after non-six dice are consumed.

An unsafe-square capture returns opposing caps to base and advances the capturing cap another ten spaces, stopping at finish. Capture movement does not itself grant a bonus roll; the six-only rule above still applies.

**Why:** The user explicitly chose physical ten-space advancement, capped at finish, rather than timeout-ranking points; the later turn rule removes capture-only bonus rolls.

**How to apply:** Apply the extra ten spaces on the server and keep the cap on the track or finish lane; never interpret a capture as turn entitlement.

Token progress should be shown one square at a time rather than jumping directly to the final square.

**Why:** The user explicitly asked for clean tile-by-tile movement.

**How to apply:** Animate authoritative server position updates along the forward track path, while preventing additional input from interrupting the movement.

Visible dice faces must be real selections with a clear selected state, not inert controls that look selectable.

**Why:** A mistaken single-die selection can silently leave the summed move selected, changing the landing square, capture result and turn ownership in a wagered match.

**How to apply:** Verify the selected dice sent to the server, not just the displayed face values, when testing split movements and captures.

Rule upgrades must preserve saved token positions, room ownership and stakes. A legacy single-die roll may be cleared so the player rolls a fresh pair; never recreate a paid room or discard its escrow to change rule versions.

**Why:** Existing completed and funded rooms must remain accessible after the dice response shape changes.

**How to apply:** Normalize old board JSON at the server boundary without modifying financial history.
