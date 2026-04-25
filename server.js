const express = require("express");
const cors = require("cors");
require("dotenv").config();
require("./config/firebase"); // Initialize Firebase

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
const adminRoutes = require("./routes/admin");
const clientRoutes = require("./routes/client");

app.use("/api/admin", adminRoutes);
app.use("/api/client", clientRoutes);

app.get("/", (req, res) => {
  res.send("Beauty Parlour API is running");
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: "Internal Server Error",
    error: err.message,
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
