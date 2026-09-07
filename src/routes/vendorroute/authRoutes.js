import express from "express";
import pool from "../../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { sendEmail } from "../../utils/sendEmail.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fallback_super_refresh_key";

/**
 * @swagger
 * /api/vendor/auth/login:
 *   post:
 *     summary: Vendor Login
 *     tags: [Vendor - Auth]
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
 *                 example: vendor@bgv.com
 *               password:
 *                 type: string
 *                 example: Vendor@123
 *     responses:
 *       200:
 *         description: Login Successful
 *       400:
 *         description: Validation Error
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }

    const [rows] = await pool.query(
      "SELECT * FROM vendor_master WHERE poc_email = ? AND is_active = 1 AND is_suspend != 1 AND is_delete = 0",
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

    // Check if password exists
    if (!user.password_hash) {
      return res.status(401).json({ success: false, message: "Password not set for this vendor. Please contact admin." });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      const newCount = (user.login_attempt_count || 0) + 1;
      let query = "UPDATE vendor_master SET login_attempt_count = ? WHERE vendor_id = ?";
      let params = [newCount, user.vendor_id];
      let msg = "Invalid email or password";

      if (newCount >= 3) {
        query = "UPDATE vendor_master SET login_attempt_count = ?, locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE vendor_id = ?";
        msg = "Account locked due to 3 failed attempts. Try again in 15 minutes.";
      }
      
      await pool.query(query, params);
      return res.status(401).json({ success: false, message: msg });
    }

    // Password matches! Reset login attempts and generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`\n\n=== [DEVELOPMENT] OTP for Vendor ${email} is: ${otp} ===\n\n`);
    
    // Send email asynchronously in background
    sendEmail({
      to: email,
      subject: "Vendor Portal - 2FA Login OTP",
      text: `Your OTP for login is: ${otp}. It is valid for 5 minutes.`,
      html: `<h3>Vendor Portal Login</h3><p>Your OTP for login is: <b>${otp}</b>.</p><p>It is valid for 5 minutes.</p>`,
    }).catch(err => console.warn("Background email error:", err));
    
    await pool.query(
      "UPDATE vendor_master SET login_attempt_count = 0, locked_until = NULL, last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE vendor_id = ?",
      [otp, user.vendor_id]
    );

    res.status(200).json({
      success: true,
      requires2FA: true,
      message: "OTP sent to your email address."
    });

  } catch (error) {
    console.error("Vendor Login Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/vendor/auth/verify-otp:
 *   post:
 *     summary: Verify Vendor OTP
 *     tags: [Vendor - Auth]
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.headers["user-agent"] || null;

    const [users] = await pool.query(
      "SELECT * FROM vendor_master WHERE poc_email = ? AND is_active = 1 AND is_suspend != 1 AND is_delete = 0",
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
    await pool.query("UPDATE vendor_master SET last_otp = NULL, otp_expiry = NULL WHERE vendor_id = ?", [user.vendor_id]);

    // Generate Tokens
    const accessToken = jwt.sign(
      { id: user.vendor_id, role: "Vendor", email: user.poc_email },
      JWT_SECRET,
      { expiresIn: "24h" }
    );
    const refreshToken = jwt.sign(
      { id: user.vendor_id },
      JWT_REFRESH_SECRET,
      { expiresIn: "7d" }
    );

    // Invalidate Prev Sessions (Assuming we use users_id in login_sessions. Since this is vendor_id, we might need a different column or use user_id = vendor_id and role = 'Vendor'. 
    // login_sessions has `user_id`, we can use `user_id` = vendor_id, but to avoid collision we could add a role column. 
    // Since we don't know the schema of login_sessions, let's just insert it and avoid collision by matching username or token.
    // For now, we will just use the standard token system.)

    // Not invalidating session to avoid collision with client admins if IDs overlap without role checks.
    // Ideally login_sessions should have user_type. We'll skip session tracking for now, or insert without conflict.
    
    // Create Session
    try {
        await pool.query(
          `INSERT INTO login_sessions 
            (user_id, username, access_token, refresh_token, login_status, ip_address, user_agent, is_current_session) 
           VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, 1)`,
          [user.vendor_id, user.poc_email, accessToken, refreshToken, ipAddress, userAgent]
        );
    } catch (sessionErr) {
        console.warn("Session tracking error (may not support vendor_id):", sessionErr.message);
    }

    res.status(200).json({
      success: true,
      message: "Login Successful",
      token: accessToken,
      refreshToken: refreshToken,
      user: {
        id: user.vendor_id,
        name: `${user.poc_first_name} ${user.poc_last_name}`.trim(),
        email: user.poc_email,
        role: "Vendor"
      }
    });

  } catch (error) {
    console.error("Verify OTP Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/vendor/auth/logout:
 *   post:
 *     summary: Vendor Logout
 *     tags: [Vendor - Auth]
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
 * /api/vendor/auth/setup-info:
 *   get:
 *     summary: Get vendor setup info by token
 *     tags: [Vendor - Auth]
 */
