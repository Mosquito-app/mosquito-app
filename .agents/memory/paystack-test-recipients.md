---
name: Paystack test recipients
description: Recipient validation remains real even though test transfers move no real money.
---

Do not present sample accounts from Paystack payment documentation as verified transfer-recipient fixtures. Transfer recipient creation still requires bank details Paystack can resolve in test mode.

**Why:** Multiple documented/sample destinations were rejected with “Cannot resolve account,” while the same test integration successfully initialized hosted checkout.

**How to apply:** Distinguish mocked transfer coverage from provider-verified transfers. Require an accepted test recipient before claiming payout verification, and never debit funds when recipient creation fails.
