// Period-end reconciliation: save a draft, then turn the person's verified
// figures into proposed adjusting entries. Nothing here posts to the ledger;
// posting happens only when a proposal is approved.

const express = require("express");
const crypto = require("crypto");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");
const { audit } = require("../lib/audit");
const { SELECT_PROPOSALS } = require("../lib/proposals");
const { planDepreciation } = require("../lib/depreciation");
const {
    userIdOf, round2, loadChart, findAccount, byName, twoLines
} = require("../lib/ledgerHelpers");

const router = express.Router();

router.use(authenticate);

const STATUS_VALUES = ["not_started", "in_progress", "complete"];
const isDate = value =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) &&
    !Number.isNaN(Date.parse(value));

const money = value =>
    "₱" + Number(value).toLocaleString("en-PH", {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    });

async function getPeriod(queryable, id, userId, lock = false) {

    const result = await queryable.query(
        `SELECT id, frequency, label, status, reconciliation_status,
                adjusted_tb_status, statements_status,
                start_date::text AS start_date, end_date::text AS end_date
         FROM accounting_periods WHERE id = $1 AND user_id = $2` +
        (lock ? " FOR UPDATE" : ""),
        [id, userId]
    );

    return result.rows[0] || null;
}

// ------------------------------------------------------------------
// LOAD DRAFT
// ------------------------------------------------------------------
router.get("/:periodId", async (req, res) => {
    try {
        const userId = userIdOf(req);

        const period = await getPeriod(db, req.params.periodId, userId);

        if (!period) return res.status(404).json({ error: "Reporting period not found." });

        const draft = await db.query(
            `SELECT inputs, steps FROM reconciliations
             WHERE period_id = $1 AND user_id = $2`,
            [period.id, userId]
        );

        res.json({
            draft: draft.rows[0]?.inputs || {},
            steps: draft.rows[0]?.steps || {},
            period
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to load the reconciliation." });
    }
});

// ------------------------------------------------------------------
// SAVE PROGRESS
// ------------------------------------------------------------------
router.put("/:periodId", async (req, res) => {

    const data = req.body?.data;
    const steps = req.body?.steps && typeof req.body.steps === "object"
        ? req.body.steps
        : {};

    if (!data || typeof data !== "object" || Array.isArray(data)) {
        return res.status(400).json({ error: "Nothing to save." });
    }

    if (JSON.stringify(data).length > 500000) {
        return res.status(413).json({ error: "The reconciliation is too large to save." });
    }

    const userId = userIdOf(req);
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        const period = await getPeriod(client, req.params.periodId, userId, true);

        if (!period) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Reporting period not found." });
        }

        if (period.status === "closed") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "This period is closed." });
        }

        const existing = await client.query(
            `SELECT id FROM reconciliations
             WHERE period_id = $1 AND user_id = $2 ORDER BY created_at LIMIT 1`,
            [period.id, userId]
        );

        if (existing.rows[0]) {
            await client.query(
                `UPDATE reconciliations
                 SET inputs = $2::jsonb, steps = $3::jsonb,
                     overall_status = CASE WHEN overall_status = 'not_started'
                                      THEN 'in_progress' ELSE overall_status END,
                     updated_at = now()
                 WHERE id = $1`,
                [existing.rows[0].id, JSON.stringify(data), JSON.stringify(steps)]
            );
        } else {
            await client.query(
                `INSERT INTO reconciliations
                   (user_id, period_id, inputs, steps, overall_status)
                 VALUES ($1, $2, $3::jsonb, $4::jsonb, 'in_progress')`,
                [userId, period.id, JSON.stringify(data), JSON.stringify(steps)]
            );
        }

        if (period.reconciliation_status === "not_started") {
            await client.query(
                `UPDATE accounting_periods
                 SET reconciliation_status = 'in_progress', updated_at = now()
                 WHERE id = $1`,
                [period.id]
            );
        }

        await client.query("COMMIT");

        res.json({ message: "Progress saved." });

    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(error);
        res.status(500).json({ error: "Unable to save progress." });
    } finally {
        client.release();
    }
});

