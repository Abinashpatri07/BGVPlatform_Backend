import pool from "./src/config/db.js";
import { v4 as uuidv4 } from 'uuid';

async function run() {
  try {
    const candidateEmail = 'tiku.svia@gmail.com';
    const firstName = 'Nursingha';
    const lastName = 'Pradhan';
    const setupToken = uuidv4();
    const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const dummyPassword = `locked_${uuidv4()}`;

    const [r] = await pool.query(
      `INSERT INTO users (first_name, last_name, username, email, role_id, role_name, password, password_reset_token, password_reset_expiry, is_active, is_delete)
       VALUES (?, ?, ?, ?, 4, 'candidate', ?, ?, ?, 1, 0)
       ON DUPLICATE KEY UPDATE password_reset_token = VALUES(password_reset_token), password_reset_expiry = VALUES(password_reset_expiry)`,
      [firstName, lastName, candidateEmail, candidateEmail, dummyPassword, setupToken, tokenExpiry]
    );
    console.log('Insert/Update result:', r);
  } catch (e) {
    console.error('SQL Error:', e.message);
  } finally {
    process.exit();
  }
}
run();
