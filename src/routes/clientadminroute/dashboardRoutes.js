import express from "express";
import pool from "../../config/db.js";

const router = express.Router();

/**
 * @swagger
 * /api/client-admin/dashboard/metrics:
 *   get:
 *     summary: Get dashboard metrics for Client Admin
 *     tags: [Client Admin - Dashboard]
 */
router.get("/metrics", async (req, res) => {
  try {
    const clientId = 1; // Default client id for mock auth

    // 1. HR Overview Metrics
    const [hrRows] = await pool.query(
      `SELECT 
         COUNT(*) as \`total\`,
         SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as \`active\`,
         SUM(CASE WHEN is_active = 2 THEN 1 ELSE 0 END) as \`inactive\`,
         SUM(CASE WHEN is_active = 3 THEN 1 ELSE 0 END) as \`terminated\`
       FROM client_user_master 
       WHERE client_id = ? AND is_delete = 0 AND role_name IN ('HR', 'HR 2', 'HR Executive', 'HR Manager', 'HR User')`,
      [clientId]
    );

    const hrData = {
      total: hrRows[0].total || 0,
      active: hrRows[0].active || 0,
      inactive: hrRows[0].inactive || 0,
      terminated: hrRows[0].terminated || 0,
    };

    // 2. Candidate Overview Metrics
    const [candidateRows] = await pool.query(
      `SELECT 
         COUNT(*) as \`total\`,
         SUM(CASE WHEN verification_status = 1 THEN 1 ELSE 0 END) as \`verified\`,
         SUM(CASE WHEN verification_status = 2 THEN 1 ELSE 0 END) as \`inProgress\`,
         SUM(CASE WHEN verification_status = 3 THEN 1 ELSE 0 END) as \`rejected\`,
         SUM(CASE WHEN verification_status = 5 THEN 1 ELSE 0 END) as \`onHold\`,
         SUM(CASE WHEN verification_status = 4 THEN 1 ELSE 0 END) as \`complete\`,
         SUM(CASE WHEN verification_status = 0 THEN 1 ELSE 0 END) as \`verificationInProgress\`
       FROM candidate
       WHERE client_id = ? AND is_delete = 0`,
      [clientId]
    );

    const candidateData = {
      total: candidateRows[0].total || 0,
      verified: candidateRows[0].verified || 0,
      inProgress: candidateRows[0].inProgress || 0,
      rejected: candidateRows[0].rejected || 0,
      onHold: candidateRows[0].onHold || 0,
      complete: candidateRows[0].complete || 0,
      verificationInProgress: candidateRows[0].verificationInProgress || 0,
    };

    // 3. Recent Profiles (HR + Candidates)
    const [recentHrRows] = await pool.query(
      `SELECT firstname, lastname, created_at, 'HR' as role 
       FROM client_user_master 
       WHERE client_id = ? 
       ORDER BY created_at DESC LIMIT 5`,
      [clientId]
    );

    const [recentCandidateRows] = await pool.query(
      `SELECT candidate_first_name as firstname, candidate_last_name as lastname, created_at, 'Candidate' as role 
       FROM candidate 
       WHERE client_id = ? AND is_delete = 0 
       ORDER BY created_at DESC LIMIT 5`,
      [clientId]
    );

    let recentProfiles = [];
    
    // Format HRs
    recentHrRows.forEach(hr => {
      recentProfiles.push({
        name: `${hr.firstname || ''} ${hr.lastname || ''}`.trim(),
        role: 'HR',
        time: hr.created_at,
        img: Math.floor(Math.random() * 50) + 1 // random avatar
      });
    });

    // Format Candidates
    recentCandidateRows.forEach(cand => {
      recentProfiles.push({
        name: `${cand.firstname || ''} ${cand.lastname || ''}`.trim(),
        role: 'Candidate',
        time: cand.created_at,
        img: Math.floor(Math.random() * 50) + 1
      });
    });

    // Sort combined by created_at desc
    recentProfiles.sort((a, b) => new Date(b.time) - new Date(a.time));
    recentProfiles = recentProfiles.slice(0, 10);

    res.status(200).json({
      success: true,
      data: {
        hrStats: hrData,
        candidateStats: candidateData,
        recentProfiles: recentProfiles
      }
    });

  } catch (error) {
    console.error("Client Admin Dashboard Metrics Error:", error);
    res.status(500).json({ success: false, message: "Server error fetching metrics" });
  }
});

export default router;
