import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import { sendEmail } from "../utils/sendEmail.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_key";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "fallback_super_refresh_key";

const normalizeRoleType = (roleName) => {
  if (!roleName) return null;
  const lower = roleName.toLowerCase().trim();
  if (lower === "super admin") return "super-admin";
  if (lower === "client admin") return "admin";
  if (lower.startsWith("hr")) return "hr";
  if (lower === "vendor") return "vendor";
  if (lower === "candidate") return "candidate";
  return lower;
};

const getDashboardUrl = (portalRole) => {
  switch (portalRole) {
    case "super-admin":
      return "/super-admin/home";
    case "admin":
      return "/admin/home";
    case "hr":
      return "/hr/home";
    case "vendor":
      return "/vendor/home";
    case "candidate":
      return "/verification";
    default:
      return "/";
  }
};

/**
 * POST /api/auth/unified-login
 * Detects user role by email (users / vendor_master) and authenticates.
 * Prevents multi-endpoint loop and unwanted account lockouts.
 */
router.post("/unified-login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Check in `users` table first
    const [users] = await pool.query(
      `SELECT u.*, c.cand_id, c.candidate_experience, c.candidate_first_name, c.candidate_last_name, c.candidate_mobile,
              COALESCE(u.client_id, c.client_id) AS resolved_client_id
       FROM users u
       LEFT JOIN candidate c ON u.email = c.candidate_email
       WHERE u.email = ? AND u.is_delete = 0`,
      [normalizedEmail]
    );

    let accountType = null;
    let userRecord = null;

    if (users.length > 0) {
      userRecord = users[0];
      const normalized = normalizeRoleType(userRecord.role_name);
      accountType = normalized || "candidate";
    } else {
      // 2. Check in `vendor_master` table
      const [vendors] = await pool.query(
        "SELECT * FROM vendor_master WHERE poc_email = ? AND is_delete = 0",
        [normalizedEmail]
      );
      if (vendors.length > 0) {
        userRecord = vendors[0];
        accountType = "vendor";
      }
    }

    if (!userRecord) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    // Verify vendor specific checks
    if (accountType === "vendor") {
      if (Number(userRecord.is_suspend) === 1 || Number(userRecord.is_active) === 2) {
        return res.status(403).json({
          success: false,
          message: "Your vendor account has been suspended. Please contact Super Admin support.",
        });
      }
      if (Number(userRecord.is_active) !== 1) {
        return res.status(403).json({
          success: false,
          message: "Your vendor account is not active. Please contact Super Admin support.",
        });
      }
      if (userRecord.locked_until && new Date(userRecord.locked_until) > new Date()) {
        return res.status(403).json({
          success: false,
          message: "Account is locked due to too many failed attempts. Try again later.",
        });
      }
      if (!userRecord.password_hash) {
        return res.status(401).json({
          success: false,
          message: "Password not set for this vendor. Please contact admin.",
        });
      }

      const isMatch = await bcrypt.compare(password, userRecord.password_hash);
      if (!isMatch) {
        const newCount = (userRecord.login_attempt_count || 0) + 1;
        let query = "UPDATE vendor_master SET login_attempt_count = ? WHERE vendor_id = ?";
        let params = [newCount, userRecord.vendor_id];
        let msg = "Invalid email or password.";

        if (newCount >= 3) {
          query = "UPDATE vendor_master SET login_attempt_count = ?, locked_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE) WHERE vendor_id = ?";
          msg = "Account locked due to 3 failed attempts. Try again in 30 minutes.";
        }
        await pool.query(query, params);
        return res.status(401).json({ success: false, message: msg });
      }

      // Generate OTP for Vendor
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      const emailSent = await sendEmail({
        to: normalizedEmail,
        subject: "Vendor Portal - 2FA Login OTP",
        text: `Your OTP for login is: ${otp}. It is valid for 5 minutes.`,
        html: `<h3>Vendor Portal Login</h3><p>Your OTP for login is: <b>${otp}</b>.</p><p>It is valid for 5 minutes.</p>`,
      });

      if (!emailSent) {
        return res.status(500).json({ success: false, message: "Failed to send OTP to your email. Please try again." });
      }

      await pool.query(
        "UPDATE vendor_master SET login_attempt_count = 0, locked_until = NULL, last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE vendor_id = ?",
        [otp, userRecord.vendor_id]
      );

      return res.status(200).json({
        success: true,
        requires2FA: true,
        portalRole: "vendor",
        verifyEndpoint: "/api/vendor/auth/verify-otp",
        resendEndpoint: "/api/auth/unified-resend-otp",
        canResend: true,
        dashboard: getDashboardUrl("vendor"),
        message: "Verification code sent to your email.",
      });
    }

    // `users` table checks: Super Admin, Client Admin, HR, Candidate
    if (userRecord.is_active !== 1) {
      return res.status(403).json({ success: false, message: "Your account is not active. Please contact support." });
    }

    // Check lock status
    if (userRecord.locked_until && new Date(userRecord.locked_until) > new Date()) {
      return res.status(403).json({
        success: false,
        message: "Account is locked due to too many failed attempts. Try again later.",
      });
    }

    // Check client suspension if applicable
    const clientId = userRecord.resolved_client_id || userRecord.client_id;
    if (clientId && (accountType === "admin" || accountType === "hr" || accountType === "candidate")) {
      const [clientRows] = await pool.query(
        "SELECT is_suspend, is_active FROM client_master WHERE client_id = ? AND is_delete = 0",
        [clientId]
      );
      if (clientRows.length > 0 && (Number(clientRows[0].is_suspend) === 1 || Number(clientRows[0].is_active) === 2)) {
        return res.status(403).json({
          success: false,
          message: "The company account is currently suspended. Please contact admin support.",
        });
      }
    }

    // Check password
    const isMatch = await bcrypt.compare(password, userRecord.password || "");
    if (!isMatch) {
      const newCount = (userRecord.login_attempt_count || 0) + 1;
      let query = "UPDATE users SET login_attempt_count = ? WHERE users_id = ?";
      let params = [newCount, userRecord.users_id];
      let msg = "Invalid email or password.";

      if (newCount >= 3) {
        query = "UPDATE users SET login_attempt_count = ?, locked_until = DATE_ADD(NOW(), INTERVAL 30 MINUTE) WHERE users_id = ?";
        msg = "Account locked due to 3 failed attempts. Try again in 30 minutes.";
      }
      await pool.query(query, params);
      return res.status(401).json({ success: false, message: msg });
    }

    // Password matches! Reset login attempts and generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const portalName =
      accountType === "super-admin"
        ? "Super Admin Portal"
        : accountType === "admin"
        ? "Client Admin Portal"
        : accountType === "hr"
        ? "HR Portal"
        : "Candidate Portal";

    const emailSent = await sendEmail({
      to: normalizedEmail,
      subject: `${portalName} - 2FA Login OTP`,
      text: `Your OTP for login is: ${otp}. It is valid for 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4F46E5;">${portalName} - Verification Code</h2>
          <p>Your One-Time Password (OTP) for login is:</p>
          <div style="background: #F3F4F6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #1F2937;">${otp}</span>
          </div>
          <p style="color: #6B7280; font-size: 14px;">⏱ This code is valid for <strong>10 minutes</strong>.</p>
          <p style="color: #9CA3AF; font-size: 12px; margin-top: 20px;">If you did not attempt to log in, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;" />
          <p style="color: #9CA3AF; font-size: 12px;">BGV Platform - Background Verification System</p>
        </div>
      `,
    });

    if (!emailSent) {
      return res.status(500).json({ success: false, message: "Failed to send OTP to your email. Please try again." });
    }

    await pool.query(
      "UPDATE users SET login_attempt_count = 0, locked_until = NULL, last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE users_id = ?",
      [otp, userRecord.users_id]
    );

    let verifyEndpoint = "/api/auth/verify-otp";

    if (accountType === "admin") {
      verifyEndpoint = "/api/client-admin/auth/verify-otp";
    } else if (accountType === "hr") {
      verifyEndpoint = "/api/hr/auth/verify-otp";
    } else if (accountType === "candidate") {
      verifyEndpoint = "/api/candidate/auth/verify-otp";
    }

    return res.status(200).json({
      success: true,
      requires2FA: true,
      portalRole: accountType,
      verifyEndpoint,
      resendEndpoint: "/api/auth/unified-resend-otp",
      canResend: true,
      dashboard: getDashboardUrl(accountType),
      message: "Verification code sent to your email.",
    });

  } catch (error) {
    console.error("Unified Login Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error. Please try again." });
  }
});

