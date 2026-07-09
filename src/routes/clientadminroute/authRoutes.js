import express from "express";
import validateLogin from "../../middleware/clientadmin/validateLogin.js";
import pool from "../../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendEmail } from "../../utils/sendEmail.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fallback_super_refresh_key";

/**
 * @swagger
 * /api/client-admin/auth/login:
 *   post:
 *     summary: Client Admin Login
 *     tags: [Client Admin - Auth]
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
 *                 example: clientadmin@bgv.com
 *               password:
 *                 type: string
 *                 example: Admin@123
 *     responses:
 *       200:
 *         description: Login Successful
 *       400:
 *         description: Validation Error
 */
router.post("/login", validateLogin, async (req, res) => {
  try {
    const { email, password } = req.body;

    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND role_name = 'Client Admin' AND is_active = 1 AND is_delete = 0",
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

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      const newCount = user.login_attempt_count + 1;
      let query = "UPDATE users SET login_attempt_count = ? WHERE users_id = ?";
      let params = [newCount, user.users_id];
      let msg = "Invalid email or password";

      if (newCount >= 3) {
        query = "UPDATE users SET login_attempt_count = ?, locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE users_id = ?";
        msg = "Account locked due to 3 failed attempts. Try again in 15 minutes.";
      }
      
      await pool.query(query, params);
      return res.status(401).json({ success: false, message: msg });
    }

    // Password matches! Reset login attempts and generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`\n\n=== [DEVELOPMENT] OTP for ${email} is: ${otp} ===\n\n`);
    
    // Send email
    const emailSent = await sendEmail({
      to: email,
      subject: "Client Admin Portal - 2FA Login OTP",
      text: `Your OTP for login is: ${otp}. It is valid for 5 minutes.`,
      html: `<h3>Client Admin Portal Login</h3><p>Your OTP for login is: <b>${otp}</b>.</p><p>It is valid for 5 minutes.</p>`,
    });

    if (!emailSent) {
      console.warn("Failed to send OTP email. Please check SMTP configuration.");
    }
    
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
    console.error("Client Admin Login Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/client-admin/auth/verify-otp:
 *   post:
 *     summary: Verify Client Admin OTP
 *     tags: [Client Admin - Auth]
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.headers["user-agent"] || null;

    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND role_name = 'Client Admin' AND is_active = 1 AND is_delete = 0",
      [email.trim().toLowerCase()]
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
      { expiresIn: "1h" }
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
 * /api/client-admin/auth/logout:
 *   post:
 *     summary: Client Admin Logout
 *     tags: [Client Admin - Auth]
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

export default router;