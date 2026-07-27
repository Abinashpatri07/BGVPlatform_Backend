import { Resend } from "resend";
import dotenv from "dotenv";
dotenv.config();

const resend = new Resend(process.env.RESEND_API_KEY);

async function checkEmails() {
  try {
    const data = await resend.emails.list();
    console.log("Recent emails sent via Resend:");
    data.data.data.slice(0, 5).forEach(email => {
      console.log(`- To: ${email.to}, Status: ${email.status}, Created: ${email.created_at}`);
    });
  } catch (error) {
    console.error("Error fetching from Resend:", error);
  }
}

checkEmails();
