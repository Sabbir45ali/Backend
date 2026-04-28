const express = require("express");
const router = express.Router();
const { auth, db } = require("../config/firebase");
const { verifyToken } = require("../middleware/auth");
const { sendNotificationEmail } = require("../utils/emailService");

// Note: Admin logic now cleanly wraps Firebase Auth.
// Uses ADMIN_EMAIL and ADMIN_PASSWORD from .env
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@beauty.com")
  .replace(/['"]/g, "")
  .trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || "AdminPassword123!")
  .replace(/['"]/g, "")
  .trim();

// === ADMIN LOGIN (Auto-registers admin in Firebase if not found) ===
router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const cleanEmail = email ? String(email).trim() : "";

    // Hard check: only let the master admin email login to this endpoint
    if (cleanEmail !== ADMIN_EMAIL) {
      return res.status(403).json({
        success: false,
        message: "Invalid admin email",
        provided: cleanEmail,
        expected: ADMIN_EMAIL,
      });
    }

    if (password !== ADMIN_PASSWORD) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid password" });
    }

    // Auto-create admin in Firebase Auth if it doesn't exist
    try {
      await auth.getUserByEmail(ADMIN_EMAIL);
    } catch (error) {
      if (error.code === "auth/user-not-found") {
        await auth.createUser({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          displayName: "Master Admin",
        });
      } else {
        throw error;
      }
    }

    // Proceed to authenticate and fetch token via Identity Toolkit
    const apiKey = process.env.FIREBASE_API_KEY;
    const fetchFn =
      typeof fetch !== "undefined"
        ? fetch
        : (await import("node-fetch")).default;
    const response = await fetchFn(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD,
          returnSecureToken: true,
        }),
      },
    );

    const data = await response.json();
    if (!response.ok)
      return res
        .status(400)
        .json({ success: false, message: data.error?.message });

    res.json({
      success: true,
      token: data.idToken,
      uid: data.localId,
      message: "Admin authenticated",
    });
  } catch (err) {
    next(err);
  }
});

// Middleware explicitly guarding all routes below this line
const verifyAdminRights = (req, res, next) => {
  if (req.user.email !== ADMIN_EMAIL) {
    return res.status(403).json({
      success: false,
      message: "Forbidden. Master Admin Access Only.",
    });
  }
  next();
};

router.use(verifyToken);
router.use(verifyAdminRights);

