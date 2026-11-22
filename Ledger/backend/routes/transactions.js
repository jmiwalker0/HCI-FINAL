const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate);

// Must match the CHECK constraint on transactions.type
// (see the ALTER TABLE in receipts-backend.md).
const TRANSACTION_TYPES = ["income", "expense", "investment", "withdrawal"];

// GET all transactions
router.get("/", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id,
                    transaction_date AS date,
                    description,
                    category,
                    type,
                    amount,
                    status
             FROM transactions
             WHERE user_id = $1
             ORDER BY transaction_date DESC, created_at DESC`,
            [req.user.userId]
        );

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to load transactions." });
    }
});

// ADD transaction
router.post("/", async (req, res) => {
    try {
        const { date, description, category, type, amount } = req.body;

        if (!date || !description?.trim() || !category ||
            !TRANSACTION_TYPES.includes(type) ||
            !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
            return res.status(400).json({
                error: "Please provide valid transaction details."
            });
        }

        const result = await db.query(
            `INSERT INTO transactions
             (user_id, transaction_date, description, category, type, amount)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id,
                       transaction_date AS date,
                       description, category, type, amount, status`,
            [
                req.user.userId,
                date,
                description.trim(),
                category,
                type,
                Number(amount)
            ]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to save transaction." });
    }
});

// UPDATE transaction
router.patch("/:id", async (req, res) => {
    try {
        const { date, description, category, type, amount } = req.body;

        if (!date || !description?.trim() || !category ||
            !TRANSACTION_TYPES.includes(type) ||
            !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
            return res.status(400).json({
                error: "Please provide valid transaction details."
            });
        }

        const result = await db.query(
            `UPDATE transactions
             SET transaction_date = $1,
                 description = $2,
                 category = $3,
                 type = $4,
                 amount = $5,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $6 AND user_id = $7
             RETURNING id,
                       transaction_date AS date,
                       description, category, type, amount, status`,
            [
                date,
                description.trim(),
                category,
                type,
                Number(amount),
                req.params.id,
                req.user.userId
            ]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: "Transaction not found." });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to update transaction." });
    }
});

// DELETE transaction
// journal_lines -> journal_entries -> transactions and receipts -> transactions
// have no ON DELETE CASCADE, so the children are removed in the same
// statement. A single SQL statement is atomic and its foreign keys are
// checked at the end, so this is all-or-nothing.
// Receipt files are kept; they are only unlinked from the transaction.
router.delete("/:id", async (req, res) => {
    try {
        const result = await db.query(
            `WITH entries AS (
                 SELECT id FROM journal_entries
                 WHERE transaction_id = $1 AND user_id = $2
             ),
             del_lines AS (
                 DELETE FROM journal_lines
                 WHERE journal_entry_id IN (SELECT id FROM entries)
             ),
             del_entries AS (
                 DELETE FROM journal_entries
                 WHERE id IN (SELECT id FROM entries)
             ),
             unlink_receipts AS (
                 UPDATE receipts
                 SET transaction_id = NULL
                 WHERE transaction_id = $1 AND user_id = $2
             )
             DELETE FROM transactions
             WHERE id = $1 AND user_id = $2
             RETURNING id`,
            [req.params.id, req.user.userId]
        );

        if (!result.rows.length) {
            return res.status(404).json({ error: "Transaction not found." });
        }

        res.json({ message: "Transaction deleted successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to delete transaction." });
    }
});

module.exports = router;