import express from "express";

import multer from "multer";

import XLSX from "xlsx";

import validateCreateCandidate from
  "../../middleware/hr/validateCreateCandidate.js";

import pool from "../../config/db.js";

const router = express.Router();

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
        "SELECT cand_id FROM candidate_master WHERE candidate_mobile = ?",
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
        "SELECT cand_id FROM candidate_master WHERE candidate_email = ?",
        [email]
      );

      if (emailRows.length > 0) {
        return res.status(409).json({
          success: false,
          field: "email",
          message: "Email already exists",
        });
      }

      /* ── INSERT INTO candidate_master ── */
      const [result] = await pool.query(
        `INSERT INTO candidate_master
          (cm_id, created_by_users,
           candidate_first_name, candidate_last_name,
           candidate_email, candidate_mobile,
           candidate_function, candidate_tag,
           verification_status, is_active, is_delete,
           created_at, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, NOW(), NOW())`,
        [
          createdById || null,
          firstName,
          lastName,
          email,
          phone,
          jobFunction || null,
          tag || null,
        ]
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
        if (!item.firstName || !item.lastName || !item.phone || !item.email) {
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


      for (let i = 0; i < data.length; i++) {
        const item = data[i];

        const phone = String(item.phone).trim();
        const email = String(item.email).trim().toLowerCase();
        const firstName = String(item.firstName).trim();
        const lastName = String(item.lastName).trim();
        const jobFunction = item.jobFunction ? String(item.jobFunction).trim() : "";
        const tag = item.tag ? String(item.tag).trim() : "";

        /* Duplicate phone check */
        const [phoneRows] = await pool.query(
          "SELECT cand_id FROM candidate_master WHERE candidate_mobile = ?",
          [phone]
        );

        if (phoneRows.length > 0) {
          skipped.push({ row: i + 2, name: `${firstName} ${lastName}`, reason: "Phone already exists" });
          continue;
        }

        /* Duplicate email check */
        const [emailRows] = await pool.query(
          "SELECT cand_id FROM candidate_master WHERE candidate_email = ?",
          [email]
        );

        if (emailRows.length > 0) {
          skipped.push({ row: i + 2, name: `${firstName} ${lastName}`, reason: "Email already exists" });
          continue;
        }

        /* Insert */
        await pool.query(
          `INSERT INTO candidate_master
            (cm_id, candidate_first_name, candidate_last_name,
             candidate_email, candidate_mobile,
             candidate_function, candidate_tag,
             verification_status, is_active, is_delete,
             created_at, updated_at)
           VALUES (1, ?, ?, ?, ?, ?, ?, 1, 1, 0, NOW(), NOW())`,
          [firstName, lastName, email, phone, jobFunction || null, tag || null]
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
         FROM candidate_master
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

      const [countRows] = await pool.query(
        `SELECT COUNT(*) as total FROM candidate_master WHERE is_delete = 0`
      );
        const totalRecords = countRows[0].total;
      const totalPages = Math.ceil(totalRecords / limit);

      const [rows] = await pool.query(
        `SELECT
          cand_id,
          cand_id AS case_id,
          created_by_users AS created_by_hr,
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
         FROM candidate_master
         WHERE is_delete = 0
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?`,
        [limit, offset]
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
        "SELECT cand_id FROM candidate_master WHERE cand_id = ? AND is_delete = 0",
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Candidate not found",
        });
      }

      await pool.query(
        "UPDATE candidate_master SET case_status = 5, updated_at = NOW() WHERE cand_id = ?",
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
        "SELECT cand_id FROM candidate_master WHERE cand_id = ? AND is_delete = 0",
        [id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Candidate not found",
        });
      }

      await pool.query(
        "UPDATE candidate_master SET case_status = 6, updated_at = NOW() WHERE cand_id = ?",
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
router.get("/:id/personal", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT cand_id, case_id, first_name, last_name, email, phone,
              date_of_birth, gender, father_name, nationality,
              job_function, tag, case_status, created_at, updated_at
       FROM candidate_master
       WHERE cand_id = ? AND is_delete = 0`,
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

/**
 * @swagger
 * /api/candidates/{id}/personal:
 *   put:
 *     summary: Update Candidate Personal Info
 *     tags: [HR - Candidate]
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
 *               first_name:
 *                 type: string
 *               last_name:
 *                 type: string
 *               email:
 *                 type: string
 *               phone:
 *                 type: string
 *               date_of_birth:
 *                 type: string
 *                 format: date
 *               gender:
 *                 type: string
 *               father_name:
 *                 type: string
 *               nationality:
 *                 type: string
 *               job_function:
 *                 type: string
 *               tag:
 *                 type: string
 *     responses:
 *       200:
 *         description: Personal info updated
 *       500:
 *         description: Internal Server Error
 */
router.put("/:id/personal", async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, date_of_birth, gender, father_name, nationality, job_function, tag } = req.body;
    await pool.query(
      `UPDATE candidate_master
       SET first_name=?, last_name=?, email=?, phone=?,
           date_of_birth=?, gender=?, father_name=?, nationality=?,
           job_function=?, tag=?, updated_at=NOW()
       WHERE cand_id=? AND is_delete=0`,
      [first_name, last_name, email, phone, date_of_birth || null, gender || null, father_name, nationality, job_function, tag, id]
    );
    return res.status(200).json({ success: true, message: "Personal info updated" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/candidates/{id}/address:
 *   get:
 *     summary: Get Candidate Address
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
 *         description: Address data
 *       500:
 *         description: Internal Server Error
 */
router.get("/:id/address", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM candidate_address WHERE cand_id = ? AND is_delete = 0`,
      [id]
    );
    return res.status(200).json({ success: true, data: rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/candidates/{id}/address:
 *   put:
 *     summary: Save/Update Candidate Address (Upsert)
 *     tags: [HR - Candidate]
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
 *               permanent_address:
 *                 type: string
 *               permanent_city:
 *                 type: string
 *               permanent_area:
 *                 type: string
 *               permanent_state:
 *                 type: string
 *               permanent_country:
 *                 type: string
 *               permanent_zipcode:
 *                 type: string
 *               current_address_same_as_permanent:
 *                 type: integer
 *                 example: 1
 *               candidate_current_address:
 *                 type: string
 *               current_city:
 *                 type: string
 *               current_state:
 *                 type: string
 *               current_country:
 *                 type: string
 *               current_zipcode:
 *                 type: string
 *     responses:
 *       200:
 *         description: Address saved
 *       500:
 *         description: Internal Server Error
 */
router.put("/:id/address", async (req, res) => {
  try {
    const { id } = req.params;
    const {
      permanent_address, permanent_city, permanent_area, permanent_state,
      permanent_country, permanent_zipcode,
      current_address_same_as_permanent,
      candidate_current_address, current_city, current_area,
      current_state, current_country, current_zipcode,
    } = req.body;

    const [existing] = await pool.query(
      "SELECT addr_id FROM candidate_address WHERE cand_id = ?", [id]
    );

    if (existing.length > 0) {
      await pool.query(
        `UPDATE candidate_address
         SET permanent_address=?, permanent_city=?, permanent_area=?, permanent_state=?,
             permanent_country=?, permanent_zipcode=?, current_address_same_as_permanent=?,
             candidate_current_address=?, current_city=?, current_area=?,
             current_state=?, current_country=?, current_zipcode=?, updated_at=NOW()
         WHERE cand_id=?`,
        [permanent_address, permanent_city, permanent_area, permanent_state,
          permanent_country, permanent_zipcode, current_address_same_as_permanent || 2,
          candidate_current_address, current_city, current_area,
          current_state, current_country, current_zipcode, id]
      );
    } else {
      await pool.query(
        `INSERT INTO candidate_address
         (cand_id, permanent_address, permanent_city, permanent_area, permanent_state,
          permanent_country, permanent_zipcode, current_address_same_as_permanent,
          candidate_current_address, current_city, current_area,
          current_state, current_country, current_zipcode, is_delete)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`,
        [id, permanent_address, permanent_city, permanent_area, permanent_state,
          permanent_country, permanent_zipcode, current_address_same_as_permanent || 2,
          candidate_current_address, current_city, current_area,
          current_state, current_country, current_zipcode]
      );
    }
    return res.status(200).json({ success: true, message: "Address saved" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/candidates/{id}/identity:
 *   get:
 *     summary: Get Candidate Identity Documents
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
 *         description: List of identity documents (1=PAN, 2=Aadhaar, 3=Passport, 4=DrivingLicense, 5=VoterID)
 *       500:
 *         description: Internal Server Error
 */
router.get("/:id/identity", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT id_doc_id, doc_type, doc_number, verification_status, upload_date
       FROM candidate_id_document
       WHERE cand_id = ? AND is_delete = 0
       ORDER BY doc_type`,
      [id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/candidates/{id}/education:
 *   get:
 *     summary: Get Candidate Education Records
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
 *         description: Education records
 *       500:
 *         description: Internal Server Error
 */
router.get("/:id/education", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT edu_id, institution_name, degree, field_of_study, board_university,
              roll_number, start_year, end_year, percentage_cgpa,
              doc_file_path, verification_status, upload_date
       FROM candidate_education
       WHERE cand_id = ? AND is_delete = 0
       ORDER BY edu_id`,
      [id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/candidates/{id}/employment:
 *   get:
 *     summary: Get Candidate Employment Records
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
 *         description: Employment records
 *       500:
 *         description: Internal Server Error
 */
router.get("/:id/employment", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT emp_id, employer_name, designation, department, employee_id,
              start_date, end_date, is_current, annual_ctc,
              reason_for_leaving, hr_name, hr_email, hr_phone,
              doc_file_path, verification_status, upload_date
       FROM candidate_employment
       WHERE cand_id = ? AND is_delete = 0
       ORDER BY start_date DESC`,
      [id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/candidates/{id}/background:
 *   get:
 *     summary: Get Candidate Background Check (Criminal + Drug)
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
 *         description: Criminal and drug test records
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     criminal:
 *                       type: array
 *                       items:
 *                         type: object
 *                     drug:
 *                       type: array
 *                       items:
 *                         type: object
 *       500:
 *         description: Internal Server Error
 */
router.get("/:id/background", async (req, res) => {
  try {
    const { id } = req.params;
    const [criminal] = await pool.query(
      `SELECT criminal_id, case_details, court_name, case_number,
              doc_file_path, verification_status, upload_date
       FROM candidate_criminal_check
       WHERE cand_id = ? AND is_delete = 0`,
      [id]
    );
    const [drug] = await pool.query(
      `SELECT drug_id, test_centre, test_date,
              doc_file_path, verification_status, upload_date
       FROM candidate_drug_test
       WHERE cand_id = ? AND is_delete = 0`,
      [id]
    );
    return res.status(200).json({ success: true, data: { criminal, drug } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/candidates/{id}/reference:
 *   get:
 *     summary: Get Candidate References
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
 *         description: Reference records
 *       500:
 *         description: Internal Server Error
 */
router.get("/:id/reference", async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(
      `SELECT ref_id, ref_person_name, ref_person_designation,
              ref_person_company, ref_person_phone, ref_email_address,
              known_time, verification_status
       FROM candidate_reference
       WHERE cand_id = ? AND is_delete = 0
       ORDER BY ref_id`,
      [id]
    );
    return res.status(200).json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

export default router;