// === SERVICES ===
router.get("/services", async (req, res, next) => {
  try {
    const snapshot = await db.collection("services").get();
    res.json({
      data: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/services", async (req, res, next) => {
  try {
    const newDoc = await db
      .collection("services")
      .add({ ...req.body, createdAt: new Date().toISOString() });
    res.status(201).json({ success: true, data: { id: newDoc.id } });
  } catch (err) {
    next(err);
  }
});

router.put("/services/:id", async (req, res, next) => {
  try {
    await db.collection("services").doc(req.params.id).update(req.body);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/services/:id", async (req, res, next) => {
  try {
    await db.collection("services").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// === APPOINTMENTS ===
router.get("/appointments", async (req, res, next) => {
  try {
    const snapshot = await db
      .collection("appointments")
      .orderBy("createdAt", "desc")
      .get();
    res.json({
      data: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (err) {
    next(err);
  }
});

router.put("/appointments/:id/status", async (req, res, next) => {
  try {
    await db
      .collection("appointments")
      .doc(req.params.id)
      .update({ status: req.body.status });

    // Try to send email
    const docRef = await db.collection("appointments").doc(req.params.id).get();
    if (docRef.exists) {
      const appData = docRef.data();
      if (appData.userEmail) {
        if (req.body.status.toLowerCase() === "confirmed") {
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #4CAF50; text-align: center;">Appointment Confirmed! 🎉</h2>
              <p>Dear Valued Client,</p>
              <p>Great news! Your booking at Ruk's Glow House has been fully confirmed by our team.</p>
              <div style="background-color: #E8F5E9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 5px 0;"><b>Service:</b> ${appData.serviceName || appData.service}</p>
                <p style="margin: 5px 0;"><b>Date:</b> ${appData.date}</p>
                <p style="margin: 5px 0;"><b>Time:</b> ${appData.time}</p>
              </div>
              <p>Please arrive 5 minutes early. We can't wait to see you!</p>
              <p>Best Regards,<br><b>Ruk's Glow House</b></p>
            </div>
          `;
          sendNotificationEmail(
            appData.userEmail,
            "Appointment Confirmed - Ruksana's Parlour",
            emailHtml,
          );
        } else if (req.body.status.toLowerCase() === "cancelled") {
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
              <h2 style="color: #F44336; text-align: center;">Appointment Cancelled</h2>
              <p>Dear Valued Client,</p>
              <p>Unfortunately, your booking for <b>${appData.serviceName || appData.service}</b> on <b>${appData.date}</b> at <b>${appData.time}</b> has been cancelled.</p>
              <p>If you believe this was a mistake or need to reschedule, please visit our app or contact support.</p>
              <p>Best Regards,<br><b>Ruk's Glow House</b></p>
            </div>
          `;
          sendNotificationEmail(
            appData.userEmail,
            "Appointment Cancelled - Ruksana's Parlour",
            emailHtml,
          );
        }
      }
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.put("/appointments/:id/reschedule", async (req, res, next) => {
  try {
    const { date, time } = req.body;
    await db.collection("appointments").doc(req.params.id).update({
      date,
      time,
      status: "Reschedule pending client approval",
      lastUpdated: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/appointments", async (req, res, next) => {
  try {
    const { userName, userEmail, userPhone, serviceName, serviceId, date, time, status } = req.body;

    if (!userName || !serviceName || !date || !time) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const newDoc = await db.collection("appointments").add({
      userId: "admin-created",
      userName,
      userEmail: userEmail || "",
      userPhone: userPhone || "",
      serviceId: serviceId || "",
      serviceName,
      service: serviceName,
      date,
      time,
      status: status || "Confirmed",
      createdAt: new Date().toISOString(),
      createdBy: "admin",
    });

    // Send confirmation email if email provided
    if (userEmail) {
      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
          <h2 style="color: #4CAF50; text-align: center;">Appointment Confirmed! 🎉</h2>
          <p>Dear Valued Client,</p>
          <p>Your appointment at Ruk's Glow House has been booked by our team.</p>
          <div style="background-color: #E8F5E9; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 5px 0;"><b>Service:</b> ${serviceName}</p>
            <p style="margin: 5px 0;"><b>Date:</b> ${date}</p>
            <p style="margin: 5px 0;"><b>Time:</b> ${time}</p>
          </div>
          <p>Please arrive 5 minutes early. We can't wait to see you!</p>
          <p>Best Regards,<br><b>Ruk's Glow House</b></p>
        </div>
      `;
      sendNotificationEmail(userEmail, "Appointment Confirmed - Ruksana's Parlour", emailHtml);
    }

    res.status(201).json({ success: true, data: { id: newDoc.id } });
  } catch (err) {
    next(err);
  }
});

router.delete("/appointments/:id", async (req, res, next) => {
  try {
    await db.collection("appointments").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// === CLIENTS DIRECTORY & LOYALTY ===
router.get("/clients", async (req, res, next) => {
  try {
    const snapshot = await db.collection("users").get();
    res.json({
      data: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (err) {
    next(err);
  }
});

router.put("/clients/:id/loyalty", async (req, res, next) => {
  try {
    await db
      .collection("users")
      .doc(req.params.id)
      .update({ loyaltyPoints: req.body.points });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/loyalty-settings", async (req, res, next) => {
  try {
    const doc = await db.collection("settings").doc("loyalty").get();
    if (!doc.exists) {
      return res.json({ data: null });
    }
    res.json({ data: doc.data() });
  } catch (err) {
    next(err);
  }
});

router.put("/loyalty-settings", async (req, res, next) => {
  try {
    await db
      .collection("settings")
      .doc("loyalty")
      .set(req.body, { merge: true });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// === OFFERS ===
router.get("/offers", async (req, res, next) => {
  try {
    const snapshot = await db.collection("offers").get();
    res.json({
      data: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/offers", async (req, res, next) => {
  try {
    const newDoc = await db
      .collection("offers")
      .add({ ...req.body, createdAt: new Date().toISOString() });
    res.status(201).json({ success: true, data: { id: newDoc.id } });
  } catch (err) {
    next(err);
  }
});

router.delete("/offers/:id", async (req, res, next) => {
  try {
    await db.collection("offers").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// === DASHBOARD STATS ===
router.get("/stats", async (req, res, next) => {
  try {
    const usersSnap = await db.collection("users").get();
    const appointmentsSnap = await db.collection("appointments").get();

    let totalLoyalty = 0;
    usersSnap.forEach((doc) => {
      totalLoyalty += doc.data().loyaltyPoints || 0;
    });
    const avgLoyaltyPoints =
      usersSnap.size > 0 ? Math.round(totalLoyalty / usersSnap.size) : 0;

    const today = new Date().toISOString().split("T")[0];
    let todaysAppointmentsCount = 0;
    appointmentsSnap.forEach((doc) => {
      const data = doc.data();
      if (data.date && data.date.startsWith(today)) todaysAppointmentsCount++;
    });

    res.json({
      data: {
        totalUsers: usersSnap.size,
        totalBookings: appointmentsSnap.size,
        avgLoyaltyPoints,
        todaysAppointmentsCount,
      },
    });
  } catch (err) {
    next(err);
  }
});

// === REVIEWS ===
router.get("/reviews", async (req, res, next) => {
  try {
    const snapshot = await db
      .collection("reviews")
      .orderBy("createdAt", "desc")
      .get();
    res.json({
      data: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (err) {
    next(err);
  }
});

router.put("/reviews/:id/approve", async (req, res, next) => {
  try {
    await db
      .collection("reviews")
      .doc(req.params.id)
      .update({ isApproved: req.body.isApproved });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/reviews/:id", async (req, res, next) => {
  try {
    await db.collection("reviews").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// === NOTIFICATIONS ===
router.post("/notifications/send", async (req, res, next) => {
  try {
    const { title, body, imageUrl, targetUserIds } = req.body;

    if (!title || !body) {
      return res.status(400).json({ success: false, message: "Title and body are required" });
    }

    let tokens = [];

    if (targetUserIds && targetUserIds.length > 0) {
      // Fetch tokens for specific users
      for (const uid of targetUserIds) {
        const userDoc = await db.collection("users").doc(uid).get();
        if (userDoc.exists && userDoc.data().fcmTokens) {
          tokens.push(...userDoc.data().fcmTokens);
        }
      }
    } else {
      // Fetch all tokens
      const usersSnap = await db.collection("users").get();
      usersSnap.forEach(doc => {
        const data = doc.data();
        if (data.fcmTokens && Array.isArray(data.fcmTokens)) {
          tokens.push(...data.fcmTokens);
        }
      });
    }

    // Deduplicate tokens
    tokens = [...new Set(tokens)];

    let successCount = 0;
    let failureCount = 0;

    if (tokens.length > 0) {
      const message = {
        notification: {
          title,
          body,
          ...(imageUrl && { imageUrl }),
        },
        tokens,
      };

      const response = await require("../config/firebase").admin.messaging().sendEachForMulticast(message);
      successCount = response.successCount;
      failureCount = response.failureCount;
    }

    // Save notification history
    const newDoc = await db.collection("notifications").add({
      title,
      body,
      imageUrl: imageUrl || null,
      targetUserIds: targetUserIds || [],
      successCount,
      failureCount,
      sentAt: new Date().toISOString(),
      createdBy: "admin",
    });

    res.json({
      success: true,
      data: { id: newDoc.id, successCount, failureCount, totalTargets: tokens.length },
    });
  } catch (err) {
    next(err);
  }
});

router.get("/notifications", async (req, res, next) => {
  try {
    const snapshot = await db
      .collection("notifications")
      .orderBy("sentAt", "desc")
      .get();
    res.json({
      data: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (err) {
    next(err);
  }
});

// === ADMIN FCM TOKEN ===
router.post("/fcm-token", async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ success: false, message: "Token is required" });
    }

    const adminRef = db.collection("settings").doc("adminTokens");
    await adminRef.set({
      fcmTokens: require("firebase-admin").firestore.FieldValue.arrayUnion(fcmToken)
    }, { merge: true });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// === EMAIL BLASTS ===
router.post("/emails/send", async (req, res, next) => {
  try {
    const { subject, body, imageUrl, buttonText, buttonUrl } = req.body;

    if (!subject || !body) {
      return res.status(400).json({ success: false, message: "Subject and body are required" });
    }

    // Fetch all users to get their emails
    const usersSnap = await db.collection("users").get();
    const targetEmails = [];
    usersSnap.forEach((doc) => {
      const data = doc.data();
      if (data.email) {
        targetEmails.push(data.email);
      }
    });

    // Deduplicate emails
    const uniqueEmails = [...new Set(targetEmails)];

    if (uniqueEmails.length === 0) {
      return res.status(400).json({ success: false, message: "No users with emails found" });
    }

    // Send emails in background
    let successCount = 0;
    let failureCount = 0;
    
    // Create HTML template with optional image and button
    const imageHtml = imageUrl ? `<div style="text-align: center; margin-bottom: 20px;"><img src="${imageUrl}" alt="Banner" style="max-width: 100%; border-radius: 8px;" /></div>` : '';
    const buttonHtml = (buttonText && buttonUrl) ? `
      <div style="text-align: center; margin: 30px 0;">
        <a href="${buttonUrl}" style="background-color: #FF1493; color: white; padding: 12px 24px; text-decoration: none; border-radius: 25px; font-weight: bold; font-size: 16px; display: inline-block;">
          ${buttonText}
        </a>
      </div>
    ` : '';

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #FF1493; text-align: center;">Ruk's Glow House</h2>
        ${imageHtml}
        <div style="margin: 20px 0; color: #333; line-height: 1.6;">
          ${body.replace(/\n/g, '<br>')}
        </div>
        ${buttonHtml}
        <p style="text-align: center; font-size: 12px; color: #888; margin-top: 30px; border-top: 1px solid #eee; padding-top: 10px;">
          You are receiving this email because you are a registered client at Ruk's Glow House.
        </p>
      </div>
    `;

    // Send emails (using Promise.all for parallelism, but limiting batch size could be good for huge lists)
    const emailPromises = uniqueEmails.map(async (email) => {
      const sent = await sendNotificationEmail(email, subject, emailHtml);
      if (sent) successCount++;
      else failureCount++;
    });

    // Wait for all to finish
    await Promise.allSettled(emailPromises);

    // Save blast history
    const newDoc = await db.collection("email_blasts").add({
      subject,
      body,
      successCount,
      failureCount,
      sentAt: new Date().toISOString(),
      createdBy: "admin",
    });

    res.json({
      success: true,
      data: { id: newDoc.id, successCount, failureCount, totalTargets: uniqueEmails.length },
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

