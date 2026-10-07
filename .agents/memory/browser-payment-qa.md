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
