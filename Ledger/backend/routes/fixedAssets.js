// =====================================================================
// FIXED ASSETS REGISTER      mount:  app.use("/api/fixed-assets", require("./routes/fixedAssets"));
//
//   GET    /api/fixed-assets            list the user's assets (active and disposed)
//   GET    /api/fixed-assets/:id        one asset + its depreciation history
//   POST   /api/fixed-assets            register an asset
//   PUT    /api/fixed-assets/:id        edit an asset
//   DELETE /api/fixed-assets/:id        dispose an asset (kept on record, never deleted)
//
// Depreciation is NOT written from here. Period depreciation is calculated
// during period-end reconciliation and reaches asset_depreciation only when
// the user approves the adjusting entry (so it can never be double-counted).
// =====================================================================

const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authenticate);

const userId = req => req.user.userId;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHODS = ["straight_line", "declining_balance"];
const CONDITIONS = ["good", "fair", "poor", "damaged"];

const round2 = value => Math.round(value * 100) / 100;

// Strict YYYY-MM-DD (rejects impossible dates such as 2026-02-31).
function validDate(value) {
    const text = String(value ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const ms = Date.parse(text);
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === text;
}

// Dates are returned as plain YYYY-MM-DD text so a server time zone can
// never shift them by a day. Accumulated depreciation includes the
// opening balance; carrying amount is cost less accumulated depreciation.
const ASSET_SELECT = `
    SELECT fa.id, fa.name, fa.description,
           to_char(fa.acquisition_date, 'YYYY-MM-DD')        AS acquisition_date,
           to_char(fa.depreciation_start_date, 'YYYY-MM-DD') AS depreciation_start_date,
           fa.cost, fa.residual_value, fa.useful_life_months,
           fa.method, fa.declining_rate, fa.opening_accumulated,
           fa.condition, fa.status,
           to_char(fa.disposal_date, 'YYYY-MM-DD')           AS disposal_date,
           fa.opening_accumulated + COALESCE(d.total, 0)     AS accumulated_depreciation,
           fa.cost - fa.opening_accumulated - COALESCE(d.total, 0) AS carrying_amount
      FROM fixed_assets fa
      LEFT JOIN (SELECT asset_id, SUM(depreciation_expense) AS total
                   FROM asset_depreciation
                  WHERE user_id = $1
                  GROUP BY asset_id) d ON d.asset_id = fa.id
     WHERE fa.user_id = $1`;

// Validate a complete asset (already merged with any existing values).
function cleanAsset(input) {

    const name = String(input.name ?? "").trim();
    if (!name || name.length > 150) {
        return { error: "Enter an asset name (up to 150 characters)." };
    }

    if (!validDate(input.acquisition_date)) {
        return { error: "Enter a valid acquisition date." };
    }

    const depStart = input.depreciation_start_date
        ? String(input.depreciation_start_date)
        : String(input.acquisition_date);

    if (!validDate(depStart)) {
        return { error: "Enter a valid depreciation start date." };
    }

    if (depStart < input.acquisition_date) {
        return { error: "Depreciation cannot start before the acquisition date." };
    }

    const cost = Number(input.cost);
    if (!Number.isFinite(cost) || cost <= 0) {
        return { error: "Cost must be greater than zero." };
    }

    const residual = Number(input.residual_value ?? 0);
    if (!Number.isFinite(residual) || residual < 0 || residual > cost) {
        return { error: "Residual value must be between zero and the cost." };
    }

    const life = Number(input.useful_life_months);
    if (!Number.isInteger(life) || life < 1 || life > 1200) {
        return { error: "Useful life must be a whole number of months from 1 to 1200." };
    }

    const method = String(input.method ?? "straight_line");
    if (!METHODS.includes(method)) {
        return { error: "Choose Straight-line or Declining balance." };
    }

    let rate = null;
    if (method === "declining_balance") {
        rate = Number(input.declining_rate);
        if (input.declining_rate == null || !Number.isFinite(rate) || rate <= 0 || rate > 1) {
            return { error: "Declining balance needs an annual rate above 0% and up to 100%." };
        }
        rate = Math.round(rate * 10000) / 10000;
    }

    const opening = Number(input.opening_accumulated ?? 0);
    if (!Number.isFinite(opening) || opening < 0 || opening > cost - residual) {
        return { error: "Depreciation already recorded cannot exceed cost minus residual value." };
    }

    const condition = String(input.condition ?? "good");
    if (!CONDITIONS.includes(condition)) {
        return { error: "Choose a valid condition." };
    }

    return {
        value: {
            name,
            description: String(input.description ?? "").trim().slice(0, 500),
            acquisition_date: String(input.acquisition_date),
            depreciation_start_date: depStart,
            cost: round2(cost),
            residual_value: round2(residual),
            useful_life_months: life,
            method,
            declining_rate: rate,
            opening_accumulated: round2(opening),
            condition
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

// Once depreciation has been recorded, these cannot change: doing so
// would silently rewrite accumulated depreciation already on the books.
const LOCKED_AFTER_DEPRECIATION = [
    "acquisition_date", "depreciation_start_date", "cost", "residual_value",
    "useful_life_months", "method", "declining_rate", "opening_accumulated"
];

const sameValue = (a, b) =>
    (a == null && b == null) || (a != null && b != null && String(Number.isNaN(Number(a)) ? a : Number(a)) === String(Number.isNaN(Number(b)) ? b : Number(b)));

// ---------------------------------------------------------------------
router.get("/", async (req, res) => {
    try {
        const { rows } = await db.query(
            `${ASSET_SELECT} ORDER BY (fa.status = 'disposed'), lower(fa.name)`,
            [userId(req)]
        );
        res.json(rows);
    } catch (error) {
        fail(res, error, "fixed assets list:");
    }
});

// ---------------------------------------------------------------------
router.get("/:id", async (req, res) => {
    try {
        if (!UUID.test(req.params.id)) {
            return res.status(404).json({ error: "Asset not found." });
        }

        const found = await db.query(`${ASSET_SELECT} AND fa.id = $2`, [userId(req), req.params.id]);

        if (!found.rows.length) {
            return res.status(404).json({ error: "Asset not found." });
        }

        const history = await db.query(
            `SELECT id,
                    to_char(period_start, 'YYYY-MM-DD') AS period_start,
                    to_char(period_end, 'YYYY-MM-DD')   AS period_end,
                    depreciation_expense, accumulated_depreciation, carrying_amount
               FROM asset_depreciation
              WHERE asset_id = $1 AND user_id = $2
              ORDER BY period_start DESC`,
            [req.params.id, userId(req)]
        );

        res.json({ ...found.rows[0], depreciation_history: history.rows });
    } catch (error) {
        fail(res, error, "fixed asset detail:");
    }
});

// ---------------------------------------------------------------------
router.post("/", async (req, res) => {
    try {
        const clean = cleanAsset(req.body || {});

        if (clean.error) {
            return res.status(400).json({ error: clean.error });
        }

        const a = clean.value;

        const inserted = await db.query(
            `INSERT INTO fixed_assets
                 (user_id, name, description, acquisition_date, depreciation_start_date,
                  cost, residual_value, useful_life_months, method, declining_rate,
                  opening_accumulated, condition, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')
          RETURNING id`,
            [
                userId(req), a.name, a.description, a.acquisition_date,
                a.depreciation_start_date, a.cost, a.residual_value,
                a.useful_life_months, a.method, a.declining_rate,
                a.opening_accumulated, a.condition
            ]
        );

        const created = await db.query(
            `${ASSET_SELECT} AND fa.id = $2`,
            [userId(req), inserted.rows[0].id]
        );

        res.status(201).json(created.rows[0]);
    } catch (error) {
        fail(res, error, "fixed asset create:");
    }
});

// ---------------------------------------------------------------------
router.put("/:id", async (req, res) => {
    try {
        if (!UUID.test(req.params.id)) {
            return res.status(404).json({ error: "Asset not found." });
        }

        const existing = await db.query(
            `SELECT name, description,
                    to_char(acquisition_date, 'YYYY-MM-DD')        AS acquisition_date,
                    to_char(depreciation_start_date, 'YYYY-MM-DD') AS depreciation_start_date,
                    cost, residual_value, useful_life_months, method,
                    declining_rate, opening_accumulated, condition, status
               FROM fixed_assets
              WHERE id = $1 AND user_id = $2`,
            [req.params.id, userId(req)]
        );

        if (!existing.rows.length) {
            return res.status(404).json({ error: "Asset not found." });
        }

        const current = existing.rows[0];

        if (current.status === "disposed") {
            return res.status(409).json({ error: "A disposed asset can't be edited." });
        }

        // Only the fields the client actually sent replace stored values.
        const merged = { ...current };
        for (const key of [
            "name", "description", "acquisition_date", "depreciation_start_date",
            "cost", "residual_value", "useful_life_months", "method",
            "declining_rate", "opening_accumulated", "condition"
        ]) {
            if (req.body && req.body[key] !== undefined) merged[key] = req.body[key];
        }

        const clean = cleanAsset(merged);

        if (clean.error) {
            return res.status(400).json({ error: clean.error });
        }

        const a = clean.value;

        const posted = await db.query(
            "SELECT 1 FROM asset_depreciation WHERE asset_id = $1 AND user_id = $2 LIMIT 1",
            [req.params.id, userId(req)]
        );

        if (posted.rowCount > 0) {
            const changed = LOCKED_AFTER_DEPRECIATION.filter(key => !sameValue(a[key], current[key]));

            if (changed.length) {
                return res.status(409).json({
                    error: "Depreciation has already been recorded for this asset, so its cost, " +
                           "dates, life, method and rate can't be changed. You can still edit " +
                           "its name, description and condition."
                });
            }
        }

        await db.query(
            `UPDATE fixed_assets
                SET name = $3, description = $4, acquisition_date = $5,
                    depreciation_start_date = $6, cost = $7, residual_value = $8,
                    useful_life_months = $9, method = $10, declining_rate = $11,
                    opening_accumulated = $12, condition = $13, updated_at = now()
              WHERE id = $1 AND user_id = $2`,
            [
                req.params.id, userId(req), a.name, a.description, a.acquisition_date,
                a.depreciation_start_date, a.cost, a.residual_value,
                a.useful_life_months, a.method, a.declining_rate,
                a.opening_accumulated, a.condition
            ]
        );

        const updated = await db.query(
            `${ASSET_SELECT} AND fa.id = $2`,
            [userId(req), req.params.id]
        );

        res.json(updated.rows[0]);
    } catch (error) {
        fail(res, error, "fixed asset update:");
    }
});

// ---------------------------------------------------------------------
// Dispose = keep the record, mark it disposed. Optional body: { disposal_date }.
router.delete("/:id", async (req, res) => {
    try {
        if (!UUID.test(req.params.id)) {
            return res.status(404).json({ error: "Asset not found." });
        }

        const requested = req.body && req.body.disposal_date;

        if (requested && !validDate(requested)) {
            return res.status(400).json({ error: "Enter a valid disposal date." });
        }

        const result = await db.query(
            `UPDATE fixed_assets
                SET status = 'disposed',
                    disposal_date = COALESCE($3::date, CURRENT_DATE),
                    updated_at = now()
              WHERE id = $1 AND user_id = $2 AND status = 'active'
          RETURNING id`,
            [req.params.id, userId(req), requested || null]
        );

        if (!result.rowCount) {
            return res.status(404).json({ error: "Active asset not found." });
        }

        res.json({ message: "Asset disposed." });
    } catch (error) {
        fail(res, error, "fixed asset dispose:");
    }
});

module.exports = router;