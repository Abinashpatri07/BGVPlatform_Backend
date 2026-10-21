import express from "express";
import pool from "../../config/db.js";

const router = express.Router();

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

    let baseQuery = `
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.users_id
      WHERE 1=1
    `;
    
    const queryParams = [];

    if (search) {
      baseQuery += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR a.remarks LIKE ? OR a.ip LIKE ?)`;
      const searchParam = `%${search}%`;
      queryParams.push(searchParam, searchParam, searchParam, searchParam);
    }

    if (moduleFilter && moduleFilter !== "All Modules") {
      baseQuery += ` AND a.module_type = ?`;
      queryParams.push(moduleFilter);
    }

    if (dateFilter && dateFilter !== "All Time") {
      if (dateFilter === "Today") {
        baseQuery += ` AND DATE(a.created_at) = CURDATE()`;
      } else if (dateFilter === "Yesterday") {
        baseQuery += ` AND DATE(a.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)`;
      } else if (dateFilter === "Last 7 Days") {
        baseQuery += ` AND DATE(a.created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)`;
      } else if (dateFilter === "Last 30 Days") {
        baseQuery += ` AND DATE(a.created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)`;
      }
    }

    // Count Total
    const [countResult] = await pool.query(`SELECT COUNT(*) as total ${baseQuery}`, queryParams);
    const totalCount = countResult[0].total;

    // Fetch Data
    const dataQuery = `
      SELECT 
        a.audit_id,
        u.first_name,
        u.last_name,
        u.first_name AS firstname,
        u.last_name AS lastname,
        u.role_name,
        a.action,
        a.module_type,
        a.status,
        a.ip,
        a.remarks,
        a.created_at
      ${baseQuery}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `;
    
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
