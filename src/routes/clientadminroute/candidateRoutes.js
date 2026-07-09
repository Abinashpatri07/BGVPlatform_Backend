import express from "express";
import { v4 as uuidv4 } from "uuid";
import validateCandidateAction from "../../middleware/clientadmin/validateCandidateAction.js";
import validateCreateCandidate from "../../middleware/clientadmin/validateCreateCandidate.js";
import pool from "../../config/db.js";
import multer from "multer";
import * as XLSX from "xlsx";

const upload = multer({ dest: "uploads/" });
const router = express.Router();
import apiLogger from "../../middleware/apiLogger.js";

router.use(apiLogger({ sourceService: "Client Admin Portal", destinationService: "Backend API" }));

/**
 * @swagger
 * /api/client-admin/candidate/create:
 *   post:
 *     summary: Create a new Candidate (Client Admin)
 *     tags: [Client Admin - Candidate]
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
 *               - clientAdminId
 *               - cmId
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Rohit
 *               lastName:
 *                 type: string
 *                 example: Verma
 *               email:
 *                 type: string
 *                 example: rohit@email.com
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *               clientAdminId:
 *                 type: integer
 *                 example: 1
 *                 description: Logged-in Client Admin's users_id
 *               cmId:
 *                 type: integer
 *                 example: 1
 *                 description: Client Company's cm_id
 *               jobFunction:
 *                 type: string
 *                 example: Software Engineer
 *               tag:
 *                 type: string
 *                 example: urgent
 *     responses:
 *       201:
 *         description: Candidate Created Successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 caseId:
 *                   type: string
 *                   example: CASE-AB123456
 *       400:
 *         description: Validation Error
 *       409:
 *         description: Candidate with this email already exists
 *       500:
 *         description: Server Error
 */
router.post(
  "/create",
  validateCreateCandidate,
  async (req, res) => {

    const {
      firstName,
      lastName,
      phone,
      email,
      clientAdminId,
      jobFunction,
      tag,
    } = req.body;

    try {

      // Check if email already exists
      const [existingCand] = await pool.execute(
        "SELECT cand_id FROM candidate WHERE candidate_email = ? AND is_delete = 0",
        [email.trim().toLowerCase()]
      );

      if (existingCand.length > 0) {
        return res.status(409).json({
          success: false,
          field: "email",
          message: "A candidate with this email already exists"
        });
      }

      // Check if phone already exists
      const [existingPhone] = await pool.execute(
        "SELECT cand_id FROM candidate WHERE candidate_mobile = ? AND is_delete = 0",
        [phone.trim()]
      );

      if (existingPhone.length > 0) {
        return res.status(409).json({
          success: false,
          field: "phone",
          message: "A candidate with this phone number already exists"
        });
      }

      // Generate a temporary candidate_id to satisfy NOT NULL constraint
      const tempId = "TEMP-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);

      const [result] = await pool.execute(
        `INSERT INTO candidate
          (candidate_id, client_id, created_by_users, candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag, verification_status, is_active, is_delete, created_at, updated_at)
         VALUES
          (?, 1, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, NOW(), NOW())`,
        [
          tempId,
          clientAdminId || null,
          firstName.trim(),
          lastName.trim(),
          email.trim().toLowerCase(),
          phone.trim(),
          jobFunction || null,
          tag || null,
        ]
      );

      const newCandId = result.insertId;
      const finalCandidateId = "CAND" + String(newCandId).padStart(4, "0");

      // Update with the final sequential candidate_id
      await pool.execute(
        `UPDATE candidate SET candidate_id = ? WHERE cand_id = ?`,
        [finalCandidateId, newCandId]
      );

      return res.status(201).json({
        success: true,
        message: "Candidate Created Successfully",
      });

    } catch (err) {

      console.error("Create Candidate Error:", err);

      if (err.code === "ER_DUP_ENTRY") {
        return res.status(409).json({
          success: false,
          message: "A candidate with this email already exists",
        });
      }

      return res.status(500).json({
        success: false,
        message: "Server error. Please try again.",
      });

    }

  }
);

