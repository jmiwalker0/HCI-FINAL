// Shared helpers: chart-of-accounts lookups and journal-line validation.

const db = require("../db");

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const TYPES = ["asset", "liability", "equity", "revenue", "expense"];

function userIdOf(req) {
    return req.user.userId || req.user.id || req.user.user_id;
}

// The user's chart of accounts (their own accounts plus any shared ones).
async function loadChart(queryable, userId) {

    const result = await (queryable || db).query(
        `SELECT account_id, account_name, account_type, code, is_active
         FROM accounts
         WHERE user_id = $1 OR user_id IS NULL`,
        [userId]
    );

    return result.rows;
}

// First active account of `type` whose name matches a pattern.
// Patterns are tried in order, so put the most specific one first.
function findAccount(chart, type, patterns) {

    for (const pattern of patterns) {

        const match = chart.find(account =>
            account.is_active &&
            account.account_type === type &&
            pattern.test(account.account_name)
        );

        if (match) return match.account_name;
    }

    return "";
}

function byName(chart, name) {

    const key = String(name || "").trim().toLowerCase();

    if (!key) return null;

    return chart.find(
        account => account.account_name.toLowerCase() === key
    ) || null;
}

// A two-line journal. A blank account name means "not found in the chart";
// the entry cannot be approved until the person picks one.
function twoLines(debitName, debitType, creditName, creditType, amount, text) {

    const value = round2(amount);

    return [
        {
            account_name: debitName || "",
            account_type: debitType,
            debit: value,
            credit: 0,
            description: text
        },
        {
            account_name: creditName || "",
            account_type: creditType,
            debit: 0,
            credit: value,
            description: text
        }
    ];
}

// Checks lines against the chart and returns clean lines with the account
// type taken from the chart (never from the browser).
function validateLines(lines, chart) {

    if (!Array.isArray(lines) || lines.length < 2) {
        return { error: "An adjustment needs at least two lines." };
    }

    const clean = [];
    let debit = 0;
    let credit = 0;

    for (const line of lines) {

        const account = byName(chart, line.account_name);

        if (!account) {
            return {
                error: `"${line.account_name || "(blank)"}" is not in your Chart of Accounts. Choose an existing account.`
            };
        }

        if (!account.is_active) {
            return { error: `Account "${account.account_name}" is inactive.` };
        }

        const d = round2(line.debit);
        const c = round2(line.credit);

        if (!(d >= 0) || !(c >= 0) || (d > 0 && c > 0) || (d === 0 && c === 0)) {
            return {
                error: "Each line needs either a debit or a credit amount."
            };
        }

        debit = round2(debit + d);
        credit = round2(credit + c);

        clean.push({
            account_name: account.account_name,
            account_type: account.account_type,
            debit: d,
            credit: c,
            description: String(line.description || "")
        });
    }

    if (debit <= 0 || Math.abs(debit - credit) >= 0.005) {
        return {
            error: `Debits (${debit.toFixed(2)}) must equal credits (${credit.toFixed(2)}).`
        };
    }

    return { lines: clean, total: debit };
}

module.exports = {
    round2, TYPES, userIdOf, loadChart, findAccount, byName,
    twoLines, validateLines
};