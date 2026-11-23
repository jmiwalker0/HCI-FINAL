// Financial statement support: how accounts are grouped (current / non-current,
// operating / other) and frozen copies of statements for each period.

const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");
const { audit } = require("../lib/audit");
const { userIdOf } = require("../lib/ledgerHelpers");

const router = express.Router();
router.use(authenticate);

const CLASSES = ["current", "non_current", "operating", "other"];
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(v));

// ---- account classification overrides ---------------------------------

router.get("/classes", async (req, res) => {
    try {
        const r = await db.query(
            "SELECT account_name, class FROM account_classes WHERE user_id = $1 ORDER BY account_name",
            [userIdOf(req)]
        );
        res.json({ classes: r.rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not load account groups." });
    }
});

// body: { classes: [{ account_name, class }] }  (class null/"" clears the override)
router.put("/classes", async (req, res) => {

    const userId = userIdOf(req);
    const list = Array.isArray(req.body.classes) ? req.body.classes : null;

    if (!list) return res.status(400).json({ error: "classes must be a list." });

    const client = await db.connect();

    try {
        await client.query("BEGIN");

        for (const item of list) {

            const name = String(item.account_name || "").trim();
            if (!name) throw Object.assign(new Error("Account name is required."), { status: 400 });

            const exists = await client.query(
                "SELECT 1 FROM accounts WHERE lower(account_name) = lower($1) AND (user_id = $2 OR user_id IS NULL)",
                [name, userId]
            );
            if (!exists.rowCount) {
                throw Object.assign(new Error(`"${name}" is not in your chart of accounts.`), { status: 400 });
            }

            if (!item.class) {
                await client.query(
                    "DELETE FROM account_classes WHERE user_id = $1 AND lower(account_name) = lower($2)",
                    [userId, name]
                );
                continue;
            }

            if (!CLASSES.includes(item.class)) {
                throw Object.assign(new Error("Unknown group."), { status: 400 });
            }

            await client.query(
                `INSERT INTO account_classes (user_id, account_name, class)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, lower(account_name))
                 DO UPDATE SET class = EXCLUDED.class, updated_at = now()`,
                [userId, name, item.class]
            );
        }

        await audit(client, userId, "account_classes_updated", "account_classes", null, { count: list.length });
        await client.query("COMMIT");

        const r = await db.query(
            "SELECT account_name, class FROM account_classes WHERE user_id = $1 ORDER BY account_name",
            [userId]
        );
        res.json({ classes: r.rows });

    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        if (e.status) return res.status(e.status).json({ error: e.message });
        console.error(e);
        res.status(500).json({ error: "Could not save account groups." });
    } finally {
        client.release();
    }
});

// ---- saved reports ------------------------------------------------------

router.get("/reports", async (req, res) => {
    try {
        const r = await db.query(
            `SELECT id, period_id, report_type, title, start_date::text AS start_date,
                    end_date::text AS end_date, created_at,
                    ${req.query.full === "1" ? "data" : "NULL::jsonb AS data"}
             FROM saved_reports WHERE user_id = $1
             ORDER BY end_date DESC, created_at DESC LIMIT 100`,
            [userIdOf(req)]
        );
        res.json({ reports: r.rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not load saved reports." });
    }
});

router.get("/reports/:id", async (req, res) => {
    try {
        const r = await db.query(
            `SELECT id, period_id, report_type, title, start_date::text AS start_date,
                    end_date::text AS end_date, created_at, data
             FROM saved_reports WHERE id = $1 AND user_id = $2`,
            [req.params.id, userIdOf(req)]
        );
        if (!r.rowCount) return res.status(404).json({ error: "Report not found." });
        res.json({ report: r.rows[0] });
    } catch (e) {
        res.status(500).json({ error: "Could not load the report." });
    }
});

// body: { title, start_date, end_date, period_id?, data }
router.post("/reports", async (req, res) => {

    const userId = userIdOf(req);
    const { title, start_date, end_date, period_id, data } = req.body || {};

    if (!title || !isDate(start_date) || !isDate(end_date) || end_date < start_date) {
        return res.status(400).json({ error: "A title and a valid date range are required." });
    }
    if (!data || typeof data !== "object") {
        return res.status(400).json({ error: "The report is empty." });
    }

    const client = await db.connect();

    try {
        await client.query("BEGIN");

        if (period_id) {
            const p = await client.query(
                `SELECT start_date::text AS s, end_date::text AS e FROM accounting_periods
                 WHERE id = $1 AND user_id = $2 FOR UPDATE`,
                [period_id, userId]
            );
            if (!p.rowCount) throw Object.assign(new Error("Period not found."), { status: 404 });
        }

        const r = await client.query(
            `INSERT INTO saved_reports
               (user_id, period_id, report_type, title, start_date, end_date, data, created_by)
             VALUES ($1, $2, 'financial_statements', $3, $4, $5, $6, $1)
             RETURNING id, created_at`,
            [userId, period_id || null, String(title).slice(0, 200), start_date, end_date, JSON.stringify(data)]
        );

        if (period_id) {
            await client.query(
                `UPDATE accounting_periods SET statements_status = 'complete', updated_at = now()
                 WHERE id = $1 AND user_id = $2`,
                [period_id, userId]
            );
        }

        await audit(client, userId, "report_saved", "saved_reports", r.rows[0].id,
            { title, start_date, end_date, period_id: period_id || null });

        await client.query("COMMIT");
        res.status(201).json({ report: { id: r.rows[0].id, created_at: r.rows[0].created_at } });

    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        if (e.status) return res.status(e.status).json({ error: e.message });
        console.error(e);
        res.status(500).json({ error: "Could not save the report." });
    } finally {
        client.release();
    }
});

module.exports = router;