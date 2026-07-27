import pool from "./src/config/db.js";

async function run() {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM users WHERE email = 'tiku5161@gmail.com'`
    );
    console.log("Full user row:", JSON.stringify(rows[0], null, 2));
  } catch (err) {
    console.error("DB Error:", err);
  } finally {
    process.exit();
  }
}
run();
