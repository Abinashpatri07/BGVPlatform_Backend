import pool from "./src/config/db.js";

async function addUanColumn() {
  try {
    const conn = await pool.getConnection();
    console.log("Connected to DB. Adding uan_number column to candidate_identity...");
    
    // Check if column exists first
    const [rows] = await conn.query(`
      SELECT COUNT(*) AS count 
      FROM information_schema.COLUMNS 
      WHERE TABLE_SCHEMA = 'BGV' 
      AND TABLE_NAME = 'candidate_identity' 
      AND COLUMN_NAME = 'uan_number'
    `);
    
    if (rows[0].count === 0) {
      await conn.query("ALTER TABLE candidate_identity ADD COLUMN uan_number varchar(50) DEFAULT NULL AFTER voter_number;");
      console.log("Successfully added uan_number column.");
    } else {
      console.log("Column uan_number already exists.");
    }
    
    conn.release();
    process.exit(0);
  } catch (error) {
    console.error("Error adding column:", error);
    process.exit(1);
  }
}

addUanColumn();
