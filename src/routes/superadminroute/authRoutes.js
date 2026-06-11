import express from "express";
import validateLogin from "../../middleware/superadmin/validateLogin.js";

const router = express.Router();

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Super Admin Login
 *     tags: [Super Admin - Auth]
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
 *                 example: admin@bgv.com
 *               password:
 *                 type: string
 *                 example: Admin@123
 *     responses:
 *       200:
 *         description: Validation Passed
 *       400:
 *         description: Validation Error
 */
router.post(
  "/login",
  validateLogin,
  async (req, res) => {
    res.json({
      success: true,
      message: "Validation Passed",
    });
  }
);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Super Admin Forgot Password
 *     tags: [Super Admin - Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 example: admin@bgv.com
 *     responses:
 *       200:
 *         description: Password reset link sent successfully
 *       400:
 *         description: Email is required or invalid
 */
router.post(
  "/forgot-password",
  async (req, res) => {

    const { email } = req.body;

    // EMPTY EMAIL
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // EMAIL FORMAT
    const emailRegex = /^\S+@\S+\.\S+$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Please enter valid email",
      });
    }

    // SUCCESS
    return res.status(200).json({
      success: true,
      message: "Password reset link sent successfully",
    });

  }
);

export default router;