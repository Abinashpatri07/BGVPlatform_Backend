import mysql from 'mysql2/promise';

async function check() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'bgv_platform',
  });

  const [rows] = await pool.query('SELECT users_id, firstname, role_name, role_id, client_id, is_active FROM client_user_master');
  console.log("ALL USERS:");
  console.table(rows);
  process.exit(0);
}
check();
