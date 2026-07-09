import pool from "./src/config/db.js";

async function run() {
  try {
    const [rows] = await pool.query("SELECT users_id, first_name, last_name, email, role_name FROM users");
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
