import pool from './src/config/db.js';
import bcrypt from 'bcryptjs';

async function createDummyCandidate() {
  try {
    const email = 'test.candidate@example.com';
    const password = 'Password@123';
    
    // Check if exists
    const [existing] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      console.log("Candidate already exists. Updating password...");
      const hashedPassword = await bcrypt.hash(password, 10);
      await pool.query("UPDATE users SET password = ? WHERE email = ?", [hashedPassword, email]);
      console.log("Password updated!");
      process.exit(0);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const [roles] = await pool.query("SELECT role_id FROM role_master WHERE role_name = 'candidate' LIMIT 1");
    let roleId = 5;
    if (roles.length > 0) roleId = roles[0].role_id;

    // Insert into users
    const [userResult] = await pool.query(
      `INSERT INTO users (role_id, role_name, username, email, password, first_name, last_name, is_active, is_delete)
       VALUES (?, 'candidate', ?, ?, ?, 'Test', 'Candidate', 1, 0)`,
      [roleId, email, email, hashedPassword]
    );
    
    // Insert into candidate
    await pool.query(
      `INSERT INTO candidate (candidate_id, client_id, candidate_first_name, candidate_last_name, candidate_email, is_active, is_delete)
       VALUES ('CAND-99999', 1, 'Test', 'Candidate', ?, 1, 0)`,
      [email]
    );

    console.log('Dummy candidate created successfully!');
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}
createDummyCandidate();
