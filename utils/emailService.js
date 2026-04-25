import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Send an automated email notification
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject line
 * @param {string} htmlBody - HTML content of the email
 */
export const sendNotificationEmail = async (to, subject, htmlBody) => {
  try {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn(
        "EMAIL_USER or EMAIL_PASS not set in .env. Skipping email to:",
        to,
      );
      return false;
    }

    const mailOptions = {
      from: `"Ruksana's Parlour" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html: htmlBody,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent: %s", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email:", error);
    return false;
  }
};
