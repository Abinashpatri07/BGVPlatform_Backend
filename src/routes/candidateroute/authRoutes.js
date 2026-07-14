import express from "express";
import pool from "../../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../../utils/sendEmail.js";

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

    // Find user with role = candidate and get candidate experience
    const [rows] = await pool.query(
      `SELECT u.*, c.candidate_experience 
       FROM users u
       LEFT JOIN candidate c ON u.email = c.candidate_email
       WHERE u.email = ? AND u.is_delete = 0 AND u.is_active = 1`,
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
        candidate_experience: user.candidate_experience || 1,
      },
    });
  } catch (err) {
    console.error("Candidate Login Error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

/**
 * POST /api/candidate/auth/forgot-password
 * Request a password reset link
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND role_name = 'candidate' AND is_delete = 0 AND is_active = 1",
      [email.trim().toLowerCase()]
    );

    if (rows.length === 0) {
      // Return a generic success to prevent email enumeration or a specific error depending on preference.
      return res.status(404).json({ success: false, message: "No active candidate account found with this email." });
    }

    const user = rows[0];
    const resetToken = uuidv4();
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await pool.query(
      "UPDATE users SET password_reset_token = ?, password_reset_expiry = ? WHERE users_id = ?",
      [resetToken, tokenExpiry, user.users_id]
    );

    const baseUrl = process.env.FRONTEND_URL || "https://bgv-platformdemo.vercel.app";
    const portalUrl = `${baseUrl}/setup-password?token=${resetToken}`;

    const emailHtml = `
      <h3>Password Reset Request</h3>
      <p>Dear ${user.first_name || 'Candidate'},</p>
      <p>We received a request to reset your password for the Candidate Portal.</p>
      <p>Click the link below to set a new password. This link is valid for 24 hours.</p>
      <p><a href="${portalUrl}" style="padding: 10px 15px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p><a href="${portalUrl}">${portalUrl}</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
      <p>Best regards,<br>The BGV Team</p>
    `;

    // Send email asynchronously
    sendEmail({
      to: email,
      subject: "Password Reset Request - Candidate Portal",
      html: emailHtml,
    }).catch(err => console.error("Forgot password email failed:", err));

    return res.status(200).json({
      success: true,
      message: "Password reset link has been sent to your email.",
    });
  } catch (err) {
    console.error("Candidate Forgot Password Error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

export default router;
