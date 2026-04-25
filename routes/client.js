const express = require("express");
const router = express.Router();
const { auth, db } = require("../config/firebase");
const { verifyToken } = require("../middleware/auth");
const { sendNotificationEmail } = require("../utils/emailService");

// === AUTH ===
router.post("/signup", async (req, res, next) => {
  try {
    // No role parameter accepted
    const { email, password, displayName } = req.body;
    const userRecord = await auth.createUser({ email, password, displayName });

    await db
      .collection("users")
      .doc(userRecord.uid)
      .set({
        email: userRecord.email,
        displayName: userRecord.displayName || "",
        createdAt: new Date().toISOString(),
      });

    res.status(201).json({
      success: true,
      message: "Client registered successfully",
      uid: userRecord.uid,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/sync-user", verifyToken, async (req, res, next) => {
  try {
    const userRef = db.collection("users").doc(req.user.uid);
    const doc = await userRef.get();
    if (!doc.exists) {
      await userRef.set({
        email: req.user.email,
        displayName: req.body.displayName || req.user.name || "",
        createdAt: new Date().toISOString(),
        loyaltyPoints: 0,
      });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
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
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    const data = await response.json();
    if (!response.ok)
      return res
        .status(400)
        .json({ success: false, message: data.error?.message });

    res.json({ success: true, token: data.idToken, uid: data.localId });
  } catch (err) {
    next(err);
  }
});

// === SERVICES (Read-only for clients) ===
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

// === OFFERS (Read-only for clients) ===
router.get("/offers", async (req, res, next) => {
  try {
    const snapshot = await db.collection("offers").get();
    const now = new Date();
    const offers = snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((offer) => !offer.validTill || new Date(offer.validTill) >= now);
    res.json({ data: offers });
  } catch (err) {
    next(err);
  }
});

// === APPOINTMENTS (Only accesses their own data using token) ===
router.get("/available-slots", async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date)
      return res.status(400).json({ success: false, message: "Date required" });

    // Define standard operational business hours
    const allSlots = [
      "10:00 AM",
      "11:00 AM",
      "12:00 PM",
      "01:00 PM",
      "02:00 PM",
      "03:00 PM",
      "04:00 PM",
      "05:00 PM",
    ];

    // Find all active appointments for this date
    const snapshot = await db
      .collection("appointments")
      .where("date", "==", date)
      .get();

    const bookedTimeSlots = [];
    snapshot.forEach((doc) => {
      const app = doc.data();
      // Ignore cancelled or rejected bookings
      if (app.status !== "Cancelled" && app.status !== "Rejected") {
        bookedTimeSlots.push(app.time);
      }
    });

    const availableSlots = allSlots.filter(
      (slot) => !bookedTimeSlots.includes(slot),
    );
    res.json({ success: true, data: availableSlots });
  } catch (err) {
    next(err);
  }
});

router.get("/appointments", verifyToken, async (req, res, next) => {
  try {
    const snapshot = await db
      .collection("appointments")
      .where("userId", "==", req.user.uid)
      .get();
    res.json({
      data: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/appointments", verifyToken, async (req, res, next) => {
  try {
    // Look up the user's display name from Firestore
    let userName = req.body.userName || "";
    if (!userName) {
      const userDoc = await db.collection("users").doc(req.user.uid).get();
      if (userDoc.exists) {
        userName = userDoc.data().displayName || req.user.email || "Unknown";
      } else {
        userName = req.user.email || "Unknown";
      }
    }

    const newDoc = await db.collection("appointments").add({
      userId: req.user.uid,
      userName: userName,
      userEmail: req.body.userEmail || req.user.email,
      serviceId: req.body.serviceId,
      serviceName: req.body.serviceName,
      service: req.body.serviceName,
      date: req.body.date,
      time: req.body.time,
      status: "Pending",
      createdAt: new Date().toISOString(),
    });

    // Fire email asynchronously (dont block the response)
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #FF1493; text-align: center;">Booking Request Received!</h2>
        <p>Hi <b>${userName}</b>,</p>
        <p>Thank you for choosing Ruksana's Beauty Parlour. We have received your booking request for <b>${req.body.serviceName}</b>.</p>
        <div style="background-color: #fce4ec; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><b>Date:</b> ${req.body.date}</p>
          <p style="margin: 5px 0;"><b>Time:</b> ${req.body.time}</p>
          <p style="margin: 5px 0;"><b>Status:</b> Pending Admin Approval</p>
        </div>
        <p>Our team will review this and confirm your slot shortly. You will receive another email once it is approved.</p>
        <p>Best Regards,<br><b>Ruksana's Beauty Parlour</b></p>
      </div>
    `;
    sendNotificationEmail(
      req.body.userEmail || req.user.email,
      "Booking Request Received - Ruksana's Parlour",
      emailHtml,
    );

    res.status(201).json({ success: true, data: { id: newDoc.id } });
  } catch (err) {
    next(err);
  }
});

router.put(
  "/appointments/:id/reschedule",
  verifyToken,
  async (req, res, next) => {
    try {
      // Client requesting a reschedule
      const { date, time } = req.body;
      await db.collection("appointments").doc(req.params.id).update({
        date,
        time,
        status: "Reschedule pending admin approval",
        lastUpdated: new Date().toISOString(),
      });
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  },
);

router.put("/appointments/:id/status", verifyToken, async (req, res, next) => {
  try {
    const { status } = req.body;
    await db.collection("appointments").doc(req.params.id).update({
      status,
      lastUpdated: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// === LOYALTY POINTS & SETTINGS ===
router.get("/loyalty-settings", async (req, res, next) => {
  try {
    const doc = await db.collection("settings").doc("loyalty").get();
    if (doc.exists) {
      res.json({ success: true, data: doc.data() });
    } else {
      // Default fallback settings if none configured by admin
      res.json({
        success: true,
        data: {
          tiers: {
            member: {
              name: "Member",
              maxPoints: 50,
              perk: "Basic Member Benefits",
            },
            silver: {
              name: "Silver Client",
              maxPoints: 100,
              perk: "5% off all services",
            },
            gold: {
              name: "Gold Client",
              maxPoints: Infinity,
              perk: "10% off and Priority Booking",
            },
          },
        },
      });
    }
  } catch (err) {
    next(err);
  }
});
router.get("/loyalty", verifyToken, async (req, res, next) => {
  try {
    const userDoc = await db.collection("users").doc(req.user.uid).get();
    if (userDoc.exists) {
      res.json({
        success: true,
        data: { loyaltyPoints: userDoc.data().loyaltyPoints || 0 },
      });
    } else {
      res.json({ success: true, data: { loyaltyPoints: 0 } });
    }
  } catch (err) {
    next(err);
  }
});

router.delete("/appointments/:id", verifyToken, async (req, res, next) => {
  try {
    await db.collection("appointments").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// === REVIEWS ===
router.get("/reviews", async (req, res, next) => {
  try {
    // Only return approved reviews to the public frontend
    const snapshot = await db
      .collection("reviews")
      .where("isApproved", "==", true)
      .get();
    res.json({
      data: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    });
  } catch (err) {
    next(err);
  }
});

router.post("/appointments/:id/review", verifyToken, async (req, res, next) => {
  try {
    const { rating, comment } = req.body;

    // 1. Verify the appointment belongs to user and is Completed
    const appRef = db.collection("appointments").doc(req.params.id);
    const appDoc = await appRef.get();

    if (!appDoc.exists || appDoc.data().userId !== req.user.uid) {
      return res
        .status(404)
        .json({ success: false, message: "Appointment not found" });
    }

    if (appDoc.data().hasReviewed) {
      return res
        .status(400)
        .json({ success: false, message: "Appointment already reviewed" });
    }

    // 2. Create the review
    const reviewData = {
      appointmentId: req.params.id,
      userId: req.user.uid,
      userName: appDoc.data().userName,
      serviceName: appDoc.data().serviceName || appDoc.data().service,
      rating: parseFloat(rating) || 5,
      comment: comment || "",
      isApproved: false, // Require Admin approval
      createdAt: new Date().toISOString(),
    };

    await db.collection("reviews").add(reviewData);

    // 3. Mark appointment as reviewed
    await appRef.update({ hasReviewed: true });

    res.json({ success: true, message: "Review submitted successfully" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
