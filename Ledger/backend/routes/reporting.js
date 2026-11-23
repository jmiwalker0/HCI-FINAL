const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authMiddleware);

const FREQUENCIES = ["monthly", "quarterly", "yearly"];
const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

// The login token's payload is the user. Accept the usual key names.
function userIdOf(req) {
    return req.user.userId || req.user.id || req.user.user_id;
}

/* =====================================
   PERIOD CALCULATION (pure, no database)
   ===================================== */

const isoDate = ms => new Date(ms).toISOString().slice(0, 10);

const firstOfMonth = (year, monthIndex) =>
    Date.UTC(year, monthIndex, 1);

const lastOfMonth = (year, monthIndex) =>
    Date.UTC(year, monthIndex + 1, 0);

// Year in which the fiscal year containing `dateStr` began.
function fiscalYearOf(dateStr, startMonth) {
    const year = Number(dateStr.slice(0, 4));
    const month = Number(dateStr.slice(5, 7));
    return month >= startMonth ? year : year - 1;
}

function fiscalLabel(startYear, startMonth) {
    return startMonth === 1
        ? `FY ${startYear}`
        : `FY ${startYear}-${startYear + 1}`;
}

// Every period of one frequency inside one fiscal year.
function periodsInFiscalYear(frequency, startYear, startMonth) {

    const months = { monthly: 1, quarterly: 3, yearly: 12 }[frequency];
    const count = 12 / months;
    const fiscalStart = isoDate(firstOfMonth(startYear, startMonth - 1));
    const result = [];

    for (let i = 0; i < count; i++) {

        const monthIndex = startMonth - 1 + i * months;

        const startMs = firstOfMonth(startYear, monthIndex);
        const endMs = lastOfMonth(startYear, monthIndex + months - 1);

        const startD = new Date(startMs);
        const endD = new Date(endMs);

        let label;

        if (frequency === "monthly") {
            label = `${MONTHS[startD.getUTCMonth()]} ${startD.getUTCFullYear()}`;
        } else if (frequency === "quarterly") {
            label = `Q${i + 1} ${fiscalLabel(startYear, startMonth)}`;
        } else {
            label = fiscalLabel(startYear, startMonth);
        }

        result.push({
            frequency,
            label,
            start_date: isoDate(startMs),
            end_date: isoDate(endMs),
            fiscal_year_start: fiscalStart
        });
    }

    return result;
}

// All periods from the fiscal year of `earliest` up to the one
// containing `today`. Never returns future periods.
function buildPeriods(frequency, startMonth, earliest, today) {

    const firstYear = Math.max(
        fiscalYearOf(earliest, startMonth),
        fiscalYearOf(today, startMonth) - 9   // at most 10 fiscal years
    );

    const lastYear = fiscalYearOf(today, startMonth);

    const all = [];

    for (let y = firstYear; y <= lastYear; y++) {
        all.push(...periodsInFiscalYear(frequency, y, startMonth));
    }

    return all.filter(p => p.start_date <= today);
}

// Strict: rejects impossible dates such as 2026-02-31 (JS parses those
// leniently, but Postgres would reject them with a 500).
const validDate = value => {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const ms = Date.parse(text);
    return !Number.isNaN(ms) && isoDate(ms) === text;
};

// The client may send its own "today" so the right period shows across
// time zones (e.g. Philippines is UTC+8). Anything more than a day away
// from the server's date is ignored, so a bad value can never create
// far-future period rows.
function resolveToday(requested) {
    const serverToday = isoDate(Date.now());
    if (!validDate(requested)) return serverToday;
    const diffDays = Math.abs(Date.parse(requested) - Date.parse(serverToday)) / 864e5;
    return diffDays <= 1 ? requested : serverToday;
}

// Has any period-end work started? Checks the status columns AND the
// work tables, so a missed status update can never allow a delete that
// would fail on a foreign key or destroy real work.
const WORK_TABLES = ["period_adjustments", "reconciliations"];

async function periodWorkStarted(q, userId) {

    const status = await q.query(
        `SELECT 1 FROM accounting_periods
         WHERE user_id = $1
           AND (status <> 'open'
             OR reconciliation_status <> 'not_started'
             OR adjusted_tb_status <> 'not_started'
             OR statements_status <> 'not_started'
             OR closing_status <> 'not_started')
         LIMIT 1`,
        [userId]
    );

    if (status.rowCount > 0) return true;

    for (const table of WORK_TABLES) {

        // These tables arrive with a later migration; skip if absent.
        const exists = await q.query("SELECT to_regclass($1) AS t", [`public.${table}`]);
        if (!exists.rows[0].t) continue;

        const rows = await q.query(
            `SELECT 1 FROM public.${table} WHERE user_id = $1 LIMIT 1`,
            [userId]
        );

        if (rows.rowCount > 0) return true;
    }

    return false;
}

/* =====================================
   LOAD SETTINGS + PERIODS
   GET /api/reporting?today=YYYY-MM-DD
   ===================================== */

