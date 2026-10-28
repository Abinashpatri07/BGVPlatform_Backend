import express from "express";
import pool from "../../config/db.js";
import validateCreateHR from "../../middleware/superadmin/validateCreateHR.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { sendEmail } from "../../utils/sendEmail.js";
import { verifyToken } from "../../middleware/authMiddleware.js";

const router = express.Router();
import apiLogger from "../../middleware/apiLogger.js";

router.use(apiLogger({ sourceService: "Super Admin Portal", destinationService: "Backend API" }));
router.use(verifyToken);

const sendHRWelcomeEmailHelper = async (hr) => {
  const hrId = hr.id || hr.users_id;
  const setupToken = crypto.randomBytes(32).toString("hex");
  const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

  await pool.query(
    "UPDATE users SET password_reset_token = ?, password_reset_expiry = ? WHERE users_id = ?",
    [setupToken, tokenExpiry, hrId]
  );

  const baseUrl = (process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes("localhost"))
    ? process.env.FRONTEND_URL.replace(/\/+$/, "")
    : "https://bgv-platformdemo.vercel.app";
  const portalUrl = `${baseUrl}/hr-setup-password?token=${setupToken}`;
  const hrName = `${hr.firstName || hr.first_name || ""} ${hr.lastName || hr.last_name || ""}`.trim() || "HR Officer";
  const hrEmail = (hr.email || "").trim().toLowerCase();
  const empId = hr.empId || hr.employee_id || "HR Officer";
  const roleName = hr.role || hr.role_name || "HR";

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h2 style="color: #01026E; margin: 0; font-size: 24px;">Welcome to BGV Platform</h2>
        <p style="color: #64748b; font-size: 14px; margin-top: 6px;">Human Resources Portal Access</p>
      </div>
      <p style="font-size: 15px;">Dear <b>${hrName}</b>,</p>
      <p style="font-size: 14px; line-height: 1.6; color: #475569;">
        Your HR account has been created on the BGV Verification Platform. You have been assigned the role of <b>${roleName}</b> (Employee ID: <b>${empId}</b>).
      </p>
      <p style="font-size: 14px; line-height: 1.6; color: #475569;">
        Please click the button below to securely set your password and access the HR Portal:
      </p>
      <div style="text-align: center; margin: 30px 0;">
        <a href="${portalUrl}" style="background-color: #01026E; color: #ffffff; padding: 12px 28px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; display: inline-block;">
          Set Up My Password
        </a>
      </div>
      <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
        Or copy and paste this link in your browser:<br/>
        <a href="${portalUrl}" style="color: #4338CA; word-break: break-all;">${portalUrl}</a>
      </p>
      <p style="font-size: 12px; color: #94a3b8; margin-top: 15px;">
        <i>Note: This setup link is valid for 48 hours. If you did not expect this invitation, please contact your Super Admin.</i>
      </p>
      <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0;" />
      <p style="font-size: 12px; color: #94a3b8; text-align: center; margin: 0;">
        &copy; ${new Date().getFullYear()} BGV Platform. All rights reserved.
      </p>
    </div>
  `;

  return sendEmail({
    to: hrEmail,
    subject: "Welcome to BGV Platform - Set Up Your HR Account Password",
    text: `Dear ${hrName},\n\nWelcome to BGV Platform!\n\nYour HR account (${empId}) has been created with role ${roleName}. Please set up your password at:\n${portalUrl}\n\nThis link is valid for 48 hours.\n\nBest regards,\nBGV Platform Team`,
    html: emailHtml,
  });
};

/**
 * @swagger
 * /api/hr/create:
 *   post:
 *     summary: Create a new HR (Super Admin)
 *     tags: [Super Admin - HR]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - empId
 *               - firstName
 *               - lastName
 *               - email
 *               - phone
 *               - role
 *     responses:
 *       201:
 *         description: HR Created Successfully
 *       400:
 *         description: Validation Error
 *       409:
 *         description: Duplicate email or empId
 *       500:
 *         description: Internal Server Error
 */
router.post(
  "/create",
  validateCreateHR,
  async (req, res) => {
    try {
      const { empId, firstName, lastName, email, phone, role } = req.body;

      /* ── DUPLICATE EMP ID CHECK ── */
      const [empCheck] = await pool.query(
        "SELECT users_id FROM users WHERE employee_id = ? AND is_delete = 0",
        [empId.trim().toUpperCase()]
      );
      if (empCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { empId: "An HR with this Employee ID already exists" },
        });
      }

      /* ── DUPLICATE EMAIL CHECK ── */
      const [emailCheck] = await pool.query(
        "SELECT users_id FROM users WHERE email = ? AND is_delete = 0",
        [email.trim().toLowerCase()]
      );
      if (emailCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { email: "An HR with this email already exists" },
        });
      }

      /* ── DUPLICATE PHONE CHECK ── */
      const fullPhone = phone.startsWith("+") ? phone.trim() : `+91${phone.trim()}`;
      const [phoneCheck] = await pool.query(
        "SELECT users_id FROM users WHERE mobile = ? AND is_delete = 0",
        [fullPhone]
      );
      if (phoneCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { phone: "An HR with this phone number already exists" },
        });
      }

      // Default password hash
      const defaultPassword = "Password@123";
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(defaultPassword, salt);

      // Determine role_id based on role name
      let role_id = 2; // default
      if (role === "HR") role_id = 2;
      else if (role === "HR Manager") role_id = 3;

      // Generate username
      const baseUsername = email.trim().toLowerCase().split("@")[0];
      const username = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

      /* ── INSERT ── */
      const [result] = await pool.query(
        `INSERT INTO users
          (employee_id, first_name, last_name, username, email, mobile, role_name, role_id, password, client_id, created_by, is_active, is_delete, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 1, 0, NOW(), NOW())`,
        [
          empId.trim().toUpperCase(),
          firstName.trim(),
          lastName.trim(),
          username,
          email.trim().toLowerCase(),
          fullPhone,
          role.trim(),
          role_id,
          hashedPassword
        ]
      );

      // Send welcome & setup password email to HR
      sendHRWelcomeEmailHelper({
        id: result.insertId,
        empId,
        firstName,
        lastName,
        email,
        role,
      }).catch(err => console.error("Error sending welcome email to HR on create:", err));

      return res.status(201).json({
        success: true,
        message: "HR Created Successfully",
        hrId: result.insertId,
      });

    } catch (error) {
      console.error("create-hr error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
);

/**
 * @swagger
 * /api/hr/get-all:
 *   get:
 *     summary: Get all HRs with pagination
 *     tags: [Super Admin - HR]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of HRs with pagination and stats
 *       500:
 *         description: Internal Server Error
 */
router.get("/get-all", async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(
      `SELECT
        users_id     AS id,
        employee_id  AS empId,
        first_name   AS firstName,
        last_name    AS lastName,
        email,
        mobile       AS phone,
        role_name    AS role,
        is_active    AS isActive,
        created_at   AS createdAt,
        CASE
          WHEN password_reset_token IS NULL AND password IS NOT NULL AND password != ''
          THEN 1 ELSE 0
        END AS is_password_set
      FROM users
      WHERE is_delete = 0 AND role_name IN ('HR', 'HR 2', 'HR Executive', 'HR Manager', 'HR User')
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[stats]] = await pool.query(
        `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN is_active = 2 THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN is_active = 3 THEN 1 ELSE 0 END) AS \`terminated\`
       FROM users
       WHERE is_delete = 0 AND role_name IN ('HR', 'HR 2', 'HR Executive', 'HR Manager', 'HR User')`
    );

    const totalCount = parseInt(stats.total) || 0;

    return res.status(200).json({
      success: true,
      data: rows,
      stats: {
        total:      totalCount,
        active:     parseInt(stats.active)     || 0,
        inactive:   parseInt(stats.inactive)   || 0,
        terminated: parseInt(stats.terminated) || 0,
      },
      pagination: {
        total:      totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit),
      },
    });

  } catch (error) {
    console.error("get-all-hrs error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/hr/get/{id}:
 *   get:
 *     summary: Get a single HR by ID
 *     tags: [Super Admin - HR]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: HR details
 *       404:
 *         description: HR not found
 *       500:
 *         description: Internal Server Error
 */
router.get("/get/:id", async (req, res) => {
  try {
    const hrId = parseInt(req.params.id);
    if (!hrId || isNaN(hrId)) {
      return res.status(400).json({ success: false, message: "Invalid HR ID" });
    }

    const [rows] = await pool.query(
      `SELECT
        users_id   AS id,
        employee_id AS empId,
        first_name  AS firstName,
        last_name   AS lastName,
        email,
        mobile     AS phone,
        role_name  AS role,
        is_active  AS isActive,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM users
      WHERE users_id = ? AND is_delete = 0`,
      [hrId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "HR not found" });
    }

    return res.status(200).json({ success: true, data: rows[0] });

  } catch (error) {
    console.error("get-hr error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/hr/terminate/{id}:
 *   patch:
 *     summary: Terminate an HR
 *     tags: [Super Admin - HR]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *     responses:
 *       200:
 *         description: HR terminated successfully
 *       400:
 *         description: Invalid request
 *       404:
 *         description: HR not found
 *       500:
 *         description: Internal Server Error
 */
router.patch("/terminate/:id", async (req, res) => {
  try {
    const hrId = parseInt(req.params.id);
    if (!hrId || isNaN(hrId)) {
      return res.status(400).json({ success: false, message: "Invalid HR ID" });
    }

    const { reason } = req.body;
    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: "Termination reason is required" });
    }

    const [existing] = await pool.query(
      "SELECT users_id, is_active FROM users WHERE users_id = ? AND is_delete = 0",
      [hrId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "HR not found" });
    }
    if (Number(existing[0].is_active) === 3) {
      return res.status(400).json({ success: false, message: "HR is already terminated" });
    }

    await pool.query(
      "UPDATE users SET is_active = 3, inactive_comments = ?, updated_at = NOW() WHERE users_id = ?",
      [reason.trim(), hrId]
    );

    return res.status(200).json({ success: true, message: "HR terminated successfully" });

  } catch (error) {
    console.error("terminate-hr error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/hr/update/{id}:
 *   patch:
 *     summary: Update an existing HR
 *     tags: [Super Admin - HR]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - phone
 *               - role
 *     responses:
 *       200:
 *         description: HR Updated Successfully
 *       400:
 *         description: Validation Error
 *       404:
 *         description: HR not found
 *       409:
 *         description: Duplicate email or phone
 *       500:
 *         description: Internal Server Error
 */
router.patch("/update/:id", async (req, res) => {
  try {
    const hrId = parseInt(req.params.id);
    if (!hrId || isNaN(hrId)) {
      return res.status(400).json({ success: false, message: "Invalid HR ID" });
    }

    const { firstName, lastName, email, phone, role } = req.body;

    const [existing] = await pool.query(
      "SELECT users_id FROM users WHERE users_id = ? AND is_delete = 0",
      [hrId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "HR not found" });
    }

    // Duplicate email check (excluding current HR)
    const [emailCheck] = await pool.query(
      "SELECT users_id FROM users WHERE email = ? AND users_id != ? AND is_delete = 0",
      [email.trim().toLowerCase(), hrId]
    );
    if (emailCheck.length > 0) {
      return res.status(409).json({ success: false, errors: { email: "An HR with this email already exists" } });
    }

    // Duplicate phone check
    const fullPhone = phone.startsWith("+") ? phone.trim() : `+91${phone.trim()}`;
    const [phoneCheck] = await pool.query(
      "SELECT users_id FROM users WHERE mobile = ? AND users_id != ? AND is_delete = 0",
      [fullPhone, hrId]
    );
    if (phoneCheck.length > 0) {
      return res.status(409).json({ success: false, errors: { phone: "An HR with this phone number already exists" } });
    }

    let role_id = 2; // default
    if (role === "HR") role_id = 2;
    else if (role === "HR Manager") role_id = 3;

    await pool.query(
      `UPDATE users SET 
         first_name = ?, 
         last_name = ?, 
         email = ?, 
         mobile = ?, 
         role_name = ?, 
         role_id = ?, 
         updated_at = NOW() 
       WHERE users_id = ?`,
      [firstName.trim(), lastName.trim(), email.trim().toLowerCase(), fullPhone, role.trim(), role_id, hrId]
    );

    return res.status(200).json({ success: true, message: "HR Updated Successfully" });
  } catch (error) {
    console.error("update-hr error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/hr/send-email/{id}:
 *   post:
 *     summary: Send or resend setup invitation email to HR
 *     tags: [Super Admin - HR]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Email sent successfully
 *       404:
 *         description: HR not found
 *       500:
 *         description: Internal Server Error
 */
router.post("/send-email/:id", async (req, res) => {
  try {
    const hrId = parseInt(req.params.id);
    if (!hrId || isNaN(hrId)) {
      return res.status(400).json({ success: false, message: "Invalid HR ID" });
    }

    const [rows] = await pool.query(
      `SELECT users_id AS id, employee_id AS empId, first_name AS firstName, last_name AS lastName, email, mobile AS phone, role_name AS role, is_active AS isActive
       FROM users
       WHERE users_id = ? AND is_delete = 0`,
      [hrId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "HR not found" });
    }

    const hr = rows[0];
    const emailSuccess = await sendHRWelcomeEmailHelper(hr);

    if (!emailSuccess) {
      return res.status(500).json({
        success: false,
        message: "Failed to send email. Please check your mail service configuration.",
      });
    }

    return res.status(200).json({
      success: true,
      message: `Setup email sent successfully to ${hr.email}`,
    });
  } catch (error) {
    console.error("send-hr-email error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

export default router;