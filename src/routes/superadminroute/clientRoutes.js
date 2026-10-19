import express from "express";
import pool from "../../config/db.js";
import { v4 as uuidv4 } from "uuid";
import { sendEmail } from "../../utils/sendEmail.js";
import validateCreateClient from "../../middleware/superadmin/validateCreateClient.js";

const router = express.Router();

/**
 * @swagger
 * /api/client/create-client:
 *   post:
 *     summary: Create a new Client
 *     tags: [Super Admin - Client]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - companyName
 *               - firstName
 *               - lastName
 *               - email
 *               - phone
 *             properties:
 *               companyName:
 *                 type: string
 *                 example: Acme Corp
 *               cin:
 *                 type: string
 *                 example: U74999KA2026PTC123456
 *               gst:
 *                 type: string
 *                 example: 29ABCDE1234F1Z5
 *               firstName:
 *                 type: string
 *                 example: Manav
 *               lastName:
 *                 type: string
 *                 example: Joshi
 *               email:
 *                 type: string
 *                 example: manav.joshi@example.com
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *     responses:
 *       201:
 *         description: Client created successfully
 *       400:
 *         description: Validation Error
 *       409:
 *         description: Duplicate email or phone
 *       500:
 *         description: Internal Server Error
 */
router.post(
  "/create-client",
  validateCreateClient,
  async (req, res) => {
    try {
      const {
        companyName,
        cin,
        gst,
        address1,
        address2,
        city,
        state,
        pinCode,
        country,
        firstName,
        lastName,
        email,
        phone,
        plan,
      } = req.body;

      /* ── PLAN → package_id mapping ── */
      const planMap = { starter: 1, standard: 2, premium: 3 };
      const packageId = planMap[plan] || 2;

      /* ── DUPLICATE EMAIL CHECK ── */
      const [emailCheck] = await pool.query(
        "SELECT client_id FROM client_master WHERE poc_email = ? AND is_delete = 0",
        [email.trim().toLowerCase()]
      );
      if (emailCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { email: "A client with this email already exists" },
        });
      }

      /* ── DUPLICATE PHONE CHECK ── */
      const fullPhone = `+91${phone.trim()}`;
      const [phoneCheck] = await pool.query(
        "SELECT client_id FROM client_master WHERE poc_mobile = ? AND is_delete = 0",
        [fullPhone]
      );
      if (phoneCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { phone: "A client with this phone number already exists" },
        });
      }

      /* ── INSERT ── */
      const [result] = await pool.query(
        `INSERT INTO client_master
          (package_id, company_name, cin, gst_number,
           address_line_1, address_line_2, city, state, pincode,
           poc_first_name, poc_last_name, poc_email, poc_mobile,
           is_active, is_delete, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, NOW(), NOW())`,
        [
          packageId,
          companyName.trim(),
          cin?.trim().toUpperCase() || null,
          gst?.trim().toUpperCase() || null,
          address1?.trim() || null,
          address2?.trim() || null,
          city?.trim() || null,
          state?.trim() || null,
          pinCode?.toString().trim() || null,
          firstName.trim(),
          lastName.trim(),
          email.trim().toLowerCase(),
          fullPhone,
        ]
      );

      const clientId = result.insertId;

      /* ── INSERT INTO users TABLE FOR CLIENT ADMIN ── */
      const setupToken = uuidv4();
      const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

      await pool.query(
        `INSERT INTO users 
          (first_name, last_name, username, email, mobile, role_name, client_id, password_reset_token, password_reset_expiry, is_active, is_delete, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'Client Admin', ?, ?, ?, 1, 0, NOW(), NOW())`,
        [
          firstName.trim(),
          lastName.trim(),
          email.trim().toLowerCase(), // username
          email.trim().toLowerCase(), // email
          fullPhone,                  // mobile
          clientId,
          setupToken,
          tokenExpiry
        ]
      );

      /* ── SEND WELCOME EMAIL ── */
      const baseUrl = process.env.FRONTEND_URL || "https://bgv-platformdemo.vercel.app";
      const portalUrl = `${baseUrl}/client-setup-password?token=${setupToken}`;

      const emailHtml = `
        <p>Dear ${firstName} ${lastName},</p>
        <p>Welcome to the BGV Platform!</p>
        <p>Your Client Admin account for <b>${companyName}</b> has been successfully created.</p>
        <p>Please click the link below to securely set your password and access the Client Admin Portal:</p>
        <p><a href="${portalUrl}" style="padding: 10px 15px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px;">Set My Password</a></p>
        <p>Or copy and paste this URL into your browser:</p>
        <p><a href="${portalUrl}">${portalUrl}</a></p>
        <p><i>Note: This setup link is valid for 48 hours.</i></p>
        <p>Best regards,<br>The BGV Platform Team</p>
      `;

      sendEmail({
        to: email.trim().toLowerCase(),
        subject: "Welcome to BGV Platform - Setup Your Client Admin Account",
        html: emailHtml,
      }).catch(err => console.error("Client Admin welcome email failed:", err));

      return res.status(201).json({
        success: true,
        message: "Client created successfully",
        clientId,
      });

    } catch (error) {
      console.error("create-client error:", error);
      return res.status(500).json({
        success: false,
        message: "Internal Server Error: " + (error.message || error.sqlMessage || error),
      });
    }
  }
);

