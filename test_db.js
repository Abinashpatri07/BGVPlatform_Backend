import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

async function test() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const [rows] = await pool.query("SELECT invoice_id, invoice_number, client_id, package_name, created_at FROM billing_invoice ORDER BY invoice_id DESC LIMIT 5");
    console.log("Recent invoices:");
    console.table(rows);
    
    const [clients] = await pool.query("SELECT client_id, company_name FROM client_master WHERE client_id IN (1, 20)");
    console.log("Clients:");
    console.table(clients);
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}
test();
