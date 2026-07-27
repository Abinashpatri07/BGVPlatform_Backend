import pool from "./src/config/db.js";

async function run() {
  try {
    await pool.query(
      `ALTER TABLE candidate
       ADD COLUMN candidate_experience TINYINT NOT NULL DEFAULT 1
       COMMENT '1=Fresher, 2=Experienced'
       AFTER candidate_function;`
    );
    console.log("Column candidate_experience added successfully.");
  } catch (err) {
    if (err.code === "ER_DUP_FIELDNAME") {
      console.log("Column candidate_experience already exists.");
    } else {
      console.error(err);
    }
  } finally {
    process.exit();
  }
}
run();
