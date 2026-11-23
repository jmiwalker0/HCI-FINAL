// Depreciation planning (pure functions, no database).
//
// Existing rows in asset_depreciation (pending or approved) cover whole
// months. A month is never depreciated twice, even when a monthly report
// and a quarterly report overlap: only months with no row yet are planned,
// and each run of consecutive new months becomes one row.

const round2 = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const monthStart = dateStr => String(dateStr).slice(0, 7) + "-01";

function nextMonth(month) {
    const [year, mon] = month.split("-").map(Number);
    return new Date(Date.UTC(year, mon, 1)).toISOString().slice(0, 10);
}

function monthEnd(month) {
    const [year, mon] = month.split("-").map(Number);
    return new Date(Date.UTC(year, mon, 0)).toISOString().slice(0, 10);
}

// asset: { cost, residual_value, useful_life_months, method, declining_rate,
//          opening_accumulated, depreciation_start_date, acquisition_date,
//          disposal_date }
// rows:  [{ period_start, period_end, depreciation_expense }]
function planDepreciation(asset, rows, periodStart, periodEnd) {

    const cost = Number(asset.cost);
    const residual = Number(asset.residual_value);
    const depreciable = round2(cost - residual);
    const life = Number(asset.useful_life_months);
    const opening = Number(asset.opening_accumulated) || 0;

    const first = monthStart(
        asset.depreciation_start_date > asset.acquisition_date
            ? asset.depreciation_start_date
            : asset.acquisition_date
    );

    const last = asset.disposal_date ? monthStart(asset.disposal_date) : null;

    const rate = asset.method === "declining_balance"
        ? Number(asset.declining_rate) || (2 / (life / 12))
        : null;

    // months already covered by an existing row
    const covered = new Set();

    (rows || []).forEach(row => {
        const to = monthStart(row.period_end);
        for (let m = monthStart(row.period_start); m <= to; m = nextMonth(m)) {
            covered.add(m);
        }
    });

    const accumulatedBefore = (month, addedSoFar) => {

        let total = opening + addedSoFar;

        (rows || []).forEach(row => {
            if (monthStart(row.period_end) < month) {
                total += Number(row.depreciation_expense);
            }
        });

        return round2(total);
    };

    const fromMonth = monthStart(periodStart);
    const toMonth = monthStart(periodEnd);

    const months = [];
    let added = 0;

    for (let m = fromMonth; m <= toMonth; m = nextMonth(m)) {

        if (m < first) continue;
        if (last && m > last) continue;
        if (covered.has(m)) continue;

        const accumulated = accumulatedBefore(m, added);
        const remaining = round2(depreciable - accumulated);

        if (remaining <= 0) continue;

        let amount = rate === null
            ? depreciable / life
            : (cost - accumulated) * rate / 12;

        amount = Math.min(round2(amount), remaining);

        if (amount <= 0) continue;

        months.push({ month: m, amount });

        added = round2(added + amount);
    }

    // Group consecutive months into rows.
    const chunks = [];

    months.forEach(item => {

        const open = chunks[chunks.length - 1];

        if (open && nextMonth(open.lastMonth) === item.month) {
            open.lastMonth = item.month;
            open.expense = round2(open.expense + item.amount);
        } else {
            chunks.push({
                firstMonth: item.month,
                lastMonth: item.month,
                expense: item.amount
            });
        }
    });

    // accumulated / carrying after each chunk
    let planned = 0;

    const result = chunks.map(chunk => {

        planned = round2(planned + chunk.expense);

        const priorRows = (rows || []).reduce((t, row) =>
            monthStart(row.period_end) < chunk.firstMonth
                ? t + Number(row.depreciation_expense)
                : t, 0);

        const accumulated = round2(opening + priorRows + planned);

        return {
            period_start: chunk.firstMonth,
            period_end: monthEnd(chunk.lastMonth),
            expense: chunk.expense,
            accumulated,
            carrying: round2(cost - accumulated)
        };
    });

    // Months before this period that were never depreciated.
    let skipped = 0;

    for (let m = first; m < fromMonth; m = nextMonth(m)) {
        if (last && m > last) break;
        if (!covered.has(m)) skipped++;
    }

    return {
        months,
        chunks: result,
        total: round2(months.reduce((t, x) => t + x.amount, 0)),
        skippedEarlierMonths: skipped
    };
}

module.exports = { planDepreciation, round2, monthStart, nextMonth, monthEnd };