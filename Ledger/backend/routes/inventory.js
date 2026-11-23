const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate);

// GET inventory: current stock per item + recent stock movements.
// Stock is changed only by Purchase and Sale transactions
// (see routes/transactions.js), never edited directly here.
router.get("/", async (req, res) => {
    try {
        const items = await db.query(
            `SELECT id,
                    name,
                    quantity_on_hand,
                    average_cost,
                    ROUND(quantity_on_hand * average_cost, 2) AS stock_value
             FROM inventory_items
             WHERE user_id = $1
             ORDER BY lower(name)`,
            [req.user.userId]
        );

        const movements = await db.query(
            `SELECT m.id,
                    m.movement_type,
                    m.quantity,
                    m.unit_cost,
                    m.total_cost,
                    i.name AS item_name,
                    t.transaction_date AS date,
                    t.description
             FROM inventory_movements m
             JOIN inventory_items i ON i.id = m.item_id
             JOIN transactions t ON t.id = m.transaction_id
             WHERE m.user_id = $1
             ORDER BY t.transaction_date DESC, m.created_at DESC
             LIMIT 100`,
            [req.user.userId]
        );

        res.json({
            items: items.rows,
            movements: movements.rows
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to load inventory." });
    }
});

module.exports = router;