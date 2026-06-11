import express from "express";
import { v4 as uuidv4 } from "uuid";

import validateCandidateAction from
"../../middleware/clientadmin/validateCandidateAction.js";

import validateCreateCandidate from
"../../middleware/clientadmin/validateCreateCandidate.js";

import pool from "../../config/db.js";

const router = express.Router();

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
      cmId,
      jobFunction,
      tag,
    } = req.body;

    try {

      const caseId = "CASE-" + uuidv4().replace(/-/g, "").substring(0, 8).toUpperCase();

      await pool.execute(
        `INSERT INTO candidate_master
          (case_id, cm_id, created_by_client_admin, first_name, last_name, email, phone, job_function, tag, case_status, is_active, created_at, updated_at)
         VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, NOW(), NOW())`,
        [
          caseId,
          cmId,
          clientAdminId,
          firstName.trim(),
          lastName.trim(),
          email.trim().toLowerCase(),
          phone.trim(),
          jobFunction || null,
          tag || null,
        ]
      );

      return res.status(201).json({
        success: true,
        message: "Candidate Created Successfully",
        caseId,
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

router.post(
  "/assign-verification",
  validateCandidateAction,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Assigned Successfully",
    });

  }
);

router.post(
  "/reject",
  validateCandidateAction,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Candidate Rejected",
    });

  }
);

router.post(
  "/on-hold",
  validateCandidateAction,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Candidate Put On Hold",
    });

  }
);

router.post(
  "/bulk-assign",
  validateCandidateAction,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Bulk Assign Successful",
    });

  }
);

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

    const { cmId } = req.query;

    if (!cmId) {
      return res.status(400).json({
        success: false,
        message: "cmId is required",
      });
    }

    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const offset = (page - 1) * limit;

      const [countRows] = await pool.execute(
        `SELECT COUNT(*) as total FROM candidate_master WHERE cm_id = ? AND is_delete = 0`,
        [cmId]
      );
      const totalRecords = countRows[0].total;
      const totalPages = Math.ceil(totalRecords / limit);

      const [rows] = await pool.execute(
        `SELECT
          cm.cand_id,
          cm.case_id,
          cm.first_name,
          cm.last_name,
          cm.email,
          cm.phone,
          cm.case_status,
          cm.created_at,

          -- Created By: Client Admin
          CASE
            WHEN cm.created_by_client_admin IS NOT NULL
              THEN CONCAT(u_admin.first_name, ' ', u_admin.last_name)
            WHEN cm.created_by_hr IS NOT NULL
              THEN CONCAT(u_hr.first_name, ' ', u_hr.last_name)
            ELSE 'Unknown'
          END AS created_by_name,

          -- Role label
          CASE
            WHEN cm.created_by_client_admin IS NOT NULL THEN 'Client Admin'
            WHEN cm.created_by_hr IS NOT NULL THEN 'HR'
            ELSE NULL
          END AS created_by_role

        FROM candidate_master cm
        LEFT JOIN users u_admin
          ON cm.created_by_client_admin = u_admin.users_id
        LEFT JOIN users u_hr
          ON cm.created_by_hr = u_hr.users_id
        WHERE cm.cm_id = ?
          AND cm.is_delete = 0
        ORDER BY cm.created_at DESC
        LIMIT ? OFFSET ?`,
        [cmId, limit, offset]
      );

      return res.status(200).json({
        success: true,
        data: rows,
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

export default router;