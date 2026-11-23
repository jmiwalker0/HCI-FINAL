// =====================================================================
// SUPPLIES REGISTER          mount:  app.use("/api/supplies", require("./routes/supplies"));
//
//   GET   /api/supplies             list the user's supplies items
//   GET   /api/supplies/:id         one item
//   POST  /api/supplies             add an item
//   PUT   /api/supplies/:id         edit an item
//   POST  /api/supplies/:id/count   record a physical count (0 is a valid count)
//
// The register only holds quantities and costs. Supplies consumed in a
// period (beginning + purchases - ending) is calculated during period-end
// reconciliation, which proposes the adjusting entry for the user to approve.
// =====================================================================

const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authenticate);

const userId = req => req.user.userId;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const round2 = value => Math.round(value * 100) / 100;

function validDate(value) {
    const text = String(value ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const ms = Date.parse(text);
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === text;
}

const SUPPLY_SELECT = `
    SELECT id, name, category, description, units_on_hand, unit_cost,
           total_value, min_stock_level,
           to_char(last_count_date, 'YYYY-MM-DD') AS last_count_date
      FROM supplies_items
     WHERE user_id = $1`;

const nonNegative = value => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

function cleanSupply(input) {

    const name = String(input.name ?? "").trim();
    if (!name || name.length > 150) {
        return { error: "Enter an item name (up to 150 characters)." };
    }

    const units = input.units_on_hand === "" ? null : nonNegative(input.units_on_hand);
    if (units === null || input.units_on_hand == null) {
        return { error: "Units on hand must be zero or more." };
    }

    const cost = input.unit_cost === "" ? null : nonNegative(input.unit_cost);
    if (cost === null || input.unit_cost == null) {
        return { error: "Unit cost must be zero or more." };
    }

    const min = nonNegative(input.min_stock_level ?? 0);
    if (min === null) {
        return { error: "Minimum stock level must be zero or more." };
    }

    const countDate = input.last_count_date ? String(input.last_count_date) : null;
    if (countDate && !validDate(countDate)) {
        return { error: "Enter a valid last count date." };
    }

    return {
        value: {
            name,
            category: String(input.category ?? "").trim().slice(0, 80) || "General",
            description: String(input.description ?? "").trim().slice(0, 500),
            units_on_hand: round2(units),
            unit_cost: round2(cost),
            min_stock_level: round2(min),
            last_count_date: countDate
        }
    };
}

function fail(res, error, message) {
    if (error.code === "23514") {
        return res.status(400).json({ error: "One of the values is outside the allowed range." });
    }
    console.error(message, error);
    res.status(500).json({ error: "Unable to complete the request." });
}

// ---------------------------------------------------------------------
router.get("/", async (req, res) => {
    try {
        const { rows } = await db.query(`${SUPPLY_SELECT} ORDER BY lower(name)`, [userId(req)]);
        res.json(rows);
    } catch (error) {
        fail(res, error, "supplies list:");
    }
});

// ---------------------------------------------------------------------
router.get("/:id", async (req, res) => {
    try {
        if (!UUID.test(req.params.id)) {
            return res.status(404).json({ error: "Item not found." });
        }

        const { rows } = await db.query(`${SUPPLY_SELECT} AND id = $2`, [userId(req), req.params.id]);

        if (!rows.length) {
            return res.status(404).json({ error: "Item not found." });
        }

        res.json(rows[0]);
    } catch (error) {
        fail(res, error, "supplies detail:");
    }
});

// ---------------------------------------------------------------------
router.post("/", async (req, res) => {
    try {
        const clean = cleanSupply(req.body || {});

        if (clean.error) {
            return res.status(400).json({ error: clean.error });
        }

        const s = clean.value;

        const inserted = await db.query(
            `INSERT INTO supplies_items
                 (user_id, name, category, description, units_on_hand, unit_cost,
                  min_stock_level, last_count_date)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)
          RETURNING id`,
            [
                userId(req), s.name, s.category, s.description, s.units_on_hand,
                s.unit_cost, s.min_stock_level, s.last_count_date
            ]
        );

        const created = await db.query(`${SUPPLY_SELECT} AND id = $2`, [userId(req), inserted.rows[0].id]);

        res.status(201).json(created.rows[0]);
    } catch (error) {
        fail(res, error, "supplies create:");
    }
});

// ---------------------------------------------------------------------
router.put("/:id", async (req, res) => {
    try {
        if (!UUID.test(req.params.id)) {
            return res.status(404).json({ error: "Item not found." });
        }

        const existing = await db.query(`${SUPPLY_SELECT} AND id = $2`, [userId(req), req.params.id]);

        if (!existing.rows.length) {
            return res.status(404).json({ error: "Item not found." });
        }

        const merged = { ...existing.rows[0] };
        for (const key of [
            "name", "category", "description", "units_on_hand",
            "unit_cost", "min_stock_level", "last_count_date"
        ]) {
            if (req.body && req.body[key] !== undefined) merged[key] = req.body[key];
        }

        const clean = cleanSupply(merged);

        if (clean.error) {
            return res.status(400).json({ error: clean.error });
        }

        const s = clean.value;

        await db.query(
            `UPDATE supplies_items
                SET name = $3, category = $4, description = $5, units_on_hand = $6,
                    unit_cost = $7, min_stock_level = $8, last_count_date = $9::date,
                    updated_at = now()
              WHERE id = $1 AND user_id = $2`,
            [
                req.params.id, userId(req), s.name, s.category, s.description,
                s.units_on_hand, s.unit_cost, s.min_stock_level, s.last_count_date
            ]
        );

        const updated = await db.query(`${SUPPLY_SELECT} AND id = $2`, [userId(req), req.params.id]);

        res.json(updated.rows[0]);
    } catch (error) {
        fail(res, error, "supplies update:");
    }
});

// ---------------------------------------------------------------------
router.post("/:id/count", async (req, res) => {
    try {
        if (!UUID.test(req.params.id)) {
            return res.status(404).json({ error: "Item not found." });
        }

        const raw = req.body && req.body.units_on_hand;
        const units = raw === undefined || raw === null || raw === "" ? null : nonNegative(raw);

        if (units === null) {
            return res.status(400).json({ error: "Enter the counted quantity (0 or more)." });
        }

        const countDate = req.body.last_count_date || null;

        if (countDate && !validDate(countDate)) {
            return res.status(400).json({ error: "Enter a valid count date." });
        }

        const result = await db.query(
            `UPDATE supplies_items
                SET units_on_hand = $3,
                    last_count_date = COALESCE($4::date, CURRENT_DATE),
                    updated_at = now()
              WHERE id = $1 AND user_id = $2
          RETURNING id`,
            [req.params.id, userId(req), round2(units), countDate]
        );

        if (!result.rowCount) {
            return res.status(404).json({ error: "Item not found." });
        }

        const updated = await db.query(`${SUPPLY_SELECT} AND id = $2`, [userId(req), req.params.id]);

        res.json(updated.rows[0]);
    } catch (error) {
        fail(res, error, "supplies count:");
    }
});

module.exports = router;