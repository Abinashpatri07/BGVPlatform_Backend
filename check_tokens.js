import pool from "./src/config/db.js";

async function run() {
  console.log("DB Host:", process.env.DB_HOST);
  
  const [rows] = await pool.query(
    `SELECT users_id, email, password_reset_token FROM users WHERE email IN ('patriabinash4@gmail.com', 'patriabinash9@gmail.com')`
  );
  console.log("Current DB state:", JSON.stringify(rows, null, 2));
  process.exit();
}
run();
