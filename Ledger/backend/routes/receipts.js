const express = require("express");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
const db = require("../db");
const authenticate = require("../middleware/authMiddleware");

const router = express.Router();

router.use(authenticate);

// Server-side only: the service role key bypasses Storage policies,
// so never expose it to the frontend.
// Created on first use so a missing .env value doesn't crash the server.
let client = null;

function getSupabase() {

    if (!client) {

        const url = (process.env.SUPABASE_URL || "").trim();
        const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

        if (!url || !key) {
            throw new Error(
                "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env"
            );
        }

        client = createClient(url, key);
    }

    return client;
}

const supabase = {
    get storage() {
        return getSupabase().storage;
    }
};

const BUCKET = "receipts";
const SIGNED_URL_SECONDS = 60 * 60;
const MAX_BYTES = 4 * 1024 * 1024;

// GET all receipts (with temporary signed links)
router.get("/", async (req, res) => {
    try {
        const result = await db.query(
            `SELECT id, transaction_id, file_name, file_path, mime_type, uploaded_at
             FROM receipts
             WHERE user_id = $1
             ORDER BY uploaded_at DESC`,
            [req.user.userId]
        );

        const rows = result.rows;
        let urlByPath = {};

        if (rows.length) {
            const { data, error } = await supabase.storage
                .from(BUCKET)
                .createSignedUrls(rows.map(r => r.file_path), SIGNED_URL_SECONDS);

            if (error) throw error;

            urlByPath = Object.fromEntries(
                data.map(item => [item.path, item.signedUrl])
            );
        }

        res.json({
            receipts: rows.map(r => ({
                ...r,
                url: urlByPath[r.file_path] || null
            }))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to load receipts." });
    }
});

// UPLOAD receipt (frontend sends a base64 data URL in JSON)
router.post("/", async (req, res) => {
    try {
        const { file_name, mime_type, data, transaction_id } = req.body || {};

        const match = /^data:([^;]+);base64,(.+)$/s.exec(data || "");

        if (!file_name || !match) {
            return res.status(400).json({ error: "Invalid receipt upload." });
        }

        const buffer = Buffer.from(match[2], "base64");

        if (buffer.length > MAX_BYTES) {
            return res.status(413).json({
                error: "Receipt must be 4 MB or smaller."
            });
        }

        const contentType = mime_type || match[1];

        const safeName = String(file_name)
            .replace(/[^\w.\-]+/g, "_")
            .slice(-80);

        const path = `${req.user.userId}/${crypto.randomUUID()}-${safeName}`;

        // Only link to a transaction this user owns.
        let linkedId = null;

        if (transaction_id) {
            const owned = await db.query(
                "SELECT id FROM transactions WHERE id = $1 AND user_id = $2",
                [transaction_id, req.user.userId]
            );

            linkedId = owned.rows[0]?.id ?? null;
        }

        const upload = await supabase.storage
            .from(BUCKET)
            .upload(path, buffer, { contentType });

        if (upload.error) throw upload.error;

        const result = await db.query(
            `INSERT INTO receipts
             (user_id, transaction_id, file_name, file_path, mime_type)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, transaction_id, file_name, file_path, mime_type, uploaded_at`,
            [req.user.userId, linkedId, file_name, path, contentType]
        );

        const signed = await supabase.storage
            .from(BUCKET)
            .createSignedUrl(path, SIGNED_URL_SECONDS);

        res.status(201).json({
            receipt: {
                ...result.rows[0],
                url: signed.data?.signedUrl || null
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to save receipt." });
    }
});

// DELETE receipt (file + row)
router.delete("/:id", async (req, res) => {
    try {
        const found = await db.query(
            "SELECT file_path FROM receipts WHERE id = $1 AND user_id = $2",
            [req.params.id, req.user.userId]
        );

        if (!found.rows.length) {
            return res.status(404).json({ error: "Receipt not found." });
        }

        await supabase.storage
            .from(BUCKET)
            .remove([found.rows[0].file_path]);

        await db.query(
            "DELETE FROM receipts WHERE id = $1 AND user_id = $2",
            [req.params.id, req.user.userId]
        );

        res.json({ message: "Receipt deleted successfully." });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Unable to delete receipt." });
    }
});

module.exports = router;