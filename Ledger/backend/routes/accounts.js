// =====================================================================
// CHART OF ACCOUNTS ROUTES        mount:  app.use("/api/accounts", require("./routes/accounts"));
//
//   GET    /api/accounts            list the signed-in user's chart (add ?include_inactive=1)
//   POST   /api/accounts            create a custom account
//   PUT    /api/accounts/:id        rename, recode, retype, activate/deactivate
//   DELETE /api/accounts/:id        delete an account that has no postings
//
// The database enforces the rules (system accounts are locked, accounts with
// postings can't be retyped or deleted); this file validates input and turns
// database errors into readable messages.
// =====================================================================

const express = require("express");

const db = require("../db");
const authenticate = require("../middleware/authMiddleware");

const router = express.Router();
router.use(authenticate);

const TYPES = ["asset", "liability", "equity", "revenue", "expense"];

// Number ranges used when a code is generated automatically.
const CODE_RANGES = {
    asset: [1000, 1999],
    liability: [2000, 2999],
    equity: [3000, 3999],
    revenue: [4000, 4999],
    expense: [5000, 7999]
};

const defaultNormalBalance = type =>
    type === "asset" || type === "expense" ? "debit" : "credit";

const userId = req => req.user.userId;

const COLUMNS = `
    a.account_id, a.code, a.account_name, a.account_type, a.normal_balance,
    a.is_active, a.is_system,
    (SELECT count(*)::int FROM journal_lines jl WHERE jl.account_id = a.account_id) AS line_count
`;

// Turn database errors into { status, message }.
function describeError(error) {
    if (error.code === "23505") {
        return { status: 409, message: "That account code or name is already used in your chart." };
    }
    if (error.code === "P0001") {
        return { status: 400, message: error.message };       // raised by our triggers
    }
    if (error.code === "23514") {
        return { status: 400, message: "Check the account code (3 to 10 digits) and balance side." };
    }
    return { status: 500, message: "Could not complete the request." };
}

function fail(res, error) {
    const { status, message } = describeError(error);
    if (status === 500) console.error("accounts route:", error);
    res.status(status).json({ error: message });
}

function cleanCode(value) {
    const code = String(value ?? "").trim();
    return /^[0-9]{3,10}$/.test(code) ? code : null;
}

// ---------------------------------------------------------------------
router.get("/", async (req, res) => {
    try {
        const includeInactive = req.query.include_inactive === "1";

        const { rows } = await db.query(
            `SELECT ${COLUMNS}
               FROM accounts a
              WHERE a.user_id = $1 ${includeInactive ? "" : "AND a.is_active"}
              ORDER BY a.code`,
            [userId(req)]
        );

        res.json({ accounts: rows });
    } catch (error) {
        fail(res, error);
    }
});

// ---------------------------------------------------------------------
router.post("/", async (req, res) => {
    try {
        const name = String(req.body.account_name ?? "").trim();
        const type = String(req.body.account_type ?? "").toLowerCase();

        if (!name || name.length > 150) {
            return res.status(400).json({ error: "Enter an account name (up to 150 characters)." });
        }
        if (!TYPES.includes(type)) {
            return res.status(400).json({ error: "Choose a valid account type." });
        }

        const normal = req.body.normal_balance
            ? String(req.body.normal_balance).toLowerCase()
            : defaultNormalBalance(type);

        if (!["debit", "credit"].includes(normal)) {
            return res.status(400).json({ error: "Normal balance must be debit or credit." });
        }

        let code = null;

        if (String(req.body.code ?? "").trim() !== "") {
            code = cleanCode(req.body.code);
            if (!code) {
                return res.status(400).json({ error: "Account code must be 3 to 10 digits." });
            }
        } else {
            const [low, high] = CODE_RANGES[type];

            const { rows } = await db.query(
                `SELECT coalesce(max(code::bigint), $2::bigint - 10) + 10 AS next
                   FROM accounts
                  WHERE user_id = $1 AND code::bigint BETWEEN $2 AND $3`,
                [userId(req), low, high]
            );

            code = String(rows[0].next);

            if (Number(code) > high) {
                return res.status(400).json({
                    error: `The ${type} code range is full. Enter a code manually.`
                });
            }
        }

        const { rows } = await db.query(
            `INSERT INTO accounts (user_id, code, account_name, account_type, normal_balance)
             VALUES ($1, $2, $3, $4, $5)
          RETURNING account_id`,
            [userId(req), code, name, type, normal]
        );

        const created = await db.query(
            `SELECT ${COLUMNS} FROM accounts a WHERE a.account_id = $1`,
            [rows[0].account_id]
        );

        res.status(201).json({ account: created.rows[0] });
    } catch (error) {
        fail(res, error);
    }
});

// ---------------------------------------------------------------------
router.put("/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {
            return res.status(400).json({ error: "Invalid account." });
        }

        const sets = [];
        const values = [];
        const add = (column, value) => {
            values.push(value);
            sets.push(`${column} = $${values.length}`);
        };

        if (req.body.account_name !== undefined) {
            const name = String(req.body.account_name).trim();
            if (!name || name.length > 150) {
                return res.status(400).json({ error: "Enter an account name (up to 150 characters)." });
            }
            add("account_name", name);
        }

        if (req.body.code !== undefined) {
            const code = cleanCode(req.body.code);
            if (!code) {
                return res.status(400).json({ error: "Account code must be 3 to 10 digits." });
            }
            add("code", code);
        }

        if (req.body.account_type !== undefined) {
            const type = String(req.body.account_type).toLowerCase();
            if (!TYPES.includes(type)) {
                return res.status(400).json({ error: "Choose a valid account type." });
            }
            add("account_type", type);
        }

        if (req.body.normal_balance !== undefined) {
            const normal = String(req.body.normal_balance).toLowerCase();
            if (!["debit", "credit"].includes(normal)) {
                return res.status(400).json({ error: "Normal balance must be debit or credit." });
            }
            add("normal_balance", normal);
        }

        if (req.body.is_active !== undefined) {
            add("is_active", Boolean(req.body.is_active));
        }

        if (!sets.length) {
            return res.status(400).json({ error: "Nothing to update." });
        }

        values.push(id, userId(req));

        const result = await db.query(
            `UPDATE accounts
                SET ${sets.join(", ")}
              WHERE account_id = $${values.length - 1} AND user_id = $${values.length}
          RETURNING account_id`,
            values
        );

        if (!result.rowCount) {
            return res.status(404).json({ error: "Account not found." });
        }

        const updated = await db.query(
            `SELECT ${COLUMNS} FROM accounts a WHERE a.account_id = $1`,
            [id]
        );

        res.json({ account: updated.rows[0] });
    } catch (error) {
        fail(res, error);
    }
});

// ---------------------------------------------------------------------
router.delete("/:id", async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isInteger(id)) {
            return res.status(400).json({ error: "Invalid account." });
        }

        const result = await db.query(
            "DELETE FROM accounts WHERE account_id = $1 AND user_id = $2",
            [id, userId(req)]
        );

        if (!result.rowCount) {
            return res.status(404).json({ error: "Account not found." });
        }

        res.json({ success: true });
    } catch (error) {
        fail(res, error);
    }
});

module.exports = router;