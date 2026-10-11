---
name: Paystack test recipients
description: Recipient validation remains real even though test transfers move no real money.
---

Do not present sample accounts from Paystack payment documentation as verified transfer-recipient fixtures. A failed recipient lookup may use the app's local sandbox simulation, but the mock recipient code must never be sent to Paystack.

**Why:** Multiple documented/sample destinations were rejected with “Cannot resolve account,” while the user requested simulated withdrawals to complete sandbox testing.

**How to apply:** Require the test secret before simulating; reserve and settle through the idempotent wallet ledger, deduct the ₦50 fee only once, mark the result as simulated, and never claim that a bank transfer occurred. Keep actual Paystack verification distinct from local simulations.
