import jwt from "jsonwebtoken";
import pool from "../config/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "fallback_super_secret_key";

export const verifyToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "No token provided, authorization denied." });
    }

    const token = authHeader.split(" ")[1];
    
    // 1. Verify JWT
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // 2. Check if Client is Suspended (for client-associated roles)
    if (req.user.client_id && req.user.role !== "Super Admin") {
      const [clientRows] = await pool.query(
        "SELECT is_suspend, is_active FROM client_master WHERE client_id = ? AND is_delete = 0",
        [req.user.client_id]
      );
      if (clientRows.length > 0 && (Number(clientRows[0].is_suspend) === 1 || Number(clientRows[0].is_active) === 2)) {
        return res.status(403).json({
          success: false,
          message: "Client account has been suspended. Please contact Super Admin support.",
        });
      }
    }

    // Check if Vendor is Suspended
    if (req.user.role === "Vendor" && req.user.id) {
      const [vendorRows] = await pool.query(
        "SELECT is_suspend, is_active FROM vendor_master WHERE vendor_id = ? AND is_delete = 0",
        [req.user.id]
      );
      if (vendorRows.length > 0 && (Number(vendorRows[0].is_suspend) === 1 || Number(vendorRows[0].is_active) === 2)) {
        return res.status(403).json({
          success: false,
          message: "Vendor account has been suspended. Please contact Super Admin support.",
        });
      }
    }

    // 3. Optional: Verify session is active in login_sessions
    // For performance, you might not do this on EVERY request, but for high security it's recommended.
    if (req.user.role !== "Vendor") {
      const [sessions] = await pool.query(
        "SELECT login_status FROM login_sessions WHERE access_token = ? AND is_current_session = 1",
        [token]
      );

      if (sessions.length === 0 || sessions[0].login_status !== "ACTIVE") {
        return res.status(401).json({ success: false, message: "Session expired or invalid" });
      }
    }

    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error.message);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Token has expired" });
    }
    return res.status(401).json({ success: false, message: "Token is not valid" });
  }
};

export default verifyToken;
