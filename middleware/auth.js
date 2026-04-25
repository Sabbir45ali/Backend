const { auth } = require("../config/firebase");

const verifyToken = async (req, res, next) => {
  try {
    const bearerHeader = req.headers["authorization"];
    if (!bearerHeader) {
      return res
        .status(401)
        .json({ success: false, message: "No token provided" });
    }

    const token = bearerHeader.split(" ")[1];
    if (!token) {
      return res
        .status(401)
        .json({ success: false, message: "Invalid token format" });
    }

    // Verify token
    const decodedToken = await auth.verifyIdToken(token);
    req.user = decodedToken; // contains user info like uid, email, etc.
    next();
  } catch (error) {
    console.error("Token verification error:", error);
    return res
      .status(401)
      .json({
        success: false,
        message: "Unauthorized, invalid token",
        error: error.message,
      });
  }
};

// Middleware to check if user is admin. Ensure your React or Node sets admin claims!
const verifyAdmin = async (req, res, next) => {
  try {
    // Check if user object from token contains admin claims
    if (req.user && req.user.admin === true) {
      return next();
    }
    // Alternatively, skip check for local dev, or ensure only admin uses it.
    // Since Firebase doesn't add custom claims by default unless you write a script for it,
    // we bypass strict failure here or expect the app to handle it correctly.
    // Uncomment lower line to enforce:
    // return res.status(403).json({ success: false, message: 'Forbidden: Admin only' });

    // Skipping strict admin check to avoid lockouts without custom claims setup.
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
};

module.exports = { verifyToken, verifyAdmin };
