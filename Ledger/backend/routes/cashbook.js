// LARP cash-book routes: save a transaction together with who it was with and
// how much has been paid, and record later payments on the unpaid balance.
// Mount in server.js:  app.use("/api/cashbook", require("./routes/cashbook"));

const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");
const { userIdOf } = require("../lib/ledgerHelpers");

const router = express.Router();
router.use(authenticate);

const TYPES = ["purchase", "sale", "service_income", "expense", "investment", "withdrawal"];
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(v));
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// All payment details for the signed-in user.
router.get("/", async (req, res) => {
    try {
        const userId = userIdOf(req);

        const details = await db.query(
            `SELECT transaction_id, party_name, initial_paid::float8 AS initial_paid
             FROM transaction_details WHERE user_id = $1`, [userId]);

        const payments = await db.query(
            `SELECT id, transaction_id, paid_on::text AS paid_on, amount::float8 AS amount
             FROM transaction_payments WHERE user_id = $1
             ORDER BY paid_on, created_at`, [userId]);

        res.json({ details: details.rows, payments: payments.rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not load payment details." });
    }
});

// Save a transaction + details in one step.
router.post("/", async (req, res) => {

    const userId = userIdOf(req);
    const b = req.body || {};

    const amount = round2(b.amount);
    const paid = round2(b.paid_amount || 0);
    const description = String(b.description || "").trim() || String(b.category || "").trim();
    const party = String(b.party_name || "").trim().slice(0, 150) || null;

    if (!isDate(b.date)) return res.status(400).json({ error: "Enter a valid date." });
    if (!TYPES.includes(b.type)) return res.status(400).json({ error: "Unknown transaction type." });
    if (!b.category) return res.status(400).json({ error: "Choose a category." });
    if (!(amount > 0)) return res.status(400).json({ error: "Amount must be greater than zero." });
    if (!(paid >= 0) || paid > amount) {
        return res.status(400).json({ error: "Amount paid must be between 0 and the total." });
    }
    if (!description) return res.status(400).json({ error: "Add a description." });

    const client = await db.connect();

    try {
        await client.query("BEGIN");

        const t = await client.query(
            `INSERT INTO transactions
               (user_id, transaction_date, description, category, type, amount, status)
             VALUES ($1, $2, $3, $4, $5, $6, 'approved')
             RETURNING id, transaction_date::text AS transaction_date, description,
                       category, type, amount::float8 AS amount, status`,
            [userId, b.date, description.slice(0, 500), String(b.category).slice(0, 100), b.type, amount]
        );

        await client.query(
            `INSERT INTO transaction_details (transaction_id, user_id, party_name, initial_paid)
             VALUES ($1, $2, $3, $4)`,
            [t.rows[0].id, userId, party, paid]
        );

        await client.query("COMMIT");
        res.status(201).json({ transaction: t.rows[0] });

    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(e);
        res.status(e.status || 500).json({ error: e.message || "Could not save the transaction." });
    } finally {
        client.release();
    }
});

// Record a payment toward the unpaid balance.
router.post("/:id/payments", async (req, res) => {

    const userId = userIdOf(req);
    const amount = round2(req.body?.amount);
    const paidOn = req.body?.paid_on;

    if (!isDate(paidOn)) return res.status(400).json({ error: "Enter a valid date." });
    if (!(amount > 0)) return res.status(400).json({ error: "Amount must be greater than zero." });

    const client = await db.connect();

    try {
        await client.query("BEGIN");

        // Lock the transaction so two payments cannot overpay it.
        const t = await client.query(
            `SELECT t.amount::float8 AS amount, t.transaction_date::text AS d,
                    COALESCE(d.initial_paid, t.amount)::float8 AS initial_paid
             FROM transactions t
             LEFT JOIN transaction_details d ON d.transaction_id = t.id
             WHERE t.id = $1 AND t.user_id = $2 FOR UPDATE OF t`,
            [req.params.id, userId]
        );

        if (!t.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Transaction not found." });
        }

        const prior = await client.query(
            "SELECT COALESCE(SUM(amount),0)::float8 AS s FROM transaction_payments WHERE transaction_id = $1",
            [req.params.id]
        );

        const balance = round2(t.rows[0].amount - t.rows[0].initial_paid - prior.rows[0].s);

        if (amount > balance + 0.004) {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: `Only ${balance.toFixed(2)} is still unpaid.` });
        }

        if (paidOn < t.rows[0].d) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "A payment cannot be dated before the transaction." });
        }

        const p = await client.query(
            `INSERT INTO transaction_payments (transaction_id, user_id, paid_on, amount)
             VALUES ($1, $2, $3, $4)
             RETURNING id, transaction_id, paid_on::text AS paid_on, amount::float8 AS amount`,
            [req.params.id, userId, paidOn, amount]
        );

        await client.query("COMMIT");
        res.status(201).json({ payment: p.rows[0] });

    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(e);
        res.status(500).json({ error: "Could not record the payment." });
    } finally {
        client.release();
    }
});

router.delete("/payments/:id", async (req, res) => {
    try {
        const r = await db.query(
            "DELETE FROM transaction_payments WHERE id = $1 AND user_id = $2",
            [req.params.id, userIdOf(req)]
        );
        if (!r.rowCount) return res.status(404).json({ error: "Payment not found." });
        res.json({ ok: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not delete the payment." });
    }
});

// Permanently delete ALL of the user's transactions and everything attached
// to them (payments, journal entries, receipts, inventory movements).
// Guarded: the exact phrase must be sent, and the count must match what the
// server holds right now, so a stale screen can never wipe newer records.
router.post("/clear", async (req, res) => {

    const userId = userIdOf(req);

    if (req.body?.phrase !== "DELETE ALL") {
        return res.status(400).json({ error: "Type DELETE ALL exactly to confirm." });
    }

    const client = await db.connect();

    try {
        await client.query("BEGIN");

        // Lock the rows first, then count what is really there.
        const locked = await client.query(
            "SELECT id FROM transactions WHERE user_id = $1 FOR UPDATE",
            [userId]
        );

        const count = { rows: [{ n: locked.rowCount }] };

        if (Number(req.body.expected_count) !== count.rows[0].n) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                error: `You now have ${count.rows[0].n} transactions, not ${Number(req.body.expected_count) || 0}. Refresh the page and try again.`
            });
        }

        const mine = "(SELECT id FROM transactions WHERE user_id = $1)";

        await client.query(
            `DELETE FROM journal_lines WHERE journal_entry_id IN
               (SELECT id FROM journal_entries WHERE transaction_id IN ${mine})`, [userId]);
        await client.query(`DELETE FROM journal_entries WHERE transaction_id IN ${mine}`, [userId]);
        await client.query(`DELETE FROM receipts WHERE transaction_id IN ${mine}`, [userId]);
        await client.query(`DELETE FROM inventory_movements WHERE transaction_id IN ${mine}`, [userId]);
        await client.query("DELETE FROM transactions WHERE user_id = $1", [userId]);

        await client.query("COMMIT");
        res.json({ deleted: count.rows[0].n });

    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(e);
        res.status(500).json({
            error: "Nothing was deleted. " + (e.message || "The server could not clear the transactions.")
        });
    } finally {
        client.release();
    }
});

module.exports = router;