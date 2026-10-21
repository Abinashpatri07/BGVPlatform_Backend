import express from "express";

import multer from "multer";

import XLSX from "xlsx";

import validateCreateCandidate from
  "../../middleware/hr/validateCreateCandidate.js";

import pool from "../../config/db.js";

const router = express.Router();
import apiLogger from "../../middleware/apiLogger.js";

router.use(apiLogger({ sourceService: "HR Portal", destinationService: "Backend API" }));

/* ───────────────── STORAGE ───────────────── */

const storage = multer.diskStorage({

  destination: (
    req,
    file,
    cb
  ) => {

    cb(null, "uploads/");
  },

  filename: (
    req,
    file,
    cb
  ) => {

    cb(
      null,
      Date.now() +
      "-" +
      file.originalname
    );
  },
});

/* ───────────────── FILE FILTER ───────────────── */

const fileFilter = (
  req,
  file,
  cb
) => {

  const allowedTypes = [

    "application/vnd.ms-excel",

    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

    "text/csv",
  ];

  if (
    allowedTypes.includes(
      file.mimetype
    )
  ) {

    cb(null, true);

  } else {

    cb(
      new Error(
        "Only CSV/XLS/XLSX files allowed"
      ),
      false
    );
  }
};

/* ───────────────── MULTER ───────────────── */

const upload = multer({
  storage,
  fileFilter,
});

/**
 * @swagger
 * /api/candidates/single_candidate_add:
 *   post:
 *     summary: Add a Single Candidate (HR)
 *     tags: [HR - Candidate]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - phone
 *               - email
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Amit
 *               lastName:
 *                 type: string
 *                 example: Kumar
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *               email:
 *                 type: string
 *                 example: amit@email.com
 *               jobFunction:
 *                 type: string
 *                 example: Software Engineer
 *               tag:
 *                 type: string
 *                 example: urgent
 *               createdByRole:
 *                 type: string
 *                 example: hr
 *                 description: "hr or client_admin"
 *               createdById:
 *                 type: integer
 *                 example: 1
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
 *                 candidateId:
 *                   type: integer
 *                 createdByRole:
 *                   type: string
 *       409:
 *         description: Phone or Email already exists
 *       500:
 *         description: Internal Server Error
 */
