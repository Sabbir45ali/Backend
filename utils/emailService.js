import dotenv from "dotenv";

dotenv.config();

/**
 * Send an automated email notification using Brevo REST API
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject line
 * @param {string} htmlBody - HTML content of the email
 */
export const sendNotificationEmail = async (to, subject, htmlBody) => {
  try {
    const brevoApiKey = process.env.BREVO_API_KEY;
    const senderEmail = process.env.EMAIL_USER; // Your verified email in Brevo

    if (!brevoApiKey || !senderEmail) {
      console.warn(
        "BREVO_API_KEY or EMAIL_USER not set in .env. Skipping email to:",
        to,
      );
      return false;
    }

    const payload = {
      sender: {
        name: "Ruk's Glow House",
        email: senderEmail,
      },
      to: [
        {
          email: to,
        },
      ],
      subject: subject,
      htmlContent: htmlBody,
    };

    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": brevoApiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error("Failed to send email via Brevo API:", errorData);
      return false;
    }

    const responseData = await response.json();
    console.log("Email sent successfully via Brevo:", responseData.messageId);
    return true;
  } catch (error) {
    console.error("Error sending email via Brevo:", error);
    return false;
  }
};
