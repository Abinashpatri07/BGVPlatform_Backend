import pool from './src/config/db.js';
async function fix() {
  const [res] = await pool.query("UPDATE billing_payment SET payment_method = 'UPI' WHERE payment_method = 'null'");
  console.log("Fixed: ", res.affectedRows);
  process.exit(0);
}
fix();
