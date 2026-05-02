const { sendNotificationEmail } = require("./utils/emailService.js");

async function test() {
  console.log("Testing Brevo Email...");
  
  // Replace this with your own personal email address to receive the test!
  const myEmail = "sabbir84b@gmail.com"; 

  const success = await sendNotificationEmail(
    myEmail,
    "Test from Ruksana's Parlour",
    "<h1>It works!</h1><p>Brevo is successfully configured.</p>"
  );

  if (success) {
    console.log("✅ Awesome! The test email went through.");
  } else {
    console.log("❌ Uh oh. The email failed to send.");
  }
}

test();
