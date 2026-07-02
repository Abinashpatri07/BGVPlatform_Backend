import pool from "./config/db.js";

async function checkTable() {
  try {
    const [rows] = await pool.query('SHOW TABLES LIKE "candidate_identity"');
    console.log("Candidate Identity table:", rows);
    const [rows2] = await pool.query('SHOW TABLES LIKE "candidate_id_document"');
    console.log("Candidate ID Document table:", rows2);
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

checkTable();
