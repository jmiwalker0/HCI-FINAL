// =========================================================
// LEDGER — ACCOUNTING ASSISTANT
// OBJECT-ORIENTED PROGRAMMING VERSION
// FRONTEND: JAVASCRIPT
// BACKEND: EXPRESS + POSTGRESQL
// =========================================================


// =========================================================
// 1. UTILITIES
// =========================================================

class LedgerUtils {

    static API_BASE =
    ["localhost", "127.0.0.1"].includes(window.location.hostname)
        ? `http://${window.location.hostname}:3000/api`
        : "https://hci-final-lgrl.onrender.com/api";
    static TOKEN_KEY = "ledger-token";
    static USER_KEY = "ledger-user";

    static ACCOUNT_TYPES = [
        "asset",
        "liability",
        "equity",
        "revenue",
        "expense"
    ];

    // Transaction types and the categories each one offers.
    // "inflow" decides the +/− sign and colour in the transaction table.
    static TRANSACTION_TYPES = {
        purchase: {
            label: "Purchase",
            help: "Buying goods to resell. Adds to your inventory (it is not counted as an expense).",
            inflow: false,
            stock: "in",
            categories: ["Inventory Purchase"]
        },
        sale: {
            label: "Sale",
            help: "Selling goods from your inventory. Records the sales revenue and deducts the stock.",
            inflow: true,
            stock: "out",
            categories: ["Sales Revenue"]
        },
        service_income: {
            label: "Service Income",
            help: "Money earned from services. Does not affect inventory.",
            inflow: true,
            categories: [
                "Service Revenue",
                "Other Income"
            ]
        },
        expense: {
            label: "Expense",
            help: "Day-to-day costs such as rent or utilities. Does not affect inventory.",
            inflow: false,
            categories: [
                "Office Supplies",
                "Utilities",
                "Transportation",
                "Rent Expense",
                "Salaries Expense",
                "Repairs and Maintenance",
                "Other Expense"
            ]
        },
        investment: {
            label: "Owner's Investment",
            help: "Money the owner puts into the business.",
            inflow: true,
            categories: ["Owner's Investment"]
        },
        withdrawal: {
            label: "Owner's Withdrawal",
            help: "Money the owner takes out of the business.",
            inflow: false,
            categories: ["Owner's Withdrawal"]
        }
    };

    // The four choices people see when they record a transaction.
    // Each category is mapped onto one of the database types above.
    static ENTRY_TYPES = {
        received: {
            label: "Money Received",
            description: "Record money received from sales, customers, or other sources.",
            categories: [
                { name: "Product Sale", dbType: "sale" },
                { name: "Service Income", dbType: "service_income" },
                { name: "Other Income", dbType: "service_income" }
            ]
        },
        purchase: {
            label: "Purchase",
            description: "Record products, supplies, or equipment bought for the business.",
            categories: [
                { name: "Inventory", dbType: "purchase" },
                { name: "Supplies", dbType: "purchase" },
                { name: "Equipment", dbType: "purchase" },
                { name: "Other Purchase", dbType: "purchase" }
            ]
        },
        expense: {
            label: "Business Expense",
            description: "Record expenses such as rent, electricity, and salaries.",
            categories: [
                { name: "Rent", dbType: "expense" },
                { name: "Utilities", dbType: "expense" },
                { name: "Salaries", dbType: "expense" },
                { name: "Advertising", dbType: "expense" },
                { name: "Repairs", dbType: "expense" },
                { name: "Other Expense", dbType: "expense" }
            ]
        },
        owner: {
            label: "Owner Contribution / Withdrawal",
            description: "Record personal money added to or taken from the business.",
            categories: [
                { name: "Owner Investment", dbType: "investment" },
                { name: "Owner Withdrawal", dbType: "withdrawal" }
            ]
        }
    };

    // Which of the four choices a saved (database) type belongs to.
    static entryTypeOf(dbType) {

        if (["sale", "service_income", "income"].includes(dbType)) return "received";
        if (dbType === "purchase") return "purchase";
        if (["investment", "withdrawal"].includes(dbType)) return "owner";

        return "expense";
    }


    // "in" (purchase), "out" (sale) or null (no inventory effect)
    static stockEffect(type) {
        return LedgerUtils.TRANSACTION_TYPES[type]?.stock || null;
    }

    static isInflow(type) {
        return LedgerUtils.TRANSACTION_TYPES[type]?.inflow ??
            ["income", "sale", "service_income"].includes(type);
    }

    static typeLabel(type) {
        return LedgerUtils.ENTRY_TYPES[LedgerUtils.entryTypeOf(type)].label;
    }

    static typeOptions(selected) {
        return Object.entries(LedgerUtils.ENTRY_TYPES)
            .map(([value, config]) => `
                <option value="${value}" ${value === selected ? "selected" : ""}>
                    ${config.label}
                </option>
            `).join("");
    }

    static peso(amount) {
        return new Intl.NumberFormat("en-PH", {
            style: "currency",
            currency: "PHP",
            maximumFractionDigits: 2
        }).format(Number(amount) || 0);
    }

    static today() {
        const now = new Date();

        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, "0");
        const day = String(now.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    static escape(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;"
        }[char]));
    }

        // -----------------------------------------------------
    // CHART OF ACCOUNTS (loaded from the server)
    // -----------------------------------------------------

    static chart = [];

    static ACCOUNT_TYPE_LABELS = {
        asset: "Assets",
        liability: "Liabilities",
        equity: "Equity",
        revenue: "Revenue",
        expense: "Expenses"
    };

    static findAccount(name) {

        const key = String(name || "").trim().toLowerCase();

        if (!key) return null;

        return LedgerUtils.chart.find(
            account =>
                account.account_name.toLowerCase() === key
        ) || null;
    }

    static accountSelectOptions(selected) {

        const current = String(selected || "").trim();

        const known = LedgerUtils.findAccount(current);

        const groups = LedgerUtils.ACCOUNT_TYPES.map(type => {

            const options = LedgerUtils.chart
                .filter(account =>
                    account.account_type === type &&
                    (
                        account.is_active ||
                        (known && account.account_id === known.account_id)
                    )
                )
                .map(account => `
                    <option
                        value="${LedgerUtils.escape(account.account_name)}"
                        ${known && account.account_id === known.account_id ? "selected" : ""}
                    >
                        ${LedgerUtils.escape(account.code)}
                        ${LedgerUtils.escape(account.account_name)}
                    </option>
                `).join("");

            return options
                ? `<optgroup label="${LedgerUtils.ACCOUNT_TYPE_LABELS[type]}">${options}</optgroup>`
                : "";

        }).join("");

        const blank = current
            ? ""
            : `<option value="" selected disabled>Select account</option>`;

        const missing = current && !known
            ? `<option value="${LedgerUtils.escape(current)}" selected>${LedgerUtils.escape(current)} (not in chart)</option>`
            : "";

        return blank + missing + groups;
    }

    static accountTypeFor(accountName) {

        // The chart of accounts is the source of truth.
        const account = LedgerUtils.findAccount(accountName);

        if (account) {
            return account.account_type;
        }

        // Fallback for names not in the chart (or chart not loaded).
        const name = String(accountName || "").toLowerCase();


        if (
            name.includes("revenue") ||
            name.includes("income")
        ) {
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

    static accountTypeOptions(selected) {
        return this.ACCOUNT_TYPES.map(type => `
            <option
                value="${type}"
                ${type === selected ? "selected" : ""}
            >
                ${type.toUpperCase()}
            </option>
        `).join("");
    }

    static toast(message, type = "") {
        const region = document.getElementById("toastRegion");

        if (!region) return;

        const element = document.createElement("div");

        element.className = "toast " + type;
        element.textContent = message;

        region.append(element);

        window.setTimeout(() => {
            element.remove();
        }, 3200);
    }

    static badge(status) {
        if (status === "review") {
            return `
                <span class="badge review">
                    NEEDS REVIEW
                </span>
            `;
        }

        return `
            <span class="badge approved">
                POSTED
            </span>
        `;
    }

    static heading(title, subtitle, action = "") {
        return `
            <div class="page-heading">
                <div>
                    <p class="eyebrow">LEDGER WORKSPACE</p>
                    <h1>${title}</h1>
                    <p class="subtitle">${subtitle}</p>
                </div>

                ${action}
            </div>
        `;
    }

    static metric(label, value, foot, icon) {
        return `
            <div class="card">
                <span class="metric-icon">${icon}</span>

                <div class="metric-label">
                    ${label}
                </div>

                <div class="metric-value">
                    ${value}
                </div>

                <div class="metric-foot">
                    ${foot}
                </div>
            </div>
        `;
    }

    static csvEscape(value) {
        return `"${String(value ?? "").replace(/"/g, '""')}"`;
    }
}


// =========================================================
// 2. APPLICATION STATE
// =========================================================

class LedgerState {

    constructor() {

        this.transactions = [];
        this.receipts = [];
        this.inventory = [];
        this.inventoryMovements = [];

        // Fixed assets + supplies registers
        this.fixedAssets = [];
        this.editingAssetId = null;
        this.assetFormOpen = false;
        this.supplies = [];
        this.editingSupplyId = null;
        this.supplyFormOpen = false;

        this.adjustments = [];
                this.journalEdits = {};

        // Chart of accounts
        this.accounts = [];
        this.editingAccountId = null;
        this.showInactiveAccounts = false;

        this.currentPage = "dashboard";

        // Financial statements: account groups and saved reports
        this.accountClasses = new Map();
        this.savedReports = [];
        this.viewedReport = null;

        // Journal entry to scroll to after opening the Journal page
        this.focusJournalId = null;

        this.currentUser = null;
        this.authMode = "login";

        // Dashboard: This Week / This Month / This Year
        this.dashboardRange = "month";
        this.cashFlowRange = "month";
        this.payingId = null;

        // Who each transaction was with and what has been paid
        this.details = new Map();
        this.payments = [];
    }


    setTransactions(transactions) {

        this.transactions = transactions.map(transaction => ({
            ...transaction,

            id: String(transaction.id),

            date: String(
                transaction.date ||
                transaction.transaction_date ||
                ""
            ).slice(0, 10),

            amount: Number(transaction.amount) || 0,

            status:
                transaction.status === "review"
                    ? "review"
                    : "approved"
        }));
    }


    setJournalEntries(entries) {

        const savedEdits = {};

        entries.forEach(entry => {

            savedEdits[String(entry.transaction_id)] =
                (entry.lines || []).map(line => ({

                    account: line.account_name,

                    accountType:
                        line.account_type ||
                        LedgerUtils.accountTypeFor(
                            line.account_name
                        ),

                    description: line.description || "",

                    debit: Number(line.debit) || 0,

                    credit: Number(line.credit) || 0

                }));
        });

        this.journalEdits = savedEdits;
    }

        setAccounts(accounts) {

        this.accounts = accounts.map(account => ({
            ...account,

            account_id: Number(account.account_id),

            is_active: account.is_active !== false,

            is_system: account.is_system === true,

            line_count: Number(account.line_count) || 0
        }));

        LedgerUtils.chart = this.accounts;
    }

    getTransaction(id) {


        return this.transactions.find(
            transaction =>
                String(transaction.id) === String(id)
        );
    }

    setCashbook(details, payments) {

        this.details = new Map(
            details.map(detail => [
                String(detail.transaction_id),
                {
                    party_name: detail.party_name || "",
                    initial_paid: Number(detail.initial_paid) || 0
                }
            ])
        );

        this.payments = payments.map(payment => ({
            id: String(payment.id),
            transaction_id: String(payment.transaction_id),
            paid_on: String(payment.paid_on).slice(0, 10),
            amount: Number(payment.amount) || 0
        }));
    }

    // Later payments show up in the journal as entries of their own.
    paymentItems() {

        const items = [];

        this.payments.forEach(payment => {

            const parent = this.getTransaction(payment.transaction_id);

            if (!parent || parent.status === "review") return;

            const direction = LedgerCash.direction(parent);
            const party = LedgerCash.party(this, parent);

            items.push({
                id: `pay-${payment.id}`,
                parentId: parent.id,
                isPayment: true,
                direction,
                date: payment.paid_on,
                type: "payment",
                category: "Payment",
                amount: payment.amount,
                status: "approved",
                description:
                    (direction === "in" ? "Payment received" : "Payment made") +
                    (party ? (direction === "in" ? " from " : " to ") + party : "") +
                    " — " + parent.description
            });
        });

        return items;
    }

    // Transactions and payments together, as journal entries.
    getJournalItems() {

        return [...this.getPostedTransactions(), ...this.paymentItems()];
    }

    getJournalLines(transaction) {

        if (transaction.isPayment) {
            return LedgerAccounting.journalFor(transaction);
        }

        // Entries edited by hand in an older version are kept as saved.
        const saved =
            this.journalEdits[String(transaction.id)];

        if (saved && saved.length && !this.details.has(String(transaction.id))) {
            return saved;
        }

        return LedgerAccounting.journalFor({
            ...transaction,
            initialPaid: LedgerCash.initialPaid(this, transaction)
        });
    }

    getPostedTransactions() {

        return this.transactions.filter(
            transaction => transaction.status !== "review"
        );
    }

    clear() {

        this.transactions = [];
        this.receipts = [];
        this.inventory = [];
        this.inventoryMovements = [];

        // Fixed assets + supplies registers
        this.fixedAssets = [];
        this.editingAssetId = null;
        this.assetFormOpen = false;
        this.supplies = [];
        this.editingSupplyId = null;
        this.supplyFormOpen = false;

        this.adjustments = [];
                this.journalEdits = {};

        this.accounts = [];
        this.editingAccountId = null;
        this.showInactiveAccounts = false;
        LedgerUtils.chart = [];

        this.accountClasses = new Map();
        this.savedReports = [];
        this.viewedReport = null;

        this.currentUser = null;
        this.currentPage = "dashboard";


        this.dashboardPeriod = "monthly";
        this.dashboardChartType = "bar";
        this.dashboardMetric = "all";

        this.trialBalanceDate = LedgerUtils.today();

        // Adjusted Trial Balance reporting date
        this.adjustedTbDate = LedgerUtils.today();

        // Financial Statements period (defaults to this year so far)
        this.statementStart = LedgerUtils.today().slice(0, 4) + "-01-01";
        this.statementEnd = LedgerUtils.today();
    }
}


// =========================================================
// 3. DATABASE API
// =========================================================

class LedgerAPI {

    constructor(state) {
        this.state = state;
    }

    getToken() {
        return sessionStorage.getItem(
            LedgerUtils.TOKEN_KEY
        );
    }

    async request(endpoint, options = {}) {

        const headers = {
            ...(options.headers || {})
        };

        const token = this.getToken();

        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        if (
            options.body &&
            !(options.body instanceof FormData)
        ) {
            headers["Content-Type"] = "application/json";
        }

        let response;

        try {

            response = await fetch(
                `${LedgerUtils.API_BASE}${endpoint}`,
                {
                    ...options,
                    headers
                }
            );

        } catch (error) {

            throw new Error(
                "Cannot connect to LARP's backend. Make sure your server is running."
            );
        }

        const data = await response.json().catch(() => ({}));

        if (
            response.status === 401 &&
            endpoint !== "/auth/login" &&
            endpoint !== "/auth/register"
        ) {

            this.logout(false);

            throw new Error(
                data.error ||
                "Your session has expired. Please sign in again."
            );
        }

        if (!response.ok) {
            throw new Error(
                data.error || "Something went wrong."
            );
        }

        return data;
    }

    async login(email, password) {

        return this.request("/auth/login", {
            method: "POST",

            body: JSON.stringify({
                email,
                password
            })
        });
    }

    async register(fullName, email, password) {

        return this.request("/auth/register", {
            method: "POST",

            body: JSON.stringify({
                full_name: fullName,
                email,
                password
            })
        });
    }

    async loadTransactions() {

        const data = await this.request("/transactions");

        const transactions = Array.isArray(data)
            ? data
            : data.transactions || [];

        this.state.setTransactions(transactions);
    }

    async loadCashbook() {

        const data = await this.request("/cashbook");

        this.state.setCashbook(data.details || [], data.payments || []);
    }

    async saveCashbookTransaction(body) {

        return this.request("/cashbook", {
            method: "POST",
            body: JSON.stringify(body)
        });
    }

    async recordPayment(id, body) {

        return this.request(
            `/cashbook/${encodeURIComponent(id)}/payments`,
            { method: "POST", body: JSON.stringify(body) }
        );
    }

    async deletePayment(id) {

        return this.request(
            `/cashbook/payments/${encodeURIComponent(id)}`,
            { method: "DELETE" }
        );
    }


    normalizeReceipt(receipt) {
        return {
            id: String(receipt.id),
            name: receipt.file_name,
            type: receipt.mime_type || "application/octet-stream",
            date: String(receipt.uploaded_at || "").slice(0, 10),
            data: receipt.url || "",
            transactionId: receipt.transaction_id || null
        };
    }

    async loadReceipts() {
        const data = await this.request("/receipts");

        this.state.receipts = (data.receipts || [])
            .map(receipt => this.normalizeReceipt(receipt));
    }

    async saveReceipt(file, transactionId = null) {

        const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(
                new Error("Unable to read receipt file.")
            );

            reader.readAsDataURL(file);
        });

        const result = await this.request("/receipts", {
            method: "POST",

            body: JSON.stringify({
                file_name: file.name,
                mime_type: file.type || "application/octet-stream",
                data: dataUrl,
                transaction_id: transactionId || null
            })
        });

        if (!result.receipt) {
            throw new Error("Server did not return the saved receipt.");
        }

        return this.normalizeReceipt(result.receipt);
    }

    async deleteReceipt(id) {
        return this.request(
            `/receipts/${encodeURIComponent(id)}`,
            {
                method: "DELETE"
            }
        );
    }

    async loadJournalEntries() {

        const data = await this.request("/journal-entries");

        const entries = Array.isArray(data)
            ? data
            : data.journalEntries || [];

        this.state.setJournalEntries(entries);
    }

    async saveTransaction(transaction) {

        return this.request("/transactions", {
            method: "POST",
            body: JSON.stringify(transaction)
        });
    }

    async updateTransaction(id, changes) {

        return this.request(
            `/transactions/${encodeURIComponent(id)}`,
            {
                method: "PATCH",
                body: JSON.stringify(changes)
            }
        );
    }

    async deleteTransaction(id) {

        return this.request(
            `/transactions/${encodeURIComponent(id)}`,
            {
                method: "DELETE"
            }
        );
    }

        async loadAccounts() {

        const data =
            await this.request("/accounts?include_inactive=1");

        const accounts = Array.isArray(data)
            ? data
            : data.accounts || [];

        this.state.setAccounts(accounts);
    }


    async saveJournalEntry(id, lines, transaction) {


        return this.request(
            `/journal-entries/${encodeURIComponent(id)}`,
            {
                method: "PUT",

                body: JSON.stringify({

                    transaction: {
                        date: transaction.date,
                        description: transaction.description,
                        category: transaction.category
                    },

                    lines: lines.map(line => ({
                        account_name: line.account,

                        account_type:
                            line.accountType ||
                            LedgerUtils.accountTypeFor(line.account),

                        description: line.description || "",

                        debit: Number(line.debit) || 0,

                        credit: Number(line.credit) || 0
                    }))

                })
            }
        );
    }

    logout(showMessage = true) {

        sessionStorage.removeItem(
            LedgerUtils.TOKEN_KEY
        );

        sessionStorage.removeItem(
            LedgerUtils.USER_KEY
        );

        this.state.clear();

        const authScreen =
            document.getElementById("authScreen");

        const appShell =
            document.querySelector(".app-shell");

        if (authScreen) {
            authScreen.hidden = false;
        }

        if (appShell) {
            appShell.style.display = "none";
        }

        if (showMessage) {
            LedgerUtils.toast("You have signed out.");
        }
    }
}


