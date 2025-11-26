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

const adminEmails = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const isAdmin = (email) =>
  !!email && adminEmails.includes(String(email).trim().toLowerCase());

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
const footprintSchema = new mongoose.Schema(
  {
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
  },
  { timestamps: true }
);
const Footprint = mongoose.model("Footprint", footprintSchema);

// ✅ Wallet and transaction schemas for carbon credits
const walletSchema = new mongoose.Schema({
  user: { type: String, unique: true, required: true },
  credits: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now },
});
const Wallet = mongoose.model("Wallet", walletSchema);

const creditTransactionSchema = new mongoose.Schema({
  user: { type: String, required: true },
  amount: { type: Number, required: true },
  type: { type: String, enum: ["earn", "bonus"], required: true },
  reason: { type: String, required: true },
  date: { type: Date, default: Date.now },
});
const CreditTransaction = mongoose.model(
  "CreditTransaction",
  creditTransactionSchema
);

// ✅ Shared carbon + credit helpers
const VEHICLE_EMISSIONS = {
  "car-petrol": 0.171,
  "car-diesel": 0.168,
  "car-electric": 0.053,
  motorcycle: 0.103,
  "public-transport": 0.041,
  bicycle: 0,
};

const DIET_EMISSIONS = {
  "meat-heavy": 7.19,
  "meat-moderate": 5.63,
  pescatarian: 3.91,
  vegetarian: 3.81,
  vegan: 2.89,
};

const ELECTRICITY_FACTOR = 0.475;
const GAS_FACTOR = 2.0;

const deriveEmissions = (payload = {}) => {
  const travel =
    (VEHICLE_EMISSIONS[payload.vehicle_type] || 0) *
    (payload.distance_daily || 0);
  const food = DIET_EMISSIONS[payload.diet_type] || 0;
  const dailyElectricity = (payload.electricity_usage || 0) / 30;
  const dailyGas = (payload.gas_usage || 0) / 30;
  const energy = dailyElectricity * ELECTRICITY_FACTOR + dailyGas * GAS_FACTOR;

  const total = travel + food + energy;
  return { travel, food, energy, total };
};

const ensureWallet = async (user) => {
  if (!user) throw new Error("User email is required for wallet operations.");
  let wallet = await Wallet.findOne({ user });
  if (!wallet) {
    wallet = await Wallet.create({ user, credits: 0 });
  }
  return wallet;
};

const baseCreditsForScore = (score) => {
  if (score < 10) return 5;
  if (score <= 20) return 3;
  return 1;
};

const getPreviousScore = async (user, currentDate) => {
  const prev = await Footprint.findOne({
    user,
    date: { $lt: currentDate },
  })
    .sort({ date: -1 })
    .lean();

  return typeof prev?.total_score === "number" ? prev.total_score : null;
};

const formatScore = (value) =>
  typeof value === "number" ? value.toFixed(1) : "n/a";

const awardCreditsForFootprint = async ({ user, score, footprintDate }) => {
  const numericScore = Number(score);
  if (!user || Number.isNaN(numericScore)) {
    throw new Error("Valid user and score are required to award credits.");
  }

  const dateLabel = footprintDate || new Date().toISOString().split("T")[0];
  const baseCredits = baseCreditsForScore(numericScore);
  const previousScore = await getPreviousScore(user, dateLabel);
  const bonusCredits =
    previousScore !== null && numericScore < previousScore ? 2 : 0;

  const now = new Date();
  const transactionsToPersist = [
    {
      user,
      amount: baseCredits,
      type: "earn",
      reason: `Daily footprint (${dateLabel}) score ${numericScore.toFixed(1)}`,
      date: now,
    },
  ];

  if (bonusCredits > 0) {
    transactionsToPersist.push({
      user,
      amount: bonusCredits,
      type: "bonus",
      reason: `Improved score vs previous day (${formatScore(previousScore)})`,
      date: now,
    });
  }

  const transactions = await CreditTransaction.insertMany(
    transactionsToPersist
  );

  const wallet = await ensureWallet(user);
  wallet.credits += baseCredits + bonusCredits;
  wallet.lastUpdated = now;
  await wallet.save();

  return {
    baseCredits,
    bonusCredits,
    totalAwarded: baseCredits + bonusCredits,
    wallet,
    transactions,
  };
};

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