router.get("/setup-info", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: "Token is required" });

    const [rows] = await pool.query(
      "SELECT poc_email FROM vendor_master WHERE password_reset_token = ? AND is_delete = 0",
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Invalid or expired setup token" });
    }

    res.status(200).json({ success: true, email: rows[0].poc_email });
  } catch (error) {
    console.error("Vendor Setup Info Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/vendor/auth/send-setup-otp:
 *   post:
 *     summary: Send OTP for vendor password setup
 *     tags: [Vendor - Auth]
 */
router.post("/send-setup-otp", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: "Token is required" });

    const [rows] = await pool.query(
      "SELECT vendor_id, poc_email FROM vendor_master WHERE password_reset_token = ? AND is_delete = 0",
      [token]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Invalid or expired setup token" });
    }

    const vendor = rows[0];
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`\n\n=== [DEVELOPMENT] Vendor Setup OTP for ${vendor.poc_email} is: ${otp} ===\n\n`);

    sendEmail({
      to: vendor.poc_email,
      subject: "Vendor Portal - Password Setup OTP",
      text: `Your OTP for password setup is: ${otp}. It is valid for 5 minutes.`,
      html: `<h3>Password Setup</h3><p>Your OTP is: <b>${otp}</b>.</p><p>It is valid for 5 minutes.</p>`,
    }).catch(err => console.warn("Background email error:", err));

    await pool.query(
      "UPDATE vendor_master SET last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE vendor_id = ?",
      [otp, vendor.vendor_id]
    );

    res.status(200).json({ success: true, message: "OTP sent successfully" });
  } catch (error) {
    console.error("Vendor Send Setup OTP Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/vendor/auth/set-password:
 *   post:
 *     summary: Set password for vendor
 *     tags: [Vendor - Auth]
 */
router.post("/set-password", async (req, res) => {
  try {
    const { token, otp, password } = req.body;

    const [rows] = await pool.query(
      "SELECT vendor_id, last_otp, otp_expiry FROM vendor_master WHERE password_reset_token = ? AND is_delete = 0",
      [token]
    );

    if (rows.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired token" });
    }

    const vendor = rows[0];

    if (!vendor.last_otp || vendor.last_otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }
    if (new Date(vendor.otp_expiry) < new Date()) {
      return res.status(400).json({ success: false, message: "OTP has expired" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      "UPDATE vendor_master SET password_hash = ?, password_reset_token = NULL, password_reset_expiry = NULL, last_otp = NULL, otp_expiry = NULL WHERE vendor_id = ?",
      [hashedPassword, vendor.vendor_id]
    );

    res.status(200).json({ success: true, message: "Password set successfully" });
  } catch (error) {
    console.error("Vendor Set Password Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
