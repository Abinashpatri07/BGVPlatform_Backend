import express from "express";
import crypto from "crypto";
import validateLogin from "../../middleware/superadmin/validateLogin.js";
import pool from "../../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendEmail } from "../../utils/sendEmail.js";
import verifyToken from "../../middleware/authMiddleware.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fallback_super_refresh_key";

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Super Admin Login
 *     tags: [Super Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@bgv.com
 *               password:
 *                 type: string
 *                 example: Admin@123
 *     responses:
 *       200:
 *         description: Validation Passed
 *       400:
 *         description: Validation Error
 */
router.post("/login", validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Find Super Admin user
    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND role_name = 'Super Admin' AND is_active = 1 AND is_delete = 0",
      [email.trim().toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const user = users[0];

    // Check Lock Status
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(403).json({ success: false, message: "Account is locked due to too many failed attempts. Try again later." });
    }

    // 2. Check Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const newCount = user.login_attempt_count + 1;
      let query = "UPDATE users SET login_attempt_count = ? WHERE users_id = ?";
      let params = [newCount, user.users_id];
      let msg = "Invalid email or password";

      if (newCount >= 3) {
        query = "UPDATE users SET login_attempt_count = ?, locked_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE) WHERE users_id = ?";
        msg = "Account locked due to 3 failed attempts. Try again in 30 minutes.";
      }
      
      await pool.query(query, params);
      return res.status(401).json({ success: false, message: msg });
    }

    // 3. Password matches! Reset login attempts and generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Send OTP email
    const emailSent = await sendEmail({
      to: email,
      subject: "Super Admin Portal - 2FA Login OTP",
      text: `Your OTP for login is: ${otp}. It is valid for 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4F46E5;">Super Admin Login - OTP Verification</h2>
          <p>Your One-Time Password (OTP) for login is:</p>
          <div style="background: #F3F4F6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #1F2937;">${otp}</span>
          </div>
          <p style="color: #6B7280; font-size: 14px;">⏱ This OTP is valid for <strong>10 minutes</strong>.</p>
          <p style="color: #9CA3AF; font-size: 12px; margin-top: 20px;">If you did not attempt to log in, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;" />
          <p style="color: #9CA3AF; font-size: 12px;">BGV Platform - Background Verification System</p>
        </div>
      `,
    });

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP to your email address. Please try again.",
      });
    }

    await pool.query(
      "UPDATE users SET login_attempt_count = 0, locked_until = NULL, last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE users_id = ?",
      [otp, user.users_id]
    );

    res.status(200).json({
      success: true,
      requires2FA: true,
      message: "OTP sent to your registered email address."
    });

  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/auth/resend-otp:
 *   post:
 *     summary: Resend OTP to Super Admin
 *     tags: [Super Admin - Auth]
 */
