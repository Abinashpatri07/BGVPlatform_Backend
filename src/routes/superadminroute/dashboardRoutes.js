import express from "express";
import pool from "../../config/db.js";

const router = express.Router();

/**
 * @swagger
 * /api/dashboard/metrics:
 *   get:
 *     summary: Get metrics for Super Admin Dashboard
 *     tags: [Dashboard]
 *     responses:
 *       200:
 *         description: Dashboard metrics
 */
router.get("/metrics", async (req, res) => {
  try {
    // 1. Get total clients and active clients
    const [[clientStats]] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 AND is_suspend != 1 THEN 1 ELSE 0 END) as active
      FROM client_master 
      WHERE is_delete = 0
    `);
    const totalClients = clientStats.total || 0;
    const activeClients = clientStats.active || 0;

    // 2. Get total vendors
    const [[vendorStats]] = await pool.query(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN is_active = 1 AND is_suspend != 1 THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN is_suspend = 1 THEN 1 ELSE 0 END) as suspended,
        SUM(CASE WHEN is_active = 0 AND is_suspend != 1 THEN 1 ELSE 0 END) as pending
      FROM vendor_master 
      WHERE is_delete = 0
    `);

    // 3. Get candidate case stats (for Clients overview section if needed later)
    const [[caseStats]] = await pool.query(`
      SELECT 
        SUM(CASE WHEN verification_status = 1 THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN verification_status = 2 THEN 1 ELSE 0 END) as activeCases,
        SUM(CASE WHEN verification_status = 5 THEN 1 ELSE 0 END) as onHold,
        SUM(CASE WHEN verification_status = 0 THEN 1 ELSE 0 END) as awaitingInput,
        SUM(CASE WHEN verification_status = 3 THEN 1 ELSE 0 END) as rejected
      FROM candidate
      WHERE is_delete = 0
    `);

    // 4. Mock logic for revenue until billing tables exist
    const dashboardData = {
      clients: {
        total: totalClients,
        verified: parseInt(caseStats.verified) || 0, // Candidate verified cases
        active: parseInt(activeClients) || 0,        // Active Clients (replaces activeCases in UI)
        onHold: 0, // Hardcoded to 0 as per user request
        awaitingInput: 0, // Hardcoded to 0
        rejected: 0, // Hardcoded to 0
      },
      vendors: {
        total: parseInt(vendorStats.total) || 0,
        verified: parseInt(vendorStats.verified) || 0,
        totalCases: 0, // Mock or to be implemented
        onHold: 0, // Mock or to be implemented
        pendingVerification: parseInt(vendorStats.pending) || 0,
        suspended: parseInt(vendorStats.suspended) || 0,
      },
      revenue: {
        monthly: [600000, 98674, 660000, 720000, 680000, 820000, 740000, 490000, 580000, 650000, 610000, 790000],
        quarterly: [1865674, 1990000, 2070000, 2230000],
        yearly: [18000000, 19500000, 20900000],
      }
    };

    res.status(200).json({ success: true, data: dashboardData });
  } catch (error) {
    console.error("Dashboard Metrics Error:", error);
    res.status(500).json({ success: false, message: "Server error fetching metrics" });
  }
});

export default router;
