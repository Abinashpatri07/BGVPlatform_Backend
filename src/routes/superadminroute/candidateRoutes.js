import express from "express";
import pool from "../../config/db.js";

import validateCreateCandidate from
"../../middleware/superadmin/validateCreateCandidate.js";

import validateUpdateCandidate from
"../../middleware/superadmin/validateUpdateCandidate.js";

const router = express.Router();

/**
 * @swagger
 * /api/candidate/get-candidate/{id}:
 *   get:
 *     summary: Get Candidate Details by ID (Super Admin)
 *     tags: [Super Admin - Candidate]
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
              u.firstname AS hr_firstname,
              u.lastname AS hr_lastname
       FROM candidate c
       LEFT JOIN client_user_master u ON c.assigned_userid = u.users_id
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
 * /api/candidate/get-all:
 *   get:
 *     summary: Get all Candidates with pagination (Super Admin)
 *     tags: [Super Admin - Candidate]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer }
 *       - in: query
 *         name: limit
 *         schema: { type: integer }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: List of candidates with pagination and stats
 *       500:
 *         description: Internal Server Error
 */
router.get("/get-all", async (req, res) => {
  try {
    const page   = parseInt(req.query.page)   || 1;
    const limit  = parseInt(req.query.limit)  || 10;
    const offset = (page - 1) * limit;
    const search = req.query.search?.trim()   || "";
    const status = req.query.status           || "";

    /* ── BUILD WHERE CLAUSE ── */
    let where  = "WHERE c.is_delete = 0";
    const params = [];

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
      "On Hold":     5,
      "Complete":    4,
    };
    if (status && status !== "All" && statusMap[status] !== undefined) {
      where += " AND c.verification_status = ?";
      params.push(statusMap[status]);
    }

    /* ── COUNT ── */
    const [[countRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM candidate c ${where}`,
      params
    );
    const totalRecords = parseInt(countRow.total) || 0;
    const totalPages   = Math.ceil(totalRecords / limit) || 1;

    /* ── FETCH PAGE ── */
    const [rows] = await pool.query(
      `SELECT
          c.cand_id,
          c.candidate_id,
          CONCAT(c.candidate_first_name, ' ', c.candidate_last_name) AS name,
          c.candidate_first_name      AS first_name,
          c.candidate_last_name       AS last_name,
          c.candidate_email           AS email,
          c.candidate_mobile          AS phone,
          c.candidate_function        AS job_function,
          c.candidate_tag             AS tag,
          c.verification_status       AS case_status,
          c.is_active,
          c.created_at,
          c.updated_at,
          COALESCE(c.assigned_hr_firstname, '') AS hr_first_name,
          COALESCE(c.assigned_hr_lastname,  '') AS hr_last_name,
          COALESCE(cu.email, '')               AS hr_email
       FROM candidate c
       LEFT JOIN client_user_master cu
              ON c.assigned_userid = cu.users_id
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
      id:           r.cand_id,
      candidateId:  r.candidate_id || `CAND-${String(r.cand_id).padStart(4, "0")}`,
      name:         r.name,
      first_name:   r.first_name,
      last_name:    r.last_name,
      email:        r.email,
      phone:        r.phone,
      job_function: r.job_function,
      tag:          r.tag,
      status:       labelMap[r.case_status] ?? "Pending",
      progress:     r.case_status === 1 ? 100
                  : r.case_status === 4 ? 80
                  : r.case_status === 2 ? 40
                  : r.case_status === 3 ? 0
                  : r.case_status === 5 ? 60
                  : 10,
      created_at:   r.created_at,
      updated_at:   r.updated_at,
      assigned_hr:  (r.hr_first_name || r.hr_last_name)
        ? { name: `${r.hr_first_name} ${r.hr_last_name}`.trim(), email: r.hr_email }
        : null,
    }));

    /* ── STATS ── */
    const [[stats]] = await pool.query(
      `SELECT
         COUNT(*)                                                         AS total,
         SUM(CASE WHEN verification_status = 0 THEN 1 ELSE 0 END)        AS awaiting,
         SUM(CASE WHEN verification_status = 4 THEN 1 ELSE 0 END)        AS profile_complete,
         SUM(CASE WHEN verification_status = 2 THEN 1 ELSE 0 END)        AS in_progress,
         SUM(CASE WHEN verification_status = 1 THEN 1 ELSE 0 END)        AS verified,
         SUM(CASE WHEN verification_status = 5 THEN 1 ELSE 0 END)        AS on_hold
       FROM candidate
       WHERE is_delete = 0`
    );

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
        limit,
      },
    });

  } catch (error) {
    console.error("get-all-candidates error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});


/**

 * @swagger
 * /api/candidate/create:
 *   post:
 *     summary: Create a new Candidate (Super Admin)
 *     tags: [Super Admin - Candidate]
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
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Amit
 *               lastName:
 *                 type: string
 *                 example: Kumar
 *               email:
 *                 type: string
 *                 example: amit@email.com
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *     responses:
 *       200:
 *         description: Candidate Created Successfully
 *       400:
 *         description: Validation Error
 */
router.post(
  "/create",
  validateCreateCandidate,
  async (req, res) => {
    try {
      const {
        firstName,
        lastName,
        phone,
        email,
        function: jobFunction,
        tag,
      } = req.body;

      // Check if email already exists
      const [existing] = await pool.query(
        `SELECT cand_id FROM candidate WHERE candidate_email = ? AND is_delete = 0`,
        [email]
      );

      if (existing.length > 0) {
        return res.status(409).json({
          success: false,
          field: "email",
          message: "Email already exists",
        });
      }

      // Generate a temporary candidate_id to satisfy NOT NULL constraint
      const tempId = "TEMP-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);

      const [result] = await pool.query(
        `INSERT INTO candidate
          (candidate_id, client_id, candidate_first_name, candidate_last_name,
           candidate_email, candidate_mobile,
           candidate_function, candidate_tag,
           verification_status, is_active, is_delete,
           created_at, updated_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, 0, 1, 0, NOW(), NOW())`,
        [
          tempId,
          firstName,
          lastName,
          email,
          phone,
          jobFunction || null,
          tag || null,
        ]
      );

      const newCandId = result.insertId;
      const finalCandidateId = "CAND" + String(newCandId).padStart(4, "0");

      // Update with the final sequential candidate_id
      await pool.query(
        `UPDATE candidate SET candidate_id = ? WHERE cand_id = ?`,
        [finalCandidateId, newCandId]
      );

      return res.status(200).json({
        success: true,
        message: "Candidate Created Successfully",
        candidateId: result.insertId,
      });

    } catch (error) {
      console.error("Create candidate error:", error);
      res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
);

/**
 * @swagger
 * /api/candidate/update/{id}:
 *   put:
 *     summary: Update a Candidate (Super Admin)
 *     tags: [Super Admin - Candidate]
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
  validateUpdateCandidate,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Candidate Updated Successfully",
    });

  }
);

/**
 * @swagger
 * /api/candidate/on-hold/{id}:
 *   patch:
 *     summary: Place a Candidate On Hold (Super Admin)
 *     tags: [Super Admin - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID (candidate_id)
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
 * /api/candidate/remove-hold/{id}:
 *   patch:
 *     summary: Remove Hold from a Candidate (Super Admin)
 *     tags: [Super Admin - Candidate]
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
 * /api/candidate/assign-hr/{id}:
 *   patch:
 *     summary: Assign HR to a Candidate (Super Admin)
 *     tags: [Super Admin - Candidate]
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
      "SELECT firstname, lastname, email FROM client_user_master WHERE users_id = ? AND is_delete = 0",
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
 * /api/candidate/bulk-assign-hr:
 *   patch:
 *     summary: Bulk Assign HR to Candidates (Super Admin)
 *     tags: [Super Admin - Candidate]
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
      "SELECT firstname, lastname, email FROM client_user_master WHERE users_id = ? AND is_delete = 0",
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
 * /api/candidate/reject/{id}:
 *   patch:
 *     summary: Reject a Candidate (Super Admin)
 *     tags: [Super Admin - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID (candidate_id)
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

export default router;