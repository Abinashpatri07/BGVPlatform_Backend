import pool from "./src/config/db.js";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

async function run() {
  // Simulate exactly what Render's send-welcome-email does
  const candidateEmail = "patriabinash4@gmail.com";
  const firstName = "Rabin";
  const lastName = "Chandra";
  const setupToken = uuidv4();
  const tokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const dummyPassword = `locked_${uuidv4()}`;

  console.log("Trying to INSERT/UPDATE for:", candidateEmail);
  console.log("Token:", setupToken);

  try {
    const [result] = await pool.query(
      `INSERT INTO users (first_name, last_name, username, email, role_id, role_name, password, password_reset_token, password_reset_expiry, is_active, is_delete)
       VALUES (?, ?, ?, ?, 4, 'candidate', ?, ?, ?, 1, 0)
       ON DUPLICATE KEY UPDATE password_reset_token = VALUES(password_reset_token), password_reset_expiry = VALUES(password_reset_expiry)`,
      [firstName, lastName, candidateEmail, candidateEmail, dummyPassword, setupToken, tokenExpiry]
    );
    console.log("Result:", JSON.stringify(result));
    
    // Verify it was saved
    const [rows] = await pool.query(
      "SELECT users_id, email, password_reset_token FROM users WHERE password_reset_token = ?",
      [setupToken]
    );
    console.log("Verification:", JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("ERROR:", err.message);
    console.error("SQL Error Code:", err.code);
  }
  process.exit();
}
run();
