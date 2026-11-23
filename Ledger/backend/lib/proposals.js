// Shared query + shape for proposed adjustments.

const SELECT_PROPOSALS = `
    SELECT pa.id, pa.period_id, ap.label AS period_label,
           ap.start_date::text AS period_start, ap.end_date::text AS period_end,
           ap.status AS period_status,
           pa.source, pa.description, pa.reason,
           pa.entry_date::text AS entry_date, pa.lines, pa.meta, pa.status,
           pa.decision_note, pa.decided_at, pa.created_at
    FROM period_adjustments pa
    JOIN accounting_periods ap ON ap.id = pa.period_id
    WHERE pa.user_id = $1`;

module.exports = { SELECT_PROPOSALS };