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
              <p>Hi <b>${appData.userName}</b>,</p>
              <p>Great news! Your booking at Ruksana's Beauty Parlour has been fully confirmed by our team.</p>
              <div style="background-color: #E8F5E9; padding: 15px; border-radius: 8px; margin: 20px 0;">
                <p style="margin: 5px 0;"><b>Service:</b> ${appData.serviceName || appData.service}</p>
                <p style="margin: 5px 0;"><b>Date:</b> ${appData.date}</p>
                <p style="margin: 5px 0;"><b>Time:</b> ${appData.time}</p>
              </div>
              <p>Please arrive 5 minutes early. We can't wait to see you!</p>
              <p>Best Regards,<br><b>Ruksana's Beauty Parlour</b></p>
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
              <p>Hi <b>${appData.userName}</b>,</p>
              <p>Unfortunately, your booking for <b>${appData.serviceName || appData.service}</b> on <b>${appData.date}</b> at <b>${appData.time}</b> has been cancelled.</p>
              <p>If you believe this was a mistake or need to reschedule, please visit our app or contact support.</p>
              <p>Best Regards,<br><b>Ruksana's Beauty Parlour</b></p>
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

module.exports = router;
