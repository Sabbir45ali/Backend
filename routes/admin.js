const express = require("express");
const router = express.Router();
const { auth, db } = require("../config/firebase");
const { verifyToken } = require("../middleware/auth");

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

// === CLIENTS DIRECTORY ===
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

module.exports = router;
