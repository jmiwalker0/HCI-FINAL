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

    // Common adjusting entries. Each preset fills in the usual two accounts;
    // the person can change either account before saving.
    static ADJUSTMENT_TYPES = {
        depreciation: {
            label: "Depreciation",
            description: "Depreciation for the period",
            debit: { account: "Depreciation Expense", type: "expense" },
            credit: { account: "Accumulated Depreciation", type: "asset" },
            help: "Spreads the cost of equipment over its useful life. Increases an expense and reduces the asset's value."
        },
        supplies: {
            label: "Supplies used",
            description: "Supplies used during the period",
            debit: { account: "Supplies Expense", type: "expense" },
            credit: { account: "Supplies", type: "asset" },
            help: "Some of the supplies you bought were used up. Move that cost from the asset to an expense."
        },
        prepaid: {
            label: "Prepaid expense used up",
            description: "Prepaid expense used during the period",
            debit: { account: "Rent Expense", type: "expense" },
            credit: { account: "Prepaid Rent", type: "asset" },
            help: "A cost you paid in advance (rent, insurance) has now expired. Change the accounts if it is not rent."
        },
        accruedExpense: {
            label: "Accrued expense (owed, not yet paid)",
            description: "Expense incurred but not yet paid",
            debit: { account: "Salaries Expense", type: "expense" },
            credit: { account: "Salaries Payable", type: "liability" },
            help: "You used a service or owe wages but have not paid or recorded it yet. Change the accounts if it is not salaries."
        },
        unearned: {
            label: "Unearned revenue now earned",
            description: "Advance payment now earned",
            debit: { account: "Unearned Revenue", type: "liability" },
            credit: { account: "Service Revenue", type: "revenue" },
            help: "A customer paid in advance and you have now done the work."
        },
        accruedRevenue: {
            label: "Accrued revenue (earned, not yet received)",
            description: "Revenue earned but not yet received",
            debit: { account: "Accounts Receivable", type: "asset" },
            credit: { account: "Service Revenue", type: "revenue" },
            help: "You did the work but have not been paid or billed yet."
        },
        other: {
            label: "Other adjustment",
            description: "",
            debit: { account: "", type: null },
            credit: { account: "", type: null },
            help: "Choose any two accounts for an adjustment not listed above."
        }
    };

    // Chart of Accounts wins; then the preset's own account; then the name.
    static resolveAccountType(name, presetLine) {

        const chartAccount = LedgerUtils.findAccount(name);

        if (chartAccount?.account_type) return chartAccount.account_type;

        if (
            presetLine?.type &&
            String(presetLine.account || "").toLowerCase() ===
                String(name || "").trim().toLowerCase()
        ) {
            return presetLine.type;
        }

        return LedgerUtils.accountTypeFor(name);
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
        return LedgerUtils.TRANSACTION_TYPES[type]?.label || type;
    }

    static typeOptions(selected) {
        return Object.entries(LedgerUtils.TRANSACTION_TYPES)
            .map(([value, config]) => `
                <option value="${value}" ${value === selected ? "selected" : ""}>
                    ${config.label}
                </option>
            `).join("");
    }

    static categoryOptions(type, selected) {
        const categories =
            LedgerUtils.TRANSACTION_TYPES[type]?.categories || [];

        return categories.map(category => `
            <option
                value="${LedgerUtils.escape(category)}"
                ${category === selected ? "selected" : ""}
            >
                ${LedgerUtils.escape(category)}
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

        // Reconciliation wizard + adjustment review
        this.proposals = [];
        this.recon = LedgerState.emptyRecon();
        this.editingProposalId = null;
        this.reviewShowAll = false;
        this.adjustments = [];
                this.journalEdits = {};

        // Chart of accounts
        this.accounts = [];
        this.editingAccountId = null;
        this.showInactiveAccounts = false;

        this.currentPage = "dashboard";

        // Reporting periods (monthly / quarterly / yearly)
        this.reporting = LedgerState.emptyReporting();
        this.accountClasses = new Map();
        this.savedReports = [];
        this.closing = LedgerState.emptyClosing();
        this.viewedReport = null;
        this.auditEvents = null;

        // Journal entry to scroll to after opening the Journal page
        this.focusJournalId = null;

        this.currentUser = null;
        this.authMode = "login";

        // Dashboard preferences
        this.dashboardPeriod = "monthly";
        this.dashboardChartType = "bar";

        // Trial Balance preferences
        this.trialBalanceDate = LedgerUtils.today();

        // Adjusted Trial Balance reporting date
        this.adjustedTbDate = LedgerUtils.today();

        // Financial Statements period (defaults to this year so far)
        this.statementStart = LedgerUtils.today().slice(0, 4) + "-01-01";
        this.statementEnd = LedgerUtils.today();
    }

    static emptyClosing() {
        return {
            years: [],
            closings: [],
            audit: [],
            fy: null,
            step: 1,
            checks: null,
            steps: {},
            busy: false,
            loaded: false
        };
    }

    getClosingYear() {

        const c = this.closing;

        return c.years.find(y => y.start === c.fy) ||
            c.years.find(y => y.end <= LedgerUtils.today()) ||
            c.years[0] || null;
    }

    // The closing that currently counts for a fiscal year: a closed one,
    // else one in progress, else none.
    getYearClosing(fyStart) {

        const rows = this.closing.closings.filter(
            x => x.fiscalYearStart === fyStart
        );

        return rows.find(x => x.status === "complete") ||
            rows.find(x => x.status === "in_progress") || null;
    }

    // Last day of the latest closed fiscal year ("" when none is closed).
    closedThrough() {

        return this.closing.closings
            .filter(c => c.status === "complete")
            .reduce((max, c) => c.fiscalYearEnd > max ? c.fiscalYearEnd : max, "");
    }

    static emptyReporting() {
        return {
            frequency: "monthly",
            fiscalStartMonth: 1,
            fiscalStartLocked: false,
            periods: [],
            selectedStart: null
        };
    }

    setReporting(data) {

        const previousSelection = this.reporting.selectedStart;

        const periods = (data.periods || []).map(period => ({
            id: String(period.id),
            frequency: period.frequency,
            label: period.label,
            start: String(period.start_date).slice(0, 10),
            end: String(period.end_date).slice(0, 10),
            fiscalYearStart: String(period.fiscal_year_start).slice(0, 10),
            status: period.status,
            reconciliation: period.reconciliation_status,
            adjustedTb: period.adjusted_tb_status,
            statements: period.statements_status,
            closing: period.closing_status
        }));

        const keep = periods.some(p => p.start === previousSelection);

        this.reporting = {
            frequency: data.settings?.frequency || "monthly",
            fiscalStartMonth:
                Number(data.settings?.fiscal_start_month) || 1,
            fiscalStartLocked:
                data.settings?.fiscal_start_locked === true,
            periods,
            // Default to the current (latest) period.
            selectedStart: keep
                ? previousSelection
                : periods.length
                    ? periods[periods.length - 1].start
                    : null
        };
    }

    getReportingPeriod(start = this.reporting.selectedStart) {
        return this.reporting.periods.find(p => p.start === start) || null;
    }

    getPreviousReportingPeriod(period) {

        const list = this.reporting.periods;

        const index = list.findIndex(p => p.start === period?.start);

        return index > 0 ? list[index - 1] : null;
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

    setAdjustments(entries) {

        this.adjustments = (entries || []).map(entry => ({
            id: String(entry.id),
            date: String(entry.entry_date || "").slice(0, 10),
            type: entry.adjustment_type,
            description: entry.description || "",
            lines: (entry.lines || []).map(line => ({
                account: line.account_name,
                accountType: line.account_type,
                description: entry.description || "",
                debit: Number(line.debit) || 0,
                credit: Number(line.credit) || 0
            }))
        }));
    }

    static emptyRecon() {
        return {
            periodId: null,
            step: 1,
            draft: {},
            steps: {},
            warnings: [],
            loading: false
        };
    }

    setProposals(rows) {

        this.proposals = (rows || []).map(row => ({
            id: String(row.id),
            periodId: String(row.period_id),
            periodLabel: row.period_label || "",
            periodStart: String(row.period_start || "").slice(0, 10),
            periodEnd: String(row.period_end || "").slice(0, 10),
            periodStatus: row.period_status || "open",
            source: row.source,
            description: row.description || "",
            reason: row.reason || "",
            entryDate: String(row.entry_date || "").slice(0, 10),
            lines: (Array.isArray(row.lines) ? row.lines : []).map(line => ({
                account: line.account_name || "",
                accountType: line.account_type || "",
                debit: Number(line.debit) || 0,
                credit: Number(line.credit) || 0
            })),
            meta: row.meta || {},
            status: row.status,
            decisionNote: row.decision_note || "",
            decidedAt: row.decided_at ? String(row.decided_at).slice(0, 10) : ""
        }));
    }

    getPeriodProposals(periodId) {
        return this.proposals.filter(p => p.periodId === periodId);
    }

    static isWaiting(proposal) {
        return proposal.status === "pending" ||
               proposal.status === "revise_needed";
    }

    setFixedAssets(list) {

        this.fixedAssets = (list || []).map(asset => ({
            id: String(asset.id),
            name: asset.name || "",
            description: asset.description || "",
            acquisitionDate:
                String(asset.acquisition_date || "").slice(0, 10),
            depreciationStartDate:
                String(asset.depreciation_start_date || "").slice(0, 10),
            cost: Number(asset.cost) || 0,
            residualValue: Number(asset.residual_value) || 0,
            usefulLifeMonths: Number(asset.useful_life_months) || 0,
            method: asset.method || "straight_line",
            decliningRate:
                asset.declining_rate == null
                    ? null
                    : Number(asset.declining_rate),
            openingAccumulated: Number(asset.opening_accumulated) || 0,
            accumulatedDepreciation:
                Number(asset.accumulated_depreciation) ||
                Number(asset.opening_accumulated) || 0,
            carryingAmount:
                asset.carrying_amount == null
                    ? (Number(asset.cost) || 0) -
                      (Number(asset.opening_accumulated) || 0)
                    : Number(asset.carrying_amount),
            condition: asset.condition || "good",
            status: asset.status || "active",
            disposalDate:
                String(asset.disposal_date || "").slice(0, 10)
        }));
    }

    setSupplies(list) {

        this.supplies = (list || []).map(item => ({
            id: String(item.id),
            name: item.name || "",
            category: item.category || "General",
            description: item.description || "",
            unitsOnHand: Number(item.units_on_hand) || 0,
            unitCost: Number(item.unit_cost) || 0,
            minStockLevel: Number(item.min_stock_level) || 0,
            lastCountDate:
                String(item.last_count_date || "").slice(0, 10)
        }));
    }

    setInventory(data) {

        this.inventory = (data.items || []).map(item => ({
            id: String(item.id),
            name: item.name,
            quantity: Number(item.quantity_on_hand) || 0,
            averageCost: Number(item.average_cost) || 0,
            value: Number(item.stock_value) || 0
        }));

        this.inventoryMovements = (data.movements || []).map(move => ({
            id: String(move.id),
            type: move.movement_type,
            itemName: move.item_name,
            date: String(move.date || "").slice(0, 10),
            description: move.description,
            quantity: Number(move.quantity) || 0,
            unitCost: Number(move.unit_cost) || 0,
            totalCost: Number(move.total_cost) || 0
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
        this.inventory = [];
        this.inventoryMovements = [];

        // Fixed assets + supplies registers
        this.fixedAssets = [];
        this.editingAssetId = null;
        this.assetFormOpen = false;
        this.supplies = [];
        this.editingSupplyId = null;
        this.supplyFormOpen = false;

        // Reconciliation wizard + adjustment review
        this.proposals = [];
        this.recon = LedgerState.emptyRecon();
        this.editingProposalId = null;
        this.reviewShowAll = false;
        this.adjustments = [];
                this.journalEdits = {};

        this.accounts = [];
        this.editingAccountId = null;
        this.showInactiveAccounts = false;
        LedgerUtils.chart = [];

        this.reporting = LedgerState.emptyReporting();
        this.accountClasses = new Map();
        this.savedReports = [];
        this.closing = LedgerState.emptyClosing();
        this.viewedReport = null;
        this.auditEvents = null;

        this.currentUser = null;
        this.currentPage = "dashboard";


        this.dashboardPeriod = "monthly";
        this.dashboardChartType = "bar";

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

    async loadAdjustments() {

        const data = await this.request("/adjusting-entries");

        this.state.setAdjustments(data.adjustingEntries || []);
    }

    async saveAdjustment(entry) {

        return this.request("/adjusting-entries", {
            method: "POST",
            body: JSON.stringify(entry)
        });
    }

    async deleteAdjustment(id) {

        return this.request(
            `/adjusting-entries/${encodeURIComponent(id)}`,
            { method: "DELETE" }
        );
    }

    async loadAccountClasses() {

        const data = await this.request("/statements/classes");

        this.state.accountClasses = new Map(
            (data.classes || []).map(c => [
                String(c.account_name).trim().toLowerCase(), c.class
            ])
        );
    }

    async saveAccountClasses(classes) {

        await this.request("/statements/classes", {
            method: "PUT",
            body: JSON.stringify({ classes })
        });

        await this.loadAccountClasses();
    }

    async loadSavedReports() {

        const data = await this.request("/statements/reports");

        this.state.savedReports = data.reports || [];
    }

    async saveReportSnapshot(body) {

        return this.request("/statements/reports", {
            method: "POST",
            body: JSON.stringify(body)
        });
    }

    async loadClosings() {

        const data = await this.request("/closing");

        const closing = this.state.closing;

        closing.years = (data.years || []).map(y => ({
            start: String(y.fiscal_year_start).slice(0, 10),
            end: String(y.fiscal_year_end).slice(0, 10)
        }));

        closing.closings = (data.closings || []).map(c => ({
            id: String(c.id),
            fiscalYearStart: String(c.fiscal_year_start).slice(0, 10),
            fiscalYearEnd: String(c.fiscal_year_end).slice(0, 10),
            status: c.status,
            steps: c.steps || {},
            netIncome: c.net_income == null ? null : Number(c.net_income),
            closedAt: c.closed_at,
            reopenedAt: c.reopened_at,
            reopenReason: c.reopen_reason || ""
        }));

        closing.audit = data.audit || [];
        closing.loaded = true;
    }

    async loadAuditEvents() {

        const data = await this.request("/closing/audit/events");

        this.state.auditEvents = data.events || [];
        this.state.auditLoadedAt = Date.now();
    }

    async loadClosingChecks(fy) {

        return this.request(`/closing/${encodeURIComponent(fy)}/checks`);
    }

    async saveClosingSteps(fy, steps) {

        return this.request(`/closing/${encodeURIComponent(fy)}/steps`, {
            method: "PUT",
            body: JSON.stringify({ steps })
        });
    }

    async closeYear(fy, body) {

        return this.request(`/closing/${encodeURIComponent(fy)}/close`, {
            method: "POST",
            body: JSON.stringify(body)
        });
    }

    async reopenYear(id, body) {

        return this.request(`/closing/${encodeURIComponent(id)}/reopen`, {
            method: "POST",
            body: JSON.stringify(body)
        });
    }

    async loadReporting() {

        const data = await this.request(
            `/reporting?today=${encodeURIComponent(LedgerUtils.today())}`
        );

        this.state.setReporting(data);
    }

    async saveReportingSettings(settings) {

        return this.request("/reporting/settings", {
            method: "PUT",
            body: JSON.stringify(settings)
        });
    }

    async loadInventory() {

        const data = await this.request("/inventory");

        this.state.setInventory(data || {});
    }

    // ---- Reconciliation + adjustment review ----

    async loadProposals() {

        const data = await this.request("/period-adjustments");

        this.state.setProposals(data.adjustments || []);
    }

    async getReconciliation(periodId) {

        return this.request(
            `/reconciliation/${encodeURIComponent(periodId)}`
        );
    }

    async saveReconciliation(periodId, data, steps) {

        return this.request(
            `/reconciliation/${encodeURIComponent(periodId)}`,
            {
                method: "PUT",
                body: JSON.stringify({ data, steps })
            }
        );
    }

    async generateAdjustments(periodId, body) {

        return this.request(
            `/reconciliation/${encodeURIComponent(periodId)}/generate`,
            {
                method: "POST",
                body: JSON.stringify(body)
            }
        );
    }

    async completeReconciliation(periodId) {

        return this.request(
            `/reconciliation/${encodeURIComponent(periodId)}/complete`,
            { method: "POST" }
        );
    }

    async setPeriodStatus(periodId, field, value) {

        return this.request(
            `/reconciliation/${encodeURIComponent(periodId)}/status`,
            {
                method: "PUT",
                body: JSON.stringify({ field, value })
            }
        );
    }

    async reviseProposal(id, payload) {

        return this.request(
            `/period-adjustments/${encodeURIComponent(id)}`,
            {
                method: "PUT",
                body: JSON.stringify(payload)
            }
        );
    }

    async approveProposal(id) {

        return this.request(
            `/period-adjustments/${encodeURIComponent(id)}/approve`,
            { method: "POST" }
        );
    }

    async rejectProposal(id, note = "") {

        return this.request(
            `/period-adjustments/${encodeURIComponent(id)}/reject`,
            {
                method: "POST",
                body: JSON.stringify({ note })
            }
        );
    }

    async flagProposal(id, note = "") {

        return this.request(
            `/period-adjustments/${encodeURIComponent(id)}/needs-revision`,
            {
                method: "POST",
                body: JSON.stringify({ note })
            }
        );
    }

    // ---- Fixed assets ----

    async loadFixedAssets() {

        const data = await this.request("/fixed-assets");

        this.state.setFixedAssets(
            Array.isArray(data)
                ? data
                : (data.assets || data.items || [])
        );
    }

    async createFixedAsset(asset) {

        return this.request("/fixed-assets", {
            method: "POST",
            body: JSON.stringify(asset)
        });
    }

    async updateFixedAsset(id, asset) {

        return this.request(
            `/fixed-assets/${encodeURIComponent(id)}`,
            {
                method: "PUT",
                body: JSON.stringify(asset)
            }
        );
    }

    async deleteFixedAsset(id) {

        return this.request(
            `/fixed-assets/${encodeURIComponent(id)}`,
            { method: "DELETE" }
        );
    }

    // ---- Supplies ----

    async loadSupplies() {

        const data = await this.request("/supplies");

        this.state.setSupplies(
            Array.isArray(data)
                ? data
                : (data.supplies || data.items || [])
        );
    }

    async createSupply(item) {

        return this.request("/supplies", {
            method: "POST",
            body: JSON.stringify(item)
        });
    }

    async updateSupply(id, item) {

        return this.request(
            `/supplies/${encodeURIComponent(id)}`,
            {
                method: "PUT",
                body: JSON.stringify(item)
            }
        );
    }

    async recordSupplyCount(id, unitsOnHand, countDate) {

        return this.request(
            `/supplies/${encodeURIComponent(id)}/count`,
            {
                method: "POST",
                body: JSON.stringify({
                    units_on_hand: unitsOnHand,
                    last_count_date: countDate
                })
            }
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

        // Purchase: Dr Inventory, Cr Cash
        if (transaction.type === "purchase") {

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

            if (transaction.type === "sale") {
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

        const accounts = this.accountFor(transaction);

        const lines = [

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

    // -----------------------------------------------------
    // FINANCIAL STATEMENTS
    // Built from the same posted journal lines as the ledger
    // and trial balance. Income Statement and Owner's Equity
    // cover startDate..endDate; the Balance Sheet is as of endDate.
    // -----------------------------------------------------

    // Posted transactions plus (optionally) adjusting entries, each as
    // { date, lines, adjusting } so reports can treat them the same way.
    static ledgerEntries(state, includeAdjustments) {

        const entries = state.getPostedTransactions()
            .filter(transaction => transaction.date)
            .map(transaction => ({
                date: transaction.date,
                lines: state.getJournalLines(transaction),
                adjusting: false
            }));

        if (includeAdjustments) {

            state.adjustments.forEach(entry => {

                if (!entry.date) return;

                entries.push({
                    date: entry.date,
                    lines: entry.lines,
                    adjusting: true,
                    closing: this.isClosingType(entry.type)
                });
            });
        }

        return entries;
    }

    static isClosingType(type) {

        return type === "closing" || type === "closing_reversal";
    }

    // Year-end closing entries (and their reversals) move the year's
    // profit into capital. They count in a report only when the report is
    // dated after the closing date; on the closing date itself the books
    // are shown "before closing", so the year's income is still visible.
    static countsAsOf(entry, asOfDate) {

        return !entry.closing || entry.date < asOfDate;
    }

    // Balance of one account (debits less credits) as of a date, from the
    // same posted entries and adjusting entries the reports use.
    static accountBalance(state, accountName, asOfDate) {

        const key = String(accountName || "").trim().toLowerCase();

        let balance = 0;

        if (!key) return 0;

        this.ledgerEntries(state, true).forEach(entry => {

            if (entry.date > asOfDate) return;
            if (!this.countsAsOf(entry, asOfDate)) return;

            entry.lines.forEach(line => {

                if (String(line.account || "").trim().toLowerCase() !== key) return;

                balance += (Number(line.debit) || 0) - (Number(line.credit) || 0);
            });
        });

        return Math.round(balance * 100) / 100;
    }

    static suppliesAccountName() {

        return this.pickAccount(
            ["Supplies", "Office Supplies"],
            "asset",
            /suppl/i,
            "Supplies"
        );
    }

    // Income, expenses and profit earned between two dates (inclusive).
    // Uses the same posted entries and adjusting entries as the statements,
    // and never changes any balance.
    static periodSummary(state, startDate, endDate) {

        let income = 0;
        let expenses = 0;
        let entries = 0;

        this.ledgerEntries(state, true).forEach(entry => {

            if (entry.date < startDate || entry.date > endDate) return;
            if (entry.closing) return;

            entries++;

            entry.lines.forEach(line => {

                const type =
                    line.accountType ||
                    LedgerUtils.accountTypeFor(line.account);

                const debit = Number(line.debit) || 0;
                const credit = Number(line.credit) || 0;

                if (type === "revenue") income += credit - debit;
                if (type === "expense") expenses += debit - credit;
            });
        });

        const round = value => Math.round(value * 100) / 100;

        return {
            income: round(income),
            expenses: round(expenses),
            profit: round(income - expenses),
            entries
        };
    }

    // -----------------------------------------------------
    // ACCOUNT GROUPS (current / non-current, operating / other)
    // A saved choice wins; otherwise the account name decides.
    // -----------------------------------------------------

    static classOf(state, name, type) {

        const key = String(name || "").trim().toLowerCase();

        const saved = state.accountClasses && state.accountClasses.get(key);

        if (saved) return saved;

        const text = String(name || "");

        if (type === "asset") {

            if (/accumulated (depreciation|amortization)/i.test(text)) {
                return "non_current";
            }

            if (/cash|bank|receivable|inventor|suppl|prepaid|merchandise/i
                .test(text)) {
                return "current";
            }

            return /equipment|furniture|vehicle|building|\bland\b|machinery|computer|property|plant|intangible|goodwill|long[- ]term|leasehold|software|patent|franchise|fixture/i
                .test(text) ? "non_current" : "current";
        }

        if (type === "liability") {

            return /long[- ]term|mortgage|bonds?\b/i.test(text)
                ? "non_current" : "current";
        }

        if (type === "revenue") {

            return /other (income|revenue)|interest income|\bgain\b|dividend|rental income/i
                .test(text) ? "other" : "operating";
        }

        if (type === "expense") {

            return /interest (expense|cost)|finance (cost|charge)|loss on|foreign exchange|other expense|^interest$/i
                .test(text) ? "other" : "operating";
        }

        return "operating";
    }

    // Debit-less-credit balance of every account. Closing entries dated
    // inside [windowStart, asOf] are left out (see countsAsOf); anything
    // dated before windowStart is real history and always counts.
    static balancesBetween(state, asOfDate, windowStart) {

        const map = new Map();

        this.ledgerEntries(state, true).forEach(entry => {

            if (entry.date > asOfDate) return;

            if (entry.closing && entry.date >= windowStart) return;

            entry.lines.forEach(line => {

                const name = String(line.account || "").trim();

                if (!name) return;

                const key = name.toLowerCase();

                if (!map.has(key)) {

                    map.set(key, {
                        name,
                        type:
                            line.accountType ||
                            LedgerUtils.accountTypeFor(name),
                        balance: 0
                    });
                }

                map.get(key).balance +=
                    (Number(line.debit) || 0) - (Number(line.credit) || 0);
            });
        });

        return map;
    }

    // -----------------------------------------------------
    // STATEMENT OF CASH FLOWS (indirect method)
    // -----------------------------------------------------

    static cashFlowStatement(state, startDate, endDate) {

        const round = value => {
            const rounded = Math.round(value * 100) / 100;
            return rounded === 0 ? 0 : rounded;
        };

        const statements = this.financialStatements(state, startDate, endDate);

        const start = this.balancesBetween(state, this.dayBefore(startDate), startDate);
        const end = this.balancesBetween(state, endDate, startDate);

        const names = new Set([...start.keys(), ...end.keys()]);

        const changes = [];

        names.forEach(key => {

            const a = end.get(key) || start.get(key);

            const before = start.has(key) ? start.get(key).balance : 0;
            const after = end.has(key) ? end.get(key).balance : 0;

            changes.push({
                name: a.name,
                type: a.type,
                delta: round(after - before),   // debit-positive
                before,
                after
            });
        });

        const isCash = c =>
            c.type === "asset" &&
            /cash|bank/i.test(c.name) &&
            !/accumulated/i.test(c.name);

        const isAccumulated = c =>
            c.type === "asset" &&
            /accumulated (depreciation|amortization)/i.test(c.name);

        const isFinancingDebt = c =>
            c.type === "liability" && (
                this.classOf(state, c.name, "liability") === "non_current" ||
                /loan|notes? payable|mortgage|borrow|bond/i.test(c.name)
            );

        const isDrawing = c => /drawing|withdraw/i.test(c.name);

        const operating = [];
        const investing = [];
        const financing = [];

        const addLine = (list, label, amount) => {
            const value = round(amount);
            if (value !== 0) list.push({ kind: "line", label, amount: value });
        };

        // working capital changes
        const workingCapital = [];

        let depreciation = 0;

        changes.forEach(c => {

            if (c.delta === 0) return;

            if (isCash(c)) return;

            if (c.type === "revenue" || c.type === "expense") return;

            if (isAccumulated(c)) {
                depreciation += -c.delta;
                return;
            }

            if (c.type === "asset") {

                if (this.classOf(state, c.name, "asset") === "non_current") {

                    addLine(
                        investing,
                        c.delta > 0
                            ? `Purchase of ${c.name}`
                            : `Sale of ${c.name}`,
                        -c.delta
                    );

                } else {

                    addLine(
                        workingCapital,
                        c.delta > 0
                            ? `Increase in ${c.name}`
                            : `Decrease in ${c.name}`,
                        -c.delta
                    );
                }

                return;
            }

            if (c.type === "liability") {

                if (isFinancingDebt(c)) {

                    addLine(
                        financing,
                        c.delta < 0
                            ? `Proceeds from ${c.name}`
                            : `Repayment of ${c.name}`,
                        -c.delta
                    );

                } else {

                    addLine(
                        workingCapital,
                        c.delta < 0
                            ? `Increase in ${c.name}`
                            : `Decrease in ${c.name}`,
                        -c.delta
                    );
                }

                return;
            }

            if (c.type === "equity") {

                addLine(
                    financing,
                    isDrawing(c)
                        ? "Owner's drawings"
                        : c.delta < 0
                            ? "Owner's investments"
                            : `Decrease in ${c.name}`,
                    -c.delta
                );
            }
        });

        const sumOf = rows =>
            round(rows.reduce((t, r) => t + r.amount, 0));

        const operatingRows = [
            { kind: "line", label: "Net income", amount: statements.netIncome }
        ];

        const adjustments = [];
        addLine(adjustments, "Depreciation and amortization", depreciation);

        if (adjustments.length) {
            operatingRows.push(
                { kind: "section", label: "Adjustments for non-cash items" },
                ...adjustments
            );
        }

        if (workingCapital.length) {
            operatingRows.push(
                { kind: "section", label: "Changes in working capital" },
                ...workingCapital
            );
        }

        const netOperating = round(
            statements.netIncome + sumOf(adjustments) + sumOf(workingCapital)
        );

        operatingRows.push({
            kind: "total",
            label: "Net cash from operating activities",
            amount: netOperating
        });

        const netInvesting = sumOf(investing);
        const netFinancing = sumOf(financing);

        const beginningCash = round(
            changes.filter(isCash).reduce((t, c) => t + c.before, 0)
        );

        const endingCash = round(
            changes.filter(isCash).reduce((t, c) => t + c.after, 0)
        );

        const netChange = round(netOperating + netInvesting + netFinancing);

        const actualChange = round(endingCash - beginningCash);

        const difference = round(netChange - actualChange);

        const rows = [
            { kind: "section", label: "Operating activities" },
            ...operatingRows,

            { kind: "section", label: "Investing activities" },
            ...(investing.length
                ? investing
                : [{ kind: "line", label: "No investing activity", amount: 0 }]),
            {
                kind: "total",
                label: "Net cash from investing activities",
                amount: netInvesting
            },

            { kind: "section", label: "Financing activities" },
            ...(financing.length
                ? financing
                : [{ kind: "line", label: "No financing activity", amount: 0 }]),
            {
                kind: "total",
                label: "Net cash from financing activities",
                amount: netFinancing
            },

            {
                kind: "total",
                label: "Net increase (decrease) in cash",
                amount: netChange
            },
            { kind: "line", label: "Cash at beginning of period", amount: beginningCash },
            { kind: "grand", label: "Cash at end of period", amount: endingCash }
        ];

        return {
            startDate,
            endDate,
            rows,
            netOperating,
            netInvesting,
            netFinancing,
            netChange,
            beginningCash,
            endingCash,
            difference,
            reconciles: Math.abs(difference) < 0.005
        };
    }

    static dayAfter(dateStr) {

        const d = new Date(dateStr + "T00:00:00Z");

        d.setUTCDate(d.getUTCDate() + 1);

        return d.toISOString().slice(0, 10);
    }

    static dayBefore(dateStr) {

        const d = new Date(dateStr + "T00:00:00Z");

        d.setUTCDate(d.getUTCDate() - 1);

        return d.toISOString().slice(0, 10);
    }

    // -----------------------------------------------------
    // YEAR-END CLOSING
    // Builds the closing entries from the books; nothing is posted here.
    // -----------------------------------------------------

    static closingPlan(state, fyStart, fyEnd) {

        const round = value => Math.round(value * 100) / 100;

        // balances as they stand before this year's closing
        const balances = this.balancesBetween(state, fyEnd, fyEnd);

        const list = [...balances.values()];

        const isDrawing = name => /drawing|withdraw/i.test(name);

        const equity = list.concat(
            LedgerUtils.chart
                .filter(a => a.account_type === "equity" && a.is_active !== false)
                .map(a => ({ name: a.account_name, type: "equity", balance: 0 }))
        ).filter(a => a.type === "equity");

        const unique = (rows) => {
            const seen = new Set();
            return rows.filter(r => {
                const key = r.name.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        };

        const equityAccounts = unique(equity);

        const summary = equityAccounts.find(
            a => /income summary|profit (and|&) loss|expense and revenue summary/i
                .test(a.name)
        );

        const capital =
            equityAccounts.find(a => /capital/i.test(a.name) && !isDrawing(a.name)) ||
            equityAccounts.find(a =>
                !isDrawing(a.name) && a !== summary
            );

        const plan = {
            fyStart,
            fyEnd,
            entries: [],
            netIncome: 0,
            capitalAccount: capital ? capital.name : "",
            summaryAccount: summary ? summary.name : "",
            error: "",
            hasActivity: false
        };

        const revenue = list.filter(a => a.type === "revenue" && round(a.balance) !== 0);
        const expenses = list.filter(a => a.type === "expense" && round(a.balance) !== 0);
        const drawings = list.filter(
            a => a.type === "equity" && isDrawing(a.name) && round(a.balance) !== 0
        );

        plan.hasActivity = revenue.length + expenses.length + drawings.length > 0;

        if (!plan.hasActivity) return plan;

        if (!capital) {
            plan.error =
                "There is no owner's capital account in your Chart of Accounts. Add one (type: Equity) before closing the year.";
            return plan;
        }

        const target = summary ? summary.name : capital.name;

        const line = (account, accountType, amount) => ({
            account,
            accountType,
            debit: amount > 0 ? round(amount) : 0,
            credit: amount < 0 ? round(-amount) : 0
        });

        const totalRevenue = round(revenue.reduce((t, a) => t - a.balance, 0));
        const totalExpenses = round(expenses.reduce((t, a) => t + a.balance, 0));

        plan.netIncome = round(totalRevenue - totalExpenses);

        if (revenue.length) {
            plan.entries.push({
                description: `Close revenue accounts to ${target} — FY ending ${fyEnd}`,
                lines: [
                    // a credit-balance revenue account is debited to close it
                    ...revenue.map(a => line(a.name, "revenue", -a.balance)),
                    line(target, "equity", totalRevenue * -1)
                ]
            });
        }

        if (expenses.length) {
            plan.entries.push({
                description: `Close expense accounts to ${target} — FY ending ${fyEnd}`,
                lines: [
                    line(target, "equity", totalExpenses),
                    ...expenses.map(a => line(a.name, "expense", -a.balance))
                ]
            });
        }

        if (summary && (revenue.length || expenses.length)) {
            plan.entries.push({
                description: `Close ${summary.name} to ${capital.name} — FY ending ${fyEnd}`,
                lines: [
                    line(summary.name, "equity", plan.netIncome),
                    line(capital.name, "equity", -plan.netIncome)
                ]
            });
        }

        if (drawings.length) {
            const totalDrawings = round(drawings.reduce((t, a) => t + a.balance, 0));
            plan.entries.push({
                description: `Close drawings to ${capital.name} — FY ending ${fyEnd}`,
                lines: [
                    line(capital.name, "equity", totalDrawings),
                    ...drawings.map(a => line(a.name, "equity", -a.balance))
                ]
            });
        }

        // drop any entry that ended up empty or zero
        plan.entries = plan.entries.filter(entry =>
            entry.lines.some(l => l.debit > 0 || l.credit > 0)
        );

        return plan;
    }

    // Balances left after the closing entries: only balance sheet accounts.
    static postClosingTrialBalance(state, plan) {

        const round = value => {
            const rounded = Math.round(value * 100) / 100;
            return rounded === 0 ? 0 : rounded;
        };

        const balances = new Map();

        this.balancesBetween(state, plan.fyEnd, plan.fyEnd).forEach((v, k) => {
            balances.set(k, { ...v });
        });

        plan.entries.forEach(entry => entry.lines.forEach(l => {

            const key = l.account.toLowerCase();

            if (!balances.has(key)) {
                balances.set(key, {
                    name: l.account, type: l.accountType, balance: 0
                });
            }

            balances.get(key).balance += l.debit - l.credit;
        }));

        const order = ["asset", "liability", "equity"];

        const rows = [];

        let leftover = 0;

        balances.forEach(a => {

            const value = round(a.balance);

            if (a.type === "revenue" || a.type === "expense") {
                leftover += Math.abs(value);
                return;
            }

            if (value === 0) return;

            rows.push({
                account: a.name,
                accountType: a.type,
                debit: value > 0 ? value : 0,
                credit: value < 0 ? -value : 0
            });
        });

        rows.sort((x, y) =>
            order.indexOf(x.accountType) - order.indexOf(y.accountType) ||
            x.account.localeCompare(y.account)
        );

        const debit = round(rows.reduce((t, r) => t + r.debit, 0));
        const credit = round(rows.reduce((t, r) => t + r.credit, 0));

        return {
            rows,
            debit,
            credit,
            balanced: Math.abs(debit - credit) < 0.005,
            temporaryClosed: round(leftover) === 0
        };
    }


    static financialStatements(state, startDate, endDate) {

        const round = value => {
            const rounded = Math.round(value * 100) / 100;
            return rounded === 0 ? 0 : rounded;
        };

        const isCogs = name =>
            /cost of (goods|sales)/i.test(name);

        const isDrawing = name =>
            /drawing|withdraw/i.test(name);

        // account -> debit/credit totals before the period and within it
        const accounts = new Map();

        this.ledgerEntries(state, true).forEach(entry => {

            if (entry.date > endDate) return;

            const bucket =
                entry.date < startDate ? "before" : "during";

            // closing entries only matter once the period is after them
            if (entry.closing && bucket === "during") return;

            entry.lines.forEach(line => {

                const name = String(line.account || "").trim();

                if (!name) return;

                const key = name.toLowerCase();

                if (!accounts.has(key)) {

                    accounts.set(key, {
                        name,
                        type:
                            line.accountType ||
                            LedgerUtils.accountTypeFor(name),
                        before: { debit: 0, credit: 0 },
                        during: { debit: 0, credit: 0 }
                    });
                }

                const entry = accounts.get(key);

                entry[bucket].debit += Number(line.debit) || 0;
                entry[bucket].credit += Number(line.credit) || 0;
            });
        });

        const list = [...accounts.values()];

        // Balance in the account's normal direction.
        const debitBalance = (a, ...buckets) =>
            buckets.reduce(
                (sum, b) => sum + a[b].debit - a[b].credit, 0
            );

        const creditBalance = (a, ...buckets) =>
            -debitBalance(a, ...buckets);

        const byName = (a, b) => {
            if (/^cash$/i.test(a.label)) return -1;
            if (/^cash$/i.test(b.label)) return 1;
            return a.label.localeCompare(b.label);
        };

        const linesFor = (type, balanceFn, filter = () => true) =>
            list
                .filter(a => a.type === type && filter(a.name, a))
                .map(a => ({
                    label: a.name,
                    amount: round(balanceFn(a))
                }))
                .filter(row => row.amount !== 0)
                .sort(byName);

        const sum = rows =>
            round(rows.reduce((total, row) => total + row.amount, 0));

        // ---------------- Income Statement (period) ----------------
        const classOf = a => this.classOf(state, a.name, a.type);

        const revenue = linesFor(
            "revenue", a => creditBalance(a, "during"),
            (name, a) => classOf(a) !== "other"
        );

        const otherIncome = linesFor(
            "revenue", a => creditBalance(a, "during"),
            (name, a) => classOf(a) === "other"
        );

        const cogs = linesFor(
            "expense",
            a => debitBalance(a, "during"),
            (name, a) => isCogs(name) && classOf(a) !== "other"
        );

        const operating = linesFor(
            "expense",
            a => debitBalance(a, "during"),
            (name, a) => !isCogs(name) && classOf(a) !== "other"
        );

        const otherExpenses = linesFor(
            "expense",
            a => debitBalance(a, "during"),
            (name, a) => classOf(a) === "other"
        );

        const totalRevenue = sum(revenue);
        const totalCogs = sum(cogs);
        const grossProfit = round(totalRevenue - totalCogs);
        const totalOperating = sum(operating);
        const operatingIncome = round(grossProfit - totalOperating);
        const totalOtherIncome = sum(otherIncome);
        const totalOtherExpenses = sum(otherExpenses);
        const netIncome = round(
            operatingIncome + totalOtherIncome - totalOtherExpenses
        );

        const incomeRows = [
            { kind: "section", label: "Revenue" },
            ...revenue.map(r => ({ kind: "line", ...r })),
            { kind: "total", label: "Total revenue", amount: totalRevenue }
        ];

        if (cogs.length) {

            incomeRows.push(
                { kind: "section", label: "Cost of goods sold" },
                ...cogs.map(r => ({ kind: "line", ...r })),
                {
                    kind: "total",
                    label: "Total cost of goods sold",
                    amount: totalCogs
                },
                { kind: "total", label: "Gross profit", amount: grossProfit }
            );
        }

        incomeRows.push(
            { kind: "section", label: "Operating expenses" },
            ...operating.map(r => ({ kind: "line", ...r })),
            {
                kind: "total",
                label: "Total operating expenses",
                amount: totalOperating
            }
        );

        const hasOther = otherIncome.length || otherExpenses.length;

        if (hasOther) {

            incomeRows.push({
                kind: "total",
                label: "Income from operations",
                amount: operatingIncome
            });

            if (otherIncome.length) {
                incomeRows.push(
                    { kind: "section", label: "Other income" },
                    ...otherIncome.map(r => ({ kind: "line", ...r })),
                    {
                        kind: "total",
                        label: "Total other income",
                        amount: totalOtherIncome
                    }
                );
            }

            if (otherExpenses.length) {
                incomeRows.push(
                    { kind: "section", label: "Other expenses" },
                    ...otherExpenses.map(r => ({ kind: "line", ...r })),
                    {
                        kind: "total",
                        label: "Total other expenses",
                        amount: totalOtherExpenses
                    }
                );
            }
        }

        incomeRows.push({
            kind: "grand",
            label: netIncome < 0 ? "Net loss" : "Net income",
            amount: netIncome
        });

        // ---------------- Owner's Equity (period) ------------------
        const capitalAccounts = list.filter(
            a => a.type === "equity" && !isDrawing(a.name)
        );

        const drawingAccounts = list.filter(
            a => a.type === "equity" && isDrawing(a.name)
        );

        // Net income earned before this period (nothing has been closed yet)
        const incomeBefore = round(
            list.filter(a => a.type === "revenue")
                .reduce((t, a) => t + creditBalance(a, "before"), 0)
            - list.filter(a => a.type === "expense")
                .reduce((t, a) => t + debitBalance(a, "before"), 0)
        );

        const capitalBefore = round(
            capitalAccounts.reduce(
                (t, a) => t + creditBalance(a, "before"), 0
            )
        );

        const drawingsBefore = round(
            drawingAccounts.reduce(
                (t, a) => t + debitBalance(a, "before"), 0
            )
        );

        const beginningCapital =
            round(capitalBefore + incomeBefore - drawingsBefore);

        const investments = round(
            capitalAccounts.reduce(
                (t, a) => t + creditBalance(a, "during"), 0
            )
        );

        const drawings = round(
            drawingAccounts.reduce(
                (t, a) => t + debitBalance(a, "during"), 0
            )
        );

        const endingCapital = round(
            beginningCapital + investments + netIncome - drawings
        );

        const equityRows = [
            {
                kind: "line",
                label: "Owner's capital, beginning of period",
                amount: beginningCapital
            },
            {
                kind: "line",
                label: "Add: Owner's investments",
                amount: investments
            },
            {
                kind: "line",
                label: netIncome < 0
                    ? "Less: Net loss for the period"
                    : "Add: Net income for the period",
                amount: netIncome
            },
            {
                kind: "line",
                label: "Less: Owner's drawings",
                amount: -drawings
            },
            {
                kind: "grand",
                label: "Owner's capital, end of period",
                amount: endingCapital
            }
        ];

        // ---------------- Balance Sheet (as of end date) -----------
        const assets = linesFor(
            "asset", a => debitBalance(a, "before", "during")
        );

        const liabilities = linesFor(
            "liability", a => creditBalance(a, "before", "during")
        );

        const classOfName = (row, type) =>
            this.classOf(state, row.label, type);

        const currentAssets =
            assets.filter(r => classOfName(r, "asset") !== "non_current");

        const nonCurrentAssets =
            assets.filter(r => classOfName(r, "asset") === "non_current");

        const currentLiabilities = liabilities.filter(
            r => classOfName(r, "liability") !== "non_current"
        );

        const nonCurrentLiabilities = liabilities.filter(
            r => classOfName(r, "liability") === "non_current"
        );

        const capitalLines = capitalAccounts
            .map(a => ({
                label: a.name,
                amount: round(creditBalance(a, "before", "during"))
            }))
            .filter(row => row.amount !== 0);

        const incomeToDate = round(incomeBefore + netIncome);

        const drawingsToDate = round(drawingsBefore + drawings);

        const totalAssets = sum(assets);
        const totalLiabilities = sum(liabilities);

        const totalEquity = round(
            sum(capitalLines) + incomeToDate - drawingsToDate
        );

        const totalLiabilitiesAndEquity =
            round(totalLiabilities + totalEquity);

        const difference =
            round(totalAssets - totalLiabilitiesAndEquity);

        const group = (title, rows, totalLabel) => rows.length ? [
            { kind: "subsection", label: title },
            ...rows.map(r => ({ kind: "line", ...r })),
            { kind: "total", label: totalLabel, amount: sum(rows) }
        ] : [];

        const balanceRows = [
            { kind: "section", label: "Assets" },
            ...group("Current assets", currentAssets, "Total current assets"),
            ...group(
                "Non-current assets", nonCurrentAssets,
                "Total non-current assets"
            ),
            { kind: "total", label: "Total assets", amount: totalAssets },

            { kind: "section", label: "Liabilities" },
            ...group(
                "Current liabilities", currentLiabilities,
                "Total current liabilities"
            ),
            ...group(
                "Non-current liabilities", nonCurrentLiabilities,
                "Total non-current liabilities"
            ),
            {
                kind: "total",
                label: "Total liabilities",
                amount: totalLiabilities
            },

            { kind: "section", label: "Owner's equity" },
            ...capitalLines.map(r => ({ kind: "line", ...r })),
            {
                kind: "line",
                label: incomeToDate < 0
                    ? "Net loss to date"
                    : "Net income to date",
                amount: incomeToDate
            },
            {
                kind: "line",
                label: "Less: Owner's drawings to date",
                amount: -drawingsToDate
            },
            {
                kind: "total",
                label: "Total owner's equity",
                amount: totalEquity
            },

            {
                kind: "grand",
                label: "Total liabilities and owner's equity",
                amount: totalLiabilitiesAndEquity
            }
        ];

        return {
            startDate,
            endDate,
            incomeRows,
            equityRows,
            balanceRows,
            netIncome,
            grossProfit,
            operatingIncome,
            totalOtherIncome,
            totalOtherExpenses,
            totalCurrentAssets: sum(currentAssets),
            totalCurrentLiabilities: sum(currentLiabilities),
            totalAssets,
            totalLiabilities,
            totalEquity,
            endingCapital,
            difference,
            isBalanced: Math.abs(difference) < 0.005,
            hasData: list.length > 0
        };
    }


    // -----------------------------------------------------
    // ADJUSTED TRIAL BALANCE
    // Unadjusted balances + adjusting entries = adjusted balances.
    // -----------------------------------------------------

    static adjustedTrialBalance(state, asOfDate = LedgerUtils.today()) {

        const round = value => {
            const rounded = Math.round(value * 100) / 100;
            return rounded === 0 ? 0 : rounded;
        };

        const accounts = new Map();

        this.ledgerEntries(state, true).forEach(entry => {

            if (entry.date > asOfDate) return;
            if (!this.countsAsOf(entry, asOfDate)) return;

            entry.lines.forEach(line => {

                const name = String(line.account || "").trim();

                if (!name) return;

                const key = name.toLowerCase();

                if (!accounts.has(key)) {

                    accounts.set(key, {
                        account: name,
                        accountType:
                            line.accountType ||
                            LedgerUtils.accountTypeFor(name),
                        un: { debit: 0, credit: 0 },
                        adj: { debit: 0, credit: 0 }
                    });
                }

                // a closed year's closing entries are part of the opening
                // position of later dates, not adjustments
                const bucket = accounts.get(key)[
                    entry.adjusting && !entry.closing ? "adj" : "un"
                ];

                bucket.debit += Number(line.debit) || 0;
                bucket.credit += Number(line.credit) || 0;
            });
        });

        const side = balance => ({
            debit: balance > 0 ? round(balance) : 0,
            credit: balance < 0 ? round(-balance) : 0
        });

        const rows = [];

        accounts.forEach(a => {

            const un = side(a.un.debit - a.un.credit);

            const adj = {
                debit: round(a.adj.debit),
                credit: round(a.adj.credit)
            };

            const final = side(
                (a.un.debit + a.adj.debit) -
                (a.un.credit + a.adj.credit)
            );

            const empty =
                un.debit + un.credit + adj.debit + adj.credit +
                final.debit + final.credit === 0;

            if (empty) return;

            rows.push({
                account: a.account,
                accountType: a.accountType,
                unDebit: un.debit,
                unCredit: un.credit,
                adjDebit: adj.debit,
                adjCredit: adj.credit,
                finalDebit: final.debit,
                finalCredit: final.credit
            });
        });

        const typeOrder =
            ["asset", "liability", "equity", "revenue", "expense"];

        rows.sort((a, b) => {

            const order =
                typeOrder.indexOf(a.accountType) -
                typeOrder.indexOf(b.accountType);

            return order || a.account.localeCompare(b.account);
        });

        const total = key =>
            round(rows.reduce((sum, row) => sum + row[key], 0));

        const totals = {
            unDebit: total("unDebit"),
            unCredit: total("unCredit"),
            adjDebit: total("adjDebit"),
            adjCredit: total("adjCredit"),
            finalDebit: total("finalDebit"),
            finalCredit: total("finalCredit")
        };

        const balanced = (d, c) => Math.abs(d - c) < 0.005;

        return {
            asOfDate,
            rows,
            totals,
            unBalanced: balanced(totals.unDebit, totals.unCredit),
            adjBalanced: balanced(totals.adjDebit, totals.adjCredit),
            finalBalanced: balanced(totals.finalDebit, totals.finalCredit),
            hasRows: rows.length > 0,
            adjustmentCount: state.adjustments.filter(
                entry => entry.date && entry.date <= asOfDate &&
                    !this.isClosingType(entry.type)
            ).length
        };
    }


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
                    LedgerUtils.isInflow(transaction.type)
                        ? "positive"
                        : "negative"
                }">

                    ${LedgerUtils.isInflow(transaction.type) ? "+" : "−"}

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
                            data-goto="transactions"
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

            <div class="card journal-card" id="journal-${id}">


                <div class="card-head">

                    <div style="width:100%">

                        <p class="eyebrow">
                            TRANSACTION #${id}
                        </p>

                        ${
                            transaction.type === "sale" && lines.length > 2
                                ? `<p class="tiny muted">
                                    The first two lines record the money
                                    received from the sale. The last two
                                    move the goods out of inventory at
                                    what they cost you (Cost of Goods Sold).
                                </p>`
                                : transaction.type === "purchase"
                                    ? `<p class="tiny muted">
                                        Buying goods to resell adds to
                                        Inventory, an asset. It is not an
                                        expense until the goods are sold.
                                    </p>`
                                    : ""
                        }


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


                    <div>

                        <button
                            class="btn danger small"
                            data-delete-transaction="${id}"
                        >
                            DELETE TRANSACTION
                        </button>

                        <button
                            class="btn primary small"
                            data-save-journal="${id}"
                        >
                            SAVE EDITS
                        </button>

                    </div>

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
    // TRIAL BALANCE
    // =====================================================

    // -----------------------------------------------------
    // ADJUSTING ENTRIES
    // -----------------------------------------------------

    adjustingEntries() {

        const entries = [...this.state.adjustments].sort(
            (a, b) => b.date.localeCompare(a.date)
        );

        const typeOptions = Object.entries(LedgerUtils.ADJUSTMENT_TYPES)
            .map(([value, config]) => `
                <option value="${value}">
                    ${LedgerUtils.escape(config.label)}
                </option>
            `).join("");

        const accountOptions = LedgerUtils.chart
            .filter(account => account.is_active)
            .map(account => `
                <option value="${LedgerUtils.escape(account.account_name)}">
            `).join("");

        const rows = entries.length
            ? entries.map(entry => {

                const total = entry.lines.reduce(
                    (sum, line) => sum + line.debit, 0
                );

                const lines = entry.lines.map(line =>
                    line.debit > 0
                        ? `Dr ${LedgerUtils.escape(line.account)}`
                        : `&nbsp;&nbsp;&nbsp;Cr ${LedgerUtils.escape(line.account)}`
                ).join("<br>");

                return `
                    <tr>
                        <td>${LedgerUtils.escape(entry.date)}</td>
                        <td>
                            ${LedgerUtils.escape(
                                LedgerUtils.ADJUSTMENT_TYPES[entry.type]?.label ||
                                entry.type
                            )}
                        </td>
                        <td>
                            <strong>${LedgerUtils.escape(entry.description)}</strong>
                            <div class="tiny muted">${lines}</div>
                        </td>
                        <td class="amount">${LedgerUtils.peso(total)}</td>
                        <td>
                            <button
                                class="btn danger small"
                                type="button"
                                data-delete-adjustment="${LedgerUtils.escape(entry.id)}"
                            >
                                Delete
                            </button>
                        </td>
                    </tr>
                `;
            }).join("")
            : `
                <tr>
                    <td colspan="5">
                        <div class="empty-state">
                            No adjusting entries yet.
                        </div>
                    </td>
                </tr>
            `;

        return `

            ${this.heading(
                "Adjusting Entries",
                "Record period-end adjustments so your income and balances reflect what really happened, not just what was paid."
            )}

            <div class="info-box" style="margin-bottom:16px">

                <strong>Why adjust?</strong>

                Some changes are not triggered by a payment, such as
                equipment wearing out, supplies being used up, or wages
                owed but not yet paid. Record them here at the end of the
                period. They appear in the General Ledger, the Adjusted
                Trial Balance and the Financial Statements.

            </div>

            <div class="card" style="margin-bottom:16px">

                <form id="adjustmentForm">

                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">

                        <label>
                            Adjustment type
                            <select id="adjType">${typeOptions}</select>
                        </label>

                        <label>
                            Date
                            <input
                                type="date"
                                id="adjDate"
                                value="${LedgerUtils.today()}"
                                max="${LedgerUtils.today()}"
                                required
                            >
                        </label>

                        <p
                            class="form-note"
                            id="adjHelp"
                            style="grid-column:1/-1;margin:0"
                        ></p>

                        <label style="grid-column:1/-1">
                            Description
                            <input
                                id="adjDescription"
                                type="text"
                                maxlength="100"
                                required
                            >
                        </label>

                        <label>
                            Debit account
                            <input
                                id="adjDebit"
                                type="text"
                                list="adjAccountList"
                                autocomplete="off"
                                required
                            >
                        </label>

                        <label>
                            Credit account
                            <input
                                id="adjCredit"
                                type="text"
                                list="adjAccountList"
                                autocomplete="off"
                                required
                            >
                        </label>

                        <label>
                            Amount (₱)
                            <input
                                id="adjAmount"
                                type="number"
                                min="0.01"
                                step="0.01"
                                placeholder="0.00"
                                required
                            >
                        </label>

                    </div>

                    <datalist id="adjAccountList">${accountOptions}</datalist>

                    <p class="form-note" id="adjHint"></p>

                    <button type="submit" class="btn primary">
                        Record adjusting entry
                    </button>

                </form>

            </div>

            <div class="card table-card">

                <div class="card-head">
                    <h3>Recorded adjustments</h3>
                    <span class="tiny muted">${entries.length} record(s)</span>
                </div>

                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>DATE</th>
                                <th>TYPE</th>
                                <th>ENTRY</th>
                                <th>AMOUNT</th>
                                <th>ACTION</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>

            </div>

        `;
    }


    // -----------------------------------------------------
    // ADJUSTED TRIAL BALANCE
    // -----------------------------------------------------

    adjustedTrialBalance() {

        const asOfDate =
            this.state.adjustedTbDate || LedgerUtils.today();

        const report =
            LedgerAccounting.adjustedTrialBalance(this.state, asOfDate);

        const cell = amount =>
            amount > 0 ? LedgerUtils.peso(amount) : "";

        const allBalanced =
            report.unBalanced && report.adjBalanced && report.finalBalanced;

        const statusClass = !report.hasRows
            ? ""
            : allBalanced ? "positive" : "negative";

        const t = report.totals;

        return `

            ${this.heading(
                "Adjusted Trial Balance",
                "Unadjusted balances, plus your adjusting entries, equals the adjusted balances used for the financial statements.",
                `
                    <button
                        class="btn secondary"
                        id="exportAdjustedTb"
                        type="button"
                    >
                        ↓ Export CSV
                    </button>
                `
            )}

            <div class="card trial-balance-filter">

                <label for="adjustedTbDate">
                    <span class="trial-balance-filter-label">
                        REPORTING DATE
                    </span>
                    <input
                        type="date"
                        id="adjustedTbDate"
                        value="${LedgerUtils.escape(asOfDate)}"
                        max="${LedgerUtils.today()}"
                    >
                </label>

                <div class="trial-balance-date-note">
                    Showing balances up to
                    <strong>${LedgerUtils.escape(asOfDate)}</strong>
                    with ${report.adjustmentCount} adjusting
                    entr${report.adjustmentCount === 1 ? "y" : "ies"}.
                    Transactions marked NEEDS REVIEW are excluded.
                </div>

            </div>

            <div class="card" style="margin-top:16px">

                <p class="eyebrow">BALANCE VERIFICATION</p>

                <h3 class="${statusClass}">
                    ${
                        !report.hasRows
                            ? "NO DATA"
                            : allBalanced
                                ? "ALL THREE COLUMN PAIRS BALANCE"
                                : "OUT OF BALANCE"
                    }
                </h3>

                <p class="tiny muted">
                    ${
                        report.hasRows && !report.adjustmentCount
                            ? "No adjusting entries recorded for this date yet, so the adjusted balances equal the unadjusted ones. Record them on the Adjusting Entries page."
                            : report.hasRows && !allBalanced
                                ? "Debits and credits do not match in at least one column pair. Review your journal and adjusting entries."
                                : "Total debits equal total credits in the unadjusted, adjustment and adjusted columns."
                    }
                </p>

            </div>

            <div class="card table-card" style="margin-top:16px">

                <div class="table-wrap">

                    <table>

                        <thead>
                            <tr>
                                <th rowspan="2">ACCOUNT</th>
                                <th rowspan="2">TYPE</th>
                                <th colspan="2" style="text-align:center">UNADJUSTED</th>
                                <th colspan="2" style="text-align:center">ADJUSTMENTS</th>
                                <th colspan="2" style="text-align:center">ADJUSTED</th>
                            </tr>
                            <tr>
                                <th>DEBIT</th><th>CREDIT</th>
                                <th>DEBIT</th><th>CREDIT</th>
                                <th>DEBIT</th><th>CREDIT</th>
                            </tr>
                        </thead>

                        <tbody>
                            ${
                                report.rows.length
                                    ? report.rows.map(row => `
                                        <tr>
                                            <td><strong>${LedgerUtils.escape(row.account)}</strong></td>
                                            <td>${LedgerUtils.escape(row.accountType.toUpperCase())}</td>
                                            <td class="amount">${cell(row.unDebit)}</td>
                                            <td class="amount">${cell(row.unCredit)}</td>
                                            <td class="amount">${cell(row.adjDebit)}</td>
                                            <td class="amount">${cell(row.adjCredit)}</td>
                                            <td class="amount">${cell(row.finalDebit)}</td>
                                            <td class="amount">${cell(row.finalCredit)}</td>
                                        </tr>
                                    `).join("")
                                    : `
                                        <tr>
                                            <td colspan="8">
                                                <div class="empty-state">
                                                    No posted account balances were found for the selected date.
                                                </div>
                                            </td>
                                        </tr>
                                    `
                            }
                        </tbody>

                        <tfoot>
                            <tr style="font-weight:700">
                                <td colspan="2">TOTAL</td>
                                <td class="amount">${LedgerUtils.peso(t.unDebit)}</td>
                                <td class="amount">${LedgerUtils.peso(t.unCredit)}</td>
                                <td class="amount">${LedgerUtils.peso(t.adjDebit)}</td>
                                <td class="amount">${LedgerUtils.peso(t.adjCredit)}</td>
                                <td class="amount">${LedgerUtils.peso(t.finalDebit)}</td>
                                <td class="amount">${LedgerUtils.peso(t.finalCredit)}</td>
                            </tr>
                        </tfoot>

                    </table>

                </div>

            </div>

        `;
    }


    // -----------------------------------------------------
    // FINANCIAL STATEMENTS
    // -----------------------------------------------------

    statementTable(rows) {

        const border = "1px solid rgba(128,128,128,.45)";

        return `
            <div class="table-wrap">
                <table>
                    <tbody>
                        ${rows.map(row => {

                            const label = LedgerUtils.escape(row.label);

                            if (row.kind === "section") {
                                return `
                                    <tr>
                                        <td colspan="2"
                                            style="font-weight:700;padding-top:14px">
                                            ${label}
                                        </td>
                                    </tr>`;
                            }

                            if (row.kind === "subsection") {
                                return `
                                    <tr>
                                        <td colspan="2"
                                            style="font-weight:600;padding-top:8px;padding-left:14px;font-style:italic">
                                            ${label}
                                        </td>
                                    </tr>`;
                            }

                            const amount = LedgerUtils.peso(row.amount);

                            const style = {
                                line: "",
                                total: `font-weight:600;border-top:${border};`,
                                grand: `font-weight:700;border-top:${border};` +
                                       `border-bottom:3px double rgba(128,128,128,.6);`
                            }[row.kind];

                            return `
                                <tr style="${style}">
                                    <td style="${
                                        row.kind === "line"
                                            ? "padding-left:28px"
                                            : ""
                                    }">
                                        ${label}
                                    </td>
                                    <td class="amount"
                                        style="text-align:right">
                                        ${amount}
                                    </td>
                                </tr>`;
                        }).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    financialStatements() {

        const start = this.state.statementStart;
        const end = this.state.statementEnd;

        const report = LedgerAccounting.financialStatements(
            this.state, start, end
        );

        const cash = LedgerAccounting.cashFlowStatement(
            this.state, start, end
        );

        const period =
            `${LedgerUtils.escape(start)} to ${LedgerUtils.escape(end)}`;

        const statusClass = report.isBalanced ? "positive" : "negative";

        // No final statements from an unbalanced trial balance.
        const trial = LedgerAccounting.adjustedTrialBalance(this.state, end);

        const blocked = trial.hasRows && !trial.finalBalanced;

        return `

            ${this.heading(
                "Financial Statements",
                "Income Statement, Statement of Owner's Equity, Balance Sheet and Statement of Cash Flows, prepared from your posted journal entries.",
                `
                    <button
                        class="btn secondary"
                        data-act="save-report"
                        type="button"
                    >
                        Save report
                    </button>
                    <button
                        class="btn secondary"
                        id="exportStatements"
                        type="button"
                    >
                        ↓ Export CSV
                    </button>
                `
            )}


            <div class="card trial-balance-filter">

                <label for="statementStart">
                    <span class="trial-balance-filter-label">
                        PERIOD START
                    </span>
                    <input
                        type="date"
                        id="statementStart"
                        value="${LedgerUtils.escape(start)}"
                        max="${LedgerUtils.escape(end)}"
                    >
                </label>

                <label for="statementEnd">
                    <span class="trial-balance-filter-label">
                        PERIOD END / BALANCE SHEET DATE
                    </span>
                    <input
                        type="date"
                        id="statementEnd"
                        value="${LedgerUtils.escape(end)}"
                        min="${LedgerUtils.escape(start)}"
                        max="${LedgerUtils.today()}"
                    >
                </label>

                <div class="trial-balance-date-note">
                    The Income Statement and Owner's Equity cover
                    <strong>${period}</strong>.
                    The Balance Sheet shows balances at the end date.
                    These statements include your adjusting entries.
                    Transactions marked NEEDS REVIEW are excluded.
                </div>

            </div>


            ${blocked ? `
            <div class="card" style="margin-top:16px">
                <p class="eyebrow">STATEMENTS NOT AVAILABLE</p>
                <h3 class="negative">THE ADJUSTED TRIAL BALANCE DOES NOT BALANCE</h3>
                <p class="tiny muted">
                    Total debits and credits differ, so final financial
                    statements cannot be shown yet. Review your journal
                    entries and adjusting entries, then come back. You can
                    inspect the balances on the Adjusted Trial Balance page.
                </p>
            </div>
            ` : `
            <div class="grid metric-grid">

                ${this.metric(
                    report.netIncome < 0 ? "NET LOSS" : "NET INCOME",
                    LedgerUtils.peso(report.netIncome),
                    "For the selected period",
                    "↗"
                )}

                ${this.metric(
                    "TOTAL ASSETS",
                    LedgerUtils.peso(report.totalAssets),
                    "At the end date",
                    "▥"
                )}

                ${this.metric(
                    "OWNER'S EQUITY",
                    LedgerUtils.peso(report.totalEquity),
                    "At the end date",
                    "＝"
                )}

            </div>


            <div class="card" style="margin-top:16px">

                <p class="eyebrow">BALANCE CHECK</p>

                <h3 class="${statusClass}">
                    ${
                        !report.hasData
                            ? "NO DATA FOR THIS PERIOD"
                            : report.isBalanced
                                ? "ASSETS = LIABILITIES + OWNER'S EQUITY"
                                : "BALANCE SHEET DOES NOT BALANCE"
                    }
                </h3>

                <p class="tiny muted">
                    ${
                        report.hasData && !report.isBalanced
                            ? `Difference: ${LedgerUtils.peso(report.difference)}. Check your journal entries on the Journal Entries page.`
                            : "Total assets equal total liabilities plus owner's equity."
                    }
                </p>

            </div>


            <div class="card table-card" style="margin-top:16px">
                <div class="card-head">
                    <h3>Income Statement</h3>
                    <span class="tiny muted">For the period ${period}</span>
                </div>
                ${this.statementTable(report.incomeRows)}
            </div>


            <div class="card table-card" style="margin-top:16px">
                <div class="card-head">
                    <h3>Statement of Owner's Equity</h3>
                    <span class="tiny muted">For the period ${period}</span>
                </div>
                ${this.statementTable(report.equityRows)}
            </div>


            <div class="card table-card" style="margin-top:16px">
                <div class="card-head">
                    <h3>Balance Sheet</h3>
                    <span class="tiny muted">As of ${LedgerUtils.escape(end)}</span>
                </div>
                ${this.statementTable(report.balanceRows)}
            </div>


            <div class="card table-card" style="margin-top:16px">
                <div class="card-head">
                    <h3>Statement of Cash Flows</h3>
                    <span class="tiny muted">
                        Indirect method · For the period ${period}
                    </span>
                </div>
                ${this.statementTable(cash.rows)}
                <p class="tiny ${cash.reconciles ? "positive" : "negative"}"
                   style="padding:8px 16px">
                    ${cash.reconciles
                        ? "Cash at end of period agrees with the cash and bank accounts on the Balance Sheet."
                        : `The cash flow does not agree with your cash accounts (difference ${LedgerUtils.peso(cash.difference)}). Check the account groups below.`}
                </p>
            </div>
            `}

            ${this.accountGroupsPanel()}

            ${this.savedReportsPanel()}

        `;
    }

    // -----------------------------------------------------
    // YEAR-END CLOSING
    // -----------------------------------------------------

    closingEntriesTable(entries) {

        if (!entries.length) {
            return `<p class="tiny muted">There is nothing to close for this year.</p>`;
        }

        return `
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr><th>Account</th>
                            <th style="text-align:right">Debit</th>
                            <th style="text-align:right">Credit</th></tr>
                    </thead>
                    <tbody>
                        ${entries.map(entry => `
                            <tr><td colspan="3" style="font-weight:600;padding-top:12px">
                                ${LedgerUtils.escape(entry.description)}
                            </td></tr>
                            ${entry.lines.filter(l => l.debit || l.credit).map(l => `
                                <tr>
                                    <td style="${l.credit ? "padding-left:32px" : "padding-left:12px"}">
                                        ${LedgerUtils.escape(l.account)}
                                    </td>
                                    <td class="amount" style="text-align:right">
                                        ${l.debit ? LedgerUtils.peso(l.debit) : ""}
                                    </td>
                                    <td class="amount" style="text-align:right">
                                        ${l.credit ? LedgerUtils.peso(l.credit) : ""}
                                    </td>
                                </tr>`).join("")}
                        `).join("")}
                    </tbody>
                </table>
            </div>`;
    }

    // -----------------------------------------------------
    // PERIOD-END GUIDE: one page that shows the order of the steps
    // -----------------------------------------------------

    periodEnd() {

        const state = this.state;
        const e = LedgerUtils.escape;
        const period = state.getReportingPeriod();

        const head = this.heading(
            "Period-End Guide",
            "Follow these steps in order to finish a reporting period. Ledger shows where you are."
        );

        if (!period) {
            return head + `
                <div class="card">
                    <p>Choose how often you report first.
                        <button class="btn secondary" type="button"
                            data-goto="reportingPeriods">Reporting Periods</button>
                    </p>
                </div>`;
        }

        const today = LedgerUtils.today();
        const asOf = period.end > today ? today : period.end;

        const waiting = state.proposals.filter(p =>
            p.periodId === period.id &&
            ["pending", "revise_needed"].includes(p.status)
        ).length;

        const atb = LedgerAccounting.adjustedTrialBalance(state, asOf);

        const yearPeriods = state.reporting.periods.filter(
            p => p.fiscalYearStart === period.fiscalYearStart
        );

        const lastOfYear = yearPeriods.reduce(
            (a, b) => (b.end > a.end ? b : a), yearPeriods[0] || period
        );

        const isLast = lastOfYear.id === period.id;
        const yearClosed =
            state.getYearClosing(period.fiscalYearStart)?.status === "complete";

        const reconDone = period.reconciliation === "complete";

        const steps = [
            {
                title: "Reconcile your records",
                text: "Count inventory and supplies, review fixed assets and record unpaid expenses.",
                state: reconDone ? "done" : period.reconciliation === "in_progress" ? "doing" : "todo",
                note: reconDone ? "Reconciliation is complete." : "Not finished yet.",
                button: ["Open Reconciliation", `data-goto="reconciliation"`]
            },
            {
                title: "Approve the proposed adjustments",
                text: "Each adjustment Ledger proposes must be approved or rejected before you continue.",
                state: !reconDone ? "todo" : waiting ? "doing" : "done",
                note: waiting ? `${waiting} waiting for your decision.` : reconDone ? "Nothing is waiting." : "Appears after the reconciliation.",
                button: ["Open Adjustment Review", `data-goto="adjustmentReview"`]
            },
            {
                title: "Check the adjusted trial balance",
                text: "Total debits must equal total credits.",
                state: !atb.hasRows ? "todo" : atb.finalBalanced ? "done" : "problem",
                note: !atb.hasRows ? "No entries yet." : atb.finalBalanced ? "It balances." : "It does NOT balance. Fix this before the statements.",
                button: ["Open Adjusted Trial Balance", `data-goto="adjustedTrialBalance"`]
            },
            {
                title: "Review and save the financial statements",
                text: "Income statement, owner's equity, balance sheet and cash flows. Save a copy to keep.",
                state: period.statements === "complete" ? "done" : "todo",
                note: period.statements === "complete" ? "A copy is saved." : "Not saved yet.",
                button: ["Open Financial Statements", `data-act="guide-statements"`]
            },
            {
                title: "Close the year",
                text: isLast
                    ? "This is the last period of the fiscal year, so you can close the year."
                    : `Year-end closing happens after ${lastOfYear.label}.`,
                state: yearClosed ? "done" : !isLast ? "na" : "todo",
                note: yearClosed ? "The year is closed." : !isLast ? "Not needed for this period." : "Not closed yet.",
                button: isLast || yearClosed
                    ? ["Open Year-End Closing", `data-goto="yearEndClosing"`] : null
            }
        ];

        const counted = steps.filter(x => x.state !== "na");
        const done = counted.filter(x => x.state === "done").length;
        const percent = Math.round(done / counted.length * 100);
        const nextIndex = steps.findIndex(x => ["todo", "doing", "problem"].includes(x.state));

        const badge = {
            done: ["✓ Done", "positive"],
            doing: ["In progress", ""],
            todo: ["To do", "muted"],
            problem: ["Needs attention", "negative"],
            na: ["Not needed", "muted"]
        };

        return `
            ${head}
            <div class="card trial-balance-filter">
                <label for="guidePeriodSelect">
                    <span class="trial-balance-filter-label">REPORTING PERIOD</span>
                    <select id="guidePeriodSelect">
                        ${[...state.reporting.periods].reverse().map(p => `
                            <option value="${e(p.start)}" ${p.start === period.start ? "selected" : ""}>
                                ${e(p.label)} (${e(p.start)} to ${e(p.end)})
                            </option>`).join("")}
                    </select>
                </label>
                <div class="trial-balance-date-note">
                    <strong>${done} of ${counted.length} steps done</strong>
                    <div style="height:8px;border-radius:4px;background:rgba(128,128,128,.25);margin-top:6px;overflow:hidden">
                        <div style="height:100%;width:${percent}%;background:currentColor;opacity:.7"></div>
                    </div>
                </div>
            </div>
            ${steps.map((step, i) => `
                <div class="card" style="margin-top:12px;${i === nextIndex ? "outline:2px solid currentColor;" : ""}${step.state === "na" ? "opacity:.6;" : ""}">
                    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
                        <h3 style="margin:0">${i + 1}. ${step.title}</h3>
                        <strong class="${badge[step.state][1]}">${badge[step.state][0]}</strong>
                    </div>
                    <p class="tiny muted" style="margin:6px 0">${step.text}</p>
                    <p class="tiny">${e(step.note)}</p>
                    ${step.button ? `
                    <button class="btn ${i === nextIndex ? "" : "secondary"}" type="button" ${step.button[1]}>
                        ${i === nextIndex ? "Next: " : ""}${step.button[0]}
                    </button>` : ""}
                </div>`).join("")}
        `;
    }

    auditTrail() {

        const e = LedgerUtils.escape;
        const events = this.state.auditEvents;

        const names = {
            adjustment_approved: "Adjustment approved and posted",
            adjustment_rejected: "Adjustment rejected",
            adjustment_flagged: "Adjustment sent back for revision",
            adjustment_revised: "Adjustment revised",
            reconciliation_completed: "Reconciliation completed",
            reporting_settings_changed: "Reporting settings changed",
            report_saved: "Financial statements saved",
            account_classes_updated: "Account groups changed",
            year_closed: "Fiscal year closed",
            year_reopened: "Fiscal year reopened"
        };

        const detail = d => {
            const x = d || {};
            return [
                x.description, x.label, x.title,
                x.frequency && `${x.frequency}, fiscal year starts month ${x.fiscal_start_month}`,
                x.fiscal_year_start && `FY ${x.fiscal_year_start}`,
                x.reason && `Reason: ${x.reason}`,
                x.note && `Note: ${x.note}`,
                x.net_income != null && `Net income ${LedgerUtils.peso(x.net_income)}`
            ].filter(Boolean).join(" · ");
        };

        return `
            ${this.heading(
                "Audit Trail",
                "A permanent record of approvals, reconciliations, saved reports and year-end closings. It cannot be edited or deleted."
            )}
            <div class="card table-card" id="auditList">
                ${events === null ? `<p class="muted" style="padding:16px">Loading…</p>`
                : !events.length ? `<p class="muted" style="padding:16px">Nothing has been recorded yet.</p>` : `
                <div class="table-wrap"><table>
                    <thead><tr><th>When</th><th>What happened</th><th>Details</th></tr></thead>
                    <tbody>
                        ${events.map(ev => `<tr>
                            <td class="tiny">${e(String(ev.created_at).slice(0, 16).replace("T", " "))}</td>
                            <td>${e(names[ev.event_type] || ev.event_type)}</td>
                            <td class="tiny muted">${e(detail(ev.details))}</td>
                        </tr>`).join("")}
                    </tbody></table></div>`}
            </div>`;
    }

    yearEndClosing() {

        const state = this.state;
        const c = state.closing;
        const fy = state.getClosingYear();

        const head = this.heading(
            "Year-End Closing",
            "Finish the year step by step: check, adjust, report, close the books and carry balances forward."
        );

        if (!fy) {
            return `${head}
                <div class="card">
                    <p>No reporting periods exist yet. Open
                    <button class="btn ghost small" type="button"
                        data-goto="reportingPeriods">Reporting Periods</button>
                    first so a fiscal year can be created.</p>
                </div>`;
        }

        const closing = state.getYearClosing(fy.start);
        const closed = !!closing && closing.status === "complete";
        const today = LedgerUtils.today();
        const step = c.step;
        const e = LedgerUtils.escape;

        const stepNames = [
            "Final checks", "Final adjustments", "Adjusted trial balance",
            "Annual statements", "Closing entries", "Opening balances"
        ];

        const stepper = `
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin:16px 0">
                ${stepNames.map((name, i) => `
                    <button type="button"
                        class="btn ${step === i + 1 ? "" : "secondary"} small"
                        data-act="close-step" data-step="${i + 1}">
                        ${i + 1}. ${name}
                    </button>`).join("")}
            </div>`;

        const yearSelect = `
            <div class="card trial-balance-filter">
                <label for="closingYearSelect">
                    <span class="trial-balance-filter-label">FISCAL YEAR</span>
                    <select id="closingYearSelect">
                        ${c.years.map(y => `
                            <option value="${e(y.start)}"
                                ${y.start === fy.start ? "selected" : ""}>
                                ${e(y.start)} to ${e(y.end)}
                                ${state.getYearClosing(y.start)?.status === "complete" ? " (closed)" : ""}
                            </option>`).join("")}
                    </select>
                </label>
                <div class="trial-balance-date-note">
                    Status:
                    <strong class="${closed ? "positive" : ""}">
                        ${closed ? "CLOSED" : fy.end > today ? "IN PROGRESS (year not over)" : "OPEN"}
                    </strong>
                </div>
            </div>`;

        const asOf = fy.end;
        const stmtEnd = fy.end > today ? today : fy.end;

        let body = "";

        if (step === 1) {

            const checks = c.checks;

            body = checks === null ? `
                <p id="closingNeedsChecks" class="muted">Running checks…</p>`
            : checks.error ? `
                <p class="negative">${e(checks.error)}</p>` : `
                <ul style="list-style:none;padding:0;margin:0">
                    ${checks.checks.map(k => `
                        <li style="padding:6px 0">
                            <strong class="${k.ok ? "positive" : "negative"}">
                                ${k.ok ? "✓" : "✗"}
                            </strong>
                            ${e(k.message)}
                        </li>`).join("")}
                </ul>
                ${checks.warnings.map(w => `
                    <p class="tiny" style="margin-top:8px">⚠ ${e(w)}</p>`).join("")}
                <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn secondary" type="button" data-act="close-recheck">Re-check</button>
                    <button class="btn ghost small" type="button" data-goto="reconciliation">Reconciliation</button>
                    <button class="btn ghost small" type="button" data-goto="adjustmentReview">Adjustment Review</button>
                    <button class="btn ghost small" type="button" data-goto="transactions">Transactions</button>
                </div>`;

        } else if (step === 2) {

            const waiting = state.proposals.filter(p =>
                ["pending", "revise_needed"].includes(p.status) &&
                p.entryDate >= fy.start && p.entryDate <= fy.end
            );

            const approved = state.adjustments.filter(a =>
                !LedgerAccounting.isClosingType(a.type) &&
                a.date >= fy.start && a.date <= fy.end
            );

            body = `
                <p>${approved.length} adjusting ${approved.length === 1 ? "entry is" : "entries are"}
                   posted for this year.</p>
                <p class="${waiting.length ? "negative" : "positive"}">
                    ${waiting.length
                        ? `${waiting.length} proposed adjustment(s) still need approval or rejection.`
                        : "No proposed adjustments are waiting."}
                </p>
                ${waiting.map(p => `
                    <p class="tiny">• ${e(p.description)} (${e(p.status.replace("_", " "))})</p>`).join("")}
                <p style="margin-top:12px">
                    <button class="btn secondary" type="button" data-goto="adjustmentReview">
                        Open Adjustment Review
                    </button>
                    <button class="btn ghost small" type="button" data-goto="adjustingEntries">
                        Adjusting Entries
                    </button>
                </p>`;

        } else if (step === 3) {

            const atb = LedgerAccounting.adjustedTrialBalance(state, asOf);

            body = !atb.hasRows ? `<p class="muted">No entries yet.</p>` : `
                <p class="${atb.finalBalanced ? "positive" : "negative"}">
                    ${atb.finalBalanced
                        ? "The adjusted trial balance balances."
                        : "The adjusted trial balance does NOT balance. Fix this before closing."}
                </p>
                <div class="table-wrap"><table>
                    <thead><tr><th>Account</th>
                        <th style="text-align:right">Unadjusted Dr</th><th style="text-align:right">Unadjusted Cr</th>
                        <th style="text-align:right">Adjusted Dr</th><th style="text-align:right">Adjusted Cr</th>
                    </tr></thead>
                    <tbody>
                        ${atb.rows.map(r => `<tr>
                            <td>${e(r.account)}</td>
                            <td class="amount" style="text-align:right">${r.unDebit ? LedgerUtils.peso(r.unDebit) : ""}</td>
                            <td class="amount" style="text-align:right">${r.unCredit ? LedgerUtils.peso(r.unCredit) : ""}</td>
                            <td class="amount" style="text-align:right">${r.finalDebit ? LedgerUtils.peso(r.finalDebit) : ""}</td>
                            <td class="amount" style="text-align:right">${r.finalCredit ? LedgerUtils.peso(r.finalCredit) : ""}</td>
                        </tr>`).join("")}
                        <tr style="font-weight:700">
                            <td>Total</td>
                            <td class="amount" style="text-align:right">${LedgerUtils.peso(atb.totals.unDebit)}</td>
                            <td class="amount" style="text-align:right">${LedgerUtils.peso(atb.totals.unCredit)}</td>
                            <td class="amount" style="text-align:right">${LedgerUtils.peso(atb.totals.finalDebit)}</td>
                            <td class="amount" style="text-align:right">${LedgerUtils.peso(atb.totals.finalCredit)}</td>
                        </tr>
                    </tbody></table></div>`;

        } else if (step === 4) {

            const fs = LedgerAccounting.financialStatements(state, fy.start, stmtEnd);
            const cash = LedgerAccounting.cashFlowStatement(state, fy.start, stmtEnd);

            body = `
                <p class="tiny muted">
                    These annual statements are saved automatically as a frozen copy when the year is closed.
                </p>
                <h4>Income Statement</h4>${this.statementTable(fs.incomeRows)}
                <h4 style="margin-top:12px">Statement of Owner's Equity</h4>${this.statementTable(fs.equityRows)}
                <h4 style="margin-top:12px">Balance Sheet</h4>${this.statementTable(fs.balanceRows)}
                <h4 style="margin-top:12px">Statement of Cash Flows</h4>${this.statementTable(cash.rows)}
                <p class="tiny ${cash.reconciles ? "positive" : "negative"}">
                    ${cash.reconciles ? "Cash flow agrees with your cash accounts." : "Cash flow does not agree with your cash accounts."}
                </p>`;

        } else if (step === 5) {

            const plan = LedgerAccounting.closingPlan(state, fy.start, fy.end);
            const pct = LedgerAccounting.postClosingTrialBalance(state, plan);

            const posted = state.adjustments
                .filter(a => LedgerAccounting.isClosingType(a.type) && a.date === fy.end)
                .map(a => ({
                    description: a.description,
                    lines: a.lines
                }));

            body = closed ? `
                <p class="positive">The year is closed. These entries are posted:</p>
                ${this.closingEntriesTable(posted)}
            ` : plan.error ? `
                <p class="negative">${e(plan.error)}</p>
                <p><button class="btn secondary" type="button" data-goto="chartOfAccounts">Chart of Accounts</button></p>
            ` : `
                <p>Net ${plan.netIncome < 0 ? "loss" : "income"} for the year:
                   <strong>${LedgerUtils.peso(plan.netIncome)}</strong>.
                   ${plan.summaryAccount
                        ? `Revenue and expenses close to <strong>${e(plan.summaryAccount)}</strong>, then to <strong>${e(plan.capitalAccount)}</strong>.`
                        : `Revenue and expenses close directly to <strong>${e(plan.capitalAccount)}</strong>.`}
                </p>
                ${this.closingEntriesTable(plan.entries)}
                <h4 style="margin-top:16px">Post-closing trial balance</h4>
                <p class="tiny ${pct.balanced && pct.temporaryClosed ? "positive" : "negative"}">
                    ${pct.balanced && pct.temporaryClosed
                        ? "Balanced, and every revenue and expense account is zero."
                        : "The post-closing balances are not right. Do not close the year."}
                </p>
                <div class="table-wrap"><table>
                    <thead><tr><th>Account</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr></thead>
                    <tbody>
                        ${pct.rows.map(r => `<tr><td>${e(r.account)}</td>
                            <td class="amount" style="text-align:right">${r.debit ? LedgerUtils.peso(r.debit) : ""}</td>
                            <td class="amount" style="text-align:right">${r.credit ? LedgerUtils.peso(r.credit) : ""}</td></tr>`).join("")}
                        <tr style="font-weight:700"><td>Total</td>
                            <td class="amount" style="text-align:right">${LedgerUtils.peso(pct.debit)}</td>
                            <td class="amount" style="text-align:right">${LedgerUtils.peso(pct.credit)}</td></tr>
                    </tbody></table></div>
                <div class="card" style="margin-top:16px">
                    <label>
                        <input type="checkbox" id="closingConfirm">
                        I understand this posts the closing entries and locks every date up to ${e(fy.end)}.
                        Changes afterwards need the year to be reopened.
                    </label>
                    <p style="margin-top:12px">
                        <button class="btn" type="button" data-act="close-post"
                            ${c.busy ? "disabled" : ""}>
                            Post closing entries and close the year
                        </button>
                    </p>
                </div>`;

        } else {

            const plan = LedgerAccounting.closingPlan(state, fy.start, fy.end);
            const pct = LedgerAccounting.postClosingTrialBalance(state, plan);

            const latestClosed = state.closing.closings
                .filter(x => x.status === "complete")
                .sort((a, b) => a.fiscalYearStart < b.fiscalYearStart ? 1 : -1)[0];

            body = `
                <p>${closed
                    ? `These balances were carried forward to the new year starting ${e(LedgerAccounting.dayAfter(fy.end))}.`
                    : "These balances will be carried forward when you close the year (step 5)."}</p>
                <div class="table-wrap"><table>
                    <thead><tr><th>Account</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr></thead>
                    <tbody>
                        ${pct.rows.map(r => `<tr><td>${e(r.account)}</td>
                            <td class="amount" style="text-align:right">${r.debit ? LedgerUtils.peso(r.debit) : ""}</td>
                            <td class="amount" style="text-align:right">${r.credit ? LedgerUtils.peso(r.credit) : ""}</td></tr>`).join("")}
                    </tbody></table></div>
                ${closed && latestClosed && latestClosed.id === closing.id ? `
                <div class="card" style="margin-top:16px">
                    <h4>Reopen this year</h4>
                    <p class="tiny muted">
                        Reopening posts reversing entries (nothing is deleted) and unlocks the year so you can correct it.
                    </p>
                    <label>Reason<br><input id="reopenReason" type="text" style="width:100%"></label>
                    <label style="display:block;margin-top:8px">Type REOPEN to confirm<br>
                        <input id="reopenConfirm" type="text"></label>
                    <p style="margin-top:12px">
                        <button class="btn secondary" type="button" data-act="close-reopen"
                            data-id="${e(closing.id)}">Reopen year</button>
                    </p>
                </div>` : ""}`;
        }

        const history = c.audit.length ? `
            <div class="card" style="margin-top:16px">
                <p class="eyebrow">YEAR-END HISTORY</p>
                ${c.audit.map(a => `
                    <p class="tiny">
                        ${e(String(a.created_at).slice(0, 16).replace("T", " "))} —
                        ${e(a.event_type === "year_closed" ? "Closed" : "Reopened")}
                        ${e(String((a.details || {}).fiscal_year_start || ""))}
                        ${a.details && a.details.reason ? "· " + e(a.details.reason) : ""}
                    </p>`).join("")}
            </div>` : "";

        return `
            ${head}
            ${yearSelect}
            ${stepper}
            <div class="card table-card">
                <div class="card-head"><h3>${step}. ${stepNames[step - 1]}</h3></div>
                <div style="padding:16px">${body}</div>
                <div style="padding:0 16px 16px;display:flex;justify-content:space-between">
                    <button class="btn secondary" type="button" data-act="close-step"
                        data-step="${Math.max(1, step - 1)}" ${step === 1 ? "disabled" : ""}>Back</button>
                    <button class="btn secondary" type="button" data-act="close-step"
                        data-step="${Math.min(6, step + 1)}" ${step === 6 ? "disabled" : ""}>Next</button>
                </div>
            </div>
            ${history}
        `;
    }

    accountGroupsPanel() {

        const groups = {
            asset: [["current", "Current"], ["non_current", "Non-current"]],
            liability: [["current", "Current"], ["non_current", "Non-current"]],
            revenue: [["operating", "Operating"], ["other", "Other income"]],
            expense: [["operating", "Operating"], ["other", "Other expense"]]
        };

        const accounts = LedgerUtils.chart
            .filter(a => groups[a.account_type] && a.is_active !== false)
            .sort((a, b) =>
                Object.keys(groups).indexOf(a.account_type) -
                    Object.keys(groups).indexOf(b.account_type) ||
                a.account_name.localeCompare(b.account_name)
            );

        if (!accounts.length) return "";

        const rows = accounts.map(a => {

            const saved = this.state.accountClasses.get(
                a.account_name.toLowerCase()
            ) || "";

            const auto = LedgerAccounting.classOf(
                { accountClasses: new Map() }, a.account_name, a.account_type
            );

            const label = Object.fromEntries(groups[a.account_type])[auto];

            return `
                <tr>
                    <td>${LedgerUtils.escape(a.account_name)}</td>
                    <td class="tiny muted">
                        ${LedgerUtils.escape(
                            LedgerUtils.ACCOUNT_TYPE_LABELS[a.account_type]
                        )}
                    </td>
                    <td>
                        <select data-class-account="${LedgerUtils.escape(a.account_name)}">
                            <option value="">Automatic (${LedgerUtils.escape(label)})</option>
                            ${groups[a.account_type].map(([value, text]) => `
                                <option value="${value}"
                                    ${saved === value ? "selected" : ""}>
                                    ${text}
                                </option>`).join("")}
                        </select>
                    </td>
                </tr>`;
        }).join("");

        return `
            <details class="card" style="margin-top:16px">
                <summary style="cursor:pointer;font-weight:600">
                    Account groups (current / non-current, operating / other)
                </summary>
                <p class="tiny muted" style="margin:8px 0">
                    Groups are guessed from account names. Change one if a
                    statement puts an account in the wrong section.
                </p>
                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr><th>Account</th><th>Type</th><th>Group</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div style="margin-top:12px">
                    <button class="btn" type="button" data-act="classes-save">
                        Save groups
                    </button>
                </div>
            </details>
        `;
    }

    savedReportsPanel() {

        const reports = this.state.savedReports || [];

        const viewed = this.state.viewedReport;

        const list = reports.length ? `
            <div class="table-wrap">
                <table>
                    <thead>
                        <tr><th>Report</th><th>Period</th><th>Saved</th><th></th></tr>
                    </thead>
                    <tbody>
                        ${reports.map(r => `
                            <tr>
                                <td>${LedgerUtils.escape(r.title)}</td>
                                <td>${LedgerUtils.escape(String(r.start_date).slice(0, 10))}
                                    to ${LedgerUtils.escape(String(r.end_date).slice(0, 10))}</td>
                                <td class="tiny muted">
                                    ${LedgerUtils.escape(String(r.created_at || "").slice(0, 10))}
                                </td>
                                <td>
                                    <button class="btn secondary" type="button"
                                        data-act="report-view"
                                        data-id="${LedgerUtils.escape(r.id)}">
                                        View
                                    </button>
                                </td>
                            </tr>`).join("")}
                    </tbody>
                </table>
            </div>` : `<p class="tiny muted">No saved reports yet. Saved reports are frozen copies and never change.</p>`;

        const data = viewed && viewed.data;

        return `
            <div class="card" style="margin-top:16px">
                <p class="eyebrow">SAVED REPORTS</p>
                ${list}
            </div>
            ${data ? `
            <div class="card table-card" style="margin-top:16px">
                <div class="card-head">
                    <h3>${LedgerUtils.escape(viewed.title)}</h3>
                    <span class="tiny muted">Saved copy — figures do not change</span>
                </div>
                ${["income", "equity", "balance", "cash"].filter(k => data[k]).map(k => `
                    <h4 style="padding:8px 16px 0">${{
                        income: "Income Statement",
                        equity: "Statement of Owner's Equity",
                        balance: "Balance Sheet",
                        cash: "Statement of Cash Flows"
                    }[k]}</h4>
                    ${this.statementTable(data[k])}`).join("")}
            </div>` : ""}
        `;
    }


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

                This is the unadjusted trial balance; adjusting entries
                appear on the Adjusted Trial Balance page.

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
    // REPORTING PERIODS
    // =====================================================

    reportingStatusBadge(value) {

        const text = {
            not_started: "Not started",
            in_progress: "In progress",
            complete: "Complete"
        }[value] || "Not started";

        const style = value === "complete"
            ? "badge approved"
            : value === "in_progress"
                ? "badge review"
                : "badge";

        return `<span class="${style}">${text}</span>`;
    }

    reportingChange(current, previous) {

        const change = current - previous;

        if (!change) return "No change";

        const percent = previous
            ? ` (${change > 0 ? "+" : ""}${(change / Math.abs(previous) * 100).toFixed(1)}%)`
            : "";

        return `${change > 0 ? "+" : "−"}${LedgerUtils.peso(Math.abs(change))}${percent}`;
    }

    reportingPeriods() {

        const reporting = this.state.reporting;

        const period = this.state.getReportingPeriod();

        const previous = this.state.getPreviousReportingPeriod(period);

        const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November",
            "December"
        ];

        const frequencyName = {
            monthly: "Monthly",
            quarterly: "Quarterly",
            yearly: "Yearly"
        }[reporting.frequency];

        const compareName = {
            monthly: "previous month",
            quarterly: "previous quarter",
            yearly: "previous year"
        }[reporting.frequency];

        const today = LedgerUtils.today();

        const waitingCount = period
            ? this.state.getPeriodProposals(period.id)
                .filter(p => LedgerState.isWaiting(p)).length
            : 0;

        const current = period
            ? LedgerAccounting.periodSummary(this.state, period.start, period.end)
            : null;

        const before = period && previous
            ? LedgerAccounting.periodSummary(this.state, previous.start, previous.end)
            : null;

        const newestFirst = [...reporting.periods].reverse();

        return `

            ${this.heading(
                "Reporting Periods",
                "Choose how often you prepare financial reports. Changing this never changes your transactions or journal entries."
            )}


            <div class="card">

                <div class="card-head">
                    <h3>Reporting settings</h3>
                </div>

                <div class="form-grid" style="padding:0">

                    <label>
                        Reporting frequency

                        <select id="reportingFrequency">
                            ${["monthly", "quarterly", "yearly"].map(value => `
                                <option
                                    value="${value}"
                                    ${value === reporting.frequency ? "selected" : ""}
                                >
                                    ${{ monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" }[value]}
                                </option>
                            `).join("")}
                        </select>
                    </label>

                    <label>
                        Fiscal year starts in

                        <select
                            id="reportingFiscalStart"
                            ${reporting.fiscalStartLocked ? "disabled" : ""}
                        >
                            ${monthNames.map((name, index) => `
                                <option
                                    value="${index + 1}"
                                    ${index + 1 === reporting.fiscalStartMonth ? "selected" : ""}
                                >
                                    ${name}
                                </option>
                            `).join("")}
                        </select>
                    </label>

                </div>

                <p class="form-note">
                    ${
                        reporting.fiscalStartLocked
                            ? "The fiscal year start is locked because period-end work has already started."
                            : "Pick January for a calendar year, or another month if your business year starts later."
                    }
                    Your reporting frequency is separate from your fiscal
                    year: monthly and quarterly reports never close your
                    books. Only the year-end closing does that.
                </p>

                <div class="modal-actions" style="margin-top:12px">
                    <button
                        class="btn primary"
                        id="saveReportingSettings"
                        type="button"
                    >
                        Save settings
                    </button>
                </div>

            </div>


            <div class="card" style="margin-top:16px">

                <div class="card-head">
                    <h3>${frequencyName} reporting period</h3>
                </div>

                ${
                    !period
                        ? `<p class="muted tiny">No reporting periods yet.</p>`
                        : `

                <label>
                    Reporting period

                    <select id="reportingPeriodSelect">
                        ${newestFirst.map(item => `
                            <option
                                value="${LedgerUtils.escape(item.start)}"
                                ${item.start === period.start ? "selected" : ""}
                            >
                                ${LedgerUtils.escape(item.label)}
                                (${LedgerUtils.escape(item.start)} to ${LedgerUtils.escape(item.end)})
                            </option>
                        `).join("")}
                    </select>
                </label>

                <div class="breakdown-row" style="margin-top:12px">
                    <span>Starts</span>
                    <strong>${LedgerUtils.escape(period.start)}</strong>
                </div>

                <div class="breakdown-row">
                    <span>Ends</span>
                    <strong>
                        ${LedgerUtils.escape(period.end)}
                        ${period.end > today ? " (in progress)" : ""}
                    </strong>
                </div>

                <div class="breakdown-row">
                    <span>Period-end reconciliation</span>
                    ${this.reportingStatusBadge(period.reconciliation)}
                </div>

                <div class="breakdown-row">
                    <span>Adjustments waiting for approval</span>
                    <strong>${waitingCount}</strong>
                </div>

                <div class="breakdown-row">
                    <span>Adjusted trial balance</span>
                    ${this.reportingStatusBadge(period.adjustedTb)}
                </div>

                <div class="breakdown-row">
                    <span>Financial statements</span>
                    ${this.reportingStatusBadge(period.statements)}
                </div>

                <div class="breakdown-row">
                    <span>Year-end closing</span>
                    ${
                        reporting.frequency === "yearly"
                            ? this.reportingStatusBadge(period.closing)
                            : `<span class="tiny muted">Only at fiscal year-end</span>`
                    }
                </div>

                <div class="modal-actions" style="margin-top:12px">
                    <button
                        class="btn primary"
                        type="button"
                        data-goto="reconciliation"
                    >
                        Reconcile this period
                    </button>
                    <button
                        class="btn secondary"
                        id="useReportingPeriod"
                        type="button"
                    >
                        View financial statements for this period
                    </button>
                </div>

                `}

            </div>


            ${
                period
                    ? `

            <div class="card" style="margin-top:16px">

                <div class="card-head">
                    <h3>
                        ${LedgerUtils.escape(period.label)}
                        ${previous ? `vs. ${compareName}` : ""}
                    </h3>
                    <span class="tiny muted">
                        Posted transactions and adjusting entries
                    </span>
                </div>

                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th></th>
                                <th style="text-align:right">
                                    ${LedgerUtils.escape(period.label)}
                                </th>
                                ${previous ? `
                                <th style="text-align:right">
                                    ${LedgerUtils.escape(previous.label)}
                                </th>
                                <th style="text-align:right">Change</th>
                                ` : ""}
                            </tr>
                        </thead>
                        <tbody>
                            ${[
                                ["Income", "income"],
                                ["Expenses", "expenses"],
                                ["Net profit", "profit"]
                            ].map(([label, key]) => `
                                <tr>
                                    <td>${label}</td>
                                    <td class="amount" style="text-align:right">
                                        ${LedgerUtils.peso(current[key])}
                                    </td>
                                    ${previous ? `
                                    <td class="amount" style="text-align:right">
                                        ${LedgerUtils.peso(before[key])}
                                    </td>
                                    <td class="amount" style="text-align:right">
                                        ${this.reportingChange(current[key], before[key])}
                                    </td>
                                    ` : ""}
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>

                ${
                    previous
                        ? ""
                        : `<p class="tiny muted">
                               This is your first period, so there is
                               nothing to compare it with yet.
                           </p>`
                }

                ${
                    period.end > today
                        ? `<p class="tiny muted">
                               This period is still in progress, so its
                               figures cover only the days so far.
                           </p>`
                        : ""
                }

            </div>


            <div class="card" style="margin-top:16px">

                <div class="card-head">
                    <h3>All ${frequencyName.toLowerCase()} periods</h3>
                </div>

                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>Period</th>
                                <th>Dates</th>
                                <th style="text-align:right">Net profit</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody>
                            ${newestFirst.map(item => {

                                const summary = LedgerAccounting.periodSummary(
                                    this.state, item.start, item.end
                                );

                                return `
                                    <tr>
                                        <td>${LedgerUtils.escape(item.label)}</td>
                                        <td>
                                            ${LedgerUtils.escape(item.start)}
                                            to
                                            ${LedgerUtils.escape(item.end)}
                                        </td>
                                        <td class="amount" style="text-align:right">
                                            ${LedgerUtils.peso(summary.profit)}
                                        </td>
                                        <td>
                                            <button
                                                class="btn ghost small"
                                                type="button"
                                                data-select-period="${LedgerUtils.escape(item.start)}"
                                            >
                                                ${item.start === period.start ? "Selected" : "Select"}
                                            </button>
                                        </td>
                                    </tr>`;
                            }).join("")}
                        </tbody>
                    </table>
                </div>

            </div>

                    `
                    : ""
            }

        `;
    }


    // =====================================================
    // PERIOD-END RECONCILIATION (wizard)
    // =====================================================

    reconciliation() {

        const period = this.state.getReportingPeriod();
        const recon = this.state.recon;

        const head = this.heading(
            "Period-End Reconciliation",
            "Check your records against what you actually have. Ledger only proposes an adjustment where something does not match, and nothing is posted until you approve it."
        );

        if (!period) {
            return head + `
                <div class="card">
                    <p class="muted">
                        Choose your reporting frequency on the
                        Reporting Periods page first.
                    </p>
                </div>`;
        }

        if (recon.periodId !== period.id) {
            return head + `
                <div class="card"><p class="muted">Loading your reconciliation…</p></div>`;
        }

        const steps = [
            ["inventory", "Inventory"],
            ["supplies", "Supplies"],
            ["assets", "Fixed assets"],
            ["expenses", "Unpaid expenses"],
            ["review", "Review"]
        ];

        const current = Math.min(Math.max(recon.step, 1), steps.length);
        const today = LedgerUtils.today();

        const periodOptions = [...this.state.reporting.periods].reverse()
            .map(item => `
                <option value="${LedgerUtils.escape(item.start)}"
                    ${item.start === period.start ? "selected" : ""}>
                    ${LedgerUtils.escape(item.label)}
                </option>`).join("");

        const stepper = steps.map(([key, label], index) => {

            const done = recon.steps[key] === "complete";

            return `
                <button
                    type="button"
                    class="btn ${index + 1 === current ? "primary" : "secondary"} small"
                    data-act="recon-step"
                    data-step="${index + 1}"
                >
                    ${done ? "✓ " : `${index + 1}. `}${label}
                </button>`;
        }).join(" ");

        let body = "";

        if (current === 1) body = this.reconInventoryStep();
        if (current === 2) body = this.reconSuppliesStep(period);
        if (current === 3) body = this.reconAssetsStep();
        if (current === 4) body = this.reconExpensesStep(period);
        if (current === 5) body = this.reconReviewStep(period);

        return `

            ${head}

            <div class="card">

                <label>
                    Reporting period
                    <select id="reconPeriodSelect">${periodOptions}</select>
                </label>

                <p class="tiny muted" style="margin:8px 0 12px">
                    ${LedgerUtils.escape(period.start)} to
                    ${LedgerUtils.escape(period.end)}
                    · Reconciliation:
                    ${this.reportingStatusBadge(period.reconciliation)}
                    ${period.end > today
                        ? " · This period has not ended yet, so you can prepare now and run it again at period end."
                        : ""}
                </p>

                <div>${stepper}</div>

                <p class="tiny muted" style="margin-top:8px">
                    Step ${current} of ${steps.length}
                </p>

            </div>

            <div class="card" style="margin-top:16px">
                ${body}
            </div>

            <div class="modal-actions" style="margin-top:16px">

                <button type="button" class="btn secondary"
                    data-act="recon-prev" ${current === 1 ? "disabled" : ""}>
                    ← Previous
                </button>

                <button type="button" class="btn secondary" data-act="recon-save">
                    Save progress
                </button>

                ${current < steps.length ? `
                <button type="button" class="btn primary" data-act="recon-next">
                    Next →
                </button>` : ""}

            </div>
        `;
    }

    reconInventoryStep() {

        const items = this.state.inventory;
        const saved = this.state.recon.draft.inventory || {};

        const statuses = [
            ["ok", "Counted, nothing wrong"],
            ["missing", "Missing"],
            ["damaged", "Damaged"],
            ["obsolete", "Obsolete"]
        ];

        const rows = items.map(item => {

            const entry = saved[item.id] || {};

            const hasCount = entry.actual !== null &&
                entry.actual !== undefined && entry.actual !== "";

            const difference = hasCount
                ? Math.round((item.quantity - Number(entry.actual)) * 100) / 100
                : null;

            const result = !hasCount
                ? "—"
                : difference > 0
                    ? `<span class="negative">${difference} short</span>`
                    : difference < 0
                        ? `<span>${-difference} extra</span>`
                        : `<span class="positive">Matches</span>`;

            const ending = hasCount
                ? LedgerUtils.peso(Number(entry.actual) * item.averageCost)
                : "—";

            const id = LedgerUtils.escape(item.id);

            return `
                <tr>
                    <td><strong>${LedgerUtils.escape(item.name)}</strong></td>
                    <td>${item.quantity}</td>
                    <td>${LedgerUtils.peso(item.averageCost)}</td>
                    <td>
                        <input type="number" min="0" step="0.01" style="width:90px"
                            data-rc="inv-actual" data-id="${id}"
                            value="${hasCount ? LedgerUtils.escape(entry.actual) : ""}">
                    </td>
                    <td>
                        <select data-rc="inv-status" data-id="${id}">
                            ${statuses.map(([value, label]) => `
                                <option value="${value}"
                                    ${(entry.status || "ok") === value ? "selected" : ""}>
                                    ${label}</option>`).join("")}
                        </select>
                    </td>
                    <td>
                        <input type="number" min="0" step="0.01" style="width:90px"
                            placeholder="optional"
                            data-rc="inv-nrv" data-id="${id}"
                            value="${entry.nrv !== null && entry.nrv !== undefined ? LedgerUtils.escape(entry.nrv) : ""}">
                    </td>
                    <td>
                        <input type="text" maxlength="150" placeholder="Why?"
                            data-rc="inv-note" data-id="${id}"
                            value="${LedgerUtils.escape(entry.note || "")}">
                    </td>
                    <td>${result}</td>
                    <td class="amount">${ending}</td>
                </tr>`;
        }).join("");

        return `
            <h3>Step 1 — Count your inventory</h3>
            <p class="muted-small">
                Count what is physically on your shelves and type it in.
                If the count is lower than your records, Ledger proposes a
                loss; if an item would now sell for less than it cost, enter
                its selling price less selling costs (net realisable value)
                and Ledger proposes a write-down. Leave a row blank to skip it.
            </p>
            ${items.length ? `
            <div class="table-wrap">
                <table>
                    <thead><tr>
                        <th>Item</th><th>Recorded qty</th><th>Unit cost</th>
                        <th>Actual qty</th><th>Condition</th>
                        <th>Net realisable value / unit</th><th>Explanation</th>
                        <th>Result</th><th>Ending value</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>` : `
            <p class="muted">You have no inventory items, so there is nothing to count. You can continue to the next step.</p>`}
        `;
    }

    reconSuppliesStep(period) {

        const items = this.state.supplies;
        const saved = this.state.recon.draft.supplies || {};
        const counts = saved.counts || {};

        const account = LedgerAccounting.suppliesAccountName();

        const book = LedgerAccounting.accountBalance(
            this.state, account, period.end
        );

        let ending = 0;

        const rows = items.map(item => {

            const entered = counts[item.id] || {};

            const units = entered.quantity !== undefined &&
                entered.quantity !== null && entered.quantity !== ""
                ? Number(entered.quantity) : item.unitsOnHand;

            const cost = entered.unit_cost !== undefined &&
                entered.unit_cost !== null && entered.unit_cost !== ""
                ? Number(entered.unit_cost) : item.unitCost;

            ending += units * cost;

            const id = LedgerUtils.escape(item.id);

            return `
                <tr>
                    <td><strong>${LedgerUtils.escape(item.name)}</strong></td>
                    <td>${item.unitsOnHand}</td>
                    <td>
                        <input type="number" min="0" step="0.01" style="width:90px"
                            data-rc="sup-qty" data-id="${id}" value="${units}">
                    </td>
                    <td>
                        <input type="number" min="0" step="0.01" style="width:90px"
                            data-rc="sup-cost" data-id="${id}" value="${cost}">
                    </td>
                    <td class="amount">${LedgerUtils.peso(units * cost)}</td>
                </tr>`;
        }).join("");

        ending = Math.round(ending * 100) / 100;

        const used = Math.round((book - ending) * 100) / 100;

        return `
            <h3>Step 2 — Supplies and materials</h3>
            <p class="muted-small">
                Count the supplies you still have. Anything left over stays
                recorded as an asset; only what was used up becomes an
                expense. Supplies you already recorded as an expense when
                you bought them are not counted twice, because Ledger
                compares your count with the balance of your
                <strong>${LedgerUtils.escape(account)}</strong> account.
            </p>
            ${items.length ? `
            <div class="table-wrap">
                <table>
                    <thead><tr>
                        <th>Supply</th><th>Recorded units</th>
                        <th>Units remaining</th><th>Cost per unit</th>
                        <th>Value remaining</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>

            <div class="breakdown-row" style="margin-top:12px">
                <span>${LedgerUtils.escape(account)} balance in your ledger (supplies bought, not yet used)</span>
                <strong>${LedgerUtils.peso(book)}</strong>
            </div>
            <div class="breakdown-row">
                <span>Supplies remaining (your count)</span>
                <strong>${LedgerUtils.peso(ending)}</strong>
            </div>
            <div class="breakdown-row">
                <span>Supplies used this period</span>
                <strong class="${used < 0 ? "negative" : ""}">
                    ${used > 0 ? LedgerUtils.peso(used) : used < 0 ? LedgerUtils.peso(used) : "None"}
                </strong>
            </div>
            ${used < 0 ? `<p class="tiny negative">Your count is higher than your records. Check for supplies you bought but did not record.</p>` : ""}
            ${book === 0 && items.length ? `<p class="tiny muted">The ${LedgerUtils.escape(account)} account has no balance, so no supplies entry will be proposed.</p>` : ""}

            <label style="margin-top:12px;display:block">
                Were any supplies damaged or thrown away?
                <input type="text" maxlength="200" data-rc="sup-discarded"
                    value="${LedgerUtils.escape(saved.discarded || "")}">
            </label>
            <label style="margin-top:8px;display:block">
                Did you buy more supplies this period? (Mention them here)
                <input type="text" maxlength="200" data-rc="sup-purchased"
                    value="${LedgerUtils.escape(saved.purchased || "")}">
            </label>
            ` : `
            <p class="muted">
                You have not registered any supplies yet. Add them on the
                Supplies page, then come back. You can continue to the
                next step.
            </p>`}
        `;
    }

    reconAssetsStep() {

        const assets = this.state.fixedAssets;
        const reviewed = this.state.recon.draft.assets_reviewed === true;

        const method = {
            straight_line: "Straight-line",
            declining_balance: "Declining balance"
        };

        const rows = assets.map(asset => `
            <tr>
                <td><strong>${LedgerUtils.escape(asset.name)}</strong></td>
                <td>${LedgerUtils.peso(asset.cost)}</td>
                <td>${LedgerUtils.peso(asset.residualValue)}</td>
                <td>${Math.round(asset.usefulLifeMonths / 12 * 10) / 10} yrs</td>
                <td>${LedgerUtils.escape(method[asset.method] || asset.method)}</td>
                <td>${LedgerUtils.peso(asset.accumulatedDepreciation)}</td>
                <td>${LedgerUtils.peso(asset.carryingAmount)}</td>
                <td>${LedgerUtils.escape(asset.condition)}</td>
                <td>${asset.status === "disposed" ? "Disposed" : "In use"}</td>
            </tr>`).join("");

        return `
            <h3>Step 3 — Review your fixed assets</h3>
            <p class="muted-small">
                Ledger works out depreciation for this period automatically
                from the figures below. Check that each asset's useful life,
                residual value, condition and disposal status are still
                right. A month that has already been depreciated is never
                depreciated again, even if you switch between monthly,
                quarterly and yearly reports.
            </p>
            ${assets.length ? `
            <div class="table-wrap">
                <table>
                    <thead><tr>
                        <th>Asset</th><th>Cost</th><th>Residual</th><th>Life</th>
                        <th>Method</th><th>Depreciation so far</th>
                        <th>Carrying amount</th><th>Condition</th><th>Status</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
            <p style="margin-top:12px">
                <button class="btn ghost small" type="button" data-goto="fixedAssets">
                    Edit fixed assets
                </button>
            </p>
            <label style="display:block;margin-top:8px">
                <input type="checkbox" data-rc="assets-reviewed" ${reviewed ? "checked" : ""}>
                I have reviewed the useful life, residual value, condition and
                disposals of my assets.
            </label>` : `
            <p class="muted">You have no fixed assets registered, so there is no depreciation to calculate.</p>`}
        `;
    }

    reconExpensesStep(period) {

        const rows = this.state.recon.draft.expenses || [];

        const presets = [
            "Electricity bill", "Water bill", "Internet bill", "Salaries",
            "Rent", "Supplier payment", "Interest", "Other unpaid expense"
        ];

        const cards = rows.map(row => {

            const id = LedgerUtils.escape(row.id);

            return `
                <div class="card" data-rc-row="${id}" style="margin-top:12px">
                    <div class="form-grid" style="padding:0">
                        <label class="span-2">
                            What is it?
                            <input type="text" maxlength="150" data-rc="exp-desc"
                                value="${LedgerUtils.escape(row.description || "")}">
                        </label>
                        <label>
                            Amount (₱)
                            <input type="number" min="0.01" step="0.01" data-rc="exp-amount"
                                value="${row.amount ?? ""}">
                        </label>
                        <label>
                            Date incurred
                            <input type="date" data-rc="exp-date"
                                min="${LedgerUtils.escape(period.start)}"
                                max="${LedgerUtils.escape(period.end)}"
                                value="${LedgerUtils.escape(row.date || period.end)}">
                        </label>
                        <label>
                            Expense account (debit)
                            <select data-rc="exp-debit">
                                ${LedgerUtils.accountSelectOptions(row.debit_account)}
                            </select>
                        </label>
                        <label>
                            Where it is owed (credit)
                            <select data-rc="exp-credit">
                                ${LedgerUtils.accountSelectOptions(row.credit_account)}
                            </select>
                        </label>
                        <label>
                            Payment status
                            <select data-rc="exp-status">
                                <option value="unpaid" ${row.payment_status !== "paid" ? "selected" : ""}>Not yet paid</option>
                                <option value="paid" ${row.payment_status === "paid" ? "selected" : ""}>Already paid (no entry needed)</option>
                            </select>
                        </label>
                        <label class="span-2">
                            Notes
                            <input type="text" maxlength="200" data-rc="exp-notes"
                                value="${LedgerUtils.escape(row.notes || "")}">
                        </label>
                    </div>
                    <button type="button" class="btn ghost small"
                        data-act="recon-remove-expense" data-id="${id}">
                        Remove
                    </button>
                </div>`;
        }).join("");

        return `
            <h3>Step 4 — Bills and costs you owe but have not paid</h3>
            <p class="muted-small">
                An expense belongs to the period it was used, even if you pay
                it later. Add anything you owe at the end of this period, for
                example an electricity bill of ₱2,500 becomes a debit to
                Utilities Expense and a credit to Utilities Payable. Pick
                accounts from your own Chart of Accounts. If you already
                recorded the bill as an expense transaction, do not add it
                again. Ledger warns you if it spots the same amount.
            </p>

            <div>
                ${presets.map(label => `
                    <button type="button" class="btn secondary small"
                        data-act="recon-add-expense"
                        data-preset="${LedgerUtils.escape(label)}">＋ ${LedgerUtils.escape(label)}</button>
                `).join(" ")}
            </div>

            ${cards || `<p class="muted" style="margin-top:12px">Nothing added. If you owe nothing, continue to the review.</p>`}

            <p class="tiny muted" style="margin-top:12px">
                For prepaid expenses, unearned revenue, accrued revenue and
                bad debts, use the Adjusting Entries page.
            </p>
        `;
    }

    reconReviewStep(period) {

        const recon = this.state.recon;
        const draft = recon.draft;

        const mine = this.state.getPeriodProposals(period.id);
        const waiting = mine.filter(p => LedgerState.isWaiting(p)).length;
        const approved = mine.filter(p => p.status === "approved").length;

        const countedInventory = Object.values(draft.inventory || {})
            .filter(x => x && x.actual !== null && x.actual !== undefined && x.actual !== "").length;

        const unpaid = (draft.expenses || [])
            .filter(x => x.payment_status !== "paid").length;

        return `
            <h3>Step 5 — Review and create adjusting entries</h3>
            <p class="muted-small">
                Ledger now compares what you told it with your records and
                proposes an adjusting entry only where something needs
                changing. Nothing is posted yet. You approve each entry on
                the Adjustment Review page.
            </p>

            <div class="breakdown-row"><span>Inventory items counted</span><strong>${countedInventory}</strong></div>
            <div class="breakdown-row"><span>Supplies counted</span><strong>${draft.supplies ? "Yes" : "No"}</strong></div>
            <div class="breakdown-row"><span>Fixed assets reviewed</span><strong>${draft.assets_reviewed ? "Yes" : "No"}</strong></div>
            <div class="breakdown-row"><span>Unpaid items entered</span><strong>${unpaid}</strong></div>

            <p style="margin-top:14px">
                <button type="button" class="btn primary" data-act="recon-generate">
                    Create adjusting entries
                </button>
            </p>

            <p class="tiny muted">
                Running this again replaces entries still waiting for
                approval (including any you revised). Entries you already
                approved are never touched or duplicated.
            </p>

            ${recon.warnings.length ? `
            <div class="card" style="margin-top:12px">
                <strong>Please check</strong>
                <ul>
                    ${recon.warnings.map(w => `<li class="tiny">${LedgerUtils.escape(w)}</li>`).join("")}
                </ul>
            </div>` : ""}

            <div class="breakdown-row" style="margin-top:14px">
                <span>Entries waiting for your approval</span>
                <strong>${waiting}</strong>
            </div>
            <div class="breakdown-row">
                <span>Entries approved and posted</span>
                <strong>${approved}</strong>
            </div>

            <p style="margin-top:12px">
                <button type="button" class="btn secondary" data-goto="adjustmentReview">
                    Open Adjustment Review
                </button>
                <button type="button" class="btn secondary" data-act="recon-complete"
                    ${waiting > 0 || period.reconciliation === "complete" || recon.steps.generated !== "complete" ? "disabled" : ""}>
                    ${period.reconciliation === "complete" ? "✓ Reconciliation complete" : "Mark reconciliation complete"}
                </button>
            </p>
            ${waiting > 0 ? `<p class="tiny muted">Approve or reject the waiting entries before marking the reconciliation complete.</p>` : ""}
            ${waiting === 0 && recon.steps.generated !== "complete" && period.reconciliation !== "complete" ? `<p class="tiny muted">Select “Create adjusting entries” first. If nothing needs adjusting, you can then mark the reconciliation complete.</p>` : ""}
        `;
    }


    // =====================================================
    // ADJUSTMENT REVIEW
    // =====================================================

    adjustmentReview() {

        const state = this.state;
        const period = state.getReportingPeriod();

        const list = state.reviewShowAll || !period
            ? state.proposals
            : state.getPeriodProposals(period.id);

        const order = { pending: 0, revise_needed: 0, approved: 1, rejected: 2 };

        const sorted = [...list].sort((a, b) =>
            (order[a.status] - order[b.status]) ||
            a.entryDate.localeCompare(b.entryDate)
        );

        const waiting = list.filter(p => LedgerState.isWaiting(p)).length;
        const approved = list.filter(p => p.status === "approved").length;
        const rejected = list.filter(p => p.status === "rejected").length;

        return `

            ${this.heading(
                "Adjustment Review",
                "Look over each adjusting entry Ledger proposed. Approve it to post it to your books, revise it, or reject it. Approved entries can never be deleted. A mistake is corrected with a new entry."
            )}

            <div class="grid metric-grid">
                ${this.metric("Waiting for approval", waiting, "Not posted yet", "⏳")}
                ${this.metric("Approved and posted", approved, "In your General Ledger", "✓")}
                ${this.metric("Rejected", rejected, "Not posted", "✕")}
            </div>

            <div class="card" style="margin-top:16px">
                <label>
                    <input type="checkbox" id="reviewShowAll" ${state.reviewShowAll ? "checked" : ""}>
                    Show every period
                </label>
                <span class="tiny muted">
                    ${state.reviewShowAll || !period
                        ? "Showing all periods."
                        : `Showing ${LedgerUtils.escape(period.label)}. Change the period on the Reporting Periods page.`}
                </span>
            </div>

            ${sorted.length
                ? sorted.map(p => this.adjustmentCard(p)).join("")
                : `<div class="card" style="margin-top:16px">
                       <p class="muted">
                           No adjusting entries yet. Complete the
                           Reconciliation to create them.
                       </p>
                   </div>`}
        `;
    }

    adjustmentCard(p) {

        const state = this.state;

        const waitingStatus = LedgerState.isWaiting(p);

        const editing = state.editingProposalId === p.id;

        const closed = p.periodStatus === "closed";

        const labels = {
            depreciation: "Depreciation",
            inventory: "Inventory count",
            inventory_nrv: "Inventory write-down",
            supplies: "Supplies used",
            accrual: "Unpaid expense",
            manual: "Manual"
        };

        const badge = {
            pending: `<span class="badge review">WAITING FOR APPROVAL</span>`,
            revise_needed: `<span class="badge review">NEEDS REVISION</span>`,
            approved: `<span class="badge approved">POSTED</span>`,
            rejected: `<span class="badge">REJECTED</span>`
        }[p.status] || "";

        const amountLocked = [
            "depreciation", "inventory", "inventory_nrv", "supplies"
        ].includes(p.source);

        const chartNames = new Set(
            LedgerUtils.chart.filter(a => a.is_active)
                .map(a => a.account_name.toLowerCase())
        );

        const missing = p.lines.some(
            line => !line.account || !chartNames.has(line.account.toLowerCase())
        );

        const debitTotal = p.lines.reduce((t, l) => t + l.debit, 0);
        const creditTotal = p.lines.reduce((t, l) => t + l.credit, 0);
        const balanced = Math.abs(debitTotal - creditTotal) < 0.005;

        const id = LedgerUtils.escape(p.id);

        const lineRows = p.lines.map((line, index) => {

            const account = line.account && chartNames.has(line.account.toLowerCase())
                ? LedgerUtils.escape(line.account)
                : `<span class="negative">Choose an account</span>`;

            if (editing) {

                const amount = line.debit > 0 ? line.debit : line.credit;

                return `
                    <tr>
                        <td>
                            <select data-rv="account" data-i="${index}">
                                ${LedgerUtils.accountSelectOptions(line.account)}
                            </select>
                        </td>
                        <td colspan="2">
                            ${line.debit > 0 ? "Debit" : "Credit"}
                            <input type="number" min="0.01" step="0.01" style="width:120px"
                                data-rv="amount" data-i="${index}" value="${amount}"
                                ${amountLocked ? "disabled" : ""}>
                        </td>
                    </tr>`;
            }

            return `
                <tr>
                    <td style="${line.credit > 0 ? "padding-left:28px" : ""}">${account}</td>
                    <td class="amount" style="text-align:right">${line.debit > 0 ? LedgerUtils.peso(line.debit) : ""}</td>
                    <td class="amount" style="text-align:right">${line.credit > 0 ? LedgerUtils.peso(line.credit) : ""}</td>
                </tr>`;
        }).join("");

        const actions = !waitingStatus ? "" : editing ? `
            <button type="button" class="btn primary small" data-act="review-save" data-id="${id}">Save revision</button>
            <button type="button" class="btn secondary small" data-act="review-cancel">Cancel</button>
        ` : `
            <button type="button" class="btn primary small" data-act="review-approve" data-id="${id}"
                ${missing || !balanced || closed || p.status === "revise_needed" ? "disabled" : ""}>
                Approve and post
            </button>
            <button type="button" class="btn secondary small" data-act="review-revise" data-id="${id}"
                ${closed ? "disabled" : ""}>Revise</button>
            ${p.status === "pending" ? `
            <button type="button" class="btn ghost small" data-act="review-flag" data-id="${id}">Needs revision</button>` : ""}
            <button type="button" class="btn ghost small" data-act="review-reject" data-id="${id}">Reject</button>
        `;

        return `
            <div class="card" style="margin-top:16px" id="adjustment-${id}">

                <div class="card-head">
                    <div>
                        <p class="eyebrow">${LedgerUtils.escape(labels[p.source] || p.source)} · ${LedgerUtils.escape(p.periodLabel)}</p>
                        ${editing
                            ? `<input type="text" maxlength="200" id="rvDescription" value="${LedgerUtils.escape(p.description)}" style="width:100%">`
                            : `<h3 style="margin:0">${LedgerUtils.escape(p.description)}</h3>`}
                    </div>
                    ${badge}
                </div>

                <p class="muted-small">${LedgerUtils.escape(p.reason)}</p>

                <p class="tiny muted">
                    Entry date:
                    ${editing
                        ? `<input type="date" id="rvDate" min="${LedgerUtils.escape(p.periodStart)}" max="${LedgerUtils.escape(p.periodEnd)}" value="${LedgerUtils.escape(p.entryDate)}">`
                        : LedgerUtils.escape(p.entryDate)}
                </p>

                <div class="table-wrap">
                    <table>
                        <thead><tr>
                            <th>Account</th>
                            <th style="text-align:right">Debit</th>
                            <th style="text-align:right">Credit</th>
                        </tr></thead>
                        <tbody>
                            ${lineRows}
                            ${editing ? "" : `
                            <tr style="font-weight:600">
                                <td>Total</td>
                                <td class="amount" style="text-align:right">${LedgerUtils.peso(debitTotal)}</td>
                                <td class="amount" style="text-align:right">${LedgerUtils.peso(creditTotal)}</td>
                            </tr>`}
                        </tbody>
                    </table>
                </div>

                ${editing && amountLocked ? `<p class="tiny muted">The amounts come from your count or schedule. Change the accounts here, or fix the source and create the entries again.</p>` : ""}
                ${waitingStatus && missing && !editing ? `<p class="tiny negative">An account is missing from your Chart of Accounts. Choose Revise to pick one.</p>` : ""}
                ${p.status === "revise_needed" && !editing ? `<p class="tiny muted">Marked as needing revision${p.decisionNote ? ": " + LedgerUtils.escape(p.decisionNote) : ""}. Revise it, then approve.</p>` : ""}
                ${closed && waitingStatus ? `<p class="tiny muted">This period is closed.</p>` : ""}
                ${p.status === "approved" ? `<p class="tiny muted">Approved ${LedgerUtils.escape(p.decidedAt)} and posted to your General Ledger.</p>` : ""}
                ${p.status === "rejected" ? `<p class="tiny muted">Rejected ${LedgerUtils.escape(p.decidedAt)}${p.decisionNote ? ": " + LedgerUtils.escape(p.decisionNote) : ""}.</p>` : ""}

                <div class="modal-actions" style="margin-top:8px">${actions}</div>

            </div>
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


    // =====================================================
    // INVENTORY
    // =====================================================

    inventory() {

        const items = this.state.inventory;
        const moves = this.state.inventoryMovements;

        const totalValue = items.reduce(
            (sum, item) => sum + item.value, 0
        );

        const totalUnits = items.reduce(
            (sum, item) => sum + item.quantity, 0
        );

        const itemRows = items.length
            ? items.map(item => `
                <tr>
                    <td><strong>${LedgerUtils.escape(item.name)}</strong></td>
                    <td>${item.quantity}</td>
                    <td>${LedgerUtils.peso(item.averageCost)}</td>
                    <td>${LedgerUtils.peso(item.value)}</td>
                    <td>${
                        item.quantity <= 0
                            ? '<span class="badge review">OUT OF STOCK</span>'
                            : '<span class="badge approved">IN STOCK</span>'
                    }</td>
                </tr>
            `).join("")
            : `
                <tr>
                    <td colspan="5">
                        <div class="empty-state">
                            No inventory yet. Add a Purchase transaction to
                            stock your first item.
                        </div>
                    </td>
                </tr>
            `;

        const moveRows = moves.length
            ? moves.map(move => `
                <tr>
                    <td>${LedgerUtils.escape(move.date)}</td>
                    <td>${LedgerUtils.escape(move.itemName)}</td>
                    <td>${move.type === "purchase" ? "Purchase" : "Sale"}</td>
                    <td class="amount ${
                        move.type === "purchase" ? "positive" : "negative"
                    }">
                        ${move.type === "purchase" ? "+" : "−"}${move.quantity}
                    </td>
                    <td>${LedgerUtils.peso(move.unitCost)}</td>
                    <td>${LedgerUtils.peso(move.totalCost)}</td>
                </tr>
            `).join("")
            : `
                <tr>
                    <td colspan="6">
                        <div class="empty-state">
                            No stock movements yet.
                        </div>
                    </td>
                </tr>
            `;

        return `

            ${this.heading(
                "Inventory",
                "Stock is updated automatically by Purchase and Sale transactions."
            )}

            <div class="grid metric-grid">

                ${this.metric(
                    "ITEMS",
                    String(items.length),
                    "Distinct products",
                    "▤"
                )}

                ${this.metric(
                    "UNITS ON HAND",
                    String(totalUnits),
                    "Across all items",
                    "▥"
                )}

                ${this.metric(
                    "INVENTORY VALUE",
                    LedgerUtils.peso(totalValue),
                    "At average cost",
                    "₱"
                )}

            </div>

            <div class="card table-card" style="margin-top:16px">

                <div class="card-head">
                    <h3>Stock on hand</h3>
                </div>

                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>ITEM</th>
                                <th>QUANTITY</th>
                                <th>AVG. COST</th>
                                <th>VALUE</th>
                                <th>STATUS</th>
                            </tr>
                        </thead>
                        <tbody>${itemRows}</tbody>
                    </table>
                </div>

            </div>

            <div class="card table-card" style="margin-top:16px">

                <div class="card-head">
                    <h3>Recent stock movements</h3>
                    <span class="tiny muted">${moves.length} records</span>
                </div>

                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>DATE</th>
                                <th>ITEM</th>
                                <th>TYPE</th>
                                <th>QTY</th>
                                <th>UNIT COST</th>
                                <th>TOTAL</th>
                            </tr>
                        </thead>
                        <tbody>${moveRows}</tbody>
                    </table>
                </div>

            </div>

        `;
    }


    // =====================================================
    // FIXED ASSETS REGISTER
    // =====================================================

    fixedAssets() {

        const state = this.state;
        const assets = state.fixedAssets;

        const editing = state.editingAssetId
            ? assets.find(a => a.id === state.editingAssetId)
            : null;

        const val = (field, fallback = "") =>
            LedgerUtils.escape(
                String(editing ? (editing[field] ?? fallback) : fallback)
            );

        const ratePct = editing && editing.decliningRate
            ? String(+(editing.decliningRate * 100).toFixed(4))
            : "";

        const methodLabels = {
            straight_line: "Straight-line",
            declining_balance: "Declining balance"
        };

        const active = assets.filter(a => a.status !== "disposed");

        const totalCost = active.reduce((sum, a) => sum + a.cost, 0);

        const totalCarrying = active.reduce(
            (sum, a) => sum + a.carryingAmount, 0
        );

        const rows = assets.length
            ? assets.map(a => {

                return `
                    <tr>
                        <td>
                            <strong>${LedgerUtils.escape(a.name)}</strong>
                            ${a.description
                                ? `<div class="tiny muted">${LedgerUtils.escape(a.description)}</div>`
                                : ""}
                        </td>
                        <td>${LedgerUtils.escape(a.acquisitionDate)}</td>
                        <td>${LedgerUtils.peso(a.cost)}</td>
                        <td>${LedgerUtils.escape(methodLabels[a.method] || a.method)}</td>
                        <td>${LedgerUtils.peso(a.accumulatedDepreciation)}</td>
                        <td>${LedgerUtils.peso(a.carryingAmount)}</td>
                        <td>${
                            a.status === "disposed"
                                ? '<span class="badge review">DISPOSED</span>'
                                : '<span class="badge approved">ACTIVE</span>'
                        }</td>
                        <td>
                            <button
                                type="button"
                                class="btn"
                                data-edit-asset="${LedgerUtils.escape(a.id)}"
                            >Edit</button>
                            ${a.status !== "disposed" ? `
                                <button
                                    type="button"
                                    class="btn"
                                    data-dispose-asset="${LedgerUtils.escape(a.id)}"
                                >Dispose</button>` : ""}
                        </td>
                    </tr>
                `;
            }).join("")
            : `
                <tr>
                    <td colspan="8">
                        <div class="empty-state">
                            No fixed assets yet. Use “Add fixed asset”
                            to register your first one.
                        </div>
                    </td>
                </tr>
            `;

        const selected = (field, value, fallback) =>
            (editing ? editing[field] : fallback) === value
                ? "selected"
                : "";

        const form = state.assetFormOpen ? `
            <div class="card" style="margin-bottom:16px">
                <h3 style="margin-top:0">
                    ${editing ? "Edit fixed asset" : "Add fixed asset"}
                </h3>

                <form id="assetForm">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">

                        <label style="grid-column:1/-1">
                            Asset name
                            <input id="assetName" type="text" maxlength="150"
                                   value="${val("name")}" required>
                        </label>

                        <label style="grid-column:1/-1">
                            Description
                            <input id="assetDescription" type="text"
                                   value="${val("description")}">
                        </label>

                        <label>
                            Acquisition date
                            <input id="assetAcquired" type="date"
                                   max="${LedgerUtils.today()}"
                                   value="${val("acquisitionDate", LedgerUtils.today())}"
                                   required>
                        </label>

                        <label>
                            Depreciation start
                            <input id="assetDepStart" type="date"
                                   value="${val("depreciationStartDate")}">
                        </label>

                        <label>
                            Cost (₱)
                            <input id="assetCost" type="number" min="0.01"
                                   step="0.01" value="${val("cost")}" required>
                        </label>

                        <label>
                            Residual value (₱)
                            <input id="assetResidual" type="number" min="0"
                                   step="0.01" value="${val("residualValue", 0)}">
                        </label>

                        <label>
                            Useful life (months)
                            <input id="assetLife" type="number" min="1"
                                   max="1200" step="1"
                                   value="${val("usefulLifeMonths", 60)}" required>
                        </label>

                        <label>
                            Depreciation method
                            <select id="assetMethod">
                                <option value="straight_line"
                                    ${selected("method", "straight_line", "straight_line")}>
                                    Straight-line</option>
                                <option value="declining_balance"
                                    ${selected("method", "declining_balance", "straight_line")}>
                                    Declining balance</option>
                            </select>
                        </label>

                        <label>
                            Declining-balance rate (% per year)
                            <input id="assetRate" type="number" min="0.01"
                                   max="100" step="0.01"
                                   value="${LedgerUtils.escape(ratePct)}"
                                   placeholder="e.g. 40">
                        </label>

                        <label>
                            Depreciation already recorded (₱)
                            <input id="assetOpening" type="number" min="0"
                                   step="0.01"
                                   value="${val("openingAccumulated", 0)}">
                        </label>

                        <p class="form-note" style="grid-column:1/-1;margin:0">
                            The rate is only used for Declining balance
                            (double-declining = 200% ÷ useful life in years).
                            Fill “already recorded” only for assets you owned
                            before using Ledger.
                        </p>

                        <label>
                            Condition
                            <select id="assetCondition">
                                ${["good", "fair", "poor", "damaged"].map(c => `
                                    <option value="${c}"
                                        ${selected("condition", c, "good")}>
                                        ${c.charAt(0).toUpperCase() + c.slice(1)}
                                    </option>`).join("")}
                            </select>
                        </label>

                    </div>

                    <p class="form-note">
                        Use “Dispose” on the register to retire an asset.
                    </p>

                    <button type="submit" class="btn primary">
                        ${editing ? "Save changes" : "Add asset"}
                    </button>
                    <button type="button" class="btn" id="cancelAsset">
                        Cancel
                    </button>
                </form>
            </div>
        ` : "";

        return `

            ${this.heading(
                "Fixed Assets",
                "Register of equipment and other long-lived assets.",
                `<button type="button" class="btn primary" id="addAsset">
                    + Add fixed asset
                </button>`
            )}

            <div class="grid metric-grid">

                ${this.metric(
                    "ACTIVE ASSETS",
                    String(active.length),
                    "Not yet disposed",
                    "▣"
                )}

                ${this.metric(
                    "TOTAL COST",
                    LedgerUtils.peso(totalCost),
                    "Active assets, at cost",
                    "₱"
                )}

                ${this.metric(
                    "CARRYING AMOUNT",
                    LedgerUtils.peso(totalCarrying),
                    "Cost less accumulated depreciation",
                    "▣"
                )}

            </div>

            <div style="margin-top:16px">${form}</div>

            <div class="card table-card">

                <div class="card-head">
                    <h3>Asset register</h3>
                    <span class="tiny muted">${assets.length} records</span>
                </div>

                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>ASSET</th>
                                <th>ACQUIRED</th>
                                <th>COST</th>
                                <th>METHOD</th>
                                <th>ACCUM. DEPR.</th>
                                <th>CARRYING AMOUNT</th>
                                <th>STATUS</th>
                                <th>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>

            </div>
        `;
    }


    // =====================================================
    // SUPPLIES REGISTER
    // =====================================================

    supplies() {

        const state = this.state;
        const items = state.supplies;

        const editing = state.editingSupplyId
            ? items.find(i => i.id === state.editingSupplyId)
            : null;

        const val = (field, fallback = "") =>
            LedgerUtils.escape(
                String(editing ? (editing[field] ?? fallback) : fallback)
            );

        const isLow = i =>
            i.minStockLevel > 0 && i.unitsOnHand <= i.minStockLevel;

        const totalValue = items.reduce(
            (sum, i) => sum + i.unitsOnHand * i.unitCost, 0
        );

        const lowCount = items.filter(isLow).length;

        const rows = items.length
            ? items.map(i => `
                <tr>
                    <td>
                        <strong>${LedgerUtils.escape(i.name)}</strong>
                        ${i.description
                            ? `<div class="tiny muted">${LedgerUtils.escape(i.description)}</div>`
                            : ""}
                    </td>
                    <td>${LedgerUtils.escape(i.category)}</td>
                    <td>
                        ${i.unitsOnHand.toLocaleString()}
                        ${isLow(i)
                            ? '<span class="badge review">LOW STOCK</span>'
                            : ""}
                    </td>
                    <td>${LedgerUtils.peso(i.unitCost)}</td>
                    <td>${LedgerUtils.peso(i.unitsOnHand * i.unitCost)}</td>
                    <td>${LedgerUtils.escape(i.lastCountDate) || "—"}</td>
                    <td>
                        <button type="button" class="btn"
                            data-edit-supply="${LedgerUtils.escape(i.id)}"
                        >Edit</button>
                        <button type="button" class="btn"
                            data-count-supply="${LedgerUtils.escape(i.id)}"
                        >Count</button>
                    </td>
                </tr>
            `).join("")
            : `
                <tr>
                    <td colspan="7">
                        <div class="empty-state">
                            No supplies yet. Use “Add supplies item”
                            to register your first one.
                        </div>
                    </td>
                </tr>
            `;

        const form = state.supplyFormOpen ? `
            <div class="card" style="margin-bottom:16px">
                <h3 style="margin-top:0">
                    ${editing ? "Edit supplies item" : "Add supplies item"}
                </h3>

                <form id="supplyForm">
                    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">

                        <label style="grid-column:1/-1">
                            Item name
                            <input id="supplyName" type="text" maxlength="150"
                                   value="${val("name")}" required>
                        </label>

                        <label>
                            Category
                            <input id="supplyCategory" type="text"
                                   value="${val("category", "General")}">
                        </label>

                        <label>
                            Description
                            <input id="supplyDescription" type="text"
                                   value="${val("description")}">
                        </label>

                        <label>
                            Units on hand
                            <input id="supplyUnits" type="number" min="0"
                                   step="0.01" value="${val("unitsOnHand")}" required>
                        </label>

                        <label>
                            Unit cost (₱)
                            <input id="supplyCost" type="number" min="0"
                                   step="0.01" value="${val("unitCost")}" required>
                        </label>

                        <label>
                            Minimum stock level
                            <input id="supplyMin" type="number" min="0"
                                   step="0.01" value="${val("minStockLevel", 0)}">
                        </label>

                        <label>
                            Last count date
                            <input id="supplyCountDate" type="date"
                                   max="${LedgerUtils.today()}"
                                   value="${val("lastCountDate")}">
                        </label>

                    </div>

                    <button type="submit" class="btn primary">
                        ${editing ? "Save changes" : "Add item"}
                    </button>
                    <button type="button" class="btn" id="cancelSupply">
                        Cancel
                    </button>
                </form>
            </div>
        ` : "";

        return `

            ${this.heading(
                "Supplies",
                "Consumable supplies on hand, with low-stock warnings.",
                `<button type="button" class="btn primary" id="addSupply">
                    + Add supplies item
                </button>`
            )}

            <div class="grid metric-grid">

                ${this.metric(
                    "ITEMS",
                    String(items.length),
                    "Supplies tracked",
                    "▤"
                )}

                ${this.metric(
                    "SUPPLIES VALUE",
                    LedgerUtils.peso(totalValue),
                    "Units × unit cost",
                    "₱"
                )}

                ${this.metric(
                    "LOW STOCK",
                    String(lowCount),
                    "At or below minimum",
                    "!"
                )}

            </div>

            <div style="margin-top:16px">${form}</div>

            <div class="card table-card">

                <div class="card-head">
                    <h3>Supplies register</h3>
                    <span class="tiny muted">${items.length} records</span>
                </div>

                <div class="table-wrap">
                    <table>
                        <thead>
                            <tr>
                                <th>ITEM</th>
                                <th>CATEGORY</th>
                                <th>ON HAND</th>
                                <th>UNIT COST</th>
                                <th>TOTAL VALUE</th>
                                <th>LAST COUNT</th>
                                <th>ACTIONS</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>

            </div>
        `;
    }


    getPages() {

        return {

            dashboard: () => this.dashboard(),

            transactions: () => this.transactions(),

            journal: () => this.journal(),

                        ledger: () => this.ledger(),

            chartOfAccounts: () => this.chartOfAccounts(),


            trialBalance: () => this.trialBalance(),

            adjustingEntries: () => this.adjustingEntries(),

            adjustedTrialBalance: () => this.adjustedTrialBalance(),

            financialStatements: () => this.financialStatements(),

            receipts: () => this.receipts(),

            inventory: () => this.inventory(),

            fixedAssets: () => this.fixedAssets(),

            supplies: () => this.supplies(),

            reportingPeriods: () => this.reportingPeriods(),

            reconciliation: () => this.reconciliation(),

            adjustmentReview: () => this.adjustmentReview(),

            yearEndClosing: () => this.yearEndClosing(),

            auditTrail: () => this.auditTrail(),

            periodEnd: () => this.periodEnd(),

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

            adjustingEntries: "Adjusting Entries",

            adjustedTrialBalance: "Adjusted Trial Balance",

            financialStatements: "Financial Statements",

            receipts: "Receipts",

            inventory: "Inventory",

            fixedAssets: "Fixed Assets",

            supplies: "Supplies",

            reportingPeriods: "Reporting Periods",

            reconciliation: "Reconciliation",

            adjustmentReview: "Adjustment Review",

            yearEndClosing: "Year-End Closing",

            auditTrail: "Audit Trail",

            periodEnd: "Period-End Guide",

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
                await this.api.loadInventory();

            } catch (error) {

                if (!this.api.getToken()) return;

                LedgerUtils.toast(
                    "Inventory could not be loaded: " + error.message,
                    "error"
                );
            }

            try {
                await this.api.loadFixedAssets();

            } catch (error) {

                if (!this.api.getToken()) return;

                LedgerUtils.toast(
                    "Fixed assets could not be loaded: " + error.message,
                    "error"
                );
            }

            try {
                await this.api.loadSupplies();

            } catch (error) {

                if (!this.api.getToken()) return;

                LedgerUtils.toast(
                    "Supplies could not be loaded: " + error.message,
                    "error"
                );
            }

            try {
                await this.api.loadAdjustments();

            } catch (error) {

                if (!this.api.getToken()) return;

                LedgerUtils.toast(
                    "Adjusting entries could not be loaded: " + error.message,
                    "error"
                );
            }


            try {
                await this.api.loadProposals();

            } catch (error) {

                if (!this.api.getToken()) return;

                LedgerUtils.toast(
                    "Adjustments could not be loaded: " + error.message,
                    "error"
                );
            }

            try {
                await this.api.loadReporting();

            } catch (error) {

                if (!this.api.getToken()) return;

                LedgerUtils.toast(
                    "Reporting periods could not be loaded: " + error.message,
                    "error"
                );
            }

            try {
                await Promise.all([
                    this.api.loadAccountClasses(),
                    this.api.loadSavedReports(),
                    this.api.loadClosings()
                ]);

            } catch (error) {

                if (!this.api.getToken()) return;

                LedgerUtils.toast(
                    "Statement settings and year-end data could not be loaded: " +
                        error.message,
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

        if (page === "reconciliation") {
            this.ensureReconciliation();
        }


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
                    "0 0 0 3px #2563eb";

                window.setTimeout(() => {
                    target.style.boxShadow = "";
                }, 2500);
            }
        }
    }


    // =====================================================
    // TRANSACTION MODAL
    // =====================================================

    // Fill the Type select, then the Category select for that type.
    populateTransactionTypes() {

        const typeSelect = document.getElementById("txType");

        if (!typeSelect) return;

        const current = typeSelect.value;

        typeSelect.innerHTML = LedgerUtils.typeOptions(
            LedgerUtils.TRANSACTION_TYPES[current]
                ? current
                : "expense"
        );

        this.populateTransactionCategories();
    }

    // Purchase and Sale also ask for the item, quantity and unit price.
    // The total amount is worked out from those and is not typed in.
    updateStockFields() {

        const type = document.getElementById("txType")?.value;

        const effect = LedgerUtils.stockEffect(type);

        const help = document.getElementById("txTypeHelp");

        if (help) {
            help.textContent =
                LedgerUtils.TRANSACTION_TYPES[type]?.help || "";
        }

        // A category with only one choice is not worth asking about.
        const categoryLabel =
            document.getElementById("txCategoryLabel");

        const categorySelect =
            document.getElementById("txCategory");

        if (categoryLabel && categorySelect) {
            categoryLabel.style.display =
                categorySelect.options.length <= 1 ? "none" : "";
        }

        const box = document.getElementById("inventoryFields");

        if (!box) return;

        box.style.display = effect ? "" : "none";

        const amount = document.getElementById("txAmount");

        if (amount) {

            // Leaving a purchase/sale: drop the calculated total.
            if (!effect && amount.readOnly) amount.value = "";

            amount.readOnly = Boolean(effect);
            amount.required = !effect;

            amount.placeholder = effect ? "Calculated" : "0.00";
        }

        const amountLabel = document.getElementById("txAmountLabel");

        if (amountLabel) {
            amountLabel.textContent = effect
                ? "Total amount (₱) — calculated"
                : "Amount (₱)";
        }

        const unitLabel = document.getElementById("txUnitPriceLabel");

        if (unitLabel) {
            unitLabel.textContent = effect === "in"
                ? "Unit cost (₱) — price paid per item"
                : "Unit price (₱) — price per item sold";
        }

        ["txItem", "txQuantity", "txUnitPrice"].forEach(id => {
            const field = document.getElementById(id);
            if (field) field.required = Boolean(effect);
        });

        const list = document.getElementById("inventoryItemList");

        if (list) {
            list.innerHTML = this.state.inventory.map(entry =>
                `<option value="${LedgerUtils.escape(entry.name)}"></option>`
            ).join("");
        }

        this.recalculateStockAmount();
    }

    // total = quantity x unit price
    recalculateStockAmount() {

        const type = document.getElementById("txType")?.value;

        if (LedgerUtils.stockEffect(type)) {

            const quantity =
                Number(document.getElementById("txQuantity")?.value);

            const unit =
                Number(document.getElementById("txUnitPrice")?.value);

            const amount = document.getElementById("txAmount");

            if (amount) {
                amount.value =
                    quantity > 0 && unit > 0
                        ? (Math.round(quantity * unit * 100) / 100)
                            .toFixed(2)
                        : "";
            }
        }

        this.updateStockHint();
    }

    updateStockHint() {

        const hint = document.getElementById("txStockHint");

        if (!hint) return;

        const type = document.getElementById("txType")?.value;
        const effect = LedgerUtils.stockEffect(type);

        if (!effect) {
            hint.textContent = "";
            return;
        }

        const name = document.getElementById("txItem")?.value.trim() || "";
        const quantity = Number(document.getElementById("txQuantity")?.value);
        const unit = Number(document.getElementById("txUnitPrice")?.value);

        const stock = this.state.inventory.find(
            entry => entry.name.toLowerCase() === name.toLowerCase()
        );

        const parts = [];

        if (effect === "in") {

            if (name && stock) {
                parts.push(
                    `Existing item — ${stock.quantity} currently in stock.`
                );
            } else if (name) {
                parts.push("New item — it will be added to your inventory.");
            } else {
                parts.push("Adds to your inventory.");
            }

        } else if (name && !stock) {

            parts.push(
                "This item is not in your inventory yet. " +
                "Record a Purchase first."
            );

        } else if (stock) {

            parts.push(
                `In stock: ${stock.quantity}. ` +
                `Average cost: ${LedgerUtils.peso(stock.averageCost)} each.`
            );

            if (quantity > stock.quantity) {
                parts.push("Not enough stock for this quantity.");
            }

        } else {

            parts.push("Deducts from your inventory.");
        }

        if (quantity > 0 && unit > 0) {

            parts.push(
                `${quantity} × ${LedgerUtils.peso(unit)} = ` +
                `${LedgerUtils.peso(quantity * unit)}.`
            );
        }

        hint.textContent = parts.join(" ");
    }

    populateTransactionCategories() {

        const typeSelect = document.getElementById("txType");

        const categorySelect =
            document.getElementById("txCategory");

        if (!typeSelect || !categorySelect) return;

        categorySelect.innerHTML =
            LedgerUtils.categoryOptions(typeSelect.value);

        this.updateStockFields();
    }

    openModal() {

        document.getElementById("modalBackdrop").hidden =
            false;

        document.getElementById("txDate").value =
            LedgerUtils.today();

        this.populateTransactionTypes();

        ["txItem", "txQuantity", "txUnitPrice"].forEach(id => {
            const field = document.getElementById(id);
            if (field) field.value = "";
        });

        this.updateStockFields();

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

        if (this.guardClosedDate(date)) return;

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

        const stockEffect = LedgerUtils.stockEffect(type);

        const itemName =
            document.getElementById("txItem")?.value.trim() || "";

        const quantity =
            Number(document.getElementById("txQuantity")?.value);


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
                stockEffect
                    ? "Enter the item, quantity and unit price."
                    : "Enter an amount greater than zero.",
                "error"
            );

            return;
        }


        if (
            stockEffect &&
            (
                !itemName ||
                !Number.isFinite(quantity) ||
                quantity <= 0
            )
        ) {

            LedgerUtils.toast(
                "Enter the item name and a quantity greater than zero.",
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

                    ...(stockEffect
                        ? { item_name: itemName, quantity }
                        : {}),

                    status: "approved"

                });


            const saved =
                result.transaction || result;


            if (!saved.id) {

                throw new Error(
                    "The server did not return the saved transaction ID."
                );
            }


            let receiptUploadResult = null;

            if (file) {

                receiptUploadResult = await this.addReceiptFiles(
                    [file],
                    false,
                    saved.id
                );
            }


            await this.api.loadTransactions();

            await this.api.loadJournalEntries();

            await this.api.loadInventory();


            this.closeModal();

            this.render("journal");


            if (file && receiptUploadResult?.failed) {

                LedgerUtils.toast(
                    "Transaction saved, but receipt upload failed: " +
                    receiptUploadResult.error.message,
                    "error"
                );

            } else if (file) {

                LedgerUtils.toast(
                    "Transaction and receipt saved to the database."
                );

            } else {

                LedgerUtils.toast(
                    stockEffect === "in"
                        ? "Purchase saved and inventory updated."
                        : stockEffect === "out"
                            ? "Sale saved and inventory updated."
                            : "Transaction saved to PostgreSQL."
                );
            }

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

                    await this.api.loadInventory();

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
    // ADJUSTING ENTRIES
    // -----------------------------------------------------

    // Fill the form with the usual accounts for the chosen type.
    applyAdjustmentPreset() {

        const type = document.getElementById("adjType")?.value;

        const preset = LedgerUtils.ADJUSTMENT_TYPES[type];

        if (!preset) return;

        const set = (id, value) => {
            const field = document.getElementById(id);
            if (field) field.value = value;
        };

        set("adjDescription", preset.description);
        set("adjDebit", preset.debit.account);
        set("adjCredit", preset.credit.account);

        const help = document.getElementById("adjHelp");

        if (help) help.textContent = preset.help;

        this.updateAdjustmentHint();
    }

    updateAdjustmentHint() {

        const hint = document.getElementById("adjHint");

        if (!hint) return;

        const missing = ["adjDebit", "adjCredit"]
            .map(id => document.getElementById(id)?.value.trim() || "")
            .filter(name => name && !LedgerUtils.findAccount(name));

        hint.textContent = missing.length
            ? `Not in your Chart of Accounts yet: ${[...new Set(missing)].join(", ")}. ` +
              `The entry will still post, but add the account in Chart of Accounts ` +
              `so it is classified correctly everywhere.`
            : "";
    }

    async addAdjustment(event) {

        event.preventDefault();

        const value = id =>
            document.getElementById(id)?.value.trim() || "";

        const type = value("adjType");
        const date = value("adjDate");
        const description = value("adjDescription");
        const debitName = value("adjDebit");
        const creditName = value("adjCredit");

        const amount =
            Math.round(Number(value("adjAmount")) * 100) / 100;

        const fail = message =>
            LedgerUtils.toast(message, "error");

        if (this.guardClosedDate(date)) return;

        if (!date || !description || !debitName || !creditName) {
            return fail("Complete all required fields.");
        }

        if (date > LedgerUtils.today()) {
            return fail("The date cannot be in the future.");
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            return fail("Enter an amount greater than zero.");
        }

        if (debitName.toLowerCase() === creditName.toLowerCase()) {
            return fail("The debit and credit accounts must be different.");
        }

        const preset = LedgerUtils.ADJUSTMENT_TYPES[type];

        const button =
            event.currentTarget?.querySelector('button[type="submit"]');

        if (button) button.disabled = true;

        try {

            await this.api.saveAdjustment({
                entry_date: date,
                adjustment_type: type,
                description,
                lines: [
                    {
                        account_name: debitName,
                        account_type: LedgerUtils.resolveAccountType(
                            debitName, preset?.debit
                        ),
                        debit: amount,
                        credit: 0
                    },
                    {
                        account_name: creditName,
                        account_type: LedgerUtils.resolveAccountType(
                            creditName, preset?.credit
                        ),
                        debit: 0,
                        credit: amount
                    }
                ]
            });

            await this.api.loadAdjustments();

            this.render("adjustingEntries");

            LedgerUtils.toast("Adjusting entry recorded.");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");

            if (button) button.disabled = false;
        }
    }

    async deleteAdjustment(id) {

        const entry =
            this.state.adjustments.find(item => item.id === String(id));

        if (!entry) return;

        if (this.guardClosedDate(entry.date)) return;

        const total = entry.lines.reduce(
            (sum, line) => sum + line.debit, 0
        );

        if (!window.confirm(
            `Delete this adjusting entry?\n\n` +
            `${entry.date} · ${entry.description} · ` +
            `${LedgerUtils.peso(total)}\n\n` +
            `Your Adjusted Trial Balance and Financial Statements ` +
            `will change. This cannot be undone.`
        )) {
            return;
        }

        try {

            await this.api.deleteAdjustment(id);

            await this.api.loadAdjustments();

            this.render("adjustingEntries");

            LedgerUtils.toast("Adjusting entry deleted.");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    // -----------------------------------------------------
    // ADJUSTED TRIAL BALANCE DATE + EXPORT
    // -----------------------------------------------------

    updateAdjustedTbDate(value) {

        if (!value) {

            LedgerUtils.toast("Choose a reporting date.", "error");

            return;
        }

        if (value > LedgerUtils.today()) {

            LedgerUtils.toast(
                "The reporting date cannot be in the future.",
                "error"
            );

            return;
        }

        this.state.adjustedTbDate = value;

        this.render("adjustedTrialBalance");
    }

    exportAdjustedTbCSV() {

        const asOfDate =
            this.state.adjustedTbDate || LedgerUtils.today();

        const report =
            LedgerAccounting.adjustedTrialBalance(this.state, asOfDate);

        const money = amount => amount.toFixed(2);

        const rows = [

            [
                "Account Name", "Account Type",
                "Unadjusted Debit", "Unadjusted Credit",
                "Adjustment Debit", "Adjustment Credit",
                "Adjusted Debit", "Adjusted Credit"
            ],

            ...report.rows.map(row => [
                row.account, row.accountType,
                money(row.unDebit), money(row.unCredit),
                money(row.adjDebit), money(row.adjCredit),
                money(row.finalDebit), money(row.finalCredit)
            ]),

            [
                "TOTAL", "",
                money(report.totals.unDebit), money(report.totals.unCredit),
                money(report.totals.adjDebit), money(report.totals.adjCredit),
                money(report.totals.finalDebit), money(report.totals.finalCredit)
            ]
        ];

        const csv = rows
            .map(row =>
                row.map(value => LedgerUtils.csvEscape(value)).join(",")
            )
            .join("\r\n");

        const blob = new Blob(
            ["\uFEFF", csv],
            { type: "text/csv;charset=utf-8;" }
        );

        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");

        link.href = url;

        link.download = `ledger-adjusted-trial-balance-${asOfDate}.csv`;

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);

        LedgerUtils.toast("Adjusted Trial Balance exported successfully.");
    }


    // -----------------------------------------------------
    // FINANCIAL STATEMENTS PERIOD + EXPORT
    // -----------------------------------------------------

    // =====================================================
    // RECONCILIATION + ADJUSTMENT REVIEW (controller)
    // =====================================================

    async ensureReconciliation() {

        const period = this.state.getReportingPeriod();
        const recon = this.state.recon;

        if (!period || recon.periodId === period.id || recon.loading) return;

        recon.loading = true;

        try {

            const data = await this.api.getReconciliation(period.id);

            this.state.recon = {
                ...LedgerState.emptyRecon(),
                periodId: period.id,
                draft: data.draft || {},
                steps: data.steps || {}
            };

        } catch (error) {

            recon.loading = false;

            LedgerUtils.toast(error.message, "error");

            return;
        }

        if (this.state.currentPage === "reconciliation") {
            this.render("reconciliation");
        }
    }

    // Copy whatever is typed on the current step into the saved draft.
    collectReconDraft() {

        const root = document.getElementById("pageContent");

        if (!root) return;

        const draft = this.state.recon.draft;

        const number = element =>
            element.value === "" ? null : Number(element.value);

        const byId = (selector, id) =>
            root.querySelector(`${selector}[data-id="${id}"]`);

        // Step 1 - inventory
        const actuals = root.querySelectorAll('[data-rc="inv-actual"]');

        if (actuals.length) {

            draft.inventory = draft.inventory || {};

            actuals.forEach(input => {

                const id = input.dataset.id;

                draft.inventory[id] = {
                    actual: number(input),
                    status: byId('[data-rc="inv-status"]', id)?.value || "ok",
                    nrv: number(byId('[data-rc="inv-nrv"]', id) || { value: "" }),
                    note: byId('[data-rc="inv-note"]', id)?.value.trim() || ""
                };
            });
        }

        // Step 2 - supplies
        const quantities = root.querySelectorAll('[data-rc="sup-qty"]');

        if (quantities.length) {

            const counts = {};

            quantities.forEach(input => {

                const id = input.dataset.id;

                counts[id] = {
                    quantity: number(input),
                    unit_cost: number(byId('[data-rc="sup-cost"]', id) || { value: "" })
                };
            });

            draft.supplies = {
                counts,
                discarded:
                    root.querySelector('[data-rc="sup-discarded"]')?.value.trim() || "",
                purchased:
                    root.querySelector('[data-rc="sup-purchased"]')?.value.trim() || ""
            };
        }

        // Step 3 - assets
        const reviewed = root.querySelector('[data-rc="assets-reviewed"]');

        if (reviewed) draft.assets_reviewed = reviewed.checked;

        // Step 4 - unpaid expenses
        if (this.state.recon.step === 4) {

            draft.expenses = [...root.querySelectorAll("[data-rc-row]")]
                .map(card => {

                    const get = name =>
                        card.querySelector(`[data-rc="${name}"]`);

                    return {
                        id: card.dataset.rcRow,
                        description: get("exp-desc").value.trim(),
                        amount: number(get("exp-amount")),
                        date: get("exp-date").value,
                        debit_account: get("exp-debit").value,
                        credit_account: get("exp-credit").value,
                        payment_status: get("exp-status").value,
                        notes: get("exp-notes").value.trim()
                    };
                });
        }
    }

    reconStepKey() {
        return ["inventory", "supplies", "assets", "expenses", "review"][
            this.state.recon.step - 1
        ];
    }

    async saveReconciliation(markStepComplete = false) {

        const period = this.state.getReportingPeriod();
        const recon = this.state.recon;

        if (!period || recon.periodId !== period.id) return false;

        const answersBefore = JSON.stringify(recon.draft);

        this.collectReconDraft();

        if (
            recon.steps.generated &&
            JSON.stringify(recon.draft) !== answersBefore
        ) {
            delete recon.steps.generated;
        }

        const key = this.reconStepKey();

        recon.steps[key] = markStepComplete
            ? "complete"
            : recon.steps[key] || "in_progress";

        try {

            await this.api.saveReconciliation(
                period.id, recon.draft, recon.steps
            );

            await this.api.loadReporting();

            return true;

        } catch (error) {

            LedgerUtils.toast(error.message, "error");

            return false;
        }
    }

    async goToReconStep(step) {

        const recon = this.state.recon;

        if (!await this.saveReconciliation(false)) return;

        recon.step = Math.min(Math.max(step, 1), 5);

        this.render("reconciliation");
    }

    addReconExpense(preset) {

        this.collectReconDraft();

        const period = this.state.getReportingPeriod();

        const find = (type, pattern) =>
            LedgerUtils.chart.find(account =>
                account.is_active &&
                account.account_type === type &&
                pattern.test(account.account_name)
            )?.account_name || "";

        const keywords = {
            "Electricity bill": /utilit|electric/i,
            "Water bill": /utilit|water/i,
            "Internet bill": /utilit|internet|communic/i,
            "Salaries": /salar|wage/i,
            "Rent": /rent/i,
            "Supplier payment": /accounts payable|payable/i,
            "Interest": /interest/i
        }[preset];

        const debit = keywords ? find("expense", keywords) : "";

        const credit = keywords
            ? find("liability", keywords) || find("liability", /accounts payable|payable/i)
            : find("liability", /accounts payable|payable/i);

        const rows = this.state.recon.draft.expenses || [];

        rows.push({
            id: window.crypto?.randomUUID
                ? window.crypto.randomUUID()
                : String(Date.now()) + Math.random().toString(16).slice(2),
            description: preset,
            amount: null,
            date: period.end > LedgerUtils.today()
                ? LedgerUtils.today() : period.end,
            debit_account: debit,
            credit_account: credit,
            payment_status: "unpaid",
            notes: ""
        });

        this.state.recon.draft.expenses = rows;

        this.render("reconciliation");
    }

    removeReconExpense(id) {

        this.collectReconDraft();

        this.state.recon.draft.expenses =
            (this.state.recon.draft.expenses || [])
                .filter(row => row.id !== id);

        this.render("reconciliation");
    }

    async refreshAfterPosting() {

        const jobs = [
            this.api.loadProposals(),
            this.api.loadAdjustments(),
            this.api.loadInventory(),
            this.api.loadSupplies(),
            this.api.loadFixedAssets(),
            this.api.loadReporting(),
            this.api.loadClosings()
        ];

        const results = await Promise.allSettled(jobs);

        const failed = results.find(r => r.status === "rejected");

        if (failed && this.api.getToken()) {
            LedgerUtils.toast(
                "Some data could not be refreshed: " + failed.reason.message,
                "error"
            );
        }
    }

    async generateAdjustments() {

        const period = this.state.getReportingPeriod();
        const recon = this.state.recon;

        if (!period) return;

        const waiting = this.state.getPeriodProposals(period.id)
            .filter(p => LedgerState.isWaiting(p)).length;

        if (
            waiting > 0 &&
            !window.confirm(
                `${waiting} entr${waiting === 1 ? "y is" : "ies are"} still waiting ` +
                `for approval. Creating the entries again replaces them, ` +
                `including any you revised. Approved entries are not touched. Continue?`
            )
        ) {
            return;
        }

        if (!await this.saveReconciliation(true)) return;

        const account = LedgerAccounting.suppliesAccountName();

        try {

            const result = await this.api.generateAdjustments(period.id, {
                as_of: LedgerUtils.today(),
                supplies_account: account,
                book_supplies_balance: LedgerAccounting.accountBalance(
                    this.state, account, period.end
                )
            });

            recon.warnings = result.warnings || [];

            // Remember that the entries were created (even if none were
            // needed), so the reconciliation can be marked complete.
            recon.steps.generated = "complete";

            await this.api.saveReconciliation(
                period.id, recon.draft, recon.steps
            );

            await this.refreshAfterPosting();

            this.render("reconciliation");

            LedgerUtils.toast(
                result.created
                    ? `${result.created} adjusting entr${result.created === 1 ? "y" : "ies"} ready for your review.`
                    : "No new adjustments are needed.",
                result.created ? "success" : ""
            );

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    async completeReconciliation() {

        const period = this.state.getReportingPeriod();

        if (!period) return;

        try {

            await this.api.completeReconciliation(period.id);

            // With every adjustment decided, the adjusted trial balance is
            // ready if the books balance.
            const report = LedgerAccounting.adjustedTrialBalance(
                this.state, period.end
            );

            if (report.hasRows && report.finalBalanced) {
                await this.api.setPeriodStatus(
                    period.id, "adjusted_tb_status", "complete"
                );
            }

            await this.api.loadReporting();

            this.render("reconciliation");

            LedgerUtils.toast("Reconciliation complete.", "success");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    async decideProposal(action, id) {

        const proposal = this.state.proposals.find(p => p.id === id);

        if (!proposal) return;

        try {

            if (action === "approve") {

                if (!window.confirm(
                    `Post "${proposal.description}" to your books? ` +
                    `Posted entries cannot be deleted.`
                )) return;

                await this.api.approveProposal(id);

            } else if (action === "reject") {

                const note = window.prompt(
                    "Why are you rejecting this entry? (optional)", ""
                );

                if (note === null) return;

                await this.api.rejectProposal(id, note);

            } else if (action === "flag") {

                const note = window.prompt(
                    "What needs to change? (optional)", ""
                );

                if (note === null) return;

                await this.api.flagProposal(id, note);
            }

            await this.refreshAfterPosting();

            this.render("adjustmentReview");

            LedgerUtils.toast(
                action === "approve" ? "Entry approved and posted." : "Entry updated.",
                "success"
            );

        } catch (error) {

            LedgerUtils.toast(error.message, "error");

            // The record may have changed; show the latest.
            await this.refreshAfterPosting();
            this.render("adjustmentReview");
        }
    }

    async saveProposalRevision(id) {

        const proposal = this.state.proposals.find(p => p.id === id);

        if (!proposal) return;

        const root = document.getElementById("adjustment-" + id);

        const lines = proposal.lines.map((line, index) => {

            const account = root.querySelector(
                `[data-rv="account"][data-i="${index}"]`
            )?.value || "";

            const amount = Number(
                root.querySelector(`[data-rv="amount"][data-i="${index}"]`)?.value
            ) || 0;

            return {
                account_name: account,
                debit: line.debit > 0 ? amount : 0,
                credit: line.credit > 0 ? amount : 0
            };
        });

        try {

            await this.api.reviseProposal(id, {
                description: root.querySelector("#rvDescription").value,
                entry_date: root.querySelector("#rvDate").value,
                lines
            });

            this.state.editingProposalId = null;

            await this.api.loadProposals();

            this.render("adjustmentReview");

            LedgerUtils.toast("Entry revised.", "success");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    // -----------------------------------------------------
    // STATEMENT REPORTS + ACCOUNT GROUPS
    // -----------------------------------------------------

    statementSnapshot(start, end) {

        const fs = LedgerAccounting.financialStatements(this.state, start, end);
        const cash = LedgerAccounting.cashFlowStatement(this.state, start, end);

        return {
            startDate: start,
            endDate: end,
            income: fs.incomeRows,
            equity: fs.equityRows,
            balance: fs.balanceRows,
            cash: cash.rows,
            netIncome: fs.netIncome,
            totalAssets: fs.totalAssets,
            totalLiabilities: fs.totalLiabilities,
            totalEquity: fs.totalEquity,
            savedAt: new Date().toISOString()
        };
    }

    async saveStatementReport() {

        const start = this.state.statementStart;
        const end = this.state.statementEnd;

        const trial = LedgerAccounting.adjustedTrialBalance(this.state, end);

        if (trial.hasRows && !trial.finalBalanced) {

            LedgerUtils.toast(
                "The adjusted trial balance does not balance, so the report cannot be saved.",
                "error"
            );

            return;
        }

        const today = LedgerUtils.today();

        const period = this.state.reporting.periods.find(p =>
            p.start === start &&
            (p.end === end || (p.end > today && end === today))
        );

        try {

            await this.api.saveReportSnapshot({
                title: period
                    ? `${period.label} financial statements`
                    : `Financial statements ${start} to ${end}`,
                start_date: start,
                end_date: end,
                period_id: period ? period.id : undefined,
                data: this.statementSnapshot(start, end)
            });

            await Promise.all([
                this.api.loadSavedReports(),
                this.api.loadReporting()
            ]);

            LedgerUtils.toast("Report saved.", "success");

            this.render("financialStatements");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    async saveAccountGroups() {

        const changes = [];

        document.querySelectorAll("[data-class-account]").forEach(select => {

            const name = select.dataset.classAccount;

            const saved =
                this.state.accountClasses.get(name.toLowerCase()) || "";

            if (select.value !== saved) {
                changes.push({ account_name: name, class: select.value });
            }
        });

        if (!changes.length) {
            LedgerUtils.toast("No changes to save.", "success");
            return;
        }

        try {

            await this.api.saveAccountClasses(changes);

            LedgerUtils.toast("Account groups saved.", "success");

            this.render("financialStatements");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    async viewSavedReport(id) {

        try {

            const data = await this.api.request(
                `/statements/reports/${encodeURIComponent(id)}`
            );

            this.state.viewedReport = data.report;

            this.render("financialStatements");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    // -----------------------------------------------------
    // YEAR-END CLOSING ACTIONS
    // -----------------------------------------------------

    async refreshClosingChecks() {

        const c = this.state.closing;
        const fy = this.state.getClosingYear();

        if (!fy || c.busy) return;

        c.busy = true;

        try {
            c.checks = await this.api.loadClosingChecks(fy.start);
        } catch (error) {
            c.checks = { error: error.message };
        }

        c.busy = false;

        if (this.state.currentPage === "yearEndClosing") {
            this.render("yearEndClosing");
        }
    }

    selectClosingYear(start) {

        const c = this.state.closing;

        c.fy = start;
        c.step = 1;
        c.checks = null;

        this.render("yearEndClosing");
    }

    goToClosingStep(step) {

        const c = this.state.closing;
        const fy = this.state.getClosingYear();

        c.step = Math.min(6, Math.max(1, step));

        if (fy && this.state.getYearClosing(fy.start)?.status !== "complete") {
            c.steps[`step${c.step}`] = true;
            this.api.saveClosingSteps(fy.start, c.steps).catch(() => {});
        }

        this.render("yearEndClosing");
    }

    async postYearEndClosing() {

        const c = this.state.closing;
        const fy = this.state.getClosingYear();

        if (!fy || c.busy) return;

        if (!document.getElementById("closingConfirm")?.checked) {
            LedgerUtils.toast(
                "Tick the box to confirm you understand the year will be locked.",
                "error"
            );
            return;
        }

        if (c.checks && c.checks.checks) {

            const failed = c.checks.checks.find(k => !k.ok);

            if (failed) {
                LedgerUtils.toast(failed.message, "error");
                c.step = 1;
                this.render("yearEndClosing");
                return;
            }
        }

        const atb = LedgerAccounting.adjustedTrialBalance(this.state, fy.end);

        if (atb.hasRows && !atb.finalBalanced) {
            LedgerUtils.toast(
                "The adjusted trial balance does not balance. Fix it before closing.",
                "error"
            );
            return;
        }

        const plan = LedgerAccounting.closingPlan(this.state, fy.start, fy.end);

        if (plan.error) {
            LedgerUtils.toast(plan.error, "error");
            return;
        }

        const pct = LedgerAccounting.postClosingTrialBalance(this.state, plan);

        if (!pct.balanced || !pct.temporaryClosed) {
            LedgerUtils.toast(
                "The post-closing balances are not right, so the year was not closed.",
                "error"
            );
            return;
        }

        c.busy = true;
        this.render("yearEndClosing");

        try {

            await this.api.closeYear(fy.start, {
                entries: plan.entries.map(entry => ({
                    description: entry.description,
                    lines: entry.lines.map(l => ({
                        account: l.account, debit: l.debit, credit: l.credit
                    }))
                })),
                opening_balances: pct.rows.map(r => ({
                    account: r.account, debit: r.debit, credit: r.credit
                })),
                net_income: plan.netIncome,
                report: {
                    title: `Annual financial statements ${fy.start} to ${fy.end}`,
                    data: this.statementSnapshot(fy.start, fy.end)
                }
            });

            await Promise.all([
                this.api.loadAdjustments(),
                this.api.loadClosings(),
                this.api.loadReporting(),
                this.api.loadSavedReports()
            ]);

            c.step = 6;
            c.checks = null;

            LedgerUtils.toast("The year is closed.", "success");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }

        c.busy = false;

        this.render("yearEndClosing");
    }

    async reopenYearEnd(id) {

        const reason = document.getElementById("reopenReason")?.value.trim();
        const confirm = document.getElementById("reopenConfirm")?.value.trim();

        if (!reason) {
            LedgerUtils.toast("Enter a reason for reopening.", "error");
            return;
        }

        if (confirm !== "REOPEN") {
            LedgerUtils.toast("Type REOPEN to confirm.", "error");
            return;
        }

        const c = this.state.closing;

        try {

            await this.api.reopenYear(id, { reason, confirm });

            await Promise.all([
                this.api.loadAdjustments(),
                this.api.loadClosings(),
                this.api.loadReporting()
            ]);

            c.step = 1;
            c.checks = null;

            LedgerUtils.toast(
                "The year is reopened. The closing entries were reversed.",
                "success"
            );

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }

        this.render("yearEndClosing");
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

    // True (and a friendly message) when a date falls in a closed year.
    guardClosedDate(...dates) {

        const closed = this.state.closedThrough();

        if (!closed) return false;

        if (!dates.some(date => date && date <= closed)) return false;

        LedgerUtils.toast(
            `The fiscal year ending ${closed} is closed, so nothing dated on or before that day can be added, changed or deleted. ` +
            `To make a correction, reopen the year on the Year-End Closing page.`,
            "error"
        );

        return true;
    }

    wireAyecas() {

        document.getElementById("reconPeriodSelect")
            ?.addEventListener("change", event => {
                this.state.reporting.selectedStart = event.target.value;
                this.render("reconciliation");
            });

        document.getElementById("guidePeriodSelect")
            ?.addEventListener("change", event => {
                this.state.reporting.selectedStart = event.target.value;
                this.render("periodEnd");
            });

        document.getElementById("closingYearSelect")
            ?.addEventListener("change", event => {
                this.selectClosingYear(event.target.value);
            });

        if (
            document.getElementById("auditList") &&
            Date.now() - (this.state.auditLoadedAt || 0) > 3000
        ) {
            this.state.auditLoadedAt = Date.now();
            this.api.loadAuditEvents()
                .catch(error => {
                    this.state.auditEvents = [];
                    LedgerUtils.toast(error.message, "error");
                })
                .then(() => {
                    if (this.state.currentPage === "auditTrail") {
                        this.render("auditTrail");
                    }
                });
        }

        if (
            document.getElementById("closingNeedsChecks") &&
            !this.state.closing.busy
        ) {
            this.refreshClosingChecks();
        }

        document.getElementById("reviewShowAll")
            ?.addEventListener("change", event => {
                this.state.reviewShowAll = event.target.checked;
                this.render("adjustmentReview");
            });

        document.querySelectorAll("[data-act]").forEach(element => {

            element.addEventListener("click", () => {

                const id = element.dataset.id;

                switch (element.dataset.act) {

                    case "recon-step":
                        this.goToReconStep(Number(element.dataset.step));
                        break;

                    case "recon-prev":
                        this.goToReconStep(this.state.recon.step - 1);
                        break;

                    case "recon-next":
                        this.saveReconciliation(true).then(saved => {
                            if (!saved) return;
                            this.state.recon.step =
                                Math.min(this.state.recon.step + 1, 5);
                            this.render("reconciliation");
                        });
                        break;

                    case "recon-save":
                        this.saveReconciliation(false).then(saved => {
                            if (saved) LedgerUtils.toast("Progress saved.", "success");
                        });
                        break;

                    case "recon-add-expense":
                        this.addReconExpense(element.dataset.preset);
                        break;

                    case "recon-remove-expense":
                        this.removeReconExpense(id);
                        break;

                    case "recon-generate":
                        this.generateAdjustments();
                        break;

                    case "recon-complete":
                        this.completeReconciliation();
                        break;

                    case "review-approve":
                        this.decideProposal("approve", id);
                        break;

                    case "guide-statements":
                        this.useReportingPeriodForStatements();
                        break;

                    case "save-report":
                        this.saveStatementReport();
                        break;

                    case "classes-save":
                        this.saveAccountGroups();
                        break;

                    case "report-view":
                        this.viewSavedReport(id);
                        break;

                    case "close-step":
                        this.goToClosingStep(Number(element.dataset.step));
                        break;

                    case "close-recheck":
                        this.refreshClosingChecks();
                        break;

                    case "close-post":
                        this.postYearEndClosing();
                        break;

                    case "close-reopen":
                        this.reopenYearEnd(id);
                        break;

                    case "review-reject":
                        this.decideProposal("reject", id);
                        break;

                    case "review-flag":
                        this.decideProposal("flag", id);
                        break;

                    case "review-revise":
                        this.state.editingProposalId = id;
                        this.render("adjustmentReview");
                        break;

                    case "review-cancel":
                        this.state.editingProposalId = null;
                        this.render("adjustmentReview");
                        break;

                    case "review-save":
                        this.saveProposalRevision(id);
                        break;
                }
            });
        });
    }


    // -----------------------------------------------------
    // REPORTING PERIODS
    // -----------------------------------------------------

    async saveReportingSettings() {

        const frequency =
            document.getElementById("reportingFrequency")?.value;

        const month = Number(
            document.getElementById("reportingFiscalStart")?.value ||
            this.state.reporting.fiscalStartMonth
        );

        try {

            await this.api.saveReportingSettings({
                frequency,
                fiscal_start_month: month
            });

            // Show the current period of the new frequency.
            this.state.reporting.selectedStart = null;

            await this.api.loadReporting();

            this.render("reportingPeriods");

            LedgerUtils.toast("Reporting settings saved.", "success");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    selectReportingPeriod(start) {

        this.state.reporting.selectedStart = start;

        this.render("reportingPeriods");
    }

    useReportingPeriodForStatements() {

        const period = this.state.getReportingPeriod();

        if (!period) return;

        this.state.statementStart = period.start;

        // Statements cannot run past today.
        this.state.statementEnd =
            period.end > LedgerUtils.today()
                ? LedgerUtils.today()
                : period.end;

        this.render("financialStatements");
    }

    updateStatementPeriod() {

        const start = document.getElementById("statementStart")?.value;
        const end = document.getElementById("statementEnd")?.value;

        if (!start || !end) {

            LedgerUtils.toast(
                "Choose both a start and an end date.",
                "error"
            );

            return;
        }

        if (end > LedgerUtils.today()) {

            LedgerUtils.toast(
                "The end date cannot be in the future.",
                "error"
            );

            return;
        }

        if (start > end) {

            LedgerUtils.toast(
                "The start date must be on or before the end date.",
                "error"
            );

            return;
        }

        this.state.statementStart = start;
        this.state.statementEnd = end;

        this.render("financialStatements");
    }

    exportStatementsCSV() {

        const trial = LedgerAccounting.adjustedTrialBalance(
            this.state, this.state.statementEnd
        );

        if (trial.hasRows && !trial.finalBalanced) {

            LedgerUtils.toast(
                "The adjusted trial balance does not balance, so the statements cannot be exported.",
                "error"
            );

            return;
        }

        const report = LedgerAccounting.financialStatements(
            this.state,
            this.state.statementStart,
            this.state.statementEnd
        );

        const rows = [];

        const addStatement = (title, subtitle, statementRows) => {

            rows.push([title, subtitle, ""]);

            statementRows.forEach(row => {
                rows.push([
                    "",
                    row.label,
                    row.kind === "section" || row.kind === "subsection"
                        ? ""
                        : row.amount.toFixed(2)
                ]);
            });

            rows.push(["", "", ""]);
        };

        const period =
            `${report.startDate} to ${report.endDate}`;

        addStatement(
            "Income Statement", `For the period ${period}`,
            report.incomeRows
        );

        addStatement(
            "Statement of Owner's Equity", `For the period ${period}`,
            report.equityRows
        );

        addStatement(
            "Balance Sheet", `As of ${report.endDate}`,
            report.balanceRows
        );

        addStatement(
            "Statement of Cash Flows", `For the period ${period}`,
            LedgerAccounting.cashFlowStatement(
                this.state, report.startDate, report.endDate
            ).rows
        );

        const csv = [["Statement", "Line", "Amount"], ...rows]
            .map(row =>
                row.map(value => LedgerUtils.csvEscape(value)).join(",")
            )
            .join("\r\n");

        const blob = new Blob(
            ["\uFEFF", csv],
            { type: "text/csv;charset=utf-8;" }
        );

        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");

        link.href = url;

        link.download =
            `ledger-financial-statements-${report.startDate}-to-${report.endDate}.csv`;

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);

        LedgerUtils.toast("Financial Statements exported successfully.");
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

        if (this.guardClosedDate(
            details.date,
            this.state.getTransaction(id)?.date
        )) return;


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

        if (this.guardClosedDate(transaction.date)) return;

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

            await this.api.loadInventory();

            this.rerenderKeepScroll();

            LedgerUtils.toast("Transaction deleted.");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }


    // =====================================================
    // FIXED ASSETS + SUPPLIES REGISTERS
    // =====================================================

    openAssetForm(id = null) {

        this.state.editingAssetId = id;
        this.state.assetFormOpen = true;

        this.rerenderKeepScroll();

        document.getElementById("assetName")?.focus();
    }

    closeAssetForm() {

        this.state.editingAssetId = null;
        this.state.assetFormOpen = false;

        this.rerenderKeepScroll();
    }

    async saveAsset(event) {

        event.preventDefault();

        const button = event.currentTarget.querySelector(
            '[type="submit"]'
        );

        const acquired =
            document.getElementById("assetAcquired").value;

        const payload = {
            name: document.getElementById("assetName").value.trim(),
            description:
                document.getElementById("assetDescription").value.trim(),
            acquisition_date: acquired,
            depreciation_start_date:
                document.getElementById("assetDepStart").value || acquired,
            cost: parseFloat(document.getElementById("assetCost").value),
            residual_value:
                parseFloat(document.getElementById("assetResidual").value) || 0,
            useful_life_months:
                parseInt(document.getElementById("assetLife").value, 10),
            method: document.getElementById("assetMethod").value,
            condition: document.getElementById("assetCondition").value,
            opening_accumulated:
                parseFloat(document.getElementById("assetOpening").value) || 0,
            declining_rate: null
        };

        if (payload.method === "declining_balance") {

            const ratePercent =
                parseFloat(document.getElementById("assetRate").value);

            if (!(ratePercent > 0 && ratePercent <= 100)) {
                LedgerUtils.toast(
                    "Enter a declining-balance rate between 0 and 100%.",
                    "error"
                );
                return;
            }

            payload.declining_rate = ratePercent / 100;
        }

        if (!payload.name || !acquired || !(payload.cost > 0)) {
            LedgerUtils.toast("Please complete the required fields.", "error");
            return;
        }

        if (payload.residual_value > payload.cost) {
            LedgerUtils.toast(
                "Residual value cannot be more than the cost.",
                "error"
            );
            return;
        }

        if (
            payload.opening_accumulated >
            payload.cost - payload.residual_value
        ) {
            LedgerUtils.toast(
                "Depreciation already recorded cannot exceed cost minus residual value.",
                "error"
            );
            return;
        }

        const editingId = this.state.editingAssetId;

        button.disabled = true;

        try {

            if (editingId) {
                await this.api.updateFixedAsset(editingId, payload);
            } else {
                await this.api.createFixedAsset(payload);
            }

            await this.api.loadFixedAssets();

            this.state.editingAssetId = null;
            this.state.assetFormOpen = false;

            this.rerenderKeepScroll();

            LedgerUtils.toast(
                editingId ? "Fixed asset updated." : "Fixed asset added."
            );

        } catch (error) {

            button.disabled = false;

            LedgerUtils.toast(error.message, "error");
        }
    }

    async disposeAsset(id) {

        const asset = this.state.fixedAssets.find(a => a.id === String(id));

        if (!asset) return;

        const confirmed = window.confirm(
            `Dispose of "${asset.name}"?\n\n` +
            `This retires the asset from the register. ` +
            `It does not record any sale proceeds or gain/loss in your ` +
            `journal. This cannot be undone.`
        );

        if (!confirmed) return;

        try {

            await this.api.deleteFixedAsset(id);

            await this.api.loadFixedAssets();

            this.rerenderKeepScroll();

            LedgerUtils.toast("Asset disposed.");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    openSupplyForm(id = null) {

        this.state.editingSupplyId = id;
        this.state.supplyFormOpen = true;

        this.rerenderKeepScroll();

        document.getElementById("supplyName")?.focus();
    }

    closeSupplyForm() {

        this.state.editingSupplyId = null;
        this.state.supplyFormOpen = false;

        this.rerenderKeepScroll();
    }

    async saveSupply(event) {

        event.preventDefault();

        const button = event.currentTarget.querySelector(
            '[type="submit"]'
        );

        const payload = {
            name: document.getElementById("supplyName").value.trim(),
            category:
                document.getElementById("supplyCategory").value.trim() ||
                "General",
            description:
                document.getElementById("supplyDescription").value.trim(),
            units_on_hand:
                parseFloat(document.getElementById("supplyUnits").value),
            unit_cost:
                parseFloat(document.getElementById("supplyCost").value),
            min_stock_level:
                parseFloat(document.getElementById("supplyMin").value) || 0,
            last_count_date:
                document.getElementById("supplyCountDate").value || null
        };

        if (
            !payload.name ||
            !(payload.units_on_hand >= 0) ||
            !(payload.unit_cost >= 0)
        ) {
            LedgerUtils.toast("Please complete the required fields.", "error");
            return;
        }

        const editingId = this.state.editingSupplyId;

        button.disabled = true;

        try {

            if (editingId) {
                await this.api.updateSupply(editingId, payload);
            } else {
                await this.api.createSupply(payload);
            }

            await this.api.loadSupplies();

            this.state.editingSupplyId = null;
            this.state.supplyFormOpen = false;

            this.rerenderKeepScroll();

            LedgerUtils.toast(
                editingId ? "Supplies item updated." : "Supplies item added."
            );

        } catch (error) {

            button.disabled = false;

            LedgerUtils.toast(error.message, "error");
        }
    }

    async countSupply(id) {

        const item = this.state.supplies.find(i => i.id === String(id));

        if (!item) return;

        const answer = window.prompt(
            `Counted units on hand for "${item.name}":`,
            String(item.unitsOnHand)
        );

        if (answer === null) return;

        const quantity = Number(answer);

        if (answer.trim() === "" || !Number.isFinite(quantity) || quantity < 0) {
            LedgerUtils.toast("Enter a valid count (0 or more).", "error");
            return;
        }

        try {

            await this.api.recordSupplyCount(
                id,
                quantity,
                LedgerUtils.today()
            );

            await this.api.loadSupplies();

            this.rerenderKeepScroll();

            LedgerUtils.toast("Stock count recorded.");

        } catch (error) {

            LedgerUtils.toast(error.message, "error");
        }
    }

    wireRegisters() {

        // Fixed assets
        document.getElementById("addAsset")
            ?.addEventListener("click", () => this.openAssetForm());

        document.getElementById("cancelAsset")
            ?.addEventListener("click", () => this.closeAssetForm());

        document.getElementById("assetForm")
            ?.addEventListener("submit", event => this.saveAsset(event));

        document.querySelectorAll("[data-edit-asset]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    this.openAssetForm(button.dataset.editAsset);
                });
            });

        document.querySelectorAll("[data-dispose-asset]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    this.disposeAsset(button.dataset.disposeAsset);
                });
            });

        // Supplies
        document.getElementById("addSupply")
            ?.addEventListener("click", () => this.openSupplyForm());

        document.getElementById("cancelSupply")
            ?.addEventListener("click", () => this.closeSupplyForm());

        document.getElementById("supplyForm")
            ?.addEventListener("submit", event => this.saveSupply(event));

        document.querySelectorAll("[data-edit-supply]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    this.openSupplyForm(button.dataset.editSupply);
                });
            });

        document.querySelectorAll("[data-count-supply]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    this.countSupply(button.dataset.countSupply);
                });
            });
    }


    // =====================================================
    // PAGE EVENT LISTENERS
    // =====================================================

        wirePage() {

        // Fixed assets + supplies registers
        this.wireRegisters();

        // Reconciliation wizard + adjustment review
        this.wireAyecas();


        // Chart of accounts + journal account pickers
        this.wireChartOfAccounts();


        // Reporting periods page
        document.getElementById("saveReportingSettings")
            ?.addEventListener("click", () => {
                this.saveReportingSettings();
            });

        document.getElementById("reportingPeriodSelect")
            ?.addEventListener("change", event => {
                this.selectReportingPeriod(event.target.value);
            });

        document.getElementById("useReportingPeriod")
            ?.addEventListener("click", () => {
                this.useReportingPeriodForStatements();
            });

        document.querySelectorAll("[data-select-period]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    this.selectReportingPeriod(
                        button.dataset.selectPeriod
                    );
                });
            });


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


        // Adjusting entries form
        document.getElementById("adjustmentForm")
            ?.addEventListener("submit", event => {
                this.addAdjustment(event);
            });

        document.getElementById("adjType")
            ?.addEventListener("change", () => {
                this.applyAdjustmentPreset();
            });

        ["adjDebit", "adjCredit"].forEach(id => {
            document.getElementById(id)
                ?.addEventListener("input", () => {
                    this.updateAdjustmentHint();
                });
        });

        if (document.getElementById("adjType")) {
            this.applyAdjustmentPreset();
        }

        document.querySelectorAll("[data-delete-adjustment]")
            .forEach(button => {
                button.addEventListener("click", () => {
                    this.deleteAdjustment(
                        button.dataset.deleteAdjustment
                    );
                });
            });


        // Adjusted Trial Balance date + export
        document.getElementById("adjustedTbDate")
            ?.addEventListener("change", event => {
                this.updateAdjustedTbDate(event.target.value);
            });

        document.getElementById("exportAdjustedTb")
            ?.addEventListener("click", () => {
                this.exportAdjustedTbCSV();
            });


        // Financial Statements period + export
        ["statementStart", "statementEnd"].forEach(id => {
            document.getElementById(id)
                ?.addEventListener("change", () => {
                    this.updateStatementPeriod();
                });
        });

        document.getElementById("exportStatements")
            ?.addEventListener("click", () => {
                this.exportStatementsCSV();
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


        // Category choices follow the selected transaction type
        document.getElementById("txType")
            ?.addEventListener("change", () => {

                this.populateTransactionCategories();

            });

        ["txQuantity", "txUnitPrice"].forEach(id => {
            document.getElementById(id)
                ?.addEventListener("input", () => {
                    this.recalculateStockAmount();
                });
        });

        document.getElementById("txItem")
            ?.addEventListener("input", () => {
                this.updateStockHint();
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