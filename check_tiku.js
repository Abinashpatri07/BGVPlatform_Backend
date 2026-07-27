import pool from "./src/config/db.js";

async function run() {
  const email = "tiku.svia@gmail.com";
  console.log("Checking DB for email:", email);
  
  try {
    const [cands] = await pool.query(
      `SELECT cand_id, candidate_first_name, candidate_last_name, candidate_email FROM candidate WHERE candidate_email = ?`,
      [email]
    );
    console.log("Candidate table:", JSON.stringify(cands, null, 2));

    const [users] = await pool.query(
      `SELECT users_id, email, password_reset_token, password_reset_expiry FROM users WHERE email = ?`,
      [email]
    );
    console.log("Users table:", JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    process.exit();
  }
}
run();
