// Year-end closing. The browser works out the closing entries (it holds the
// auto-journaled ledger); this route verifies, posts them in ONE transaction,
// locks the fiscal year, and records the balances carried forward.
// Nothing is ever deleted: reopening posts reversing entries instead.

const express = require("express");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");
const { audit } = require("../lib/audit");
const { planDepreciation } = require("../lib/depreciation");
const { userIdOf, round2, loadChart, byName } = require("../lib/ledgerHelpers");

const router = express.Router();
router.use(authenticate);

const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) && !Number.isNaN(Date.parse(v));
const err = (status, message) => Object.assign(new Error(message), { status });

async function fiscalRange(q, start) {
    const r = await q.query(
        `SELECT $1::date::text AS s,
                (($1::date + interval '1 year') - interval '1 day')::date::text AS e,
                (CURRENT_DATE >= (($1::date + interval '1 year') - interval '1 day')::date) AS ended`,
        [start]
    );
    return r.rows[0];
}

// ---- readiness checks (read only) ---------------------------------------

async function runChecks(q, userId, start) {

    const { s, e, ended } = await fiscalRange(q, start);
    const checks = [];
    const warnings = [];

    checks.push({
        key: "year_ended", ok: !!ended,
        message: ended ? "The fiscal year has ended."
                       : `The fiscal year ends on ${e}. It can be closed on or after that date.`
    });

    const existing = await q.query(
        `SELECT status FROM year_end_closings
         WHERE user_id = $1 AND fiscal_year_start = $2 AND status = 'complete'`, [userId, s]);
    checks.push({
        key: "not_closed", ok: !existing.rowCount,
        message: existing.rowCount ? "This fiscal year is already closed." : "This fiscal year is open."
    });

    const waiting = await q.query(
        `SELECT COUNT(*)::int AS n FROM period_adjustments
         WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3
           AND status IN ('pending', 'revise_needed')`, [userId, s, e]);
    checks.push({
        key: "adjustments_reviewed", ok: waiting.rows[0].n === 0,
        message: waiting.rows[0].n
            ? `${waiting.rows[0].n} proposed adjustment(s) still need approval or rejection.`
            : "All proposed adjustments are approved or rejected."
    });

    const review = await q.query(
        `SELECT COUNT(*)::int AS n FROM transactions
         WHERE user_id = $1 AND transaction_date BETWEEN $2 AND $3 AND status = 'review'`,
        [userId, s, e]);
    checks.push({
        key: "no_review_transactions", ok: review.rows[0].n === 0,
        message: review.rows[0].n
            ? `${review.rows[0].n} transaction(s) are still marked for review.`
            : "No transactions are waiting for review."
    });

    // depreciation
    const assets = await q.query(
        `SELECT id, name, cost, residual_value, useful_life_months, method, declining_rate,
                opening_accumulated, acquisition_date::text AS acquisition_date,
                depreciation_start_date::text AS depreciation_start_date,
                CASE WHEN status = 'disposed'
                     THEN COALESCE(disposal_date, updated_at::date)::text END AS disposal_date
         FROM fixed_assets WHERE user_id = $1`, [userId]);
    const rec = await q.query(
        `SELECT asset_id, period_start::text AS period_start, period_end::text AS period_end,
                depreciation_expense FROM asset_depreciation WHERE user_id = $1`, [userId]);
    const by = new Map();
    rec.rows.forEach(r => { if (!by.has(r.asset_id)) by.set(r.asset_id, []); by.get(r.asset_id).push(r); });
    const missing = assets.rows.filter(a => planDepreciation(a, by.get(a.id) || [], s, e).months.length);
    checks.push({
        key: "depreciation_complete", ok: missing.length === 0,
        message: missing.length
            ? `Depreciation is missing for: ${missing.map(a => a.name).join(", ")}.`
            : "Depreciation is recorded for every asset."
    });

    // final reconciliation = last period of the user's frequency inside the year
    const last = await q.query(
        `SELECT p.label, p.reconciliation_status
         FROM accounting_periods p
         JOIN reporting_settings rs ON rs.user_id = p.user_id AND rs.frequency = p.frequency
         WHERE p.user_id = $1 AND p.fiscal_year_start = $2
         ORDER BY p.end_date DESC LIMIT 1`, [userId, s]);
    if (!last.rowCount) {
        checks.push({ key: "final_reconciliation", ok: false,
            message: "No reporting periods exist for this year. Open Reporting Periods first." });
    } else {
        const ok = last.rows[0].reconciliation_status === "complete";
        checks.push({ key: "final_reconciliation", ok,
            message: ok ? `${last.rows[0].label} is reconciled.`
                        : `Complete the reconciliation for ${last.rows[0].label} first.` });
    }

    const earlier = await q.query(
        `SELECT 1 FROM accounting_periods p
         WHERE p.user_id = $1 AND p.fiscal_year_start < $2
           AND NOT EXISTS (SELECT 1 FROM year_end_closings c WHERE c.user_id = p.user_id
                           AND c.status = 'complete' AND c.fiscal_year_start = p.fiscal_year_start)
         LIMIT 1`, [userId, s]);
    if (earlier.rowCount) warnings.push("An earlier fiscal year has not been closed. Closing years in order is recommended.");

    return { fiscal_year_start: s, fiscal_year_end: e, checks, warnings, ready: checks.every(c => c.ok) };
}

