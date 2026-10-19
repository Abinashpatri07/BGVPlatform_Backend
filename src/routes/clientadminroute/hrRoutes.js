import express from "express";
import pool from "../../config/db.js";
import bcrypt from "bcryptjs";
import validateCreateHR from "../../middleware/clientadmin/validateCreateHR.js";

const router = express.Router();
import apiLogger from "../../middleware/apiLogger.js";
import { verifyToken } from "../../middleware/authMiddleware.js";

router.use(apiLogger({ sourceService: "Client Admin Portal", destinationService: "Backend API" }));
router.use(verifyToken);

// ── CREATE HR ────────────────────────────────────────────────
router.post("/create", validateCreateHR, async (req, res) => {
  try {
    const { empId, firstName, lastName, email, phone, role } = req.body;
    const clientId = req.user.client_id;
    const createdBy = req.user.id;

    /* DUPLICATE EMP ID CHECK */
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

    /* DUPLICATE EMAIL CHECK */
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

    /* DUPLICATE PHONE CHECK */
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

    // Default password
    const defaultPassword = "Password@123";
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(defaultPassword, salt);

    // Role ID
    let role_id = 2;
    if (role === "HR") role_id = 2;
    else if (role === "HR Manager") role_id = 3;

    // Generate unique username from email
    const baseUsername = email.trim().toLowerCase().split("@")[0];
    const username = `${baseUsername}_${Math.floor(1000 + Math.random() * 9000)}`;

    /* INSERT */
    const [result] = await pool.query(
      `INSERT INTO users
        (employee_id, first_name, last_name, username, email, mobile, role_name, role_id, password, client_id, created_by, is_active, is_delete, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NOW(), NOW())`,
      [
        empId.trim().toUpperCase(),
        firstName.trim(),
        lastName.trim(),
        username,
        email.trim().toLowerCase(),
        fullPhone,
        role.trim(),
        role_id,
        hashedPassword,
        clientId,
        createdBy, // created_by = logged in user
      ]
    );

    return res.status(201).json({
      success: true,
      message: "HR Created Successfully",
      hrId: result.insertId,
    });
  } catch (error) {
    console.error("create-hr error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// ── GET ALL HRs ──────────────────────────────────────────────
router.get("/get-all", async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const clientId = req.user.client_id;

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
        created_at AS createdAt
      FROM users
      WHERE is_delete = 0 AND client_id = ? AND role_name IN ('HR', 'HR 2', 'HR Executive', 'HR Manager', 'HR User')
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [clientId, limit, offset]
    );

    const [[stats]] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN is_active = 2 THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN is_active = 3 THEN 1 ELSE 0 END) AS \`terminated\`
       FROM users
       WHERE is_delete = 0 AND client_id = ? AND role_name IN ('HR', 'HR 2', 'HR Executive', 'HR Manager', 'HR User')`,
      [clientId]
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

// ── GET SINGLE HR ────────────────────────────────────────────
router.get("/get/:id", async (req, res) => {
  try {
    const hrId = parseInt(req.params.id);
    const clientId = req.user.client_id;
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
      WHERE users_id = ? AND client_id = ? AND is_delete = 0`,
      [hrId, clientId]
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

// ── TERMINATE HR ─────────────────────────────────────────────
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

    /* ── 1) CHECK IF HR EXISTS ── */
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

    /* ── 2) MARK AS TERMINATED ── */
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

// ── UPDATE HR ─────────────────────────────────────────────────
router.patch("/update/:id", async (req, res) => {
  try {
    const hrId = parseInt(req.params.id);
    if (!hrId || isNaN(hrId)) {
      return res.status(400).json({ success: false, message: "Invalid HR ID" });
    }

    const { firstName, lastName, email, phone, role } = req.body;

    /* 1) CHECK HR EXISTS */
    const [existing] = await pool.query(
      "SELECT users_id FROM users WHERE users_id = ? AND is_delete = 0",
      [hrId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "HR not found" });
    }

    /* 2) DUPLICATE EMAIL CHECK (EXCLUDING CURRENT HR) */
    const [emailCheck] = await pool.query(
      "SELECT users_id FROM users WHERE email = ? AND users_id != ? AND is_delete = 0",
      [email.trim().toLowerCase(), hrId]
    );
    if (emailCheck.length > 0) {
      return res.status(409).json({ success: false, errors: { email: "An HR with this email already exists" } });
    }

    /* 3) DUPLICATE PHONE CHECK (EXCLUDING CURRENT HR) */
    const fullPhone = phone.startsWith("+") ? phone.trim() : `+91${phone.trim()}`;
    const [phoneCheck] = await pool.query(
      "SELECT users_id FROM users WHERE mobile = ? AND users_id != ? AND is_delete = 0",
      [fullPhone, hrId]
    );
    if (phoneCheck.length > 0) {
      return res.status(409).json({ success: false, errors: { phone: "An HR with this phone number already exists" } });
    }

    let role_id = 2;
    if (role === "HR") role_id = 2;
    else if (role === "HR Manager") role_id = 3;

    /* 4) UPDATE */
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
      [
        firstName.trim(),
        lastName.trim(),
        email.trim().toLowerCase(),
        fullPhone,
        role.trim(),
        role_id,
        hrId
      ]
    );

    return res.status(200).json({ success: true, message: "HR Updated Successfully" });
  } catch (error) {
    console.error("update-hr error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// ── OVERVIEW STATS ────────────────────────────────────────────
router.get("/overview", async (req, res) => {
  try {
    const clientId = req.user.client_id;
    const [[stats]] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN is_active = 2 THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN is_active = 3 THEN 1 ELSE 0 END) AS \`terminated\`
       FROM users
       WHERE is_delete = 0 AND client_id = ? AND role_name IN ('HR', 'HR 2', 'HR Executive', 'HR Manager', 'HR User')`,
      [clientId]
    );

    return res.status(200).json({
      success: true,
      data: {
        total:      parseInt(stats.total)      || 0,
        active:     parseInt(stats.active)     || 0,
        inactive:   parseInt(stats.inactive)   || 0,
        terminated: parseInt(stats.terminated) || 0,
      },
    });
  } catch (error) {
    console.error("overview error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

export default router;