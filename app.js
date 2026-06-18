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

// ---------------- Utilities ----------------
function showToast(msg, ms = 2200) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, ms);
}

function formatMoney(n) {
  const num = Number(n) || 0;
  return "$" + num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
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
    loadGoals();
  } else {
    currentUser = null;
    appScreen.hidden = true;
    authScreen.hidden = false;
    authForm.reset();
    authSubmit.disabled = false;
    applyAuthMode();
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
  viewGoals.hidden = view !== "list";
  viewGoalDetail.hidden = view !== "detail";
  fabAddGoal.hidden = view !== "list";
}

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

// ---------------- Init ----------------
applyAuthMode();