// ---- list ---------------------------------------------------------------

router.get("/", async (req, res) => {
    try {
        const userId = userIdOf(req);
        const closings = await db.query(
            `SELECT id, fiscal_year_start::text AS fiscal_year_start,
                    fiscal_year_end::text AS fiscal_year_end, status, steps, net_income,
                    report_id, closed_at, reopened_at, reopen_reason, updated_at
             FROM year_end_closings WHERE user_id = $1 ORDER BY fiscal_year_start DESC, created_at DESC`,
            [userId]);
        const years = await db.query(
            `SELECT DISTINCT fiscal_year_start::text AS fiscal_year_start,
                    (fiscal_year_start + interval '1 year' - interval '1 day')::date::text AS fiscal_year_end
             FROM accounting_periods WHERE user_id = $1 ORDER BY 1 DESC`, [userId]);
        const audits = await db.query(
            `SELECT event_type, entity_type, details, created_at FROM audit_events
             WHERE user_id = $1 AND event_type LIKE 'year_%' ORDER BY created_at DESC LIMIT 50`, [userId]);
        res.json({ closings: closings.rows, years: years.rows, audit: audits.rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not load year-end closings." });
    }
});

// Full audit trail (newest first). ?type=prefix filters by event name.
router.get("/audit/events", async (req, res) => {
    try {
        const type = String(req.query.type || "");
        const r = await db.query(
            `SELECT id, event_type, entity_type, entity_id, details, created_at
             FROM audit_events
             WHERE user_id = $1 AND ($2 = '' OR event_type LIKE $2 || '%')
             ORDER BY created_at DESC, id LIMIT 500`,
            [userIdOf(req), type]);
        res.json({ events: r.rows });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not load the audit trail." });
    }
});

router.get("/:fy/checks", async (req, res) => {
    if (!isDate(req.params.fy)) return res.status(400).json({ error: "Invalid fiscal year." });
    try {
        res.json(await runChecks(db, userIdOf(req), req.params.fy));
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not run the closing checks." });
    }
});

// save wizard progress
router.put("/:fy/steps", async (req, res) => {
    const userId = userIdOf(req);
    if (!isDate(req.params.fy)) return res.status(400).json({ error: "Invalid fiscal year." });
    try {
        const { s, e } = await fiscalRange(db, req.params.fy);
        const done = await db.query(
            `SELECT 1 FROM year_end_closings WHERE user_id=$1 AND fiscal_year_start=$2 AND status='complete'`,
            [userId, s]);
        if (done.rowCount) return res.status(409).json({ error: "This fiscal year is already closed." });

        const steps = req.body.steps && typeof req.body.steps === "object" ? req.body.steps : {};
        const r = await db.query(
            `INSERT INTO year_end_closings (user_id, fiscal_year_start, fiscal_year_end, steps)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, fiscal_year_start) WHERE status IN ('in_progress','complete')
             DO UPDATE SET steps = EXCLUDED.steps, updated_at = now()
             RETURNING id, steps`,
            [userId, s, e, JSON.stringify(steps)]);
        res.json({ closing: r.rows[0] });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: "Could not save your progress." });
    }
});

// ---- close ---------------------------------------------------------------
// body: { entries:[{description, lines:[{account,accountType,debit,credit}]}],
//         net_income, opening_balances:[{account,accountType,debit,credit}],
//         report:{ title, data } }

