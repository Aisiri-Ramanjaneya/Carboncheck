// ✅ Full Express + MongoDB backend for CarbonCheck
// Run with: node server.js
// Requires: npm install express mongoose dotenv bcryptjs cors

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();
app.use(express.json());

// ✅ Enable CORS for frontend at localhost:8081
app.use(
  cors({
    origin: "http://localhost:8081", // your React app
    credentials: true,
  })
);

// ✅ MongoDB connection
const mongodbURI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/planet-buddy";
mongoose
  .connect(mongodbURI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ Connected to MongoDB:", mongodbURI))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ✅ User schema and model
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true },
  password: String,
});
const User = mongoose.model("User", userSchema);

// ✅ Footprint schema and model
const footprintSchema = new mongoose.Schema({
  user: String,
  date: String,
  vehicle_type: String,
  distance_daily: Number,
  diet_type: String,
  electricity_usage: Number,
  gas_usage: Number,
  total_score: Number,
  travel_emissions: Number,
  food_emissions: Number,
  energy_emissions: Number,
});
const Footprint = mongoose.model("Footprint", footprintSchema);

// ✅ Health check
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

// ✅ Signup route
app.post("/api/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Email and password required" });

  try {
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const newUser = new User({ email, password: hashed });
    await newUser.save();

    res.json({ message: "Signup successful", user: { email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

// ✅ Signin route
app.post("/api/signin", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ message: "Email and password required" });

  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ message: "User not found" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ message: "Invalid credentials" });

  res.json({ message: "Signin successful", user: { email } });
});

// ✅ Signout (simple placeholder)
app.post("/api/signout", (req, res) => {
  res.json({ message: "Signed out" });
});

// ✅ Create a new footprint entry
app.post("/api/footprints", async (req, res) => {
  try {
    const entry = new Footprint(req.body);
    await entry.save();
    res.json({ message: "Footprint saved successfully" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error saving footprint" });
  }
});

// ✅ Get footprints (filtered by user)
app.get("/api/footprints", async (req, res) => {
  try {
    const { user } = req.query;
    const data = user
      ? await Footprint.find({ user })
      : await Footprint.find({});
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error fetching footprints" });
  }
});

// ✅ Delete a footprint (optional)
app.delete("/api/footprints/:id", async (req, res) => {
  try {
    await Footprint.findByIdAndDelete(req.params.id);
    res.json({ message: "Footprint deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting footprint" });
  }
});

// ✅ Start server
const port = process.env.PORT || 5000;
app.listen(port, () =>
  console.log(`🚀 Server running at http://localhost:${port}`)
);
