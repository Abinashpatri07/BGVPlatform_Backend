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
        cm.cand_id as candId,
        cm.case_type,
        cm.verification_status,
        cm.vendor_id,
        cm.vendor_name,
        c.candidate_first_name as firstName,
        c.candidate_last_name as lastName,
        c.candidate_email as email,
        c.candidate_mobile as phone,
        cm.created_at as createdAt
      FROM case_master cm
      JOIN candidate c ON cm.cand_id = c.cand_id
      WHERE cm.case_id IN (
        SELECT MAX(case_id) FROM case_master GROUP BY cand_id, case_type
      )
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
      rawCaseId: row.caseId,
      candId: row.candId,
      candidateId: row.candidateId,
      caseType: getCaseTypeName(row.case_type),
      rawCaseType: row.case_type,
      name: `${row.firstName || ''} ${row.lastName || ''}`.trim(),
      firstName: row.firstName || "",
      lastName: row.lastName || "",
      email: row.email || "N/A",
      phone: row.phone || "N/A",
      tat: "3 Days",
      status: getStatusName(row.verification_status),
      vendorId: row.vendor_id || null,
      vendorName: row.vendor_name || null,
      createdAt: row.createdAt
    }));

    res.status(200).json(formattedRows);
  } catch (error) {
    console.error("Super Admin Fetch Cases Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/superadmin/cases/details/{caseId}:
 *   get:
 *     summary: Fetch single case details with candidate and module records
 *     tags: [Super Admin Cases]
 */
router.get("/details/:caseId", async (req, res) => {
  try {
    const rawParam = req.params.caseId;
    // Strip "CASE-" prefix if passed
    const caseIdNum = parseInt(String(rawParam).replace(/[^0-9]/g, ""), 10);
    if (!caseIdNum) {
      return res.status(400).json({ success: false, message: "Invalid case ID" });
    }

    const [caseRows] = await pool.query(
      `SELECT 
        cm.*,
        c.cand_id,
        c.candidate_id,
        c.candidate_first_name,
        c.candidate_last_name,
        c.candidate_email,
        c.candidate_mobile,
        c.candidate_function,
        c.candidate_experience,
        ci.cand_dob,
        ci.cand_gender,
        ci.cand_father_name
       FROM case_master cm
       JOIN candidate c ON cm.cand_id = c.cand_id
       LEFT JOIN (
         SELECT cand_id, cand_dob, cand_gender, cand_father_name 
         FROM candidate_identity 
         GROUP BY cand_id
       ) ci ON ci.cand_id = c.cand_id
       WHERE cm.case_id = ?`,
      [caseIdNum]
    );

    if (caseRows.length === 0) {
      return res.status(404).json({ success: false, message: "Case not found" });
    }

    const caseData = caseRows[0];
    const candId = caseData.cand_id;
    const caseType = parseInt(caseData.case_type);

    let moduleRecords = [];
    if (caseType === 1) {
      // Identification: try case_id first, fall back to cand_id
      const [identRows] = await pool.query(
        `SELECT * FROM candidate_identity WHERE case_id = ? OR (case_id IS NULL AND cand_id = ?) ORDER BY cand_iden_id`,
        [caseIdNum, candId]
      );
      moduleRecords = identRows;
    } else if (caseType === 2) {
      const [addrRows] = await pool.query(
        `SELECT * FROM candidate_address WHERE case_id = ? OR (case_id IS NULL AND cand_id = ?) ORDER BY cand_add_id`,
        [caseIdNum, candId]
      );
      moduleRecords = addrRows;
    } else if (caseType === 3) {
      // Education: fetch all records for this candidate linked to this case, fall back to all for candidate
      const [eduRows] = await pool.query(
        `SELECT * FROM candidate_education WHERE case_id = ? ORDER BY cand_edu_id`,
        [caseIdNum]
      );
      if (eduRows.length > 0) {
        moduleRecords = eduRows;
      } else {
        // Fall back: get all education records for this candidate
        const [eduFallback] = await pool.query(
          `SELECT * FROM candidate_education WHERE cand_id = ? ORDER BY cand_edu_id`,
          [candId]
        );
        moduleRecords = eduFallback;
      }
    } else if (caseType === 4) {
      // Internship (also uses employment table)
      const [empRows] = await pool.query(
        `SELECT * FROM candidate_employment WHERE cand_id = ? AND cand_emp_type = 'Internship' ORDER BY cand_emp_id`,
        [candId]
      );
      moduleRecords = empRows;
    } else if (caseType === 5) {
      // Employment: fetch by case_id first, fall back to cand_id
      const [empRows] = await pool.query(
        `SELECT * FROM candidate_employment WHERE case_id = ? ORDER BY cand_emp_id`,
        [caseIdNum]
      );
      if (empRows.length > 0) {
        moduleRecords = empRows;
      } else {
        const [empFallback] = await pool.query(
          `SELECT * FROM candidate_employment WHERE cand_id = ? ORDER BY cand_emp_id`,
          [candId]
        );
        moduleRecords = empFallback;
      }
    } else if (caseType === 7) {
      // Drug test: fetch by case_id first, fall back to cand_id
      const [drugRows] = await pool.query(
        `SELECT * FROM candidate_drug WHERE case_id = ? ORDER BY cand_drug_id`,
        [caseIdNum]
      );
      if (drugRows.length > 0) {
        moduleRecords = drugRows;
      } else {
        const [drugFallback] = await pool.query(
          `SELECT * FROM candidate_drug WHERE cand_id = ? ORDER BY cand_drug_id`,
          [candId]
        );
        moduleRecords = drugFallback;
      }
    } else if (caseType === 8) {
      // Criminal: fetch by case_id first, fall back to cand_id
      const [crimRows] = await pool.query(
        `SELECT * FROM candidate_criminal WHERE case_id = ? ORDER BY cand_crim_id`,
        [caseIdNum]
      );
      if (crimRows.length > 0) {
        moduleRecords = crimRows;
      } else {
        const [crimFallback] = await pool.query(
          `SELECT * FROM candidate_criminal WHERE cand_id = ? ORDER BY cand_crim_id`,
          [candId]
        );
        moduleRecords = crimFallback;
      }
    } else if (caseType === 9) {
      // Reference: fetch by case_id first, fall back to cand_id
      const [refRows] = await pool.query(
        `SELECT * FROM candidate_reference WHERE case_id = ? ORDER BY cand_ref_id`,
        [caseIdNum]
      );
      if (refRows.length > 0) {
        moduleRecords = refRows;
      } else {
        const [refFallback] = await pool.query(
          `SELECT * FROM candidate_reference WHERE cand_id = ? ORDER BY cand_ref_id`,
          [candId]
        );
        moduleRecords = refFallback;
      }
    }

    res.status(200).json({
      success: true,
      case: {
        id: caseData.case_id,
        caseId: "CASE-" + caseData.case_id.toString().padStart(5, '0'),
        caseType: caseData.case_type,
        verificationStatus: caseData.verification_status,
        verificationComment: caseData.verification_comment,
        completedDate: caseData.completed_date,
        vendorId: caseData.vendor_id,
        vendorName: caseData.vendor_name,
        assignedDate: caseData.assigned_date,
        createdAt: caseData.created_at
      },
      candidate: {
        candId: caseData.cand_id,
        candidateId: caseData.candidate_id,
        firstName: caseData.candidate_first_name,
        lastName: caseData.candidate_last_name,
        fullName: `${caseData.candidate_first_name || ""} ${caseData.candidate_last_name || ""}`.trim(),
        email: caseData.candidate_email,
        phone: caseData.candidate_mobile,
        department: caseData.candidate_function,
        dob: caseData.cand_dob,
        gender: caseData.cand_gender,
        fatherName: caseData.cand_father_name,
        experience: caseData.candidate_experience
      },
      records: moduleRecords
    });
  } catch (error) {
    console.error("Super Admin Case Details Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
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

/**
 * @swagger
 * /api/superadmin/cases/update-decision:
 *   post:
 *     summary: Update verification decision and remarks for a case
 *     tags: [Super Admin Cases]
 */
router.post("/update-decision", async (req, res) => {
  try {
    const { caseId, decision, remarks } = req.body;
    if (!caseId) {
      return res.status(400).json({ success: false, message: "caseId is required" });
    }

    const caseIdNum = parseInt(String(caseId).replace(/[^0-9]/g, ""), 10);
    if (!caseIdNum) {
      return res.status(400).json({ success: false, message: "Valid caseId is required" });
    }

    // Status code mapping:
    // 1: Pending, 2: Assigned, 3: In Progress, 4: Verified, 5: Refute / Unable To Verify, 0: Unverified
    let statusNum = 4;
    const lowerDec = String(decision || "").toLowerCase();
    if (lowerDec.includes("refute") || lowerDec.includes("unable") || lowerDec.includes("fail")) {
      statusNum = 5;
    } else if (lowerDec.includes("pending")) {
      statusNum = 1;
    } else if (lowerDec.includes("partially") || lowerDec.includes("progress")) {
      statusNum = 3;
    } else if (lowerDec.includes("unverified")) {
      statusNum = 0;
    } else {
      statusNum = 4; // Verified
    }

    const [caseRows] = await pool.query("SELECT * FROM case_master WHERE case_id = ?", [caseIdNum]);
    if (caseRows.length === 0) {
      return res.status(404).json({ success: false, message: "Case not found" });
    }

    const caseData = caseRows[0];
    const caseType = parseInt(caseData.case_type);
    const candId = caseData.cand_id;

    // Update case_master status
    await pool.query(
      "UPDATE case_master SET verification_status = ?, updated_at = NOW() WHERE case_id = ?",
      [statusNum, caseIdNum]
    );

    // Update corresponding module table if applicable
    if (caseType === 1) {
      await pool.query("UPDATE candidate_identity SET iden_verification_status = ?, iden_verification_comment = ?, iden_verification_date = NOW() WHERE cand_id = ?", [statusNum, remarks || null, candId]);
    } else if (caseType === 2) {
      await pool.query("UPDATE candidate_address SET add_verification_status = ?, add_verification_comment = ?, add_verification_date = NOW() WHERE cand_id = ?", [statusNum, remarks || null, candId]);
    } else if (caseType === 3) {
      await pool.query("UPDATE candidate_education SET edu_verification_status = ?, edu_verification_comment = ?, edu_verification_date = NOW() WHERE cand_id = ?", [statusNum, remarks || null, candId]);
    } else if (caseType === 5) {
      await pool.query("UPDATE candidate_employment SET emp_verification_status = ?, emp_verification_comment = ?, emp_verification_date = NOW() WHERE cand_id = ?", [statusNum, remarks || null, candId]);
    } else if (caseType === 7) {
      await pool.query("UPDATE candidate_drug SET drug_verification_status = ?, drug_verification_comment = ?, drug_verification_date = NOW() WHERE cand_id = ?", [statusNum, remarks || null, candId]);
    } else if (caseType === 8) {
      await pool.query("UPDATE candidate_criminal SET crim_verification_status = ?, crim_verification_comment = ?, crim_verification_date = NOW() WHERE cand_id = ?", [statusNum, remarks || null, candId]);
    } else if (caseType === 9) {
      await pool.query("UPDATE candidate_reference SET ref_verification_status = ?, ref_verification_comment = ?, ref_verification_date = NOW() WHERE cand_id = ?", [statusNum, remarks || null, candId]);
    }

    res.status(200).json({ success: true, message: "Verification status updated successfully" });
  } catch (error) {
    console.error("Update Decision Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

export default router;