// ✅ Create a new footprint entry + auto-award credits
app.post("/api/footprints", async (req, res) => {
  try {
    const body = { ...req.body };
    if (!body.user) {
      return res.status(400).json({ message: "User email is required" });
    }
    if (!body.date) {
      body.date = new Date().toISOString().split("T")[0];
    }

    const alreadySubmitted = await Footprint.findOne({
      user: body.user,
      date: body.date,
    });
    if (alreadySubmitted) {
      return res.status(409).json({
        message: "You already submitted a footprint for this date.",
      });
    }

    // backfill emissions if missing
    const {
      travel,
      food,
      energy,
      total: calculatedTotal,
    } = deriveEmissions(body);

    if (typeof body.travel_emissions !== "number") {
      body.travel_emissions = Number(travel.toFixed(2));
    }
    if (typeof body.food_emissions !== "number") {
      body.food_emissions = Number(food.toFixed(2));
    }
    if (typeof body.energy_emissions !== "number") {
      body.energy_emissions = Number(energy.toFixed(2));
    }
    if (typeof body.total_score !== "number") {
      body.total_score = Number(calculatedTotal.toFixed(2));
    }

    const entry = new Footprint(body);
    await entry.save();

    let creditSummary = null;
    if (body.user && typeof body.total_score === "number") {
      creditSummary = await awardCreditsForFootprint({
        user: body.user,
        score: body.total_score,
        footprintDate: body.date,
      });
    }

    res.json({
      message: "Footprint saved successfully",
      credits: creditSummary,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error saving footprint", error: error.message });
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

// ✅ Update a footprint entry
app.put("/api/footprints/:id", async (req, res) => {
  try {
    const updates = { ...req.body };
    const emissions = deriveEmissions(updates);

    if (Number.isFinite(emissions.travel)) {
      updates.travel_emissions = Number(emissions.travel.toFixed(2));
    }
    if (Number.isFinite(emissions.food)) {
      updates.food_emissions = Number(emissions.food.toFixed(2));
    }
    if (Number.isFinite(emissions.energy)) {
      updates.energy_emissions = Number(emissions.energy.toFixed(2));
    }
    if (Number.isFinite(emissions.total)) {
      updates.total_score = Number(emissions.total.toFixed(2));
    }

    const updated = await Footprint.findByIdAndUpdate(
      req.params.id,
      updates,
      {
        new: true,
      }
    );
    if (!updated) {
      return res.status(404).json({ message: "Footprint not found" });
    }
    res.json({ message: "Footprint updated", entry: updated });
  } catch (error) {
    res.status(500).json({ message: "Error updating footprint" });
  }
});

// ✅ Manual credit award endpoint
app.post("/api/credits/earn", async (req, res) => {
  try {
    const { user, score, date } = req.body;
    if (!user || typeof score !== "number") {
      return res
        .status(400)
        .json({ message: "User email and numeric score are required" });
    }

    const creditSummary = await awardCreditsForFootprint({
      user,
      score,
      footprintDate: date,
    });

    res.json(creditSummary);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to award credits", error: error.message });
  }
});

// ✅ Wallet lookup
app.get("/api/credits/wallet/:user", async (req, res) => {
  try {
    const user = req.params.user;
    const wallet = await ensureWallet(user);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayTransactions = await CreditTransaction.find({
      user,
      date: { $gte: today, $lt: tomorrow },
    });
    const recentTransactions = await CreditTransaction.find({ user })
      .sort({ date: -1 })
      .limit(10);

    const todayCredits = todayTransactions.reduce(
      (sum, txn) => sum + txn.amount,
      0
    );

    res.json({
      wallet,
      todayCredits,
      recentTransactions,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch wallet data" });
  }
});

// ✅ Transaction history for a user
app.get("/api/credits/transactions/:user", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 25;
    const transactions = await CreditTransaction.find({
      user: req.params.user,
    })
      .sort({ date: -1 })
      .limit(limit);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});

// ✅ Admin summary endpoint
app.get("/api/admin/credits", async (req, res) => {
  const requester = req.headers["x-admin-user"];
  if (!isAdmin(requester)) {
    return res.status(403).json({ message: "Admin access required" });
  }

  try {
    const wallets = await Wallet.find({});
    const averages = await Footprint.aggregate([
      {
        $group: {
          _id: "$user",
          averageScore: { $avg: "$total_score" },
          entries: { $sum: 1 },
        },
      },
    ]);

    const averageMap = averages.reduce((map, entry) => {
      map[entry._id] = entry;
      return map;
    }, {});

    const userSet = new Set([
      ...wallets.map((w) => w.user),
      ...averages.map((a) => a._id),
    ]);

    const employees = Array.from(userSet).map((user) => {
      const wallet = wallets.find((w) => w.user === user);
      const avg = averageMap[user];
      return {
        user,
        credits: wallet?.credits || 0,
        lastUpdated: wallet?.lastUpdated || null,
        averageScore: avg?.averageScore || null,
        entries: avg?.entries || 0,
      };
    });

    const ranking = [...employees]
      .sort((a, b) => b.credits - a.credits)
      .map((employee, index) => ({
        ...employee,
        rank: index + 1,
      }));

    const totalCredits = employees.reduce((sum, emp) => sum + emp.credits, 0);
    const organizationAverage = averages.length
      ? averages.reduce((sum, item) => sum + (item.averageScore || 0), 0) /
      averages.length
      : 0;

    res.json({
      totalEmployees: employees.length,
      totalCredits,
      organizationAverage,
      employees,
      ranking,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch admin summary" });
  }
});


// ✅ Start server
const port = process.env.PORT || 5000;
app.listen(port, () =>
  console.log(`🚀 Server running at http://localhost:${port}`)
);
