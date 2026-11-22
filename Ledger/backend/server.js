const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

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