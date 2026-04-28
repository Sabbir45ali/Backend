const express = require("express");
const router = express.Router();
const { auth, db } = require("../config/firebase");
const { verifyToken } = require("../middleware/auth");
const { sendNotificationEmail } = require("../utils/emailService");

const normalizePhone = (value) =>
  String(value || "")
    .replace(/[\s()-]/g, "")
    .trim();
const isValidPhone = (value) => /^\+?[0-9]{10,15}$/.test(normalizePhone(value));

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

    // Only include fields that are explicitly provided in the request
    // This prevents wiping out existing data (like phone) when logging in with Google
    const updates = {
      email: req.user.email,
      updatedAt: new Date().toISOString(),
    };

    if (req.body.displayName) updates.displayName = req.body.displayName;
    if (req.body.phone) updates.phone = normalizePhone(req.body.phone);
    if (req.body.age) updates.age = req.body.age;
    if (req.body.gender) updates.gender = req.body.gender;
    if (req.body.photoURL) updates.photoURL = req.body.photoURL;

    if (!doc.exists) {
      // For new users, ensure we write default empty values for missing fields
      await userRef.set({
        ...updates,
        displayName: updates.displayName || req.user.name || "",
        phone: updates.phone || "",
        age: updates.age || "",
        gender: updates.gender || "",
        photoURL: updates.photoURL || "",
        createdAt: new Date().toISOString(),
        loyaltyPoints: 0,
      });
    } else {
      // For existing users, only update the fields that were provided
      await userRef.set(updates, { merge: true });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/profile", verifyToken, async (req, res, next) => {
  try {
    const userDoc = await db.collection("users").doc(req.user.uid).get();
    if (!userDoc.exists) {
      return res.json({
        success: true,
        data: {
          email: req.user.email || "",
          displayName: req.user.name || "",
          phone: "",
          age: "",
          gender: "",
          photoURL: "",
        },
      });
    }
    return res.json({ success: true, data: userDoc.data() });
  } catch (err) {
    next(err);
  }
});

router.put("/profile", verifyToken, async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone);
    if (!phone) {
      return res
        .status(400)
        .json({ success: false, message: "Phone number is required" });
    }
    if (!isValidPhone(phone)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid phone format" });
    }

    await db
      .collection("users")
      .doc(req.user.uid)
      .set(
        {
          displayName: req.body.displayName || "",
          email: req.body.email || req.user.email || "",
          phone,
          age: req.body.age || "",
          gender: req.body.gender || "",
          photoURL: req.body.photoURL || "",
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/fcm-token", verifyToken, async (req, res, next) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res
        .status(400)
        .json({ success: false, message: "Token is required" });
    }

    const userRef = db.collection("users").doc(req.user.uid);
    // Use arrayUnion to prevent duplicates
    await userRef.set(
      {
        fcmTokens:
          require("firebase-admin").firestore.FieldValue.arrayUnion(fcmToken),
      },
      { merge: true },
    );

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
    let userPhone = normalizePhone(req.body.userPhone);
    if (!userName) {
      const userDoc = await db.collection("users").doc(req.user.uid).get();
      if (userDoc.exists) {
        userName = userDoc.data().displayName || req.user.email || "Unknown";
        userPhone = userPhone || normalizePhone(userDoc.data().phone);
      } else {
        userName = req.user.email || "Unknown";
      }
    }

    if (!userPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required before booking",
      });
    }
    if (!isValidPhone(userPhone)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format",
      });
    }

    const newDoc = await db.collection("appointments").add({
      userId: req.user.uid,
      userName: userName,
      userEmail: req.body.userEmail || req.user.email,
      userPhone,
      serviceId: req.body.serviceId,
      serviceName: req.body.serviceName,
      service: req.body.serviceName,
      date: req.body.date,
      time: req.body.time,
      status: "Pending",
      createdAt: new Date().toISOString(),
    });

    // Fire email to client asynchronously
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #FF1493; text-align: center;">Booking Request Received!</h2>
        <p>Dear Valued Client,</p>
        <p>Thank you for choosing Ruk's Glow House. We have received your booking request for <b>${req.body.serviceName}</b>.</p>
        <div style="background-color: #fce4ec; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><b>Date:</b> ${req.body.date}</p>
          <p style="margin: 5px 0;"><b>Time:</b> ${req.body.time}</p>
          <p style="margin: 5px 0;"><b>Status:</b> Pending Admin Approval</p>
        </div>
        <p>Our team will review this and confirm your slot shortly. You will receive another email once it is approved.</p>
        <p>Best Regards,<br><b>Ruk's Glow House</b></p>
      </div>
    `;
    sendNotificationEmail(
      req.body.userEmail || req.user.email,
      "Booking Request Received - Ruk's Glow House",
      emailHtml,
    );

    // Fire email to admin asynchronously
    const adminEmailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #4CAF50; text-align: center;">New Booking Received! 📅</h2>
        <p>A new booking request has been submitted.</p>
        <div style="background-color: #E8F5E9; padding: 15px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 5px 0;"><b>Client:</b> ${userName} (${userPhone})</p>
          <p style="margin: 5px 0;"><b>Service:</b> ${req.body.serviceName}</p>
          <p style="margin: 5px 0;"><b>Date:</b> ${req.body.date}</p>
          <p style="margin: 5px 0;"><b>Time:</b> ${req.body.time}</p>
        </div>
        <p>Please log in to the admin panel to approve or reject this booking.</p>
      </div>
    `;
    sendNotificationEmail(
      "ruksglowhouse@gmail.com",
      "New Booking Alert - Ruk's Glow House",
      adminEmailHtml,
    );

    // Fire Push Notification to Admin asynchronously
    (async () => {
      try {
        const adminSettings = await db
          .collection("settings")
          .doc("adminTokens")
          .get();
        if (
          adminSettings.exists &&
          adminSettings.data().fcmTokens?.length > 0
        ) {
          const message = {
            notification: {
              title: "New Booking Received!",
              body: `${userName} booked ${req.body.serviceName} on ${req.body.date} at ${req.body.time}`,
            },
            tokens: adminSettings.data().fcmTokens,
          };
          await require("../config/firebase")
            .admin.messaging()
            .sendEachForMulticast(message);
        }
      } catch (pushErr) {
        console.error("Failed to push notify admin:", pushErr);
      }
    })();

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
