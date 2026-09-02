import express from "express";
import pool from "../../config/db.js";

const router = express.Router();

/**
 * @swagger
 * /api/superadmin/cases/get-all:
 *   get:
 *     summary: Fetch all cases for super admin
 *     tags: [Super Admin Cases]
 */
router.get("/get-all", async (req, res) => {
  try {
    const query = `
      SELECT 
        cm.case_id as id,
        cm.case_id as caseId,
        cm.candidate_id as candidateId,
        cm.case_type,
        cm.verification_status,
        c.candidate_first_name as firstName,
        c.candidate_last_name as lastName,
        c.candidate_email as email,
        c.candidate_mobile as phone,
        cm.created_at as createdAt
      FROM case_master cm
      JOIN candidate c ON cm.cand_id = c.cand_id
      ORDER BY cm.created_at DESC
    `;
    
    const [rows] = await pool.query(query);

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
        case 5: return "Refute"; // Matches UI "Refute"
        case 6: return "Hold";
        default: return "Unverified"; // Defaulting anything else to Unverified
      }
    };

    const formattedRows = rows.map(row => ({
      id: row.id,
      caseId: "CASE-" + row.caseId.toString().padStart(5, '0'),
      candidateId: row.candidateId,
      caseType: getCaseTypeName(row.case_type),
      name: `${row.firstName || ''} ${row.lastName || ''}`.trim(),
      email: row.email || "N/A",
      phone: row.phone || "N/A",
      tat: "3 Days", // Dummy TAT for now
      status: getStatusName(row.verification_status)
    }));

    res.status(200).json(formattedRows);
  } catch (error) {
    console.error("Super Admin Fetch Cases Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/superadmin/cases/assign-vendor:
 *   post:
 *     summary: Assign a vendor to cases (single or bulk)
 *     tags: [Super Admin Cases]
 */
router.post("/assign-vendor", async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { caseIds, vendorId } = req.body;
    if (!caseIds || !Array.isArray(caseIds) || caseIds.length === 0 || !vendorId) {
      return res.status(400).json({ success: false, message: "Invalid parameters" });
    }

    // Get vendor name
    const [vendorRows] = await connection.query("SELECT company_name FROM vendor_master WHERE vendor_id = ?", [vendorId]);
    if (vendorRows.length === 0) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }
    const vendorName = vendorRows[0].company_name;

    await connection.beginTransaction();

    for (const caseId of caseIds) {
      // Get the case details to find case_type
      const [caseRows] = await connection.query("SELECT case_type FROM case_master WHERE case_id = ?", [caseId]);
      if (caseRows.length === 0) continue;
      const caseType = parseInt(caseRows[0].case_type);

      // Update case_master
      await connection.query(
        "UPDATE case_master SET vendor_id = ?, vendor_name = ?, verification_status = 2, assigned_date = NOW() WHERE case_id = ?",
        [vendorId, vendorName, caseId]
      );

      // Update specific module table based on case_type
      let tableName = null;
      switch (caseType) {
        case 1: tableName = "candidate_identity"; break;
        case 2: tableName = "candidate_address"; break;
        case 3: tableName = "candidate_education"; break;
        case 5: tableName = "candidate_employment"; break;
        case 7: tableName = "candidate_drug"; break;
        case 8: tableName = "candidate_criminal"; break;
        case 9: tableName = "candidate_reference"; break;
      }

      if (tableName) {
        try {
          await connection.query(
            `UPDATE \`${tableName}\` SET vendor_id = ?, vendor_name = ? WHERE case_id = ?`,
            [vendorId, vendorName, caseId]
          );
        } catch (tableErr) {
          console.warn(`Could not update vendor on table ${tableName} for case ${caseId}:`, tableErr.message);
        }
      }
    }

    await connection.commit();
    res.status(200).json({ success: true, message: "Vendor assigned successfully" });
  } catch (error) {
    await connection.rollback();
    console.error("Assign Vendor Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  } finally {
    connection.release();
  }
});

export default router;