// ------------------------------------------------------------------
// GENERATE PROPOSED ADJUSTMENTS FROM THE SAVED DRAFT
// Replaces proposals still waiting for approval; approved ones stay.
// ------------------------------------------------------------------
router.post("/:periodId/generate", async (req, res) => {

    const userId = userIdOf(req);
    const client = await db.connect();

    try {
        await client.query("BEGIN");

        const period = await getPeriod(client, req.params.periodId, userId, true);

        if (!period) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Reporting period not found." });
        }

        if (period.status === "closed") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "This period is closed." });
        }

        const draftRow = await client.query(
            `SELECT inputs FROM reconciliations
             WHERE period_id = $1 AND user_id = $2 ORDER BY created_at LIMIT 1`,
            [period.id, userId]
        );

        const draft = draftRow.rows[0]?.inputs || {};

        const chart = await loadChart(client, userId);

        // Entries are dated at the end of the period. For a period that
        // has not ended yet they are dated today instead, otherwise the
        // Adjusted Trial Balance (which never looks past today) would not
        // include them.
        const asOf = isDate(req.body?.as_of) ? req.body.as_of : null;

        const postingDate = date =>
            asOf && date > asOf && asOf >= period.start_date ? asOf : date;

        const warnings = [];
        const proposals = [];

        // Pending proposals are replaced. Their reserved depreciation
        // months are released first.
        const pending = await client.query(
            `SELECT id FROM period_adjustments
             WHERE user_id = $1 AND period_id = $2
               AND status IN ('pending', 'revise_needed')`,
            [userId, period.id]
        );

        const pendingIds = pending.rows.map(row => row.id);

        if (pendingIds.length) {
            await client.query(
                "DELETE FROM asset_depreciation WHERE adjustment_id = ANY($1::uuid[])",
                [pendingIds]
            );
            await client.query(
                "DELETE FROM period_adjustments WHERE id = ANY($1::uuid[])",
                [pendingIds]
            );
        }

        const inventoryAccount = findAccount(chart, "asset",
            [/^inventory$/i, /^merchandise inventory$/i, /inventor/i]);

        // ---------------- 1. INVENTORY ---------------------------------
        if (draft.inventory && typeof draft.inventory === "object") {

            const items = await client.query(
                `SELECT id, name, quantity_on_hand, average_cost
                 FROM inventory_items WHERE user_id = $1`,
                [userId]
            );

            const lossAccount = findAccount(chart, "expense", [
                /inventory.*(loss|shrink|write|damage|obsolete)/i,
                /(shrinkage|inventory loss)/i
            ]);

            const gainAccount = findAccount(chart, "revenue", [
                /inventory.*(gain|over)/i, /(gain|overage)/i, /^other income$/i
            ]);

            const writeDownAccount = findAccount(chart, "expense", [
                /inventory.*(write|impair|loss)/i, /write.?down/i
            ]);

            for (const item of items.rows) {

                const entered = draft.inventory[item.id];

                if (!entered) continue;

                if (entered.actual === null || entered.actual === undefined || entered.actual === "") continue;

                const actual = round2(entered.actual);

                if (!(actual >= 0)) {
                    warnings.push(`${item.name}: the counted quantity is not valid.`);
                    continue;
                }

                const recorded = round2(item.quantity_on_hand);
                const cost = Number(item.average_cost);
                const diff = round2(recorded - actual);
                const note = String(entered.note || "").trim();
                const label = {
                    missing: "Missing inventory",
                    damaged: "Damaged inventory",
                    obsolete: "Obsolete inventory"
                }[entered.status] || (diff > 0 ? "Inventory shortage" : "Inventory overage");

                if (diff !== 0) {

                    const value = round2(Math.abs(diff) * cost);

                    if (value <= 0) {
                        warnings.push(`${item.name}: the quantity differs but the unit cost is zero, so no entry was proposed. Correct the stock record on the Inventory page.`);
                    } else if (diff > 0) {

                        proposals.push({
                            source: "inventory",
                            ref: `inv:${period.id}:${item.id}:${recorded}>${actual}`,
                            description: `${label}: ${item.name} (${diff} short)`,
                            reason: `${label}. Recorded ${recorded}, counted ${actual}, so ${diff} unit(s) are unaccounted for at a cost of ${money(cost)} each.` +
                                (note ? ` Your note: ${note}` : "") +
                                (lossAccount ? "" : " No inventory loss account exists in your Chart of Accounts. Create one, or choose an account when you revise this entry."),
                            lines: twoLines(lossAccount, "expense", inventoryAccount, "asset", value, label),
                            meta: {
                                item_id: item.id, item_name: item.name,
                                recorded_qty: recorded, actual_qty: actual,
                                unit_cost: cost, status: entered.status || "ok"
                            }
                        });

                    } else {

                        proposals.push({
                            source: "inventory",
                            ref: `inv:${period.id}:${item.id}:${recorded}>${actual}`,
                            description: `Inventory overage: ${item.name} (${-diff} extra)`,
                            reason: `Counted ${actual} but only ${recorded} recorded. Check that no purchase went unrecorded before approving.` +
                                (note ? ` Your note: ${note}` : "") +
                                (gainAccount ? "" : " No inventory gain account exists in your Chart of Accounts. Choose an account when you revise this entry."),
                            lines: twoLines(inventoryAccount, "asset", gainAccount, "revenue", value, "Inventory overage"),
                            meta: {
                                item_id: item.id, item_name: item.name,
                                recorded_qty: recorded, actual_qty: actual,
                                unit_cost: cost, status: "overage"
                            }
                        });
                    }
                }

                // IAS 2: lower of cost and net realisable value
                const nrvText = entered.nrv;

                if (nrvText !== null && nrvText !== undefined && nrvText !== "") {

                    const nrv = round2(nrvText);

                    if (!(nrv >= 0)) {
                        warnings.push(`${item.name}: the net realisable value is not valid.`);
                    } else if (nrv < cost && actual > 0) {

                        const writeDown = round2((cost - nrv) * actual);

                        if (writeDown > 0) {
                            proposals.push({
                                source: "inventory_nrv",
                                ref: `nrv:${period.id}:${item.id}:${cost}>${nrv}`,
                                description: `Inventory write-down to net realisable value: ${item.name}`,
                                reason: `IAS 2: inventory is carried at the lower of cost and net realisable value. Cost ${money(cost)} per unit, net realisable value ${money(nrv)}, ${actual} unit(s) on hand.` +
                                    (note ? ` Your note: ${note}` : "") +
                                    (writeDownAccount ? "" : " No inventory write-down account exists in your Chart of Accounts. Choose an account when you revise this entry."),
                                lines: twoLines(writeDownAccount, "expense", inventoryAccount, "asset", writeDown, "Inventory write-down"),
                                meta: {
                                    item_id: item.id, item_name: item.name,
                                    old_cost: cost, new_cost: nrv, quantity: actual
                                }
                            });
                        }
                    }
                }
            }
        }

        // ---------------- 2. SUPPLIES ----------------------------------
        if (draft.supplies && typeof draft.supplies === "object") {

            const items = await client.query(
                `SELECT id, name, units_on_hand, unit_cost FROM supplies_items
                 WHERE user_id = $1`,
                [userId]
            );

            const book = Number(req.body?.book_supplies_balance);

            if (!items.rows.length) {
                warnings.push("Supplies: no supply items are registered, so supplies used was not calculated. Add your items on the Supplies page.");
            } else if (!Number.isFinite(book)) {
                warnings.push("Supplies: the ledger balance of your Supplies account was not available.");
            } else {

                const counts = draft.supplies.counts || {};

                let ending = 0;
                const used = [];

                for (const item of items.rows) {

                    const entered = counts[item.id];

                    const quantity = entered && entered.quantity !== "" && entered.quantity !== null && entered.quantity !== undefined
                        ? round2(entered.quantity)
                        : round2(item.units_on_hand);

                    const unitCost = entered && entered.unit_cost !== "" && entered.unit_cost !== null && entered.unit_cost !== undefined
                        ? round2(entered.unit_cost)
                        : round2(item.unit_cost);

                    if (!(quantity >= 0) || !(unitCost >= 0)) {
                        warnings.push(`${item.name}: the count or cost is not valid.`);
                        continue;
                    }

                    ending = round2(ending + quantity * unitCost);

                    used.push({ id: item.id, units: quantity, unit_cost: unitCost });
                }

                const asset = (() => {
                    const named = byName(chart, req.body?.supplies_account);
                    return named && named.account_type === "asset"
                        ? named.account_name
                        : findAccount(chart, "asset", [/^supplies$/i, /suppl/i]);
                })();

                const expense = findAccount(chart, "expense",
                    [/^supplies expense$/i, /suppl/i]);

                const consumed = round2(book - ending);

                if (consumed > 0) {

                    const extras = [
                        draft.supplies.discarded && `Damaged or discarded: ${draft.supplies.discarded}`,
                        draft.supplies.purchased && `Additional purchases: ${draft.supplies.purchased}`
                    ].filter(Boolean).join(" ");

                    proposals.push({
                        source: "supplies",
                        ref: `sup:${period.id}:${book}:${ending}`,
                        description: "Supplies used during the period",
                        reason: `Supplies on hand per your ledger ${money(book)} less supplies counted ${money(ending)} = ${money(consumed)} used. The counted ${money(ending)} stays recorded as an asset.` +
                            (extras ? " " + extras : "") +
                            (expense && asset ? "" : " A required supplies account was not found in your Chart of Accounts; choose one when you revise this entry."),
                        lines: twoLines(expense, "expense", asset, "asset", consumed, "Supplies used"),
                        meta: { counts: used, book_balance: book, ending_value: ending }
                    });

                } else if (consumed < 0) {
                    warnings.push(`Supplies: your count (${money(ending)}) is higher than the ledger balance (${money(book)}). Check for supplies bought but not recorded.`);
                }
            }
        }

        // ---------------- 3. DEPRECIATION ------------------------------
        {
            const assets = await client.query(
                `SELECT id, name, cost, residual_value, useful_life_months,
                        method, declining_rate, opening_accumulated,
                        acquisition_date::text AS acquisition_date,
                        depreciation_start_date::text AS depreciation_start_date,
                        CASE WHEN status = 'disposed'
                             THEN COALESCE(disposal_date, updated_at::date)::text
                        END AS disposal_date
                 FROM fixed_assets WHERE user_id = $1 ORDER BY name`,
                [userId]
            );

            const recorded = await client.query(
                `SELECT asset_id, period_start::text AS period_start,
                        period_end::text AS period_end, depreciation_expense
                 FROM asset_depreciation WHERE user_id = $1`,
                [userId]
            );

            const byAsset = new Map();

            recorded.rows.forEach(row => {
                if (!byAsset.has(row.asset_id)) byAsset.set(row.asset_id, []);
                byAsset.get(row.asset_id).push(row);
            });

            const plans = [];

            for (const asset of assets.rows) {

                const plan = planDepreciation(
                    asset,
                    byAsset.get(asset.id) || [],
                    period.start_date,
                    period.end_date
                );

                if (plan.skippedEarlierMonths > 0 && plan.months.length) {
                    warnings.push(`${asset.name}: ${plan.skippedEarlierMonths} month(s) before this period have no depreciation recorded. Reconcile the earlier periods, or set a later depreciation start date on the asset.`);
                }

                if (plan.months.length) plans.push({ asset, plan });
            }

            if (plans.length) {

                const total = round2(plans.reduce((t, p) => t + p.plan.total, 0));

                const expense = findAccount(chart, "expense",
                    [/^depreciation expense$/i, /depreciation/i]);

                const accumulated = findAccount(chart, "asset",
                    [/^accumulated depreciation$/i, /accumulated/i, /depreciation/i]);

                const keys = plans.flatMap(p =>
                    p.plan.months.map(m => `${p.asset.id}:${m.month}`)).sort().join("|");

                proposals.push({
                    source: "depreciation",
                    ref: `dep:${period.id}:${crypto.createHash("md5").update(keys).digest("hex")}`,
                    description: `Depreciation for ${period.label}`,
                    reason: plans.map(p =>
                        `${p.asset.name}: ${p.plan.months.length} month(s), ${money(p.plan.total)}`
                    ).join("; ") + "." +
                        (expense && accumulated ? "" : " A depreciation account was not found in your Chart of Accounts; choose one when you revise this entry."),
                    lines: twoLines(expense, "expense", accumulated, "asset", total, `Depreciation for ${period.label}`),
                    meta: {
                        assets: plans.map(p => ({
                            asset_id: p.asset.id,
                            name: p.asset.name,
                            rows: p.plan.chunks
                        }))
                    }
                });
            }
        }

        // ---------------- 4. OUTSTANDING EXPENSES & OTHER --------------
        if (Array.isArray(draft.expenses)) {

            for (const row of draft.expenses) {

                if (!row || row.payment_status === "paid") continue;

                const amount = round2(row.amount);
                const description = String(row.description || "").trim().slice(0, 150);

                if (!description || !(amount > 0)) {
                    warnings.push(`Outstanding items: a row ("${description || "no description"}") needs a description and an amount above zero.`);
                    continue;
                }

                const debit = byName(chart, row.debit_account);
                const credit = byName(chart, row.credit_account);

                const entryDate = postingDate(
                    isDate(row.date) &&
                    row.date >= period.start_date && row.date <= period.end_date
                        ? row.date
                        : period.end_date
                );

                // Already recorded as an ordinary expense?
                const similar = await client.query(
                    `SELECT description, transaction_date::text AS date
                     FROM transactions
                     WHERE user_id = $1 AND type = 'expense' AND amount = $2
                       AND transaction_date BETWEEN $3::date AND $4::date
                     LIMIT 1`,
                    [userId, amount, period.start_date, period.end_date]
                );

                if (similar.rows[0]) {
                    warnings.push(`"${description}" (${money(amount)}): you already have an expense of the same amount, "${similar.rows[0].description}" on ${similar.rows[0].date}. Reject this entry if it is the same bill.`);
                }

                proposals.push({
                    source: "accrual",
                    ref: `accr:${period.id}:${row.id || crypto.randomUUID()}:${amount}`,
                    description: `Unpaid: ${description}`,
                    reason: `Expense incurred in ${period.label} but not yet paid. Recognised in the period it belongs to, whenever it is paid.` +
                        (row.notes ? ` Notes: ${String(row.notes).slice(0, 200)}` : "") +
                        (debit && credit ? "" : " Choose both accounts from your Chart of Accounts when you revise this entry."),
                    lines: twoLines(debit?.account_name, debit?.account_type || "expense",
                        credit?.account_name, credit?.account_type || "liability",
                        amount, description),
                    entryDate,
                    meta: { row_id: row.id || null }
                });
            }
        }

        // ---------------- SAVE -----------------------------------------
        const created = [];

        for (const p of proposals) {

            // The same source can only be proposed (or posted) once.
            const duplicate = await client.query(
                `SELECT 1 FROM period_adjustments
                 WHERE user_id = $1 AND fingerprint = $2
                   AND status <> 'rejected' LIMIT 1`,
                [userId, p.ref]
            );

            if (duplicate.rowCount) {
                warnings.push(`Skipped "${p.description}": it was already proposed or approved.`);
                continue;
            }

            const inserted = await client.query(
                `INSERT INTO period_adjustments
                   (user_id, period_id, source, fingerprint, description,
                    reason, entry_date, lines, meta)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
                 RETURNING id`,
                [userId, period.id, p.source, p.ref, p.description,
                 p.reason, p.entryDate || postingDate(period.end_date),
                 JSON.stringify(p.lines), JSON.stringify(p.meta)]
            );

            created.push(inserted.rows[0].id);

            if (p.source === "depreciation") {
                for (const asset of p.meta.assets) {
                    for (const row of asset.rows) {
                        await client.query(
                            `INSERT INTO asset_depreciation
                               (user_id, asset_id, period_id, adjustment_id,
                                period_start, period_end, depreciation_expense,
                                accumulated_depreciation, carrying_amount)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                            [userId, asset.asset_id, period.id,
                             inserted.rows[0].id, row.period_start,
                             row.period_end, row.expense, row.accumulated,
                             row.carrying]
                        );
                    }
                }
            }
        }

        if (created.length) {
            await client.query(
                `UPDATE reconciliations SET overall_status = 'in_progress',
                        updated_at = now()
                 WHERE period_id = $1 AND user_id = $2
                   AND overall_status = 'complete'`,
                [period.id, userId]
            );
            await client.query(
                `UPDATE accounting_periods
                 SET reconciliation_status = 'in_progress',
                     adjusted_tb_status = CASE WHEN adjusted_tb_status = 'complete'
                                          THEN 'in_progress' ELSE adjusted_tb_status END,
                     updated_at = now()
                 WHERE id = $1`,
                [period.id]
            );
        }

        const all = await client.query(
            SELECT_PROPOSALS + " AND pa.period_id = $2 ORDER BY pa.created_at, pa.id",
            [userId, period.id]
        );

        await client.query("COMMIT");

        res.json({
            created: created.length,
            warnings,
            adjustments: all.rows
        });

    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(error);
        res.status(500).json({ error: "Unable to generate the adjustments." });
    } finally {
        client.release();
    }
});

// ------------------------------------------------------------------
// MARK RECONCILIATION COMPLETE (nothing may still be waiting)
// ------------------------------------------------------------------
router.post("/:periodId/complete", async (req, res) => {

    const userId = userIdOf(req);

    try {
        const period = await getPeriod(db, req.params.periodId, userId);

        if (!period) return res.status(404).json({ error: "Reporting period not found." });

        if (period.status === "closed") {
            return res.status(409).json({ error: "This period is closed." });
        }

        const waiting = await db.query(
            `SELECT COUNT(*)::int AS n FROM period_adjustments
             WHERE user_id = $1 AND period_id = $2
               AND status IN ('pending', 'revise_needed')`,
            [userId, period.id]
        );

        if (waiting.rows[0].n > 0) {
            return res.status(409).json({
                error: `${waiting.rows[0].n} adjustment(s) are still waiting for approval. Approve or reject them first.`
            });
        }

        await db.query(
            `UPDATE accounting_periods
             SET reconciliation_status = 'complete', updated_at = now()
             WHERE id = $1 AND user_id = $2`,
            [period.id, userId]
        );

        await db.query(
            `UPDATE reconciliations
             SET overall_status = 'complete', updated_at = now()
             WHERE period_id = $1 AND user_id = $2`,
            [period.id, userId]
        );

        await audit(db, userId, "reconciliation_completed", "accounting_periods", period.id,
            { label: period.label, start: period.start_date, end: period.end_date });

        res.json({ message: "Reconciliation marked complete." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to complete the reconciliation." });
    }
});

// ------------------------------------------------------------------
// STATUS FLAGS THE BROWSER MAY SET (the others are set above)
// ------------------------------------------------------------------
router.put("/:periodId/status", async (req, res) => {

    const field = String(req.body?.field || "");
    const value = String(req.body?.value || "");

    if (!["adjusted_tb_status", "statements_status"].includes(field) ||
        !STATUS_VALUES.includes(value)) {
        return res.status(400).json({ error: "Invalid status." });
    }

    try {
        const result = await db.query(
            `UPDATE accounting_periods SET ${field} = $3, updated_at = now()
             WHERE id = $1 AND user_id = $2 AND status = 'open'`,
            [req.params.periodId, userIdOf(req), value]
        );

        if (!result.rowCount) {
            return res.status(404).json({ error: "Open reporting period not found." });
        }

        res.json({ message: "Status updated." });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to update the status." });
    }
});

module.exports = router;