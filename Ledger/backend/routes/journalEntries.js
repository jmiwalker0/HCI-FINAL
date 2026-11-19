
const express = require("express");
const router = express.Router();

const db = require("../db");
const authenticate = require("../middleware/authMiddleware");

router.use(authenticate);

const VALID_ACCOUNT_TYPES = [
    "asset",
    "liability",
    "equity",
    "revenue",
    "expense"
];

function detectAccountType(accountName) {
    const name = String(accountName || "").toLowerCase();

    if (name.includes("revenue") || name.includes("income")) {
        return "revenue";
    }

    if (
        name.includes("expense") ||
        name.includes("salaries") ||
        name.includes("cost of goods sold")
    ) {
        return "expense";
    }

    if (
        name.includes("payable") ||
        name.includes("liability") ||
        name.includes("loan")
    ) {
        return "liability";
    }

    if (
        name.includes("capital") ||
        name.includes("equity") ||
        name.includes("retained earnings")
    ) {
        return "equity";
    }

    return "asset";
}


/* =========================================
   GET ALL JOURNAL ENTRIES
   ========================================= */

router.get("/", async (req, res) => {
    try {
        const result = await db.query(
            `
            SELECT
                je.id,
                je.transaction_id,
                je.entry_date,
                je.description,
                je.status,

                COALESCE(
                    json_agg(
                        json_build_object(
                            'account_name', jl.account_name,
                            'account_type', jl.account_type,
                            'description', jl.description,
                            'debit', jl.debit,
                            'credit', jl.credit
                        )
                        ORDER BY jl.id
                    ) FILTER (WHERE jl.id IS NOT NULL),
                    '[]'::json
                ) AS lines

            FROM journal_entries je

            LEFT JOIN journal_lines jl
                ON jl.journal_entry_id = je.id

            WHERE je.user_id = $1

            GROUP BY je.id
            ORDER BY je.entry_date DESC
            `,
            [req.user.userId]
        );

        res.json(result.rows);

    } catch (error) {
        console.error("LOAD JOURNAL ERROR:", error);

        res.status(500).json({
            error: "Failed to load journal entries."
        });
    }
});


/* =========================================
   GET ONE JOURNAL ENTRY
   ========================================= */

router.get("/:transactionId", async (req, res) => {
    try {
        const result = await db.query(
            `
            SELECT
                je.id,
                je.transaction_id,
                je.entry_date,
                je.description,
                je.status,

                COALESCE(
                    json_agg(
                        json_build_object(
                            'account_name', jl.account_name,
                            'account_type', jl.account_type,
                            'description', jl.description,
                            'debit', jl.debit,
                            'credit', jl.credit
                        )
                        ORDER BY jl.id
                    ) FILTER (WHERE jl.id IS NOT NULL),
                    '[]'::json
                ) AS lines

            FROM journal_entries je

            LEFT JOIN journal_lines jl
                ON jl.journal_entry_id = je.id

            WHERE je.transaction_id = $1
            AND je.user_id = $2

            GROUP BY je.id
            `,
            [req.params.transactionId, req.user.userId]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                error: "Journal entry not found."
            });
        }

        res.json(result.rows[0]);

    } catch (error) {
        console.error("GET JOURNAL ERROR:", error);

        res.status(500).json({
            error: "Failed to retrieve journal entry."
        });
    }
});


/* =========================================
   SAVE JOURNAL AND UPDATE TRANSACTION
   ========================================= */

