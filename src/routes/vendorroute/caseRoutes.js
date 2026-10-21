import express from "express";
import pool from "../../config/db.js";
import { verifyToken } from "../../middleware/authMiddleware.js";
import multer from "multer";
import { getUploadStorage, getUploadedFilePath } from "../../config/cloudinary.js";

const upload = multer({ storage: getUploadStorage() });

const router = express.Router();

// Module-level helper so all route handlers can use it
const getStatusName = (status) => {
  switch (parseInt(status)) {
    case 1: return "Pending";
    case 2: return "Assigned";
    case 3: return "In Progress";
    case 4: return "Verified";
    case 5: return "Refute";
    case 6: return "Hold";
    default: return "Unverified";
  }
};

/**
 * @swagger
 * /api/vendor/cases/assigned:
 *   get:
 *     summary: Get all cases assigned to the authenticated vendor
 *     tags: [Vendor - Cases]
 *     security:
 *       - bearerAuth: []
 */
router.get("/assigned", verifyToken, async (req, res) => {
  try {
    const vendorId = req.user.id;

    const query = `
      SELECT 
        cm.case_id,
        cm.candidate_id,
        c.cand_id,
        c.candidate_first_name,
        c.candidate_last_name,
        c.candidate_email,
        c.candidate_mobile,
        cm.case_type,
        cm.sla_days,
        cm.verification_status,
        cm.assigned_date,
        cm.completed_date
      FROM case_master cm
      JOIN candidate c ON cm.cand_id = c.cand_id
      WHERE cm.vendor_id = ?
      ORDER BY cm.created_at DESC
    `;

    const [rows] = await pool.query(query, [vendorId]);

    const getCaseTypeName = (type) => {
      switch (parseInt(type)) {
        case 1: return "Identification";
        case 2: return "Address Verification";
        case 3: return "Education Verification";
        case 4: return "Internship";
        case 5: return "Employment Verification";
        case 6: return "UAN";
        case 7: return "Drug Test";
        case 8: return "Criminal Check";
        case 9: return "Reference Check";
        case 10: return "Credit Check";
        case 11: return "PCC";
        default: return "Unknown";
      }
    };

    const getStatusName = (status) => {
      switch (parseInt(status)) {
        case 1: return "Pending";
        case 2: return "Assigned";
        case 3: return "In Progress";
        case 4: return "Verified";
        case 5: return "Refute";
        case 6: return "Hold";
        default: return "Unverified";
      }
    };

    const formattedRows = rows.map(row => ({
      id: row.case_id, // For row selection
      caseId: "CASE-" + row.case_id.toString().padStart(5, '0'),
      candidateId: row.candidate_id,
      cand_id: row.cand_id,
      caseType: getCaseTypeName(row.case_type),
      name: `${row.candidate_first_name || ''} ${row.candidate_last_name || ''}`.trim(),
      email: row.candidate_email || "N/A",
      phone: row.candidate_mobile || "N/A",
      tat: (row.sla_days || 0) + " Days",
      status: getStatusName(row.verification_status),
      assigned_date: row.assigned_date
    }));

    res.status(200).json({ success: true, data: formattedRows });
  } catch (error) {
    console.error("Error fetching vendor cases:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});


/**
 * GET /api/vendor/cases/details/:caseId
 * Returns candidate basic info for a given case
 */
router.get("/details/:caseId", verifyToken, async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { caseId } = req.params;

    const [rows] = await pool.query(
      `SELECT cm.case_id, cm.case_type, cm.verification_status, cm.sla_days, cm.assigned_date,
              c.cand_id, c.candidate_id, c.candidate_first_name, c.candidate_last_name,
              c.candidate_email, c.candidate_mobile, c.candidate_function, c.candidate_tag
       FROM case_master cm
       JOIN candidate c ON cm.cand_id = c.cand_id
       WHERE cm.case_id = ? AND cm.vendor_id = ?`,
      [caseId, vendorId]
    );

    if (rows.length === 0) return res.status(404).json({ success: false, message: "Case not found" });
    res.status(200).json({ success: true, data: rows[0] });
  } catch (error) {
    console.error("Error fetching case details:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/vendor/cases/education/:caseId
 * Returns education records for a case
 */
router.get("/education/:caseId", verifyToken, async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { caseId } = req.params;

    // Verify this case belongs to vendor
    const [cm] = await pool.query(
      "SELECT cand_id, verification_status FROM case_master WHERE case_id = ? AND vendor_id = ?",
      [caseId, vendorId]
    );
    if (cm.length === 0) return res.status(404).json({ success: false, message: "Case not found" });

    const [candidate] = await pool.query(
      "SELECT candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag FROM candidate WHERE cand_id = ?",
      [cm[0].cand_id]
    );

    let [eduRows] = await pool.query(
      "SELECT * FROM candidate_education WHERE case_id = ? ORDER BY cand_edu_id",
      [caseId]
    );
    if (eduRows.length === 0) {
      const [eduFallback] = await pool.query(
        "SELECT * FROM candidate_education WHERE cand_id = ? ORDER BY cand_edu_id",
        [cm[0].cand_id]
      );
      eduRows = eduFallback;
    }

    res.status(200).json({
      success: true,
      caseStatus: getStatusName(cm[0].verification_status),
      candidate: candidate[0] || {},
      education: eduRows
    });
  } catch (error) {
    console.error("Error fetching education details:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/vendor/cases/employment/:caseId
 * Returns employment records for a case
 */
router.get("/employment/:caseId", verifyToken, async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { caseId } = req.params;

    const [cm] = await pool.query(
      "SELECT cand_id, verification_status FROM case_master WHERE case_id = ? AND vendor_id = ?",
      [caseId, vendorId]
    );
    if (cm.length === 0) return res.status(404).json({ success: false, message: "Case not found" });

    const [candidate] = await pool.query(
      "SELECT candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag FROM candidate WHERE cand_id = ?",
      [cm[0].cand_id]
    );

    let [empRows] = await pool.query(
      "SELECT * FROM candidate_employment WHERE case_id = ? ORDER BY cand_emp_id",
      [caseId]
    );
    if (empRows.length === 0) {
      const [empFallback] = await pool.query(
        "SELECT * FROM candidate_employment WHERE cand_id = ? ORDER BY cand_emp_id",
        [cm[0].cand_id]
      );
      empRows = empFallback;
    }

    res.status(200).json({
      success: true,
      caseStatus: getStatusName(cm[0].verification_status),
      candidate: candidate[0] || {},
      employment: empRows
    });
  } catch (error) {
    console.error("Error fetching employment details:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/vendor/cases/drug/:caseId
 * Returns drug test records for a case
 */
router.get("/drug/:caseId", verifyToken, async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { caseId } = req.params;

    const [cm] = await pool.query(
      "SELECT cand_id, verification_status FROM case_master WHERE case_id = ? AND vendor_id = ?",
      [caseId, vendorId]
    );
    if (cm.length === 0) return res.status(404).json({ success: false, message: "Case not found" });

    const [candidate] = await pool.query(
      "SELECT candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag FROM candidate WHERE cand_id = ?",
      [cm[0].cand_id]
    );

    let [drugRows] = await pool.query(
      "SELECT * FROM candidate_drug WHERE case_id = ? ORDER BY cand_drug_id",
      [caseId]
    );
    if (drugRows.length === 0) {
      const [drugFallback] = await pool.query(
        "SELECT * FROM candidate_drug WHERE cand_id = ? ORDER BY cand_drug_id",
        [cm[0].cand_id]
      );
      drugRows = drugFallback;
    }

    res.status(200).json({
      success: true,
      caseStatus: getStatusName(cm[0].verification_status),
      candidate: candidate[0] || {},
      drug: drugRows[0] || null
    });
  } catch (error) {
    console.error("Error fetching drug test details:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/vendor/cases/criminal/:caseId
 * Returns criminal check records for a case
 */
router.get("/criminal/:caseId", verifyToken, async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { caseId } = req.params;

    const [cm] = await pool.query(
      "SELECT cand_id, verification_status FROM case_master WHERE case_id = ? AND vendor_id = ?",
      [caseId, vendorId]
    );
    if (cm.length === 0) return res.status(404).json({ success: false, message: "Case not found" });

    const [candidate] = await pool.query(
      "SELECT candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag FROM candidate WHERE cand_id = ?",
      [cm[0].cand_id]
    );

    let [crimRows] = await pool.query(
      "SELECT * FROM candidate_criminal WHERE case_id = ? ORDER BY cand_crim_id",
      [caseId]
    );
    if (crimRows.length === 0) {
      const [crimFallback] = await pool.query(
        "SELECT * FROM candidate_criminal WHERE cand_id = ? ORDER BY cand_crim_id",
        [cm[0].cand_id]
      );
      crimRows = crimFallback;
    }

    res.status(200).json({
      success: true,
      caseStatus: getStatusName(cm[0].verification_status),
      candidate: candidate[0] || {},
      criminal: crimRows[0] || null,
      records: crimRows
    });
  } catch (error) {
    console.error("Error fetching criminal details:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/vendor/cases/reference/:caseId
 * Returns reference check records for a case
 */
router.get("/reference/:caseId", verifyToken, async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { caseId } = req.params;

    const [cm] = await pool.query(
      "SELECT cand_id, verification_status FROM case_master WHERE case_id = ? AND vendor_id = ?",
      [caseId, vendorId]
    );
    if (cm.length === 0) return res.status(404).json({ success: false, message: "Case not found" });

    const [candidate] = await pool.query(
      "SELECT candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag FROM candidate WHERE cand_id = ?",
      [cm[0].cand_id]
    );

    let [refRows] = await pool.query(
      "SELECT * FROM candidate_reference WHERE case_id = ? ORDER BY cand_ref_id",
      [caseId]
    );
    if (refRows.length === 0) {
      const [refFallback] = await pool.query(
        "SELECT * FROM candidate_reference WHERE cand_id = ? ORDER BY cand_ref_id",
        [cm[0].cand_id]
      );
      refRows = refFallback;
    }

    res.status(200).json({
      success: true,
      caseStatus: getStatusName(cm[0].verification_status),
      candidate: candidate[0] || {},
      records: refRows
    });
  } catch (error) {
    console.error("Error fetching reference details:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * GET /api/vendor/cases/identity/:caseId
 * Returns identity verification records for a case
 */
router.get("/identity/:caseId", verifyToken, async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { caseId } = req.params;

    const [cm] = await pool.query(
      "SELECT cand_id, verification_status FROM case_master WHERE case_id = ? AND vendor_id = ?",
      [caseId, vendorId]
    );
    if (cm.length === 0) return res.status(404).json({ success: false, message: "Case not found" });

    const [candidate] = await pool.query(
      "SELECT candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag FROM candidate WHERE cand_id = ?",
      [cm[0].cand_id]
    );

    let [identRows] = await pool.query(
      "SELECT * FROM candidate_identity WHERE case_id = ? ORDER BY cand_iden_id",
      [caseId]
    );
    if (identRows.length === 0) {
      const [identFallback] = await pool.query(
        "SELECT * FROM candidate_identity WHERE cand_id = ? ORDER BY cand_iden_id",
        [cm[0].cand_id]
      );
      identRows = identFallback;
    }

    res.status(200).json({
      success: true,
      caseStatus: getStatusName(cm[0].verification_status),
      candidate: candidate[0] || {},
      records: identRows
    });
  } catch (error) {
    console.error("Error fetching identity details:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * POST /api/vendor/cases/:caseId/verify
 * Vendor submits verification decision and remarks
 */
router.post("/:caseId/verify", verifyToken, upload.single("evidenceFile"), async (req, res) => {
  try {
    const vendorId = req.user.id;
    const { caseId } = req.params;
    const { decision, remarks } = req.body;

    // Verify the case belongs to this vendor
    const [cm] = await pool.query(
      "SELECT case_id FROM case_master WHERE case_id = ? AND vendor_id = ?",
      [caseId, vendorId]
    );
    if (cm.length === 0) {
      return res.status(404).json({ success: false, message: "Case not found or unauthorized" });
    }

    // Map frontend string to status ID
    let statusId = 4; // Default Verified
    if (decision === "Unable To Verify") statusId = 5; // Refute
    else if (decision === "Verification Pending") statusId = 6; // Hold
    else if (decision === "Partially Verified") statusId = 4; // Or custom if defined

    const evidencePath = req.file ? getUploadedFilePath(req.file.path) : null;
    let fullComment = remarks || "";
    if (evidencePath) {
      fullComment = fullComment ? `${fullComment}\n[Evidence: ${evidencePath}]` : `[Evidence: ${evidencePath}]`;
    }

    const query = `
      UPDATE case_master 
      SET 
        verification_status = ?, 
        verification_comment = ?,
        completed_date = CASE WHEN ? IN (4, 5) THEN NOW() ELSE completed_date END
      WHERE case_id = ? AND vendor_id = ?
    `;

    await pool.query(query, [statusId, fullComment, statusId, caseId, vendorId]);

    res.status(200).json({ success: true, message: "Verification submitted successfully", evidenceUrl: evidencePath });
  } catch (error) {
    console.error("Error submitting verification:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
