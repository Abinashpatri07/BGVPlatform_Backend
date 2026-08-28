import pool from './src/config/db.js';

async function test() {
  try {
    const [rows] = await pool.query('DESCRIBE candidate_employment');
    console.log("COLUMNS:");
    rows.forEach(r => console.log(r.Field));
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

test();