/**
 * @swagger
 * /api/client-admin/candidate/bulk-create:
 *   post:
 *     summary: Bulk Create Candidates (Client Admin)
 *     tags: [Client Admin - Candidate]
 */
router.post(
  "/bulk-create",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: "File is required" });
      }

      const clientAdminId = req.body.clientAdminId || 2;

      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

      if (data.length === 0) {
        return res.status(400).json({ success: false, message: "File is empty" });
      }

      const created = [];
      const skipped = [];

      for (let i = 0; i < data.length; i++) {
        const item = data[i];

        const firstName = item["First Name"] || item.firstName || item.name?.split(" ")[0] || "";
        const lastName = item["Last Name"] || item.lastName || item.name?.split(" ").slice(1).join(" ") || "";
        const phone = item["Phone"] || item.phone || "";
        const email = item["Email"] || item.email || "";
        const jobFunction = item["Function"] || item.function || "";
        const tag = item["Tag"] || item.tag || "";

        if (!firstName || !phone || !email) {
          skipped.push({ row: i + 2, reason: "Missing required fields" });
          continue;
        }

        const emailStr = String(email).trim().toLowerCase();
        const phoneStr = String(phone).trim();

        const [existingCand] = await pool.execute(
          "SELECT cand_id FROM candidate WHERE (candidate_email = ? OR candidate_mobile = ?) AND is_delete = 0",
          [emailStr, phoneStr]
        );

        if (existingCand.length > 0) {
          skipped.push({ row: i + 2, name: `${firstName} ${lastName}`, reason: "Email or Phone already exists" });
          continue;
        }

        const tempId = "TEMP-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);

        const [result] = await pool.execute(
          `INSERT INTO candidate
            (candidate_id, client_id, created_by_users, candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag, verification_status, is_active, is_delete, created_at, updated_at)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, NOW(), NOW())`,
          [
            tempId,
            clientAdminId,
            String(firstName).trim(),
            String(lastName).trim(),
            emailStr,
            phoneStr,
            jobFunction ? String(jobFunction).trim() : null,
            tag ? String(tag).trim() : null,
          ]
        );

        const newCandId = result.insertId;
        const finalCandidateId = "CAND" + String(newCandId).padStart(4, "0");

        await pool.execute(
          `UPDATE candidate SET candidate_id = ? WHERE cand_id = ?`,
          [finalCandidateId, newCandId]
        );

        created.push({ name: `${firstName} ${lastName}`, email: emailStr });
      }

      return res.status(201).json({
        success: true,
        message: "Bulk upload complete",
        totalRecords: data.length,
        created: created.length,
        skipped: skipped.length,
        createdList: created,
        skippedList: skipped,
      });

    } catch (error) {
      console.error("Bulk Upload Error:", error);
      res.status(500).json({ success: false, message: "Internal Server Error" });
    }
  }
);

/**
 * @swagger
 * /api/client-admin/candidate/update/{id}:
 *   put:
 *     summary: Update a Candidate (Client Admin)
 *     tags: [Client Admin - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Candidate Updated Successfully
 *       400:
 *         description: Validation Error
 */
router.put(
  "/update/:id",
  async (req, res) => {
    res.status(200).json({
      success: true,
      message: "Candidate Updated Successfully",
    });
  }
);

/**
 * @swagger
 * /api/client-admin/candidate/on-hold/{id}:
 *   patch:
 *     summary: Place a Candidate On Hold (Client Admin)
 *     tags: [Client Admin - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID (cand_id)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 example: Awaiting additional documents from candidate
 *     responses:
 *       200:
 *         description: Candidate placed on hold successfully
 *       400:
 *         description: Reason required or already on hold
 *       404:
 *         description: Candidate not found
 *       500:
 *         description: Internal Server Error
 */
