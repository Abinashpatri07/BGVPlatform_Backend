import express from "express";
import pool from "../../config/db.js";
import { verifyToken } from "../../middleware/authMiddleware.js";

const router = express.Router();

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
      "SELECT cand_id FROM case_master WHERE case_id = ? AND vendor_id = ?",
      [caseId, vendorId]
    );
    if (cm.length === 0) return res.status(404).json({ success: false, message: "Case not found" });

    const [candidate] = await pool.query(
      "SELECT candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag FROM candidate WHERE cand_id = ?",
      [cm[0].cand_id]
    );

    const [eduRows] = await pool.query(
      "SELECT * FROM candidate_education WHERE cand_id = ? AND case_id = ?",
      [cm[0].cand_id, caseId]
    );

    res.status(200).json({
      success: true,
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
      "SELECT cand_id FROM case_master WHERE case_id = ? AND vendor_id = ?",
      [caseId, vendorId]
    );
    if (cm.length === 0) return res.status(404).json({ success: false, message: "Case not found" });

    const [candidate] = await pool.query(
      "SELECT candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag FROM candidate WHERE cand_id = ?",
      [cm[0].cand_id]
    );

    const [empRows] = await pool.query(
      "SELECT * FROM candidate_employment WHERE cand_id = ? AND case_id = ?",
      [cm[0].cand_id, caseId]
    );

    res.status(200).json({
      success: true,
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
      "SELECT cand_id FROM case_master WHERE case_id = ? AND vendor_id = ?",
      [caseId, vendorId]
    );
    if (cm.length === 0) return res.status(404).json({ success: false, message: "Case not found" });

    const [candidate] = await pool.query(
      "SELECT candidate_first_name, candidate_last_name, candidate_email, candidate_mobile, candidate_function, candidate_tag FROM candidate WHERE cand_id = ?",
      [cm[0].cand_id]
    );

    const [drugRows] = await pool.query(
      "SELECT * FROM candidate_drug WHERE cand_id = ? AND case_id = ?",
      [cm[0].cand_id, caseId]
    );

    res.status(200).json({
      success: true,
      candidate: candidate[0] || {},
      drug: drugRows[0] || null
    });
  } catch (error) {
    console.error("Error fetching drug test details:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;

