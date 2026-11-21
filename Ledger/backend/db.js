const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10
});

pool.connect()
    .then(client => {
        console.log("Connected to Ledger Supabase database!");
        client.release();
    })
    .catch(error => {
        console.error("Database connection failed:", error.message);
    });

module.exports = pool;