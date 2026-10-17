import express from "express";
import validateLogin from "../../middleware/hr/validateLogin.js";
import pool from "../../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendEmail } from "../../utils/sendEmail.js";
import { v4 as uuidv4 } from "uuid";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fallback_super_refresh_key";

/**
 * @swagger
 * /api/hr/auth/login:
 *   post:
 *     summary: HR Login
 *     tags: [HR - Auth]
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
 *                 example: hr@company.com
 *               password:
 *                 type: string
 *                 example: Hr@12345
 *     responses:
 *       200:
 *         description: HR Login Successful
 *       400:
 *         description: Validation Error
 */
router.post(
  "/login",
  validateLogin,
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Check if user exists
      const [rows] = await pool.query(
        "SELECT * FROM users WHERE email = ? AND is_delete = 0",
        [email.trim().toLowerCase()]
      );

      if (rows.length === 0) {
        return res.status(401).json({ success: false, message: "Invalid email or password" });
      }

      const user = rows[0];

      // Check Lock Status
      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(403).json({ success: false, message: "Account is locked due to too many failed attempts. Try again later." });
      }

      // Check if active
      if (user.is_active !== 1) {
        return res.status(403).json({ success: false, message: "Your account is not active. Please contact support." });
      }

      // Check if role is HR related (optional, but good practice)
      const allowedRoles = ['HR', 'HR 2', 'HR Executive', 'HR Manager', 'HR User'];
      if (!allowedRoles.includes(user.role_name)) {
        return res.status(403).json({ success: false, message: "Access denied. Not an HR account." });
      }

      // Compare password
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        const newCount = (user.login_attempt_count || 0) + 1;
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

      // Password matches! Reset login attempts and generate OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      console.log(`\n\n=== [DEVELOPMENT] OTP for ${email} is: ${otp} ===\n\n`);

      // Send email asynchronously in background
      sendEmail({
        to: email,
        subject: "HR Portal - 2FA Login OTP",
        text: `Your OTP for login is: ${otp}. It is valid for 5 minutes.`,
        html: `<h3>HR Portal Login</h3><p>Your OTP for login is: <b>${otp}</b>.</p><p>It is valid for 5 minutes.</p>`,
      }).catch(err => console.warn("Background email error:", err));

      await pool.query(
        "UPDATE users SET login_attempt_count = 0, locked_until = NULL, last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE users_id = ?",
        [otp, user.users_id]
      );

      res.status(200).json({
        success: true,
        requires2FA: true,
        message: "OTP sent to your email address."
      });
    } catch (error) {
      console.error("Login Error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during login",
      });
    }
  }
);

