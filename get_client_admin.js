import pool from "./src/config/db.js";

async function run() {
  try {
    const [rows] = await pool.query(
      `SELECT users_id, email, role_name, password FROM users WHERE role_name = 'Client Admin'`
    );
    console.log("Client Admins:", JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