// =========================================================
// 4. ACCOUNTING LOGIC
// =========================================================

class LedgerAccounting {

    // -----------------------------------------------------
    // ACCOUNT CLASSIFICATION
    // -----------------------------------------------------

    // Pick the first candidate that exists (and is active) in the chart
    // of accounts, then try a name pattern, then fall back to a default.
    static pickAccount(candidates, type, pattern, fallback) {

        for (const name of candidates) {

            const account = LedgerUtils.findAccount(name);

            if (account && account.is_active) {
                return account.account_name;
            }
        }

        if (pattern) {

            const match = LedgerUtils.chart.find(
                account =>
                    account.account_type === type &&
                    account.is_active &&
                    pattern.test(account.account_name)
            );

            if (match) return match.account_name;
        }

        return fallback;
    }

    static inventoryAccount() {

        return this.pickAccount(
            ["Inventory", "Merchandise Inventory"],
            "asset",
            /inventor/i,
            "Inventory"
        );
    }

    static cogsAccount() {

        return this.pickAccount(
            ["Cost of Goods Sold"],
            "expense",
            /cost of (goods|sales)/i,
            "Cost of Goods Sold"
        );
    }

    static accountFor(transaction) {

        const cash = this.pickAccount(
            ["Cash"], "asset", /cash/i, "Cash"
        );

        // Purchase: Dr what was bought, Cr Cash
        if (transaction.type === "purchase") {

            const bought = {
                "Supplies": { name: "Supplies", type: "asset" },
                "Equipment": { name: "Equipment", type: "asset" },
                "Other Purchase": { name: "Other Purchases", type: "expense" }
            }[transaction.category];

            if (bought) {

                return {
                    debit: this.pickAccount(
                        [bought.name], bought.type, null, bought.name
                    ),
                    debitType: bought.type,
                    credit: cash,
                    creditType: "asset"
                };
            }

            return {
                debit: this.inventoryAccount(),
                debitType: "asset",
                credit: cash,
                creditType: "asset"
            };
        }

        // Sale / Service income: Dr Cash, Cr Revenue
        // ("income" is the old type name, kept so old rows still work)
        if (["income", "sale", "service_income"].includes(transaction.type)) {

            let preferred;

            if (transaction.category === "Product Sale") {
                preferred = "Sales Revenue";
            } else if (transaction.category === "Service Income") {
                preferred = "Service Revenue";
            } else if (transaction.type === "sale") {
                preferred = "Sales Revenue";
            } else if (transaction.category === "Other Income") {
                preferred = "Other Income";
            } else if (transaction.type === "service_income") {
                preferred = "Service Revenue";
            } else {
                preferred = transaction.category === "Sales Revenue"
                    ? "Sales Revenue"
                    : "Service Revenue";
            }

            return {
                debit: cash,
                debitType: "asset",

                credit: this.pickAccount(
                    [preferred, "Service Revenue", "Sales Revenue"],
                    "revenue",
                    null,
                    preferred
                ),

                creditType: "revenue"
            };
        }

        // Owner puts money in: Dr Cash, Cr Owner's Capital
        if (transaction.type === "investment") {

            return {
                debit: cash,
                debitType: "asset",

                credit: this.pickAccount(
                    ["Owner's Capital", "Owner Capital", "Capital"],
                    "equity",
                    /capital|investment/i,
                    "Owner's Capital"
                ),

                creditType: "equity"
            };
        }

        // Owner takes money out: Dr Owner's Drawings, Cr Cash
        if (transaction.type === "withdrawal") {

            return {
                debit: this.pickAccount(
                    [
                        "Owner's Drawings",
                        "Owner's Drawing",
                        "Drawings",
                        "Owner's Withdrawals"
                    ],
                    "equity",
                    /drawing|withdraw/i,
                    "Owner's Drawings"
                ),

                debitType: "equity",

                credit: cash,

                creditType: "asset"
            };
        }

        const expenseAccounts = {

            "Rent": "Rent Expense",

            "Salaries": "Salaries Expense",

            "Advertising": "Advertising Expense",

            "Repairs": "Repairs and Maintenance Expense",

            "Other Expense": "General Expense",

            "Office Supplies": "Office Supplies Expense",

            "Utilities": "Utilities Expense",

            "Transportation": "Transportation Expense",

            "Rent Expense": "Rent Expense",

            "Salaries Expense": "Salaries Expense",

            "Cost of Goods Sold": "Cost of Goods Sold",

            "Repairs and Maintenance": "Repairs and Maintenance Expense"

        };

        const preferredExpense =
            expenseAccounts[transaction.category] ||
            "General Expense";

        return {
            debit: this.pickAccount(
                [preferredExpense, "General Expense"],
                "expense",
                null,
                preferredExpense
            ),

            debitType: "expense",

            credit: cash,

            creditType: "asset"
        };
    }


    // -----------------------------------------------------
    // AUTOMATIC JOURNAL
    // -----------------------------------------------------

    static journalFor(transaction) {

        const amount = LedgerCash.round(transaction.amount);

        const cash = this.pickAccount(["Cash"], "asset", /cash/i, "Cash");

        const receivable = this.pickAccount(
            ["Accounts Receivable"], "asset", /receivable/i, "Accounts Receivable"
        );

        const payable = this.pickAccount(
            ["Accounts Payable"], "liability", /payable/i, "Accounts Payable"
        );

        // A later payment: settle what was owed.
        if (transaction.isPayment) {

            const incoming = transaction.direction === "in";

            return [
                {
                    account: incoming ? cash : payable,
                    accountType: incoming ? "asset" : "liability",
                    description: transaction.description,
                    debit: amount,
                    credit: 0
                },
                {
                    account: incoming ? receivable : cash,
                    accountType: incoming ? "asset" : "asset",
                    description: transaction.description,
                    debit: 0,
                    credit: amount
                }
            ];
        }

        const accounts = this.accountFor(transaction);

        // Owner money always moves straight away; otherwise use what was paid.
        const ownerType = ["investment", "withdrawal"].includes(transaction.type);

        const paid = ownerType || transaction.initialPaid == null
            ? amount
            : Math.min(amount, Math.max(0, LedgerCash.round(transaction.initialPaid)));

        const unpaid = LedgerCash.round(amount - paid);

        const note = transaction.description;

        const lines = [];

        if (accounts.credit === cash) {

            // Money goes out: Dr what it was for; Cr Cash for what was paid
            // and Cr Accounts Payable for what is still owed.
            lines.push({
                account: accounts.debit,
                accountType: accounts.debitType,
                description: note,
                debit: amount,
                credit: 0
            });

            if (paid > 0) {
                lines.push({
                    account: cash, accountType: "asset", description: note,
                    debit: 0, credit: paid
                });
            }

            if (unpaid > 0) {
                lines.push({
                    account: payable, accountType: "liability", description: note,
                    debit: 0, credit: unpaid
                });
            }

        } else {

            // Money comes in: Dr Cash for what was received and Dr Accounts
            // Receivable for what is still owed; Cr the income account.
            if (paid > 0) {
                lines.push({
                    account: cash, accountType: "asset", description: note,
                    debit: paid, credit: 0
                });
            }

            if (unpaid > 0) {
                lines.push({
                    account: receivable, accountType: "asset", description: note,
                    debit: unpaid, credit: 0
                });
            }

            lines.push({
                account: accounts.credit,
                accountType: accounts.creditType,
                description: note,
                debit: 0,
                credit: amount
            });
        }

        // A sale also moves the goods out of inventory at their cost:
        // Dr Cost of Goods Sold, Cr Inventory
        const cogs = Number(transaction.cogs) || 0;

        if (transaction.type === "sale" && cogs > 0) {

            const note =
                "Cost of goods sold" +
                (transaction.item_name ? ": " + transaction.item_name : "");

            lines.push(
                {
                    account: this.cogsAccount(),
                    accountType: "expense",
                    description: note,
                    debit: cogs,
                    credit: 0
                },
                {
                    account: this.inventoryAccount(),
                    accountType: "asset",
                    description: note,
                    debit: 0,
                    credit: cogs
                }
            );
        }

        return lines;
    }


