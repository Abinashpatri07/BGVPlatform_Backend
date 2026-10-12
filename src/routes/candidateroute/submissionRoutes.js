import express from "express";
import pool from "../../config/db.js";
import multer from "multer";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const ext = file.originalname.split('.').pop();
    cb(null, `candidate_emp_${Date.now()}.${ext}`);
  },
});
const upload = multer({ storage });

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

    if (has_uan) {
      if (!uan_number) {
        return res.status(400).json({ error: "UAN number is required if candidate has UAN" });
      }
      if (!/^\d{12}$/.test(uan_number)) {
        return res.status(400).json({ error: "UAN must be exactly 12 digits" });
      }
    }

    // Try to update existing employment records for this candidate
    const updateQuery = `
      UPDATE candidate_employment 
      SET cand_emp_uan_number = ? 
      WHERE cand_id = ?
    `;
    
    const [result] = await pool.query(updateQuery, [has_uan ? uan_number : null, cand_id]);

    // If no employment records exist (e.g. they skipped employment step), insert a new record
    if (result.affectedRows === 0 && has_uan) {
       const insertQuery = `
         INSERT INTO candidate_employment (cand_id, candidate_id, client_id, cand_emp_uan_number)
         VALUES (?, ?, ?, ?)
       `;
       await pool.query(insertQuery, [cand_id, "CAND-" + cand_id, 1, uan_number]);
    }

    res.status(200).json({ message: "UAN saved successfully" });
  } catch (error) {
    console.error("Submit UAN Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});

/**
 * @swagger
 * /api/candidate/submit/consent:
 *   post:
 *     summary: Submit Candidate Consent
 *     tags: [Candidate Submission]
 */
router.post("/consent", async (req, res) => {
  try {
    const { cand_id = 1, client_id = 1, latitude, longitude } = req.body;
    // Note: latitude/longitude are optional — if browser denies location, consent is still recorded

    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || 'Unknown';
    const datetime = new Date();
    const formattedDateTime = datetime.toISOString().slice(0, 19).replace('T', ' ');
    const candidate_id = "CAND-" + cand_id;

    const query = `
      INSERT INTO candidate_consent 
      (cand_id, candidate_id, client_id, cand_consent_status, cand_consent_latitude, cand_consent_longitude, cand_consent_ip_address, cand_consent_datetime) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    // Status 2 = Accepted
    await pool.query(query, [
      cand_id, 
      candidate_id, 
      client_id, 
      2, 
      latitude || null, 
      longitude || null, 
      ipAddress,
      formattedDateTime
    ]);

    res.status(200).json({ message: "Consent saved successfully" });
  } catch (error) {
    console.error("Submit Consent Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});

/**
 * @swagger
 * /api/candidate/submit/employment:
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

    // Clear old identity records for this candidate before inserting new ones
    await conn.query(`DELETE FROM candidate_identity WHERE cand_id = ?`, [cand_id]);

    const case_id = null;

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
          cand_id, candidate_id, client_id, case_id, cand_iden_type, iden_verification_status,
          pan_number, passport_number, driving_number, voter_number,
          cand_full_name, cand_father_name, cand_dob, cand_gender, cand_nationality,
          cand_birth_place, cand_address, cand_blood_group, cand_vehicle_class,
          pass_issue_date, pass_expiry_date, pass_first_name, pass_last_name,
          driv_issue_date, driv_expiry_date,
          voter_issue_date
        ) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      
      await conn.query(query, [
        cand_id,
        "CAND-" + cand_id, 
        1, 
        case_id,
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

    if (has_uan) {
      if (!uan_number) {
        return res.status(400).json({ error: "UAN number is required if candidate has UAN" });
      }
      if (!/^\d{12}$/.test(uan_number)) {
        return res.status(400).json({ error: "UAN must be exactly 12 digits" });
      }
    }

    // Try to update existing employment records for this candidate
    const updateQuery = `
      UPDATE candidate_employment 
      SET cand_emp_uan_number = ? 
      WHERE cand_id = ?
    `;
    
    const [result] = await pool.query(updateQuery, [has_uan ? uan_number : null, cand_id]);

    // If no employment records exist (e.g. they skipped employment step), insert a new record
    if (result.affectedRows === 0 && has_uan) {
    const case_id = null;

       const insertQuery = `
         INSERT INTO candidate_employment (cand_id, candidate_id, client_id, case_id, cand_emp_uan_number)
         VALUES (?, ?, ?, ?, ?)
       `;
       await pool.query(insertQuery, [cand_id, "CAND-" + cand_id, 1, case_id, uan_number]);
    }

    res.status(200).json({ message: "UAN saved successfully" });
  } catch (error) {
    console.error("Submit UAN Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});

/**
 * @swagger
 * /api/candidate/submit/consent:
 *   post:
 *     summary: Submit Candidate Consent
 *     tags: [Candidate Submission]
 */
router.post("/consent", async (req, res) => {
  try {
    const { cand_id = 1, client_id = 1, latitude, longitude } = req.body;
    // Note: latitude/longitude are optional — if browser denies location, consent is still recorded

    const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || 'Unknown';
    const datetime = new Date();
    const formattedDateTime = datetime.toISOString().slice(0, 19).replace('T', ' ');
    const candidate_id = "CAND-" + cand_id;

    const query = `
      INSERT INTO candidate_consent 
      (cand_id, candidate_id, client_id, cand_consent_status, cand_consent_latitude, cand_consent_longitude, cand_consent_ip_address, cand_consent_datetime) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    // Status 2 = Accepted
    await pool.query(query, [
      cand_id, 
      candidate_id, 
      client_id, 
      2, 
      latitude || null, 
      longitude || null, 
      ipAddress,
      formattedDateTime
    ]);

    res.status(200).json({ message: "Consent saved successfully" });
  } catch (error) {
    console.error("Submit Consent Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});




/**
 * @swagger
 * /api/candidate/submit/drug:
 *   post:
 *     summary: Submit Candidate Drug Test
 *     tags: [Candidate Submission]
 */
router.post("/drug", upload.single("reportFile"), async (req, res) => {
  try {
    const {
      cand_id = 1,
      drugStatus, // Yes or No
      drugDate,
      remarks,
      reportUrl // if URL is sent directly from frontend
    } = req.body;

    const candidate_id = "CAND-" + cand_id;
    const client_id = 1; // Assuming dummy client ID for now

    // URL calculation (either uploaded file path or direct URL)
    const finalReportUrl = req.file ? req.file.path : (reportUrl || null);

    // Clear old records first
    await pool.query(`DELETE FROM candidate_drug WHERE cand_id = ?`, [cand_id]);

    const case_id = null;

    const query = `
      INSERT INTO candidate_drug (
        cand_id,
        candidate_id,
        client_id,
        case_id,
        cand_drug_test,
        cand_drug_date,
        cand_drug_remarks,
        cand_drug_report
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await pool.query(query, [
      cand_id,
      candidate_id,
      client_id,
      case_id,
      drugStatus || null, // Saving Yes/No here in cand_drug_test (VARCHAR)
      drugDate || null,
      remarks || null,
      finalReportUrl // Saving URL in cand_drug_report
    ]);

    res.status(200).json({ message: "Drug test details saved successfully" });
  } catch (error) {
    console.error("Submit Drug Test Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});

/**
 * @swagger
 * /api/candidate/submit/criminal:
 *   post:
 *     summary: Submit Candidate Criminal Check
 *     tags: [Candidate Submission]
 */
router.post("/criminal", upload.single("reportFile"), async (req, res) => {
  try {
    const {
      cand_id = 1,
      criminalStatus, // Yes or No
      remarks,
      reportUrl // if URL is sent directly from frontend
    } = req.body;

    const candidate_id = "CAND-" + cand_id;
    const client_id = 1; // Assuming dummy client ID for now

    // URL calculation (either uploaded file path or direct URL)
    const finalReportUrl = req.file ? req.file.path : (reportUrl || null);

    // Clear old records first
    await pool.query(`DELETE FROM candidate_criminal WHERE cand_id = ?`, [cand_id]);

    const case_id = null;

    const query = `
      INSERT INTO candidate_criminal (
        cand_id,
        candidate_id,
        client_id,
        case_id,
        cand_crim_record,
        cand_crim_remarks,
        cand_crim_report
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    await pool.query(query, [
      cand_id,
      candidate_id,
      client_id,
      case_id,
      criminalStatus || null, // Saving Yes/No here in cand_crim_record (VARCHAR)
      remarks || null,
      finalReportUrl // Saving URL in cand_crim_report
    ]);

    res.status(200).json({ message: "Criminal check details saved successfully" });
  } catch (error) {
    console.error("Submit Criminal Check Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});

/**
 * @swagger
 * /api/candidate/submit/final:
 *   post:
 *     summary: Finalize Candidate Submission
 *     tags: [Candidate Submission]
 */
router.post("/final", async (req, res) => {
  try {
    const { cand_id = 1 } = req.body;
    
    // In this system candidate status 2 usually implies 'Submitted'
    const query = `UPDATE candidate SET verification_status = 2 WHERE cand_id = ?`;
    
    try {
      await pool.query(query, [cand_id]);
    } catch (updateErr) {
      console.warn("Failed to update candidate verification_status:", updateErr.message);
    }

    const candidate_id = "CAND-" + cand_id;
    const client_id = 1; // Default client ID as used elsewhere

    const moduleMappings = [
      { table: 'candidate_identity', type: 1 },
      { table: 'candidate_address', type: 2 },
      { table: 'candidate_education', type: 3 },
      { table: 'candidate_employment', type: 5 },
      { table: 'candidate_drug', type: 7 },
      { table: 'candidate_criminal', type: 8 },
      { table: 'candidate_reference', type: 9 }
    ];

    for (const mod of moduleMappings) {
      try {
        // Check if there are records in this table for the candidate
        const [rows] = await pool.query(`SELECT COUNT(*) as count FROM \`${mod.table}\` WHERE cand_id = ?`, [cand_id]);
        if (rows[0].count > 0) {
          // Create a new case in case_master
          const insertQuery = `
            INSERT INTO case_master (cand_id, candidate_id, client_id, case_type)
            VALUES (?, ?, ?, ?)
          `;
          const [result] = await pool.query(insertQuery, [cand_id, candidate_id, client_id, mod.type]);
          const newCaseId = result.insertId;

          // Update the child table with the generated case_id
          await pool.query(`UPDATE \`${mod.table}\` SET case_id = ? WHERE cand_id = ?`, [newCaseId, cand_id]);
        }
      } catch (err) {
        console.warn(`Failed to generate case for table ${mod.table}:`, err.message);
      }
    }
    
    res.status(200).json({ message: "Candidate finalized and submitted successfully" });
  } catch (error) {
    console.error("Final Submit Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});

/**
 * @swagger
 * /api/candidate/submit/reference:
 *   post:
 *     summary: Submit Candidate References
 *     tags: [Candidate Submission]
 */
router.post("/reference", async (req, res) => {
  try {
    const { cand_id = 1, references } = req.body;
    
    if (!references || !Array.isArray(references)) {
      return res.status(400).json({ error: "References array is required" });
    }

    const candidate_id = "CAND-" + cand_id;
    const client_id = 1; // Assuming dummy client ID for now

    // Clear old records first
    await pool.query(`DELETE FROM candidate_reference WHERE cand_id = ?`, [cand_id]);

    const case_id = null;

    const query = `
      INSERT INTO candidate_reference (
        cand_id,
        candidate_id,
        client_id,
        case_id,
        cand_ref_type,
        cand_ref_name,
        cand_ref_phone,
        cand_ref_email,
        cand_ref_relation,
        cand_ref_org
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // Loop through references array and insert each
    for (const ref of references) {
      await pool.query(query, [
        cand_id,
        candidate_id,
        client_id,
        case_id,
        ref.type || null,
        ref.name || null,
        ref.phone || null,
        ref.email || null,
        ref.relationship || null,
        ref.organization || null
      ]);
    }

    res.status(200).json({ message: "References saved successfully" });
  } catch (error) {
    console.error("Submit References Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});
/**
 * @swagger
 * /api/candidate/submit/employment:
 *   post:
 *     summary: Submit Candidate Employment
 *     tags: [Candidate Submission]
 */
router.post("/employment", upload.any(), async (req, res) => {
  try {
    const { cand_id = 1, employmentData } = req.body;
    let employmentArray = [];

    if (employmentData) {
      try {
        employmentArray = JSON.parse(employmentData);
      } catch (err) {
        return res.status(400).json({ error: "Invalid employmentData JSON format" });
      }
    }

    if (!employmentArray || !Array.isArray(employmentArray) || employmentArray.length === 0) {
      return res.status(400).json({ error: "No employment records provided" });
    }

    const candidate_id = "CAND-" + cand_id;
    const client_id = 1;
    const files = req.files || [];

    // Clear old employment records for this candidate (if it's a fresh submission)
    await pool.query(`DELETE FROM candidate_employment WHERE cand_id = ?`, [cand_id]);

    const case_id = null;

    const query = `
      INSERT INTO candidate_employment (
        cand_id,
        candidate_id,
        client_id,
        case_id,
        cand_emp_type,
        cand_first_name,
        cand_last_name,
        cand_emp_company,
        cand_emp_empid,
        cand_emp_designation,
        cand_emp_from_date,
        cand_emp_to_date,
        cand_emp_joining
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (let index = 0; index < employmentArray.length; index++) {
      const emp = employmentArray[index];
      const certFile = files.find(f => f.fieldname === `certificateFile_${index}`);
      const existingFileUrl = req.body[`existingFileUrl_${index}`];
      const certPath = certFile ? certFile.path : (existingFileUrl || null);
      
      const empType = emp.isInternship ? "Internship" : "Employment";

      await pool.query(query, [
        cand_id,
        candidate_id,
        client_id,
        case_id,
        empType,
        emp.firstName || null,
        emp.lastName || null,
        emp.companyName || null,
        emp.employeeId || null,
        emp.designation || null,
        parseDate(emp.fromDate) || null,
        parseDate(emp.toDate) || null,
        certPath
      ]);
    }

    res.status(200).json({ message: "Employment details saved successfully" });
  } catch (error) {
    console.error("Submit Employment Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});
/**
 * @swagger
 * /api/candidate/submit/education:
 *   post:
 *     summary: Submit Candidate Education
 *     tags: [Candidate Submission]
 */
router.post("/education", upload.any(), async (req, res) => {
  try {
    const { cand_id = 1, educationData } = req.body;
    let educationArray = [];
    
    if (educationData) {
      try {
        educationArray = JSON.parse(educationData);
      } catch (err) {
        return res.status(400).json({ error: "Invalid educationData JSON format" });
      }
    }

    if (!educationArray || !Array.isArray(educationArray) || educationArray.length === 0) {
      return res.status(400).json({ error: "No education records provided" });
    }

    const candidate_id = "CAND-" + cand_id;
    const client_id = 1; // Assuming dummy client ID for now
    const files = req.files || [];

    // Clear old education records for this candidate before inserting new ones
    await pool.query(`DELETE FROM candidate_education WHERE cand_id = ?`, [cand_id]);

    const case_id = null;

    const query = `
      INSERT INTO candidate_education (
        cand_id,
        candidate_id,
        client_id,
        case_id,
        cand_edu_type,
        cand_edu_institute,
        cand_edu_dgree,
        cand_specialization,
        cand_edu_grade,
        cand_edu_from_date,
        cand_edu_to_date,
        cand_edu_certificate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    for (const edu of educationArray) {
      // Find the file associated with this degree type (e.g., 'file_Matriculation')
      const matchedFile = files.find(f => f.fieldname === `file_${edu.degree}`);
      const existingFileUrl = req.body[`existingFileUrl_${edu.degree}`];
      const filePath = matchedFile ? matchedFile.path : (existingFileUrl || null);

      await pool.query(query, [
        cand_id,
        candidate_id,
        client_id,
        case_id,
        edu.degree || null,
        edu.institute || null,
        edu.degree || null,
        edu.course || null,
        edu.percentage || null,
        parseDate(edu.startDate) || null,
        parseDate(edu.endDate) || null,
        filePath
      ]);
    }

    res.status(200).json({ message: "Education details saved successfully" });
  } catch (error) {
    console.error("Submit Education Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});

/**
 * @swagger
 * /api/candidate/review/{cand_id}:
 *   get:
 *     summary: Fetch all details for a candidate for the final review page
 *     tags: [Candidate Submission]
 */
router.get("/review/:cand_id", async (req, res) => {
  try {
    const cand_id = req.params.cand_id;
    if (!cand_id) {
      return res.status(400).json({ error: "cand_id is required" });
    }

    // Helper function to safely run queries
    const safeQuerySingle = async (query, params) => {
      try {
        const [rows] = await pool.query(query, params);
        return rows[0] || null;
      } catch (err) {
        console.error(`Error executing ${query}:`, err.message);
        return null;
      }
    };

    const safeQueryMultiple = async (query, params) => {
      try {
        const [rows] = await pool.query(query, params);
        return rows || [];
      } catch (err) {
        console.error(`Error executing ${query}:`, err.message);
        return [];
      }
    };

    // Run queries concurrently but safely
    const [
      basicInfo,
      address,
      idDocs,
      education,
      employment,
      drugTest,
      criminal,
      references
    ] = await Promise.all([
      safeQuerySingle(`SELECT * FROM candidate WHERE cand_id = ?`, [cand_id]),
      safeQuerySingle(`SELECT * FROM candidate_address WHERE cand_id = ?`, [cand_id]),
      safeQueryMultiple(`SELECT * FROM candidate_identity WHERE cand_id = ?`, [cand_id]),
      safeQueryMultiple(`SELECT * FROM candidate_education WHERE cand_id = ?`, [cand_id]),
      safeQueryMultiple(`SELECT * FROM candidate_employment WHERE cand_id = ?`, [cand_id]),
      safeQuerySingle(`SELECT * FROM candidate_drug WHERE cand_id = ?`, [cand_id]),
      safeQuerySingle(`SELECT * FROM candidate_criminal WHERE cand_id = ?`, [cand_id]),
      safeQueryMultiple(`SELECT * FROM candidate_reference WHERE cand_id = ?`, [cand_id])
    ]);

    const aggregateData = {
      basicInfo: basicInfo || {},
      address: address || {},
      idDocs: idDocs || [],
      education: education || [],
      employment: employment || [],
      drugTest: drugTest || null,
      criminal: criminal || null,
      references: references || []
    };

    res.status(200).json(aggregateData);
  } catch (error) {
    console.error("Fetch Review Data Error:", error);
    res.status(500).json({ error: "Internal Server Error: " + error.message });
  }
});

export default router;
