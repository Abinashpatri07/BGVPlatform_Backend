import express from "express";

import validateCreateClient from
"../../middleware/superadmin/validateCreateClient.js";

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
 *               - contactEmail
 *             properties:
 *               companyName:
 *                 type: string
 *                 example: Acme Corp
 *               contactEmail:
 *                 type: string
 *                 example: contact@acme.com
 *               contactPhone:
 *                 type: string
 *                 example: "9876543210"
 *     responses:
 *       200:
 *         description: Client created successfully
 *       400:
 *         description: Validation Error
 */
router.post(
  "/create-client",
  validateCreateClient,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Client created successfully",
    });

  }
);

export default router;