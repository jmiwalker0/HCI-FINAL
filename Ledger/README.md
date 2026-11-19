# Ledger — Accounting Assistant and Automatic Ledger System

A browser-based prototype built from the supplied Figma design and aligned with the group's research scope.

## Run locally
1. Extract the ZIP.
2. Open the `ledger_web_app` folder in Visual Studio Code.
3. Open `index.html` in a browser, or use the VS Code Live Server extension.
4. The app starts with fictional sample transactions.

No build step or package installation is required.

## Included screens
- Dashboard
- Transactions
- Journal Entries
- General Ledger (added to support posting in the accounting workflow)
- Receipts
- Error Detection
- Reports
- Settings

## Working interactions
- Sidebar navigation and responsive mobile menu.
- Add income/expense transactions manually.
- Optional receipt attachment on transaction entry.
- Suggested basic debit/credit journal lines.
- Edit account names and debit/credit amounts.
- Approval is blocked if debits and credits do not balance.
- Approval posts the transaction into the General Ledger.
- Receipt upload, view, and remove.
- Search and filter transactions.
- Validation review screen.
- Reports calculated from approved transactions.
- Export transaction list to CSV.
- Browser localStorage persistence and reset demo data.

## Important limitations
- This is a local front-end prototype. Data stays in the browser where it is used.
- It is not connected to Supabase yet.
- Receipt extraction/OCR is not implemented; attaching a receipt stores the file, while the user enters transaction details.
- Suggested account mappings are basic examples and should be checked against your instructor's accounting rules and chart of accounts.
- The report page provides basic management summaries, not complete formal financial statements.
- It does not implement adjusting entries, closing entries, or trial balances.

## Next step: Supabase
The included `supabase/schema.sql` creates starter tables for profiles, transactions, journal entries, journal lines, and receipts. Review and adapt it before running it in your Supabase SQL Editor. Add authentication, Storage policies, and Row Level Security before using real business data.