router.patch("/on-hold/:id", async (req, res) => {
  try {
    const candId = parseInt(req.params.id);

    if (!candId || isNaN(candId)) {
      return res.status(400).json({ success: false, message: "Invalid candidate ID" });
    }

    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "On-hold reason is required",
      });
    }

    /* ── CHECK CANDIDATE EXISTS ── */
    const [existing] = await pool.query(
      "SELECT cand_id, is_onhold FROM candidate WHERE cand_id = ? AND is_delete = 0",
      [candId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    if (Number(existing[0].is_onhold) === 1) {
      return res.status(400).json({ success: false, message: "Candidate is already on hold" });
    }

    /* ── UPDATE STATUS ── */
    await pool.query(
      `UPDATE candidate
       SET is_onhold = 1, is_reject = 0, onhold_comment = ?, verification_status = 5, updated_at = NOW()
       WHERE cand_id = ?`,
      [reason.trim(), candId]
    );

    return res.status(200).json({
      success: true,
      message: "Candidate placed on hold successfully",
    });

  } catch (error) {
    console.error("on-hold-candidate error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/client-admin/candidate/remove-hold/{id}:
 *   patch:
 *     summary: Remove Hold from a Candidate (Client Admin)
 *     tags: [Client Admin - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID
 *     responses:
 *       200:
 *         description: Hold removed successfully
 *       400:
 *         description: Invalid candidate ID
 *       404:
 *         description: Candidate not found
 */
router.patch("/remove-hold/:id", async (req, res) => {
  try {
    const candId = parseInt(req.params.id);

    if (!candId || isNaN(candId)) {
      return res.status(400).json({ success: false, message: "Invalid candidate ID" });
    }

    /* ── CHECK CANDIDATE EXISTS ── */
    const [existing] = await pool.query(
      "SELECT cand_id, is_onhold FROM candidate WHERE cand_id = ? AND is_delete = 0",
      [candId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    if (Number(existing[0].is_onhold) === 0) {
      return res.status(400).json({ success: false, message: "Candidate is not on hold" });
    }

    /* ── UPDATE STATUS ── */
    await pool.query(
      `UPDATE candidate
       SET is_onhold = 0, onhold_comment = NULL, verification_status = 2, updated_at = NOW()
       WHERE cand_id = ?`,
      [candId]
    );

    return res.status(200).json({
      success: true,
      message: "Hold removed successfully",
    });

  } catch (error) {
    console.error("remove-hold-candidate error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/client-admin/candidate/assign-hr/{id}:
 *   patch:
 *     summary: Assign HR to a Candidate (Client Admin)
 *     tags: [Client Admin - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - hrId
 *             properties:
 *               hrId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: HR assigned successfully
 *       400:
 *         description: Invalid HR ID
 *       404:
 *         description: Candidate or HR not found
 */
router.patch("/assign-hr/:id", async (req, res) => {
  try {
    const candId = parseInt(req.params.id);
    if (!candId || isNaN(candId)) {
      return res.status(400).json({ success: false, message: "Invalid candidate ID" });
    }

    const { hrId } = req.body;
    if (!hrId || isNaN(parseInt(hrId))) {
      return res.status(400).json({ success: false, message: "Valid HR ID is required" });
    }

    /* ── FETCH HR DETAILS ── */
    const [hrResults] = await pool.query(
      "SELECT first_name as firstname, last_name as lastname, email FROM users WHERE users_id = ? AND is_delete = 0",
      [hrId]
    );

    if (hrResults.length === 0) {
      return res.status(404).json({ success: false, message: "HR not found" });
    }

    const hr = hrResults[0];

    /* ── UPDATE CANDIDATE ── */
    const [updateResult] = await pool.query(
      `UPDATE candidate 
       SET assigned_userid = ?, 
           assigned_hr_firstname = ?, 
           assigned_hr_lastname = ?, 
           assigned_hr_email = ?,
           updated_at = NOW()
       WHERE cand_id = ?`,
      [hrId, hr.firstname, hr.lastname, hr.email, candId]
    );

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    return res.status(200).json({
      success: true,
      message: "HR assigned successfully",
    });

  } catch (error) {
    console.error("assign-hr error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/client-admin/candidate/bulk-assign-hr:
 *   patch:
 *     summary: Bulk Assign HR to Candidates (Client Admin)
 *     tags: [Client Admin - Candidate]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - candidateIds
 *               - hrId
 *             properties:
 *               candidateIds:
 *                 type: array
 *                 items:
 *                   type: integer
 *               hrId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: HR assigned successfully
 *       400:
 *         description: Invalid HR ID or candidate IDs
 *       404:
 *         description: HR not found
 */
router.patch("/bulk-assign-hr", async (req, res) => {
  try {
    const { candidateIds, hrId } = req.body;

    if (!candidateIds || !Array.isArray(candidateIds) || candidateIds.length === 0) {
      return res.status(400).json({ success: false, message: "A list of candidate IDs is required" });
    }

    if (!hrId || isNaN(parseInt(hrId))) {
      return res.status(400).json({ success: false, message: "Valid HR ID is required" });
    }

    /* ── FETCH HR DETAILS ── */
    const [hrResults] = await pool.query(
      "SELECT first_name as firstname, last_name as lastname, email FROM users WHERE users_id = ? AND is_delete = 0",
      [hrId]
    );

    if (hrResults.length === 0) {
      return res.status(404).json({ success: false, message: "HR not found" });
    }

    const hr = hrResults[0];

    /* ── UPDATE CANDIDATES ── */
    // Create placeholders for the IN clause (?, ?, ?)
    const placeholders = candidateIds.map(() => '?').join(',');

    const [updateResult] = await pool.query(
      `UPDATE candidate 
       SET assigned_userid = ?, 
           assigned_hr_firstname = ?, 
           assigned_hr_lastname = ?, 
           assigned_hr_email = ?,
           updated_at = NOW()
       WHERE cand_id IN (${placeholders})`,
      [hrId, hr.firstname, hr.lastname, hr.email, ...candidateIds]
    );

    return res.status(200).json({
      success: true,
      message: `${updateResult.affectedRows} Candidates assigned to HR successfully`,
    });

  } catch (error) {
    console.error("bulk-assign-hr error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/client-admin/candidate/reject/{id}:
 *   patch:
 *     summary: Reject a Candidate (Client Admin)
 *     tags: [Client Admin - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID (cand_id)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 example: Failed background verification criteria
 *     responses:
 *       200:
 *         description: Candidate rejected successfully
 *       400:
 *         description: Reason required or already rejected
 *       404:
 *         description: Candidate not found
 *       500:
 *         description: Internal Server Error
 */
router.patch("/reject/:id", async (req, res) => {
  try {
    const candId = parseInt(req.params.id);

    if (!candId || isNaN(candId)) {
      return res.status(400).json({ success: false, message: "Invalid candidate ID" });
    }

    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "Rejection reason is required",
      });
    }

    /* ── CHECK CANDIDATE EXISTS ── */
    const [existing] = await pool.query(
      "SELECT cand_id, is_reject FROM candidate WHERE cand_id = ? AND is_delete = 0",
      [candId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    if (Number(existing[0].is_reject) === 1) {
      return res.status(400).json({ success: false, message: "Candidate is already rejected" });
    }

    /* ── UPDATE STATUS ── */
    await pool.query(
      `UPDATE candidate
       SET is_reject = 1, is_onhold = 0, reject_comment = ?, verification_status = 3, updated_at = NOW()
       WHERE cand_id = ?`,
      [reason.trim(), candId]
    );

    return res.status(200).json({
      success: true,
      message: "Candidate rejected successfully",
    });

  } catch (error) {
    console.error("reject-candidate error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/client-admin/candidate/get-candidate/{id}:
 *   get:
 *     summary: Get Candidate Details by ID (Client Admin)
 *     tags: [Client Admin - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Candidate details
 *       404:
 *         description: Candidate not found
 *       500:
 *         description: Internal Server Error
 */
router.get("/get-candidate/:id", async (req, res) => {
  try {
    const { id } = req.params;

      const [rows] = await pool.query(
      `SELECT c.*, 
              u.first_name AS hr_firstname,
              u.last_name AS hr_lastname
       FROM candidate c
       LEFT JOIN users u ON c.assigned_userid = u.users_id
       WHERE (c.candidate_id = ? OR c.cand_id = ?) AND c.is_delete = 0`,
      [id, id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    const candidate = rows[0];
    const candId = candidate.cand_id;

    const [address] = await pool.query(`SELECT * FROM candidate_address WHERE cand_id = ?`, [candId]);
    const [education] = await pool.query(`SELECT * FROM candidate_education WHERE cand_id = ?`, [candId]);
    const [employment] = await pool.query(`SELECT * FROM candidate_employment WHERE cand_id = ?`, [candId]);
    const [criminal] = await pool.query(`SELECT * FROM candidate_criminal WHERE cand_id = ?`, [candId]);
    const [drug] = await pool.query(`SELECT * FROM candidate_drug WHERE cand_id = ?`, [candId]);

    // Handle tables that might not exist yet gracefully
    let identity = [];
    try {
      const [identRows] = await pool.query(`SELECT * FROM candidate_identity WHERE cand_id = ?`, [candId]);
      identity = identRows;
    } catch (err) {
      console.warn("candidate_identity table might not exist yet.");
    }

    let reference = [];
    try {
      const [refRows] = await pool.query(`SELECT * FROM candidate_reference WHERE cand_id = ?`, [candId]);
      reference = refRows;
    } catch (err) {
      console.warn("candidate_reference table might not exist yet.");
    }

    const data = {
      ...candidate,
      address: address[0] || null,
      education: education || [],
      employment: employment || [],
      criminal: criminal || [],
      drug: drug || [],
      identity: identity || [],
      reference: reference || []
    };

    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error("Error fetching candidate:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/client-admin/candidate/list:
 *   get:
 *     summary: Get All Candidates for a Client Company
 *     tags: [Client Admin - Candidate]
 *     parameters:
 *       - in: query
 *         name: cmId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Client Company cm_id
 *         example: 1
 *     responses:
 *       200:
 *         description: List of candidates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       cand_id:
 *                         type: integer
 *                       case_id:
 *                         type: string
 *                       first_name:
 *                         type: string
 *                       last_name:
 *                         type: string
 *                       email:
 *                         type: string
 *                       phone:
 *                         type: string
 *                       case_status:
 *                         type: integer
 *                       created_by_name:
 *                         type: string
 *                       created_by_role:
 *                         type: string
 *       400:
 *         description: cmId is required
 *       500:
 *         description: Server Error
 */
router.get(
  "/list",
  async (req, res) => {

    try {
      const page   = parseInt(req.query.page)   || 1;
      const limit  = parseInt(req.query.limit)  || 10;
      const offset = (page - 1) * limit;
      const search = req.query.search?.trim()   || "";
      const status = req.query.status           || "";

      /* ── BUILD WHERE CLAUSE ── */
      const clientId = 1; // Default client id for mock auth
      let where  = "WHERE c.is_delete = 0 AND c.client_id = ?";
      const params = [clientId];

      if (search) {
        where += ` AND (
          c.candidate_first_name  LIKE ? OR
          c.candidate_last_name   LIKE ? OR
          c.candidate_email       LIKE ? OR
          c.candidate_mobile      LIKE ? OR
          CONCAT(c.candidate_first_name, ' ', c.candidate_last_name) LIKE ?
        )`;
        const s = `%${search}%`;
        params.push(s, s, s, s, s);
      }

      /* status filter: map label → DB value */
      const statusMap = {
        "Pending":     0,
        "Verified":    1,
        "In Progress": 2,
        "Rejected":    3,
        "Complete":    4,
        "On Hold":     5,
      };
      if (status && status !== "All" && statusMap[status] !== undefined) {
        where += " AND c.verification_status = ?";
        params.push(statusMap[status]);
      }

      /* ── COUNT ── */
      const [countRows] = await pool.query(
        `SELECT COUNT(*) AS total FROM candidate c ${where}`,
        params
      );
      const totalRecords = parseInt(countRows[0].total) || 0;
      const totalPages = Math.ceil(totalRecords / limit) || 1;

      /* ── FETCH PAGE ── */
      const [rows] = await pool.query(
        `SELECT
          c.cand_id,
          c.candidate_id AS case_id,
          CONCAT(c.candidate_first_name, ' ', c.candidate_last_name) AS name,
          c.candidate_first_name AS first_name,
          c.candidate_last_name AS last_name,
          c.candidate_email AS email,
          c.candidate_mobile AS phone,
          c.candidate_function AS job_function,
          c.candidate_tag AS tag,
          c.verification_status AS case_status,
          c.is_active,
          c.is_delete,
          c.created_at,
          c.updated_at,
          CONCAT(u.first_name, ' ', u.last_name) AS created_by_name,
          u.role_name AS created_by_role,
          COALESCE(cu.first_name, '') AS hr_first_name,
          COALESCE(cu.last_name, '') AS hr_last_name,
          COALESCE(cu.email, '') AS hr_email
         FROM candidate c
         LEFT JOIN users u ON c.created_by_users = u.users_id
         LEFT JOIN users cu ON c.assigned_userid = cu.users_id
         ${where}
         ORDER BY c.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      /* ── STATUS LABEL MAP ── */
      const labelMap = {
        0: "Pending",
        1: "Verified",
        2: "In Progress",
        3: "Rejected",
        4: "Complete",
        5: "On Hold",
      };

      const formatted = rows.map((r) => ({
        cand_id:      r.cand_id,
        id:           r.cand_id,
        case_id:      r.case_id || `CAND-${String(r.cand_id).padStart(4, "0")}`,
        candidateId:  r.case_id || `CAND-${String(r.cand_id).padStart(4, "0")}`,
        name:         r.name,
        first_name:   r.first_name,
        last_name:    r.last_name,
        email:        r.email,
        phone:        r.phone,
        job_function: r.job_function,
        tag:          r.tag,
        case_status:  r.case_status,
        status:       labelMap[r.case_status] ?? "Pending",
        progress:     r.case_status === 1 ? 100
                    : r.case_status === 4 ? 80
                    : r.case_status === 2 ? 40
                    : r.case_status === 3 ? 0
                    : r.case_status === 5 ? 60
                    : 10,
        is_active:    r.is_active,
        is_delete:    r.is_delete,
        created_at:   r.created_at,
        updated_at:   r.updated_at,
        created_by_role: r.created_by_role,
        created_by_name: r.created_by_name,
        assigned_hr:  (r.hr_first_name || r.hr_last_name)
          ? { name: `${r.hr_first_name} ${r.hr_last_name}`.trim(), email: r.hr_email }
          : null,
      }));

      /* ── STATS ── */
      const [statsRows] = await pool.query(
        `SELECT
           COUNT(*)                                                         AS total,
           SUM(CASE WHEN verification_status = 0 THEN 1 ELSE 0 END)        AS awaiting,
           SUM(CASE WHEN verification_status = 4 THEN 1 ELSE 0 END)        AS profile_complete,
           SUM(CASE WHEN verification_status = 2 THEN 1 ELSE 0 END)        AS in_progress,
           SUM(CASE WHEN verification_status = 1 THEN 1 ELSE 0 END)        AS verified,
           SUM(CASE WHEN verification_status = 5 THEN 1 ELSE 0 END)        AS on_hold
         FROM candidate
         WHERE is_delete = 0 AND client_id = ?`,
        [clientId]
      );
      const stats = statsRows[0];

      return res.status(200).json({
        success: true,
        data: formatted,
        stats: {
          total:            parseInt(stats.total)            || 0,
          awaiting:         parseInt(stats.awaiting)         || 0,
          profileComplete:  parseInt(stats.profile_complete) || 0,
          inProgress:       parseInt(stats.in_progress)      || 0,
          verified:         parseInt(stats.verified)         || 0,
          onHold:           parseInt(stats.on_hold)          || 0,
        },
        pagination: {
          totalRecords,
          totalPages,
          currentPage: page,
          limit
        }
      });

    } catch (err) {

      console.error("Get Candidates Error:", err);

      return res.status(500).json({
        success: false,
        message: "Server error. Please try again.",
      });

    }

  }
);

export default router;
