import bcryptjs from "bcryptjs";
import bcrypt from "bcrypt";

async function run() {
  const hashFromDb = "$2b$10$IDfzEHpm2tkm41s9YC81yu1nSmHVw8zxYq1.V4CRZKH.IZ3hvZ542";
  // The user likely used a simple password like 'Candidate@123' or 'Abc@123' or 'Testing@123'
  // But wait, the comparison should just work if the password matches.
  
  // Let's create a NEW hash with bcrypt and check if bcryptjs can read it.
  const myPassword = "MyTestPassword123!";
  const hashNative = await bcrypt.hash(myPassword, 10);
  console.log("Native hash:", hashNative);
  
  const matchJs = await bcryptjs.compare(myPassword, hashNative);
  console.log("Can bcryptjs compare native hash?", matchJs);
}
run();