router.post("/:fy/close", async (req, res) => {

    const userId = userIdOf(req);
    if (!isDate(req.params.fy)) return res.status(400).json({ error: "Invalid fiscal year." });

    const body = req.body || {};
    const entries = Array.isArray(body.entries) ? body.entries : [];
    const opening = Array.isArray(body.opening_balances) ? body.opening_balances : [];

    const client = await db.connect();

    try {
        await client.query("BEGIN");

        // serialise closings for this user
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["close:" + userId]);

        const gate = await runChecks(client, userId, req.params.fy);
        const failed = gate.checks.filter(c => !c.ok);
        if (failed.length) throw err(409, failed.map(c => c.message).join(" "));

        const s = gate.fiscal_year_start, e = gate.fiscal_year_end;
        const chart = await loadChart(client, userId);

        // validate entries
        const prepared = [];
        for (const entry of entries) {
            const lines = (entry.lines || []).map(l => ({
                account: String(l.account || "").trim(),
                debit: round2(l.debit || 0), credit: round2(l.credit || 0)
            })).filter(l => l.debit > 0 || l.credit > 0);
            if (lines.length < 2) throw err(400, "A closing entry needs at least two lines.");
            let d = 0, c = 0;
            const out = lines.map(l => {
                const acc = byName(chart, l.account);
                if (!acc) throw err(400, `"${l.account}" is not in your chart of accounts.`);
                if (!["revenue", "expense", "equity"].includes(acc.account_type)) {
                    throw err(400, `Closing entries may only use revenue, expense and equity accounts (${l.account}).`);
                }
                if (l.debit > 0 && l.credit > 0) throw err(400, "A line cannot have both a debit and a credit.");
                d += l.debit; c += l.credit;
                return { name: acc.account_name, type: acc.account_type, debit: l.debit, credit: l.credit };
            });
            if (Math.abs(d - c) > 0.005) throw err(400, `Closing entry "${entry.description}" is not balanced.`);
            prepared.push({ description: String(entry.description || "Closing entry").slice(0, 300), lines: out });
        }

        // validate opening balances
        let od = 0, oc = 0;
        const ob = opening.map(o => {
            const acc = byName(chart, o.account);
            if (!acc) throw err(400, `"${o.account}" is not in your chart of accounts.`);
            if (!["asset", "liability", "equity"].includes(acc.account_type)) {
                throw err(400, "Opening balances may only contain asset, liability and equity accounts.");
            }
            const row = { name: acc.account_name, type: acc.account_type,
                          debit: round2(o.debit || 0), credit: round2(o.credit || 0) };
            od += row.debit; oc += row.credit;
            return row;
        });
        if (Math.abs(od - oc) > 0.005) throw err(400, "The carried-forward balances do not balance.");

        // claim the closing row (in_progress) — the unique index stops duplicates
        const claim = await client.query(
            `INSERT INTO year_end_closings (user_id, fiscal_year_start, fiscal_year_end, status)
             VALUES ($1, $2, $3, 'in_progress')
             ON CONFLICT (user_id, fiscal_year_start) WHERE status IN ('in_progress','complete')
             DO UPDATE SET updated_at = now()
             RETURNING id`, [userId, s, e]);
        const closingId = claim.rows[0].id;

        const entryIds = [];
        for (const p of prepared) {
            const ins = await client.query(
                `INSERT INTO adjusting_entries (user_id, entry_date, adjustment_type, description)
                 VALUES ($1, $2, 'closing', $3) RETURNING id`, [userId, e, p.description]);
            const id = ins.rows[0].id;
            entryIds.push(id);
            for (const l of p.lines) {
                await client.query(
                    `INSERT INTO adjusting_entry_lines (entry_id, account_name, account_type, debit, credit)
                     VALUES ($1, $2, $3, $4, $5)`, [id, l.name, l.type, l.debit, l.credit]);
            }
        }

        for (const o of ob) {
            await client.query(
                `INSERT INTO opening_balances (user_id, closing_id, as_of, account_name, account_type, debit, credit)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [userId, closingId, e, o.name, o.type, o.debit, o.credit]);
        }

        let reportId = null;
        if (body.report && body.report.data) {
            const rep = await client.query(
                `INSERT INTO saved_reports (user_id, report_type, title, start_date, end_date, data, created_by)
                 VALUES ($1, 'year_end_statements', $2, $3, $4, $5, $1) RETURNING id`,
                [userId, String(body.report.title || "Year-end statements").slice(0, 200), s, e,
                 JSON.stringify(body.report.data)]);
            reportId = rep.rows[0].id;
        }

        await client.query(
            `UPDATE accounting_periods SET status = 'closed', closing_status = 'complete', updated_at = now()
             WHERE user_id = $1 AND fiscal_year_start = $2`, [userId, s]);

        await client.query(
            `UPDATE year_end_closings
             SET status = 'complete', entry_ids = $2, net_income = $3, report_id = $4,
                 closed_at = now(), closed_by = $5, updated_at = now()
             WHERE id = $1`,
            [closingId, entryIds, body.net_income == null ? null : round2(body.net_income), reportId, userId]);

        await audit(client, userId, "year_closed", "year_end_closings", closingId,
            { fiscal_year_start: s, fiscal_year_end: e, entries: entryIds.length,
              net_income: body.net_income == null ? null : round2(body.net_income) });

        await client.query("COMMIT");
        res.status(201).json({ closing: { id: closingId, fiscal_year_start: s, fiscal_year_end: e,
                                          status: "complete", entry_ids: entryIds } });

    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        if (e.status) return res.status(e.status).json({ error: e.message });
        console.error(e);
        res.status(500).json({ error: "Could not close the year. Nothing was changed." });
    } finally {
        client.release();
    }
});

// ---- reopen ---------------------------------------------------------------
// body: { reason, confirm: "REOPEN" }

router.post("/:id/reopen", async (req, res) => {

    const userId = userIdOf(req);
    const { reason, confirm } = req.body || {};

    if (confirm !== "REOPEN") return res.status(400).json({ error: 'Type REOPEN to confirm.' });
    if (!String(reason || "").trim()) return res.status(400).json({ error: "A reason is required." });

    const client = await db.connect();

    try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["close:" + userId]);

        const c = await client.query(
            `SELECT id, status, fiscal_year_start::text AS s, fiscal_year_end::text AS e, entry_ids
             FROM year_end_closings WHERE id = $1 AND user_id = $2 FOR UPDATE`,
            [req.params.id, userId]);
        if (!c.rowCount) throw err(404, "Closing not found.");
        const closing = c.rows[0];
        if (closing.status !== "complete") throw err(409, "Only a closed year can be reopened.");

        const later = await client.query(
            `SELECT 1 FROM year_end_closings WHERE user_id = $1 AND status = 'complete'
             AND fiscal_year_start > $2::date LIMIT 1`, [userId, closing.s]);
        if (later.rowCount) throw err(409, "A later year is closed. Reopen the most recent closed year first.");

        // unlock first, then post the reversal
        await client.query(
            `UPDATE year_end_closings SET status = 'reopened', reopened_at = now(), reopened_by = $2,
                    reopen_reason = $3, updated_at = now() WHERE id = $1`,
            [closing.id, userId, String(reason).trim()]);

        const src = await client.query(
            `SELECT e.id, e.description, l.account_name, l.account_type, l.debit, l.credit
             FROM adjusting_entries e JOIN adjusting_entry_lines l ON l.entry_id = e.id
             WHERE e.id = ANY($1::uuid[]) AND e.user_id = $2 ORDER BY e.created_at, e.id`,
            [closing.entry_ids, userId]);

        const grouped = new Map();
        src.rows.forEach(r => {
            if (!grouped.has(r.id)) grouped.set(r.id, { description: r.description, lines: [] });
            grouped.get(r.id).lines.push(r);
        });

        const reversalIds = [];
        for (const g of grouped.values()) {
            const ins = await client.query(
                `INSERT INTO adjusting_entries (user_id, entry_date, adjustment_type, description)
                 VALUES ($1, $2, 'closing_reversal', $3) RETURNING id`,
                [userId, closing.e, "Reversal of: " + g.description]);
            reversalIds.push(ins.rows[0].id);
            for (const l of g.lines) {
                await client.query(
                    `INSERT INTO adjusting_entry_lines (entry_id, account_name, account_type, debit, credit)
                     VALUES ($1, $2, $3, $4, $5)`,
                    [ins.rows[0].id, l.account_name, l.account_type, l.credit, l.debit]);
            }
        }

        await client.query(
            `UPDATE year_end_closings SET reversal_entry_ids = $2 WHERE id = $1`, [closing.id, reversalIds]);
        await client.query(
            `UPDATE accounting_periods SET status = 'open', closing_status = 'not_started', updated_at = now()
             WHERE user_id = $1 AND fiscal_year_start = $2`, [userId, closing.s]);

        await audit(client, userId, "year_reopened", "year_end_closings", closing.id,
            { fiscal_year_start: closing.s, reason: String(reason).trim(), reversals: reversalIds.length });

        await client.query("COMMIT");
        res.json({ closing: { id: closing.id, status: "reopened", reversal_entry_ids: reversalIds } });

    } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        if (e.status) return res.status(e.status).json({ error: e.message });
        console.error(e);
        res.status(500).json({ error: "Could not reopen the year. Nothing was changed." });
    } finally {
        client.release();
    }
});

module.exports = router;