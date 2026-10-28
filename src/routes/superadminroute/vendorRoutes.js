import express from "express";
import pool from "../../config/db.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../../utils/sendEmail.js";
import { verifyToken } from "../../middleware/authMiddleware.js";

import validateCreateVendor from
"../../middleware/superadmin/validateCreateVendor.js";

import validateUpdateVendor from
"../../middleware/superadmin/validateUpdateVendor.js";

const router = express.Router();
router.use(verifyToken);

const sendVendorWelcomeEmailHelper = (vendorName, pocName, pocEmail, setupToken = null) => {
  const companyName = "Dqnex";
  const baseUrl = process.env.FRONTEND_URL || "https://bgv-platformdemo.vercel.app";
  const portalUrl = setupToken ? `${baseUrl}/vendor-setup-password?token=${setupToken}` : `${baseUrl}/`;
  const supportEmail = "info@dqnex.com";
  const supportPhone = "+91-XXXXXXXXXX";

  const emailHtml = `
    <p>Dear ${pocName},</p>
    <p>Welcome to <b>${companyName}</b>!</p>
    <p>Your vendor account for <b>${vendorName}</b> has been created successfully. To proceed and access the Vendor Portal, please set up your password.</p>
    <p><b>Portal Setup Link:</b> <a href="${portalUrl}">${portalUrl}</a></p>
    <p><b>Login Email:</b> ${pocEmail}</p>
    <p>If you experience any issues, please contact our support team:</p>
    <p><b>Email:</b> <a href="mailto:${supportEmail}">${supportEmail}</a><br>
    <b>Phone:</b> ${supportPhone}</p>
    <p>Best regards,<br>
    <b>${companyName} Team</b></p>
  `;

  return sendEmail({
    to: pocEmail,
    subject: "Welcome to Vendor Portal",
    text: `Dear ${pocName},\n\nWelcome to ${companyName}!\n\nYour vendor account has been created. To proceed, please set up your password at ${portalUrl}\n\nLogin Email: ${pocEmail}\n\nBest regards,\n${companyName} Team`,
    html: emailHtml,
  }).catch(err => console.error("Error sending vendor welcome email in background:", err));
};

/* Service index → DB service_type mapping
   SERVICES array order in frontend:
   0 = Criminal Background Check  → 4
   1 = Education Verification      → 3
   2 = Prior Employment Check      → 2
   3 = Identity Address Verification → 1
   4 = Drug Test                   → 6
*/
const SERVICE_TYPE_MAP = {
  0: 4,
  1: 3,
  2: 2,
  3: 1,
  4: 6,
};

/**
 * @swagger
 * /api/vendor/create:
 *   post:
 *     summary: Create a new Vendor
 *     tags: [Super Admin - Vendor]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - vendorName
 *               - email
 *             properties:
 *               vendorName:
 *                 type: string
 *                 example: Verification Services Ltd
 *               email:
 *                 type: string
 *                 example: vendor@bgv.com
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *     responses:
 *       201:
 *         description: Vendor Created Successfully
 *       400:
 *         description: Validation Error
 *       409:
 *         description: Duplicate email
 *       500:
 *         description: Internal Server Error
 */
