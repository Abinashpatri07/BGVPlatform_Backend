import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const { data, error } = await resend.emails.send({
      from: "BGV Platform <onboarding@resend.dev>",
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
