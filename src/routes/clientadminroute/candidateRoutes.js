import express from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import validateCandidateAction from "../../middleware/clientadmin/validateCandidateAction.js";
import validateCreateCandidate from "../../middleware/clientadmin/validateCreateCandidate.js";
import pool from "../../config/db.js";
import { sendEmail } from "../../utils/sendEmail.js";
import multer from "multer";
import * as XLSX from "xlsx";

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
  ];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only CSV/XLS/XLSX files allowed"), false);
  }
};

const upload = multer({ storage, fileFilter });
const router = express.Router();
import apiLogger from "../../middleware/apiLogger.js";
import { verifyToken } from "../../middleware/authMiddleware.js";

router.use(apiLogger({ sourceService: "Client Admin Portal", destinationService: "Backend API" }));

// Bypass verifyToken for candidate setup routes
router.use((req, res, next) => {
  const publicPaths = ['/setup-info', '/send-setup-otp', '/set-password'];
  if (publicPaths.includes(req.path)) {
    return next();
  }
  return verifyToken(req, res, next);
});

const sendCandidateWelcomeEmailHelper = (candidateName, candidateEmail, setupToken = null) => {
  const companyName = "Dqnex";
  const baseUrl = process.env.FRONTEND_URL || "https://bgv.dqnex.online";
  const portalUrl = setupToken ? `${baseUrl}/setup-password?token=${setupToken}` : `${baseUrl}/`;
  const supportEmail = "info@dqnex.com";
  const supportPhone = "+91-XXXXXXXXXX";

  const emailHtml = `
    <p>Dear ${candidateName},</p>
    <p>Welcome!</p>
    <p>Your background verification process has been initiated by <b>${companyName}</b>. To proceed, please complete your onboarding through our Background Verification Portal.</p>
    <p><b>What you need to do:</b></p>
    <ul>
      <li>Log in using the link below to set your password and access the portal.</li>
      <li>Verify your email address using the OTP sent to your registered email.</li>
      <li>Complete your personal and employment details.</li>
      <li>Upload the required documents (such as Aadhaar, PAN, educational certificates, and other requested documents).</li>
      <li>Review all the information carefully and submit your application.</li>
    </ul>
    <p><b>Portal Setup Link:</b> <a href="${portalUrl}">${portalUrl}</a></p>
    <p><b>Login Details:</b></p>
    <ul>
      <li><b>Email:</b> ${candidateEmail}</li>
    </ul>
    <p><b>Important Notes:</b></p>
    <ul>
      <li>Please ensure all information provided is accurate and matches your official documents.</li>
      <li>Upload clear, legible copies of all required documents.</li>
      <li>Incomplete or incorrect information may delay your verification process.</li>
      <li>If additional information is required, you will receive a notification via email.</li>
    </ul>
    <p>If you experience any issues while accessing the portal or completing your profile, please contact our support team:</p>
    <p><b>Email:</b> <a href="mailto:${supportEmail}">${supportEmail}</a><br>
    <b>Phone:</b> ${supportPhone}</p>
    <p>Thank you for your cooperation. We look forward to completing your background verification successfully.</p>
    <p>Best regards,<br>
    <b>Background Verification Team</b></p>
  `;

  return sendEmail({
    to: candidateEmail,
    subject: "Welcome to Background Verification Portal",
    text: `Dear ${candidateName},\n\nWelcome!\n\nYour background verification process has been initiated by ${companyName}. To proceed, please log in at ${portalUrl}\n\nLogin Email: ${candidateEmail}\n\nBest regards,\nBackground Verification Team`,
    html: emailHtml,
  }).catch(err => console.error("Error sending welcome email in background:", err));
};

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
      candidateExperience,
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

      const clientId = req.user?.client_id || req.body.cmId || 1;
      const createdBy = req.user?.id || req.body.clientAdminId || 2;
      const phoneToSave = req.body.phone || phone.trim();

      const [result] = await pool.execute(
        `INSERT INTO candidate
          (candidate_id, client_id, created_by_users, candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_experience, candidate_tag, verification_status, is_active, is_delete, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, 0, NOW(), NOW())`,
        [
          tempId,
          clientId,
          createdBy,
          firstName.trim(),
          lastName.trim(),
          email.trim().toLowerCase(),
          phoneToSave,
          jobFunction || null,
          candidateExperience ? Number(candidateExperience) : 1,
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

      // Generate a setup token
      const setupToken = crypto.randomBytes(32).toString('hex');
      const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

      // Insert into users table
      const dummyPassword = await bcrypt.hash(crypto.randomBytes(16).toString('hex'), 10);
      try {
        await pool.execute(
          `INSERT INTO users (first_name, last_name, username, email, role_id, role_name, password, password_reset_token, password_reset_expiry, is_active, is_delete)
           VALUES (?, ?, ?, ?, 4, 'candidate', ?, ?, ?, 1, 0)`,
          [firstName.trim(), lastName.trim(), email.trim().toLowerCase(), email.trim().toLowerCase(), dummyPassword, setupToken, tokenExpiry]
        );
      } catch (userErr) {
        if (userErr.code === "ER_DUP_ENTRY") {
          // If user exists, just update the token
          await pool.execute(
            `UPDATE users SET password_reset_token = ?, password_reset_expiry = ? WHERE email = ?`,
            [setupToken, tokenExpiry, email.trim().toLowerCase()]
          );
        } else {
          throw userErr;
        }
      }

      // Send Welcome Email automatically on creation
      sendCandidateWelcomeEmailHelper(`${firstName.trim()} ${lastName.trim()}`.trim(), email.trim().toLowerCase(), setupToken);

      // ── BILLING: Credit Deduction on Candidate Creation ──
      let creditMessage = null;
      let isOnHold = false;
      try {
        // Check current credit balance
        const [latestLedgerRows] = await pool.query(
          "SELECT balance_after FROM billing_credit_ledger WHERE client_id = ? ORDER BY credit_ledger_id DESC LIMIT 1",
          [clientId]
        );
        const currentBalance = latestLedgerRows.length > 0 ? parseFloat(latestLedgerRows[0].balance_after) : 0;

        if (currentBalance <= 0) {
          // No credits — put candidate on hold
          await pool.execute(
            `UPDATE candidate SET is_onhold = 1, is_reject = 0, onhold_comment = ?, verification_status = 5, updated_at = NOW() WHERE cand_id = ?`,
            ["Insufficient billing credits. Please recharge to proceed.", newCandId]
          );
          isOnHold = true;
          creditMessage = "Candidate placed on hold due to insufficient billing credits.";
        } else {
          // Deduct 1 credit unit
          const CREDIT_PER_CANDIDATE = 1;
          const newBalance = currentBalance - CREDIT_PER_CANDIDATE;

          // Insert deduction entry into billing_credit_ledger
          const [ledgerInsert] = await pool.execute(
            `INSERT INTO billing_credit_ledger
              (client_id, transaction_type, reference_type, reference_id, candidate_id, credit_out, balance_after, description, created_by)
             VALUES (?, 'CANDIDATE_ONBOARD', 'CANDIDATE', ?, ?, ?, ?, ?, ?)`,
            [
              clientId,
              newCandId,
              newCandId,
              CREDIT_PER_CANDIDATE,
              newBalance,
              `Candidate onboarded: ${firstName.trim()} ${lastName.trim()} (${finalCandidateId})`,
              createdBy
            ]
          );

          // Insert into billing_usage_log
          const usageTransactionId = `USAGE-${Date.now()}-${newCandId}`;
          await pool.execute(
            `INSERT INTO billing_usage_log
              (transaction_id, client_id, candidate_id, verification_type, units_consumed, usage_status, credit_ledger_id, remarks, created_by)
             VALUES (?, ?, ?, 'CANDIDATE_ONBOARD', ?, 'SUCCESS', ?, ?, ?)`,
            [
              usageTransactionId,
              clientId,
              newCandId,
              CREDIT_PER_CANDIDATE,
              ledgerInsert.insertId,
              `1 credit deducted for candidate onboarding: ${finalCandidateId}`,
              createdBy
            ]
          );

          creditMessage = `1 credit deducted. Remaining balance: ${newBalance}`;
        }
      } catch (creditErr) {
        // Non-blocking — candidate is created, just log the billing error
        console.error("Credit deduction error (non-fatal):", creditErr);
      }

      return res.status(201).json({
        success: true,
        message: "Candidate Created Successfully",
        caseId: finalCandidateId,
        isOnHold,
        creditMessage,
        data: {
          cand_id: newCandId,
          case_id: finalCandidateId
        }
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
    const rawId = req.params.id;

    if (!rawId) {
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
      "SELECT cand_id, candidate_id, is_onhold FROM candidate WHERE (cand_id = ? OR candidate_id = ?) AND is_delete = 0",
      [rawId, rawId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    const candidate = existing[0];
    const actualCandId = candidate.cand_id;
    const actualCandidateCode = candidate.candidate_id;

    if (Number(candidate.is_onhold) === 1) {
      return res.status(400).json({ success: false, message: "Candidate is already on hold" });
    }

    /* ── UPDATE CANDIDATE STATUS ── */
    await pool.query(
      `UPDATE candidate
       SET is_onhold = 1, is_reject = 0, onhold_comment = ?, verification_status = 5, updated_at = NOW()
       WHERE cand_id = ?`,
      [reason.trim(), actualCandId]
    );

    /* ── PUT RELATIVE CASES ON HOLD (status 6 = Hold) ── */
    await pool.query(
      `UPDATE case_master
       SET verification_status = 6, verification_comment = ?, updated_at = NOW()
       WHERE cand_id = ? OR candidate_id = ?`,
      [reason.trim(), actualCandId, actualCandidateCode]
    );

    return res.status(200).json({
      success: true,
      message: "Candidate and relative cases placed on hold successfully",
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
    const rawId = req.params.id;

    if (!rawId) {
      return res.status(400).json({ success: false, message: "Invalid candidate ID" });
    }

    /* ── CHECK CANDIDATE EXISTS ── */
    const [existing] = await pool.query(
      "SELECT cand_id, candidate_id, is_onhold FROM candidate WHERE (cand_id = ? OR candidate_id = ?) AND is_delete = 0",
      [rawId, rawId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    const candidate = existing[0];
    const actualCandId = candidate.cand_id;
    const actualCandidateCode = candidate.candidate_id;

    if (Number(candidate.is_onhold) === 0) {
      return res.status(400).json({ success: false, message: "Candidate is not on hold" });
    }

    /* ── UPDATE STATUS ── */
    await pool.query(
      `UPDATE candidate
       SET is_onhold = 0, onhold_comment = NULL, verification_status = 2, updated_at = NOW()
       WHERE cand_id = ?`,
      [actualCandId]
    );

    /* ── RESTORE RELATIVE CASES (back to Assigned/2 or Pending/1) ── */
    await pool.query(
      `UPDATE case_master
       SET verification_status = CASE WHEN vendor_id IS NOT NULL THEN 2 ELSE 1 END, verification_comment = NULL, updated_at = NOW()
       WHERE (cand_id = ? OR candidate_id = ?) AND verification_status = 6`,
      [actualCandId, actualCandidateCode]
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
    const rawId = req.params.id;

    if (!rawId) {
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
      "SELECT cand_id, candidate_id, is_reject FROM candidate WHERE (cand_id = ? OR candidate_id = ?) AND is_delete = 0",
      [rawId, rawId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    const candidate = existing[0];
    const actualCandId = candidate.cand_id;
    const actualCandidateCode = candidate.candidate_id;

    if (Number(candidate.is_reject) === 1) {
      return res.status(400).json({ success: false, message: "Candidate is already rejected" });
    }

    /* ── UPDATE CANDIDATE STATUS ── */
    await pool.query(
      `UPDATE candidate
       SET is_reject = 1, is_onhold = 0, reject_comment = ?, verification_status = 3, updated_at = NOW()
       WHERE cand_id = ?`,
      [reason.trim(), actualCandId]
    );

    /* ── REJECT RELATIVE CASES (status 5 = Refute / Rejected) ── */
    await pool.query(
      `UPDATE case_master
       SET verification_status = 5, verification_comment = ?, updated_at = NOW()
       WHERE cand_id = ? OR candidate_id = ?`,
      [reason.trim(), actualCandId, actualCandidateCode]
    );

    return res.status(200).json({
      success: true,
      message: "Candidate and relative cases rejected successfully",
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
      const clientId = req.user.client_id;
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

/**
 * @swagger
 * /api/client-admin/candidate/send-welcome-email/{candId}:
 *   post:
 *     summary: Send a welcome email to a candidate (Client Admin)
 *     tags: [Client Admin - Candidate]
 *     parameters:
 *       - in: path
 *         name: candId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Email sent successfully
 *       404:
 *         description: Candidate not found
 *       500:
 *         description: Server Error
 */
router.post("/send-welcome-email/:candId", async (req, res) => {
  const { candId } = req.params;
  try {
    const [candidates] = await pool.query(
      "SELECT cand_id, candidate_id, candidate_first_name, candidate_last_name, candidate_email FROM candidate WHERE (cand_id = ? OR candidate_id = ?) AND is_delete = 0",
      [candId, candId]
    );

    if (candidates.length === 0) {
      return res.status(404).json({ success: false, message: "Candidate not found" });
    }

    const candidate = candidates[0];
    const candidateName = `${candidate.candidate_first_name} ${candidate.candidate_last_name}`.trim();
    const candidateEmail = candidate.candidate_email;

    // Always generate a fresh token when resending welcome email
    const { v4: uuidv4 } = await import("uuid");
    const setupToken = uuidv4();
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    // Get candidate name parts
    const firstName = candidate.candidate_first_name || "";
    const lastName = candidate.candidate_last_name || "";

    // INSERT user if not exists, otherwise UPDATE token
    const dummyPassword = `locked_${uuidv4()}`;
    await pool.query(
      `INSERT INTO users (first_name, last_name, username, email, role_id, role_name, password, password_reset_token, password_reset_expiry, is_active, is_delete)
       VALUES (?, ?, ?, ?, 4, 'candidate', ?, ?, ?, 1, 0)
       ON DUPLICATE KEY UPDATE password_reset_token = VALUES(password_reset_token), password_reset_expiry = VALUES(password_reset_expiry)`,
      [firstName, lastName, candidateEmail, candidateEmail, dummyPassword, setupToken, tokenExpiry]
    );

    // Send email asynchronously using helper
    sendCandidateWelcomeEmailHelper(candidateName, candidateEmail, setupToken);

    return res.status(200).json({ success: true, message: "Welcome email sent successfully." });
  } catch (err) {
    console.error("Send Welcome Email Error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

/**
 * @swagger
 * /api/client-admin/candidate/setup-info:
 *   get:
 *     summary: Get candidate setup info (email) by token
 *     tags: [Candidate]
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Success
 *       400:
 *         description: Invalid or expired token
 */
router.get("/setup-info", async (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ success: false, message: "Token is required." });
  }

  try {
    const [users] = await pool.query(
      "SELECT email FROM users WHERE password_reset_token = ? AND is_delete = 0",
      [token]
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
 * /api/client-admin/candidate/send-setup-otp:
 *   post:
 *     summary: Send OTP for password setup
 *     tags: [Candidate]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *     responses:
 *       200:
 *         description: OTP sent successfully
 */
router.post("/send-setup-otp", async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, message: "Token is required." });
  }

  try {
    const [users] = await pool.query(
      "SELECT users_id, email, first_name FROM users WHERE password_reset_token = ? AND is_delete = 0",
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired token." });
    }

    const user = users[0];
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

    await pool.query(
      "UPDATE users SET last_otp = ?, otp_expiry = ? WHERE users_id = ?",
      [otp, otpExpiry, user.users_id]
    );

    // Send email
    const emailSent = await sendEmail({
      to: user.email,
      subject: "Your OTP for Password Setup - BGV Platform",
      text: `Hello ${user.first_name},\n\nYour OTP to set your password is: ${otp}\n\nThis OTP is valid for 10 minutes.\n\nThank you.`,
      html: `
        <h3>Password Setup OTP</h3>
        <p>Hello <b>${user.first_name}</b>,</p>
        <p>Your OTP to set your new password is: <b style="font-size: 20px; color: #4F46E5;">${otp}</b></p>
        <p>This OTP is valid for 10 minutes.</p>
        <br/>
        <p>Thank you,<br/>BGV Platform Team</p>
      `,
    });

    if (!emailSent) {
      return res.status(500).json({ success: false, message: "Failed to send OTP email. Please try again." });
    }

    return res.status(200).json({ success: true, message: "OTP sent to your email." });
  } catch (err) {
    console.error("Send Setup OTP Error:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * @swagger
 * /api/client-admin/candidate/set-password:
 *   post:
 *     summary: Set password for a candidate with OTP
 *     tags: [Candidate]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - otp
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *               otp:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Password set successfully
 *       400:
 *         description: Invalid token or OTP
 *       500:
 *         description: Server error
 */
router.post("/set-password", async (req, res) => {
  const { token, otp, password } = req.body;

  if (!token || !otp || !password) {
    return res.status(400).json({ success: false, message: "Token, OTP, and password are required." });
  }

  try {
    // Verify token
    const [users] = await pool.query(
      "SELECT users_id, last_otp, otp_expiry FROM users WHERE password_reset_token = ? AND is_delete = 0",
      [token]
    );

    if (users.length === 0) {
      return res.status(400).json({ success: false, message: "Invalid or expired token." });
    }

    const user = users[0];

    // Verify OTP
    if (!user.last_otp || user.last_otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP." });
    }

    if (new Date() > new Date(user.otp_expiry)) {
      return res.status(400).json({ success: false, message: "OTP has expired. Please request a new one." });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Update password and clear token and OTP
    await pool.query(
      "UPDATE users SET password = ?, password_reset_token = NULL, password_reset_expiry = NULL, last_otp = NULL, otp_expiry = NULL WHERE users_id = ?",
      [hashedPassword, user.users_id]
    );

    return res.status(200).json({ success: true, message: "Password has been set successfully. You can now login." });
  } catch (err) {
    console.error("Set Password Error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

export default router;
