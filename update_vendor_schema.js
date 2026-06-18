import pool from "./src/config/db.js";

const schema = `
SET FOREIGN_KEY_CHECKS=0;
DROP TABLE IF EXISTS \`vendor_services\`;
DROP TABLE IF EXISTS \`vendors\`;

CREATE TABLE \`vendors\` (
  \`vendor_id\` INT AUTO_INCREMENT PRIMARY KEY,
  \`company_name\` VARCHAR(255) NOT NULL,
  \`cin\` VARCHAR(50),
  \`gst_number\` VARCHAR(20),

  \`address_line_1\` VARCHAR(255),
  \`address_line_2\` VARCHAR(255),
  \`city\` VARCHAR(100),
  \`state\` VARCHAR(100),
  \`pincode\` INT,

  \`company_logo\` VARCHAR(500),

  \`coverage_state1\` INT NULL,
  \`coverage_state2\` INT NULL,
  \`coverage_state3\` INT NULL,
  \`coverage_state4\` INT NULL,
  \`coverage_state5\` INT NULL,

  \`coverage_state1_city1\` INT NULL,
  \`coverage_state1_city2\` INT NULL,
  \`coverage_state1_city3\` INT NULL,
  \`coverage_state1_city4\` INT NULL,
  \`coverage_state1_city5\` INT NULL,

  \`coverage_state2_city1\` INT NULL,
  \`coverage_state2_city2\` INT NULL,
  \`coverage_state2_city3\` INT NULL,
  \`coverage_state2_city4\` INT NULL,
  \`coverage_state2_city5\` INT NULL,

  \`coverage_state3_city1\` INT NULL,
  \`coverage_state3_city2\` INT NULL,
  \`coverage_state3_city3\` INT NULL,
  \`coverage_state3_city4\` INT NULL,
  \`coverage_state3_city5\` INT NULL,

  \`coverage_state4_city1\` INT NULL,
  \`coverage_state4_city2\` INT NULL,
  \`coverage_state4_city3\` INT NULL,
  \`coverage_state4_city4\` INT NULL,
  \`coverage_state4_city5\` INT NULL,

  \`coverage_state5_city1\` INT NULL,
  \`coverage_state5_city2\` INT NULL,
  \`coverage_state5_city3\` INT NULL,
  \`coverage_state5_city4\` INT NULL,
  \`coverage_state5_city5\` INT NULL,

  \`poc_first_name\` VARCHAR(100),
  \`poc_last_name\` VARCHAR(100),
  \`poc_email\` VARCHAR(255),
  \`poc_mobile\` VARCHAR(20),

  \`address_ver\` TINYINT DEFAULT 2 COMMENT '1=Yes, 2=No',
  \`address_ver_sla\` INT,

  \`education_ver\` TINYINT DEFAULT 2 COMMENT '1=Yes, 2=No',
  \`education_ver_sla\` INT,

  \`employment_ver\` TINYINT DEFAULT 2 COMMENT '1=Yes, 2=No',
  \`employment_ver_sla\` INT,

  \`criminal_ver\` TINYINT DEFAULT 2 COMMENT '1=Yes, 2=No',
  \`criminal_ver_sla\` INT,

  \`drug_ver\` TINYINT DEFAULT 2 COMMENT '1=Yes, 2=No',
  \`drug_ver_sla\` INT,

  \`pcc_ver\` TINYINT DEFAULT 2 COMMENT '1=Yes, 2=No',
  \`pcc_ver_sla\` INT,

  \`reference_ver\` TINYINT DEFAULT 2 COMMENT '1=Yes, 2=No',
  \`reference_ver_sla\` INT,

  \`is_active\` TINYINT NOT NULL DEFAULT 1 COMMENT '1=Active, 2=Inactive',
  \`is_suspend\` TINYINT NOT NULL DEFAULT 2 COMMENT '1=Yes, 2=No',
  \`is_delete\` TINYINT NOT NULL DEFAULT 0 COMMENT '1=Yes, 0=No',

  \`created_by\` INT NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

  \`updated_by\` INT NULL,
  \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP
);
SET FOREIGN_KEY_CHECKS=1;
`;

async function run() {
  const queries = schema.split(';').filter(q => q.trim().length > 0);
  for (const query of queries) {
    try {
      await pool.query(query);
      console.log('Executed:', query.substring(0, 50), '...');
    } catch (e) {
      console.error('Error executing query:', query);
      console.error(e);
    }
  }
  process.exit(0);
}

run();