/**
 * POST /api/auth/unified-resend-otp
 * Resends OTP safely for ANY portal role (Super Admin, Client Admin, HR, Vendor, Candidate)
 * Enforces a 60-second cooldown per user
 */
router.post("/unified-resend-otp", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // 1. Check in users table
    const [users] = await pool.query(
      "SELECT * FROM users WHERE email = ? AND is_active = 1 AND is_delete = 0",
      [normalizedEmail]
    );

    let isVendor = false;
    let userRecord = null;

    if (users.length > 0) {
      userRecord = users[0];
    } else {
      // 2. Check in vendor_master table
      const [vendors] = await pool.query(
        "SELECT * FROM vendor_master WHERE poc_email = ? AND is_active = 1 AND is_delete = 0",
        [normalizedEmail]
      );
      if (vendors.length > 0) {
        userRecord = vendors[0];
        isVendor = true;
      }
    }

    if (!userRecord) {
      return res.status(404).json({ success: false, message: "Account not found." });
    }

    // Cooldown check (60 seconds)
    if (userRecord.otp_expiry) {
      const otpLifetimeMinutes = isVendor ? 5 : 10;
      const otpSetAt = new Date(userRecord.otp_expiry).getTime() - otpLifetimeMinutes * 60 * 1000;
      const secondsSinceSent = (Date.now() - otpSetAt) / 1000;
      if (secondsSinceSent < 60 && secondsSinceSent >= 0) {
        const waitSec = Math.ceil(60 - secondsSinceSent);
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSec} seconds before requesting a new code.`,
        });
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const portalName = isVendor
      ? "Vendor Portal"
      : userRecord.role_name
      ? `${userRecord.role_name} Portal`
      : "BGV Platform";

    const emailSent = await sendEmail({
      to: normalizedEmail,
      subject: `${portalName} - New Verification Code`,
      text: `Your new OTP for login is: ${otp}. It is valid for 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #4F46E5;">${portalName} - New Verification Code</h2>
          <p>Your new One-Time Password (OTP) for login is:</p>
          <div style="background: #F3F4F6; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <span style="font-size: 36px; font-weight: bold; letter-spacing: 10px; color: #1F2937;">${otp}</span>
          </div>
          <p style="color: #6B7280; font-size: 14px;">⏱ This code is valid for <strong>10 minutes</strong>.</p>
          <p style="color: #9CA3AF; font-size: 12px; margin-top: 20px;">If you did not attempt to log in, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;" />
          <p style="color: #9CA3AF; font-size: 12px;">BGV Platform - Background Verification System</p>
        </div>
      `,
    });

    if (!emailSent) {
      return res.status(500).json({ success: false, message: "Failed to send code to your email. Please try again." });
    }

    if (isVendor) {
      await pool.query(
        "UPDATE vendor_master SET last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE vendor_id = ?",
        [otp, userRecord.vendor_id]
      );
    } else {
      await pool.query(
        "UPDATE users SET last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE users_id = ?",
        [otp, userRecord.users_id]
      );
    }

    return res.status(200).json({
      success: true,
      message: "A new verification code has been sent to your registered email.",
    });
  } catch (error) {
    console.error("Unified Resend OTP Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error. Please try again." });
  }
});

/**
 * POST /api/auth/unified-forgot-password and /api/auth/forgot-password
 * Identifies the account role and sends the appropriate password reset email with correct reset link
 */
const handleForgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email is required." });
    }
    const normalizedEmail = email.trim().toLowerCase();

    // Generic safe response to prevent email harvesting
    const safeSuccessResponse = () =>
      res.status(200).json({
        success: true,
        message: "If an account matches that email, password reset instructions have been sent.",
      });

    const [users] = await pool.query(
      "SELECT users_id, first_name, last_name, email, username, role_name FROM users WHERE email = ? AND is_active = 1 AND is_delete = 0",
      [normalizedEmail]
    );

    const frontendUrl = (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost"))
      ? process.env.FRONTEND_URL.replace(/\/+$/, "")
      : "https://bgv.dqnex.online";

    if (users.length > 0) {
      const user = users[0];
      const roleType = normalizeRoleType(user.role_name);
      const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.username || user.email;

      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

      await pool.query(
        "UPDATE users SET password_reset_token = ?, password_reset_expiry = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE users_id = ?",
        [resetTokenHash, user.users_id]
      );

      let resetPath = "/super-admin/reset-password";
      if (roleType === "admin") resetPath = "/admin/reset-password";
      else if (roleType === "hr") resetPath = "/hr/reset-password";
      else if (roleType === "candidate") resetPath = "/candidate/reset-password";

      const resetLink = `${frontendUrl}${resetPath}?token=${resetToken}&email=${encodeURIComponent(user.email)}`;

      await sendEmail({
        to: user.email,
        subject: "BGV Platform - Password Reset Request",
        text: `You requested a password reset. Click the link below to reset your password:\n\n${resetLink}\n\nThis link is valid for 24 hours.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4F46E5;">Password Reset Request</h2>
            <p>Hello ${displayName},</p>
            <p>You requested a password reset for your account. Click the button below to set a new password:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" style="background-color: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
            </div>
            <p style="color: #6B7280; font-size: 14px;">This link is valid for <strong>24 hours</strong>.</p>
          </div>
        `,
      });

      return safeSuccessResponse();
    }

    // Check Vendor
    const [vendors] = await pool.query(
      "SELECT vendor_id, poc_first_name, poc_last_name, poc_email, company_name FROM vendor_master WHERE poc_email = ? AND is_delete = 0",
      [normalizedEmail]
    );

    if (vendors.length > 0) {
      const vendor = vendors[0];
      const vendorDisplayName = [vendor.poc_first_name, vendor.poc_last_name].filter(Boolean).join(" ").trim() || vendor.company_name || "Vendor";
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenHash = crypto.createHash("sha256").update(resetToken).digest("hex");

      await pool.query(
        "UPDATE vendor_master SET password_reset_token = ?, password_reset_expiry = DATE_ADD(NOW(), INTERVAL 24 HOUR) WHERE vendor_id = ?",
        [resetTokenHash, vendor.vendor_id]
      );

      const resetLink = `${frontendUrl}/vendor/reset-password?token=${resetToken}&email=${encodeURIComponent(vendor.poc_email)}`;

      await sendEmail({
        to: vendor.poc_email,
        subject: "Vendor Portal - Password Reset Request",
        text: `You requested a password reset. Click the link below to reset your password:\n\n${resetLink}\n\nThis link is valid for 24 hours.`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4F46E5;">Password Reset Request</h2>
            <p>Hello ${vendorDisplayName},</p>
            <p>You requested a password reset for your Vendor account. Click the button below:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetLink}" style="background-color: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
            </div>
            <p style="color: #6B7280; font-size: 14px;">This link is valid for <strong>24 hours</strong>.</p>
          </div>
        `,
      });

      return safeSuccessResponse();
    }

    return safeSuccessResponse();
  } catch (error) {
    console.error("Unified Forgot Password Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error. Please try again." });
  }
};