router.put("/:transactionId", async (req, res) => {
    let client;
    let transactionStarted = false;

    try {
        const { transactionId } = req.params;
        const { lines, transaction: transactionDetails = {} } = req.body;
        const userId = req.user.userId;

        if (!Array.isArray(lines) || lines.length < 2) {
            return res.status(400).json({
                error: "A journal entry must contain at least two lines."
            });
        }

        const normalizedLines = lines.map(line => {
            const account = String(
                line.account_name ?? line.account ?? ""
            ).trim();

            const accountType = String(
                line.account_type ??
                line.accountType ??
                detectAccountType(account)
            ).toLowerCase().trim();

            const description = String(
                line.description ?? ""
            ).trim();

            const debit = Number(line.debit ?? 0);
            const credit = Number(line.credit ?? 0);

            if (
                !account ||
                !VALID_ACCOUNT_TYPES.includes(accountType) ||
                !Number.isFinite(debit) ||
                !Number.isFinite(credit) ||
                debit < 0 ||
                credit < 0 ||
                (debit > 0 && credit > 0) ||
                (debit === 0 && credit === 0)
            ) {
                const error = new Error(
                    "Invalid journal line. Check ACCOUNT, ACCOUNT TYPE, DEBIT and CREDIT."
                );

                error.statusCode = 400;
                throw error;
            }

            return {
                account,
                accountType,
                description,
                debit,
                credit
            };
        });

        const totalDebit = normalizedLines.reduce(
            (sum, line) => sum + line.debit,
            0
        );

        const totalCredit = normalizedLines.reduce(
            (sum, line) => sum + line.credit,
            0
        );

        if (Math.abs(totalDebit - totalCredit) > 0.005) {
            return res.status(400).json({
                error: "DEBIT and CREDIT totals must balance."
            });
        }

        client = await db.connect();

        await client.query("BEGIN");
        transactionStarted = true;


        /* CHECK TRANSACTION OWNERSHIP */

        const transactionResult = await client.query(
            `
            SELECT
                id,
                transaction_date,
                description,
                category,
                type,
                amount

            FROM transactions

            WHERE id = $1
            AND user_id = $2

            FOR UPDATE
            `,
            [transactionId, userId]
        );

        if (!transactionResult.rows.length) {
            const error = new Error("Transaction not found.");
            error.statusCode = 404;
            throw error;
        }

        const original = transactionResult.rows[0];


        /* CALCULATE TRANSACTION FROM JOURNAL LINES */

        const revenueTotal = normalizedLines
            .filter(line => line.accountType === "revenue")
            .reduce(
                (sum, line) => sum + line.credit - line.debit,
                0
            );

        const expenseTotal = normalizedLines
            .filter(line => line.accountType === "expense")
            .reduce(
                (sum, line) => sum + line.debit - line.credit,
                0
            );

        let updatedType = original.type;
        let updatedAmount = Number(original.amount);

        if (revenueTotal > 0) {
            updatedType = "income";
            updatedAmount = revenueTotal;
        } else if (expenseTotal > 0) {
            updatedType = "expense";
            updatedAmount = expenseTotal;
        }

        const updatedDate =
            transactionDetails.date ||
            original.transaction_date;

        const updatedDescription =
            String(
                transactionDetails.description ??
                original.description
            ).trim();

        const updatedCategory =
            String(
                transactionDetails.category ??
                original.category
            ).trim();

        if (!updatedDescription || !updatedCategory) {
            const error = new Error(
                "Transaction description and category are required."
            );
            error.statusCode = 400;
            throw error;
        }


        /* CREATE OR UPDATE JOURNAL ENTRY */

        const entryResult = await client.query(
            `
            INSERT INTO journal_entries (
                transaction_id,
                user_id,
                entry_date,
                description,
                status
            )

            VALUES ($1, $2, $3, $4, 'posted')

            ON CONFLICT (transaction_id)

            DO UPDATE SET
                entry_date = EXCLUDED.entry_date,
                description = EXCLUDED.description,
                status = 'posted'

            WHERE journal_entries.user_id = EXCLUDED.user_id

            RETURNING id
            `,
            [
                transactionId,
                userId,
                updatedDate,
                updatedDescription
            ]
        );

        if (!entryResult.rows.length) {
            throw new Error(
                "Unable to save this journal entry."
            );
        }

        const journalEntryId = entryResult.rows[0].id;


        /* DELETE OLD JOURNAL LINES */

        await client.query(
            `
            DELETE FROM journal_lines
            WHERE journal_entry_id = $1
            `,
            [journalEntryId]
        );


        /* INSERT UPDATED JOURNAL LINES */

        for (const line of normalizedLines) {
            await client.query(
                `
                INSERT INTO journal_lines (
                    journal_entry_id,
                    account_name,
                    account_type,
                    description,
                    debit,
                    credit
                )

                VALUES ($1, $2, $3, $4, $5, $6)
                `,
                [
                    journalEntryId,
                    line.account,
                    line.accountType,
                    line.description,
                    line.debit,
                    line.credit
                ]
            );
        }


        /* UPDATE ORIGINAL TRANSACTION */

        await client.query(
            `
            UPDATE transactions

            SET
                transaction_date = $1,
                description = $2,
                category = $3,
                type = $4,
                amount = $5,
                updated_at = NOW()

            WHERE id = $6
            AND user_id = $7
            `,
            [
                updatedDate,
                updatedDescription,
                updatedCategory,
                updatedType,
                updatedAmount,
                transactionId,
                userId
            ]
        );


        /* COMMIT EVERYTHING */

        await client.query("COMMIT");
        transactionStarted = false;

        res.json({
            success: true,
            message: "Journal and transaction updated successfully.",
            journalEntryId,
            transaction: {
                id: transactionId,
                date: updatedDate,
                description: updatedDescription,
                category: updatedCategory,
                type: updatedType,
                amount: updatedAmount
            },
            totals: {
                debit: totalDebit,
                credit: totalCredit
            }
        });

    } catch (error) {
        if (client && transactionStarted) {
            await client.query("ROLLBACK").catch(() => {});
        }

        console.error("SAVE JOURNAL ERROR:", error);

        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message || "Failed to save journal entry."
        });

    } finally {
        if (client) {
            client.release();
        }
    }
});


module.exports = router;
