import express from "express";

import validateCandidateTableAction from
  "../../middleware/hr/validateCandidateTableAction.js";

import validateTableSection from
  "../../middleware/hr/validateTableSection.js";

const router = express.Router();

/**
 * @swagger
 * /api/candidates/table/send-email:
 *   post:
 *     summary: Send Email to Candidate (HR Table Action)
 *     tags: [HR - Table Actions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - candidateId
 *             properties:
 *               candidateId:
 *                 type: integer
 *                 example: 5
 *     responses:
 *       200:
 *         description: Email Sent Successfully
 *       400:
 *         description: Validation Error
 */
router.post(
  "/send-email",
  validateCandidateTableAction,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Email Sent Successfully",
    });

  }
);

/**
 * @swagger
 * /api/candidates/table/reject:
 *   post:
 *     summary: Reject Candidate (HR Table Action)
 *     tags: [HR - Table Actions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - candidateId
 *             properties:
 *               candidateId:
 *                 type: integer
 *                 example: 5
 *               reason:
 *                 type: string
 *                 example: Documents not verified
 *     responses:
 *       200:
 *         description: Candidate Rejected
 *       400:
 *         description: Validation Error
 */
router.post(
  "/reject",
  validateCandidateTableAction,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Candidate Rejected",
    });

  }
);

/**
 * @swagger
 * /api/candidates/table/on-hold:
 *   post:
 *     summary: Put Candidate On Hold (HR Table Action)
 *     tags: [HR - Table Actions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - candidateId
 *             properties:
 *               candidateId:
 *                 type: integer
 *                 example: 5
 *               reason:
 *                 type: string
 *                 example: Awaiting documents
 *     responses:
 *       200:
 *         description: Candidate Put On Hold
 *       400:
 *         description: Validation Error
 */
router.post(
  "/on-hold",
  validateCandidateTableAction,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Candidate Put On Hold",
    });

  }
);

/**
 * @swagger
 * /api/candidates/table/assign:
 *   post:
 *     summary: Assign Section to Candidate (HR Table Action)
 *     tags: [HR - Table Actions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - candidateId
 *               - section
 *             properties:
 *               candidateId:
 *                 type: integer
 *                 example: 5
 *               section:
 *                 type: string
 *                 example: education
 *     responses:
 *       200:
 *         description: Assigned Successfully
 *       400:
 *         description: Validation Error
 */
router.post(
  "/assign",
  validateTableSection,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Assigned Successfully",
    });

  }
);

export default router;