router.post(
  "/create",
  validateCreateVendor,
  async (req, res) => {
    try {
      const {
        vendorName,
        cin,
        gst,
        address1,
        address2,
        city,
        state,
        pinCode,
        firstName,
        lastName,
        email,
        phone,
        coverageAreas,
        services,
      } = req.body;

      /* ── DUPLICATE EMAIL CHECK ── */
      const [emailCheck] = await pool.query(
        "SELECT vendor_id FROM vendor_master WHERE poc_email = ? AND is_delete = 0",
        [email.trim().toLowerCase()]
      );
      if (emailCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { email: "A vendor with this email already exists" },
        });
      }

      /* ── DUPLICATE PHONE CHECK ── */
      const fullPhone = `+91${phone.trim()}`;
      const [phoneCheck] = await pool.query(
        "SELECT vendor_id FROM vendor_master WHERE poc_mobile = ? AND is_delete = 0",
        [fullPhone]
      );
      if (phoneCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { phone: "A vendor with this phone number already exists" },
        });
      }

      // Coverage Areas mapping
      const coverageData = {};
      for (let i = 0; i < 5; i++) {
        if (coverageAreas[i]) {
          coverageData[`coverage_state${i + 1}`] = coverageAreas[i].stateId;
          const cities = coverageAreas[i].cityIds || [];
          for (let j = 0; j < 5; j++) {
            if (cities[j]) {
              coverageData[`coverage_state${i + 1}_city${j + 1}`] = cities[j];
            } else {
              coverageData[`coverage_state${i + 1}_city${j + 1}`] = null;
            }
          }
        } else {
          coverageData[`coverage_state${i + 1}`] = null;
          for (let j = 0; j < 5; j++) {
            coverageData[`coverage_state${i + 1}_city${j + 1}`] = null;
          }
        }
      }

      // Services mapping
      // 0: Criminal, 1: Education, 2: Employment, 3: Address, 4: Drug, 5: PCC, 6: Reference
      const srv = {
        criminal_ver: services[0] ? 1 : 2,
        criminal_ver_sla: services[0] ? parseInt(services[0]) : null,

        education_ver: services[1] ? 1 : 2,
        education_ver_sla: services[1] ? parseInt(services[1]) : null,

        employment_ver: services[2] ? 1 : 2,
        employment_ver_sla: services[2] ? parseInt(services[2]) : null,

        address_ver: services[3] ? 1 : 2,
        address_ver_sla: services[3] ? parseInt(services[3]) : null,

        drug_ver: services[4] ? 1 : 2,
        drug_ver_sla: services[4] ? parseInt(services[4]) : null,

        pcc_ver: services[5] ? 1 : 2,
        pcc_ver_sla: services[5] ? parseInt(services[5]) : null,

        reference_ver: services[6] ? 1 : 2,
        reference_ver_sla: services[6] ? parseInt(services[6]) : null,
      };

      /* ── INSERT VENDOR ── */
      const [result] = await pool.query(
        `INSERT INTO vendor_master (
          company_name, cin, gst_number, address_line_1, address_line_2, city, state, pincode,
          coverage_state1, coverage_state2, coverage_state3, coverage_state4, coverage_state5,
          coverage_state1_city1, coverage_state1_city2, coverage_state1_city3, coverage_state1_city4, coverage_state1_city5,
          coverage_state2_city1, coverage_state2_city2, coverage_state2_city3, coverage_state2_city4, coverage_state2_city5,
          coverage_state3_city1, coverage_state3_city2, coverage_state3_city3, coverage_state3_city4, coverage_state3_city5,
          coverage_state4_city1, coverage_state4_city2, coverage_state4_city3, coverage_state4_city4, coverage_state4_city5,
          coverage_state5_city1, coverage_state5_city2, coverage_state5_city3, coverage_state5_city4, coverage_state5_city5,
          poc_first_name, poc_last_name, poc_email, poc_mobile,
          address_ver, address_ver_sla, education_ver, education_ver_sla, employment_ver, employment_ver_sla,
          criminal_ver, criminal_ver_sla, drug_ver, drug_ver_sla, pcc_ver, pcc_ver_sla, reference_ver, reference_ver_sla
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?
        )`,
        [
          vendorName.trim(), cin?.trim().toUpperCase() || null, gst?.trim().toUpperCase() || "",
          address1.trim(), address2.trim(), city.trim(), state.trim(), pinCode,

          coverageData.coverage_state1, coverageData.coverage_state2, coverageData.coverage_state3, coverageData.coverage_state4, coverageData.coverage_state5,
          
          coverageData.coverage_state1_city1, coverageData.coverage_state1_city2, coverageData.coverage_state1_city3, coverageData.coverage_state1_city4, coverageData.coverage_state1_city5,
          coverageData.coverage_state2_city1, coverageData.coverage_state2_city2, coverageData.coverage_state2_city3, coverageData.coverage_state2_city4, coverageData.coverage_state2_city5,
          coverageData.coverage_state3_city1, coverageData.coverage_state3_city2, coverageData.coverage_state3_city3, coverageData.coverage_state3_city4, coverageData.coverage_state3_city5,
          coverageData.coverage_state4_city1, coverageData.coverage_state4_city2, coverageData.coverage_state4_city3, coverageData.coverage_state4_city4, coverageData.coverage_state4_city5,
          coverageData.coverage_state5_city1, coverageData.coverage_state5_city2, coverageData.coverage_state5_city3, coverageData.coverage_state5_city4, coverageData.coverage_state5_city5,

          firstName.trim(), lastName.trim(), email.trim().toLowerCase(), fullPhone,

          srv.address_ver, srv.address_ver_sla, srv.education_ver, srv.education_ver_sla, srv.employment_ver, srv.employment_ver_sla,
          srv.criminal_ver, srv.criminal_ver_sla, srv.drug_ver, srv.drug_ver_sla, srv.pcc_ver, srv.pcc_ver_sla, srv.reference_ver, srv.reference_ver_sla
        ]
      );

      const vendorId = result.insertId;

      // Generate a setup token
      const setupToken = uuidv4();
      const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours
      
      // Update the vendor with the token
      await pool.query(
        `UPDATE vendor_master SET password_reset_token = ?, password_reset_expiry = ? WHERE vendor_id = ?`,
        [setupToken, tokenExpiry, vendorId]
      );

      // Send Welcome Email
      sendVendorWelcomeEmailHelper(vendorName.trim(), `${firstName.trim()} ${lastName.trim()}`.trim(), email.trim().toLowerCase(), setupToken);

      return res.status(201).json({
        success: true,
        message: "Vendor Created Successfully",
        vendorId,
      });

    } catch (error) {
      console.error("create-vendor error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
);


/**
 * @swagger
 * /api/vendor:
 *   get:
 *     summary: Get all Vendors
 *     tags: [Super Admin - Vendor]
 *     responses:
 *       200:
 *         description: List of vendors
 */
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(
      `SELECT vendor_id, company_name, poc_first_name, poc_last_name, poc_email, gst_number, is_active, is_suspend,
        CASE
          WHEN password_reset_token IS NULL AND password_hash IS NOT NULL AND password_hash != ''
          THEN 1 ELSE 0
        END AS is_password_set
       FROM vendor_master
       WHERE is_delete = 0
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
       [limit, offset]
    );

    const [[stats]] = await pool.query(
      `SELECT 
         COUNT(*) AS total,
         SUM(CASE WHEN is_suspend != 1 AND is_active = 1 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN is_suspend != 1 AND is_active = 2 THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN is_suspend = 1 THEN 1 ELSE 0 END) AS suspended
       FROM vendor_master
       WHERE is_delete = 0`
    );

    const totalCount = parseInt(stats.total) || 0;

    return res.status(200).json({ 
      success: true, 
      vendors: rows,
      stats: {
        total: totalCount,
        active: parseInt(stats.active) || 0,
        inactive: parseInt(stats.inactive) || 0,
        suspended: parseInt(stats.suspended) || 0,
      },
      pagination: { 
        total: totalCount, 
        page, 
        limit, 
        totalPages: Math.ceil(totalCount / limit) 
      }
    });
  } catch (error) {
    console.error("fetch-vendors error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});


/**
 * GET /api/vendor/:id — Fetch single vendor by ID
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await pool.query(
      `SELECT
        vendor_id, company_name, cin, gst_number,
        address_line_1, address_line_2, city, state, pincode,
        poc_first_name, poc_last_name, poc_email, poc_mobile,
        coverage_state1, coverage_state2, coverage_state3, coverage_state4, coverage_state5,
        coverage_state1_city1, coverage_state1_city2, coverage_state1_city3, coverage_state1_city4, coverage_state1_city5,
        coverage_state2_city1, coverage_state2_city2, coverage_state2_city3, coverage_state2_city4, coverage_state2_city5,
        coverage_state3_city1, coverage_state3_city2, coverage_state3_city3, coverage_state3_city4, coverage_state3_city5,
        coverage_state4_city1, coverage_state4_city2, coverage_state4_city3, coverage_state4_city4, coverage_state4_city5,
        coverage_state5_city1, coverage_state5_city2, coverage_state5_city3, coverage_state5_city4, coverage_state5_city5,
        criminal_ver, criminal_ver_sla,
        education_ver, education_ver_sla,
        employment_ver, employment_ver_sla,
        address_ver, address_ver_sla,
        drug_ver, drug_ver_sla,
        pcc_ver, pcc_ver_sla,
        reference_ver, reference_ver_sla,
        is_active, is_suspend, created_at
       FROM vendor_master
       WHERE vendor_id = ? AND is_delete = 0`,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    const v = rows[0];

    // Build services list
    const serviceMap = [
      { name: "Criminal Background Check",       enabled: v.criminal_ver,   sla: v.criminal_ver_sla   },
      { name: "Education Verification",           enabled: v.education_ver,  sla: v.education_ver_sla  },
      { name: "Prior Employment Check",           enabled: v.employment_ver, sla: v.employment_ver_sla },
      { name: "Identity & Address Verification",  enabled: v.address_ver,    sla: v.address_ver_sla    },
      { name: "Drug Test",                        enabled: v.drug_ver,       sla: v.drug_ver_sla       },
      { name: "PCC Verification",                 enabled: v.pcc_ver,        sla: v.pcc_ver_sla        },
      { name: "Reference Check",                  enabled: v.reference_ver,  sla: v.reference_ver_sla  },
    ];

    const services = serviceMap
      .filter(s => s.enabled === 1)
      .map(s => ({ name: s.name, sla: s.sla ? `${s.sla} day SLA` : "—" }));

    // Build coverage states (filter nulls)
    const coverageStates = [
      v.coverage_state1, v.coverage_state2, v.coverage_state3,
      v.coverage_state4, v.coverage_state5,
    ].filter(Boolean);

    // Build structured coverage areas (state + city IDs per state)
    const coverageAreas = [];
    for (let i = 1; i <= 5; i++) {
      const stateId = v[`coverage_state${i}`];
      if (stateId) {
        const cityIds = [];
        for (let j = 1; j <= 5; j++) {
          const cityId = v[`coverage_state${i}_city${j}`];
          if (cityId) cityIds.push(cityId);
        }
        coverageAreas.push({ stateId, cityIds });
      }
    }

    const statusVal = v.is_suspend === 1 ? "Suspended"
                    : v.is_active === 2  ? "Inactive"
                    : "Active";

    return res.status(200).json({
      success: true,
      data: {
        vendor_id: v.vendor_id,
        company_name: v.company_name,
        cin: v.cin,
        gst_number: v.gst_number,
        address_line_1: v.address_line_1,
        address_line_2: v.address_line_2,
        city: v.city,
        state: v.state,
        pincode: v.pincode,
        poc_first_name: v.poc_first_name,
        poc_last_name: v.poc_last_name,
        poc_email: v.poc_email,
        poc_mobile: v.poc_mobile,
        coverage_states: coverageStates,
        coverage_areas: coverageAreas,
        services,
        status: statusVal,
        created_at: v.created_at,
      }
    });

  } catch (error) {
    console.error("get-vendor-by-id error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});


/**
 * @swagger
 * /api/vendor/update/{id}:
 *   patch:
 *     summary: Update a Vendor
 *     tags: [Super Admin - Vendor]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Vendor ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               vendorName:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Vendor Updated Successfully
 *       400:
 *         description: Validation Error
 */
router.patch(
  "/update/:id",
  validateUpdateVendor,
  async (req, res) => {
    try {
      const { id } = req.params;
      const {
        vendorName,
        cin,
        gst,
        states,
        cities,
        fullName,
        email,
        phone,
        services,
      } = req.body;

      /* ── DUPLICATE EMAIL CHECK ── */
      const [emailCheck] = await pool.query(
        "SELECT vendor_id FROM vendor_master WHERE poc_email = ? AND vendor_id != ? AND is_delete = 0",
        [email.trim().toLowerCase(), id]
      );
      if (emailCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { email: "A vendor with this email already exists" },
        });
      }

      /* ── DUPLICATE PHONE CHECK ── */
      const fullPhone = phone.startsWith("+") ? phone.trim() : `+91${phone.trim()}`;
      const [phoneCheck] = await pool.query(
        "SELECT vendor_id FROM vendor_master WHERE poc_mobile = ? AND vendor_id != ? AND is_delete = 0",
        [fullPhone, id]
      );
      if (phoneCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { phone: "A vendor with this phone number already exists" },
        });
      }

      // Services mapping
      const srv = {
        criminal_ver: services[0] ? 1 : 2,
        criminal_ver_sla: services[0] ? parseInt(services[0]) : null,
        education_ver: services[1] ? 1 : 2,
        education_ver_sla: services[1] ? parseInt(services[1]) : null,
        employment_ver: services[2] ? 1 : 2,
        employment_ver_sla: services[2] ? parseInt(services[2]) : null,
        address_ver: services[3] ? 1 : 2,
        address_ver_sla: services[3] ? parseInt(services[3]) : null,
        drug_ver: services[4] ? 1 : 2,
        drug_ver_sla: services[4] ? parseInt(services[4]) : null,
      };

      // Handle Full Name split
      const nameParts = fullName.trim().split(" ");
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ");

      /* ── REVERSE STATE MAP ── */
      const REVERSE_STATE_MAP = {
        "Andhra Pradesh": 1, "Arunachal Pradesh": 2, "Assam": 3,
        "Bihar": 4, "Chhattisgarh": 5, "Goa": 6,
        "Gujarat": 7, "Haryana": 8, "Himachal Pradesh": 9,
        "Jharkhand": 10, "Karnataka": 11, "Kerala": 12,
        "Madhya Pradesh": 13, "Maharashtra": 14, "Manipur": 15,
        "Meghalaya": 16, "Mizoram": 17, "Nagaland": 18,
        "Odisha": 19, "Punjab": 20, "Rajasthan": 21,
        "Sikkim": 22, "Tamil Nadu": 23, "Telangana": 24,
        "Tripura": 25, "Uttar Pradesh": 26, "Uttarakhand": 27,
        "West Bengal": 28, "Delhi": 29, "Delhi NCR": 29, "Jammu & Kashmir": 30,
      };

      const coverageStates = [null, null, null, null, null];
      for (let i = 0; i < Math.min(states.length, 5); i++) {
        coverageStates[i] = REVERSE_STATE_MAP[states[i]] || states[i];
      }

      /* ── UPDATE VENDOR ── */
      await pool.query(
        `UPDATE vendor_master SET
          company_name = ?, cin = ?, gst_number = ?,
          poc_first_name = ?, poc_last_name = ?, poc_email = ?, poc_mobile = ?,
          coverage_state1 = ?, coverage_state2 = ?, coverage_state3 = ?, coverage_state4 = ?, coverage_state5 = ?,
          address_ver = ?, address_ver_sla = ?, education_ver = ?, education_ver_sla = ?, employment_ver = ?, employment_ver_sla = ?,
          criminal_ver = ?, criminal_ver_sla = ?, drug_ver = ?, drug_ver_sla = ?
         WHERE vendor_id = ?`,
        [
          vendorName.trim(), cin?.trim().toUpperCase() || null, gst?.trim().toUpperCase(),
          firstName, lastName, email.trim().toLowerCase(), fullPhone,
          coverageStates[0], coverageStates[1], coverageStates[2], coverageStates[3], coverageStates[4],
          srv.address_ver, srv.address_ver_sla, srv.education_ver, srv.education_ver_sla, srv.employment_ver, srv.employment_ver_sla,
          srv.criminal_ver, srv.criminal_ver_sla, srv.drug_ver, srv.drug_ver_sla,
          id
        ]
      );

      res.status(200).json({
        success: true,
        message: "Vendor Updated Successfully",
      });
    } catch (error) {
      console.error("update-vendor error:", error);
      res.status(500).json({
        success: false,
        message: "Internal Server Error",
      });
    }
  }
);

/**
 * @swagger
 * /api/vendor/suspend/{id}:
 *   patch:
 *     summary: Suspend (Terminate) a Vendor
 *     tags: [Super Admin - Vendor]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Vendor Suspended Successfully
 */
router.patch("/suspend/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    await pool.query(
      `UPDATE vendor_master SET is_suspend = 1, suspend_comments = ?, is_active = 2, updated_at = NOW() WHERE vendor_id = ?`,
      [reason, id]
    );

    /* Invalidate active sessions for this vendor */
    await pool.query(
      `UPDATE login_sessions SET login_status = 'EXPIRED', is_current_session = 0 WHERE user_id = ?`,
      [id]
    );

    return res.status(200).json({
      success: true,
      message: "Vendor suspended successfully",
    });

  } catch (error) {
    console.error("suspend-vendor error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/vendor/send-welcome-email/{vendorId}:
 *   post:
 *     summary: Send a welcome email to a vendor
 *     tags: [Super Admin - Vendor]
 *     parameters:
 *       - in: path
 *         name: vendorId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Email sent successfully
 *       404:
 *         description: Vendor not found
 *       500:
 *         description: Server Error
 */
router.post("/send-welcome-email/:vendorId", async (req, res) => {
  const { vendorId } = req.params;
  try {
    const [vendors] = await pool.query(
      "SELECT company_name, poc_first_name, poc_last_name, poc_email FROM vendor_master WHERE vendor_id = ? AND is_delete = 0",
      [vendorId]
    );

    if (vendors.length === 0) {
      return res.status(404).json({ success: false, message: "Vendor not found" });
    }

    const vendor = vendors[0];
    const vendorName = vendor.company_name;
    const pocName = `${vendor.poc_first_name} ${vendor.poc_last_name}`.trim();
    const pocEmail = vendor.poc_email;

    const setupToken = uuidv4();
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await pool.query(
      `UPDATE vendor_master SET password_reset_token = ?, password_reset_expiry = ? WHERE vendor_id = ?`,
      [setupToken, tokenExpiry, vendorId]
    );

    sendVendorWelcomeEmailHelper(vendorName, pocName, pocEmail, setupToken);

    return res.status(200).json({ success: true, message: "Welcome email sent successfully." });
  } catch (err) {
    console.error("Send Vendor Welcome Email Error:", err);
    return res.status(500).json({ success: false, message: "Server error. Please try again." });
  }
});

export default router;