router.get("/", async (req, res) => {

    const userId = userIdOf(req);

    try {

        await db.query(
            `INSERT INTO reporting_settings (user_id)
             VALUES ($1)
             ON CONFLICT (user_id) DO NOTHING`,
            [userId]
        );

        const settingsResult = await db.query(
            `SELECT frequency, fiscal_start_month
             FROM reporting_settings WHERE user_id = $1`,
            [userId]
        );

        const settings = settingsResult.rows[0];

        const today = resolveToday(req.query.today);

        // Fix 1: any frequency's stored history can be viewed. Only the
        // current frequency ever generates new period rows.
        const viewFrequency = FREQUENCIES.includes(req.query.frequency)
            ? req.query.frequency
            : settings.frequency;

        const earliestResult = await db.query(
            `SELECT LEAST(
                (SELECT MIN(transaction_date) FROM transactions WHERE user_id = $1),
                (SELECT MIN(entry_date) FROM adjusting_entries WHERE user_id = $1)
             )::text AS earliest`,
            [userId]
        );

        const earliest = earliestResult.rows[0].earliest || today;

        const periods = buildPeriods(
            settings.frequency,
            settings.fiscal_start_month,
            earliest,
            today
        );

        // Make sure every period has a status row (never overwrites one).
        if (periods.length) {

            await db.query(
                `INSERT INTO accounting_periods
                    (user_id, frequency, label, start_date, end_date, fiscal_year_start)
                 SELECT $1, p.frequency, p.label, p.start_date::date,
                        p.end_date::date, p.fiscal_year_start::date
                 FROM jsonb_to_recordset($2::jsonb) AS p(
                    frequency text, label text, start_date text,
                    end_date text, fiscal_year_start text)
                 ON CONFLICT (user_id, frequency, start_date) DO NOTHING`,
                [userId, JSON.stringify(periods)]
            );
        }

        const stored = await db.query(
            `SELECT id, frequency, label, start_date::text AS start_date,
                    end_date::text AS end_date,
                    fiscal_year_start::text AS fiscal_year_start,
                    status, reconciliation_status, adjusted_tb_status,
                    statements_status, closing_status
             FROM accounting_periods
             WHERE user_id = $1 AND frequency = $2
               AND start_date <= $3::date
             ORDER BY start_date`,
            [userId, viewFrequency, today]
        );

        const available = await db.query(
            `SELECT DISTINCT frequency FROM accounting_periods
             WHERE user_id = $1 AND start_date <= $2::date`,
            [userId, today]
        );

        const locked = await periodWorkStarted(db, userId);

        res.json({
            settings: {
                frequency: settings.frequency,
                fiscal_start_month: settings.fiscal_start_month,
                fiscal_start_locked: locked
            },
            viewing_frequency: viewFrequency,
            available_frequencies: FREQUENCIES.filter(f =>
                available.rows.some(r => r.frequency === f)),
            periods: stored.rows
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Could not load reporting periods." });
    }
});

/* =====================================
   SAVE SETTINGS
   PUT /api/reporting/settings
   Changing these never touches transactions or journal entries.
   ===================================== */

router.put("/settings", async (req, res) => {

    const userId = userIdOf(req);

    const frequency = String(req.body.frequency || "");
    const month = Number(req.body.fiscal_start_month);

    if (!FREQUENCIES.includes(frequency)) {
        return res.status(400).json({
            error: "Reporting frequency must be monthly, quarterly or yearly."
        });
    }

    if (!Number.isInteger(month) || month < 1 || month > 12) {
        return res.status(400).json({
            error: "Fiscal year start must be a month from 1 to 12."
        });
    }

    const client = await db.connect();

    try {

        await client.query("BEGIN");

        await client.query(
            `INSERT INTO reporting_settings (user_id)
             VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
            [userId]
        );

        const current = await client.query(
            `SELECT fiscal_start_month FROM reporting_settings
             WHERE user_id = $1 FOR UPDATE`,
            [userId]
        );

        if (current.rows[0].fiscal_start_month !== month) {

            const started = await periodWorkStarted(client, userId);

            if (started) {
                await client.query("ROLLBACK");
                return res.status(409).json({
                    error: "The fiscal year start cannot change after " +
                           "period-end work has started, because it would " +
                           "overlap existing reports."
                });
            }

            // Only untouched, auto-generated rows are replaced.
            await client.query(
                "DELETE FROM accounting_periods WHERE user_id = $1",
                [userId]
            );
        }

        await client.query(
            `UPDATE reporting_settings
             SET frequency = $2, fiscal_start_month = $3, updated_at = now()
             WHERE user_id = $1`,
            [userId, frequency, month]
        );

        await client.query("COMMIT");

        res.json({ message: "Reporting settings saved." });

    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        console.error(error);
        res.status(500).json({ error: "Could not save reporting settings." });
    } finally {
        client.release();
    }
});

module.exports = router;
module.exports.buildPeriods = buildPeriods;