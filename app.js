// ============================================================
// Savings Tracker — app.js
// ============================================================

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------------- State ----------------
let currentUser = null;
let goals = [];               // [{id, name, emoji, target_amount, target_date, saved_amount}]
let activeGoalId = null;
let activeGoalContributions = []; // contributions for the open goal
let calViewYear = null;
let calViewMonth = null;      // 0-indexed
let isSignupMode = false;

let activeTab = "goals";      // "goals" | "transactions"
let transactions = [];        // all loaded transactions for the current tx month
let txViewYear = null;
let txViewMonth = null;       // 0-indexed
let txTypeFilter = "all";     // "all" | "income" | "expense"
let txFormType = "expense";   // currently selected type in the add/edit modal
let editingTxId = null;
let trendCache = [];          // last 6 months of {year, month, income, expense}

const CATEGORIES = {
  expense: [
    { id: "food",      label: "Food",      emoji: "🍔" },
    { id: "transport",  label: "Transport", emoji: "🚗" },
    { id: "bills",      label: "Bills",     emoji: "🧾" },
    { id: "shopping",   label: "Shopping",  emoji: "🛍️" },
    { id: "health",     label: "Health",    emoji: "💊" },
    { id: "entertainment", label: "Fun",    emoji: "🎮" },
    { id: "rent",        label: "Rent",     emoji: "🏠" },
    { id: "other",       label: "Other",    emoji: "📦" },
  ],
  income: [
    { id: "salary",    label: "Salary",    emoji: "💼" },
    { id: "freelance", label: "Freelance", emoji: "🧑‍💻" },
    { id: "gift",       label: "Gift",      emoji: "🎁" },
    { id: "interest",   label: "Interest",  emoji: "🏦" },
    { id: "refund",      label: "Refund",   emoji: "↩️" },
    { id: "other",        label: "Other",   emoji: "📦" },
  ],
};

function categoryMeta(type, id) {
  const list = CATEGORIES[type] || CATEGORIES.expense;
  return list.find((c) => c.id === id) || { id, label: id, emoji: "📦" };
}

// ---------------- DOM refs ----------------
const $ = (id) => document.getElementById(id);

const authScreen = $("auth-screen");
const appScreen = $("app-screen");
const authForm = $("auth-form");
const authEmail = $("auth-email");
const authPassword = $("auth-password");
const authError = $("auth-error");
const authSubmit = $("auth-submit");
const authToggle = $("auth-toggle");

const viewGoals = $("view-goals");
const viewGoalDetail = $("view-goal-detail");
const goalsList = $("goals-list");
const goalsEmpty = $("goals-empty");
const summarySaved = $("summary-saved");
const summaryGoalCount = $("summary-goal-count");

const fabAddGoal = $("fab-add-goal");
const goalModal = $("goal-modal");
const goalForm = $("goal-form");
const goalModalTitle = $("goal-modal-title");
const goalNameInput = $("goal-name");
const goalEmojiInput = $("goal-emoji");
const goalTargetInput = $("goal-target");
const goalDateInput = $("goal-date");
const goalFormError = $("goal-form-error");
const goalCancelBtn = $("goal-cancel-btn");

const backToGoalsBtn = $("back-to-goals");
const detailEmoji = $("detail-emoji");
const detailName = $("detail-name");
const detailSub = $("detail-sub");
const detailProgressFill = $("detail-progress-fill");
const detailProgressPct = $("detail-progress-pct");
const detailEditBtn = $("detail-edit-btn");
const deleteGoalBtn = $("delete-goal-btn");

const planDateInput = $("plan-date-input");
const planDaysLeft = $("plan-days-left");
const planPerWeek = $("plan-per-week");
const planPerMonth = $("plan-per-month");
const planStatus = $("plan-status");

const contributionForm = $("contribution-form");
const contribAmount = $("contrib-amount");
const contribDate = $("contrib-date");
const contribNote = $("contrib-note");

