require("dotenv").config();

const express = require("express");
const cors = require("cors");

const connectDB = require("./config/database");
const notFound = require("./middleware/notFound");
const errorHandler = require("./middleware/errorHandler");

const universityRoutes = require("./routes/universities");
const campusRoutes = require("./routes/campuses");
const locationRoutes = require("./routes/location");
const navigationNodeRoutes = require("./routes/navigationNodes");
const navigationEdgeRoutes = require("./routes/navigationEdges");
const navigationEngineRoutes = require("./routes/navigation");

const app = express();
const PORT = process.env.PORT || 5000;

connectDB();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "UNIVAST API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "API is healthy" });
});

app.use("/api/universities", universityRoutes);
app.use("/api/campuses", campusRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/navigation", navigationNodeRoutes);
app.use("/api/navigation-edges", navigationEdgeRoutes);
app.use("/api/routes", navigationEngineRoutes);

// Must be registered last: 404 catch-all, then centralized error handler.
app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`UNIVAST API running on http://localhost:${PORT}`);
});