    static isClosingType(type) {

        return type === "closing" || type === "closing_reversal";
    }




    // -----------------------------------------------------
    // JOURNAL VALIDATION
    // -----------------------------------------------------

    static validateJournal(lines) {

        if (!lines.length) {
            return "No journal lines found.";
        }

        const invalidLine = lines.some(line =>

            !line.account ||

            !LedgerUtils.ACCOUNT_TYPES.includes(line.accountType) ||

            !Number.isFinite(line.debit) ||

            !Number.isFinite(line.credit) ||

            line.debit < 0 ||

            line.credit < 0 ||

            (line.debit > 0 && line.credit > 0) ||

            (line.debit === 0 && line.credit === 0)

        );

        if (invalidLine) {

            return "Check the account, account type, debit, and credit fields.";

        }

                if (LedgerUtils.chart.length) {

            const unknown = lines.find(
                line => !LedgerUtils.findAccount(line.account)
            );

            if (unknown) {
                return `"${unknown.account}" is not in your chart of accounts.`;
            }

            const inactive = lines.find(
                line => !LedgerUtils.findAccount(line.account).is_active
            );

            if (inactive) {
                return `"${inactive.account}" is inactive. Choose another account or reactivate it.`;
            }
        }

        const debit = lines.reduce(
            (sum, line) => sum + line.debit,
            0
        );


        const credit = lines.reduce(
            (sum, line) => sum + line.credit,
            0
        );

        if (Math.abs(debit - credit) > 0.005) {

            return "Debit and credit must balance before saving.";

        }

        return null;
    }
}

// =========================================================
// 5. CSV IMPORTER
// =========================================================

class LedgerCSVImporter {

    // -----------------------------------------------------
    // PARSE CSV
    // -----------------------------------------------------

    static parseCSV(text) {

        const rows = [];

        let row = [];
        let field = "";
        let quoted = false;

        const source = String(text || "")
            .replace(/^\uFEFF/, "");

        for (let i = 0; i < source.length; i++) {

            const char = source[i];

            if (quoted) {

                if (char === '"') {

                    if (source[i + 1] === '"') {
                        field += '"';
                        i++;
                    } else {
                        quoted = false;
                    }

                } else {
                    field += char;
                }

            } else {

                if (char === '"' && field.length === 0) {

                    quoted = true;

                } else if (char === ",") {

                    row.push(field);
                    field = "";

                } else if (char === "\n" || char === "\r") {

                    row.push(field);

                    if (row.some(value => value.trim() !== "")) {
                        rows.push(row);
                    }

                    row = [];
                    field = "";

                    if (
                        char === "\r" &&
                        source[i + 1] === "\n"
                    ) {
                        i++;
                    }

                } else {

                    field += char;

                }
            }
        }

        if (quoted) {
            throw new Error(
                "The CSV contains an unclosed quotation mark."
            );
        }

        if (field.length > 0 || row.length > 0) {

            row.push(field);

            if (row.some(value => value.trim() !== "")) {
                rows.push(row);
            }
        }

        return rows;
    }


    // -----------------------------------------------------
    // NORMALIZE HEADER
    // -----------------------------------------------------

    static normalizeHeader(header) {

        return String(header || "")
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, "");
    }


    // -----------------------------------------------------
    // VALIDATE DATE
    // -----------------------------------------------------

    static validDate(value) {

        const match =
            /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

        if (!match) return false;

        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);

        const date = new Date(
            Date.UTC(year, month - 1, day)
        );

        return (
            date.getUTCFullYear() === year &&
            date.getUTCMonth() === month - 1 &&
            date.getUTCDate() === day
        );
    }


    // -----------------------------------------------------
    // PARSE TRANSACTIONS
    // -----------------------------------------------------

    static parseTransactions(text) {

        const rows = this.parseCSV(text);

        if (rows.length < 2) {

            throw new Error(
                "The CSV file contains no transaction records."
            );
        }

        const headers = rows[0].map(
            header => this.normalizeHeader(header)
        );

        const aliases = {

            date: [
                "date",
                "transactiondate"
            ],

            description: [
                "description",
                "details",
                "particulars"
            ],

            category: [
                "category"
            ],

            type: [
                "type",
                "transactiontype"
            ],

            amount: [
                "amount"
            ]

        };

        const columns = {};

        Object.entries(aliases).forEach(([key, names]) => {

            columns[key] = headers.findIndex(
                header => names.includes(header)
            );

        });

        const missing = Object.keys(columns).filter(
            key => columns[key] === -1
        );

        // Optional columns, needed only on purchase and sale rows.
        const optionalAliases = {
            item: ["item", "itemname", "product"],
            quantity: ["quantity", "qty"]
        };

        Object.entries(optionalAliases).forEach(([key, names]) => {

            columns[key] = headers.findIndex(
                header => names.includes(header)
            );
        });

        if (missing.length) {

            throw new Error(
                "Missing required CSV columns: " +
                missing.join(", ")
            );
        }

        const valid = [];
        const invalid = [];

        for (let i = 1; i < rows.length; i++) {

            const values = rows[i];

            const getValue = key =>
                String(
                    values[columns[key]] ?? ""
                ).trim();

            const date = getValue("date");
            const description = getValue("description");
            const category = getValue("category");
            const type = getValue("type").toLowerCase();

            const stockEffect = LedgerUtils.stockEffect(type);

            const itemName = getValue("item");

            const quantity = Number(
                getValue("quantity").replace(/[,\s]/g, "")
            );

            const amountText = getValue("amount")
                .replace(/^(PHP|₱)\s*/i, "")
                .replace(/[,\s]/g, "");

            const amount = Number(amountText);

            const errors = [];

            if (!this.validDate(date)) {
                errors.push(
                    "Invalid date. Use YYYY-MM-DD."
                );
            }

            if (!description) {
                errors.push("Missing description.");
            } else if (description.length > 100) {
                errors.push(
                    "Description must be 100 characters or less."
                );
            }

            if (!category) {
                errors.push("Missing category.");
            }

            if (!Object.keys(LedgerUtils.TRANSACTION_TYPES).includes(type)) {
                errors.push(
                    "Type must be one of: " +
                    Object.keys(LedgerUtils.TRANSACTION_TYPES).join(", ") +
                    "."
                );
            }

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                errors.push(
                    "Amount must be greater than zero."
                );
            }

            if (
                stockEffect &&
                (
                    !itemName ||
                    !Number.isFinite(quantity) ||
                    quantity <= 0
                )
            ) {
                errors.push(
                    "Purchase and sale rows need an item and a quantity."
                );
            }

            if (errors.length) {

                invalid.push({
                    rowNumber: i + 1,
                    reason: errors.join(" ")
                });

                continue;
            }

            valid.push({

                rowNumber: i + 1,

                transaction: {

                    date,
                    description,
                    category,
                    type,
                    amount,

                    ...(stockEffect
                        ? { item_name: itemName, quantity }
                        : {}),

                    status: "approved"

                }

            });
        }

        return {
            valid,
            invalid
        };
    }


    // -----------------------------------------------------
    // GENERATE CSV TEMPLATE
    // -----------------------------------------------------

    static createTemplate() {

        // Amount is the TOTAL for the row. Item and quantity are only
        // needed for purchase and sale. List purchases before the sales
        // that use that stock.
        const rows = [

            ["date", "description", "category", "type", "amount", "item", "quantity"],

            ["2026-11-01", "Office supplies", "Office Supplies", "expense", "1500.00", "", ""],

            ["2026-11-02", "Owner capital contribution", "Owner's Investment", "investment", "20000.00", "", ""],

            ["2026-11-03", "Bought notebooks for resale", "Inventory Purchase", "purchase", "6000.00", "Notebook", "100"],

            ["2026-11-04", "Sold notebooks", "Sales Revenue", "sale", "2500.00", "Notebook", "25"],

            ["2026-11-05", "Design consultation", "Service Revenue", "service_income", "3000.00", "", ""],

            ["2026-11-06", "Owner cash withdrawal", "Owner's Withdrawal", "withdrawal", "3000.00", "", ""]

        ];

        return rows.map(row =>

            row.map(value =>
                LedgerUtils.csvEscape(value)
            ).join(",")

        ).join("\r\n");
    }
}


// =========================================================
// CASH ENGINE — money in, money out and what is still unpaid
// =========================================================

class LedgerCash {

    static round(value) {
        return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
    }

    // Money Received and owner investments bring cash in;
    // everything else sends it out.
    static direction(transaction) {

        if (transaction.isPayment) return transaction.direction;

        return LedgerUtils.isInflow(transaction.type) ? "in" : "out";
    }

    // Transactions saved before payment tracking (or imported from CSV)
    // have no details row and count as paid in full.
    static initialPaid(state, transaction) {

        const detail = state.details.get(String(transaction.id));

        return detail
            ? Math.min(this.round(detail.initial_paid), transaction.amount)
            : transaction.amount;
    }

    static party(state, transaction) {
        return state.details.get(String(transaction.id))?.party_name || "";
    }

    static paymentsFor(state, id) {
        return state.payments.filter(
            payment => String(payment.transaction_id) === String(id)
        );
    }

    static balance(state, transaction) {

        const later = this.paymentsFor(state, transaction.id)
            .reduce((sum, payment) => sum + payment.amount, 0);

        return Math.max(
            0,
            this.round(
                transaction.amount -
                this.initialPaid(state, transaction) -
                later
            )
        );
    }

    // "paid" | "partial" | "unpaid"
    static status(state, transaction) {

        const balance = this.balance(state, transaction);

        if (balance <= 0.004) return "paid";

        return balance >= transaction.amount - 0.004 ? "unpaid" : "partial";
    }

    static statusLabel(status) {
        return {
            paid: "Paid in full",
            partial: "Partially paid",
            unpaid: "Not yet paid"
        }[status] || status;
    }

    // Every movement of cash: what was paid on the day, then later payments.
    static events(state) {

        const events = [];

        state.getPostedTransactions().forEach(transaction => {

            if (!transaction.date) return;

            const paid = this.initialPaid(state, transaction);

            if (paid > 0) {
                events.push({
                    date: transaction.date,
                    amount: paid,
                    dir: this.direction(transaction),
                    transaction
                });
            }

            this.paymentsFor(state, transaction.id).forEach(payment => {
                events.push({
                    date: payment.paid_on,
                    amount: payment.amount,
                    dir: this.direction(transaction),
                    transaction,
                    payment
                });
            });
        });

        return events;
    }

    static availableCash(state, asOf = LedgerUtils.today()) {

        return this.round(
            this.events(state)
                .filter(event => event.date <= asOf)
                .reduce(
                    (sum, event) =>
                        sum + (event.dir === "in" ? event.amount : -event.amount),
                    0
                )
        );
    }

    static iso(date) {
        return date.toISOString().slice(0, 10);
    }

    // week (Monday to Sunday) | month | year, around `today`
    static range(period, today = LedgerUtils.today()) {

        const [y, m, d] = today.split("-").map(Number);

        if (period === "week") {

            const start = new Date(Date.UTC(y, m - 1, d));
            start.setUTCDate(d - ((start.getUTCDay() + 6) % 7));

            const end = new Date(start);
            end.setUTCDate(start.getUTCDate() + 6);

            return { start: this.iso(start), end: this.iso(end) };
        }

        if (period === "year") {
            return { start: `${y}-01-01`, end: `${y}-12-31` };
        }

        return {
            start: `${y}-${String(m).padStart(2, "0")}-01`,
            end: this.iso(new Date(Date.UTC(y, m, 0)))
        };
    }

    static periodLabel(period) {
        return {
            week: "This Week",
            month: "This Month",
            year: "This Year"
        }[period] || "This Month";
    }

    static totals(state, period, today = LedgerUtils.today()) {

        const { start, end } = this.range(period, today);

        let received = 0;
        let spent = 0;

        this.events(state).forEach(event => {

            if (event.date < start || event.date > end) return;

            if (event.dir === "in") received += event.amount;
            else spent += event.amount;
        });

        return {
            received: this.round(received),
            spent: this.round(spent),
            net: this.round(received - spent),
            start,
            end
        };
    }

    // Bars for the chart: days of the week, days of the month, or months.
    static series(state, period, today = LedgerUtils.today()) {

        const { start, end } = this.range(period, today);

        const buckets = [];

        if (period === "year") {

            const year = start.slice(0, 4);

            const names = [
                "Jan", "Feb", "Mar", "Apr", "May", "Jun",
                "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
            ];

            names.forEach((name, index) => {
                buckets.push({
                    label: name,
                    prefix: `${year}-${String(index + 1).padStart(2, "0")}`
                });
            });

        } else {

            const cursor = new Date(start + "T00:00:00Z");
            const last = new Date(end + "T00:00:00Z");

            while (cursor <= last) {

                const day = this.iso(cursor);

                buckets.push({
                    label: period === "week"
                        ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][
                            buckets.length
                        ]
                        : String(Number(day.slice(8))),
                    prefix: day
                });

                cursor.setUTCDate(cursor.getUTCDate() + 1);
            }
        }

        const received = buckets.map(() => 0);
        const spent = buckets.map(() => 0);

        this.events(state).forEach(event => {

            const index = buckets.findIndex(
                bucket => event.date.startsWith(bucket.prefix)
            );

            if (index < 0) return;

            if (event.dir === "in") received[index] += event.amount;
            else spent[index] += event.amount;
        });

