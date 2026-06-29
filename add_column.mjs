import pool from "./src/config/db.js";

async function fixColumns() {
  try {
    // Drop creator_type if it was added
    const [cols] = await pool.query(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
      WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'client_user_master' 
      AND COLUMN_NAME = 'creator_type'
    `);
    
    if (cols.length > 0) {
      await pool.query(`ALTER TABLE client_user_master DROP COLUMN creator_type`);
      console.log("Dropped creator_type column");
    } else {
      console.log("creator_type doesn't exist, nothing to drop");
    }
    
    process.exit(0);
  } catch (e) {
    console.error("Error:", e.message);
    process.exit(1);
  }
}
fixColumns();