const calPrev = $("cal-prev");
const calNext = $("cal-next");
const calMonthLabel = $("cal-month-label");
const calGrid = $("cal-grid");

const historyList = $("history-list");
const historyEmpty = $("history-empty");

const logoutBtn = $("logout-btn");
const toast = $("toast");
const topbarTitle = $("topbar-title");

// Bottom nav
const navGoalsBtn = $("nav-goals-btn");
const navTransactionsBtn = $("nav-transactions-btn");

// Transactions view
const viewTransactions = $("view-transactions");
const fabAddTx = $("fab-add-tx");
const txMonthPrev = $("tx-month-prev");
const txMonthNext = $("tx-month-next");
const txMonthLabel = $("tx-month-label");
const txTotalIncome = $("tx-total-income");
const txTotalExpense = $("tx-total-expense");
const txTotalNet = $("tx-total-net");
const txBreakdownList = $("tx-breakdown-list");
const txBreakdownEmpty = $("tx-breakdown-empty");
const txTrendChart = $("tx-trend-chart");
const txFilterPills = $("tx-filter-pills");
const txList = $("tx-list");
const txListEmpty = $("tx-list-empty");

// Transaction modal
const txModal = $("tx-modal");
const txForm = $("tx-form");
const txModalTitle = $("tx-modal-title");
const txTypeExpenseBtn = $("tx-type-expense");
const txTypeIncomeBtn = $("tx-type-income");
const txAmountInput = $("tx-amount");
const txCategoryGrid = $("tx-category-grid");
const txCategoryInput = $("tx-category");
const txDateInput = $("tx-date");
const txNoteInput = $("tx-note");
const txFormError = $("tx-form-error");
const txCancelBtn = $("tx-cancel-btn");

// ---------------- Utilities ----------------
function showToast(msg, ms = 2200) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, ms);
}