/**
 * @swagger
 * /api/hr/auth/verify-otp:
 *   post:
 *     summary: Verify HR OTP
 *     tags: [HR - Auth]
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.headers["user-agent"] || null;

    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND is_delete = 0",
      [email]
    );

    if (users.length === 0) return res.status(401).json({ success: false, message: "Invalid request" });
    const user = users[0];

    const allowedRoles = ['HR', 'HR 2', 'HR Executive', 'HR Manager', 'HR User'];
    if (!allowedRoles.includes(user.role_name)) {
      return res.status(403).json({ success: false, message: "Access denied. Not an HR account." });
    }

    // Check OTP
    if (!user.last_otp || user.last_otp !== otp) {
      return res.status(401).json({ success: false, message: "Invalid OTP" });
    }
    if (new Date(user.otp_expiry) < new Date()) {
      return res.status(401).json({ success: false, message: "OTP has expired" });
    }

    // Clear OTP
    await pool.query("UPDATE users SET last_otp = NULL, otp_expiry = NULL WHERE users_id = ?", [user.users_id]);

    // Generate Tokens
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
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        email: user.email,
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
 * /api/hr/auth/forgot-password:
 *   post:
 *     summary: HR Forgot Password Request
 *     tags: [HR - Auth]
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const allowedRoles = ['HR', 'HR 2', 'HR Executive', 'HR Manager', 'HR User'];
    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND is_delete = 0 AND is_active = 1",
      [email.trim().toLowerCase()]
    );

    if (rows.length === 0 || !allowedRoles.includes(rows[0].role_name)) {
      return res.status(404).json({ success: false, message: "No active HR account found with this email." });
    }

    const user = rows[0];
    const resetToken = uuidv4();
    const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Unlock account if locked and set reset token
    await pool.query(
      "UPDATE users SET password_reset_token = ?, password_reset_expiry = ?, login_attempt_count = 0, locked_until = NULL WHERE users_id = ?",
      [resetToken, tokenExpiry, user.users_id]
    );

    const baseUrl = process.env.FRONTEND_URL || "https://bgv-platformdemo.vercel.app";
    const setupUrl = `${baseUrl}/hr-setup-password?token=${resetToken}`;
    const hrName = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "HR Executive";

    console.log(`\n\n=== [DEVELOPMENT] HR Password Reset Link: ${setupUrl} ===\n\n`);

    const emailHtml = `
      <h3>HR Portal - Password Reset</h3>
      <p>Dear ${hrName},</p>
      <p>We received a request to set or reset your password for the HR Portal.</p>
      <p>Click the link below to securely set your password. This link is valid for 48 hours.</p>
      <p><a href="${setupUrl}" style="display:inline-block;padding: 10px 18px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">Set / Reset Password</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p><a href="${setupUrl}">${setupUrl}</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
      <br/>
      <p>Best regards,<br><b>BGV Platform Team</b></p>
    `;

    sendEmail({
      to: email.trim().toLowerCase(),
      subject: "HR Portal - Password Reset Request",
      html: emailHtml,
    }).catch(err => console.error("HR forgot password email failed:", err));

    return res.status(200).json({
      success: true,
      message: "Password reset link has been sent to your email address."
    });

  } catch (error) {
    console.error("HR Forgot Password Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/hr/auth/setup-info:
 *   get:
 *     summary: Get HR setup info by token
 *     tags: [HR - Auth]
 */
router.get("/setup-info", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: "Token is required" });

    const [rows] = await pool.query(
      "SELECT email FROM users WHERE password_reset_token = ? AND is_delete = 0",
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Invalid or expired setup token" });
    }

    res.status(200).json({ success: true, email: rows[0].email });
  } catch (error) {
    console.error("HR Setup Info Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/hr/auth/send-setup-otp:
 *   post:
 *     summary: Send OTP for HR password setup
 *     tags: [HR - Auth]
 */
router.post("/send-setup-otp", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: "Token is required" });

    const [rows] = await pool.query(
      "SELECT users_id, email, first_name FROM users WHERE password_reset_token = ? AND is_delete = 0",
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Invalid or expired setup token" });
    }

    const hr = rows[0];
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`\n\n=== [DEVELOPMENT] HR Setup OTP for ${hr.email} is: ${otp} ===\n\n`);

    sendEmail({
      to: hr.email,
      subject: "HR Portal - Password Setup OTP",
      text: `Your OTP for password setup is: ${otp}. It is valid for 5 minutes.`,
      html: `<h3>Password Setup</h3><p>Your OTP is: <b>${otp}</b>.</p><p>It is valid for 5 minutes.</p>`,
    }).catch(err => console.warn("Background email error:", err));

    await pool.query(
      "UPDATE users SET last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE users_id = ?",
      [otp, hr.users_id]
    );

    res.status(200).json({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("HR Send Setup OTP Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/hr/auth/set-password:
 *   post:
 *     summary: Set password for HR
 *     tags: [HR - Auth]
 */
router.post("/set-password", async (req, res) => {
  try {
    const { token, otp, password } = req.body;

    const [rows] = await pool.query(
      "SELECT users_id, last_otp, otp_expiry FROM users WHERE password_reset_token = ? AND is_delete = 0",
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired token" });
    }

    const hr = rows[0];

    if (!hr.last_otp || hr.last_otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }
    if (new Date(hr.otp_expiry) < new Date()) {
      return res.status(400).json({ success: false, message: "OTP has expired" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expiry = NULL, last_otp = NULL, otp_expiry = NULL WHERE users_id = ?",
      [hashedPassword, hr.users_id]
    );

    res.status(200).json({ success: true, message: "Password set successfully" });
  } catch (error) {
    console.error("HR Set Password Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;