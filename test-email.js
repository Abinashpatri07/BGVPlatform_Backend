import { sendEmail } from "./src/utils/sendEmail.js";

async function test() {
  console.log("Sending test email to abinashpatri5@gmail.com...");
  const otp = "123456";
  const success = await sendEmail({
    to: "abinashpatri5@gmail.com",
    subject: "Test OTP from BGV Platform (Hostinger)",
    text: `Your Test OTP is: ${otp}`,
    html: `<h3>Test Email</h3><p>Your OTP for login is: <b>${otp}</b>.</p><p>This verifies that Hostinger SMTP is working.</p>`,
  });
  
  if (success) {
    console.log("TEST SUCCESSFUL! Email sent.");
  } else {
    console.log("TEST FAILED! Email not sent.");
  }
  process.exit();
}

test();
