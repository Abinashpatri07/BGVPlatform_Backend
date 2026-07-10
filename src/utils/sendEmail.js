import nodemailer from "nodemailer";

export const sendEmail = async ({ to, subject, text, html }) => {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: process.env.SMTP_PORT || 587, // Changed from 465 to 587
      secure: false, // false for 587, true for 465
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false
      },
      // Force IPv4. Render / some cloud servers fail on IPv6 (ENETUNREACH)
      // Any options not handled by nodemailer are passed to underlying socket
      host: process.env.SMTP_HOST || "smtp.gmail.com",
    });

    // We can also pass `family: 4` to the options to force Node.js to use IPv4 only.
    transporter.options.family = 4;

    const info = await transporter.sendMail({
      from: `"BGV Platform" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
    });

    console.log("Email sent: %s", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};
