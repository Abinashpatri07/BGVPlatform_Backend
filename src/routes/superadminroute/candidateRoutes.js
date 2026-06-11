import express from "express";

import validateCreateCandidate from
"../../middleware/superadmin/validateCreateCandidate.js";

import validateUpdateCandidate from
"../../middleware/superadmin/validateUpdateCandidate.js";

const router = express.Router();

/**
 * @swagger
 * /api/candidate/create:
 *   post:
 *     summary: Create a new Candidate (Super Admin)
 *     tags: [Super Admin - Candidate]
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
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Amit
 *               lastName:
 *                 type: string
 *                 example: Kumar
 *               email:
 *                 type: string
 *                 example: amit@email.com
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *     responses:
 *       200:
 *         description: Candidate Created Successfully
 *       400:
 *         description: Validation Error
 */
router.post(
  "/create",
  validateCreateCandidate,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Candidate Created Successfully",
    });

  }
);

/**
 * @swagger
 * /api/candidate/update/{id}:
 *   put:
 *     summary: Update a Candidate (Super Admin)
 *     tags: [Super Admin - Candidate]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: Candidate ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               firstName:
 *                 type: string
 *               lastName:
 *                 type: string
 *               phone:
 *                 type: string
 *     responses:
 *       200:
 *         description: Candidate Updated Successfully
 *       400:
 *         description: Validation Error
 */
router.put(
  "/update/:id",
  validateUpdateCandidate,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Candidate Updated Successfully",
    });

  }
);

export default router;