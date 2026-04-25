const express = require("express");
const router = express.Router();
const { auth, db } = require("../config/firebase");
const { verifyToken } = require("../middleware/auth");

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

    res
      .status(201)
      .json({
        success: true,
        message: "Client registered successfully",
        uid: userRecord.uid,
      });
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

// === APPOINTMENTS (Only accesses their own data using token) ===
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
    const newDoc = await db.collection("appointments").add({
      userId: req.user.uid,
      ...req.body,
      status: "pending", // Starts out as pending
      createdAt: new Date().toISOString(),
    });
    res.status(201).json({ success: true, data: { id: newDoc.id } });
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

module.exports = router;
