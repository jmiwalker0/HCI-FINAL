const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate);

// Must match the CHECK constraint on transactions.type
// (see migration-transaction-types.sql).
const TRANSACTION_TYPES = [
    "purchase",
    "sale",
    "service_income",
    "expense",
    "investment",
    "withdrawal"
];

// These two change inventory. Their stock movement is written in the
// SAME SQL statement as the transaction, so both succeed or neither does.
const INVENTORY_TYPES = ["purchase", "sale"];

function validBase({ date, description, category, type, amount }) {
    return Boolean(
        date &&
        description?.trim() &&
        category &&
        TRANSACTION_TYPES.includes(type) &&
        Number.isFinite(Number(amount)) &&
        Number(amount) > 0
    );
}

// Returns { itemName, quantity } or null if invalid.
function readItem({ item_name, quantity }) {
    const itemName = String(item_name || "").trim();
    const qty = Number(quantity);

    if (!itemName || itemName.length > 100) return null;
    if (!Number.isFinite(qty) || qty <= 0) return null;

    return { itemName, quantity: qty };
}

// GET all transactions
router.get("/", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT t.id,
                    t.transaction_date AS date,
                    t.description,
                    t.category,
                    t.type,
                    t.amount,
                    t.status,
                    i.name AS item_name,
                    m.quantity,
                    CASE WHEN m.movement_type = 'sale'
                         THEN m.total_cost END AS cogs
             FROM transactions t
             LEFT JOIN inventory_movements m ON m.transaction_id = t.id
             LEFT JOIN inventory_items i ON i.id = m.item_id
             WHERE t.user_id = $1
             ORDER BY t.transaction_date DESC, t.created_at DESC`,
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

        if (!validBase(req.body)) {
            return res.status(400).json({
                error: "Please provide valid transaction details."
            });
        }

        const userId = req.user.userId;

        // ---------------- PURCHASE: stock in, weighted-average cost ----
        if (type === "purchase") {

            const item = readItem(req.body);

            if (!item) {
                return res.status(400).json({
                    error: "A purchase needs an item name and a quantity greater than zero."
                });
            }

            const result = await db.query(
                `WITH item AS (
                     INSERT INTO inventory_items
                         (user_id, name, quantity_on_hand, average_cost)
                     VALUES ($1, $2::text, $3::numeric,
                             $4::numeric / $3::numeric)
                     ON CONFLICT (user_id, lower(name)) DO UPDATE SET
                         average_cost =
                             ((inventory_items.quantity_on_hand
                               * inventory_items.average_cost) + $4::numeric)
                             / (inventory_items.quantity_on_hand + $3::numeric),
                         quantity_on_hand =
                             inventory_items.quantity_on_hand + $3::numeric
                     RETURNING id, user_id
                 ),
                 tx AS (
                     INSERT INTO transactions
                         (user_id, transaction_date, description,
                          category, type, amount)
                     SELECT item.user_id, $5::date, $6::text,
                            $7::text, 'purchase', $4::numeric
                     FROM item
                     RETURNING id, transaction_date AS date, description,
                               category, type, amount, status
                 ),
                 mv AS (
                     INSERT INTO inventory_movements
                         (user_id, item_id, transaction_id, movement_type,
                          quantity, unit_cost, total_cost)
                     SELECT item.user_id, item.id, tx.id, 'purchase',
                            $3::numeric, $4::numeric / $3::numeric,
                            $4::numeric
                     FROM item, tx
                 )
                 SELECT * FROM tx`,
                [
                    userId,
                    item.itemName,
                    item.quantity,
                    Number(amount),
                    date,
                    description.trim(),
                    category
                ]
            );

            return res.status(201).json(result.rows[0]);
        }

        // ---------------- SALE: stock out at average cost --------------
        if (type === "sale") {

            const item = readItem(req.body);

            if (!item) {
                return res.status(400).json({
                    error: "A sale needs an item name and a quantity greater than zero."
                });
            }

            // The UPDATE only matches when enough stock exists; the
            // transaction and movement rows are created from its result.
            const result = await db.query(
                `WITH item AS (
                     UPDATE inventory_items
                     SET quantity_on_hand = quantity_on_hand - $3::numeric
                     WHERE user_id = $1
                       AND lower(name) = lower($2::text)
                       AND quantity_on_hand >= $3::numeric
                     RETURNING id, user_id, average_cost
                 ),
                 tx AS (
                     INSERT INTO transactions
                         (user_id, transaction_date, description,
                          category, type, amount)
                     SELECT item.user_id, $4::date, $5::text,
                            $6::text, 'sale', $7::numeric
                     FROM item
                     RETURNING id, transaction_date AS date, description,
                               category, type, amount, status
                 ),
                 mv AS (
                     INSERT INTO inventory_movements
                         (user_id, item_id, transaction_id, movement_type,
                          quantity, unit_cost, total_cost)
                     SELECT item.user_id, item.id, tx.id, 'sale',
                            $3::numeric, item.average_cost,
                            ROUND(item.average_cost * $3::numeric, 2)
                     FROM item, tx
                 )
                 SELECT * FROM tx`,
                [
                    userId,
                    item.itemName,
                    item.quantity,
                    date,
                    description.trim(),
                    category,
                    Number(amount)
                ]
            );

            if (!result.rows.length) {

                const stock = await db.query(
                    `SELECT name, quantity_on_hand
                     FROM inventory_items
                     WHERE user_id = $1 AND lower(name) = lower($2)`,
                    [userId, item.itemName]
                );

                return res.status(400).json({
                    error: stock.rows.length
                        ? `Not enough stock: only ${Number(stock.rows[0].quantity_on_hand)} of "${stock.rows[0].name}" available.`
                        : `"${item.itemName}" is not in your inventory. Record a purchase first.`
                });
            }

            return res.status(201).json(result.rows[0]);
        }

        // ---------------- everything else: no inventory effect --------
        const result = await db.query(
            `INSERT INTO transactions
             (user_id, transaction_date, description, category, type, amount)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id,
                       transaction_date AS date,
                       description, category, type, amount, status`,
            [
                userId,
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

        if (!validBase(req.body)) {
            return res.status(400).json({
                error: "Please provide valid transaction details."
            });
        }

        const existing = await db.query(
            `SELECT t.type,
                    EXISTS (
                        SELECT 1 FROM inventory_movements m
                        WHERE m.transaction_id = t.id
                    ) AS has_stock
             FROM transactions t
             WHERE t.id = $1 AND t.user_id = $2`,
            [req.params.id, req.user.userId]
        );

        if (!existing.rows.length) {
            return res.status(404).json({ error: "Transaction not found." });
        }

        const current = existing.rows[0];

        // Purchases and sales moved stock when they were created, so only
        // their date and description can change. To change the item,
        // quantity or amount, delete the transaction and record it again.
        if (current.has_stock) {

            const stockResult = await db.query(
                `UPDATE transactions
                 SET transaction_date = $1,
                     description = $2,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $3 AND user_id = $4
                 RETURNING id,
                           transaction_date AS date,
                           description, category, type, amount, status`,
                [date, description.trim(), req.params.id, req.user.userId]
            );

            return res.json(stockResult.rows[0]);
        }

        // A transaction can only become a purchase/sale through POST,
        // because only POST can supply the item and quantity.
        if (INVENTORY_TYPES.includes(type) && type !== current.type) {
            return res.status(400).json({
                error: "Record purchases and sales with Add transaction so inventory is updated."
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
// Purchases and sales also reverse their stock movement here.
// Deleting a purchase whose stock was already sold is refused (409).
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
             ),
             mv AS (
                 SELECT id, item_id, movement_type, quantity, total_cost
                 FROM inventory_movements
                 WHERE transaction_id = $1 AND user_id = $2
             ),
             del_mv AS (
                 DELETE FROM inventory_movements
                 WHERE id IN (SELECT id FROM mv)
             ),
             restock AS (
                 UPDATE inventory_items i
                 SET quantity_on_hand = i.quantity_on_hand +
                         CASE WHEN mv.movement_type = 'sale'
                              THEN mv.quantity ELSE -mv.quantity END,
                     average_cost = CASE
                         WHEN mv.movement_type = 'sale' THEN
                             (i.quantity_on_hand * i.average_cost + mv.total_cost)
                             / (i.quantity_on_hand + mv.quantity)
                         WHEN i.quantity_on_hand - mv.quantity > 0 THEN
                             GREATEST(
                                 (i.quantity_on_hand * i.average_cost - mv.total_cost)
                                 / (i.quantity_on_hand - mv.quantity), 0)
                         ELSE 0
                     END
                 FROM mv
                 WHERE i.id = mv.item_id
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
        // CHECK (quantity_on_hand >= 0) failed: the stock is already sold.
        if (error.code === "23514") {
            return res.status(409).json({
                error: "This purchase can't be deleted because some of its stock has already been sold. Delete the related sales first."
            });
        }

        console.error(error);
        res.status(500).json({ error: "Unable to delete transaction." });
    }
});

module.exports = router;