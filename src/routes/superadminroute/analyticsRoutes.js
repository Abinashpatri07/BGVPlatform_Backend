import express from "express";
import pool from "../../config/db.js";
import { verifyToken } from "../../middleware/authMiddleware.js";

const router = express.Router();
router.use(verifyToken);

// Helper to format date
const fmtDate = (d) => {
  if (!d) return "—";
  try {
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return "—";
    return dt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  } catch {
    return "—";
  }
};

const getCaseTypeName = (type) => {
  switch (parseInt(type)) {
    case 1: return "Identity Check";
    case 2: return "Address Check";
    case 3: return "Education Check";
    case 4: return "Internship Check";
    case 5: return "Employment Check";
    case 6: return "UAN Check";
    case 7: return "Drug Test Check";
    case 8: return "Criminal Check";
    case 9: return "Reference Check";
    case 10: return "Credit Check";
    case 11: return "PCC Check";
    default: return "Verification Check";
  }
};

const getCandidateStatusName = (status) => {
  switch (parseInt(status)) {
    case 0: return "Pending";
    case 1: return "Complete";
    case 2: return "In Progress";
    case 3: return "Rejected";
    case 4: return "Complete";
    case 5: return "On Hold";
    default: return "Pending";
  }
};

const getCaseStatusName = (status) => {
  switch (parseInt(status)) {
    case 1: return "Pending";
    case 2: return "In Progress";
    case 3: return "In Progress";
    case 4: return "Complete";
    case 5: return "Rejected";
    case 6: return "On Hold";
    default: return "Pending";
  }
};

const getModuleVerificationLabel = (statusVal) => {
  if (statusVal === null || statusVal === undefined) return "Pending";
  const num = parseInt(statusVal);
  switch (num) {
    case 4: return "Verified";
    case 1: return "Verified";
    case 2: return "Under Review";
    case 3: return "In Progress";
    case 5: return "Failed";
    case 6: return "On Hold";
    default: return "Pending";
  }
};

/**
 * @swagger
 * /api/superadmin/analytics/mis:
 *   get:
 *     summary: Fetch real MIS verification analytics data
 *     tags: [Super Admin Analytics]
 */
