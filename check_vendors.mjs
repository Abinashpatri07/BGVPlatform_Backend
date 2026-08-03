import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    let [rows] = await pool.query("SHOW TABLES LIKE '%vendor%'");
    console.log("Tables matching 'vendor':", rows);
    
    try {
      let [vendors] = await pool.query("SELECT * FROM vendor_master");
      console.log("vendor_master rows:", vendors);
    } catch(e) {
      console.log("Error querying vendor_master:", e.message);
    }
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

check();