router.post(
  "/single_candidate_add",

  validateCreateCandidate,

  async (req, res) => {

    try {

      const {
        firstName,
        lastName,
        phone,
        email,
        jobFunction,
        tag,
        createdByRole,
        createdById,
      } = req.body;

      /* ── DUPLICATE PHONE CHECK ── */
      const [phoneRows] = await pool.query(
        "SELECT cand_id FROM candidate WHERE candidate_mobile = ? AND is_delete = 0",
        [phone]
      );

      if (phoneRows.length > 0) {
        return res.status(409).json({
          success: false,
          field: "phone",
          message: "Phone number already exists",
        });
      }

      /* ── DUPLICATE EMAIL CHECK ── */
      const [emailRows] = await pool.query(
        "SELECT cand_id FROM candidate WHERE candidate_email = ? AND is_delete = 0",
        [email]
      );

      if (emailRows.length > 0) {
        return res.status(409).json({
          success: false,
          field: "email",
          message: "Email already exists",
        });
      }

      // Generate a temporary candidate_id to satisfy NOT NULL constraint
      const tempId = "TEMP-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);

      /* ── INSERT INTO candidate ── */
      const [result] = await pool.query(
        `INSERT INTO candidate
          (candidate_id, client_id, created_by_users, assigned_userid,
           candidate_first_name, candidate_last_name,
           candidate_email, candidate_mobile,
           candidate_function, candidate_tag,
           verification_status, is_active, is_delete,
           created_at, updated_at)
         VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, NOW(), NOW())`,
        [
          tempId,
          createdById || null,
          createdById || null, // Assuming HR creating the candidate assigns themselves
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

      return res.status(201).json({
        success: true,
        message: "Candidate Created Successfully",
        candidateId: result.insertId,
        createdByRole: createdByRole || "hr",
      });

    } catch (error) {

      console.log(error);

      res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
);


/**
 * @swagger
 * /api/candidates/multiple_candidate_add:
 *   post:
 *     summary: Bulk Upload Candidates via Excel/CSV (HR)
 *     tags: [HR - Candidate]
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Excel (.xlsx/.xls) or CSV file with columns firstName, lastName, phone, email, jobFunction, tag
 *     responses:
 *       201:
 *         description: Bulk upload complete
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 totalRecords:
 *                   type: integer
 *                 created:
 *                   type: integer
 *                 skipped:
 *                   type: integer
 *       400:
 *         description: File is required or empty / Validation failed
 *       500:
 *         description: Internal Server Error
 */
router.post(
  "/multiple_candidate_add",

  upload.single("file"),

  async (req, res) => {

    try {

      /* FILE CHECK */
      if (!req.file) {
        return res.status(400).json({
          success: false,
          message: "File is required",
        });
      }

      /* READ FILE */
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet);

      console.log("Bulk Candidate Data:", data);

      /* EMPTY FILE */
      if (data.length === 0) {
        return res.status(400).json({
          success: false,
          message: "File is empty",
        });
      }

      /* VALIDATION — required fields */
      const validationErrors = [];
      data.forEach((item, index) => {
        const fName = item["First Name"] || item.firstName;
        const lName = item["Last Name"] || item.lastName;
        const phone = item["Phone"] || item.phone;
        const email = item["Email"] || item.email;

        if (!fName || !lName || !phone || !email) {
          validationErrors.push({
            row: index + 2,
            message: "Required fields missing (firstName, lastName, phone, email)",
          });
        }
      });

      if (validationErrors.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: validationErrors,
        });
      }

      /* INSERT LOOP — skip duplicates */
      const created = [];
      const skipped = [];

      const createdById = req.body.createdById || 15; // default HR ID

      for (let i = 0; i < data.length; i++) {
        const item = data[i];

        const phone = String(item["Phone"] || item.phone).trim();
        const email = String(item["Email"] || item.email).trim().toLowerCase();
        const firstName = String(item["First Name"] || item.firstName).trim();
        const lastName = String(item["Last Name"] || item.lastName).trim();
        const jobFunction = (item["Function"] || item.function || item.jobFunction) ? String(item["Function"] || item.function || item.jobFunction).trim() : "";
        const tag = (item["Tag"] || item.tag) ? String(item["Tag"] || item.tag).trim() : "";

        /* Duplicate phone check */
        const [phoneRows] = await pool.query(
          "SELECT cand_id FROM candidate WHERE candidate_mobile = ? AND is_delete = 0",
          [phone]
        );

        if (phoneRows.length > 0) {
          skipped.push({ row: i + 2, name: `${firstName} ${lastName}`, reason: "Phone already exists" });
          continue;
        }

        /* Duplicate email check */
        const [emailRows] = await pool.query(
          "SELECT cand_id FROM candidate WHERE candidate_email = ? AND is_delete = 0",
          [email]
        );

        if (emailRows.length > 0) {
          skipped.push({ row: i + 2, name: `${firstName} ${lastName}`, reason: "Email already exists" });
          continue;
        }

        // Generate a temporary candidate_id to satisfy NOT NULL constraint
        const tempId = "TEMP-" + Date.now().toString().slice(-6) + Math.floor(10 + Math.random() * 90);

        /* Insert */
        const [insertResult] = await pool.query(
          `INSERT INTO candidate
            (candidate_id, client_id, created_by_users, assigned_userid, candidate_first_name, candidate_last_name,
             candidate_email, candidate_mobile,
             candidate_function, candidate_tag,
             verification_status, is_active, is_delete,
             created_at, updated_at)
           VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, NOW(), NOW())`,
          [tempId, createdById || null, createdById || null, firstName, lastName, email, phone, jobFunction || null, tag || null]
        );

        const newCandId = insertResult.insertId;
        const finalCandidateId = "CAND" + String(newCandId).padStart(4, "0");

        // Update with the final sequential candidate_id
        await pool.query(
          `UPDATE candidate SET candidate_id = ? WHERE cand_id = ?`,
          [finalCandidateId, newCandId]
        );

        created.push({ name: `${firstName} ${lastName}`, email });
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

      console.log(error);

      res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
);

/**
 * @swagger
 * /api/candidates/get_candidate/{id}:
 *   get:
 *     summary: Get Single Candidate Details
 *     tags: [HR - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID (cand_id)
 *         example: 1
 *     responses:
 *       200:
 *         description: Candidate details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 candidate:
 *                   type: object
 *                   properties:
 *                     cand_id:
 *                       type: integer
 *                     case_id:
 *                       type: string
 *                     first_name:
 *                       type: string
 *                     last_name:
 *                       type: string
 *                     email:
 *                       type: string
 *                     phone:
 *                       type: string
 *                     date_of_birth:
 *                       type: string
 *                     gender:
 *                       type: string
 *                     case_status:
 *                       type: integer
 *       404:
 *         description: Candidate not found
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/get_candidate/:id",

  async (req, res) => {
    try {
      const { id } = req.params;

      const [rows] = await pool.query(
        `SELECT
           cand_id,
           cand_id                  AS case_id,
           candidate_first_name     AS first_name,
           candidate_last_name      AS last_name,
           candidate_email          AS email,
           candidate_mobile         AS phone,
           candidate_function       AS job_function,
           candidate_tag            AS tag,
           verification_status      AS case_status,
           created_at,
           updated_at
         FROM candidate
         WHERE cand_id = ? AND is_delete = 0`,
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Candidate not found",
        });
      }

      return res.status(200).json({
        success: true,
        candidate: rows[0],
      });

    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: "Internal Server Error" });
    }
  }
);

/**
 * @swagger
 * /api/candidates/get_all_candidates:
 *   get:
 *     summary: Get All Candidates (HR)
 *     tags: [HR - Candidate]
 *     responses:
 *       200:
 *         description: List of all candidates
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 candidates:
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
 *       500:
 *         description: Internal Server Error
 */
router.get(
  "/get_all_candidates",

  async (req, res) => {

    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;
      const clientId = 1; // Default client id for mock auth

      const [countRows] = await pool.query(
        `SELECT COUNT(*) as total FROM candidate WHERE is_delete = 0 AND client_id = ?`,
        [clientId]
      );
      const totalRecords = countRows[0].total;
      const totalPages = Math.ceil(totalRecords / limit);

      const [rows] = await pool.query(
        `SELECT
          cand_id,
          candidate_id AS case_id,
          assigned_userid AS created_by_hr,
          NULL AS created_by_client_admin,
          candidate_first_name AS first_name,
          candidate_last_name AS last_name,
          candidate_email AS email,
          candidate_mobile AS phone,
          candidate_function AS job_function,
          candidate_tag AS tag,
          verification_status AS case_status,
          is_active,
          is_delete,
          created_at,
          updated_at,
          'HR' AS created_by_role,
          '-' AS created_by_name
         FROM candidate
         WHERE is_delete = 0 AND client_id = ?
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [clientId, limit, offset]
      );

      return res.status(200).json({
        success: true,
        candidates: rows,
        pagination: {
          totalRecords,
          totalPages,
          currentPage: page,
          limit
        }
      });

    } catch (error) {

      console.log(error);

      res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
);

/**
 * @swagger
 * /api/candidates/on_hold/{id}:
 *   patch:
 *     summary: Put Candidate On Hold (HR)
 *     tags: [HR - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: Awaiting documents from candidate
 *     responses:
 *       200:
 *         description: Candidate placed on hold successfully
 *       404:
 *         description: Candidate not found
 *       500:
 *         description: Internal Server Error
 */
router.patch(
  "/on_hold/:id",

  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const [rows] = await pool.query(
        "SELECT cand_id FROM candidate WHERE cand_id = ? AND is_delete = 0",
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Candidate not found",
        });
      }

      await pool.query(
        "UPDATE candidate SET verification_status = 5, updated_at = NOW() WHERE cand_id = ?",
        [id]
      );

      return res.status(200).json({
        success: true,
        message: "Candidate placed on hold successfully",
        reason: reason || "",
      });

    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: "Internal Server Error" });
    }
  }
);

/**
 * @swagger
 * /api/candidates/reject/{id}:
 *   patch:
 *     summary: Reject a Candidate (HR)
 *     tags: [HR - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *                 example: Failed background verification
 *     responses:
 *       200:
 *         description: Candidate rejected successfully
 *       404:
 *         description: Candidate not found
 *       500:
 *         description: Internal Server Error
 */
router.patch(
  "/reject/:id",

  async (req, res) => {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      const [rows] = await pool.query(
        "SELECT cand_id FROM candidate WHERE cand_id = ? AND is_delete = 0",
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Candidate not found",
        });
      }

      await pool.query(
        "UPDATE candidate SET verification_status = 3, updated_at = NOW() WHERE cand_id = ?",
        [id]
      );

      return res.status(200).json({
        success: true,
        message: "Candidate rejected successfully",
        reason: reason || "",
      });

    } catch (error) {
      console.log(error);
      res.status(500).json({ success: false, message: "Internal Server Error" });
    }
  }
);

/* ─────────────────────────────────────────────────────────────
   EDIT CANDIDATE APIS
   ───────────────────────────────────────────────────────────── */

/**
 * @swagger
 * /api/candidates/{id}/personal:
 *   get:
 *     summary: Get Candidate Personal Info
 *     tags: [HR - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID
 *     responses:
 *       200:
 *         description: Personal info fetched
 *       404:
 *         description: Candidate not found
 *       500:
 *         description: Internal Server Error
 */
// GET /:id/personal
router.get("/:id/personal", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT c.cand_id, c.candidate_id AS case_id, c.candidate_first_name AS first_name, c.candidate_last_name AS last_name,
              c.candidate_email AS email, c.candidate_mobile AS phone,
              c.candidate_function AS job_function, c.candidate_tag AS tag,
              c.verification_status AS case_status, c.created_at, c.updated_at
       FROM candidate c
       WHERE c.cand_id = ? AND c.is_delete = 0`,
      [id]
    );
    if (rows.length === 0)
      return res.status(404).json({ success: false, message: "Candidate not found" });
    return res.status(200).json({ success: true, data: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// PUT /:id/personal
router.put("/:id/personal", async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, job_function, tag } = req.body;
    await pool.query(
      `UPDATE candidate
       SET candidate_first_name = ?, candidate_last_name = ?, candidate_email = ?, candidate_mobile = ?,
           candidate_function = ?, candidate_tag = ?, updated_at = NOW()
       WHERE cand_id = ? AND is_delete = 0`,
      [first_name, last_name, email, phone, job_function, tag, id]
    );
    return res.status(200).json({ success: true, message: "Personal info updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// GET /:id/address
router.get("/:id/address", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM candidate_address WHERE cand_id = ?`,
      [id]
    );
    if (rows.length === 0) {
      return res.status(200).json({ success: true, data: null });
    }
    const row = rows[0];
    const data = {
      permanent_address: row.cand_perm_house ? `${row.cand_perm_house} ${row.cand_perm_street || ""}`.trim() : (row.cand_perm_street || ""),
      permanent_city: row.cand_perm_city,
      permanent_area: row.cand_perm_locality || row.cand_perm_street || "",
      permanent_state: row.cand_perm_state,
      permanent_country: row.cand_perm_country || "India",
      permanent_zipcode: row.cand_perm_pincode,
      current_address_same_as_permanent: row.is_add_same || 1,
      candidate_current_address: row.cand_curr_house ? `${row.cand_curr_house} ${row.cand_curr_street || ""}`.trim() : (row.cand_curr_street || ""),
      current_city: row.cand_curr_city,
      current_area: row.cand_curr_locality || row.cand_curr_street || "",
      current_state: row.cand_curr_state,
      current_country: row.cand_curr_country || "India",
      current_zipcode: row.cand_curr_pincode,
      ...row
    };
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// PUT /:id/address
router.put("/:id/address", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      permanent_address, permanent_city, permanent_state, permanent_country, permanent_zipcode,
      current_address_same_as_permanent,
      candidate_current_address, current_city, current_state, current_country, current_zipcode,
    } = req.body;

    const [existing] = await pool.query(
      "SELECT cand_add_id FROM candidate_address WHERE cand_id = ?", [id]
    );

    if (existing.length > 0) {
      await pool.query(
        `UPDATE candidate_address
         SET cand_perm_street = ?, cand_perm_city = ?, cand_perm_state = ?,
             cand_perm_country = ?, cand_perm_pincode = ?, is_add_same = ?,
             cand_curr_street = ?, cand_curr_city = ?,
             cand_curr_state = ?, cand_curr_country = ?, cand_curr_pincode = ?, updated_at = NOW()
         WHERE cand_id = ?`,
        [permanent_address, permanent_city, permanent_state,
          permanent_country || 'India', permanent_zipcode, current_address_same_as_permanent || 1,
          candidate_current_address, current_city,
          current_state, current_country || 'India', current_zipcode, id]
      );
    } else {
      await pool.query(
        `INSERT INTO candidate_address
         (cand_id, cand_perm_street, cand_perm_city, cand_perm_state,
          cand_perm_country, cand_perm_pincode, is_add_same,
          cand_curr_street, cand_curr_city,
          cand_curr_state, cand_curr_country, cand_curr_pincode, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, NOW(), NOW())`,
        [id, permanent_address, permanent_city, permanent_state,
          permanent_country || 'India', permanent_zipcode, current_address_same_as_permanent || 1,
          candidate_current_address, current_city,
          current_state, current_country || 'India', current_zipcode]
      );
    }
    return res.status(200).json({ success: true, message: "Address saved" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// GET /:id/identity
router.get("/:id/identity", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM candidate_identity WHERE cand_id = ? ORDER BY cand_iden_id`,
      [id]
    );
    const data = rows.map(r => ({
      id_doc_id: r.cand_iden_id,
      doc_type: r.cand_iden_type === "PAN card" ? 1 : r.cand_iden_type === "Aadhaar" ? 2 : r.cand_iden_type === "Passport" ? 3 : r.cand_iden_type === "Driving license" ? 4 : 5,
      doc_number: r.pan_number || r.passport_number || r.driving_number || r.voter_number || r.uan_number || "—",
      verification_status: r.iden_verification_status || 2,
      doc_file_path: r.cand_iden_docu || null,
      upload_date: r.created_at,
      ...r
    }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// GET /:id/education
router.get("/:id/education", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM candidate_education WHERE cand_id = ? ORDER BY cand_edu_id`,
      [id]
    );
    const data = rows.map(r => ({
      edu_id: r.cand_edu_id,
      institution_name: r.cand_edu_institute || "—",
      degree: r.cand_edu_type || r.cand_edu_dgree || "—",
      field_of_study: r.cand_specialization || "—",
      board_university: r.cand_edu_institute || "—",
      roll_number: "—",
      start_year: r.cand_edu_from_date ? new Date(r.cand_edu_from_date).getFullYear() : "—",
      end_year: r.cand_edu_to_date ? new Date(r.cand_edu_to_date).getFullYear() : "—",
      percentage_cgpa: r.cand_edu_grade || "—",
      doc_file_path: r.cand_edu_certificate || r.cand_edu_marksheet || null,
      verification_status: r.edu_verification_status || 2,
      upload_date: r.created_at,
      ...r
    }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// GET /:id/employment
router.get("/:id/employment", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM candidate_employment WHERE cand_id = ? ORDER BY cand_emp_id DESC`,
      [id]
    );
    const data = rows.map(r => ({
      emp_id: r.cand_emp_id,
      employer_name: r.cand_emp_company || "—",
      designation: r.cand_emp_designation || "—",
      department: "—",
      employee_id: r.cand_emp_empid || "—",
      start_date: r.cand_emp_from_date,
      end_date: r.cand_emp_to_date,
      is_current: r.cand_emp_to_date ? 0 : 1,
      annual_ctc: "—",
      reason_for_leaving: "—",
      hr_name: "—",
      hr_email: "—",
      hr_phone: "—",
      doc_file_path: r.cand_emp_joining || r.cand_emp_payslip || r.cand_emp_service || null,
      verification_status: r.emp_verification_status || 2,
      upload_date: r.created_at,
      ...r
    }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// GET /:id/background
router.get("/:id/background", async (req, res) => {
  try {
    const { id } = req.params;
    const [criminalRows] = await pool.query(
      `SELECT * FROM candidate_criminal WHERE cand_id = ?`,
      [id]
    );
    const [drugRows] = await pool.query(
      `SELECT * FROM candidate_drug WHERE cand_id = ?`,
      [id]
    );
    const criminal = criminalRows.map(c => ({
      criminal_id: c.cand_crim_id,
      case_details: c.cand_crim_remarks || (c.cand_crim_record === "Yes" ? "Criminal Record Exists" : "No Criminal Record"),
      court_name: c.cand_crim_remarks || "—",
      case_number: c.cand_crim_record === "Yes" ? (c.cand_crim_remarks || "Yes") : "None",
      doc_file_path: c.cand_crim_report || null,
      verification_status: c.crim_verification_status || 2,
      upload_date: c.created_at,
      ...c
    }));
    const drug = drugRows.map(d => ({
      drug_id: d.cand_drug_id,
      test_centre: d.cand_drug_test || "Standard Panel",
      test_date: d.cand_drug_date,
      doc_file_path: d.cand_drug_report || null,
      verification_status: d.drug_verification_status || 2,
      upload_date: d.created_at,
      ...d
    }));
    return res.status(200).json({ success: true, data: { criminal, drug } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

// GET /:id/reference
router.get("/:id/reference", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM candidate_reference WHERE cand_id = ? ORDER BY cand_ref_id`,
      [id]
    );
    const data = rows.map(r => ({
      ref_id: r.cand_ref_id,
      ref_person_name: r.cand_ref_name || "—",
      ref_person_designation: r.cand_ref_designation || "—",
      ref_person_company: r.cand_ref_org || "—",
      ref_person_phone: r.cand_ref_phone || "—",
      ref_email_address: r.cand_ref_email || "—",
      known_time: r.cand_ref_relation || "—",
      verification_status: 1,
      ...r
    }));
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

export default router;
