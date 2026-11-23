// Adjustment review: list, revise, approve and reject proposed adjustments.
// Approving posts the entry into the existing adjusting_entries tables inside
// one database transaction. Posted entries are never changed or deleted here.

const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");
const { audit } = require("../lib/audit");
const { SELECT_PROPOSALS } = require("../lib/proposals");
const {
    userIdOf, round2, loadChart, validateLines
} = require("../lib/ledgerHelpers");

const router = express.Router();

router.use(authenticate);

const isDate = value =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) &&
    !Number.isNaN(Date.parse(value));

// Sources whose amounts come from a count or schedule. Their accounts can
// be changed, but the amounts can only change by regenerating.
const AMOUNT_LOCKED = ["depreciation", "inventory", "inventory_nrv", "supplies"];

router.get("/", async (req, res) => {
    try {
        const params = [userIdOf(req)];
        let filter = "";

        if (req.query.period_id) {
            params.push(req.query.period_id);
            filter = " AND pa.period_id = $2";
        }

        const result = await db.query(
            SELECT_PROPOSALS + filter + " ORDER BY pa.created_at, pa.id",
            params
        );

        res.json({ adjustments: result.rows });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to load adjustments." });
    }
});

// REVISE (only while still waiting for approval)
router.put("/:id", async (req, res) => {

    const userId = userIdOf(req);

    try {
        const found = await db.query(
            `SELECT pa.*, ap.status AS period_status,
                    ap.start_date::text AS period_start,
                    ap.end_date::text AS period_end,
                    pa.entry_date::text AS entry_date_text
             FROM period_adjustments pa
             JOIN accounting_periods ap ON ap.id = pa.period_id
             WHERE pa.id = $1 AND pa.user_id = $2`,
            [req.params.id, userId]
        );

        const row = found.rows[0];

        if (!row) return res.status(404).json({ error: "Adjustment not found." });

        if (!["pending", "revise_needed"].includes(row.status)) {
            return res.status(409).json({
                error: "Only adjustments waiting for approval can be revised."
            });
        }

        if (row.period_status === "closed") {
            return res.status(409).json({ error: "This period is closed." });
        }

        const description = String(req.body.description ?? row.description)
            .trim().slice(0, 200);

        const entryDate = req.body.entry_date ?? row.entry_date_text;

        if (!description) {
            return res.status(400).json({ error: "Add a description." });
        }

        const dateText = String(entryDate).slice(0, 10);

        if (!isDate(dateText) || dateText < row.period_start || dateText > row.period_end) {
            return res.status(400).json({
                error: `The entry date must be inside the period (${row.period_start} to ${row.period_end}).`
            });
        }

        const chart = await loadChart(db, userId);

        const checked = validateLines(req.body.lines, chart);

        if (checked.error) return res.status(400).json({ error: checked.error });

        if (AMOUNT_LOCKED.includes(row.source)) {

            const original = row.lines;

            const same =
                original.length === checked.lines.length &&
                original.every((line, index) =>
                    round2(line.debit) === checked.lines[index].debit &&
                    round2(line.credit) === checked.lines[index].credit
                );

            if (!same) {
                return res.status(400).json({
                    error: "The amounts on this adjustment come from your count or schedule. Change the accounts here, or fix the source data and generate again."
                });
            }
        }

        await db.query(
            `UPDATE period_adjustments
             SET description = $3, entry_date = $4, lines = $5::jsonb,
                 status = 'pending', updated_at = now()
             WHERE id = $1 AND user_id = $2
               AND status IN ('pending', 'revise_needed')`,
            [row.id, userId, description, dateText, JSON.stringify(checked.lines)]
        );

        await audit(db, userId, "adjustment_revised", "period_adjustments", row.id,
            { description });

        res.json({ message: "Adjustment revised." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to revise the adjustment." });
    }
});

// APPROVE and POST
router.post("/:id/approve", async (req, res) => {

    const userId = userIdOf(req);
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        const found = await client.query(
            `SELECT pa.*, ap.status AS period_status,
                    ap.start_date::text AS period_start,
                    ap.end_date::text AS period_end,
                    pa.entry_date::text AS entry_date_text
             FROM period_adjustments pa
             JOIN accounting_periods ap ON ap.id = pa.period_id
             WHERE pa.id = $1 AND pa.user_id = $2
             FOR UPDATE OF pa`,
            [req.params.id, userId]
        );

        const row = found.rows[0];

        if (!row) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Adjustment not found." });
        }

        if (row.status !== "pending") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                error: row.status === "revise_needed"
                    ? "This adjustment is marked as needing revision. Revise it first."
                    : `This adjustment was already ${row.status}.`
            });
        }

        if (row.period_status === "closed") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                error: "This period is closed. Reopen it before posting."
            });
        }

        const chart = await loadChart(client, userId);

        const checked = validateLines(row.lines, chart);

        if (checked.error) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: checked.error });
        }

        const meta = row.meta || {};

        // --- keep the stock / cost records in step with the entry -------
        if (row.source === "inventory") {

            const item = await client.query(
                `SELECT quantity_on_hand FROM inventory_items
                 WHERE id = $1 AND user_id = $2 FOR UPDATE`,
                [meta.item_id, userId]
            );

            if (!item.rows[0]) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "The inventory item no longer exists." });
            }

            if (round2(item.rows[0].quantity_on_hand) !== round2(meta.recorded_qty)) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    error: "The recorded stock changed after this count. Generate the adjustments again."
                });
            }

            await client.query(
                `UPDATE inventory_items SET quantity_on_hand = $3
                 WHERE id = $1 AND user_id = $2`,
                [meta.item_id, userId, round2(meta.actual_qty)]
            );
        }

        if (row.source === "inventory_nrv") {

            const item = await client.query(
                `SELECT average_cost FROM inventory_items
                 WHERE id = $1 AND user_id = $2 FOR UPDATE`,
                [meta.item_id, userId]
            );

            if (!item.rows[0]) {
                await client.query("ROLLBACK");
                return res.status(409).json({ error: "The inventory item no longer exists." });
            }

            if (Math.abs(Number(item.rows[0].average_cost) - Number(meta.old_cost)) >= 0.005) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    error: "The item's cost changed after this review. Generate the adjustments again."
                });
            }

            await client.query(
                `UPDATE inventory_items SET average_cost = $3
                 WHERE id = $1 AND user_id = $2`,
                [meta.item_id, userId, meta.new_cost]
            );
        }

        if (row.source === "supplies") {

            for (const count of meta.counts || []) {
                await client.query(
                    `UPDATE supplies_items
                     SET units_on_hand = $3, unit_cost = $4,
                         last_count_date = $5, updated_at = now()
                     WHERE id = $1 AND user_id = $2`,
                    [count.id, userId, count.units, count.unit_cost,
                     row.entry_date_text]
                );
            }
        }

        // --- post to the existing adjusting entries ----------------------
        const entry = await client.query(
            `INSERT INTO adjusting_entries
               (user_id, entry_date, adjustment_type, description)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [userId, row.entry_date_text, row.source, row.description]
        );

        for (const line of checked.lines) {
            await client.query(
                `INSERT INTO adjusting_entry_lines
                   (entry_id, account_name, account_type, debit, credit)
                 VALUES ($1, $2, $3, $4, $5)`,
                [entry.rows[0].id, line.account_name, line.account_type,
                 line.debit, line.credit]
            );
        }

        await client.query(
            `UPDATE period_adjustments
             SET status = 'approved', adjusting_entry_id = $3,
                 lines = $4::jsonb, decided_at = now(), decided_by = $2,
                 updated_at = now()
             WHERE id = $1`,
            [row.id, userId, entry.rows[0].id, JSON.stringify(checked.lines)]
        );

        await audit(client, userId, "adjustment_approved", "period_adjustments", row.id,
            { source: row.source, description: row.description, entry_date: row.entry_date_text,
              adjusting_entry_id: entry.rows[0].id });

        await client.query("COMMIT");

        res.json({ message: "Adjustment approved and posted." });

    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(error);
        res.status(500).json({ error: "Unable to post the adjustment." });
    } finally {
        client.release();
    }
});

// REJECT (frees any reserved depreciation months)
router.post("/:id/reject", async (req, res) => {

    const userId = userIdOf(req);
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        const found = await client.query(
            `SELECT status FROM period_adjustments
             WHERE id = $1 AND user_id = $2 FOR UPDATE`,
            [req.params.id, userId]
        );

        if (!found.rows[0]) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Adjustment not found." });
        }

        if (!["pending", "revise_needed"].includes(found.rows[0].status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                error: `This adjustment was already ${found.rows[0].status}.`
            });
        }

        await client.query(
            "DELETE FROM asset_depreciation WHERE adjustment_id = $1 AND user_id = $2",
            [req.params.id, userId]
        );

        await client.query(
            `UPDATE period_adjustments
             SET status = 'rejected', decision_note = $3,
                 decided_at = now(), decided_by = $2, updated_at = now()
             WHERE id = $1`,
            [req.params.id, userId, String(req.body?.note || "").slice(0, 300)]
        );

        await audit(client, userId, "adjustment_rejected", "period_adjustments", req.params.id,
            { note: String(req.body?.note || "").slice(0, 300) });

        await client.query("COMMIT");

        res.json({ message: "Adjustment rejected." });

    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(error);
        res.status(500).json({ error: "Unable to reject the adjustment." });
    } finally {
        client.release();
    }
});

// FLAG: send back for revision (keeps it from being approved by accident)
router.post("/:id/needs-revision", async (req, res) => {
    try {
        const result = await db.query(
            `UPDATE period_adjustments
             SET status = 'revise_needed', decision_note = $3, updated_at = now()
             WHERE id = $1 AND user_id = $2 AND status = 'pending'`,
            [req.params.id, userIdOf(req), String(req.body?.note || "").slice(0, 300)]
        );

        if (!result.rowCount) {
            return res.status(409).json({
                error: "Only adjustments waiting for approval can be sent back."
            });
        }

        await audit(db, userIdOf(req), "adjustment_flagged", "period_adjustments", req.params.id,
            { note: String(req.body?.note || "").slice(0, 300) });

        res.json({ message: "Marked as needing revision." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to update the adjustment." });
    }
});

module.exports = router;