import pool from "./src/config/db.js";

async function run() {
  try {
    const [rows] = await pool.query(
      `SELECT users_id, email, password, role_name FROM users WHERE email IN ('tiku.svia@gmail.com', 'tiku5161@gmail.com')`
    );
    console.log("Users found:", JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    process.exit();
  }
}
run();
