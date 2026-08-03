import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
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

async function run() {
  try {
    const email = 'vendor@gmail.com';
    const plainPassword = 'Admin@123';
    
    const [existing] = await pool.query('SELECT * FROM vendor_master WHERE poc_email = ?', [email]);
    const hash = await bcrypt.hash(plainPassword, 10);

    if (existing.length > 0) {
      console.log('Vendor already exists. Updating password...');
      await pool.query('UPDATE vendor_master SET password_hash = ?, is_active = 1, is_suspend = 2, is_delete = 0 WHERE poc_email = ?', [hash, email]);
      console.log('Vendor updated successfully.');
    } else {
      console.log('Inserting new vendor...');
      const query = `
        INSERT INTO vendor_master 
        (
          company_name, cin, gst_number, 
          address_line_1, city, state, pincode,
          poc_first_name, poc_last_name, poc_email, poc_mobile, 
          password_hash, is_active, is_suspend, is_delete
        ) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 2, 0)
      `;
      const values = [
        'Test Vendor Co', 'U12345KA2023PTC123456', '29ABCDE1234F1Z5',
        'Test Address', 'Test City', 'Test State', '123456',
        'Test', 'Vendor', email, '1234567890', 
        hash
      ];
      await pool.query(query, values);
      console.log('Vendor inserted successfully.');
    }
  } catch(e) {
    console.error('Error:', e);
  } finally {
    pool.end();
  }
}

run();
