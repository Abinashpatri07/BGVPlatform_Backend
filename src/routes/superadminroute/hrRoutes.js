import express from "express";

import validateCreateHR from
"../../middleware/superadmin/validateCreateHR.js";

const router = express.Router();

/**
 * @swagger
 * /api/hr/create:
 *   post:
 *     summary: Create a new HR (Super Admin)
 *     tags: [Super Admin - HR]
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
 *               - password
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: Rahul
 *               lastName:
 *                 type: string
 *                 example: Sharma
 *               email:
 *                 type: string
 *                 example: rahul@bgv.com
 *               password:
 *                 type: string
 *                 example: Hr@12345
 *     responses:
 *       200:
 *         description: HR Created Successfully
 *       400:
 *         description: Validation Error
 */
router.post(
  "/create",
  validateCreateHR,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "HR Created Successfully",
    });

  }
);

export default router;