import pool from './src/config/db.js';

async function checkOTPs() {
  try {
    const [users] = await pool.query("SELECT email, last_otp FROM users WHERE last_otp IS NOT NULL");
    console.log("Users (SuperAdmin/ClientAdmin/HR) OTPs:", users);
  } catch(e) {}
  
  try {
    const [vendors] = await pool.query("SELECT email_id as email, last_otp FROM vendor_master WHERE last_otp IS NOT NULL");
    console.log("Vendors OTPs:", vendors);
  } catch(e) {}

  try {
     const [cands] = await pool.query("SELECT email, last_otp FROM candidate WHERE last_otp IS NOT NULL");
     console.log("Candidate OTPs:", cands);
  } catch(e) {}
  
  process.exit(0);
}
checkOTPs();
