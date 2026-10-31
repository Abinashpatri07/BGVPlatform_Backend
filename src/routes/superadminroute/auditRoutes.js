import express from "express";
import pool from "../../config/db.js";
import { verifyToken } from "../../middleware/authMiddleware.js";

const router = express.Router();
router.use(verifyToken);

/**
 * @swagger
 * /api/audit:
 *   get:
 *     summary: Get paginated system audit logs
 *     tags: [Audit Log]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: module
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of audit logs
 */
router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    
    const search = req.query.search || "";
    const moduleFilter = req.query.module || "All Modules";
    const dateFilter = req.query.dateFilter || "All Time";

    let filterSql = "";
    
    const queryParams = [];

    if (search) {
      filterSql += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR a.remarks LIKE ? OR a.ip LIKE ?)`;
      const searchParam = `%${search}%`;
      queryParams.push(searchParam, searchParam, searchParam, searchParam);
    }

    if (moduleFilter && moduleFilter !== "All Modules") {
      filterSql += ` AND a.module_type = ?`;
      queryParams.push(moduleFilter);
    }

    if (dateFilter && dateFilter !== "All Time") {
      if (dateFilter === "Today") {
        filterSql += ` AND DATE(a.created_at) = CURDATE()`;
      } else if (dateFilter === "Yesterday") {
        filterSql += ` AND DATE(a.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`;
      } else if (dateFilter === "Last 7 Days") {
        filterSql += ` AND DATE(a.created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
      } else if (dateFilter === "Last 30 Days") {
        filterSql += ` AND DATE(a.created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`;
      }
    }

    // Count Total
    const countQuery =
      "SELECT COUNT(*) as total FROM audit_logs a LEFT JOIN users u ON a.user_id = u.users_id WHERE 1=1" +
      filterSql;
    const [countResult] = await pool.query(countQuery, queryParams);
    const totalCount = countResult[0].total;

    // Fetch Data
    const dataQuery =
      "SELECT a.audit_id, u.first_name, u.last_name, u.first_name AS firstname, u.last_name AS lastname, u.role_name, a.action, a.module_type, a.status, a.ip, a.remarks, a.created_at " +
      "FROM audit_logs a LEFT JOIN users u ON a.user_id = u.users_id WHERE 1=1" +
      filterSql +
      " ORDER BY a.created_at DESC LIMIT ? OFFSET ?";

    const [rows] = await pool.query(dataQuery, [...queryParams, limit, offset]);

    return res.status(200).json({
      success: true,
      data: rows,
      pagination: {
        total: totalCount,
        page,
        limit,
        totalPages: Math.ceil(totalCount / limit)
      }
    });
  } catch (error) {
    console.error("audit-log error:", error);
    return res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

export default router;
