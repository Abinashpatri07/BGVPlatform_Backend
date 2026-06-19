import pool from "./src/config/db.js";

const sql = `
  CREATE TABLE IF NOT EXISTS hr_master (
    hr_id          INT AUTO_INCREMENT PRIMARY KEY,
    emp_id         VARCHAR(50) NOT NULL UNIQUE,
    first_name     VARCHAR(100) NOT NULL,
    last_name      VARCHAR(100) NOT NULL,
    email          VARCHAR(150) NOT NULL UNIQUE,
    phone          VARCHAR(20) NOT NULL,
    role           VARCHAR(50) NOT NULL,
    is_active      TINYINT(1) NOT NULL DEFAULT 1,
    is_delete      TINYINT(1) NOT NULL DEFAULT 0,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`;

try {
  await pool.query(sql);
  console.log("hr_master table created successfully ✅");
} catch (e) {
  console.error("Error:", e.message);
} finally {
  await pool.end();
}