function formatMoney(n) {
  const num = Number(n) || 0;
  return "₱" + num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
  const a = new Date(fromISO + "T00:00:00");
  const b = new Date(toISO + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function setHidden(el, hidden) { el.hidden = hidden; }

// ---------------- Auth ----------------
function applyAuthMode() {
  authSubmit.textContent = isSignupMode ? "Sign up" : "Log in";
  authToggle.textContent = isSignupMode
    ? "Already have an account? Log in"
    : "Don't have an account? Sign up";
  authError.hidden = true;
}

authToggle.addEventListener("click", () => {
  isSignupMode = !isSignupMode;
  applyAuthMode();
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.hidden = true;
  authSubmit.disabled = true;
  authSubmit.textContent = "Please wait…";

  const email = authEmail.value.trim();
  const password = authPassword.value;

  try {
    if (isSignupMode) {
      const { data, error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      if (data.user && !data.session) {
        showToast("Check your email to confirm your account.");
        authSubmit.disabled = false;
        applyAuthMode();
        return;
      }
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    authError.textContent = err.message || "Something went wrong.";
    authError.hidden = false;
    authSubmit.disabled = false;
    applyAuthMode();
  }
});

logoutBtn.addEventListener("click", async () => {
  await sb.auth.signOut();
});

sb.auth.onAuthStateChange((_event, session) => {
  if (session && session.user) {
    currentUser = session.user;
    authScreen.hidden = true;
    appScreen.hidden = false;
    switchTab("goals");
    loadGoals();
  } else {
    currentUser = null;
    appScreen.hidden = true;
    authScreen.hidden = false;
    authForm.reset();
    authSubmit.disabled = false;
    applyAuthMode();
    activeGoalId = null;
    txViewYear = null;
    txViewMonth = null;
    transactions = [];
  }
});

// ---------------- Goals: load + render list ----------------
async function loadGoals() {
  const { data: goalRows, error: goalErr } = await sb
    .from("goals")
    .select("*")
    .eq("archived", false)
    .order("created_at", { ascending: true });

  if (goalErr) {
    showToast("Couldn't load goals.");
    console.error(goalErr);
    return;
  }

  const { data: totals, error: totalErr } = await sb
    .from("goal_totals")
    .select("*");

  if (totalErr) console.error(totalErr);

  const totalsMap = {};
  (totals || []).forEach((t) => { totalsMap[t.goal_id] = Number(t.saved_amount) || 0; });

  goals = (goalRows || []).map((g) => ({
    ...g,
    saved_amount: totalsMap[g.id] || 0,
  }));

  renderGoalsList();

  // If a goal detail is open, refresh it too
  if (activeGoalId && !viewGoalDetail.hidden) {
    const g = goals.find((x) => x.id === activeGoalId);
    if (g) renderGoalDetailHeader(g);
  }
}

function renderGoalsList() {
  goalsList.innerHTML = "";

  if (goals.length === 0) {
    goalsEmpty.hidden = false;
  } else {
    goalsEmpty.hidden = true;
  }

  let totalSaved = 0;

  goals.forEach((g) => {
    totalSaved += g.saved_amount;
    const pct = Math.min(100, Math.round((g.saved_amount / g.target_amount) * 100)) || 0;

    const card = document.createElement("button");
    card.className = "goal-card";
    card.type = "button";
    card.innerHTML = `
      <span class="goal-emoji">${escapeHtml(g.emoji || "🎯")}</span>
      <div class="goal-card-body">
        <p class="goal-card-name">${escapeHtml(g.name)}</p>
        <p class="goal-card-amounts">${formatMoney(g.saved_amount)} of ${formatMoney(g.target_amount)}</p>
        <div class="mini-track"><div class="mini-fill" style="width:${pct}%"></div></div>
      </div>
      <span class="goal-card-chevron">›</span>
    `;
    card.addEventListener("click", () => openGoalDetail(g.id));
    goalsList.appendChild(card);
  });

  summarySaved.textContent = formatMoney(totalSaved);
  summaryGoalCount.textContent = goals.length;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// ---------------- Goal create / edit modal ----------------
let editingGoalId = null;

function openGoalModal(goal = null) {
  editingGoalId = goal ? goal.id : null;
  goalModalTitle.textContent = goal ? "Edit goal" : "New goal";
  goalNameInput.value = goal ? goal.name : "";
  goalEmojiInput.value = goal ? (goal.emoji || "") : "";
  goalTargetInput.value = goal ? goal.target_amount : "";
  goalDateInput.value = goal ? (goal.target_date || "") : "";
  goalFormError.hidden = true;
  goalModal.hidden = false;
}

function closeGoalModal() {
  goalModal.hidden = true;
  goalForm.reset();
  editingGoalId = null;
}

fabAddGoal.addEventListener("click", () => openGoalModal());
goalCancelBtn.addEventListener("click", closeGoalModal);
goalModal.addEventListener("click", (e) => { if (e.target === goalModal) closeGoalModal(); });

detailEditBtn.addEventListener("click", () => {
  const g = goals.find((x) => x.id === activeGoalId);
  if (g) openGoalModal(g);
});

goalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  goalFormError.hidden = true;

  const name = goalNameInput.value.trim();
  const emoji = goalEmojiInput.value.trim() || "🎯";
  const target_amount = parseFloat(goalTargetInput.value);
  const target_date = goalDateInput.value || null;

  if (!name || !target_amount || target_amount <= 0) {
    goalFormError.textContent = "Please enter a name and a target amount greater than 0.";
    goalFormError.hidden = false;
    return;
  }

  const saveBtn = $("goal-save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    if (editingGoalId) {
      const { error } = await sb
        .from("goals")
        .update({ name, emoji, target_amount, target_date })
        .eq("id", editingGoalId);
      if (error) throw error;
      showToast("Goal updated.");
    } else {
      const { error } = await sb
        .from("goals")
        .insert({ name, emoji, target_amount, target_date, user_id: currentUser.id });
      if (error) throw error;
      showToast("Goal created.");
    }
    closeGoalModal();
    await loadGoals();
    if (editingGoalId === activeGoalId && activeGoalId) {
      const g = goals.find((x) => x.id === activeGoalId);
      if (g) renderGoalDetailHeader(g);
    }
  } catch (err) {
    goalFormError.textContent = err.message || "Couldn't save goal.";
    goalFormError.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

// ---------------- Goal detail view ----------------
function showView(view) {
  // "list" / "detail" only apply within the Goals tab.
  viewGoals.hidden = view !== "list";
  viewGoalDetail.hidden = view !== "detail";
  fabAddGoal.hidden = view !== "list";
}

function switchTab(tab) {
  activeTab = tab;

  navGoalsBtn.classList.toggle("active", tab === "goals");
  navTransactionsBtn.classList.toggle("active", tab === "transactions");

  if (tab === "goals") {
    topbarTitle.textContent = "Savings";
    viewTransactions.hidden = true;
    fabAddTx.hidden = true;
    // restore whichever sub-view (list/detail) was active in the Goals tab
    showView(activeGoalId ? "detail" : "list");
  } else {
    topbarTitle.textContent = "Transactions";
    viewGoals.hidden = true;
    viewGoalDetail.hidden = true;
    fabAddGoal.hidden = true;
    viewTransactions.hidden = false;
    fabAddTx.hidden = false;
    if (txViewYear === null) {
      const now = new Date();
      txViewYear = now.getFullYear();
      txViewMonth = now.getMonth();
    }
    loadTransactionsMonth();
  }
}

navGoalsBtn.addEventListener("click", () => switchTab("goals"));
navTransactionsBtn.addEventListener("click", () => switchTab("transactions"));

backToGoalsBtn.addEventListener("click", () => {
  activeGoalId = null;
  showView("list");
});

async function openGoalDetail(goalId) {
  activeGoalId = goalId;
  const g = goals.find((x) => x.id === goalId);
  if (!g) return;

  renderGoalDetailHeader(g);

  // default plan date input to goal's target date
  planDateInput.value = g.target_date || "";
  renderDatePlan(g);

  // default contribution date to today
  contribDate.value = todayISO();

  const now = new Date();
  calViewYear = now.getFullYear();
  calViewMonth = now.getMonth();

  await loadContributions(goalId);
  showView("detail");
}

function renderGoalDetailHeader(g) {
  detailEmoji.textContent = g.emoji || "🎯";
  detailName.textContent = g.name;
  detailSub.textContent = `${formatMoney(g.saved_amount)} of ${formatMoney(g.target_amount)}`;
  const pct = Math.min(100, Math.round((g.saved_amount / g.target_amount) * 100)) || 0;
  detailProgressFill.style.width = pct + "%";
  detailProgressPct.textContent = pct + "%";
  renderDatePlan(g);
}

// ---------------- Date planning ----------------
function renderDatePlan(g) {
  const targetDate = planDateInput.value;
  const remaining = Math.max(0, g.target_amount - g.saved_amount);

  if (!targetDate) {
    planDaysLeft.textContent = "—";
    planPerWeek.textContent = "—";
    planPerMonth.textContent = "—";
    planStatus.textContent = "Set a target date to see how much to save.";
    return;
  }

  const days = daysBetween(todayISO(), targetDate);

  if (days <= 0) {
    planDaysLeft.textContent = "0";
    planPerWeek.textContent = "—";
    planPerMonth.textContent = "—";
    planStatus.textContent = remaining > 0
      ? "Target date has passed and the goal isn't fully funded yet."
      : "Target date has passed. Goal is funded — nice work.";
    return;
  }

  const weeks = days / 7;
  const months = days / 30.44;

  const perWeek = remaining / weeks;
  const perMonth = remaining / months;

  planDaysLeft.textContent = days;
  planPerWeek.textContent = formatMoney(perWeek);
  planPerMonth.textContent = formatMoney(perMonth);

  if (remaining <= 0) {
    planStatus.textContent = "This goal is already fully funded. 🎉";
  } else {
    planStatus.textContent = `Save ${formatMoney(perWeek)} a week to hit your goal by ${formatDateLong(targetDate)}.`;
  }
}

function formatDateLong(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

planDateInput.addEventListener("change", async () => {
  const g = goals.find((x) => x.id === activeGoalId);
  if (!g) return;

  const newDate = planDateInput.value || null;

  // Persist the new target date to the goal record
  const { error } = await sb
    .from("goals")
    .update({ target_date: newDate })
    .eq("id", g.id);

  if (error) {
    showToast("Couldn't update target date.");
    console.error(error);
    return;
  }

  g.target_date = newDate;
  const localGoal = goals.find((x) => x.id === g.id);
  if (localGoal) localGoal.target_date = newDate;

  renderDatePlan(g);
});

// ---------------- Contributions ----------------
async function loadContributions(goalId) {
  const { data, error } = await sb
    .from("contributions")
    .select("*")
    .eq("goal_id", goalId)
    .order("contributed_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    showToast("Couldn't load history.");
    console.error(error);
    return;
  }

  activeGoalContributions = data || [];
  renderHistory();
  renderCalendar();
}

contributionForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!activeGoalId) return;

  const amount = parseFloat(contribAmount.value);
  const date = contribDate.value || todayISO();
  const note = contribNote.value.trim() || null;

  if (!amount || amount <= 0) {
    showToast("Enter an amount greater than 0.");
    return;
  }

  const submitBtn = contributionForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    const { error } = await sb.from("contributions").insert({
      goal_id: activeGoalId,
      user_id: currentUser.id,
      amount,
      contributed_on: date,
      note,
    });
    if (error) throw error;

    contributionForm.reset();
    contribDate.value = todayISO();
    showToast("Contribution added.");

    await loadContributions(activeGoalId);
    await loadGoals();
    const g = goals.find((x) => x.id === activeGoalId);
    if (g) renderGoalDetailHeader(g);
  } catch (err) {
    showToast(err.message || "Couldn't add contribution.");
  } finally {
    submitBtn.disabled = false;
  }
});

function renderHistory() {
  historyList.innerHTML = "";

  if (activeGoalContributions.length === 0) {
    historyEmpty.hidden = false;
    return;
  }
  historyEmpty.hidden = true;

  activeGoalContributions.forEach((c) => {
    const row = document.createElement("div");
    row.className = "history-row";
    row.innerHTML = `
      <div>
        <p class="history-amount">${formatMoney(c.amount)}</p>
        <p class="history-meta">${formatDateLong(c.contributed_on)}${c.note ? " · " + escapeHtml(c.note) : ""}</p>
      </div>
      <button class="history-del" aria-label="Delete contribution" data-id="${c.id}">✕</button>
    `;
    row.querySelector(".history-del").addEventListener("click", () => deleteContribution(c.id));
    historyList.appendChild(row);
  });
}

async function deleteContribution(id) {
  const { error } = await sb.from("contributions").delete().eq("id", id);
  if (error) {
    showToast("Couldn't delete contribution.");
    return;
  }
  showToast("Contribution removed.");
  await loadContributions(activeGoalId);
  await loadGoals();
  const g = goals.find((x) => x.id === activeGoalId);
  if (g) renderGoalDetailHeader(g);
}

// ---------------- Calendar ----------------
function renderCalendar() {
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  calMonthLabel.textContent = `${monthNames[calViewMonth]} ${calViewYear}`;

  const contributionDates = new Set(
    activeGoalContributions.map((c) => c.contributed_on)
  );

  const firstOfMonth = new Date(calViewYear, calViewMonth, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  const todayStr = todayISO();

  calGrid.innerHTML = "";

  for (let i = 0; i < startWeekday; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-cell empty";
    calGrid.appendChild(blank);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const m = String(calViewMonth + 1).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    const iso = `${calViewYear}-${m}-${d}`;

    const cell = document.createElement("div");
    cell.className = "cal-cell";
    if (contributionDates.has(iso)) cell.classList.add("has-contribution");
    if (iso === todayStr) cell.classList.add("today");
    cell.textContent = day;
    calGrid.appendChild(cell);
  }
}

calPrev.addEventListener("click", () => {
  calViewMonth -= 1;
  if (calViewMonth < 0) { calViewMonth = 11; calViewYear -= 1; }
  renderCalendar();
});

calNext.addEventListener("click", () => {
  calViewMonth += 1;
  if (calViewMonth > 11) { calViewMonth = 0; calViewYear += 1; }
  renderCalendar();
});

// ---------------- Delete goal ----------------
deleteGoalBtn.addEventListener("click", async () => {
  if (!activeGoalId) return;
  const g = goals.find((x) => x.id === activeGoalId);
  const ok = confirm(`Delete "${g ? g.name : "this goal"}"? This also removes its contribution history.`);
  if (!ok) return;

  const { error } = await sb.from("goals").delete().eq("id", activeGoalId);
  if (error) {
    showToast("Couldn't delete goal.");
    console.error(error);
    return;
  }
  showToast("Goal deleted.");
  activeGoalId = null;
  showView("list");
  await loadGoals();
});

// ============================================================
// Transactions
// ============================================================

function monthLabel(year, month) {
  const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${monthNames[month]} ${year}`;
}

function monthRangeISO(year, month) {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { start: toISO(start), end: toISO(end) };
}

async function loadTransactionsMonth() {
  const { start, end } = monthRangeISO(txViewYear, txViewMonth);
  txMonthLabel.textContent = monthLabel(txViewYear, txViewMonth);

  const { data, error } = await sb
    .from("transactions")
    .select("*")
    .gte("occurred_on", start)
    .lte("occurred_on", end)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    showToast("Couldn't load transactions.");
    console.error(error);
    return;
  }

  transactions = data || [];
  renderTxSummary();
  renderTxBreakdown();
  renderTxList();
  loadTrend();
}

txMonthPrev.addEventListener("click", () => {
  txViewMonth -= 1;
  if (txViewMonth < 0) { txViewMonth = 11; txViewYear -= 1; }
  loadTransactionsMonth();
});

txMonthNext.addEventListener("click", () => {
  txViewMonth += 1;
  if (txViewMonth > 11) { txViewMonth = 0; txViewYear += 1; }
  loadTransactionsMonth();
});

function renderTxSummary() {
  let income = 0;
  let expense = 0;
  transactions.forEach((t) => {
    if (t.type === "income") income += Number(t.amount);
    else expense += Number(t.amount);
  });
  txTotalIncome.textContent = formatMoney(income);
  txTotalExpense.textContent = formatMoney(expense);
  txTotalNet.textContent = formatMoney(income - expense);
}

function renderTxBreakdown() {
  const expenseTx = transactions.filter((t) => t.type === "expense");
  txBreakdownList.innerHTML = "";

  if (expenseTx.length === 0) {
    txBreakdownEmpty.hidden = false;
    return;
  }
  txBreakdownEmpty.hidden = true;

  const totals = {};
  expenseTx.forEach((t) => {
    totals[t.category] = (totals[t.category] || 0) + Number(t.amount);
  });

  const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);

  sorted.forEach(([catId, amount]) => {
    const meta = categoryMeta("expense", catId);
    const pct = grandTotal > 0 ? Math.round((amount / grandTotal) * 100) : 0;

    const row = document.createElement("div");
    row.className = "breakdown-row";
    row.innerHTML = `
      <div class="breakdown-row-top">
        <span class="breakdown-cat">${meta.emoji} ${escapeHtml(meta.label)}</span>
        <span class="breakdown-amount">${formatMoney(amount)}</span>
      </div>
      <div class="breakdown-track"><div class="breakdown-fill" style="width:${pct}%"></div></div>
    `;
    txBreakdownList.appendChild(row);
  });
}

function renderTxList() {
  txList.innerHTML = "";

  const filtered = txTypeFilter === "all"
    ? transactions
    : transactions.filter((t) => t.type === txTypeFilter);

  if (filtered.length === 0) {
    txListEmpty.hidden = false;
    return;
  }
  txListEmpty.hidden = true;

  // group by date, preserving the already-descending order
  const groups = [];
  let currentGroup = null;
  filtered.forEach((t) => {
    if (!currentGroup || currentGroup.date !== t.occurred_on) {
      currentGroup = { date: t.occurred_on, items: [] };
      groups.push(currentGroup);
    }
    currentGroup.items.push(t);
  });

  groups.forEach((group) => {
    const groupEl = document.createElement("div");
    groupEl.className = "tx-date-group";

    const heading = document.createElement("p");
    heading.className = "tx-date-heading";
    heading.textContent = formatDateLong(group.date);
    groupEl.appendChild(heading);

    group.items.forEach((t) => {
      const meta = categoryMeta(t.type, t.category);
      const row = document.createElement("div");
      row.className = "tx-row";
      row.innerHTML = `
        <span class="tx-row-icon">${meta.emoji}</span>
        <div class="tx-row-body">
          <p class="tx-row-cat">${escapeHtml(meta.label)}</p>
          <p class="tx-row-note">${t.note ? escapeHtml(t.note) : (t.type === "income" ? "Income" : "Expense")}</p>
        </div>
        <span class="tx-row-amount ${t.type}">${t.type === "income" ? "+" : "−"}${formatMoney(t.amount)}</span>
        <button class="tx-row-del" aria-label="Delete transaction" data-id="${t.id}">✕</button>
      `;
      row.querySelector(".tx-row-del").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteTransaction(t.id);
      });
      row.addEventListener("click", () => openTxModal(t));
      groupEl.appendChild(row);
    });

    txList.appendChild(groupEl);
  });
}

txFilterPills.addEventListener("click", (e) => {
  const btn = e.target.closest(".pill");
  if (!btn) return;
  txTypeFilter = btn.dataset.filter;
  [...txFilterPills.children].forEach((p) => p.classList.toggle("active", p === btn));
  renderTxList();
});

async function deleteTransaction(id) {
  const { error } = await sb.from("transactions").delete().eq("id", id);
  if (error) {
    showToast("Couldn't delete transaction.");
    console.error(error);
    return;
  }
  showToast("Transaction removed.");
  await loadTransactionsMonth();
}

// ---------------- 6-month trend ----------------
async function loadTrend() {
  const months = [];
  for (let i = 5; i >= 0; i--) {
    let y = txViewYear, m = txViewMonth - i;
    while (m < 0) { m += 12; y -= 1; }
    months.push({ year: y, month: m });
  }

  const first = monthRangeISO(months[0].year, months[0].month).start;
  const last = monthRangeISO(months[5].year, months[5].month).end;

  const { data, error } = await sb
    .from("transactions")
    .select("type, amount, occurred_on")
    .gte("occurred_on", first)
    .lte("occurred_on", last);

  if (error) {
    console.error(error);
    return;
  }

  const buckets = months.map((m) => ({ ...m, income: 0, expense: 0 }));

  (data || []).forEach((t) => {
    const d = new Date(t.occurred_on + "T00:00:00");
    const bucket = buckets.find((b) => b.year === d.getFullYear() && b.month === d.getMonth());
    if (!bucket) return;
    if (t.type === "income") bucket.income += Number(t.amount);
    else bucket.expense += Number(t.amount);
  });

  trendCache = buckets;
  renderTrend();
}

function renderTrend() {
  txTrendChart.innerHTML = "";
  if (trendCache.length === 0) return;

  const monthAbbr = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const maxVal = Math.max(1, ...trendCache.map((b) => Math.max(b.income, b.expense)));

  trendCache.forEach((b) => {
    const incomeH = Math.round((b.income / maxVal) * 100);
    const expenseH = Math.round((b.expense / maxVal) * 100);

    const col = document.createElement("div");
    col.className = "trend-col";
    col.innerHTML = `
      <div class="trend-bars">
        <div class="trend-bar income" style="height:${incomeH}%" title="Income: ${formatMoney(b.income)}"></div>
        <div class="trend-bar expense" style="height:${expenseH}%" title="Expenses: ${formatMoney(b.expense)}"></div>
      </div>
      <span class="trend-label">${monthAbbr[b.month]}</span>
    `;
    txTrendChart.appendChild(col);
  });
}

// ---------------- Transaction add/edit modal ----------------
function renderCategoryGrid() {
  const list = CATEGORIES[txFormType];
  txCategoryGrid.innerHTML = "";
  list.forEach((cat) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "category-chip" + (cat.id === txCategoryInput.value ? " active" : "");
    chip.dataset.cat = cat.id;
    chip.innerHTML = `<span class="category-chip-emoji">${cat.emoji}</span><span>${escapeHtml(cat.label)}</span>`;
    chip.addEventListener("click", () => {
      txCategoryInput.value = cat.id;
      [...txCategoryGrid.children].forEach((c) => c.classList.toggle("active", c === chip));
    });
    txCategoryGrid.appendChild(chip);
  });
}

function setTxFormType(type) {
  txFormType = type;
  txTypeExpenseBtn.classList.toggle("active", type === "expense");
  txTypeIncomeBtn.classList.toggle("active", type === "income");
  // default to "other" when switching types unless editing keeps a valid category
  const list = CATEGORIES[type];
  if (!list.some((c) => c.id === txCategoryInput.value)) {
    txCategoryInput.value = list[list.length - 1].id; // "other"
  }
  renderCategoryGrid();
}

txTypeExpenseBtn.addEventListener("click", () => setTxFormType("expense"));
txTypeIncomeBtn.addEventListener("click", () => setTxFormType("income"));

function openTxModal(tx = null) {
  editingTxId = tx ? tx.id : null;
  txModalTitle.textContent = tx ? "Edit transaction" : "New transaction";
  txAmountInput.value = tx ? tx.amount : "";
  txDateInput.value = tx ? tx.occurred_on : todayISO();
  txNoteInput.value = tx ? (tx.note || "") : "";
  txCategoryInput.value = tx ? tx.category : "other";
  txFormError.hidden = true;
  setTxFormType(tx ? tx.type : "expense");
  txModal.hidden = false;
}

function closeTxModal() {
  txModal.hidden = true;
  txForm.reset();
  editingTxId = null;
}

fabAddTx.addEventListener("click", () => openTxModal());
txCancelBtn.addEventListener("click", closeTxModal);
txModal.addEventListener("click", (e) => { if (e.target === txModal) closeTxModal(); });

txForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  txFormError.hidden = true;

  const amount = parseFloat(txAmountInput.value);
  const occurred_on = txDateInput.value || todayISO();
  const note = txNoteInput.value.trim() || null;
  const category = txCategoryInput.value || "other";
  const type = txFormType;

  if (!amount || amount <= 0) {
    txFormError.textContent = "Please enter an amount greater than 0.";
    txFormError.hidden = false;
    return;
  }

  const saveBtn = $("tx-save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  try {
    if (editingTxId) {
      const { error } = await sb
        .from("transactions")
        .update({ type, amount, category, note, occurred_on })
        .eq("id", editingTxId);
      if (error) throw error;
      showToast("Transaction updated.");
    } else {
      const { error } = await sb
        .from("transactions")
        .insert({ type, amount, category, note, occurred_on, user_id: currentUser.id });
      if (error) throw error;
      showToast("Transaction added.");
    }
    closeTxModal();

    // jump the visible month to match the transaction's date so the user sees it
    const d = new Date(occurred_on + "T00:00:00");
    txViewYear = d.getFullYear();
    txViewMonth = d.getMonth();
    await loadTransactionsMonth();
  } catch (err) {
    txFormError.textContent = err.message || "Couldn't save transaction.";
    txFormError.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
});

// ---------------- Init ----------------
applyAuthMode();