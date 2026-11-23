const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate);

// Keep in sync with LedgerUtils.ADJUSTMENT_TYPES in js/app.js
const ADJUSTMENT_TYPES = [
    "depreciation",
    "supplies",
    "prepaid",
    "accruedExpense",
    "unearned",
    "accruedRevenue",
    "other"
];

const ACCOUNT_TYPES = ["asset", "liability", "equity", "revenue", "expense"];

const cents = value => Math.round(Number(value) * 100);

// GET all adjusting entries with their lines
router.get("/", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT e.id,
                    to_char(e.entry_date, 'YYYY-MM-DD') AS entry_date,
                    e.adjustment_type,
                    e.description,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'account_name', l.account_name,
                                'account_type', l.account_type,
                                'debit',        l.debit,
                                'credit',       l.credit
                            )
                            ORDER BY l.debit DESC, l.account_name
                        ) FILTER (WHERE l.id IS NOT NULL),
                        '[]'::json
                    ) AS lines
             FROM adjusting_entries e
             LEFT JOIN adjusting_entry_lines l ON l.entry_id = e.id
             WHERE e.user_id = $1
             GROUP BY e.id
             ORDER BY e.entry_date DESC, e.created_at DESC`,
            [req.user.userId]
        );

        res.json({ adjustingEntries: result.rows });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to load adjusting entries." });
    }
});

// ADD an adjusting entry (entry + lines in one statement: all or nothing)
router.post("/", async (req, res) => {
    try {
        const { entry_date, adjustment_type, description, lines } =
            req.body || {};

        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(entry_date || "") ||
            !ADJUSTMENT_TYPES.includes(adjustment_type) ||
            !String(description || "").trim()
        ) {
            return res.status(400).json({
                error: "Please provide a date, an adjustment type and a description."
            });
        }

        if (!Array.isArray(lines) || lines.length < 2 || lines.length > 20) {
            return res.status(400).json({
                error: "An adjusting entry needs at least two lines."
            });
        }

        const clean = [];

        for (const line of lines) {

            const name = String(line?.account_name || "").trim();
            const debit = Number(line?.debit) || 0;
            const credit = Number(line?.credit) || 0;

            if (
                !name || name.length > 100 ||
                !ACCOUNT_TYPES.includes(line?.account_type) ||
                debit < 0 || credit < 0 ||
                (debit > 0) === (credit > 0)   // exactly one side per line
            ) {
                return res.status(400).json({
                    error: "Each line needs an account and either a debit or a credit."
                });
            }

            clean.push({
                account_name: name,
                account_type: line.account_type,
                debit: cents(debit) / 100,
                credit: cents(credit) / 100
            });
        }

        const totalDebit = clean.reduce((t, l) => t + cents(l.debit), 0);
        const totalCredit = clean.reduce((t, l) => t + cents(l.credit), 0);

        if (totalDebit !== totalCredit || totalDebit <= 0) {
            return res.status(400).json({
                error: "Total debits must equal total credits."
            });
        }

        const result = await db.query(
            `WITH e AS (
                 INSERT INTO adjusting_entries
                     (user_id, entry_date, adjustment_type, description)
                 VALUES ($1, $2::date, $3::text, $4::text)
                 RETURNING id
             ),
             l AS (
                 INSERT INTO adjusting_entry_lines
                     (entry_id, account_name, account_type, debit, credit)
                 SELECT e.id, x.account_name, x.account_type,
                        x.debit, x.credit
                 FROM e,
                      jsonb_to_recordset($5::jsonb) AS x(
                          account_name text,
                          account_type text,
                          debit numeric,
                          credit numeric
                      )
             )
             SELECT id FROM e`,
            [
                req.user.userId,
                entry_date,
                adjustment_type,
                String(description).trim().slice(0, 100),
                JSON.stringify(clean)
            ]
        );

        res.status(201).json({ id: result.rows[0].id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to save adjusting entry." });
    }
});

// DELETE an adjusting entry (its lines are removed by ON DELETE CASCADE)
router.delete("/:id", async (req, res) => {
    try {
        const result = await db.query(
            `DELETE FROM adjusting_entries
             WHERE id = $1 AND user_id = $2
             RETURNING id`,
            [req.params.id, req.user.userId]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: "Adjusting entry not found." });
        }

        res.json({ message: "Adjusting entry deleted successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to delete adjusting entry." });
    }
});

module.exports = router;