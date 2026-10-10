import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs"; // or your project's password hashing utility

const router = Router();

// Endpoint 1: Verify Email for Reset
router.post("/auth/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: "Email address is required." });
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim())).limit(1);

  if (!user) {
    return res.status(404).json({ error: "No account found with that email address." });
  }

  // Returns success confirmation so frontend can prompt for new password
  return res.status(200).json({ success: true, message: "Account found. Please enter your new password." });
});

// Endpoint 2: Reset Password
router.post("/auth/reset-password", async (req, res) => {
  const { email, newPassword } = req.body;

  if (!email || !newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters long." });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);

  const [updatedUser] = await db.update(usersTable)
    .set({ password: hashedPassword })
    .where(eq(usersTable.email, email.toLowerCase().trim()))
    .returning();

  if (!updatedUser) {
    return res.status(400).json({ error: "Failed to reset password." });
  }

  return res.status(200).json({ success: true, message: "Password updated successfully! You can now sign in." });
});

export default router;
