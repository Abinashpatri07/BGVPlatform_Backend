import mysql from 'mysql2/promise';

async function check() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'bgv_platform',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  const [tables] = await pool.query('SHOW TABLES');
  for (const row of tables) {
    const tableName = Object.values(row)[0];
    console.log(`\nTable: ${tableName}`);
    const [columns] = await pool.query(`SHOW COLUMNS FROM ${tableName}`);
    columns.forEach(col => console.log(`  ${col.Field} (${col.Type})`));
  }
  process.exit(0);
}
check();
