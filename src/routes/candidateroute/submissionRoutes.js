import express from "express";
import pool from "../../config/db.js";

const router = express.Router();

// Helper to map frontend status to database iden_verification_status
const getVerificationStatus = (status) => {
  if (status === "success") return 2; // Verified
  if (status === "failed") return 3; // Rejected
  if (status === "verifying") return 1; // In Progress
  return 1; // Default to In Progress
};

// Helper to format date strings to YYYY-MM-DD for MySQL
const parseDate = (dateStr) => {
  if (!dateStr || typeof dateStr !== "string") return null;
  const cleaned = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return cleaned;
  
  const parts = cleaned.split(/[\/\-]/);
  if (parts.length === 3) {
    if (parts[2].length === 4) { // DD/MM/YYYY
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    } else if (parts[0].length === 4) { // YYYY/MM/DD
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
  }
  return null;
};

/**
 * @swagger
 * /api/candidate/submit/id-documents:
 *   post:
 *     summary: Submit Candidate ID Documents
 *     tags: [Candidate Submission]
 */
router.post("/id-documents", async (req, res) => {
  let conn;
  try {
    const { cand_id = 1, documents } = req.body; 

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return res.status(400).json({ error: "No documents provided" });
    }

    conn = await pool.getConnection();
    await conn.beginTransaction();

    for (const doc of documents) {
      const statusEnum = getVerificationStatus(doc.verification_status);
      const ocr = doc.ocr_data || {};
      
      const pan = doc.doc_type === "PAN card" ? doc.doc_number : null;
      const passport = doc.doc_type === "Passport" ? doc.doc_number : null;
      const dl = doc.doc_type === "Driving license" ? doc.doc_number : null;
      const voter = doc.doc_type === "Voter ID" ? doc.doc_number : null;

      // Extract general fields
      const cand_full_name = ocr.full_name || (ocr.first_name ? `${ocr.first_name} ${ocr.last_name || ''}`.trim() : null);
      const cand_father_name = ocr.father_name || null;
      const cand_dob = parseDate(ocr.date_of_birth);
      const cand_gender = ocr.gender || null;
      const cand_nationality = ocr.nationality || null;
      const cand_birth_place = ocr.place_of_birth || null;
      const cand_address = ocr.address || null;
      const cand_blood_group = ocr.blood_group || null;
      const cand_vehicle_class = ocr.vehicle_class || null;

      // Extract specific fields
      const pass_issue_date = doc.doc_type === "Passport" ? parseDate(ocr.date_of_issue) : null;
      const pass_expiry_date = doc.doc_type === "Passport" ? parseDate(ocr.date_of_expiry) : null;
      const pass_first_name = doc.doc_type === "Passport" ? (ocr.first_name || null) : null;
      const pass_last_name = doc.doc_type === "Passport" ? (ocr.last_name || null) : null;

      const driv_issue_date = doc.doc_type === "Driving license" ? parseDate(ocr.issued_date) : null;
      const driv_expiry_date = doc.doc_type === "Driving license" ? parseDate(ocr.expire_date) : null;

      const voter_issue_date = doc.doc_type === "Voter ID" ? parseDate(ocr.date_of_issue) : null;

      const query = `
        INSERT INTO candidate_identity 
        (
          cand_id, candidate_id, client_id, cand_iden_type, iden_verification_status,
          pan_number, passport_number, driving_number, voter_number,
          cand_full_name, cand_father_name, cand_dob, cand_gender, cand_nationality,
          cand_birth_place, cand_address, cand_blood_group, cand_vehicle_class,
          pass_issue_date, pass_expiry_date, pass_first_name, pass_last_name,
          driv_issue_date, driv_expiry_date,
          voter_issue_date
        ) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await conn.query(query, [
        cand_id,
        "CAND-" + cand_id, 
        1, 
        doc.doc_type,
        statusEnum,
        pan,
        passport,
        dl,
        voter,
        cand_full_name,
        cand_father_name,
        cand_dob,
        cand_gender,
        cand_nationality,
        cand_birth_place,
        cand_address,
        cand_blood_group,
        cand_vehicle_class,
        pass_issue_date,
        pass_expiry_date,
        pass_first_name,
        pass_last_name,
        driv_issue_date,
        driv_expiry_date,
        voter_issue_date
      ]);
    }

    await conn.commit();
    res.status(200).json({ message: "ID Documents submitted successfully" });

  } catch (error) {
    if (conn) await conn.rollback();
    console.error("Submit ID Documents Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  } finally {
    if (conn) conn.release();
  }
});

/**
 * @swagger
 * /api/candidate/submit/uan:
 *   post:
 *     summary: Submit UAN
 *     tags: [Candidate Submission]
 */
router.post("/uan", async (req, res) => {
  try {
    const { cand_id = 1, has_uan, uan_number } = req.body;

    if (has_uan && !uan_number) {
      return res.status(400).json({ error: "UAN number is required if candidate has UAN" });
    }

    const query = `
      INSERT INTO candidate_identity 
      (cand_id, candidate_id, client_id, cand_iden_type, iden_verification_status, uan_number) 
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    
    // doc_type 6 = UAN, status 1 = Pending
    await pool.query(query, [
      cand_id, 
      "CAND-" + cand_id, 
      1, 
      6, 
      1, 
      has_uan ? uan_number : null
    ]);

    res.status(200).json({ message: "UAN saved successfully" });
  } catch (error) {
    console.error("Submit UAN Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});

export default router;
