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
                this.journalEdits = {};

        // Chart of accounts
        this.accounts = [];
        this.editingAccountId = null;
        this.showInactiveAccounts = false;

        this.currentPage = "dashboard";

        this.currentUser = null;
        this.authMode = "login";

        // Dashboard preferences
        this.dashboardPeriod = "monthly";
        this.dashboardChartType = "bar";

        // Trial Balance preferences
        this.trialBalanceDate = LedgerUtils.today();
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

    getJournalLines(transaction) {

        const saved =
            this.journalEdits[String(transaction.id)];

        return saved && saved.length
            ? saved
            : LedgerAccounting.journalFor(transaction);
    }

    getPostedTransactions() {

        return this.transactions.filter(
            transaction => transaction.status !== "review"
        );
    }

    clear() {

        this.transactions = [];
        this.receipts = [];
                this.journalEdits = {};

        this.accounts = [];
        this.editingAccountId = null;
        this.showInactiveAccounts = false;
        LedgerUtils.chart = [];

        this.currentUser = null;
        this.currentPage = "dashboard";


        this.dashboardPeriod = "monthly";
        this.dashboardChartType = "bar";

        this.trialBalanceDate = LedgerUtils.today();
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
                "Cannot connect to Ledger's backend. Make sure your server is running."
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

    async createAccount(account) {

        return this.request("/accounts", {
            method: "POST",
            body: JSON.stringify(account)
        });
    }

    async updateAccount(id, changes) {

        return this.request(
            `/accounts/${encodeURIComponent(id)}`,
            {
                method: "PUT",
                body: JSON.stringify(changes)
            }
        );
    }

    async deleteAccount(id) {

        return this.request(
            `/accounts/${encodeURIComponent(id)}`,
            {
                method: "DELETE"
            }
        );
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

    static accountFor(transaction) {

        if (transaction.type === "income") {

            return {
                debit: "Cash",
                debitType: "asset",

                credit:
                    transaction.category === "Sales Revenue"
                        ? "Sales Revenue"
                        : "Service Revenue",

                creditType: "revenue"
            };
        }

        const expenseAccounts = {

            "Office Supplies": "Office Supplies Expense",

            "Utilities": "Utilities Expense",

            "Transportation": "Transportation Expense",

            "Rent Expense": "Rent Expense"

        };

        return {
            debit:
                expenseAccounts[transaction.category] ||
                "General Expense",

            debitType: "expense",

            credit: "Cash",

            creditType: "asset"
        };
    }


    // -----------------------------------------------------
    // AUTOMATIC JOURNAL
    // -----------------------------------------------------

    static journalFor(transaction) {

        const accounts = this.accountFor(transaction);

        return [

            {
                account: accounts.debit,
                accountType: accounts.debitType,
                description: transaction.description,
                debit: Number(transaction.amount) || 0,
                credit: 0
            },

            {
                account: accounts.credit,
                accountType: accounts.creditType,
                description: transaction.description,
                debit: 0,
                credit: Number(transaction.amount) || 0
            }

        ];
    }


    // -----------------------------------------------------
    // FINANCIAL TOTALS
    // -----------------------------------------------------

    static totals(state) {

        let income = 0;
        let expenses = 0;

        state.getPostedTransactions().forEach(transaction => {

            state.getJournalLines(transaction).forEach(line => {

                const type =
                    line.accountType ||
                    LedgerUtils.accountTypeFor(line.account);

                const debit = Number(line.debit) || 0;
                const credit = Number(line.credit) || 0;

                if (type === "revenue") {
                    income += credit - debit;
                }

                if (type === "expense") {
                    expenses += debit - credit;
                }

            });

        });

        return {

            income,

            expenses,

            profit: income - expenses,

            needsReview: state.transactions.filter(
                transaction => transaction.status === "review"
            ).length,

            postedTransactions:
                state.getPostedTransactions().length
        };
    }


    // -----------------------------------------------------
    // PERIOD CHART DATA
    // -----------------------------------------------------

    static periodChart(state, period = "monthly") {

        const validPeriods = [
            "monthly",
            "quarterly",
            "yearly"
        ];

        if (!validPeriods.includes(period)) {
            period = "monthly";
        }

        const now = new Date();

        const count = {
            monthly: 12,
            quarterly: 8,
            yearly: 5
        }[period];

        const periods = [];

        // Generate reporting periods
        for (let i = count - 1; i >= 0; i--) {

            let start;

            if (period === "monthly") {

                start = new Date(
                    now.getFullYear(),
                    now.getMonth() - i,
                    1
                );

            } else if (period === "quarterly") {

                const currentQuarterMonth =
                    Math.floor(now.getMonth() / 3) * 3;

                start = new Date(
                    now.getFullYear(),
                    currentQuarterMonth - (i * 3),
                    1
                );

            } else {

                start = new Date(
                    now.getFullYear() - i,
                    0,
                    1
                );
            }

            const year = start.getFullYear();

            let key;
            let label;

            if (period === "monthly") {

                const month = String(
                    start.getMonth() + 1
                ).padStart(2, "0");

                key = `${year}-${month}`;

                label = start.toLocaleString("en-PH", {
                    month: "short"
                }) + ` ${year}`;

            } else if (period === "quarterly") {

                const quarter =
                    Math.floor(start.getMonth() / 3) + 1;

                key = `${year}-Q${quarter}`;

                label = `Q${quarter} ${year}`;

            } else {

                key = String(year);

                label = String(year);
            }

            periods.push({

                key,
                label,

                income: 0,
                expenses: 0,
                profit: 0

            });
        }

        const periodMap = new Map(
            periods.map(item => [item.key, item])
        );

        // Process posted transactions only
        state.getPostedTransactions().forEach(transaction => {

            if (!transaction.date) return;

            const date = new Date(
                `${transaction.date.slice(0, 10)}T00:00:00`
            );

            if (Number.isNaN(date.getTime())) return;

            let key;

            if (period === "monthly") {

                key =
                    `${date.getFullYear()}-${String(
                        date.getMonth() + 1
                    ).padStart(2, "0")}`;

            } else if (period === "quarterly") {

                const quarter =
                    Math.floor(date.getMonth() / 3) + 1;

                key = `${date.getFullYear()}-Q${quarter}`;

            } else {

                key = String(date.getFullYear());
            }

            const bucket = periodMap.get(key);

            if (!bucket) return;

            state.getJournalLines(transaction).forEach(line => {

                const type =
                    line.accountType ||
                    LedgerUtils.accountTypeFor(line.account);

                const debit = Number(line.debit) || 0;
                const credit = Number(line.credit) || 0;

                if (type === "revenue") {
                    bucket.income += credit - debit;
                }

                if (type === "expense") {
                    bucket.expenses += debit - credit;
                }

            });

        });

        periods.forEach(item => {
            item.profit = item.income - item.expenses;
        });

        return periods;
    }


    // -----------------------------------------------------
    // CATEGORY BREAKDOWN
    // -----------------------------------------------------

    static categoryBreakdown(state) {

        const map = {};

        state.getPostedTransactions().forEach(transaction => {

            state.getJournalLines(transaction).forEach(line => {

                const type =
                    line.accountType ||
                    LedgerUtils.accountTypeFor(line.account);

                const debit = Number(line.debit) || 0;
                const credit = Number(line.credit) || 0;

                let amount = 0;

                if (type === "revenue") {
                    amount = credit - debit;
                }

                if (type === "expense") {
                    amount = debit - credit;
                }

                if (amount !== 0) {

                    map[line.account] =
                        (map[line.account] || 0) + amount;

                }

            });

        });

        return Object.entries(map).sort(
            (a, b) => Math.abs(b[1]) - Math.abs(a[1])
        );
    }


    // =====================================================
    // TRIAL BALANCE
    // =====================================================

    static trialBalance(state, asOfDate = LedgerUtils.today()) {

        const accounts = new Map();

        // Only include posted transactions on or before
        // the selected reporting date.
        state.getPostedTransactions().forEach(transaction => {

            if (
                !transaction.date ||
                transaction.date > asOfDate
            ) {
                return;
            }

            // Use saved journal entries when available.
            // Otherwise use the automatically suggested entries.
            state.getJournalLines(transaction).forEach(line => {

                const name = String(
                    line.account || ""
                ).trim();

                if (!name) return;

                const accountType =
                    line.accountType ||
                    LedgerUtils.accountTypeFor(name);

                const debit = Number(line.debit) || 0;
                const credit = Number(line.credit) || 0;

                // Use normalized account names as map keys.
                const key = name.toLowerCase();

                // Create an account record if it does not exist.
                if (!accounts.has(key)) {

                    accounts.set(key, {

                        account: name,

                        accountType,

                        totalDebit: 0,

                        totalCredit: 0

                    });
                }

                const account = accounts.get(key);

                // Accumulate all journal postings.
                account.totalDebit += debit;
                account.totalCredit += credit;

            });

        });


        // Calculate the ending balance of each account.
        const rows = [];

        accounts.forEach(account => {

            const balance =
                account.totalDebit - account.totalCredit;

            // Skip accounts with zero balances.
            if (Math.abs(balance) < 0.005) {
                return;
            }

            rows.push({

                account: account.account,

                accountType: account.accountType,

                debit: balance > 0 ? balance : 0,

                credit: balance < 0
                    ? Math.abs(balance)
                    : 0

            });

        });


        // Sort by accounting classification.
        const typeOrder = [
            "asset",
            "liability",
            "equity",
            "revenue",
            "expense"
        ];

        rows.sort((a, b) => {

            const aOrder = typeOrder.indexOf(a.accountType);
            const bOrder = typeOrder.indexOf(b.accountType);

            if (aOrder !== bOrder) {
                return aOrder - bOrder;
            }

            return a.account.localeCompare(b.account);
        });


        // Calculate total debit and total credit.
        const totalDebit = rows.reduce(
            (sum, account) => sum + account.debit,
            0
        );

        const totalCredit = rows.reduce(
            (sum, account) => sum + account.credit,
            0
        );


        // Find the difference.
        const difference = Math.abs(
            totalDebit - totalCredit
        );


        // Check whether both totals balance.
        const isBalanced = difference < 0.005;


        return {

            asOfDate,

            rows,

            totalDebit,

            totalCredit,

            difference,

            isBalanced,

            accountCount: rows.length,

            hasRows: rows.length > 0

        };
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

            if (!["income", "expense"].includes(type)) {
                errors.push(
                    "Type must be income or expense."
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

        const rows = [

            [
                "date",
                "description",
                "category",
                "type",
                "amount"
            ],

            [
                "2026-11-01",
                "Office supplies",
                "Office Supplies",
                "expense",
                "1500.00"
            ],

            [
                "2026-11-02",
                "Product sales",
                "Sales Revenue",
                "income",
                "5000.00"
            ]

        ];

        return rows.map(row =>

            row.map(value =>
                LedgerUtils.csvEscape(value)
            ).join(",")

        ).join("\r\n");
    }
}


// =========================================================
// 6. DASHBOARD CHART COMPONENT
// =========================================================

class LedgerDashboardChart {

    constructor(state) {

        this.state = state;

        this.instance = null;
    }


    // -----------------------------------------------------
    // DESTROY EXISTING CHART
    // -----------------------------------------------------

    destroy() {

        if (this.instance) {

            this.instance.destroy();

            this.instance = null;
        }
    }


    // -----------------------------------------------------
    // PREPARE CHART DATA
    // -----------------------------------------------------

    getChartData(period, chartType) {

        const financialData =
            LedgerAccounting.periodChart(
                this.state,
                period
            );

        const labels = financialData.map(
            item => item.label
        );

        const income = financialData.map(
            item => item.income
        );

        const expenses = financialData.map(
            item => item.expenses
        );

        const profit = financialData.map(
            item => item.profit
        );

        const totalIncome = income.reduce(
            (sum, value) => sum + value,
            0
        );

        const totalExpenses = expenses.reduce(
            (sum, value) => sum + value,
            0
        );

        const totalProfit =
            totalIncome - totalExpenses;

        const isDoughnut =
            chartType === "doughnut";

        const isArea =
            chartType === "area";

        let data;


        // Doughnut chart
        if (isDoughnut) {

            data = {

                labels: [
                    "Income",
                    "Expenses"
                ],

                datasets: [{

                    label: "Financial Breakdown",

                    data: [
                        Math.max(0, totalIncome),
                        Math.max(0, totalExpenses)
                    ],

                    backgroundColor: [
                        "#16a34a",
                        "#f97316"
                    ],

                    borderWidth: 0,

                    hoverOffset: 8

                }]

            };

        } else {

            data = {

                labels,

                datasets: [

                    {
                        label: "Income",

                        data: income,

                        borderColor: "#16a34a",

                        backgroundColor: isArea
                            ? "rgba(22, 163, 74, 0.15)"
                            : "#16a34a",

                        borderWidth: 2,

                        borderRadius:
                            chartType === "bar" ? 5 : 0,

                        fill: isArea,

                        tension: 0.35,

                        pointRadius: 3,

                        pointHoverRadius: 5
                    },

                    {
                        label: "Expenses",

                        data: expenses,

                        borderColor: "#f97316",

                        backgroundColor: isArea
                            ? "rgba(249, 115, 22, 0.15)"
                            : "#f97316",

                        borderWidth: 2,

                        borderRadius:
                            chartType === "bar" ? 5 : 0,

                        fill: isArea,

                        tension: 0.35,

                        pointRadius: 3,

                        pointHoverRadius: 5
                    },

                    {
                        label: "Net Profit",

                        data: profit,

                        borderColor: "#2563eb",

                        backgroundColor: isArea
                            ? "rgba(37, 99, 235, 0.10)"
                            : "#2563eb",

                        borderWidth: 2,

                        borderRadius:
                            chartType === "bar" ? 5 : 0,

                        fill: isArea,

                        tension: 0.35,

                        pointRadius: 3,

                        pointHoverRadius: 5
                    }

                ]

            };
        }

        return {

            data,

            financialData,

            totalIncome,

            totalExpenses,

            totalProfit,

            isDoughnut,

            isArea
        };
    }


    // -----------------------------------------------------
    // CHART OPTIONS
    // -----------------------------------------------------

    getOptions(chartType) {

        const isDoughnut =
            chartType === "doughnut";

        const isHorizontal =
            chartType === "horizontalBar";

        const options = {

            responsive: true,

            maintainAspectRatio: false,

            plugins: {

                legend: {

                    display: true,

                    position: "bottom",

                    labels: {

                        usePointStyle: true,

                        boxWidth: 8,

                        padding: 18

                    }
                },

                tooltip: {

                    callbacks: {

                        label: context => {

                            let value;

                            if (isDoughnut) {

                                value = context.parsed;

                            } else if (isHorizontal) {

                                value = context.parsed.x;

                            } else {

                                value = context.parsed.y;
                            }

                            return `${context.dataset.label}: ${LedgerUtils.peso(value)}`;
                        }

                    }
                }

            }
        };


        if (isDoughnut) {

            options.cutout = "65%";

            return options;
        }


        options.interaction = {

            mode: "index",

            intersect: false

        };

        options.indexAxis =
            isHorizontal ? "y" : "x";


        options.scales = {

            x: {

                beginAtZero: isHorizontal,

                grid: {
                    display: isHorizontal
                },

                ticks: isHorizontal

                    ? {
                        callback: value => {

                            const formatted =
                                new Intl.NumberFormat("en-PH", {
                                    notation: "compact",
                                    maximumFractionDigits: 1
                                }).format(value);

                            return `₱${formatted}`;
                        }
                    }

                    : {
                        autoSkip: true,
                        maxRotation: 45,
                        minRotation: 0
                    }

            },

            y: {

                beginAtZero: !isHorizontal,

                grid: {
                    display: !isHorizontal
                },

                ticks: isHorizontal

                    ? {}

                    : {
                        callback: value => {

                            const formatted =
                                new Intl.NumberFormat("en-PH", {
                                    notation: "compact",
                                    maximumFractionDigits: 1
                                }).format(value);

                            return `₱${formatted}`;
                        }
                    }

            }

        };

        return options;
    }


    // -----------------------------------------------------
    // UPDATE FINANCIAL SUMMARY
    // -----------------------------------------------------

    updateSummary(summaryElement, totals) {

        if (!summaryElement) return;

        const profitClass =
            totals.totalProfit >= 0
                ? "positive"
                : "negative";

        summaryElement.innerHTML = `

            <div class="chart-summary-item">

                <span>Total Income</span>

                <strong class="positive">
                    ${LedgerUtils.peso(totals.totalIncome)}
                </strong>

            </div>


            <div class="chart-summary-item">

                <span>Total Expenses</span>

                <strong>
                    ${LedgerUtils.peso(totals.totalExpenses)}
                </strong>

            </div>


            <div class="chart-summary-item">

                <span>Net Profit</span>

                <strong class="${profitClass}">
                    ${LedgerUtils.peso(totals.totalProfit)}
                </strong>

            </div>

        `;
    }


    // -----------------------------------------------------
    // RENDER CHART
    // -----------------------------------------------------

    render() {

        this.destroy();

        const canvas = document.getElementById(
            "dashboardFinanceChart"
        );

        if (!canvas) return;

        const fallback = document.getElementById(
            "dashboardChartFallback"
        );

        const summary = document.getElementById(
            "dashboardChartSummary"
        );

        const caption = document.getElementById(
            "dashboardChartCaption"
        );


        if (typeof Chart === "undefined") {

            if (fallback) {

                fallback.hidden = false;

                fallback.textContent =
                    "Chart.js could not load. Check your internet connection and the Chart.js script in index.html.";
            }

            return;
        }

        if (fallback) {
            fallback.hidden = true;
        }


        const period =
            document.getElementById("dashboardPeriod")?.value ||
            this.state.dashboardPeriod ||
            "monthly";

        const chartType =
            document.getElementById("dashboardChartType")?.value ||
            this.state.dashboardChartType ||
            "bar";


        this.state.dashboardPeriod = period;

        this.state.dashboardChartType = chartType;


        const result = this.getChartData(
            period,
            chartType
        );


        const actualChartType = result.isDoughnut

            ? "doughnut"

            : (
                chartType === "bar" ||
                chartType === "horizontalBar"
            )

                ? "bar"

                : "line";


        this.instance = new Chart(
            canvas.getContext("2d"),
            {
                type: actualChartType,

                data: result.data,

                options: this.getOptions(chartType)
            }
        );


        const periodNames = {

            monthly: "Monthly · Last 12 months",

            quarterly: "Quarterly · Last 8 quarters",

            yearly: "Yearly · Last 5 years"

        };


        const chartNames = {

            bar: "Bar Chart",

            horizontalBar: "Horizontal Bar Chart",

            line: "Line Chart",

            area: "Line with Area",

            doughnut: "Doughnut Chart"

        };


        if (caption) {

            caption.textContent =
                `${periodNames[period]} · ${chartNames[chartType]} · Posted transactions only`;
        }


        this.updateSummary(summary, result);
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
                    <td colspan="6">
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
                    ${LedgerUtils.escape(transaction.category)}
                </td>

                <td class="amount ${
                    transaction.type === "income"
                        ? "positive"
                        : "negative"
                }">

                    ${transaction.type === "income" ? "+" : "−"}

                    ${LedgerUtils.peso(transaction.amount)}

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
                </td>

            </tr>

        `).join("");
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
                                <th>CATEGORY</th>
                                <th>AMOUNT</th>
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

        const totals =
            LedgerAccounting.totals(this.state);

        const recent = [...this.state.transactions]

            .sort((a, b) =>
                b.date.localeCompare(a.date)
            )

            .slice(0, 5);

        const userName = LedgerUtils.escape(
            this.state.currentUser?.full_name || "User"
        );

        return `

            ${this.heading(
                `Good day, ${userName}`,

                "Here's what's happening with your business finances.",

                `
                    <button
                        class="btn primary"
                        id="addTransaction"
                    >
                        ＋ Add Transaction
                    </button>
                `
            )}


            <!-- FINANCIAL METRICS -->

            <div class="grid metric-grid">

                ${this.metric(
                    "TOTAL INCOME",
                    LedgerUtils.peso(totals.income),
                    "From posted transactions",
                    "↗"
                )}

                ${this.metric(
                    "TOTAL EXPENSES",
                    LedgerUtils.peso(totals.expenses),
                    "From posted transactions",
                    "↘"
                )}

                ${this.metric(
                    "NET PROFIT",
                    LedgerUtils.peso(totals.profit),
                    "Income less expenses",
                    "₱"
                )}

                ${this.metric(
                    "NEEDS REVIEW",
                    totals.needsReview,
                    "Transactions flagged for checking",
                    "◷"
                )}

            </div>


            <!-- CHART AND ATTENTION SECTION -->

            <div class="grid two-col">


                <!-- FINANCIAL PERFORMANCE -->

                <div class="card dashboard-chart-card">

                    <div class="card-head">

                        <div>

                            <h3>Financial Performance</h3>

                            <span class="tiny muted">
                                Income, expenses and net profit
                            </span>

                        </div>

                    </div>


                    <!-- CHART FILTERS -->

                    <div class="chart-toolbar">

                        <label>

                            REPORT PERIOD

                            <select id="dashboardPeriod">

                                <option
                                    value="monthly"
                                    ${
                                        this.state.dashboardPeriod === "monthly"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    Monthly
                                </option>

                                <option
                                    value="quarterly"
                                    ${
                                        this.state.dashboardPeriod === "quarterly"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    Quarterly
                                </option>

                                <option
                                    value="yearly"
                                    ${
                                        this.state.dashboardPeriod === "yearly"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    Yearly
                                </option>

                            </select>

                        </label>


                        <label>

                            CHART TYPE

                            <select id="dashboardChartType">

                                <option
                                    value="bar"
                                    ${
                                        this.state.dashboardChartType === "bar"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    Bar Chart
                                </option>

                                <option
                                    value="horizontalBar"
                                    ${
                                        this.state.dashboardChartType === "horizontalBar"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    Horizontal Bar
                                </option>

                                <option
                                    value="line"
                                    ${
                                        this.state.dashboardChartType === "line"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    Line Chart
                                </option>

                                <option
                                    value="area"
                                    ${
                                        this.state.dashboardChartType === "area"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    Line with Area
                                </option>

                                <option
                                    value="doughnut"
                                    ${
                                        this.state.dashboardChartType === "doughnut"
                                            ? "selected"
                                            : ""
                                    }
                                >
                                    Doughnut Chart
                                </option>

                            </select>

                        </label>

                    </div>


                    <!-- CHART CANVAS -->

                    <div class="chart-container">

                        <canvas id="dashboardFinanceChart"></canvas>

                    </div>


                    <!-- CHART DESCRIPTION -->

                    <p
                        class="tiny muted chart-caption"
                        id="dashboardChartCaption"
                    >
                        Financial performance
                    </p>


                    <!-- FINANCIAL SUMMARY -->

                    <div
                        class="chart-summary"
                        id="dashboardChartSummary"
                    ></div>


                    <!-- CHART ERROR -->

                    <p
                        class="chart-fallback"
                        id="dashboardChartFallback"
                        hidden
                    ></p>

                </div>



                <!-- NEEDS ATTENTION -->

                <div class="card">

                    <div class="card-head">

                        <h3>Needs your attention</h3>

                        <button
                            class="btn ghost small"
                            data-goto="errors"
                        >
                            View all
                        </button>

                    </div>

                    ${
                        this.state.transactions

                            .filter(item =>
                                item.status === "review"
                            )

                            .slice(0, 3)

                            .map(item => `

                                <div class="attention-item">

                                    <span class="warning-icon">
                                        !
                                    </span>

                                    <div>

                                        <strong>
                                            ${LedgerUtils.escape(item.description)}
                                        </strong>

                                        <p>
                                            Check transaction details and supporting information
                                            · ${LedgerUtils.peso(item.amount)}
                                        </p>

                                    </div>

                                </div>

                            `).join("")

                        ||

                        `
                            <p class="muted tiny">
                                All transactions are POSTED.
                                No items need review.
                            </p>
                        `
                    }

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

                    <option value="income">
                        Income
                    </option>

                    <option value="expense">
                        Expense
                    </option>

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

        const items = [...this.state.transactions]

            .sort((a, b) =>
                b.date.localeCompare(a.date)
            );

        return `

            ${this.heading(
                "Journal Entries",

                "Review and edit the debit and credit records for your transactions."
            )}


            <div
                class="info-box"
                style="margin-bottom:16px"
            >

                Ledger automatically prepares a suggested
                double-entry journal for each transaction.

                Edit the transaction details, account names,
                account types, line descriptions, debit, and credit.

                Save your changes to update the journal records.

                Debit and credit totals must balance before saving.

            </div>


            ${
                items.length

                    ? items.map(transaction =>
                        this.journalCard(transaction)
                    ).join("")

                    :

                    `
                        <div class="card journal-empty">

                            No journal entries yet.

                            Add a transaction to generate one automatically.

                        </div>
                    `
            }

        `;
    }


    // -----------------------------------------------------
    // JOURNAL CARD
    // -----------------------------------------------------

    journalCard(transaction) {

        const lines =
            this.state.getJournalLines(transaction);

        const debit = lines.reduce(
            (sum, line) =>
                sum + Number(line.debit || 0),
            0
        );

        const credit = lines.reduce(
            (sum, line) =>
                sum + Number(line.credit || 0),
            0
        );

        const balanced =
            Math.abs(debit - credit) < 0.005;

        const id =
            LedgerUtils.escape(transaction.id);

        return `

            <div class="card journal-card">


                <div class="card-head">

                    <div style="width:100%">

                        <p class="eyebrow">
                            TRANSACTION #${id}
                        </p>


                        <div class="journal-transaction-details">

                            <label>

                                DATE

                                <input
                                    type="date"
                                    class="journal-transaction-field"
                                    data-id="${id}"
                                    data-field="date"
                                    value="${LedgerUtils.escape(transaction.date)}"
                                    required
                                >

                            </label>


                            <label>

                                DESCRIPTION

                                <input
                                    type="text"
                                    class="journal-transaction-field"
                                    data-id="${id}"
                                    data-field="description"
                                    value="${LedgerUtils.escape(transaction.description)}"
                                    placeholder="Transaction description"
                                    maxlength="100"
                                    required
                                >

                            </label>


                            <label>

                                CATEGORY

                                <input
                                    type="text"
                                    class="journal-transaction-field"
                                    data-id="${id}"
                                    data-field="category"
                                    value="${LedgerUtils.escape(transaction.category)}"
                                    placeholder="Transaction category"
                                    required
                                >

                            </label>

                        </div>


                        <p class="journal-current-amount">

                            Original transaction amount:

                            <strong>
                                ${LedgerUtils.peso(transaction.amount)}
                            </strong>

                        </p>

                    </div>


                    ${LedgerUtils.badge(transaction.status)}

                </div>



                <div class="journal-lines">


                    <div class="journal-row header">

                        <span>ACCOUNT / TYPE</span>

                        <span>DESCRIPTION</span>

                        <span>DEBIT</span>

                        <span>CREDIT</span>

                    </div>


                    ${lines.map((line, index) => `

                        <div class="journal-row">


                            <span>

                                ${this.journalAccountControl(id, index, line.account)}


                                <select
                                    class="journal-account-type"
                                    data-id="${id}"
                                    data-line="${index}"
                                    aria-label="Account type"
                                    ${LedgerUtils.chart.length ? "disabled" : ""}
                                >

                                    ${LedgerUtils.accountTypeOptions(
                                        line.accountType ||
                                        LedgerUtils.accountTypeFor(line.account)
                                    )}

                                </select>

                            </span>



                            <span>

                                <input
                                    class="journal-line-description"
                                    data-id="${id}"
                                    data-line="${index}"
                                    value="${LedgerUtils.escape(line.description || "")}"
                                    placeholder="Line description"
                                    aria-label="Journal line description"
                                >

                            </span>



                            <span>

                                <input
                                    class="journal-number"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    data-id="${id}"
                                    data-line="${index}"
                                    data-field="debit"
                                    value="${Number(line.debit) || 0}"
                                    aria-label="Debit amount"
                                >

                            </span>



                            <span>

                                <input
                                    class="journal-number"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    data-id="${id}"
                                    data-line="${index}"
                                    data-field="credit"
                                    value="${Number(line.credit) || 0}"
                                    aria-label="Credit amount"
                                >

                            </span>


                        </div>

                    `).join("")}

                </div>



                <div class="totals">

                    <span>
                        DEBIT:
                        <strong>
                            ${LedgerUtils.peso(debit)}
                        </strong>
                    </span>

                    <span>
                        CREDIT:
                        <strong>
                            ${LedgerUtils.peso(credit)}
                        </strong>
                    </span>

                    <span>
                        DIFFERENCE:
                        <strong>
                            ${LedgerUtils.peso(
                                Math.abs(debit - credit)
                            )}
                        </strong>
                    </span>

                </div>



                <div class="journal-actions">

                    <span class="journal-balance ${
                        balanced ? "positive" : "negative"
                    }">

                        ${
                            balanced
                                ? "DEBITS AND CREDITS ARE BALANCED"
                                : "DEBITS AND CREDITS DO NOT MATCH"
                        }

                    </span>


                    <button
                        class="btn primary small"
                        data-save-journal="${id}"
                    >
                        SAVE EDITS
                    </button>

                </div>

            </div>

        `;
    }


    // =====================================================
    // GENERAL LEDGER
    // =====================================================

    ledger() {

        const accounts = {};

        this.state.getPostedTransactions().forEach(transaction => {

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

                        const normalDebit = [
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
    // TRIAL BALANCE
    // =====================================================

    trialBalance() {

        const asOfDate =
            this.state.trialBalanceDate ||
            LedgerUtils.today();

        const report =
            LedgerAccounting.trialBalance(
                this.state,
                asOfDate
            );

        const statusText = !report.hasRows

            ? "NO DATA"

            : report.isBalanced

                ? "DEBITS AND CREDITS BALANCE"

                : "TRIAL BALANCE OUT OF BALANCE";

        const statusClass = !report.hasRows

            ? ""

            : report.isBalanced

                ? "positive"

                : "negative";


        return `

            ${this.heading(

                "Trial Balance",

                "Review the debit and credit balances of all posted accounts as of a selected date.",

                `

                    <button
                        class="btn secondary"
                        id="exportTrialBalance"
                        type="button"
                    >
                        ↓ Export CSV
                    </button>

                `
            )}


            <!-- TRIAL BALANCE INFORMATION -->

            <div class="info-box trial-balance-info">

                <strong>About the Trial Balance</strong>

                The Trial Balance summarizes the ending debit and
                credit balances of your General Ledger accounts.

                Total debit balances should equal total credit balances.

                Transactions marked NEEDS REVIEW are excluded.

            </div>



            <!-- REPORT DATE -->

            <div class="card trial-balance-filter">

                <label for="trialBalanceDate">

                    <span class="trial-balance-filter-label">
                        REPORTING DATE
                    </span>

                    <input
                        type="date"
                        id="trialBalanceDate"
                        value="${LedgerUtils.escape(asOfDate)}"
                        max="${LedgerUtils.today()}"
                    >

                </label>


                <div class="trial-balance-date-note">

                    Showing posted account balances up to
                    <strong>
                        ${LedgerUtils.escape(asOfDate)}
                    </strong>

                </div>

            </div>



            <!-- TRIAL BALANCE SUMMARY -->

            <div class="grid metric-grid trial-balance-metrics">

                ${this.metric(
                    "TOTAL DEBITS",
                    LedgerUtils.peso(report.totalDebit),
                    "Total debit balances",
                    "↗"
                )}

                ${this.metric(
                    "TOTAL CREDITS",
                    LedgerUtils.peso(report.totalCredit),
                    "Total credit balances",
                    "↘"
                )}

                ${this.metric(
                    "DIFFERENCE",
                    LedgerUtils.peso(report.difference),
                    "Debit less credit difference",
                    "＝"
                )}

                ${this.metric(
                    "ACCOUNTS",
                    report.accountCount,
                    "Accounts with non-zero balances",
                    "▤"
                )}

            </div>



            <!-- BALANCE STATUS -->

            <div class="card trial-balance-status-card">

                <div class="trial-balance-status-content">

                    <div>

                        <p class="eyebrow">
                            BALANCE VERIFICATION
                        </p>

                        <h3 class="${statusClass}">

                            ${statusText}

                        </h3>

                        <p class="tiny muted">

                            ${
                                !report.hasRows

                                    ? "No posted account balances were found for the selected date."

                                    : report.isBalanced

                                        ? "Total debit balances equal total credit balances."

                                        : "The debit and credit totals do not match. Review your journal entries."

                            }

                        </p>

                    </div>


                    <div class="trial-balance-status-icon ${
                        !report.hasRows
                            ? ""
                            : report.isBalanced
                                ? "balanced"
                                : "unbalanced"
                    }">

                        ${
                            !report.hasRows
                                ? "—"
                                : report.isBalanced
                                    ? "✓"
                                    : "!"
                        }

                    </div>

                </div>

            </div>



            <!-- TRIAL BALANCE TABLE -->

            <div class="card table-card trial-balance-table-card">

                <div class="card-head">

                    <div>

                        <h3>Trial Balance Statement</h3>

                        <p class="tiny muted">
                            As of ${LedgerUtils.escape(asOfDate)}
                        </p>

                    </div>

                    <span class="tiny muted">
                        ${report.accountCount} account(s)
                    </span>

                </div>


                <div class="table-wrap">

                    <table class="trial-balance-table">

                        <thead>

                            <tr>

                                <th>ACCOUNT NAME</th>

                                <th>ACCOUNT TYPE</th>

                                <th class="trial-number">
                                    DEBIT (₱)
                                </th>

                                <th class="trial-number">
                                    CREDIT (₱)
                                </th>

                            </tr>

                        </thead>


                        <tbody>

                            ${
                                report.rows.length

                                    ? report.rows.map(account => `

                                        <tr>

                                            <td>
                                                <strong>
                                                    ${LedgerUtils.escape(account.account)}
                                                </strong>
                                            </td>

                                            <td>
                                                <span class="trial-account-type">
                                                    ${LedgerUtils.escape(
                                                        account.accountType.toUpperCase()
                                                    )}
                                                </span>
                                            </td>

                                            <td class="trial-number">

                                                ${
                                                    account.debit > 0
                                                        ? LedgerUtils.peso(account.debit)
                                                        : "—"
                                                }

                                            </td>

                                            <td class="trial-number">

                                                ${
                                                    account.credit > 0
                                                        ? LedgerUtils.peso(account.credit)
                                                        : "—"
                                                }

                                            </td>

                                        </tr>

                                    `).join("")

                                    :

                                    `

                                        <tr>

                                            <td
                                                colspan="4"
                                                class="empty-state"
                                            >

                                                No account balances found
                                                for this reporting date.

                                            </td>

                                        </tr>

                                    `
                            }

                        </tbody>


                        <tfoot>

                            <tr>

                                <th colspan="2">
                                    TOTAL
                                </th>

                                <th class="trial-number">
                                    ${LedgerUtils.peso(report.totalDebit)}
                                </th>

                                <th class="trial-number">
                                    ${LedgerUtils.peso(report.totalCredit)}
                                </th>

                            </tr>


                            <tr class="trial-difference-row">

                                <td colspan="2">
                                    DIFFERENCE
                                </td>

                                <td
                                    colspan="2"
                                    class="trial-number ${
                                        report.isBalanced
                                            ? "positive"
                                            : "negative"
                                    }"
                                >
                                    ${LedgerUtils.peso(report.difference)}
                                </td>

                            </tr>

                        </tfoot>

                    </table>

                </div>

            </div>



            <!-- ACCOUNTING EXPLANATION -->

            <div class="info-box trial-balance-note">

                <strong>Accounting note:</strong>

                Debit balances are displayed in the Debit column.
                Credit balances are displayed in the Credit column.

                The Trial Balance is calculated from the journal
                entries available in Ledger and is not a substitute
                for adjusting entries or financial statement preparation.

            </div>

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

                            <div class="receipt-preview">

                                ${
                                    receipt.type.startsWith("image/")

                                        ? `
                                            <img
                                                src="${receipt.data}"
                                                alt=""
                                                style="
                                                    max-width:100%;
                                                    max-height:100%;
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
    // ERROR DETECTION
    // =====================================================

    errors() {

        const issues = [];

        this.state.transactions.forEach(transaction => {

            if (
                !transaction.date ||
                !transaction.description ||
                !transaction.amount ||
                transaction.amount <= 0
            ) {

                issues.push({

                    transaction,

                    title: "Missing or invalid transaction information",

                    detail: "Check the date, description, and amount."

                });
            }

            if (transaction.status === "review") {

                issues.push({

                    transaction,

                    title: "Transaction requires verification",

                    detail:
                        "Review the transaction details and supporting receipt."

                });
            }

        });


        const postedCount =
            this.state.getPostedTransactions().length;

        const reviewCount =
            this.state.transactions.filter(
                item => item.status === "review"
            ).length;


        return `

            ${this.heading(
                "Error Detection",

                "Find missing information and potential issues in your transactions."
            )}


            <div class="grid metric-grid">

                ${this.metric(
                    "Items requiring attention",
                    issues.length,
                    "Based on current records",
                    "!"
                )}

                ${this.metric(
                    "Needs review",
                    reviewCount,
                    "Transactions flagged for checking",
                    "◷"
                )}

                ${this.metric(
                    "Posted transactions",
                    postedCount,
                    "Automatically included in the ledger",
                    "✓"
                )}

                ${this.metric(
                    "Validation rule",
                    "Debit = Credit",
                    "Double-entry check",
                    "＝"
                )}

            </div>



            <div class="card">

                <div class="card-head">

                    <h3>Items to review</h3>

                    <span class="tiny muted">
                        ${issues.length} issue(s)
                    </span>

                </div>


                ${
                    issues.map(({
                        transaction,
                        title,
                        detail
                    }) => `

                        <div class="issue">

                            <div>

                                <h4>
                                    ${LedgerUtils.escape(title)}
                                </h4>

                                <p>

                                    ${LedgerUtils.escape(
                                        transaction.description
                                    )}

                                    ·

                                    ${LedgerUtils.escape(detail)}

                                </p>

                            </div>


                            <div>

                                ${LedgerUtils.badge(transaction.status)}

                                <button
                                    class="btn secondary small"
                                    data-review="${LedgerUtils.escape(transaction.id)}"
                                >
                                    Review
                                </button>

                            </div>

                        </div>

                    `).join("")

                    ||

                    `
                        <div class="empty-state">

                            No validation issues detected
                            in the current transactions.

                        </div>
                    `
                }

            </div>

        `;
    }


    // =====================================================
    // REPORTS
    // =====================================================

    reports() {

        const totals =
            LedgerAccounting.totals(this.state);

        const expensesPct = totals.income

            ? Math.min(
                100,
                Math.max(
                    0,
                    totals.expenses / totals.income * 100
                )
            )

            : 0;

        const categories =
            LedgerAccounting.categoryBreakdown(this.state);


        return `

            ${this.heading(
                "Reports",

                "Monitor income, expenses, and net profit from saved journal entries.",

                `
                    <button
                        class="btn secondary"
                        id="exportReport"
                    >
                        ↓ Export CSV
                    </button>
                `
            )}


            <div class="grid metric-grid">

                ${this.metric(
                    "Total income",
                    LedgerUtils.peso(totals.income),
                    "Posted income",
                    "↗"
                )}

                ${this.metric(
                    "Total expenses",
                    LedgerUtils.peso(totals.expenses),
                    "Posted expenses",
                    "↘"
                )}

                ${this.metric(
                    "Net profit",
                    LedgerUtils.peso(totals.profit),
                    "Income less expenses",
                    "₱"
                )}

                ${this.metric(
                    "Posted transactions",
                    totals.postedTransactions,
                    "Automatically recorded in the ledger",
                    "▤"
                )}

            </div>



            <div class="grid two-col">


                <div class="card">

                    <div class="card-head">

                        <h3>Financial breakdown</h3>

                        <span class="tiny muted">
                            Posted transactions
                        </span>

                    </div>


                    <div class="breakdown-row">

                        <span>Income</span>

                        <strong class="positive">
                            ${LedgerUtils.peso(totals.income)}
                        </strong>

                    </div>


                    <div class="breakdown-row">

                        <span>Expenses</span>

                        <strong>
                            ${LedgerUtils.peso(totals.expenses)}
                        </strong>

                    </div>


                    <div class="breakdown-row">

                        <span>Net profit</span>

                        <strong>
                            ${LedgerUtils.peso(totals.profit)}
                        </strong>

                    </div>


                    <div class="muted-small">
                        Expense-to-income ratio
                    </div>


                    <div class="progress">

                        <span style="width:${expensesPct}%"></span>

                    </div>


                    <p class="tiny muted">
                        ${expensesPct.toFixed(1)}% of posted income
                    </p>

                </div>



                <div class="card">

                    <div class="card-head">
                        <h3>By transaction category</h3>
                    </div>


                    ${
                        categories.map(([account, amount]) => `

                            <div class="breakdown-row">

                                <span>
                                    ${LedgerUtils.escape(account)}
                                </span>

                                <strong>
                                    ${LedgerUtils.peso(amount)}
                                </strong>

                            </div>

                        `).join("")

                        ||

                        `
                            <p class="muted tiny">
                                No revenue or expense entries.
                            </p>
                        `
                    }

                </div>

            </div>


            <p
                class="muted-small"
                style="margin-top:15px"
            >

                These are basic management summaries,
                not a complete set of formal financial statements.

                Values are calculated from posted transactions.

            </p>

        `;
    }


    // =====================================================
    // SETTINGS
    // =====================================================

    settings() {

        return `

            ${this.heading(
                "Settings",
                "Manage your Ledger workspace."
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
                            Express API connected to your Ledger PostgreSQL database.
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


        // =====================================================
    // CHART OF ACCOUNTS
    // =====================================================

    // Account picker used on journal lines.
    // Falls back to free text if the chart could not be loaded.
    journalAccountControl(id, index, account) {

        if (!LedgerUtils.chart.length) {

            return `
                <input
                    class="journal-account"
                    data-id="${id}"
                    data-line="${index}"
                    value="${LedgerUtils.escape(account)}"
                    placeholder="Account name"
                    aria-label="Account name"
                >
            `;
        }

        return `
            <select
                class="journal-account"
                data-id="${id}"
                data-line="${index}"
                aria-label="Account"
            >
                ${LedgerUtils.accountSelectOptions(account)}
            </select>
        `;
    }

    accountRow(account) {

        const id = account.account_id;

        const editing =
            this.state.editingAccountId === id;

        const locked =
            account.is_system;

        const unused =
            !locked && account.line_count === 0;

        const status = account.is_active
            ? `<span class="badge approved">ACTIVE</span>`
            : `<span class="badge pending">INACTIVE</span>`;

        const normal =
            account.normal_balance === "debit" ? "Debit" : "Credit";

        if (editing) {

            return `
                <tr data-account-row="${id}">

                    <td>
                        <input
                            class="coa-input coa-code-input"
                            data-field="code"
                            value="${LedgerUtils.escape(account.code)}"
                            maxlength="10"
                            inputmode="numeric"
                            aria-label="Account code"
                        >
                    </td>

                    <td><div class="coa-stack">
                        <input
                            class="coa-input"
                            data-field="name"
                            value="${LedgerUtils.escape(account.account_name)}"
                            maxlength="150"
                            aria-label="Account name"
                            ${locked ? "disabled" : ""}
                        >
                        ${
                            unused
                                ? `
                                    <select class="coa-input" data-field="type" aria-label="Account type">
                                        ${LedgerUtils.accountTypeOptions(account.account_type)}
                                    </select>
                                `
                                : ""
                        }
                    </div></td>

                    <td>
                        ${
                            unused
                                ? `
                                    <select class="coa-input" data-field="normal" aria-label="Normal balance">
                                        <option value="debit" ${account.normal_balance === "debit" ? "selected" : ""}>Debit</option>
                                        <option value="credit" ${account.normal_balance === "credit" ? "selected" : ""}>Credit</option>
                                    </select>
                                `
                                : normal
                        }
                    </td>

                    <td>${account.line_count}</td>

                    <td>${status}</td>

                    <td class="coa-actions">
                        <button class="btn primary small" data-save-account="${id}">SAVE</button>
                        <button class="btn secondary small" data-cancel-account>CANCEL</button>
                    </td>

                </tr>
            `;
        }

        return `
            <tr data-account-row="${id}" class="${account.is_active ? "" : "coa-row-inactive"}">

                <td><strong class="coa-code">${LedgerUtils.escape(account.code)}</strong></td>

                <td>
                    ${LedgerUtils.escape(account.account_name)}
                    ${
                        locked
                            ? `<span class="coa-system-note">System</span>`
                            : ""
                    }
                </td>

                <td>${normal}</td>

                <td>${account.line_count}</td>

                <td>${status}</td>

                <td class="coa-actions">

                    <button class="btn ghost small" data-edit-account="${id}">EDIT</button>

                    ${
                        locked
                            ? ""
                            : `
                                <button class="btn ghost small" data-toggle-account="${id}">
                                    ${account.is_active ? "DEACTIVATE" : "REACTIVATE"}
                                </button>
                            `
                    }

                    ${
                        unused
                            ? `<button class="btn danger small" data-delete-account="${id}">DELETE</button>`
                            : ""
                    }

                </td>

            </tr>
        `;
    }

    chartOfAccounts() {

        const showInactive =
            this.state.showInactiveAccounts;

        const accounts = this.state.accounts.filter(
            account => showInactive || account.is_active
        );

        if (!this.state.accounts.length) {

            return `

                ${this.heading(
                    "Chart of Accounts",
                    "The accounts your journal entries post to."
                )}

                <div class="card"><div class="empty-state">Your chart of accounts could not be loaded.
                        Check that the <strong>/api/accounts</strong> route is
                        mounted on the server and that the chart of accounts
                        migration has been run, then reload the page.
                    </div></div>
            `;
        }

        const sections = LedgerUtils.ACCOUNT_TYPES.map(type => {

            const rows = accounts.filter(
                account => account.account_type === type
            );

            if (!rows.length) return "";

            return `
                <div class="card table-card">

                    <div class="card-head">
                        <h3>${LedgerUtils.ACCOUNT_TYPE_LABELS[type]}</h3>
                        <span class="tiny muted">${rows.length} accounts</span>
                    </div>

                    <div class="table-wrap">
                        <table class="coa-table">
                            <thead>
                                <tr>
                                    <th>CODE</th>
                                    <th>ACCOUNT</th>
                                    <th>NORMAL BALANCE</th>
                                    <th>POSTINGS</th>
                                    <th>STATUS</th>
                                    <th>ACTION</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${rows.map(account => this.accountRow(account)).join("")}
                            </tbody>
                        </table>
                    </div>

                </div>
            `;

        }).join("");

        return `

            ${this.heading(
                "Chart of Accounts",
                "Every journal line must use one of these accounts.",
                `
                    <label class="coa-toggle">
                        <input
                            type="checkbox"
                            id="showInactiveAccounts"
                            ${showInactive ? "checked" : ""}
                        >
                        Show inactive accounts
                    </label>
                `
            )}

            <div class="info-box coa-info">
                Every journal line must use an account from this list. Accounts that already have
                postings can't change type or be deleted, so deactivate them instead.
            </div>

            <div class="card coa-form-card">

                <div class="card-head">
                    <h3>Add an account</h3>
                </div>

                <form id="accountForm" class="coa-form">

                    <label>
                        ACCOUNT NAME
                        <input
                            name="account_name"
                            maxlength="150"
                            placeholder="e.g. Delivery Equipment"
                            required
                        >
                    </label>

                    <label>
                        TYPE
                        <select name="account_type">
                            ${LedgerUtils.accountTypeOptions("expense")}
                        </select>
                    </label>

                    <label>
                        CODE
                        <input
                            name="code"
                            maxlength="10"
                            inputmode="numeric"
                            placeholder="Automatic"
                        >
                    </label>

                    <label>
                        NORMAL BALANCE
                        <select name="normal_balance">
                            <option value="">Default for type</option>
                            <option value="debit">Debit</option>
                            <option value="credit">Credit</option>
                        </select>
                    </label>

                    <button class="btn primary" type="submit">ADD ACCOUNT</button>

                </form>

            </div>

            ${sections}
        `;
    }


    // =====================================================
    // PAGE REGISTRY
    // =====================================================


    getPages() {

        return {

            dashboard: () => this.dashboard(),

            transactions: () => this.transactions(),

            journal: () => this.journal(),

                        ledger: () => this.ledger(),

            chartOfAccounts: () => this.chartOfAccounts(),


            trialBalance: () => this.trialBalance(),

            receipts: () => this.receipts(),

            errors: () => this.errors(),

            reports: () => this.reports(),

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

            journal: "Journal Entries",

                        ledger: "General Ledger",

            chartOfAccounts: "Chart of Accounts",


            trialBalance: "Trial Balance",

            receipts: "Receipts",

            errors: "Error Detection",

            reports: "Reports",

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
    }


    // =====================================================
    // TRANSACTION MODAL
    // =====================================================

    openModal() {

        document.getElementById("modalBackdrop").hidden =
            false;

        document.getElementById("txDate").value =
            LedgerUtils.today();

        document.getElementById("txDescription").focus();
    }


    closeModal() {

        document.getElementById("modalBackdrop").hidden =
            true;

        document.getElementById("transactionForm").reset();
    }


    // -----------------------------------------------------
    // ADD TRANSACTION
    // -----------------------------------------------------

    async addTransaction(event) {

        event.preventDefault();

        const form = event.currentTarget;

        const button = form.querySelector(
            '[type="submit"]'
        );


        const date =
            document.getElementById("txDate").value;

        const description =
            document.getElementById("txDescription")
                .value.trim();

        const category =
            document.getElementById("txCategory").value;

        const type =
            document.getElementById("txType").value;

        const amount =
            Number(
                document.getElementById("txAmount").value
            );

        const file =
            document.getElementById("txReceipt").files[0];


        if (
            !date ||
            !description ||
            !category ||
            !type
        ) {

            LedgerUtils.toast(
                "Complete all required fields.",
                "error"
            );

            return;
        }


        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {

            LedgerUtils.toast(
                "Enter an amount greater than zero.",
                "error"
            );

            return;
        }


        if (file && file.size > 4 * 1024 * 1024) {

            LedgerUtils.toast(
                "Receipt must be 4 MB or smaller.",
                "error"
            );

            return;
        }


        button.disabled = true;


        try {

            const result =
                await this.api.saveTransaction({

                    date,

                    description,

                    category,

                    type,

                    amount,

                    status: "approved"

                });


            const saved =
                result.transaction || result;


            if (!saved.id) {

                throw new Error(
                    "The server did not return the saved transaction ID."
                );
            }


            if (file) {

                await this.addReceiptFiles(
                    [file],
                    false
                );
            }


            await this.api.loadTransactions();

            await this.api.loadJournalEntries();


            this.closeModal();

            this.render("journal");


            LedgerUtils.toast(
                "Transaction saved to PostgreSQL."
            );

        } catch (error) {

            LedgerUtils.toast(
                error.message,
                "error"
            );

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


    // =====================================================
    // TRIAL BALANCE
    // =====================================================

    // -----------------------------------------------------
    // UPDATE REPORTING DATE
    // -----------------------------------------------------

    updateTrialBalanceDate(value) {

        if (!value) {

            LedgerUtils.toast(
                "Select a reporting date.",
                "error"
            );

            return;
        }

        if (!LedgerCSVImporter.validDate(value)) {

            LedgerUtils.toast(
                "Invalid reporting date.",
                "error"
            );

            return;
        }

        if (value > LedgerUtils.today()) {

            LedgerUtils.toast(
                "The reporting date cannot be in the future.",
                "error"
            );

            return;
        }


        this.state.trialBalanceDate = value;

        // Re-render Trial Balance using selected date.
        this.render("trialBalance");
    }


    // -----------------------------------------------------
    // EXPORT TRIAL BALANCE CSV
    // -----------------------------------------------------

    exportTrialBalanceCSV() {

        const asOfDate =
            this.state.trialBalanceDate ||
            LedgerUtils.today();

        const report =
            LedgerAccounting.trialBalance(
                this.state,
                asOfDate
            );


        const rows = [

            [
                "Account Name",
                "Account Type",
                "Debit",
                "Credit"
            ],


            ...report.rows.map(account => [

                account.account,

                account.accountType,

                account.debit.toFixed(2),

                account.credit.toFixed(2)

            ]),


            [
                "TOTAL",
                "",
                report.totalDebit.toFixed(2),
                report.totalCredit.toFixed(2)
            ],


            [
                "DIFFERENCE",
                "",
                "",
                report.difference.toFixed(2)
            ]

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

        link.download =
            `ledger-trial-balance-${asOfDate}.csv`;

        document.body.appendChild(link);

        link.click();

        link.remove();

        URL.revokeObjectURL(url);


        LedgerUtils.toast(
            "Trial Balance exported successfully."
        );
    }


    // =====================================================
    // JOURNAL EDITING
    // =====================================================

    captureJournal(id) {

        const selector =
            `.journal-account[data-id="${CSS.escape(String(id))}"]`;

        const accountInputs = [
            ...document.querySelectorAll(selector)
        ];


        if (!accountInputs.length) {
            return [];
        }


        return accountInputs.map(element => {

            const row = element.closest(".journal-row");

            return {

                account: element.value.trim(),

                accountType:
                    row.querySelector(
                        ".journal-account-type"
                    ).value,

                description:
                    row.querySelector(
                        ".journal-line-description"
                    ).value.trim(),

                debit: Number(
                    row.querySelector(
                        '[data-field="debit"]'
                    ).value
                ) || 0,

                credit: Number(
                    row.querySelector(
                        '[data-field="credit"]'
                    ).value
                ) || 0

            };

        });
    }


    // -----------------------------------------------------
    // CAPTURE TRANSACTION DETAILS
    // -----------------------------------------------------

    captureTransactionDetails(id) {

        const selector =
            `.journal-transaction-field[data-id="${CSS.escape(String(id))}"]`;

        const fields = [
            ...document.querySelectorAll(selector)
        ];

        const details = {};


        fields.forEach(field => {

            details[field.dataset.field] =
                field.value.trim();

        });


        return {

            date: details.date || "",

            description: details.description || "",

            category: details.category || ""

        };
    }


    // -----------------------------------------------------
    // SAVE JOURNAL
    // -----------------------------------------------------

    async saveJournal(button) {

        const id = button.dataset.saveJournal;

        const lines = this.captureJournal(id);

        const details =
            this.captureTransactionDetails(id);


        if (!lines.length) {

            LedgerUtils.toast(
                "No journal lines found.",
                "error"
            );

            return;
        }


        if (
            !details.date ||
            !details.description ||
            !details.category
        ) {

            LedgerUtils.toast(
                "Complete the date, description, and category.",
                "error"
            );

            return;
        }


        const validationError =
            LedgerAccounting.validateJournal(lines);


        if (validationError) {

            LedgerUtils.toast(
                validationError,
                "error"
            );

            return;
        }


        const originalText = button.textContent;

        button.disabled = true;

        button.textContent = "SAVING...";


        try {

            await this.api.saveJournalEntry(
                id,
                lines,
                details
            );


            await this.api.loadTransactions();

            await this.api.loadJournalEntries();


            this.render(this.state.currentPage);


            LedgerUtils.toast(
                "Journal entry saved successfully."
            );

        } catch (error) {

            LedgerUtils.toast(
                error.message,
                "error"
            );

            button.disabled = false;

            button.textContent = originalText;
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

    async runChartAction(action, successMessage, reloadJournal = false) {

        try {

            await action();

            await this.api.loadAccounts();

            if (reloadJournal) {
                await this.api.loadJournalEntries();
            }

            this.state.editingAccountId = null;

            this.rerenderKeepScroll();

            if (successMessage) {
                LedgerUtils.toast(successMessage);
            }

            return true;

        } catch (error) {

            LedgerUtils.toast(error.message, "error");

            return false;
        }
    }

    wireChartOfAccounts() {

        // Journal pages: choosing an account sets its type from the chart.
        document.querySelectorAll("select.journal-account")
            .forEach(select => {

                select.addEventListener("change", () => {

                    const row = select.closest(".journal-row");

                    const type = row?.querySelector(
                        ".journal-account-type"
                    );

                    if (type) {
                        type.value =
                            LedgerUtils.accountTypeFor(select.value);
                    }
                });
            });


        // Chart of accounts page
        document.getElementById("showInactiveAccounts")
            ?.addEventListener("change", event => {

                this.state.showInactiveAccounts =
                    event.target.checked;

                this.rerenderKeepScroll();
            });


        document.getElementById("accountForm")
            ?.addEventListener("submit", async event => {

                event.preventDefault();

                const form = event.target;

                const data = Object.fromEntries(
                    new FormData(form)
                );

                const payload = {
                    account_name: String(data.account_name || "").trim(),
                    account_type: data.account_type
                };

                if (String(data.code || "").trim()) {
                    payload.code = String(data.code).trim();
                }

                if (data.normal_balance) {
                    payload.normal_balance = data.normal_balance;
                }

                await this.runChartAction(
                    () => this.api.createAccount(payload),
                    "Account added."
                );
            });


        document.querySelectorAll("[data-edit-account]")
            .forEach(button => {

                button.addEventListener("click", () => {

                    this.state.editingAccountId =
                        Number(button.dataset.editAccount);

                    this.rerenderKeepScroll();
                });
            });


        document.querySelectorAll("[data-cancel-account]")
            .forEach(button => {

                button.addEventListener("click", () => {

                    this.state.editingAccountId = null;

                    this.rerenderKeepScroll();
                });
            });


        document.querySelectorAll("[data-save-account]")
            .forEach(button => {

                button.addEventListener("click", async () => {

                    const id = Number(button.dataset.saveAccount);

                    const account = this.state.accounts.find(
                        item => item.account_id === id
                    );

                    const row = button.closest("tr");

                    const read = field =>
                        row.querySelector(`[data-field="${field}"]`)?.value;

                    const changes = {};

                    const code = read("code")?.trim();
                    const name = read("name")?.trim();
                    const type = read("type");
                    const normal = read("normal");

                    if (code !== undefined && code !== account.code) {
                        changes.code = code;
                    }

                    if (name && name !== account.account_name) {
                        changes.account_name = name;
                    }

                    if (type && type !== account.account_type) {
                        changes.account_type = type;
                    }

                    if (normal && normal !== account.normal_balance) {
                        changes.normal_balance = normal;
                    }

                    // New type without an explicit balance side: use the default.
                    if (changes.account_type && !changes.normal_balance) {

                        const defaultSide =
                            ["asset", "expense"].includes(changes.account_type)
                                ? "debit"
                                : "credit";

                        if (defaultSide !== account.normal_balance) {
                            changes.normal_balance = defaultSide;
                        }
                    }

                    if (!Object.keys(changes).length) {

                        this.state.editingAccountId = null;

                        this.rerenderKeepScroll();

                        return;
                    }

                    await this.runChartAction(
                        () => this.api.updateAccount(id, changes),
                        "Account updated.",
                        Boolean(changes.account_name)
                    );
                });
            });


        document.querySelectorAll("[data-toggle-account]")
            .forEach(button => {

                button.addEventListener("click", async () => {

                    const id = Number(button.dataset.toggleAccount);

                    const account = this.state.accounts.find(
                        item => item.account_id === id
                    );

                    await this.runChartAction(
                        () => this.api.updateAccount(id, {
                            is_active: !account.is_active
                        }),
                        account.is_active
                            ? "Account deactivated."
                            : "Account reactivated."
                    );
                });
            });


        document.querySelectorAll("[data-delete-account]")
            .forEach(button => {

                button.addEventListener("click", async () => {

                    const id = Number(button.dataset.deleteAccount);

                    const account = this.state.accounts.find(
                        item => item.account_id === id
                    );

                    if (!window.confirm(
                        `Delete "${account.account_name}"? This cannot be undone.`
                    )) {
                        return;
                    }

                    await this.runChartAction(
                        () => this.api.deleteAccount(id),
                        "Account deleted."
                    );
                });
            });
    }


    // =====================================================
    // RECEIPT MANAGEMENT
    // =====================================================


    async addReceiptFiles(files, shouldRender = true) {

        for (const file of files) {

            if (file.size > 4 * 1024 * 1024) {

                LedgerUtils.toast(
                    `${file.name} is over 4 MB. Choose a smaller file.`,
                    "error"
                );

                continue;
            }


            try {

                const data = await new Promise(
                    (resolve, reject) => {

                        const reader = new FileReader();

                        reader.onload = () => {
                            resolve(reader.result);
                        };

                        reader.onerror = reject;

                        reader.readAsDataURL(file);
                    }
                );


                this.state.receipts.push({

                    id: crypto.randomUUID(),

                    name: file.name,

                    type: file.type || "Document",

                    date: LedgerUtils.today(),

                    data

                });

            } catch {

                LedgerUtils.toast(
                    `Could not read ${file.name}.`,
                    "error"
                );
            }
        }


        if (shouldRender) {

            this.render("receipts");

            LedgerUtils.toast(
                "Receipt added temporarily to this browser."
            );
        }
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

    deleteReceipt(id) {

        this.state.receipts =
            this.state.receipts.filter(
                receipt => String(receipt.id) !== String(id)
            );


        this.render("receipts");


        LedgerUtils.toast(
            "Receipt removed from this browser."
        );
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

                    transaction.type === typeValue;


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

                        this.render("journal");

                        LedgerUtils.toast(
                            "Review the journal entry for: " +
                            transaction.description
                        );
                    }

                });

            });
    }


    // =====================================================
    // PAGE EVENT LISTENERS
    // =====================================================

        wirePage() {


        // Chart of accounts + journal account pickers
        this.wireChartOfAccounts();


        // Dashboard reporting period
        document.getElementById("dashboardPeriod")
            ?.addEventListener("change", event => {

                this.state.dashboardPeriod =
                    event.target.value;

                this.dashboardChart.render();

            });


        // Dashboard chart type
        document.getElementById("dashboardChartType")
            ?.addEventListener("change", event => {

                this.state.dashboardChartType =
                    event.target.value;

                this.dashboardChart.render();

            });


        // Trial Balance reporting date
        document.getElementById("trialBalanceDate")
            ?.addEventListener("change", event => {

                this.updateTrialBalanceDate(
                    event.target.value
                );

            });


        // Trial Balance CSV export
        document.getElementById("exportTrialBalance")
            ?.addEventListener("click", () => {

                this.exportTrialBalanceCSV();

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


        // Save journal
        document.querySelectorAll("[data-save-journal]")
            .forEach(button => {

                button.addEventListener("click", () => {

                    this.saveJournal(button);

                });

            });


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


        // Export report
        document.getElementById("exportReport")
            ?.addEventListener("click", () => {

                this.exportCSV();

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


        // Main navigation
        document.querySelectorAll(".nav-item[data-page]")
            .forEach(button => {

                button.addEventListener("click", () => {

                    this.render(button.dataset.page);

                    document.getElementById("sidebar")
                        .classList.remove("open");

                });

            });


        // Transaction form
        document.getElementById("transactionForm")
            .addEventListener("submit", event => {

                this.addTransaction(event);

            });


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
                    "Add a transaction, review its suggested debit and credit entries, then view the General Ledger and Trial Balance."
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