        return {
            labels: buckets.map(bucket => bucket.label),
            received: received.map(value => this.round(value)),
            spent: spent.map(value => this.round(value))
        };
    }

    // Everything with an unpaid balance, oldest first.
    static outstanding(state) {

        return state.getPostedTransactions()
            .map(transaction => ({
                transaction,
                dir: this.direction(transaction),
                party: this.party(state, transaction),
                balance: this.balance(state, transaction),
                status: this.status(state, transaction)
            }))
            .filter(item => item.balance > 0.004)
            .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date));
    }

    static unpaidTotals(state) {

        const items = this.outstanding(state);

        const sum = dir => this.round(
            items.filter(item => item.dir === dir)
                .reduce((total, item) => total + item.balance, 0)
        );

        return {
            customersOweYou: sum("in"),
            youOwe: sum("out"),
            receivableCount: items.filter(item => item.dir === "in").length,
            payableCount: items.filter(item => item.dir === "out").length
        };
    }
}

// =========================================================
// 6. DASHBOARD CHART COMPONENT — cash flow only
// =========================================================

class LedgerDashboardChart {

    constructor(state) {
        this.state = state;
        this.chart = null;
    }

    destroy() {

        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    }

    render() {

        this.destroy();

        const canvas = document.getElementById("dashboardFinanceChart");

        if (!canvas) return;

        const fallback = document.getElementById("dashboardChartFallback");
        const caption = document.getElementById("dashboardChartCaption");

        const period = this.state.dashboardRange;
        const data = LedgerCash.series(this.state, period);

        if (caption) {
            caption.textContent =
                `Money received vs money spent — ${LedgerCash.periodLabel(period).toLowerCase()}`;
        }

        if (typeof window.Chart === "undefined") {

            if (fallback) {
                fallback.hidden = false;
                fallback.textContent =
                    "The chart could not load. Your totals above are still correct.";
            }

            return;
        }

        if (fallback) fallback.hidden = true;

        const style = getComputedStyle(document.documentElement);
        const color = (name, alt) => style.getPropertyValue(name).trim() || alt;

        this.chart = new window.Chart(canvas, {
            type: "bar",
            data: {
                labels: data.labels,
                datasets: [
                    {
                        label: "Money received",
                        data: data.received,
                        backgroundColor: color("--green", "#1f9d6b"),
                        borderRadius: 4
                    },
                    {
                        label: "Money spent",
                        data: data.spent,
                        backgroundColor: color("--red", "#d9534f"),
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { position: "bottom" },
                    tooltip: {
                        callbacks: {
                            label: context =>
                                `${context.dataset.label}: ${LedgerUtils.peso(context.parsed.y)}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: value => LedgerUtils.peso(value)
                        }
                    },
                    x: { grid: { display: false } }
                }
            }
        });
    }
}

// =========================================================
// 7. USER INTERFACE
// =========================================================

class LedgerView {

    constructor(state) {
        this.state = state;
    }

    heading(title, subtitle, action = "") {
        return LedgerUtils.heading(
            title,
            subtitle,
            action
        );
    }

    metric(label, value, foot, icon) {
        return LedgerUtils.metric(
            label,
            value,
            foot,
            icon
        );
    }


    // -----------------------------------------------------
    // TRANSACTION ROWS
    // -----------------------------------------------------

    transactionRows(rows) {

        if (!rows.length) {

            return `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            No transactions found.
                        </div>
                    </td>
                </tr>
            `;
        }

        return rows.map(transaction => `

            <tr>

                <td>
                    ${LedgerUtils.escape(transaction.date)}
                </td>

                <td>
                    <strong>
                        ${LedgerUtils.escape(transaction.description)}
                    </strong>
                </td>

                <td>
                    ${LedgerUtils.escape(LedgerUtils.typeLabel(transaction.type))}
                    <div class="tiny muted">
                        ${LedgerUtils.escape(transaction.category)}
                    </div>
                </td>

                <td class="amount ${
                    LedgerUtils.isInflow(transaction.type)
                        ? "positive"
                        : "negative"
                }">

                    ${LedgerUtils.isInflow(transaction.type) ? "+" : "−"}

                    ${LedgerUtils.peso(transaction.amount)}

                </td>

                <td>
                    ${this.paymentBadge(transaction)}
                </td>

                <td>
                    ${LedgerUtils.badge(transaction.status)}
                </td>

                <td>
                    <button
                        class="btn ghost small"
                        data-review="${LedgerUtils.escape(transaction.id)}"
                    >
                        View
                    </button>

                    <button
                        class="btn danger small"
                        data-delete-transaction="${LedgerUtils.escape(transaction.id)}"
                    >
                        Delete
                    </button>
                </td>

            </tr>

        `).join("");
    }


    paymentBadge(transaction) {

        const status = LedgerCash.status(this.state, transaction);

        const balance = LedgerCash.balance(this.state, transaction);

        return `
            <span class="badge ${status === "paid" ? "approved" : "review"}">
                ${LedgerCash.statusLabel(status).toUpperCase()}
            </span>
            ${
                balance > 0
                    ? `<div class="tiny muted">${LedgerUtils.peso(balance)} unpaid</div>`
                    : ""
            }
        `;
    }


    // -----------------------------------------------------
    // TRANSACTION TABLE
    // -----------------------------------------------------

    transactionTable(rows) {

        return `

            <div class="card table-card">

                <div class="card-head">

                    <h3>Transactions</h3>

                    <span class="tiny muted">
                        ${rows.length} records
                    </span>

                </div>

                <div class="table-wrap">

                    <table>

                        <thead>
                            <tr>
                                <th>DATE</th>
                                <th>DESCRIPTION</th>
                                <th>TYPE / CATEGORY</th>
                                <th>AMOUNT</th>
                                <th>PAYMENT</th>
                                <th>STATUS</th>
                                <th>ACTION</th>
                            </tr>
                        </thead>

                        <tbody>
                            ${this.transactionRows(rows)}
                        </tbody>

                    </table>

                </div>

            </div>

        `;
    }


    // =====================================================
    // DASHBOARD
    // =====================================================

    dashboard() {

        const range = this.state.dashboardRange;

        const totals = LedgerCash.totals(this.state, range);

        const unpaid = LedgerCash.unpaidTotals(this.state);

        const cash = LedgerCash.availableCash(this.state);

        const recent = [...this.state.transactions]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, 5);

        const userName = LedgerUtils.escape(
            this.state.currentUser?.full_name || "User"
        );

        const rangeLabel = LedgerCash.periodLabel(range).toLowerCase();

        return `

            ${this.heading(
                `Good day, ${userName}`,

                "Here's where your business cash stands.",

                `
                    <button
                        class="btn primary"
                        id="addTransaction"
                    >
                        ＋ Add Transaction
                    </button>
                `
            )}


            <!-- CASH SUMMARY -->

            <div class="toolbar" style="margin-bottom:12px">

                <label class="tiny muted">

                    SHOW MONEY RECEIVED AND SPENT FOR

                    <select id="dashboardRange" style="margin-left:8px">

                        ${["week", "month", "year"].map(value => `
                            <option value="${value}"
                                ${range === value ? "selected" : ""}>
                                ${LedgerCash.periodLabel(value)}
                            </option>
                        `).join("")}

                    </select>

                </label>

            </div>

            <div class="grid metric-grid">

                ${this.metric(
                    "AVAILABLE CASH",
                    LedgerUtils.peso(cash),
                    "Your current cash balance",
                    "₱"
                )}

                ${this.metric(
                    "MONEY RECEIVED",
                    LedgerUtils.peso(totals.received),
                    `Cash in ${rangeLabel}`,
                    "↗"
                )}

                ${this.metric(
                    "MONEY SPENT",
                    LedgerUtils.peso(totals.spent),
                    `Cash out ${rangeLabel}`,
                    "↘"
                )}

            </div>


            <div class="grid two-col">


                <!-- CASH FLOW CHART -->

                <div class="card dashboard-chart-card">

                    <div class="card-head">

                        <div>

                            <h3>Cash Flow</h3>

                            <span class="tiny muted">
                                Money spent vs money received
                            </span>

                        </div>

                    </div>

                    <div class="chart-container">

                        <canvas id="dashboardFinanceChart"></canvas>

                    </div>

                    <p
                        class="tiny muted chart-caption"
                        id="dashboardChartCaption"
                    ></p>

                    <p
                        class="chart-fallback"
                        id="dashboardChartFallback"
                        hidden
                    ></p>

                    <p class="tiny muted">
                        Includes money the owner puts in or takes out.
                    </p>

                </div>


                <!-- UNPAID TRANSACTIONS -->

                <div class="card">

                    <div class="card-head">

                        <h3>Unpaid Transactions</h3>

                        <button
                            class="btn ghost small"
                            data-goto="outstanding"
                        >
                            View all
                        </button>

                    </div>

                    <div class="unpaid-box">

                        <p class="tiny muted">CUSTOMERS OWE YOU</p>

                        <p class="unpaid-amount" style="font-size:1.6rem;font-weight:700;color:var(--green)">
                            ${LedgerUtils.peso(unpaid.customersOweYou)}
                        </p>

                        <p class="tiny muted">
                            ${unpaid.receivableCount} unpaid
                            ${unpaid.receivableCount === 1 ? "transaction" : "transactions"}
                        </p>

                    </div>

                    <hr style="border:0;border-top:1px solid var(--line);margin:14px 0">

                    <div class="unpaid-box">

                        <p class="tiny muted">YOU OWE CUSTOMERS</p>

                        <p class="unpaid-amount" style="font-size:1.6rem;font-weight:700;color:var(--red)">
                            ${LedgerUtils.peso(unpaid.youOwe)}
                        </p>

                        <p class="tiny muted">
                            ${unpaid.payableCount} unpaid
                            ${unpaid.payableCount === 1 ? "transaction" : "transactions"}
                        </p>

                    </div>

                </div>

            </div>


            <!-- RECENT TRANSACTIONS -->

            ${this.transactionTable(recent)}

        `;
    }


    // =====================================================
    // TRANSACTIONS WITH CSV IMPORT
    // =====================================================

    transactions() {

        return `

            ${this.heading(

                "Transactions",

                "Record, organize, import, and review your business transactions.",

                `

                    <div class="transaction-heading-actions">

                        <button
                            class="btn secondary"
                            id="downloadImportTemplate"
                            type="button"
                        >
                            ↓ CSV Template
                        </button>

                        <button
                            class="btn secondary"
                            id="importTransactions"
                            type="button"
                        >
                            ↑ Import CSV
                        </button>

                        <button
                            class="btn danger"
                            id="clearTransactions"
                            type="button"
                            ${this.state.transactions.length ? "" : "disabled"}
                        >
                            Clear all
                        </button>

                        <button
                            class="btn primary"
                            id="addTransaction"
                            type="button"
                        >
                            ＋ Add Transaction
                        </button>

                        <input
                            type="file"
                            id="importTransactionsFile"
                            accept=".csv,text/csv"
                            hidden
                        >

                    </div>

                `
            )}


            <div class="info-box csv-import-note">

                <strong>Import transactions using CSV.</strong>

                Upload a CSV file containing date, description,
                category, type, and amount.

                Use YYYY-MM-DD for transaction dates.

                Invalid records will be skipped and reported.

            </div>


            <div class="toolbar">

                <div class="search">

                    <input
                        id="txSearch"
                        placeholder="Search transactions..."
                    >

                </div>


                <select id="statusFilter">

                    <option value="">
                        ALL STATUSES
                    </option>

                    <option value="posted">
                        POSTED
                    </option>

                    <option value="review">
                        NEEDS REVIEW
                    </option>

                </select>


                <select id="typeFilter">

                    <option value="">
                        All types
                    </option>

                    ${LedgerUtils.typeOptions("")}

                </select>

            </div>


            <div id="transactionTable">

                ${this.transactionTable(this.state.transactions)}

            </div>

        `;
    }


    // =====================================================
    // JOURNAL ENTRIES
    // =====================================================

    journal() {

        const items = [
            ...this.state.transactions,
            ...this.state.paymentItems()
        ].sort((a, b) => b.date.localeCompare(a.date));

        return `

            ${this.heading(
                "Journal Entries",
                "The accounting entries LARP prepared for each transaction."
            )}

            <div class="info-box" style="margin-bottom:16px">

                You never have to write these yourself. Every saved
                transaction, and every payment you record later,
                creates its entry automatically.

            </div>

            ${
                items.length
                    ? items.map(item => this.journalCard(item)).join("")
                    : `<div class="card journal-empty">
                           No journal entries yet.
                           Add a transaction to create one automatically.
                       </div>`
            }

        `;
    }


    journalCard(transaction) {

        const lines = this.state.getJournalLines(transaction);

        const id = LedgerUtils.escape(transaction.id);

        const total = lines.reduce(
            (sum, line) => sum + Number(line.debit || 0), 0
        );

        return `

            <div class="card journal-card" id="journal-${id}">

                <div class="card-head">

                    <div style="width:100%">

                        <p class="eyebrow">
                            ${LedgerUtils.escape(transaction.date)} ·
                            ${transaction.isPayment
                                ? "PAYMENT"
                                : LedgerUtils.escape(
                                    LedgerUtils.typeLabel(transaction.type)
                                      ).toUpperCase() +
                                  " · " +
                                  LedgerUtils.escape(transaction.category)
                                      .toUpperCase()}
                        </p>

                        <h3>${LedgerUtils.escape(transaction.description)}</h3>

                    </div>

                    ${transaction.isPayment ? "" : this.paymentBadge(transaction)}

                </div>

                <div class="journal-lines">

                    <div class="journal-row header">
                        <span>ACCOUNT</span>
                        <span>DESCRIPTION</span>
                        <span>DEBIT</span>
                        <span>CREDIT</span>
                    </div>

                    ${lines.map(line => `
                        <div class="journal-row">
                            <span>${LedgerUtils.escape(line.account)}</span>
                            <span>${LedgerUtils.escape(line.description || "")}</span>
                            <span>${line.debit ? LedgerUtils.peso(line.debit) : ""}</span>
                            <span>${line.credit ? LedgerUtils.peso(line.credit) : ""}</span>
                        </div>
                    `).join("")}

                    <div class="journal-row header">
                        <span>TOTAL</span>
                        <span></span>
                        <span>${LedgerUtils.peso(total)}</span>
                        <span>${LedgerUtils.peso(total)}</span>
                    </div>

                </div>

            </div>

        `;
    }


    // =====================================================
    // CASH FLOW
    // =====================================================

    cashFlow() {

        const range = this.state.cashFlowRange;

        const { start, end } = LedgerCash.range(range);

        const all = LedgerCash.events(this.state);

        const opening = LedgerCash.round(
            all.filter(event => event.date < start).reduce(
                (sum, event) =>
                    sum + (event.dir === "in" ? event.amount : -event.amount),
                0
            )
        );

        const inside = all.filter(
            event => event.date >= start && event.date <= end
        );

        const group = dir => {

            const totals = new Map();

            inside.filter(event => event.dir === dir).forEach(event => {

                const name =
                    LedgerUtils.typeLabel(event.transaction.type) +
                    " — " + event.transaction.category;

                totals.set(name, (totals.get(name) || 0) + event.amount);
            });

            return [...totals.entries()].sort((a, b) => b[1] - a[1]);
        };

        const received = group("in");
        const spent = group("out");

        const totalIn = LedgerCash.round(
            received.reduce((sum, [, value]) => sum + value, 0)
        );

        const totalOut = LedgerCash.round(
            spent.reduce((sum, [, value]) => sum + value, 0)
        );

        const rows = list => list.length
            ? list.map(([name, value]) => `
                <tr>
                    <td>${LedgerUtils.escape(name)}</td>
                    <td class="amount">${LedgerUtils.peso(value)}</td>
                </tr>`).join("")
            : `<tr><td colspan="2" class="muted">Nothing in this period.</td></tr>`;

        return `

            ${this.heading(
                "Cash Flow",
                "Where your cash came from and where it went.",
                `<select id="cashFlowRange">
                    ${["week", "month", "year"].map(value => `
                        <option value="${value}" ${range === value ? "selected" : ""}>
                            ${LedgerCash.periodLabel(value)}
                        </option>`).join("")}
                 </select>`
            )}

            <p class="tiny muted" style="margin-bottom:12px">
                ${LedgerUtils.escape(start)} to ${LedgerUtils.escape(end)}.
                Only cash that actually moved is counted — unpaid
                balances appear once they are paid.
            </p>

            <div class="card table-card">
                <div class="table-wrap">
                    <table>
                        <tbody>
                            <tr><th>Cash at the start</th>
                                <th class="amount">${LedgerUtils.peso(opening)}</th></tr>
                            <tr><th colspan="2">MONEY RECEIVED</th></tr>
                            ${rows(received)}
                            <tr><th>Total money received</th>
                                <th class="amount">${LedgerUtils.peso(totalIn)}</th></tr>
                            <tr><th colspan="2">MONEY SPENT</th></tr>
                            ${rows(spent)}
                            <tr><th>Total money spent</th>
                                <th class="amount">${LedgerUtils.peso(totalOut)}</th></tr>
                            <tr><th>Net change in cash</th>
                                <th class="amount">${LedgerUtils.peso(totalIn - totalOut)}</th></tr>
                            <tr><th>Cash at the end</th>
                                <th class="amount">${LedgerUtils.peso(opening + totalIn - totalOut)}</th></tr>
                        </tbody>
                    </table>
                </div>
            </div>

        `;
    }


    // =====================================================
    // OUTSTANDING BALANCES
    // =====================================================

    outstanding() {

        const items = LedgerCash.outstanding(this.state);

        const totals = LedgerCash.unpaidTotals(this.state);

        const paying = this.state.payingId
            ? this.state.getTransaction(this.state.payingId)
            : null;

        const table = (dir, title, total, who) => {

            const rows = items.filter(item => item.dir === dir);

            return `
                <div class="card table-card" style="margin-bottom:16px">
                    <div class="card-head">
                        <h3>${title}</h3>
                        <strong>${LedgerUtils.peso(total)}</strong>
                    </div>
                    <div class="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>DATE</th>
                                    <th>${who}</th>
                                    <th>DESCRIPTION</th>
                                    <th>TOTAL</th>
                                    <th>STILL UNPAID</th>
                                    <th>ACTION</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${
                                    rows.length
                                        ? rows.map(item => `
                                            <tr>
                                                <td>${LedgerUtils.escape(item.transaction.date)}</td>
                                                <td>${LedgerUtils.escape(item.party || "—")}</td>
                                                <td>${LedgerUtils.escape(item.transaction.description)}</td>
                                                <td class="amount">${LedgerUtils.peso(item.transaction.amount)}</td>
                                                <td class="amount">${LedgerUtils.peso(item.balance)}</td>
                                                <td>
                                                    <button class="btn secondary small"
                                                        data-pay="${LedgerUtils.escape(item.transaction.id)}">
                                                        ${dir === "in" ? "Record payment received" : "Record payment made"}
                                                    </button>
                                                </td>
                                            </tr>`).join("")
                                        : `<tr><td colspan="6"><div class="empty-state">Nothing unpaid.</div></td></tr>`
                                }
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
        };

        return `

            ${this.heading(
                "Unpaid Transactions",
                "Money still owed to you and money you still owe."
            )}

            ${paying ? this.paymentForm(paying) : ""}

            ${table("in", "Customers Owe You", totals.customersOweYou, "CUSTOMER")}

            ${table("out", "You Owe Customers", totals.youOwe, "SUPPLIER")}

        `;
    }


    paymentForm(transaction) {

        const balance = LedgerCash.balance(this.state, transaction);

        const incoming = LedgerCash.direction(transaction) === "in";

        const history = LedgerCash.paymentsFor(this.state, transaction.id);

        return `

            <div class="card" style="margin-bottom:16px">

                <div class="card-head">
                    <h3>${incoming ? "Payment received" : "Payment made"}:
                        ${LedgerUtils.escape(transaction.description)}</h3>
                </div>

                <p class="tiny muted">
                    Total ${LedgerUtils.peso(transaction.amount)} ·
                    still unpaid ${LedgerUtils.peso(balance)}
                </p>

                ${
                    history.length
                        ? `<ul class="tiny" style="margin:8px 0">
                            ${history.map(payment => `
                                <li>
                                    ${LedgerUtils.escape(payment.paid_on)} —
                                    ${LedgerUtils.peso(payment.amount)}
                                    <button class="btn ghost small"
                                        data-delete-payment="${LedgerUtils.escape(payment.id)}">
                                        Remove
                                    </button>
                                </li>`).join("")}
                           </ul>`
                        : ""
                }

                <form id="paymentForm" data-id="${LedgerUtils.escape(transaction.id)}">

                    <div class="form-grid">

                        <label>
                            Date paid
                            <input type="date" id="payDate" required
                                value="${LedgerUtils.today()}">
                        </label>

                        <label>
                            Amount (₱)
                            <input type="number" id="payAmount" required
                                min="0.01" max="${balance}" step="0.01"
                                value="${balance}">
                        </label>

                    </div>

                    <div class="modal-actions">
                        <button type="button" class="btn secondary" id="cancelPayment">
                            Cancel
                        </button>
                        <button type="submit" class="btn primary">
                            Save payment
                        </button>
                    </div>

                </form>

            </div>

        `;
    }


    // =====================================================
    // GENERAL LEDGER
    // =====================================================

    ledger() {

        const accounts = {};

        this.state.getJournalItems().forEach(transaction => {

            this.state.getJournalLines(transaction).forEach(line => {

                const name = line.account;

                const type =
                    line.accountType ||
                    LedgerUtils.accountTypeFor(name);

                accounts[name] ??= {

                    accountType: type,

                    lines: []

                };

                accounts[name].lines.push({

                    date: transaction.date,

                    desc:
                        line.description ||
                        transaction.description,

                    debit: Number(line.debit) || 0,

                    credit: Number(line.credit) || 0

                });

            });

        });


        // Adjusting entries are posted to the ledger as well.
        this.state.adjustments.forEach(entry => {

            entry.lines.forEach(line => {

                const name = line.account;

                accounts[name] ??= {
                    accountType:
                        line.accountType ||
                        LedgerUtils.accountTypeFor(name),
                    lines: []
                };

                accounts[name].lines.push({
                    date: entry.date,
                    desc: "Adjusting entry: " + entry.description,
                    debit: Number(line.debit) || 0,
                    credit: Number(line.credit) || 0
                });
            });
        });

        const all = Object.entries(accounts);

        return `

            ${this.heading(
                "General Ledger",

                "Posted journal entries grouped by account, with running balances."
            )}


            <div
                class="info-box"
                style="margin-bottom:16px"
            >

                The General Ledger uses saved journal lines
                from PostgreSQL when available.

                Accounts without saved journal lines use
                suggested entries generated from transaction details.

            </div>


            ${
                all.length

                    ? all.map(([name, account]) => {

                        let balance = 0;

                        // Prefer the chart's normal balance (e.g. Owner's
                        // Drawings is equity but normally debit).
                        const chartAccount = LedgerUtils.findAccount(name);

                        const normalDebit = chartAccount?.normal_balance
                            ? chartAccount.normal_balance === "debit"
                            : [
                                "asset",
                                "expense"
                            ].includes(account.accountType);

                        const lines = [...account.lines].sort(
                            (a, b) =>
                                a.date.localeCompare(b.date)
                        );

                        return `

                            <div
                                class="card"
                                style="margin-bottom:15px"
                            >


                                <div class="card-head">

                                    <div>

                                        <h3>
                                            ${LedgerUtils.escape(name)}
                                        </h3>

                                        <p class="tiny muted">
                                            ${LedgerUtils.escape(
                                                account.accountType.toUpperCase()
                                            )}
                                        </p>

                                    </div>


                                    <span class="tiny muted">
                                        ${lines.length} posting(s)
                                    </span>

                                </div>


                                <div class="table-wrap">

                                    <table>

                                        <thead>
                                            <tr>
                                                <th>DATE</th>
                                                <th>DESCRIPTION</th>
                                                <th>DEBIT</th>
                                                <th>CREDIT</th>
                                                <th>RUNNING BALANCE</th>
                                            </tr>
                                        </thead>


                                        <tbody>

                                            ${lines.map(line => {

                                                balance += normalDebit

                                                    ? line.debit - line.credit

                                                    : line.credit - line.debit;

                                                return `

                                                    <tr>

                                                        <td>
                                                            ${LedgerUtils.escape(line.date)}
                                                        </td>

                                                        <td>
                                                            ${LedgerUtils.escape(line.desc)}
                                                        </td>

                                                        <td>
                                                            ${
                                                                line.debit
                                                                    ? LedgerUtils.peso(line.debit)
                                                                    : "—"
                                                            }
                                                        </td>

                                                        <td>
                                                            ${
                                                                line.credit
                                                                    ? LedgerUtils.peso(line.credit)
                                                                    : "—"
                                                            }
                                                        </td>

                                                        <td class="amount">
                                                            ${LedgerUtils.peso(balance)}
                                                        </td>

                                                    </tr>

                                                `;

                                            }).join("")}

                                        </tbody>

                                    </table>

                                </div>

                            </div>

                        `;

                    }).join("")

                    :

                    `
                        <div class="card empty-state">

                            No posted entries yet.

                            Add a transaction to populate the General Ledger.

                        </div>
                    `
            }

        `;
    }



    // =====================================================
    // RECEIPTS
    // =====================================================

    receipts() {

        return `

            ${this.heading(
                "Receipts",

                "Keep supporting documents organized and connected to transactions.",

                `
                    <button
                        class="btn primary"
                        id="uploadReceipt"
                    >
                        ＋ Upload Receipt
                    </button>
                `
            )}


            <div class="toolbar">

                <div class="search">

                    <input
                        id="receiptSearch"
                        placeholder="Search receipts..."
                    >

                </div>


                <span class="tiny muted">
                    ${this.state.receipts.length}
                    uploaded document(s)
                </span>

            </div>


            <div class="grid receipt-grid">

                ${
                    this.state.receipts.map(receipt => `

                        <div class="receipt-card">

                            <div
                                class="receipt-preview"
                                style="
                                    height:180px;
                                    overflow:hidden;
                                    display:flex;
                                    align-items:center;
                                    justify-content:center
                                "
                            >

                                ${
                                    receipt.type.startsWith("image/")

                                        ? `
                                            <img
                                                src="${receipt.data}"
                                                alt=""
                                                style="
                                                    display:block;
                                                    width:100%;
                                                    height:100%;
                                                    object-fit:contain
                                                "
                                            >
                                        `

                                        : "▤"
                                }

                            </div>


                            <strong>
                                ${LedgerUtils.escape(receipt.name)}
                            </strong>


                            <p>
                                ${LedgerUtils.escape(receipt.date)}
                                ·
                                ${LedgerUtils.escape(
                                    receipt.type || "Document"
                                )}
                            </p>


                            <button
                                class="btn secondary small"
                                data-open-receipt="${LedgerUtils.escape(receipt.id)}"
                            >
                                View document
                            </button>


                            <button
                                class="btn ghost small"
                                data-delete-receipt="${LedgerUtils.escape(receipt.id)}"
                            >
                                Remove
                            </button>

                        </div>

                    `).join("")

                    ||

                    `
                        <div
                            class="card empty-state"
                            style="grid-column:1/-1"
                        >

                            No receipts uploaded yet.

                            Upload an image or PDF to start your
                            digital document library.

                        </div>
                    `
                }

            </div>


            <input
                id="receiptInput"
                type="file"
                accept="image/*,.pdf"
                hidden
            >

        `;
    }


    // =====================================================
    // SETTINGS
    // =====================================================

    settings() {

        return `

            ${this.heading(
                "Settings",
                "Manage your LARP workspace."
            )}


            <div class="card">


                <div class="setting-row">

                    <div>

                        <strong>Storage mode</strong>

                        <div class="muted-small">
                            Transactions are stored in your PostgreSQL database.
                        </div>

                    </div>

                    <span class="badge approved">
                        PostgreSQL
                    </span>

                </div>


                <div class="setting-row">

                    <div>

                        <strong>Currency</strong>

                        <div class="muted-small">
                            Philippine peso (PHP)
                        </div>

                    </div>

                    <strong>₱ PHP</strong>

                </div>


                <div class="setting-row">

                    <div>

                        <strong>Database connection</strong>

                        <div class="muted-small">
                            Express API connected to your LARP PostgreSQL database.
                        </div>

                    </div>

                    <span class="badge approved">
                        Connected
                    </span>

                </div>


                <div class="setting-row">

                    <div>

                        <strong>Receipt storage</strong>

                        <div class="muted-small">
                            Receipt files are temporarily stored in browser memory.
                        </div>

                    </div>

                    <span class="badge pending">
                        Temporary
                    </span>

                </div>


            </div>

        `;
    }




    getPages() {

        return {

            dashboard: () => this.dashboard(),

            transactions: () => this.transactions(),

            receipts: () => this.receipts(),

            journal: () => this.journal(),

            ledger: () => this.ledger(),

            cashFlow: () => this.cashFlow(),

            outstanding: () => this.outstanding(),

            settings: () => this.settings()

        };
    }
}

// =========================================================
// 8. MAIN APPLICATION CONTROLLER
// =========================================================

class LedgerApp {

    constructor() {

        this.state = new LedgerState();

        this.api = new LedgerAPI(this.state);

        this.view = new LedgerView(this.state);

        this.dashboardChart =
            new LedgerDashboardChart(this.state);

        this.pages = this.view.getPages();

        this.titles = {

            dashboard: "Dashboard",

            transactions: "Transactions",

            receipts: "Receipts",

            journal: "Journal Entries",

            ledger: "General Ledger",

            cashFlow: "Cash Flow",

            outstanding: "Unpaid Transactions",

            settings: "Settings"

        };
    }


    // =====================================================
    // AUTHENTICATION
    // =====================================================

    setAuthMode(mode) {

        this.state.authMode = mode;

        const register = mode === "register";

        document.getElementById("authTitle").textContent =
            register
                ? "Create your account"
                : "Welcome back";

        document.getElementById("authSubtitle").textContent =
            register
                ? "Create an account to manage your business records."
                : "Sign in to manage your business records.";

        document.getElementById("nameField").hidden =
            !register;

        document.getElementById("authName").required =
            register;

        document.getElementById("authPassword").autocomplete =
            register
                ? "new-password"
                : "current-password";

        document.getElementById("authSubmit").textContent =
            register
                ? "Create account"
                : "Sign in";

        document.getElementById("authSwitchText").textContent =
            register
                ? "Already have an account?"
                : "Don't have an account?";

        document.getElementById("authSwitch").textContent =
            register
                ? "Sign in"
                : "Create account";

        document.getElementById("authMessage").textContent = "";
    }


    // -----------------------------------------------------
    // LOGIN AND REGISTRATION
    // -----------------------------------------------------

    async handleAuth(event) {

        event.preventDefault();

        const message =
            document.getElementById("authMessage");

        const button =
            document.getElementById("authSubmit");

        const email =
            document.getElementById("authEmail")
                .value.trim();

        const password =
            document.getElementById("authPassword")
                .value;

        const name =
            document.getElementById("authName")
                .value.trim();


        if (
            this.state.authMode === "register" &&
            !name
        ) {

            message.textContent =
                "Please enter your full name.";

            return;
        }


        if (password.length < 8) {

            message.textContent =
                "Password must contain at least 8 characters.";

            return;
        }


        button.disabled = true;

        message.textContent = "Please wait...";


        try {

            const mode = this.state.authMode;

            const data = mode === "register"

                ? await this.api.register(
                    name,
                    email,
                    password
                )

                : await this.api.login(
                    email,
                    password
                );


            if (!data.token || !data.user) {

                throw new Error(
                    "The server did not return a valid login session."
                );
            }


            sessionStorage.setItem(
                LedgerUtils.TOKEN_KEY,
                data.token
            );

            sessionStorage.setItem(
                LedgerUtils.USER_KEY,
                JSON.stringify(data.user)
            );


            this.state.currentUser = data.user;

            document.getElementById("authForm").reset();


            await this.start();


            LedgerUtils.toast(
                mode === "register"
                    ? "Account created successfully!"
                    : "Welcome back!"
            );

        } catch (error) {

            message.textContent = error.message;

        } finally {

            button.disabled = false;
        }
    }


    logout(showMessage = true) {

        this.dashboardChart.destroy();

        this.api.logout(showMessage);

        this.setAuthMode("login");
    }


    // =====================================================
    // INITIALIZATION
    // =====================================================

    async start() {

        if (!this.api.getToken()) {

            this.logout(false);

            return;
        }


        // Restore user information
        try {

            this.state.currentUser = JSON.parse(
                sessionStorage.getItem(
                    LedgerUtils.USER_KEY
                ) || "null"
            );

        } catch {

            this.state.currentUser = null;
        }


        document.getElementById("authScreen").hidden = true;

        document.querySelector(".app-shell").style.display = "";


        // Update profile
        document.getElementById("profileName").textContent =
            this.state.currentUser?.full_name || "User";

        document.getElementById("profileAvatar").textContent =
            (this.state.currentUser?.full_name || "U")
                .charAt(0)
                .toUpperCase();


        document.getElementById("connectionStatus").textContent =
            "Connecting...";


        try {

                        await this.api.loadTransactions();

            // The chart must load before journal entries so account types resolve.
            try {

                await this.api.loadAccounts();

            } catch (error) {

                if (!this.api.getToken()) return;

                LedgerUtils.toast(
                    "Chart of accounts unavailable: " + error.message,
                    "error"
                );
            }

            await this.api.loadJournalEntries();

            try {
                await this.api.loadReceipts();

            } catch (error) {

                if (!this.api.getToken()) return;

                LedgerUtils.toast(
                    "Receipts could not be loaded: " + error.message,
                    "error"
                );
            }

            try {
                await this.api.loadCashbook();

            } catch (error) {

                if (!this.api.getToken()) return;

                LedgerUtils.toast(
                    "Payment details could not be loaded: " + error.message,
                    "error"
                );
            }


            document.getElementById("connectionStatus").textContent =
                "Database connected";


            this.render("dashboard");

        } catch (error) {

            document.getElementById("connectionStatus").textContent =
                "Connection error";

            if (!this.api.getToken()) {
                return;
            }

            this.render("dashboard");

            LedgerUtils.toast(
                error.message,
                "error"
            );
        }
    }


    async initialize() {

        this.setAuthMode("login");

        document.querySelector(".app-shell").style.display =
            "none";


        if (this.api.getToken()) {

            await this.start();

        } else {

            document.getElementById("authScreen").hidden =
                false;
        }
    }


    // =====================================================
    // PAGE NAVIGATION
    // =====================================================

    render(page = this.state.currentPage) {

        if (!this.pages[page]) {
            page = "dashboard";
        }


        // Destroy previous chart before removing canvas.
        this.dashboardChart.destroy();


        this.state.currentPage = page;


        document.getElementById("breadcrumbCurrent").textContent =
            this.titles[page];


        // Update active sidebar navigation
        document.querySelectorAll(
            ".nav-item[data-page]"
        ).forEach(button => {

            button.classList.toggle(
                "active",
                button.dataset.page === page
            );

            // keep the group of the open page expanded
            if (button.dataset.page === page) {

                const group = button.closest(".nav-group");

                if (group) this.setNavGroup(group, true);
            }
        });


        // Render page
        document.getElementById("pageContent").innerHTML =
            this.pages[page]();


        // Attach page event listeners
        this.wirePage();

        // Initialize dashboard chart
        if (page === "dashboard") {

            this.dashboardChart.render();

        }


        window.scrollTo(0, 0);


        // Jump to a specific journal entry (set by the "View" button).
        if (page === "journal" && this.state.focusJournalId) {

            const target = document.getElementById(
                `journal-${this.state.focusJournalId}`
            );

            this.state.focusJournalId = null;

            if (target) {

                target.scrollIntoView({
                    behavior: "smooth",
                    block: "start"
                });

                target.style.transition =
                    "box-shadow 0.4s ease";

                target.style.boxShadow =
                    "0 0 0 3px #3a4a8f";

                window.setTimeout(() => {
                    target.style.boxShadow = "";
                }, 2500);
            }
        }
    }


    // =====================================================
    // TRANSACTION MODAL
    // =====================================================

    // Step 1 shows the form; step 2 shows the review before saving.
    populateTransactionTypes() {

        const box = document.getElementById("txTypeCards");

        if (!box) return;

        box.innerHTML = Object.entries(LedgerUtils.ENTRY_TYPES)
            .map(([key, config]) => `
                <label class="tx-type-card" data-type-card="${key}">
                    <input
                        type="radio"
                        name="txTypeChoice"
                        value="${key}"
                        ${key === this.txType ? "checked" : ""}
                    >
                    <span class="tx-type-title">
                        ${LedgerUtils.escape(config.label)}
                    </span>
                    <span class="tx-type-desc">
                        ${LedgerUtils.escape(config.description)}
                    </span>
                </label>
            `).join("");

        box.querySelectorAll("input").forEach(input => {
            input.addEventListener("change", () => {
                this.txType = input.value;
                this.populateTransactionCategories();
            });
        });

        this.populateTransactionCategories();
    }

    populateTransactionCategories() {

        const select = document.getElementById("txCategory");

        if (!select) return;

        const config = LedgerUtils.ENTRY_TYPES[this.txType];

        select.innerHTML = config.categories.map(category => `
            <option value="${LedgerUtils.escape(category.name)}">
                ${LedgerUtils.escape(category.name)}
            </option>
        `).join("");

        document.querySelectorAll("[data-type-card]").forEach(card => {
            card.classList.toggle(
                "selected",
                card.dataset.typeCard === this.txType
            );
        });

        // The party is a customer for money in and a supplier for money out.
        const partyLabel = document.getElementById("txPartyLabel");
        const party = document.getElementById("txPartyField");
        const status = document.getElementById("txPaymentFields");

        const owner = this.txType === "owner";

        if (partyLabel) {
            partyLabel.textContent =
                this.txType === "received"
                    ? "Customer (optional)"
                    : "Supplier (optional)";
        }

        if (party) party.hidden = owner;

        // Owner money always moves straight away.
        if (status) status.hidden = owner;

        this.updatePaymentFields();
    }

    updatePaymentFields() {

        const status = document.getElementById("txPayStatus")?.value;

        const partial = document.getElementById("txPaidField");

        if (partial) {
            partial.hidden = status !== "partial";
        }

        const input = document.getElementById("txPaidAmount");

        if (input) input.required = status === "partial" && this.txType !== "owner";
    }

    // -----------------------------------------------------
    // CLEAR ALL TRANSACTIONS (several warnings, then checks)
    // -----------------------------------------------------

    openClearDialog() {

        const count = this.state.transactions.length;

        if (!count) return;

        const payments = this.state.payments.length;

        document.getElementById("clearList").innerHTML = `
            <li>${count} transaction${count === 1 ? "" : "s"}</li>
            <li>${payments} recorded payment${payments === 1 ? "" : "s"}</li>
            <li>Every journal entry and ledger balance built from them</li>
            <li>Receipt links to these transactions</li>
        `;

        document.getElementById("clearForm").reset();

        document.getElementById("clearEmail").value =
            this.state.currentUser?.email || "";

        document.getElementById("clearEmailField").hidden =
            Boolean(this.state.currentUser?.email);

        this.showClearStep(1);

        document.getElementById("clearBackdrop").hidden = false;
    }

    closeClearDialog() {

        window.clearInterval(this.clearTimer);

        document.getElementById("clearBackdrop").hidden = true;

        document.getElementById("clearForm").reset();
    }

    showClearStep(step) {

        document.getElementById("clearStep1").hidden = step !== 1;
        document.getElementById("clearStep2").hidden = step !== 2;

        window.clearInterval(this.clearTimer);

        if (step !== 2) return;

        // The final button stays locked for 5 seconds, so it cannot be
        // pressed by reflex.
        this.clearUnlockAt = Date.now() + 5000;

        this.clearTimer = window.setInterval(
            () => this.updateClearButton(),
            250
        );

        this.updateClearButton();
    }

    updateClearButton() {

        const button = document.getElementById("clearSubmit");

        const hint = document.getElementById("clearHint");

        if (!button) return;

        const wait = Math.max(
            0,
            Math.ceil((this.clearUnlockAt - Date.now()) / 1000)
        );

        const problems = [];

        if (document.getElementById("clearPhrase").value !== "DELETE ALL") {
            problems.push("type DELETE ALL");
        }

        if (!document.getElementById("clearPassword").value) {
            problems.push("enter your password");
        }

        if (!document.getElementById("clearAck").checked) {
            problems.push("tick the box");
        }

        if (wait > 0) problems.push(`wait ${wait}s`);

        button.disabled = problems.length > 0;

        hint.textContent = problems.length
            ? "To continue: " + problems.join(", ") + "."
            : "Last chance — this will erase everything now.";
    }

    async clearTransactions(event) {

        event.preventDefault();

        const button = document.getElementById("clearSubmit");

        if (button.disabled) return;

        const email = document.getElementById("clearEmail").value.trim();

        const password = document.getElementById("clearPassword").value;

        // Final browser-level warning.
        const count = this.state.transactions.length;

        if (!window.confirm(
            `FINAL WARNING\n\nDelete all ${count} transactions forever?\n\nThis cannot be undone.`
        )) {
            return;
        }

        button.disabled = true;

        try {

            // Prove it is really the account owner: the password must be right.
            try {

                await this.api.login(email, password);

            } catch (error) {

                throw new Error("Wrong password. Nothing was deleted.");
            }

            const result = await this.api.request("/cashbook/clear", {
                method: "POST",
                body: JSON.stringify({
                    phrase: document.getElementById("clearPhrase").value,
                    expected_count: count
                })
            });

            await this.api.loadTransactions();
            await this.api.loadCashbook();
            await this.api.loadJournalEntries();

            this.closeClearDialog();

            this.render("transactions");

            LedgerUtils.toast(
                `${result.deleted} transactions were deleted.`
            );

        } catch (error) {

            LedgerUtils.toast(error.message, "error");

            this.updateClearButton();
        }
    }

    async savePayment(event) {

        event.preventDefault();

        const form = event.currentTarget;

        const button = form.querySelector('[type="submit"]');

        button.disabled = true;

        try {

            await this.api.recordPayment(form.dataset.id, {
                paid_on: document.getElementById("payDate").value,
                amount: LedgerCash.round(
                    document.getElementById("payAmount").value
                )
            });

            await this.api.loadCashbook();

            this.state.payingId = null;

            this.render("outstanding");

            LedgerUtils.toast("Payment recorded.");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");

            button.disabled = false;
        }
    }

    async removePayment(id) {

        if (!window.confirm("Remove this payment? The balance will be unpaid again.")) {
            return;
        }

        try {

            await this.api.deletePayment(id);

            await this.api.loadCashbook();

            this.render("outstanding");

            LedgerUtils.toast("Payment removed.");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    openModal() {

        this.txType = "received";

        document.getElementById("transactionForm").reset();

        document.getElementById("modalBackdrop").hidden = false;

        document.getElementById("txDate").value = LedgerUtils.today();

        this.showTransactionStep("form");

        this.populateTransactionTypes();

        document.getElementById("txAmount").focus();
    }

    closeModal() {

        document.getElementById("modalBackdrop").hidden = true;

        document.getElementById("transactionForm").reset();

        this.showTransactionStep("form");
    }

    showTransactionStep(step) {

        this.txStep = step;

        const form = document.getElementById("txStepForm");
        const review = document.getElementById("txStepReview");
        const back = document.getElementById("txBack");
        const next = document.getElementById("txSubmit");
        const cancel = document.getElementById("cancelModal");

        if (form) form.hidden = step !== "form";
        if (review) review.hidden = step !== "review";
        if (back) back.hidden = step !== "review";
        if (cancel) cancel.hidden = step === "review";

        if (next) {
            next.textContent =
                step === "review" ? "Confirm and Save" : "Review →";
        }
    }

    // Reads and checks the form. Returns null (after a message) if invalid.
    readTransactionDraft() {

        const config = LedgerUtils.ENTRY_TYPES[this.txType];

        const category = document.getElementById("txCategory").value;

        const choice = config.categories.find(item => item.name === category);

        const date = document.getElementById("txDate").value;

        const amount = LedgerCash.round(
            document.getElementById("txAmount").value
        );

        const party = this.txType === "owner"
            ? ""
            : document.getElementById("txParty").value.trim();

        const typed = document.getElementById("txDescription").value.trim();

        const description =
            typed || (category + (party ? " — " + party : ""));

        let status = this.txType === "owner"
            ? "paid"
            : document.getElementById("txPayStatus").value;

        if (!date || !choice) {
            LedgerUtils.toast("Choose a date and a category.", "error");
            return null;
        }

        if (!(amount > 0)) {
            LedgerUtils.toast("Enter a total amount greater than zero.", "error");
            return null;
        }

        let paid = amount;

        if (status === "unpaid") paid = 0;

        if (status === "partial") {

            paid = LedgerCash.round(
                document.getElementById("txPaidAmount").value
            );

            if (!(paid > 0) || paid >= amount) {
                LedgerUtils.toast(
                    "For a partial payment, enter an amount paid that is " +
                    "more than zero and less than the total.",
                    "error"
                );
                return null;
            }
        }

        return {
            date,
            uiType: this.txType,
            category,
            dbType: choice.dbType,
            amount,
            description,
            party,
            status,
            paid
        };
    }

    // The entries LARP will record, shown before anything is saved.
    renderTransactionReview(draft) {

        const lines = LedgerAccounting.journalFor({
            type: draft.dbType,
            category: draft.category,
            description: draft.description,
            amount: draft.amount,
            initialPaid: draft.paid
        });

        const unpaid = LedgerCash.round(draft.amount - draft.paid);

        const incoming = draft.uiType === "received" ||
            draft.dbType === "investment";

        const row = (label, value) => `
            <tr><th>${label}</th><td>${value}</td></tr>
        `;

        document.getElementById("txReviewBody").innerHTML = `

            <table class="review-table">
                <tbody>
                    ${row("Type", LedgerUtils.escape(
                        LedgerUtils.ENTRY_TYPES[draft.uiType].label))}
                    ${row("Category", LedgerUtils.escape(draft.category))}
                    ${row("Date", LedgerUtils.escape(draft.date))}
                    ${row("Total amount", LedgerUtils.peso(draft.amount))}
                    ${row("Payment", LedgerCash.statusLabel(draft.status))}
                    ${draft.status === "unpaid" ? "" : row(
                        incoming ? "Received now" : "Paid now",
                        LedgerUtils.peso(draft.paid))}
                    ${unpaid > 0 ? row("Still unpaid", LedgerUtils.peso(unpaid)) : ""}
                    ${draft.party ? row(
                        draft.uiType === "received" ? "Customer" : "Supplier",
                        LedgerUtils.escape(draft.party)) : ""}
                    ${row("Description", LedgerUtils.escape(draft.description))}
                </tbody>
            </table>

            <h4 style="margin:16px 0 6px">Suggested accounting entries</h4>

            <table class="review-table">
                <thead>
                    <tr><th>Account</th><th>Debit</th><th>Credit</th></tr>
                </thead>
                <tbody>
                    ${lines.map(line => `
                        <tr>
                            <td>${LedgerUtils.escape(line.account)}</td>
                            <td>${line.debit ? LedgerUtils.peso(line.debit) : ""}</td>
                            <td>${line.credit ? LedgerUtils.peso(line.credit) : ""}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>

            <p class="tiny muted" style="margin-top:8px">
                Saving updates your cash, journal and ledger automatically.
            </p>
        `;
    }


    // -----------------------------------------------------
    // ADD TRANSACTION (review, then confirm)
    // -----------------------------------------------------

    async addTransaction(event) {

        event.preventDefault();

        // First press: validate and show the review.
        if (this.txStep !== "review") {

            const draft = this.readTransactionDraft();

            if (!draft) return;

            this.txDraft = draft;

            this.renderTransactionReview(draft);

            this.showTransactionStep("review");

            return;
        }

        const draft = this.txDraft;

        const button = document.getElementById("txSubmit");

        const file = document.getElementById("txReceipt").files[0];

        if (file && file.size > 4 * 1024 * 1024) {

            LedgerUtils.toast("Receipt must be 4 MB or smaller.", "error");

            return;
        }

        button.disabled = true;

        try {

            const result = await this.api.saveCashbookTransaction({
                date: draft.date,
                type: draft.dbType,
                category: draft.category,
                description: draft.description,
                amount: draft.amount,
                party_name: draft.party,
                paid_amount: draft.paid
            });

            const saved = result.transaction || result;

            if (!saved.id) {
                throw new Error(
                    "The server did not return the saved transaction ID."
                );
            }

            let receiptResult = null;

            if (file) {
                receiptResult = await this.addReceiptFiles([file], false, saved.id);
            }

            await this.api.loadTransactions();
            await this.api.loadCashbook();
            await this.api.loadJournalEntries();

            this.closeModal();

            this.render("transactions");

            if (file && receiptResult?.failed) {
                LedgerUtils.toast(
                    "Transaction saved, but receipt upload failed: " +
                    receiptResult.error.message,
                    "error"
                );
            } else {
                LedgerUtils.toast("Transaction saved. Your records are updated.");
            }

        } catch (error) {

            LedgerUtils.toast(error.message, "error");

        } finally {

            button.disabled = false;
        }
    }


    // =====================================================
    // CSV IMPORT
    // =====================================================

    // -----------------------------------------------------
    // OPEN FILE PICKER
    // -----------------------------------------------------

    openImportDialog() {

        const input = document.getElementById(
            "importTransactionsFile"
        );

        input?.click();
    }


    // -----------------------------------------------------
    // DOWNLOAD CSV TEMPLATE
    // -----------------------------------------------------

    downloadImportTemplate() {

        const csv = LedgerCSVImporter.createTemplate();

        const blob = new Blob(
            ["\uFEFF", csv],
            {
                type: "text/csv;charset=utf-8;"
            }
        );

        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");

        link.href = url;

        link.download = "ledger-import-template.csv";

        document.body.appendChild(link);

        link.click();

        link.remove();

        URL.revokeObjectURL(url);


        LedgerUtils.toast(
            "CSV template downloaded."
        );
    }


    // -----------------------------------------------------
    // IMPORT CSV FILE
    // -----------------------------------------------------

    async importTransactionsFile(event) {

        const input = event.currentTarget;

        const file = input.files?.[0];

        if (!file) return;


        // Allow selecting the same file again.
        input.value = "";


        if (!file.name.toLowerCase().endsWith(".csv")) {

            LedgerUtils.toast(
                "Please select a CSV file.",
                "error"
            );

            return;
        }


        if (file.size > 5 * 1024 * 1024) {

            LedgerUtils.toast(
                "CSV file must be 5 MB or smaller.",
                "error"
            );

            return;
        }


        let result;

        try {

            const text = await file.text();

            result =
                LedgerCSVImporter.parseTransactions(text);

        } catch (error) {

            LedgerUtils.toast(
                error.message,
                "error"
            );

            return;
        }


        const valid = result.valid;

        const invalid = result.invalid;


        if (!valid.length) {

            const details = invalid
                .slice(0, 10)
                .map(item =>
                    `Row ${item.rowNumber}: ${item.reason}`
                )
                .join("\n");


            window.alert(
                "No valid transactions found.\n\n" +
                details
            );

            return;
        }


        const message = `CSV IMPORT PREVIEW

File: ${file.name}

Valid transactions: ${valid.length}

Invalid transactions: ${invalid.length}

${invalid.length
    ? "Invalid records will be skipped."
    : "All records passed validation."
}

Do you want to continue?`;


        if (!window.confirm(message)) {
            return;
        }


        const button = document.getElementById(
            "importTransactions"
        );

        if (button) {

            button.disabled = true;

            button.textContent = "IMPORTING...";
        }


        let importedCount = 0;

        const failed = [];


        try {

            // Save transactions individually.
            for (const item of valid) {

                try {

                    await this.api.saveTransaction(
                        item.transaction
                    );

                    importedCount++;

                } catch (error) {

                    failed.push({

                        rowNumber: item.rowNumber,

                        reason: error.message

                    });


                    if (!this.api.getToken()) {
                        break;
                    }
                }
            }


            if (!this.api.getToken()) {
                return;
            }


            // Refresh database records.
            let refreshError = null;

            if (importedCount > 0) {

                try {

                    await this.api.loadTransactions();

                    await this.api.loadJournalEntries();

                    await this.api.loadCashbook();

                } catch (error) {

                    refreshError = error.message;
                }
            }


            this.render("transactions");


            if (importedCount > 0) {

                LedgerUtils.toast(
                    `${importedCount} transaction(s) imported successfully.`
                );
            }


            const errors = [
                ...invalid,
                ...failed
            ];


            if (errors.length > 0) {

                const details = errors
                    .slice(0, 10)
                    .map(item =>
                        `Row ${item.rowNumber}: ${item.reason}`
                    )
                    .join("\n");


                window.alert(`IMPORT RESULTS

Imported: ${importedCount}

Skipped or failed: ${errors.length}

${details}

${errors.length > 10
    ? `\nAnd ${errors.length - 10} more error(s).`
    : ""}`);
            }


            if (
                importedCount === 0 &&
                failed.length > 0
            ) {

                LedgerUtils.toast(
                    "No transactions were imported successfully.",
                    "error"
                );
            }


            if (refreshError) {

                LedgerUtils.toast(
                    "Transactions were saved, but refreshing the records failed: " +
                    refreshError,
                    "error"
                );
            }

        } catch (error) {

            LedgerUtils.toast(
                "Import failed: " + error.message,
                "error"
            );

        } finally {

            const currentButton = document.getElementById(
                "importTransactions"
            );

            if (currentButton) {

                currentButton.disabled = false;

                currentButton.textContent = "↑ Import CSV";
            }
        }
    }


    setNavGroup(group, open, remember = true) {

        group.classList.toggle("open", open);

        group.querySelector("[data-group-toggle]")
            ?.setAttribute("aria-expanded", String(open));

        if (!remember) return;

        try {

            const saved = JSON.parse(
                localStorage.getItem("ledger-nav-groups") || "{}"
            );

            saved[group.dataset.group] = open;

            localStorage.setItem("ledger-nav-groups", JSON.stringify(saved));

        } catch (error) {
            // storage unavailable: the groups still work this session
        }
    }



        // =====================================================
    // CHART OF ACCOUNTS
    // =====================================================

    rerenderKeepScroll() {

        const y = window.scrollY;

        this.render(this.state.currentPage);

        window.scrollTo(0, y);
    }



    // =====================================================
    // RECEIPT MANAGEMENT
    // =====================================================


    async addReceiptFiles(
        files,
        shouldRender = true,
        transactionId = null
    ) {

        let uploaded = 0;
        let failed = 0;
        let lastError = null;

        for (const file of Array.from(files || [])) {

            if (file.size > 4 * 1024 * 1024) {

                failed++;

                lastError = new Error(
                    `${file.name} is over 4 MB.`
                );

                continue;
            }

            try {

                const receipt = await this.api.saveReceipt(
                    file,
                    transactionId
                );

                this.state.receipts.unshift(receipt);

                uploaded++;

            } catch (error) {

                failed++;
                lastError = error;
            }
        }

        if (shouldRender) {

            this.render("receipts");

            if (uploaded > 0 && failed > 0) {

                LedgerUtils.toast(
                    `${uploaded} receipt(s) saved; ${failed} failed.`,
                    "error"
                );

            } else if (uploaded > 0) {

                LedgerUtils.toast(
                    uploaded === 1
                        ? "Receipt saved to the database."
                        : `${uploaded} receipts saved to the database.`
                );

            } else if (failed > 0) {

                LedgerUtils.toast(
                    lastError?.message || "Unable to save receipts.",
                    "error"
                );
            }
        }

        return {
            uploaded,
            failed,
            error: lastError
        };
    }


    // -----------------------------------------------------
    // OPEN RECEIPT
    // -----------------------------------------------------

    openReceipt(id) {

        const receipt =
            this.state.receipts.find(
                item => String(item.id) === String(id)
            );


        if (!receipt) return;


        const win = window.open();


        if (!win) {

            LedgerUtils.toast(
                "Please allow pop-ups to view this receipt.",
                "error"
            );

            return;
        }


        if (receipt.type === "application/pdf") {

            win.location.href = receipt.data;

        } else {

            const image =
                win.document.createElement("img");

            image.src = receipt.data;

            image.style.maxWidth = "100%";

            win.document.body.append(image);
        }
    }


    // -----------------------------------------------------
    // DELETE RECEIPT
    // -----------------------------------------------------

    async deleteReceipt(id) {

        try {

            await this.api.deleteReceipt(id);

            this.state.receipts =
                this.state.receipts.filter(
                    receipt => String(receipt.id) !== String(id)
                );

            this.render("receipts");

            LedgerUtils.toast(
                "Receipt deleted from the database."
            );

        } catch (error) {

            LedgerUtils.toast(
                error.message,
                "error"
            );
        }
    }


    // =====================================================
    // CSV EXPORT
    // =====================================================

    exportCSV() {

        const rows = [

            [
                "Date",
                "Description",
                "Category",
                "Type",
                "Amount",
                "Status"
            ],


            ...this.state.transactions.map(transaction => [

                transaction.date,

                transaction.description,

                transaction.category,

                transaction.type,

                transaction.amount,

                transaction.status

            ])

        ];


        const csv = rows.map(row =>

            row.map(value =>
                LedgerUtils.csvEscape(value)
            ).join(",")

        ).join("\r\n");


        const blob = new Blob(
            ["\uFEFF", csv],
            {
                type: "text/csv;charset=utf-8;"
            }
        );


        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");

        link.href = url;

        link.download = "ledger-transactions.csv";

        document.body.appendChild(link);

        link.click();

        link.remove();

        URL.revokeObjectURL(url);


        LedgerUtils.toast(
            "CSV report exported."
        );
    }


    // =====================================================
    // TRANSACTION FILTERS
    // =====================================================

    filterTransactions() {

        const search =
            document.getElementById("txSearch");

        const status =
            document.getElementById("statusFilter");

        const type =
            document.getElementById("typeFilter");


        const query =
            (search?.value || "").toLowerCase();

        const statusValue = status?.value || "";

        const typeValue = type?.value || "";


        const filtered =
            this.state.transactions.filter(transaction => {

                const matchesSearch =
                    !query ||

                    `${transaction.description} ${transaction.category}`
                        .toLowerCase()
                        .includes(query);


                const matchesStatus =
                    !statusValue ||

                    (
                        statusValue === "posted" &&
                        transaction.status !== "review"
                    ) ||

                    (
                        statusValue === "review" &&
                        transaction.status === "review"
                    );


                const matchesType =
                    !typeValue ||

                    LedgerUtils.entryTypeOf(transaction.type) === typeValue;


                return (
                    matchesSearch &&
                    matchesStatus &&
                    matchesType
                );
            });


        const table =
            document.getElementById("transactionTable");


        if (table) {

            table.innerHTML =
                this.view.transactionTable(filtered);

            this.wireTableActions();
        }
    }


    // =====================================================
    // TABLE ACTIONS
    // =====================================================

    wireTableActions() {

        document.querySelectorAll("[data-review]")
            .forEach(button => {

                button.addEventListener("click", () => {

                    const id = button.dataset.review;

                    const transaction =
                        this.state.getTransaction(id);


                    if (transaction) {

                        // Scroll straight to this transaction's entry.
                        this.state.focusJournalId = transaction.id;

                        this.render("journal");

                        LedgerUtils.toast(
                            "Review the journal entry for: " +
                            transaction.description
                        );
                    }

                });

            });


        document.querySelectorAll("[data-delete-transaction]")
            .forEach(button => {

                button.addEventListener("click", () => {

                    this.deleteTransaction(
                        button.dataset.deleteTransaction
                    );

                });

            });
    }


    // -----------------------------------------------------
    // DELETE TRANSACTION
    // -----------------------------------------------------

    async deleteTransaction(id) {

        const transaction = this.state.getTransaction(id);

        if (!transaction) return;


        const confirmed = window.confirm(
            `Delete this transaction?\n\n` +
            `${transaction.date} · ${transaction.description} · ` +
            `${LedgerUtils.peso(transaction.amount)}\n\n` +
            (
                LedgerUtils.stockEffect(transaction.type)
                    ? `Its inventory change will be reversed, and its journal entry removed. `
                    : `Its journal entry will be removed too. `
            ) +
            `This cannot be undone.`
        );

        if (!confirmed) return;

        try {

            await this.api.deleteTransaction(id);

            await this.api.loadTransactions();

            await this.api.loadJournalEntries();

            await this.api.loadCashbook().catch(() => {});

            this.rerenderKeepScroll();

            LedgerUtils.toast("Transaction deleted.");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }



    // =====================================================
    // PAGE EVENT LISTENERS
    // =====================================================

        wirePage() {

        // Dashboard: This Week / This Month / This Year
        document.getElementById("dashboardRange")
            ?.addEventListener("change", event => {

                this.state.dashboardRange = event.target.value;

                this.render("dashboard");
            });

        document.getElementById("cashFlowRange")
            ?.addEventListener("change", event => {

                this.state.cashFlowRange = event.target.value;

                this.render("cashFlow");
            });


        // Unpaid transactions: record or remove a payment
        document.querySelectorAll("[data-pay]")
            .forEach(button => {
                button.addEventListener("click", () => {

                    this.state.payingId = button.dataset.pay;

                    this.render("outstanding");

                    document.getElementById("payAmount")?.focus();
                });
            });

        document.getElementById("cancelPayment")
            ?.addEventListener("click", () => {

                this.state.payingId = null;

                this.render("outstanding");
            });

        document.getElementById("paymentForm")
            ?.addEventListener("submit", event => {
                this.savePayment(event);
            });

        document.querySelectorAll("[data-delete-payment]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    this.removePayment(button.dataset.deletePayment);
                });
            });


        // Clear all transactions
        document.getElementById("clearTransactions")
            ?.addEventListener("click", () => {
                this.openClearDialog();
            });

        // Add transaction
        document.getElementById("addTransaction")
            ?.addEventListener("click", () => {

                this.openModal();

            });


        // CSV Import
        document.getElementById("importTransactions")
            ?.addEventListener("click", () => {

                this.openImportDialog();

            });


        // CSV file selection
        document.getElementById("importTransactionsFile")
            ?.addEventListener("change", event => {

                this.importTransactionsFile(event);

            });


        // Download CSV template
        document.getElementById("downloadImportTemplate")
            ?.addEventListener("click", () => {

                this.downloadImportTemplate();

            });


        // Navigate
        document.querySelectorAll("[data-goto]")
            .forEach(button => {

                button.addEventListener("click", () => {

                    this.render(button.dataset.goto);

                });

            });


        // Review transaction
        this.wireTableActions();


        // Open receipt
        document.querySelectorAll("[data-open-receipt]")
            .forEach(button => {

                button.addEventListener("click", () => {

                    this.openReceipt(
                        button.dataset.openReceipt
                    );

                });

            });


        // Delete receipt
        document.querySelectorAll("[data-delete-receipt]")
            .forEach(button => {

                button.addEventListener("click", () => {

                    this.deleteReceipt(
                        button.dataset.deleteReceipt
                    );

                });

            });


        // Upload receipt
        document.getElementById("uploadReceipt")
            ?.addEventListener("click", () => {

                document.getElementById("receiptInput")?.click();

            });


        // Receipt input
        document.getElementById("receiptInput")
            ?.addEventListener("change", event => {

                this.addReceiptFiles(event.target.files);

            });


        // Transaction filters
        const search =
            document.getElementById("txSearch");

        const status =
            document.getElementById("statusFilter");

        const type =
            document.getElementById("typeFilter");


        [search, status, type]

            .filter(Boolean)

            .forEach(element => {

                element.addEventListener("input", () => {

                    this.filterTransactions();

                });

                element.addEventListener("change", () => {

                    this.filterTransactions();

                });

            });


        // Receipt search
        document.getElementById("receiptSearch")
            ?.addEventListener("input", event => {

                const query =
                    event.target.value.toLowerCase();


                document.querySelectorAll(".receipt-card")
                    .forEach(card => {

                        card.style.display =
                            card.textContent.toLowerCase().includes(query)
                                ? ""
                                : "none";

                    });

            });
    }


    // =====================================================
    // GLOBAL EVENT LISTENERS
    // =====================================================

    bindEvents() {


        // Login
        document.getElementById("authForm")
            .addEventListener("submit", event => {

                this.handleAuth(event);

            });


        // Switch login/register
        document.getElementById("authSwitch")
            .addEventListener("click", () => {

                this.setAuthMode(
                    this.state.authMode === "login"
                        ? "register"
                        : "login"
                );

            });


        // Logout
        document.getElementById("logoutButton")
            .addEventListener("click", () => {

                this.logout();

            });


        // Sidebar groups (remember what was opened)
        let savedGroups = null;

        try {
            savedGroups = JSON.parse(
                localStorage.getItem("ledger-nav-groups") || "null"
            );
        } catch (error) {
            savedGroups = null;
        }

        document.querySelectorAll(".nav-group").forEach(group => {

            if (savedGroups && group.dataset.group in savedGroups) {
                this.setNavGroup(group, !!savedGroups[group.dataset.group], false);
            }
        });

        document.querySelectorAll("[data-group-toggle]")
            .forEach(button => {

                button.addEventListener("click", () => {

                    const group = button.closest(".nav-group");

                    this.setNavGroup(group, !group.classList.contains("open"));
                });
            });

        // Main navigation
        document.querySelectorAll(".nav-item[data-page]")
            .forEach(button => {

                button.addEventListener("click", async () => {

                    const page = button.dataset.page;

                    this.render(page);

                    document.getElementById("sidebar")
                        .classList.remove("open");

                    if (page === "receipts") {

                        try {

                            await this.api.loadReceipts();

                            if (this.state.currentPage === "receipts") {
                                this.render("receipts");
                            }

                        } catch (error) {

                            LedgerUtils.toast(
                                error.message,
                                "error"
                            );
                        }
                    }

                });

            });


        // Transaction form
        document.getElementById("transactionForm")
            .addEventListener("submit", event => {

                this.addTransaction(event);

            });


        // Payment status: partially paid asks how much was paid
        document.getElementById("txPayStatus")
            ?.addEventListener("change", () => {
                this.updatePaymentFields();
            });

        document.getElementById("txBack")
            ?.addEventListener("click", () => {
                this.showTransactionStep("form");
            });


        // Clear-all dialog
        document.getElementById("clearNext")
            .addEventListener("click", () => this.showClearStep(2));

        document.getElementById("clearBackup")
            .addEventListener("click", () => this.exportCSV());

        ["clearClose", "clearCancel1", "clearCancel2"].forEach(id => {
            document.getElementById(id)
                .addEventListener("click", () => this.closeClearDialog());
        });

        ["clearPhrase", "clearPassword", "clearAck"].forEach(id => {
            document.getElementById(id)
                .addEventListener("input", () => this.updateClearButton());
            document.getElementById(id)
                .addEventListener("change", () => this.updateClearButton());
        });

        document.getElementById("clearForm")
            .addEventListener("submit", event => this.clearTransactions(event));

        // Close modal
        document.getElementById("closeModal")
            .addEventListener("click", () => {

                this.closeModal();

            });


        document.getElementById("cancelModal")
            .addEventListener("click", () => {

                this.closeModal();

            });


        // Close modal when backdrop is clicked
        document.getElementById("modalBackdrop")
            .addEventListener("click", event => {

                if (event.target.id === "modalBackdrop") {

                    this.closeModal();

                }

            });


        // Mobile menu
        document.getElementById("mobileMenu")
            .addEventListener("click", () => {

                document.getElementById("sidebar")
                    .classList.toggle("open");

            });


        // Help
        document.getElementById("helpButton")
            .addEventListener("click", () => {

                LedgerUtils.toast(
                    "Add a transaction, check the review, and confirm. Your cash, journal and ledger update automatically."
                );

            });
    }
}


// =========================================================
// 9. START APPLICATION
// =========================================================

const ledgerApp = new LedgerApp();

ledgerApp.bindEvents();

ledgerApp.initialize();