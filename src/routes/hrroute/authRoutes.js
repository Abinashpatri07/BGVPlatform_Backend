import express from "express";

import validateLogin from "../../middleware/hr/validateLogin.js";

const router = express.Router();

/**
 * @swagger
 * /api/hr/auth/login:
 *   post:
 *     summary: HR Login
 *     tags: [HR - Auth]
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
 *                 example: hr@company.com
 *               password:
 *                 type: string
 *                 example: Hr@12345
 *     responses:
 *       200:
 *         description: HR Login Successful
 *       400:
 *         description: Validation Error
 */
router.post(
  "/login",
  validateLogin,
  async (req, res) => {
    try {
      const { email, password } = req.body;

      // Temporary password check for demo purposes
      if (password !== "123456") {
        return res.status(401).json({
          success: false,
          message: "Invalid email or password",
        });
      }
      
      // Since the DB is on another system and currently unreachable,
      // we bypass the DB lookup and use a mock or generate the name from the email.
      let userName = "HR Executive";
      
      if (email.toLowerCase() === "puja@gmail.com") {
        userName = "Puja Gupta";
      } else {
        const namePart = email.split('@')[0];
        // replace dots/underscores with spaces and capitalize words
        userName = namePart
          .split(/[._]/)
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }

      res.status(200).json({
        success: true,
        message: "HR Login Successful",
        user: {
          name: userName,
          email: email
        }
      });
    } catch (error) {
      console.error("Login Error:", error);
      res.status(500).json({
        success: false,
        message: "Server error during login",
      });
    }
  }
);

export default router;