router.get("/mis", async (req, res) => {
  try {
    // 1. Fetch candidates
    const [candidates] = await pool.query(`
      SELECT 
        c.cand_id,
        c.candidate_id,
        CONCAT(c.candidate_first_name, ' ', c.candidate_last_name) AS name,
        c.candidate_email AS email,
        c.candidate_mobile AS phone,
        c.verification_status,
        CONCAT(COALESCE(c.assigned_hr_firstname, ''), ' ', COALESCE(c.assigned_hr_lastname, '')) AS hr_name,
        COALESCE(c.assigned_hr_email, '') AS hr_email,
        c.candidate_address,
        c.candidate_identification,
        c.candidate_employment,
        c.candidate_education,
        c.candidate_drug,
        c.candidate_criminal
      FROM candidate c
      WHERE c.is_delete = 0
      ORDER BY c.created_at DESC
    `);

    // 2. Fetch sub-table details for all active candidates
    const [addresses] = await pool.query(`
      SELECT cand_id, cand_perm_city, cand_perm_state, cand_curr_city, cand_curr_state, is_add_same 
      FROM candidate_address
    `);

    const [identities] = await pool.query(`
      SELECT cand_id, cand_iden_type, pan_number, passport_number, driving_number, voter_number, iden_verification_status 
      FROM candidate_identity
    `);

    const [employments] = await pool.query(`
      SELECT cand_id, cand_emp_company, emp_verification_status 
      FROM candidate_employment
      ORDER BY cand_emp_id ASC
    `);

    const [educations] = await pool.query(`
      SELECT cand_id, cand_specialization, cand_edu_institute, cand_edu_type, edu_verification_status 
      FROM candidate_education
      ORDER BY cand_edu_id DESC
    `);

    const [criminals] = await pool.query(`
      SELECT cand_id, cand_crim_record, crim_verification_status 
      FROM candidate_criminal
    `);

    const [drugs] = await pool.query(`
      SELECT cand_id, cand_drug_test, drug_verification_status 
      FROM candidate_drug
    `);

    // Group helper maps
    const addrMap = new Map();
    addresses.forEach(a => addrMap.set(a.cand_id, a));

    const idenMap = new Map();
    identities.forEach(id => {
      if (!idenMap.has(id.cand_id)) idenMap.set(id.cand_id, []);
      idenMap.get(id.cand_id).push(id);
    });

    const empMap = new Map();
    employments.forEach(e => {
      if (!empMap.has(e.cand_id)) empMap.set(e.cand_id, []);
      empMap.get(e.cand_id).push(e);
    });

    const eduMap = new Map();
    educations.forEach(ed => {
      if (!eduMap.has(ed.cand_id)) eduMap.set(ed.cand_id, []);
      eduMap.get(ed.cand_id).push(ed);
    });

    const crimMap = new Map();
    criminals.forEach(cr => crimMap.set(cr.cand_id, cr));

    const drugMap = new Map();
    drugs.forEach(dr => drugMap.set(dr.cand_id, dr));

    // Map candidate rows
    const misRows = candidates.map(c => {
      const addr = addrMap.get(c.cand_id);
      let permAddr = "—";
      let currAddr = "—";
      if (addr) {
        permAddr = [addr.cand_perm_city, addr.cand_perm_state].filter(Boolean).join(", ") || "—";
        if (addr.is_add_same === 1) {
          currAddr = "Same As Permanent";
        } else {
          currAddr = [addr.cand_curr_city, addr.cand_curr_state].filter(Boolean).join(", ") || "Same As Permanent";
        }
      }

      const idList = idenMap.get(c.cand_id) || [];
      const dlDoc = idList.find(i => String(i.cand_iden_type).toLowerCase().includes("driving") || i.driving_number);
      const passDoc = idList.find(i => String(i.cand_iden_type).toLowerCase().includes("passport") || i.passport_number);
      const panDoc = idList.find(i => String(i.cand_iden_type).toLowerCase().includes("pan") || i.pan_number);
      const voterDoc = idList.find(i => String(i.cand_iden_type).toLowerCase().includes("voter") || i.voter_number);

      const dlStatus = dlDoc ? (dlDoc.iden_verification_status === 1 ? "Verified" : dlDoc.iden_verification_status === 5 ? "Failed" : "Under Review") : getModuleVerificationLabel(c.candidate_identification);
      const passStatus = passDoc ? (passDoc.iden_verification_status === 1 ? "Verified" : passDoc.iden_verification_status === 5 ? "Failed" : "Under Review") : getModuleVerificationLabel(c.candidate_identification);
      const panStatus = panDoc ? (panDoc.iden_verification_status === 1 ? "Verified" : panDoc.iden_verification_status === 5 ? "Failed" : "Under Review") : getModuleVerificationLabel(c.candidate_identification);
      const voterStatus = voterDoc ? (voterDoc.iden_verification_status === 1 ? "Verified" : voterDoc.iden_verification_status === 5 ? "Failed" : "Under Review") : getModuleVerificationLabel(c.candidate_identification);

      const empList = empMap.get(c.cand_id) || [];
      const emp1 = empList[0] 
        ? `${empList[0].cand_emp_company || "Company"} (${empList[0].emp_verification_status === 1 || empList[0].emp_verification_status === 4 ? "Verified" : "Under Review"})`
        : getModuleVerificationLabel(c.candidate_employment);
      const emp2 = empList[1]
        ? `${empList[1].cand_emp_company || "Company"} (${empList[1].emp_verification_status === 1 || empList[1].emp_verification_status === 4 ? "Verified" : "Under Review"})`
        : (empList[0] ? "—" : getModuleVerificationLabel(c.candidate_employment));

      const eduList = eduMap.get(c.cand_id) || [];
      const lastEdu = eduList[0]
        ? (eduList[0].cand_specialization || eduList[0].cand_edu_type || eduList[0].cand_edu_institute || "Graduate")
        : getModuleVerificationLabel(c.candidate_education);

      const crim = crimMap.get(c.cand_id);
      const crimRecord = crim ? (crim.cand_crim_record || (crim.crim_verification_status === 1 ? "No" : "Yes")) : (c.candidate_criminal === 4 ? "No" : "No");

      const dr = drugMap.get(c.cand_id);
      const drugRecord = dr ? (dr.cand_drug_test || "No") : (c.candidate_drug === 4 ? "No" : "No");

      const hrCleanName = c.hr_name.trim();

      return {
        candId: c.candidate_id || `CAN-${String(c.cand_id).padStart(4, "0")}`,
        name: c.name.trim() || "Candidate",
        email: c.email || "—",
        phone: c.phone ? `+91 ${c.phone}` : "—",
        hr: hrCleanName || "Admin Team",
        hrEmail: c.hr_email || "hr@company.com",
        status: getCandidateStatusName(c.verification_status),
        permanentAddress: permAddr,
        presentAddress: currAddr,
        drivingLicense: dlStatus,
        passport: passStatus,
        panCard: panStatus,
        voterId: voterStatus,
        employment1: emp1,
        employment2: emp2,
        lastEducation: lastEdu,
        criminalRecord: crimRecord,
        drugTest: drugRecord,
      };
    });

    res.status(200).json({ success: true, data: misRows });
  } catch (error) {
    console.error("Super Admin Analytics MIS Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/**
 * @swagger
 * /api/superadmin/analytics/cases:
 *   get:
 *     summary: Fetch real SLA breach and TAT data from cases
 *     tags: [Super Admin Analytics]
 */
router.get("/cases", async (req, res) => {
  try {
    const query = `
      SELECT 
        cm.case_id,
        cm.candidate_id,
        cm.cand_id,
        cm.case_type,
        cm.verification_status,
        cm.created_at,
        cm.assigned_date,
        cm.completed_date,
        cm.sla_days,
        c.candidate_first_name,
        c.candidate_last_name,
        c.candidate_email,
        c.candidate_mobile,
        c.assigned_hr_firstname,
        c.assigned_hr_lastname,
        c.assigned_hr_email
      FROM case_master cm
      JOIN candidate c ON cm.cand_id = c.cand_id
      ORDER BY cm.created_at DESC
    `;

    const [rows] = await pool.query(query);

    const now = new Date();

    const formatted = rows.map((r) => {
      const targetDays = r.sla_days && r.sla_days > 0 ? r.sla_days : 5; // standard SLA default 5 days
      const createdDate = new Date(r.created_at);
      const isCompleted = parseInt(r.verification_status) === 4 && r.completed_date;
      const endDate = isCompleted ? new Date(r.completed_date) : now;

      // Calculate actual days elapsed
      const diffTime = Math.max(0, endDate.getTime() - createdDate.getTime());
      const actualDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // SLA Target Date
      const slaDateObj = new Date(createdDate.getTime() + targetDays * 24 * 60 * 60 * 1000);
      const slaDateStr = fmtDate(slaDateObj);
      const initiationDayStr = fmtDate(createdDate);

      // Overdue calculation
      const isBreached = actualDays > targetDays;
      const overdueDiff = actualDays - targetDays;
      const breachedDay = isBreached 
        ? `+${overdueDiff} Day${overdueDiff > 1 ? 's' : ''} Overdue` 
        : "On Track";

      const hrFullName = `${r.assigned_hr_firstname || ''} ${r.assigned_hr_lastname || ''}`.trim() || "Admin Team";

      return {
        candId: r.candidate_id || `CAN-${String(r.cand_id).padStart(4, "0")}`,
        name: `${r.candidate_first_name || ''} ${r.candidate_last_name || ''}`.trim() || "Candidate",
        email: r.candidate_email || "—",
        phone: r.candidate_mobile ? `+91 ${r.candidate_mobile}` : "—",
        hr: hrFullName,
        hrEmail: r.assigned_hr_email || "hr@company.com",
        status: getCaseStatusName(r.verification_status),
        checkId: r.case_id,
        checkType: getCaseTypeName(r.case_type),
        initiationDay: initiationDayStr,
        slaDate: slaDateStr,
        breachedDay: breachedDay,
        target: targetDays,
        actual: actualDays,
        tatDays: `${actualDays} Days`,
        isBreached: isBreached,
      };
    });

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    console.error("Super Admin Analytics Cases Error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;