/**
 * @swagger
 * /api/client/get-all-clients:
 *   get:
 *     summary: Get all Clients
 *     tags: [Super Admin - Client]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of clients
 */
router.get("/get-all-clients", async (req, res) => {
  try {
    const page  = parseInt(req.query.page)  || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;

    const [rows] = await pool.query(
      `SELECT
        client_id                            AS id,
        company_name                         AS name,
        cin,
        gst_number                           AS gst,
        CONCAT(poc_first_name, ' ', poc_last_name) AS contactPersonName,
        poc_email                            AS contactEmail,
        poc_mobile                           AS contactPhone,
        city,
        state,
        is_active,
        is_suspend,
        created_at
      FROM client_master
      WHERE is_delete = 0
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const [[stats]] = await pool.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN is_suspend != 1 AND is_active = 1 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN is_suspend != 1 AND is_active != 1 THEN 1 ELSE 0 END) AS inactive,
         SUM(CASE WHEN is_suspend = 1 THEN 1 ELSE 0 END) AS suspended
       FROM client_master
       WHERE is_delete = 0`
    );

    const totalCount = parseInt(stats.total) || 0;

    return res.status(200).json({
      success: true,
      data: rows,
      stats: {
        total: totalCount,
        active: parseInt(stats.active) || 0,
        inactive: parseInt(stats.inactive) || 0,
        suspended: parseInt(stats.suspended) || 0,
      },
      pagination: { total: totalCount, page, limit, totalPages: Math.ceil(totalCount / limit) },
    });

  } catch (error) {
    console.error("get-all-clients error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/client/suspend-client/{id}:
 *   patch:
 *     summary: Suspend a Client by ID
 *     tags: [Super Admin - Client]
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
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 example: Repeated policy violations
 *     responses:
 *       200:
 *         description: Client suspended successfully
 *       400:
 *         description: Reason is required
 *       404:
 *         description: Client not found
 *       500:
 *         description: Internal Server Error
 */
router.patch("/suspend-client/:id", async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);

    if (!clientId || isNaN(clientId)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    const { reason } = req.body;

    if (!reason || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "Suspend reason is required",
      });
    }

    /* ── CHECK CLIENT EXISTS ── */
    const [existing] = await pool.query(
      "SELECT client_id, is_active, is_suspend FROM client_master WHERE client_id = ? AND is_delete = 0",
      [clientId]
    );

    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    if (Number(existing[0].is_suspend) === 1) {
      return res.status(400).json({ success: false, message: "Client is already suspended" });
    }

    /* ── SUSPEND ── */
    await pool.query(
      `UPDATE client_master
       SET is_suspend = 1, suspend_comments = ?, is_active = 2, updated_at = NOW()
       WHERE client_id = ?`,
      [reason, clientId]
    );

    /* ── RESTRICT & INVALIDATE ALL LOGINS FOR THIS CLIENT ── */
    await pool.query(
      `UPDATE login_sessions ls
       JOIN users u ON ls.user_id = u.users_id
       SET ls.login_status = 'EXPIRED', ls.is_current_session = 0
       WHERE u.client_id = ?`,
      [clientId]
    );

    return res.status(200).json({
      success: true,
      message: "Client suspended successfully",
    });

  } catch (error) {
    console.error("suspend-client error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/client/get-client/{id}:
 *   get:
 *     summary: Get a single Client by ID
 *     tags: [Super Admin - Client]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Client ID (client_id)
 *     responses:
 *       200:
 *         description: Client details fetched successfully
 *       404:
 *         description: Client not found
 *       500:
 *         description: Internal Server Error
 */
router.get("/get-client/:id", async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);

    if (!clientId || isNaN(clientId)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    const [rows] = await pool.query(
      `SELECT
        client_id                                   AS id,
        company_name                                AS companyName,
        cin,
        gst_number                                  AS gst,
        address_line_1                              AS addressLine1,
        address_line_2                              AS addressLine2,
        city,
        state,
        pincode,
        CONCAT(poc_first_name, ' ', poc_last_name)  AS contactPersonName,
        poc_first_name                              AS pocFirstName,
        poc_last_name                               AS pocLastName,
        poc_email                                   AS contactEmail,
        poc_mobile                                  AS contactPhone,
        is_active,
        is_suspend,
        created_at,
        updated_at
      FROM client_master
      WHERE client_id = ? AND is_delete = 0`,
      [clientId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    return res.status(200).json({
      success: true,
      data: rows[0],
    });

  } catch (error) {
    console.error("get-client error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/client/update-client/{id}:
 *   patch:
 *     summary: Update a Client by ID
 *     tags: [Super Admin - Client]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Client ID (client_id)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               companyName:
 *                 type: string
 *               cin:
 *                 type: string
 *               gst:
 *                 type: string
 *               addressLine1:
 *                 type: string
 *               addressLine2:
 *                 type: string
 *               city:
 *                 type: string
 *               state:
 *                 type: string
 *               pincode:
 *                 type: string
 *               pocFirstName:
 *                 type: string
 *               pocLastName:
 *                 type: string
 *               contactEmail:
 *                 type: string
 *               contactPhone:
 *                 type: string
 *               isActive:
 *                 type: integer
 *                 example: 1
 *     responses:
 *       200:
 *         description: Client updated successfully
 *       400:
 *         description: Validation Error
 *       404:
 *         description: Client not found
 *       409:
 *         description: Duplicate email or phone
 *       500:
 *         description: Internal Server Error
 */
router.patch("/update-client/:id", async (req, res) => {
  try {
    const clientId = parseInt(req.params.id);

    if (!clientId || isNaN(clientId)) {
      return res.status(400).json({ success: false, message: "Invalid client ID" });
    }

    /* ── CHECK CLIENT EXISTS ── */
    const [existing] = await pool.query(
      "SELECT client_id FROM client_master WHERE client_id = ? AND is_delete = 0",
      [clientId]
    );
    if (existing.length === 0) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    const {
      companyName,
      cin,
      gst,
      addressLine1,
      addressLine2,
      city,
      state,
      pincode,
      pocFirstName,
      pocLastName,
      contactEmail,
      contactPhone,
      isActive,
    } = req.body;

    const errors = {};

    /* ── VALIDATION ── */
    if (companyName !== undefined && !companyName?.trim()) {
      errors.companyName = "Company name cannot be empty";
    }

    if (cin !== undefined && cin?.trim()) {
      const cinRegex = /^[A-Z]{1}[0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$/;
      if (!cinRegex.test(cin.trim().toUpperCase())) {
        errors.cin = "Invalid CIN format";
      }
    }

    if (gst !== undefined && gst?.trim()) {
      const gstRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
      if (!gstRegex.test(gst.trim().toUpperCase())) {
        errors.gst = "Invalid GST number";
      }
    }

    if (contactEmail !== undefined) {
      const { default: validator } = await import("validator");
      if (!contactEmail?.trim()) {
        errors.contactEmail = "Email cannot be empty";
      } else if (!validator.isEmail(contactEmail)) {
        errors.contactEmail = "Invalid email address";
      }
    }

    if (contactPhone !== undefined) {
      const phone = contactPhone?.toString().replace(/^\+91/, "").trim();
      if (!/^[0-9]{10}$/.test(phone)) {
        errors.contactPhone = "Phone number must be 10 digits";
      }
    }

    if (pincode !== undefined && pincode?.toString().trim() && !/^\d{6}$/.test(pincode)) {
      errors.pincode = "Pincode must be 6 digits";
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ success: false, errors });
    }

    /* ── DUPLICATE EMAIL CHECK (excluding self) ── */
    if (contactEmail !== undefined) {
      const [emailCheck] = await pool.query(
        "SELECT client_id FROM client_master WHERE poc_email = ? AND is_delete = 0 AND client_id != ?",
        [contactEmail.trim().toLowerCase(), clientId]
      );
      if (emailCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { contactEmail: "A client with this email already exists" },
        });
      }
    }

    /* ── DUPLICATE PHONE CHECK (excluding self) ── */
    if (contactPhone !== undefined) {
      const normalizedPhone = contactPhone.toString().startsWith("+91")
        ? contactPhone.toString().trim()
        : `+91${contactPhone.toString().replace(/^\+91/, "").trim()}`;

      const [phoneCheck] = await pool.query(
        "SELECT client_id FROM client_master WHERE poc_mobile = ? AND is_delete = 0 AND client_id != ?",
        [normalizedPhone, clientId]
      );
      if (phoneCheck.length > 0) {
        return res.status(409).json({
          success: false,
          errors: { contactPhone: "A client with this phone number already exists" },
        });
      }
    }

    /* ── BUILD UPDATE FIELDS DYNAMICALLY ── */
    const fields = [];
    const values = [];

    if (companyName !== undefined)  { fields.push("company_name = ?");    values.push(companyName.trim()); }
    if (cin !== undefined)          { fields.push("cin = ?");              values.push(cin?.trim().toUpperCase() || null); }
    if (gst !== undefined)          { fields.push("gst_number = ?");       values.push(gst?.trim().toUpperCase() || null); }
    if (addressLine1 !== undefined) { fields.push("address_line_1 = ?");  values.push(addressLine1.trim()); }
    if (addressLine2 !== undefined) { fields.push("address_line_2 = ?");  values.push(addressLine2.trim()); }
    if (city !== undefined)         { fields.push("city = ?");             values.push(city.trim()); }
    if (state !== undefined)        { fields.push("state = ?");            values.push(state.trim()); }
    if (pincode !== undefined)      { fields.push("pincode = ?");          values.push(pincode.toString().trim()); }
    if (pocFirstName !== undefined) { fields.push("poc_first_name = ?");  values.push(pocFirstName.trim()); }
    if (pocLastName !== undefined)  { fields.push("poc_last_name = ?");   values.push(pocLastName.trim()); }
    if (contactEmail !== undefined) { fields.push("poc_email = ?");        values.push(contactEmail.trim().toLowerCase()); }
    if (contactPhone !== undefined) {
      const normalizedPhone = contactPhone.toString().startsWith("+91")
        ? contactPhone.toString().trim()
        : `+91${contactPhone.toString().replace(/^\+91/, "").trim()}`;
      fields.push("poc_mobile = ?");
      values.push(normalizedPhone);
    }
    if (isActive !== undefined)     { fields.push("is_active = ?");        values.push(parseInt(isActive)); }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields provided to update" });
    }

    fields.push("updated_at = NOW()");
    values.push(clientId);

    await pool.query(
      `UPDATE client_master SET ${fields.join(", ")} WHERE client_id = ?`,
      values
    );

    return res.status(200).json({
      success: true,
      message: "Client updated successfully",
    });

  } catch (error) {
    console.error("update-client error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

/**
 * @swagger
 * /api/client/send-welcome-email/{clientId}:
 *   post:
 *     summary: Resend welcome/setup email to Client Admin
 *     tags: [Super Admin - Client]
 *     parameters:
 *       - in: path
 *         name: clientId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Email sent successfully
 *       404:
 *         description: Client not found
 */
router.post("/send-welcome-email/:clientId", async (req, res) => {
  try {
    const { clientId } = req.params;

    const [clients] = await pool.query(
      "SELECT company_name, poc_first_name, poc_last_name, poc_email FROM client_master WHERE client_id = ? AND is_delete = 0",
      [clientId]
    );

    if (clients.length === 0) {
      return res.status(404).json({ success: false, message: "Client not found" });
    }

    const client = clients[0];
    const setupToken = uuidv4();
    const tokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Ensure they exist in the users table, update the token if they do
    const [users] = await pool.query(
      "SELECT users_id FROM users WHERE client_id = ? AND role_name = 'Client Admin' AND is_delete = 0",
      [clientId]
    );

    if (users.length > 0) {
      await pool.query(
        "UPDATE users SET password_reset_token = ?, password_reset_expiry = ? WHERE users_id = ?",
        [setupToken, tokenExpiry, users[0].users_id]
      );
    } else {
      // If by any chance they don't exist yet, we could insert them, but they should be created in /create-client
      return res.status(404).json({ success: false, message: "Client Admin user account not found for this client." });
    }

    const baseUrl = process.env.FRONTEND_URL || "https://bgv-platformdemo.vercel.app";
    const portalUrl = `${baseUrl}/client-setup-password?token=${setupToken}`;

    const emailHtml = `
      <p>Dear ${client.poc_first_name} ${client.poc_last_name},</p>
      <p>Welcome to the BGV Platform!</p>
      <p>Your Client Admin account for <b>${client.company_name}</b> is ready.</p>
      <p>Please click the link below to securely set your password and access the Client Admin Portal:</p>
      <p><a href="${portalUrl}" style="padding: 10px 15px; background-color: #4F46E5; color: white; text-decoration: none; border-radius: 5px;">Set My Password</a></p>
      <p>Or copy and paste this URL into your browser:</p>
      <p><a href="${portalUrl}">${portalUrl}</a></p>
      <p><i>Note: This setup link is valid for 48 hours.</i></p>
      <p>Best regards,<br>The BGV Platform Team</p>
    `;

    // Send email asynchronously
    sendEmail({
      to: client.poc_email.trim().toLowerCase(),
      subject: "Welcome to BGV Platform - Setup Your Client Admin Account",
      html: emailHtml,
    }).catch(err => console.error("Client Admin welcome email failed:", err));

    return res.status(200).json({ success: true, message: "Welcome email sent successfully." });
  } catch (err) {
    console.error("Send Welcome Email Error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
});

export default router;