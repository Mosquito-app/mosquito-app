import assert from "node:assert/strict";
import { test } from "node:test";
import { RegisterBody } from "@workspace/api-zod";

const account = {
  username: "player123",
  email: "player@example.test",
};

test("registration accepts passwords of at least four characters without format restrictions", () => {
  for (const password of ["1234", "123456", "abc1", "letters and numbers 42"]) {
    assert.equal(
      RegisterBody.safeParse({ ...account, password }).success,
      true,
      `expected ${JSON.stringify(password)} to be accepted`,
    );
  }
});

test("registration rejects passwords shorter than four characters", () => {
  const parsed = RegisterBody.safeParse({ ...account, password: "123" });
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.equal(parsed.error.issues[0]?.message, "Password must be at least 4 characters long");
  }
});
