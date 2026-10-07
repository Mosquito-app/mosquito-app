---
name: Browser payment QA
description: Browser-testing tool mismatch and Paystack hosted checkout security checks.
---

If the documented testing subagent rejects its configuration kind, use actual browser automation instead of reporting static screenshots as end-to-end testing.

**Why:** The testing skill's documented configuration was rejected as an unknown kind in this environment.

**How to apply:** Try the supported testing flow first; on that specific rejection, use native Playwright with available Chromium. Preserve normal authentication.

Distinguish Paystack hosted-card browser verification from API initialization or mocked verification coverage. Never substitute seeded balances for a successful provider-backed test payment.

**Why:** Hosted Paystack checkout displayed Cloudflare security verification in automated Chromium and did not clear after a normal wait, even though API checkout initialization worked.

**How to apply:** Report the external blocker honestly. If a user completes card entry in their ordinary browser, continue using the authenticated QA session and verify the actual transaction reference before asserting credit or matchmaking success.

Do not rely on temporary filesystem storage for browser QA sessions that must survive a user-input pause. Keep any necessary session material in an ignored, access-restricted workspace location; never commit or log cookies.

**Why:** Temporary browser session state was missing after the user completed the hosted checkouts. The actual QA accounts and payment intents remained intact in PostgreSQL.

**How to apply:** Save private state with restrictive permissions before handing off hosted checkout. If session recovery is necessary, restore only disposable QA accounts and sign in through the normal UI; do not bypass authentication or modify financial records. Manual checkout followed by authenticated automatic reference verification successfully completed the provider-backed flow.
