import dotenv from "dotenv";
dotenv.config();
import { Resend } from "resend";

const getResendClient = () => {
  const apiKey = process.env.RESEND_API_KEY;
  return new Resend(apiKey);
};

export const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const resend = getResendClient();
    const { data, error } = await resend.emails.send({
      from: "BGV Platform <noreply@dqnex.com>",
      to,
      subject,
      text,
      html,
    });

    if (error) {
      console.error("Error sending email:", error);
      return false;
    }

    console.log("Email sent:", data?.id);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};
