import express from "express";
import pool from "../../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_key";

/**
 * POST /api/candidate/auth/login
 * Candidate Login
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    // Find user with role = candidate
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND is_delete = 0 AND is_active = 1",
      [email.trim().toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const user = rows[0];

    // Check if this user is actually a candidate
    if (user.role_name !== "candidate") {
      return res.status(403).json({
        success: false,
        message: `You are registered as "${user.role_name}". Please login from the correct portal.`,
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    // Generate JWT
    const token = jwt.sign(
      { users_id: user.users_id, email: user.email, role: user.role_name },
      JWT_SECRET,
      { expiresIn: "8h" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: {
        users_id: user.users_id,
        name: `${user.first_name} ${user.last_name}`.trim(),
        email: user.email,
        role: user.role_name,
      },
    });
  } catch (err) {
    console.error("Candidate Login Error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

export default router;
