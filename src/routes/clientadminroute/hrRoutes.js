import express from "express";

import validateCreateHR from "../../middleware/clientadmin/validateCreateHR.js";
import validateUpdateHR from "../../middleware/clientadmin/validateUpdateHR.js";

const router = express.Router();

/**
 * @swagger
 * /api/client-admin/hr/create:
 *   post:
 *     summary: Create a new HR (Client Admin)
 *     tags: [Client Admin - HR]
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
 *                 example: Priya
 *               lastName:
 *                 type: string
 *                 example: Singh
 *               email:
 *                 type: string
 *                 example: priya@company.com
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

/**
 * @swagger
 * /api/client-admin/hr/update/{id}:
 *   put:
 *     summary: Update an HR (Client Admin)
 *     tags: [Client Admin - HR]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: HR User ID
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
 *         description: HR Updated Successfully
 *       400:
 *         description: Validation Error
 */
router.put(
  "/update/:id",
  validateUpdateHR,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "HR Updated Successfully",
    });

  }
);

export default router;