router.post("/resend-otp", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND role_name = 'Super Admin' AND is_active = 1 AND is_delete = 0",
      [email.trim().toLowerCase()]
    );

    if (users.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid request." });
    }

    const user = users[0];

    // 60-second cooldown: check if OTP was set within last 60 seconds
    if (user.otp_expiry) {
      const otpSetAt = new Date(user.otp_expiry).getTime() - 10 * 60 * 1000; // expiry - 10min = when it was set
      const secondsSinceSent = (Date.now() - otpSetAt) / 1000;
      if (secondsSinceSent < 60) {
        const waitSec = Math.ceil(60 - secondsSinceSent);
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSec} seconds before requesting a new OTP.`,
        });
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const emailSent = await sendEmail({
      to: user.email,
      subject: "Super Admin Portal - New OTP",
      text: `Your new OTP for login is: ${otp}. It is valid for 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4F46E5;">Super Admin Login - New OTP</h2>
          <p>Your new One-Time Password (OTP) for login is:</p>
          <div style="background: #F3F4F6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #1F2937;">${otp}</span>
          </div>
          <p style="color: #6B7280; font-size: 14px;">⏱ This OTP is valid for <strong>10 minutes</strong>.</p>
          <p style="color: #9CA3AF; font-size: 12px; margin-top: 20px;">If you did not attempt to log in, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;" />
          <p style="color: #9CA3AF; font-size: 12px;">BGV Platform - Background Verification System</p>
        </div>
      `,
    });

    if (!emailSent) {
      return res.status(500).json({ success: false, message: "Failed to send OTP. Please try again." });
    }

    await pool.query(
      "UPDATE users SET last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE users_id = ?",
      [otp, user.users_id]
    );

    res.status(200).json({ success: true, message: "New OTP sent to your registered email address." });

  } catch (error) {
    console.error("Resend OTP Error:", error);
    res.status(500).json({ success: false, message: "Internal server error." });
  }
});

/**
 * @swagger
 * /api/auth/verify-otp:
 *   post:
 *     summary: Verify Super Admin OTP
 *     tags: [Super Admin - Auth]
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.headers["user-agent"] || null;

    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND role_name = 'Super Admin' AND is_active = 1 AND is_delete = 0",
      [email]
    );

    if (users.length === 0) return res.status(401).json({ success: false, message: "Invalid request" });
    const user = users[0];

    // Check OTP
    if (!user.last_otp || user.last_otp !== otp) {
      return res.status(401).json({ success: false, message: "Invalid OTP" });
    }
    if (new Date(user.otp_expiry) < new Date()) {
      return res.status(401).json({ success: false, message: "OTP has expired" });
    }

    // Clear OTP
    await pool.query("UPDATE users SET last_otp = NULL, otp_expiry = NULL WHERE users_id = ?", [user.users_id]);

    // Generate Tokens (1 hour lifespan for access token)
    const accessToken = jwt.sign(
      { id: user.users_id, role: user.role_name, email: user.email, client_id: user.client_id },
      JWT_SECRET,
      { expiresIn: "24h" }
    );
    const refreshToken = jwt.sign(
      { id: user.users_id },
      JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    // Invalidate Prev Sessions
    await pool.query(
      "UPDATE login_sessions SET login_status = 'EXPIRED', is_current_session = 0 WHERE user_id = ? AND login_status = 'ACTIVE'",
      [user.users_id]
    );

    // Create Session
    await pool.query(
      `INSERT INTO login_sessions 
        (user_id, username, access_token, refresh_token, login_status, ip_address, user_agent, is_current_session) 
       VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, 1)`,
      [user.users_id, user.username, accessToken, refreshToken, ipAddress, userAgent]
    );

    res.status(200).json({
      success: true,
      message: "Login Successful",
      token: accessToken,
      refreshToken: refreshToken,
      user: {
        id: user.users_id,
        name: `${user.first_name} ${user.last_name}`.trim(),
        email: user.email,
        phone: user.mobile || "",
        mobile: user.mobile || "",
        role: user.role_name
      }
    });

  } catch (error) {
    console.error("Verify OTP Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Super Admin Logout
 *     tags: [Super Admin - Auth]
 */
router.post("/logout", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];
      
      await pool.query(
        "UPDATE login_sessions SET login_status = 'LOGGED_OUT', is_current_session = 0, logout_time = NOW(), logout_reason = 'Manual Logout' WHERE access_token = ?",
        [token]
      );
    }
    res.status(200).json({ success: true, message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Super Admin Forgot Password
 *     tags: [Super Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@bgv.com
 *     responses:
 *       200:
 *         description: Password reset link sent successfully
 *       400:
 *         description: Email is required or invalid
 */
router.post(
  "/forgot-password",
  async (req, res) => {

    const { email } = req.body;

    // EMPTY EMAIL
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // EMAIL FORMAT
    const emailRegex = /^\S+@\S+\.\S+$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter valid email",
      });
    }

    try {
      // Check if user exists
      const [users] = await pool.query(
        "SELECT users_id, email, username FROM users WHERE email = ? AND role_name = 'Super Admin' AND is_active = 1 AND is_delete = 0",
        [email.trim().toLowerCase()]
      );

      // Return error if user does not exist
      if (users.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No active Super Admin account found with this email.",
        });
      }

      const user = users[0];

      // Generate secure reset token
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

      // Store hashed token with 1-hour expiry
      await pool.query(
        "UPDATE users SET password_reset_token = ?, password_reset_expiry = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE users_id = ?",
        [resetTokenHash, user.users_id]
      );

      // Build reset link dynamically using the request origin (works for Vercel, custom domain, or localhost)
      const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : null);
      const frontendUrl = (origin && origin !== "null")
        ? origin.replace(/\/+$/, "")
        : (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost")
            ? process.env.FRONTEND_URL.replace(/\/+$/, "")
            : "https://bgv-platformdemo.vercel.app");
      const resetLink = `${frontendUrl}/super-admin/reset-password?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

      // Send email
      const emailSent = await sendEmail({
        to: user.email,
        subject: "BGV Platform - Password Reset Request",
        text: `You requested a password reset. Click the link below to reset your password:\n\n${resetLink}\n\nThis link is valid for 1 hour. If you did not request this, please ignore this email.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4F46E5;">Password Reset Request</h2>
            <p>Hello ${user.username || "Admin"},</p>
            <p>You requested a password reset for your Super Admin account. Click the button below to set a new password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" 
                 style="background-color: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                Reset Password
              </a>
            </div>
            <p style="color: #6B7280; font-size: 14px;">This link is valid for <strong>1 hour</strong>. If you did not request this reset, please ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;" />
            <p style="color: #9CA3AF; font-size: 12px;">BGV Platform - Background Verification System</p>
          </div>
        `,
      });

      if (!emailSent) {
        return res.status(500).json({
          success: false,
          message: "Failed to send reset email. Please try again later.",
        });
      }

      return res.status(200).json({
        success: true,
        message: "Password reset link has been sent to your registered email.",
      });

    } catch (error) {
      console.error("Forgot Password Error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset Super Admin Password using token
 *     tags: [Super Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - email
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *               email:
 *                 type: string
 *               newPassword:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid or expired token
 */
router.post("/reset-password", async (req, res) => {
  try {
    const { token, email, newPassword } = req.body;

    if (!token || !email || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Token, email and new password are required.",
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long.",
      });
    }

    // Hash the token to compare with stored hash
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Find user with matching token that hasn't expired
    const [users] = await pool.query(
      "SELECT users_id, email FROM users WHERE email = ? AND password_reset_token = ? AND password_reset_expiry > NOW() AND role_name = 'Super Admin' AND is_active = 1 AND is_delete = 0",
      [email.trim().toLowerCase(), tokenHash]
    );

    if (users.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid or expired reset link. Please request a new one.",
      });
    }

    const user = users[0];

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query(
      "UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expiry = NULL WHERE users_id = ?",
      [hashedPassword, user.users_id]
    );

    return res.status(200).json({
      success: true,
      message: "Password has been reset successfully. You can now log in with your new password.",
    });

  } catch (error) {
    console.error("Reset Password Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
});


/**
 * @swagger
 * /api/auth/change-password:
 *   post:
 *     summary: Super Admin Change Password
 *     tags: [Super Admin - Auth]
 *     security:
 *       - bearerAuth: []
 */
router.post("/change-password", verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new password are required." });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters." });
    }

    const [users] = await pool.query(
      "SELECT users_id, password FROM users WHERE users_id = ? AND is_delete = 0",
      [userId]
    );
    if (users.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const isMatch = await bcrypt.compare(currentPassword, users[0].password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Current password is incorrect." });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password = ? WHERE users_id = ?", [hashed, userId]);

    return res.status(200).json({ success: true, message: "Password changed successfully." });
  } catch (error) {
    console.error("Change Password Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

export default router;