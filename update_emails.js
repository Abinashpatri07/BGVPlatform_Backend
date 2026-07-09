import pool from "./src/config/db.js";

async function run() {
  try {
    console.log("Updating Super Admin email...");
    await pool.query("UPDATE users SET email = 'superadmin@gmail.com' WHERE role_name = 'Super Admin'");
    
    console.log("Updating Client Admin email...");
    await pool.query("UPDATE users SET email = 'magnesh@gmail.com' WHERE role_name = 'Client Admin'");
    
    console.log("Checking updated users:");
    const [rows] = await pool.query("SELECT users_id, first_name, last_name, email, role_name FROM users WHERE role_name IN ('Super Admin', 'Client Admin', 'HR Manager')");
    console.log(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