router.post("/unified-forgot-password", handleForgotPassword);
router.post("/forgot-password", handleForgotPassword);

/**
 * GET /api/auth/setup-info
 * Returns email & user details associated with setup/reset token across all roles
 */
router.get("/setup-info", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ success: false, message: "Token is required." });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Check users table
    const [users] = await pool.query(
      "SELECT users_id, email, first_name, last_name, role_name FROM users WHERE (password_reset_token = ? OR password_reset_token = ?) AND is_delete = 0",
      [token, tokenHash]
    );

    if (users.length > 0) {
      return res.status(200).json({
        success: true,
        email: users[0].email,
        name: [users[0].first_name, users[0].last_name].filter(Boolean).join(" ").trim(),
        role: users[0].role_name,
      });
    }

    // Check vendor_master table
    const [vendors] = await pool.query(
      "SELECT vendor_id, poc_email, poc_first_name, poc_last_name, company_name FROM vendor_master WHERE (password_reset_token = ? OR password_reset_token = ?) AND is_delete = 0",
      [token, tokenHash]
    );

    if (vendors.length > 0) {
      return res.status(200).json({
        success: true,
        email: vendors[0].poc_email,
        name: [vendors[0].poc_first_name, vendors[0].poc_last_name].filter(Boolean).join(" ").trim() || vendors[0].company_name,
        role: "Vendor",
      });
    }

    return res.status(404).json({ success: false, message: "Invalid or expired setup token." });
  } catch (error) {
    console.error("Unified Setup Info Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

/**
 * POST /api/auth/send-setup-otp
 * Sends OTP for password setup across all roles
 */
router.post("/send-setup-otp", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: "Token is required." });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Check users table
    const [users] = await pool.query(
      "SELECT users_id, email, first_name FROM users WHERE (password_reset_token = ? OR password_reset_token = ?) AND is_delete = 0",
      [token, tokenHash]
    );

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    if (users.length > 0) {
      const user = users[0];
      await pool.query(
        "UPDATE users SET last_otp = ?, otp_expiry = ? WHERE users_id = ?",
        [otp, otpExpiry, user.users_id]
      );

      sendEmail({
        to: user.email,
        subject: "Your OTP for Password Setup - BGV Platform",
        text: `Your OTP to set your password is: ${otp}. It is valid for 10 minutes.`,
        html: `<h3>Password Setup OTP</h3><p>Your OTP is: <b style="font-size: 20px; color: #4F46E5;">${otp}</b></p><p>It is valid for 10 minutes.</p>`,
      }).catch(err => console.warn("Background email error:", err));

      return res.status(200).json({ success: true, message: "OTP sent successfully." });
    }

    // Check vendor_master table
    const [vendors] = await pool.query(
      "SELECT vendor_id, poc_email, poc_first_name FROM vendor_master WHERE (password_reset_token = ? OR password_reset_token = ?) AND is_delete = 0",
      [token, tokenHash]
    );

    if (vendors.length > 0) {
      const vendor = vendors[0];
      await pool.query(
        "UPDATE vendor_master SET last_otp = ?, otp_expiry = ? WHERE vendor_id = ?",
        [otp, otpExpiry, vendor.vendor_id]
      );

      sendEmail({
        to: vendor.poc_email,
        subject: "Vendor Portal - Password Setup OTP",
        text: `Your OTP to set your password is: ${otp}. It is valid for 10 minutes.`,
        html: `<h3>Password Setup OTP</h3><p>Your OTP is: <b style="font-size: 20px; color: #4F46E5;">${otp}</b></p><p>It is valid for 10 minutes.</p>`,
      }).catch(err => console.warn("Background email error:", err));

      return res.status(200).json({ success: true, message: "OTP sent successfully." });
    }

    return res.status(404).json({ success: false, message: "Invalid or expired setup token." });
  } catch (error) {
    console.error("Unified Send Setup OTP Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

/**
 * POST /api/auth/set-password
 * Verifies OTP and updates password across all roles
 */
router.post("/set-password", async (req, res) => {
  try {
    const { token, otp, password } = req.body;
    if (!token || !otp || !password) {
      return res.status(400).json({ success: false, message: "Token, OTP, and password are required." });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    // Check users table
    const [users] = await pool.query(
      "SELECT users_id, last_otp, otp_expiry FROM users WHERE (password_reset_token = ? OR password_reset_token = ?) AND is_delete = 0",
      [token, tokenHash]
    );

    if (users.length > 0) {
      const user = users[0];
      if (!user.last_otp || user.last_otp !== otp) {
        return res.status(400).json({ success: false, message: "Invalid OTP." });
      }
      if (new Date(user.otp_expiry) < new Date()) {
        return res.status(400).json({ success: false, message: "OTP has expired." });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(
        "UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expiry = NULL, last_otp = NULL, otp_expiry = NULL WHERE users_id = ?",
        [hashedPassword, user.users_id]
      );

      return res.status(200).json({ success: true, message: "Password set successfully." });
    }

    // Check vendor_master table
    const [vendors] = await pool.query(
      "SELECT vendor_id, last_otp, otp_expiry FROM vendor_master WHERE (password_reset_token = ? OR password_reset_token = ?) AND is_delete = 0",
      [token, tokenHash]
    );

    if (vendors.length > 0) {
      const vendor = vendors[0];
      if (!vendor.last_otp || vendor.last_otp !== otp) {
        return res.status(400).json({ success: false, message: "Invalid OTP." });
      }
      if (new Date(vendor.otp_expiry) < new Date()) {
        return res.status(400).json({ success: false, message: "OTP has expired." });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query(
        "UPDATE vendor_master SET password = ?, password_reset_token = NULL, password_reset_expiry = NULL, last_otp = NULL, otp_expiry = NULL WHERE vendor_id = ?",
        [hashedPassword, vendor.vendor_id]
      );

      return res.status(200).json({ success: true, message: "Password set successfully." });
    }

    return res.status(400).json({ success: false, message: "Invalid or expired setup token." });
  } catch (error) {
    console.error("Unified Set Password Error:", error);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
});

export default router;
