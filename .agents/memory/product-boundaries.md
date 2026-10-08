---
name: Product boundaries
description: User-requested Mosquito branding, account, money-mode and commission rules.
---

Use PostgreSQL-backed local accounts; the user explicitly said “Bypass Clerk.”

**Why:** The user chose simple local registration and login instead of Clerk.

**How to apply:** Retain local accounts when extending the platform.

Keep deposits, wagering, withdrawals and commission balances sandbox-only. Do not enable live charges or payouts.

**Why:** The original agreed scope explicitly excluded live money movement; the subsequent request named Paystack test endpoints.

**How to apply:** Reject non-test Paystack keys and test responses from a non-test domain. Do not interpret test-transfer support as authorization for live transfers.

Distribute 90% of the combined match stakes to the winner and 10% to the platform commission wallet.

**Why:** The user specified ₦2,000 per player → ₦4,000 pot, ₦3,600 winner prize and ₦400 commission.

**How to apply:** Apply the same split to every supported stake and settle atomically, once per match.

Use “Mosquito App” for the application name (“Mosquito” is an acceptable short form), and “Mosquito Wallet” for wallet branding.

**Why:** The user explicitly requested a full rebrand to these names while preserving the existing game and escrow rules.

**How to apply:** Use these names for future customer-facing headers, wallet dialogs, receipt labels, metadata and logo assets.
