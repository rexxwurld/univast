require("dotenv").config();

// dotenv must run before app.js is required — app.js checks JWT_SECRET at
// require-time, and connectDB() below reads MONGODB_URI.
const app = require("./app");
const connectDB = require("./config/database");

const PORT = process.env.PORT || 5000;

connectDB();

app.listen(PORT, "0.0.0.0", () => {
  console.log(`UNIVAST API running on http://localhost:${PORT}`);
});
