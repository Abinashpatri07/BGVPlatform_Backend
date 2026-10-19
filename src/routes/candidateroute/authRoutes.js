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
 * Step 1: Verify email+password → send OTP to email
 */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required." });
    }

    // Find candidate user
    const [rows] = await pool.query(
      `SELECT u.*, c.candidate_experience, c.cand_id, COALESCE(u.client_id, c.client_id) AS client_id 
       FROM users u
       LEFT JOIN candidate c ON u.email = c.candidate_email
       WHERE u.email = ? AND u.is_delete = 0 AND u.is_active = 1`,
      [email.trim().toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid email or password." });
    }

    const user = rows[0];

    // Check if Client Company is Suspended
    const candidateClientId = user.client_id;
    if (candidateClientId) {
      const [clientRows] = await pool.query(
        "SELECT is_suspend, is_active FROM client_master WHERE client_id = ? AND is_delete = 0",
        [candidateClientId]
      );
      if (clientRows.length > 0 && (Number(clientRows[0].is_suspend) === 1 || Number(clientRows[0].is_active) === 2)) {
        return res.status(403).json({
          success: false,
          message: "The hiring company's account is currently suspended. Please contact the company HR or support.",
        });
      }
    }

    // Check role
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

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    console.log(`\n\n=== [DEVELOPMENT] OTP for Candidate ${email} is: ${otp} ===\n\n`);

    // Send OTP email
    const emailSent = await sendEmail({
      to: email,
      subject: "Candidate Portal - Login OTP",
      text: `Your OTP for login is: ${otp}. It is valid for 5 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
          <h2 style="color: #1e1b8b; margin-bottom: 4px;">BGV Candidate Portal</h2>
          <p style="color: #6b7280; font-size: 14px;">Login Verification</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
          <p style="color: #374151; font-size: 15px;">Your One-Time Password (OTP) for login is:</p>
          <div style="font-size: 36px; font-weight: 800; letter-spacing: 12px; color: #1e1b8b; text-align: center; padding: 16px 0;">
            ${otp}
          </div>
          <p style="color: #6b7280; font-size: 13px; text-align: center;">This OTP is valid for <strong>5 minutes</strong>. Do not share it with anyone.</p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 16px 0;" />
          <p style="color: #9ca3af; font-size: 12px;">If you did not attempt to login, please ignore this email.</p>
        </div>
      `,
    });

    if (!emailSent) {
      console.error(`Failed to send OTP email to ${email}`);
      return res.status(500).json({
        success: false,
        message: "Failed to send OTP to your email address. Please try again.",
      });
    }

    // Save OTP in DB
    await pool.query(
      "UPDATE users SET last_otp = ?, otp_expiry = DATE_ADD(NOW(), INTERVAL 5 MINUTE) WHERE users_id = ?",
      [otp, user.users_id]
    );

    return res.status(200).json({
      success: true,
      otpSent: true,
      message: "OTP sent to your registered email address.",
      email: user.email, // return email so frontend can use it in step 2
    });

  } catch (err) {
    console.error("Candidate Login Error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

/**
 * POST /api/candidate/auth/verify-otp
 * Step 2: Verify OTP → return JWT token
 */
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ success: false, message: "Email and OTP are required." });
    }

    const [rows] = await pool.query(
      `SELECT u.*, c.candidate_experience, c.cand_id 
       FROM users u
       LEFT JOIN candidate c ON u.email = c.candidate_email
       WHERE u.email = ? AND u.is_delete = 0 AND u.is_active = 1`,
      [email.trim().toLowerCase()]
    );

    if (rows.length === 0) {
      return res.status(401).json({ success: false, message: "User not found." });
    }

    const user = rows[0];

    // Check OTP
    if (!user.last_otp || user.last_otp !== otp.toString()) {
      return res.status(401).json({ success: false, message: "Invalid OTP. Please try again." });
    }

    // Check OTP expiry
    if (new Date(user.otp_expiry) < new Date()) {
      return res.status(401).json({ success: false, message: "OTP has expired. Please login again." });
    }

    // Clear OTP after successful verification
    await pool.query(
      "UPDATE users SET last_otp = NULL, otp_expiry = NULL WHERE users_id = ?",
      [user.users_id]
    );

    // Generate JWT
    const token = jwt.sign(
      { users_id: user.users_id, email: user.email, role: user.role_name },
      JWT_SECRET,
      { expiresIn: "24h" }
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
        cand_id: user.cand_id,
      },
    });

  } catch (err) {
    console.error("Candidate OTP Verify Error:", err);
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
      return res.status(404).json({ success: false, message: "Account not with this email-id" });
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
