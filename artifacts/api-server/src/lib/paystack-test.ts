export class PaystackTestError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function paystackTestRequest(path: string, method = "GET", body?: unknown) {
  const key = process.env.PAYSTACK_TEST_SECRET_KEY;
  if (!key?.startsWith("sk_test_")) throw new PaystackTestError(503, "Paystack test mode is not configured.");
  const response = await fetch(`https://api.paystack.co${path}`, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  let payload: Record<string, unknown> = {};
  try { payload = await response.json() as Record<string, unknown>; } catch { /* explicit invalid response below */ }
  const data = payload.data && typeof payload.data === "object" ? payload.data as Record<string, unknown> : null;
  const message = typeof payload.message === "string" ? payload.message : "";
  const failureReason = /disabled|enable.*transfer/i.test(message) ? "transfers_disabled"
    : /activate|activation|approved|approval|starter|registered|business|integration/i.test(message) ? "integration_restricted"
    : /account|bank|resolve|recipient/i.test(message) ? "invalid_recipient"
    : /insufficient|balance/i.test(message) ? "insufficient_provider_balance"
    : /authoriz|permission|access|forbidden/i.test(message) ? "access_denied" : "provider_rejected";
  const failureMessage = message.replace(/sk_(?:test|live)_[a-zA-Z0-9]+/g, "[redacted]")
    .replace(/\b\d{10,}\b/g, "[redacted]").slice(0, 200);
  return { ok: response.ok && payload.status === true, statusCode: response.status, data, failureReason, failureMessage };
}
