import pool from "./src/config/db.js";

async function updateEmail() {
  try {
    const [result] = await pool.query(
      "UPDATE users SET email = 'abinashpatri5@gmail.com' WHERE email = 'magnesh@gmail.com'"
    );
    if (result.affectedRows > 0) {
      console.log("SUCCESS! Magnesh's email has been updated to abinashpatri5@gmail.com");
      console.log("You can now login from the UI using: abinashpatri5@gmail.com");
    } else {
      console.log("No user found with email magnesh@gmail.com (maybe it's already updated?)");
    }
  } catch (error) {
    console.error("Error updating database:", error);
  } finally {
    process.exit();
  }
}

updateEmail();
