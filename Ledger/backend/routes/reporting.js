const express = require("express");
const db = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const { audit } = require("../lib/audit");

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

const validDate = value =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) &&
    !Number.isNaN(Date.parse(value));

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

        const today = validDate(req.query.today)
            ? req.query.today
            : new Date().toISOString().slice(0, 10);

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
                 WHERE NOT EXISTS (
                    SELECT 1 FROM accounting_periods x
                    WHERE x.user_id = $1
                      AND x.frequency = p.frequency
                      AND x.start_date = p.start_date::date)`,
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
            [userId, settings.frequency, today]
        );

        const locked = await db.query(
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

        res.json({
            settings: {
                frequency: settings.frequency,
                fiscal_start_month: settings.fiscal_start_month,
                fiscal_start_locked: locked.rowCount > 0
            },
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

            const started = await client.query(
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

            if (started.rowCount > 0) {
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

        await audit(client, userId, "reporting_settings_changed", "reporting_settings", null,
            { frequency, fiscal_start_month: month });

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