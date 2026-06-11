import express from "express";

import validateCreateVendor from
"../../middleware/superadmin/validateCreateVendor.js";

import validateUpdateVendor from
"../../middleware/superadmin/validateUpdateVendor.js";

const router = express.Router();

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
 *       200:
 *         description: Vendor Created Successfully
 *       400:
 *         description: Validation Error
 */
router.post(
  "/create",
  validateCreateVendor,
  async (req, res) => {
    res.status(200).json({
      success: true,
      message: "Vendor Created Successfully",
    });
  }
);

/**
 * @swagger
 * /api/vendor/update/{id}:
 *   put:
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
 *                 example: Updated Vendor Name
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *     responses:
 *       200:
 *         description: Vendor Updated Successfully
 *       400:
 *         description: Validation Error
 */
router.put(
  "/update/:id",
  validateUpdateVendor,
  async (req, res) => {
    res.status(200).json({
      success: true,
      message: "Vendor Updated Successfully",
    });
  }
);

export default router;