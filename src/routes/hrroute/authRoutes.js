import express from "express";
import validateLogin from "../../middleware/hr/validateLogin.js";
import pool from "../../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendEmail } from "../../utils/sendEmail.js";

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

export default router;