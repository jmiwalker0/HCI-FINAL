const express = require("express");
const cors = require("cors");
const path = require("path");

// Load .env by absolute path so it works no matter which folder the
// server is started from (e.g. Ledger/ via concurrently, or Ledger/backend/).
// backend/.env wins; Ledger/.env is a fallback. dotenv never overwrites
// a variable that is already set.
require("dotenv").config({ path: path.join(__dirname, ".env") });
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

console.log(
    "[env] SUPABASE_URL:", process.env.SUPABASE_URL ? "set" : "MISSING",
    "| SUPABASE_SERVICE_ROLE_KEY:",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "MISSING"
);

const app = express();

app.use(cors());

// Receipts are uploaded as base64 data URLs (up to 4 MB files),
// so the default 100 kb JSON limit is too small.
app.use(express.json({ limit: "8mb" }));

const db = require("./db");


/* =====================================
   API ROUTES
   ===================================== */

// AUTHENTICATION
const authRoutes = require("./routes/auth");
app.use("/api/auth", authRoutes);


// TRANSACTIONS
const transactionRoutes = require("./routes/transactions");
app.use("/api/transactions", transactionRoutes);


// JOURNAL ENTRIES
const journalEntryRoutes = require("./routes/journalEntries");
app.use("/api/journal-entries", journalEntryRoutes);

// CHART OF ACCOUNTS
const accountRoutes = require("./routes/accounts");
app.use("/api/accounts", accountRoutes);

// RECEIPTS
const receiptRoutes = require("./routes/receipts");
app.use("/api/receipts", receiptRoutes);

/* =====================================
   POSTGRESQL CONNECTION TEST
   ===================================== */

app.get("/api/test", async (req, res) => {
    try {
        const result = await db.query(
            "SELECT current_database(), NOW()"
        );

        res.json({
            message: "Ledger API is connected!",
            database: result.rows[0].current_database,
            time: result.rows[0].now
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            error: error.message
        });
    }
});


/* =====================================
   HOME ROUTE
   ===================================== */

app.get("/", (req, res) => {
    res.send("Ledger Backend is running!");
});


/* =====================================
   START SERVER
   ===================================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Ledger server running on port ${PORT}`);
});