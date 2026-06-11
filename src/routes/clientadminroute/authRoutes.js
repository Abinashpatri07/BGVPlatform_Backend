import express from "express";

import validateLogin from
"../../middleware/clientadmin/validateLogin.js";

const router = express.Router();

/**
 * @swagger
 * /api/client-admin/auth/login:
 *   post:
 *     summary: Client Admin Login
 *     tags: [Client Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: clientadmin@bgv.com
 *               password:
 *                 type: string
 *                 example: Admin@123
 *     responses:
 *       200:
 *         description: Login Successful
 *       400:
 *         description: Validation Error
 */
router.post(
  "/login",
  validateLogin,
  async (req, res) => {

    res.status(200).json({
      success: true,
      message: "Login Successful",
    });

  }
);

export default router;