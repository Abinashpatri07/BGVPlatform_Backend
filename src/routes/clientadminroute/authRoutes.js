import express from "express";
import crypto from "crypto";
import validateLogin from "../../middleware/clientadmin/validateLogin.js";
import pool from "../../config/db.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../../utils/sendEmail.js";
import verifyToken from "../../middleware/authMiddleware.js";

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

    // Check if Client Company is Suspended
    if (user.client_id) {
      const [clientRows] = await pool.query(
        "SELECT is_suspend, is_active FROM client_master WHERE client_id = ? AND is_delete = 0",
        [user.client_id]
      );
      if (clientRows.length > 0 && (Number(clientRows[0].is_suspend) === 1 || Number(clientRows[0].is_active) === 2)) {
        return res.status(403).json({
          success: false,
          message: "Your company account has been suspended. Please contact Super Admin support.",
        });
      }
    }

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
        query = "UPDATE users SET login_attempt_count = ?, locked_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE) WHERE users_id = ?";
        msg = "Account locked due to 3 failed attempts. Try again in 30 minutes.";
      }
      
      await pool.query(query, params);
      return res.status(401).json({ success: false, message: msg });
    }

    // Password matches! Reset login attempts and generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Send OTP email
    const emailSent = await sendEmail({
      to: email,
      subject: "Client Admin Portal - 2FA Login OTP",
      text: `Your OTP for login is: ${otp}. It is valid for 5 minutes.`,
      html: `<h3>Client Admin Portal Login</h3><p>Your OTP for login is: <b>${otp}</b>.</p><p>It is valid for 5 minutes.</p>`,
    });

    if (!emailSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP to your email address. Please try again.",
      });
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
        role: user.role_name,
        client_id: user.client_id
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

/**
 * @swagger
 * /api/client-admin/auth/setup-info:
 *   get:
 *     summary: Get Client Admin setup info by token
 *     tags: [Client Admin - Auth]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/setup-info", async (req, res) => {
  const { token } = req.query;

  if (!token) return res.status(400).json({ success: false, message: "Token is required." });

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const [users] = await pool.query(
      "SELECT email FROM users WHERE (password_reset_token = ? OR password_reset_token = ?) AND role_name = 'Client Admin' AND is_delete = 0",
      [token, tokenHash]
    );

    if (users.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired setup token." });
    }

    return res.status(200).json({ success: true, email: users[0].email });
  } catch (err) {
    console.error("Setup Info Error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * @swagger
 * /api/client-admin/auth/send-setup-otp:
 *   post:
 *     summary: Send OTP for Client Admin password setup
 *     tags: [Client Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token]
 *             properties:
 *               token:
 *                 type: string
 */
router.post("/send-setup-otp", async (req, res) => {
  const { token } = req.body;

  if (!token) return res.status(400).json({ success: false, message: "Token is required." });

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const [users] = await pool.query(
      "SELECT users_id, email, first_name FROM users WHERE (password_reset_token = ? OR password_reset_token = ?) AND role_name = 'Client Admin' AND is_delete = 0",
      [token, tokenHash]
    );

    if (users.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired setup token." });
    }

    const user = users[0];
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

    await pool.query(
      "UPDATE users SET last_otp = ?, otp_expiry = ? WHERE users_id = ?",
      [otp, expiry, user.users_id]
    );

    sendEmail({
      to: user.email,
      subject: "Client Admin Portal - Password Setup OTP",
      text: `Your OTP for setting up your password is: ${otp}. It is valid for 5 minutes.`,
      html: `<h3>Client Admin Setup</h3><p>Your OTP is: <b>${otp}</b></p><p>It is valid for 5 minutes.</p>`,
    }).catch(err => console.error("Send Setup OTP Error:", err));

    return res.status(200).json({ success: true, message: "OTP sent to your email." });
  } catch (err) {
    console.error("Send Setup OTP Error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * @swagger
 * /api/client-admin/auth/set-password:
 *   post:
 *     summary: Set password for Client Admin using OTP
 *     tags: [Client Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, otp, password]
 *             properties:
 *               token:
 *                 type: string
 *               otp:
 *                 type: string
 *               password:
 *                 type: string
 */
router.post("/set-password", async (req, res) => {
  const { token, otp, password } = req.body;

  if (!token || !otp || !password) {
    return res.status(400).json({ success: false, message: "Token, OTP, and Password are required." });
  }

  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const [users] = await pool.query(
      "SELECT users_id, last_otp, otp_expiry FROM users WHERE (password_reset_token = ? OR password_reset_token = ?) AND role_name = 'Client Admin' AND is_delete = 0",
      [token, tokenHash]
    );

    if (users.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired setup token." });
    }

    const user = users[0];

    if (!user.last_otp || user.last_otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP." });
    }

    if (new Date(user.otp_expiry) < new Date()) {
      return res.status(400).json({ success: false, message: "OTP has expired." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    await pool.query(
      "UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expiry = NULL, last_otp = NULL, otp_expiry = NULL WHERE users_id = ?",
      [hashedPassword, user.users_id]
    );

    return res.status(200).json({ success: true, message: "Password set successfully." });
  } catch (err) {
    console.error("Set Password Error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * @swagger
 * /api/client-admin/auth/forgot-password:
 *   post:
 *     summary: Request a password reset link for Client Admin
 *     tags: [Client Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 */
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const [rows] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND role_name = 'Client Admin' AND is_delete = 0 AND is_active = 1",
      [email.trim().toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Account not found with this email." });
    }

    const user = rows[0];
    const resetToken = uuidv4();
    const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Unlock account if it was locked, reset attempts, set reset token
    await pool.query(
      "UPDATE users SET password_reset_token = ?, password_reset_expiry = ?, login_attempt_count = 0, locked_until = NULL WHERE users_id = ?",
      [resetToken, tokenExpiry, user.users_id]
    );

    const baseUrl = (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost"))
      ? process.env.FRONTEND_URL.replace(/\/+$/, "")
      : "https://bgv.dqnex.online";
    const portalUrl = `${baseUrl}/admin/client-setup-password?token=${resetToken}`;

    const emailHtml = `
      <h3>Client Admin - Password Reset</h3>
      <p>Dear ${user.first_name || "Client Admin"},</p>
      <p>We received a request to set or reset your password for the Client Admin Portal.</p>
      <p>Click the link below to securely set your password. This link is valid for 48 hours.</p>
      <p><a href="${portalUrl}" style="padding: 10px 15px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px;">Set / Reset Password</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p><a href="${portalUrl}">${portalUrl}</a></p>
      <p>If you did not request this, you can safely ignore this email.</p>
      <p>Best regards,<br>The BGV Platform Team</p>
    `;

    sendEmail({
      to: email.trim().toLowerCase(),
      subject: "Client Admin Portal - Password Reset Request",
      html: emailHtml,
    }).catch(err => console.error("Client Admin forgot password email failed:", err));

    return res.status(200).json({
      success: true,
      message: "Password reset link has been sent to your email.",
    });

  } catch (err) {
    console.error("Client Admin Forgot Password Error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

/**
 * @swagger
 * /api/client-admin/auth/change-password:
 *   post:
 *     summary: Client Admin Change Password
 *     tags: [Client Admin - Auth]
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
    console.error("Client Admin Change Password Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

export default router;