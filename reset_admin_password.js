import pool from "./src/config/db.js";
import bcrypt from "bcryptjs";

async function run() {
  try {
    const password = "Admin@123";
    const hashedPassword = await bcrypt.hash(password, 10);
    
    await pool.query(
      `UPDATE users SET password = ? WHERE email = 'abinashpatri5@gmail.com'`,
      [hashedPassword]
    );
    console.log("Password reset successfully for abinashpatri5@gmail.com to Admin@123");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit();
  }
}
run();
