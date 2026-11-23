// One place to write audit rows. Rows can never be changed or deleted (see
// migration 004), so this is a permanent record of who did what and when.

async function audit(queryable, userId, eventType, entityType, entityId, details) {
    await queryable.query(
        `INSERT INTO audit_events (user_id, event_type, entity_type, entity_id, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, eventType, entityType || null, entityId || null, JSON.stringify(details || {})]
    );
}

module.exports = { audit };