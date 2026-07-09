import pool from "./src/config/db.js";
import bcrypt from "bcryptjs";

async function run() {
  try {
    const [rows] = await pool.query("SELECT email, login_attempt_count, locked_until, is_active FROM users WHERE email IN ('puja@gmail.com', 'magnesh@gmail.com', 'superadmin@gmail.com')");
    console.log("Current User Status:");
    console.log(JSON.stringify(rows, null, 2));

    // Let's reset their password to 'Admin@123' and unlock them just in case
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('Admin@123', salt);

    await pool.query(
      "UPDATE users SET password = ?, login_attempt_count = 0, locked_until = NULL WHERE email IN ('puja@gmail.com', 'magnesh@gmail.com', 'superadmin@gmail.com')",
      [hashedPassword]
    );

    console.log("\nSuccessfully reset passwords for all three test accounts to: Admin@123");
    console.log("Also unlocked accounts and reset login attempt counts.");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
