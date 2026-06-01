/* ===== Data ===== */

/**
 * Load expenses from localStorage.
 * @returns {Array}
 */
function loadExpenses() {
  try {
    const data = localStorage.getItem('expenses');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Save expenses to localStorage.
 * @param {Array} expenses
 */
function saveExpenses(expenses) {
  localStorage.setItem('expenses', JSON.stringify(expenses));
}

/* ===== Income Data ===== */

/**
 * Load income from localStorage.
 * @returns {Array}
 */
function loadIncome() {
  try {
    const data = localStorage.getItem('income-tracker-income');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/**
 * Save income to localStorage.
 * @param {Array} income
 */
function saveIncome(income) {
  localStorage.setItem('income-tracker-income', JSON.stringify(income));
}

/* ===== Chart Instance ===== */
let chartInstance = null;

/* ===== Admin Mode ===== */
const DEFAULT_ADMIN_PASSWORD = 'Master';
const ADMIN_PASSWORD_KEY = 'money-tracker-admin-password';
let isAdmin = false;

function migrateOldDefaultPassword() {
  const saved = localStorage.getItem(ADMIN_PASSWORD_KEY);
  if (!saved || saved === 'admin123') {
    localStorage.setItem(ADMIN_PASSWORD_KEY, DEFAULT_ADMIN_PASSWORD);
  }
}

function getAdminPassword() {
  return localStorage.getItem(ADMIN_PASSWORD_KEY) || DEFAULT_ADMIN_PASSWORD;
}

function changeAdminPassword(currentPassword, newPassword) {
  if (currentPassword !== getAdminPassword()) {
    return { ok: false, message: 'Current password is incorrect.' };
  }
  if (!newPassword || newPassword.length < 4) {
    return { ok: false, message: 'New password must be at least 4 characters.' };
  }
  localStorage.setItem(ADMIN_PASSWORD_KEY, newPassword);
  isAdmin = false;
  return { ok: true, message: 'Admin password updated successfully.' };
}

/* ===== Render Functions ===== */

/**
 * Build the table rows from an expenses array.
 * Shows/hides the empty state.
 * @param {Array} expenses
 */
function renderTable(expenses) {
  const tbody = document.getElementById('expenses-body');
  const emptyState = document.getElementById('empty-state');

  if (!tbody) {
    console.warn('renderTable: #expenses-body element not found');
    return;
  }

  if (!expenses.length) {
    tbody.innerHTML = '';
    if (emptyState) emptyState.style.display = 'block';
    renderBalance();
    renderIncomeTable();
    return;
  }

  if (emptyState) emptyState.style.display = 'none';

  tbody.innerHTML = expenses
    .map(
      (exp) => `
      <tr>
        <td>${formatDate(exp.date)}</td>
        <td><span class="category-badge ${exp.category.toLowerCase()}">${exp.category}</span></td>
        <td>${escapeHtml(exp.description)}</td>
        <td><strong>${formatCurrency(exp.amount)}</strong></td>
        <td><button class="delete-btn" data-id="${exp.id}">✕ Delete</button></td>
      </tr>`
    )
    .join('');
  renderBalance();
  renderIncomeTable();
}

/**
 * Update the total display and pie chart.
 * @param {Array} expenses
 */
function renderSummary(expenses) {
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  document.getElementById('total-amount').textContent = formatCurrency(total);

  renderChart(expenses);
}

/**
 * Calculate and display the running balance.
 * Balance = total income - total expenses (unfiltered).
 */
function renderBalance() {
  const expenses = loadExpenses();
  const income = loadIncome();

  const totalIncome = income.reduce((sum, i) => sum + i.amount, 0);
  const paidIncome = income.reduce((sum, i) => sum + (i.paid ? i.amount : 0), 0);
  const unpaidIncome = totalIncome - paidIncome;
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const balance = paidIncome - totalExpenses;

  const totalIncomeEl = document.getElementById('total-income-amount');
  const totalExpenseEl = document.getElementById('total-expense-amount');
  if (totalIncomeEl) totalIncomeEl.textContent = `${formatCurrency(paidIncome)} paid / ${formatCurrency(unpaidIncome)} unpaid`;
  if (totalExpenseEl) totalExpenseEl.textContent = formatCurrency(totalExpenses);

  const balanceEl = document.getElementById('balance-amount');
  if (!balanceEl) {
    console.warn('renderBalance: #balance-amount element not found');
    return;
  }
  balanceEl.textContent = formatCurrency(balance);

  balanceEl.classList.remove('positive', 'negative');
  if (balance > 0) {
    balanceEl.classList.add('positive');
  } else if (balance < 0) {
    balanceEl.classList.add('negative');
  }
  renderCycleStatus();
}

/**
 * Render the income table with all income entries.
 */
function renderIncomeTable() {
  const tbody = document.getElementById('income-body');
  if (!tbody) {
    console.warn('renderIncomeTable: #income-body element not found');
    return;
  }
  const income = loadIncome();

  if (!income.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><p>No income yet. Add your first one above!</p></td></tr>`;
    return;
  }

  tbody.innerHTML = income
    .map(
      (inc) => `
      <tr class="income-row">
        <td>${formatDate(inc.date)}</td>
        <td>${escapeHtml(inc.source)}</td>
        <td>${escapeHtml(inc.description)}</td>
        <td>${formatCurrency(inc.amount)}</td>
        <td>
          <label class="paid-check" title="Check if this income is already paid">
            <input type="checkbox" class="paid-toggle" data-id="${inc.id}" ${inc.paid ? 'checked' : ''}>
            <span>${inc.paid ? 'Paid' : 'Unpaid'}</span>
          </label>
        </td>
        <td><button class="delete-btn" data-id="${inc.id}">✕ Delete</button></td>
      </tr>`
    )
    .join('');
}

/**
 * Draw (or update) a Chart.js pie chart of spending by category.
 * Destroys previous chart instance before creating a new one.
 * @param {Array} expenses
 */
function renderChart(expenses) {
  const chartEl = document.getElementById('chart');
  if (!chartEl || typeof Chart === 'undefined') return;
  const ctx = chartEl.getContext('2d');

  // Destroy previous chart
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  // Aggregate by category
  const categoryTotals = {};
  const categoryColors = {
    Food: '#ff6384',
    Transport: '#36a2eb',
    Bills: '#ffce56',
    Entertainment: '#4bc0c0',
    Shopping: '#9966ff',
    Other: '#ff9f40',
  };

  expenses.forEach((exp) => {
    categoryTotals[exp.category] = (categoryTotals[exp.category] || 0) + exp.amount;
  });

  const labels = Object.keys(categoryTotals);
  const data = Object.values(categoryTotals);
  const colors = labels.map((l) => categoryColors[l] || '#999');

  if (!labels.length) {
    // No data — show a placeholder message on canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#999';
    ctx.textAlign = 'center';
    ctx.fillText('No data to display', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  chartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderColor: '#fff',
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 16,
            usePointStyle: true,
          },
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const value = context.parsed;
              const pct = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return ` ${context.label}: ${formatCurrency(value)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

/* ===== Filter Functions ===== */

/**
 * Read filter values and re-render with filtered expenses.
 */
function applyFilters() {
  const from = document.getElementById('filter-from').value;
  const to = document.getElementById('filter-to').value;
  const category = document.getElementById('filter-category').value;

  let expenses = loadExpenses();

  // Filter by date range
  if (from) {
    expenses = expenses.filter((e) => e.date >= from);
  }
  if (to) {
    expenses = expenses.filter((e) => e.date <= to);
  }

  // Filter by category
  if (category !== 'All') {
    expenses = expenses.filter((e) => e.category === category);
  }

  renderTable(expenses);
  renderSummary(expenses);
}

/**
 * Clear all filter inputs and show all expenses.
 */
function resetFilters() {
  document.getElementById('filter-from').value = '';
  document.getElementById('filter-to').value = '';
  document.getElementById('filter-category').value = 'All';

  const expenses = loadExpenses();
  renderTable(expenses);
  renderSummary(expenses);
}

/* ===== CRUD Operations ===== */

/**
 * Add a new expense, persist, and re-render.
 * @param {Object} expense
 */
function addExpense(expense) {
  const expenses = loadExpenses();
  expenses.push(expense);
  saveExpenses(expenses);
  try { renderTable(expenses); } catch (e) { console.warn('addExpense: renderTable failed', e); }
  try { renderSummary(expenses); } catch (e) { console.warn('addExpense: renderSummary failed', e); }
  try { renderBalance(); } catch (e) { console.warn('addExpense: renderBalance failed', e); }
  try { renderBudget(loadExpenses()); } catch (e) { console.warn('addExpense: renderBudget failed', e); }
  try { renderIncomeTable(); } catch (e) { console.warn('addExpense: renderIncomeTable failed', e); }
}

/**
 * Delete an expense by id, persist, and re-render.
 * @param {number} id
 */
function deleteExpense(id) {
  let expenses = loadExpenses();
  expenses = expenses.filter((e) => e.id !== id);
  saveExpenses(expenses);
  try { renderTable(expenses); } catch (e) { console.warn('deleteExpense: renderTable failed', e); }
  try { renderSummary(expenses); } catch (e) { console.warn('deleteExpense: renderSummary failed', e); }
  try { renderBalance(); } catch (e) { console.warn('deleteExpense: renderBalance failed', e); }
  try { renderBudget(loadExpenses()); } catch (e) { console.warn('deleteExpense: renderBudget failed', e); }
  try { renderIncomeTable(); } catch (e) { console.warn('deleteExpense: renderIncomeTable failed', e); }
}

/* ===== Income CRUD ===== */

/**
 * Add a new income item, persist, and re-render.
 * @param {Object} incomeItem
 */
function addIncome(incomeItem) {
  const income = loadIncome();
  income.push(incomeItem);
  saveIncome(income);
  try { renderIncomeTable(); } catch (e) { console.warn('addIncome: renderIncomeTable failed', e); }
  try { renderBalance(); } catch (e) { console.warn('addIncome: renderBalance failed', e); }
  try { renderSummary(loadExpenses()); } catch (e) { console.warn('addIncome: renderSummary failed', e); }
}

/**
 * Delete an income item by id, persist, and re-render.
 * @param {number} id
 */

/**
 * Toggle income paid status. Only checked income counts as money in for the remaining balance.
 * @param {number} id
 * @param {boolean} paid
 */
function toggleIncomePaid(id, paid) {
  const income = loadIncome().map((i) => (i.id === id ? { ...i, paid } : i));
  saveIncome(income);
  try { renderIncomeTable(); } catch (e) { console.warn('toggleIncomePaid: renderIncomeTable failed', e); }
  try { renderBalance(); } catch (e) { console.warn('toggleIncomePaid: renderBalance failed', e); }
  try { renderSummary(loadExpenses()); } catch (e) { console.warn('toggleIncomePaid: renderSummary failed', e); }
}

function deleteIncome(id) {
  let income = loadIncome();
  income = income.filter((i) => i.id !== id);
  saveIncome(income);
  try { renderIncomeTable(); } catch (e) { console.warn('deleteIncome: renderIncomeTable failed', e); }
  try { renderBalance(); } catch (e) { console.warn('deleteIncome: renderBalance failed', e); }
  try { renderSummary(loadExpenses()); } catch (e) { console.warn('deleteIncome: renderSummary failed', e); }
}

/* ===== Budget Functions ===== */

/**
 * Load the saved monthly budget from localStorage.
 * @returns {number|null}
 */
function loadBudget() {
  try {
    const val = localStorage.getItem('monthlyBudget');
    return val !== null ? parseFloat(val) : null;
  } catch {
    return null;
  }
}

/**
 * Save the monthly budget to localStorage.
 * @param {number} amount
 */
function saveBudget(amount) {
  localStorage.setItem('monthlyBudget', String(amount));
}

/**
 * Render the budget display: budget, current-month spent, remaining.
 * Always shows current-month spending regardless of filters.
 * @param {Array} allExpenses — full unfiltered expense list
 */
function renderBudget(allExpenses) {
  const display = document.getElementById('budget-display');
  if (!display) return;
  const budget = loadBudget();

  if (budget === null || budget <= 0) {
    display.innerHTML = '<p class="budget-not-set">Set a monthly budget to track your remaining money</p>';
    return;
  }

  // Filter expenses to current month only
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-based

  const monthSpent = allExpenses.reduce((sum, e) => {
    const d = new Date(e.date + 'T00:00:00');
    if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
      return sum + e.amount;
    }
    return sum;
  }, 0);

  const remaining = budget - monthSpent;
  const remainingClass = remaining >= 0 ? 'remaining-positive' : 'remaining-negative';

  display.innerHTML = `
    <div class="budget-stats">
      <div class="budget-stat">
        <span class="budget-stat-label">Budget</span>
        <span class="budget-stat-value">${formatCurrency(budget)}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Spent</span>
        <span class="budget-stat-value">${formatCurrency(monthSpent)}</span>
      </div>
      <div class="budget-stat">
        <span class="budget-stat-label">Remaining</span>
        <span class="budget-stat-value ${remainingClass}">${formatCurrency(remaining)}</span>
      </div>
    </div>
  `;
}


/* ===== 15-Day Cycle Reset With Carryover ===== */
const CYCLE_START_KEY = 'apartment-budget-cycle-start';
const CYCLE_DAYS = 15;

function getTodayString() {
  return new Date().toISOString().split('T')[0];
}

function daysBetween(dateA, dateB) {
  const a = new Date(dateA + 'T00:00:00');
  const b = new Date(dateB + 'T00:00:00');
  return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

function getCurrentBalance() {
  const expenses = loadExpenses();
  const income = loadIncome();
  const paidIncome = income.reduce((sum, i) => sum + (i.paid ? i.amount : 0), 0);
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  return paidIncome - totalExpenses;
}

function getCycleStart() {
  let start = localStorage.getItem(CYCLE_START_KEY);
  if (!start) {
    start = getTodayString();
    localStorage.setItem(CYCLE_START_KEY, start);
  }
  return start;
}

function getCycleInfo() {
  const start = getCycleStart();
  const used = Math.max(0, daysBetween(start, getTodayString()));
  const remaining = Math.max(0, CYCLE_DAYS - used);
  return { start, used, remaining };
}

function resetCycleWithCarryover(showAlert = true) {
  const balance = getCurrentBalance();
  const carryover = balance > 0 ? balance : 0;

  saveExpenses([]);
  const nextIncome = [];

  if (carryover > 0) {
    nextIncome.push({
      id: Date.now(),
      amount: carryover,
      source: 'Carryover / Sobra',
      description: 'Sobra from previous 15-day cycle',
      date: getTodayString(),
      paid: true,
    });
  }

  saveIncome(nextIncome);
  localStorage.setItem(CYCLE_START_KEY, getTodayString());

  renderTable(loadExpenses());
  renderSummary(loadExpenses());
  renderBalance();
  renderIncomeTable();
  renderCycleStatus();

  if (showAlert) {
    alert(carryover > 0
      ? `Cycle reset done. Sobra carried over: ${formatCurrency(carryover)}`
      : 'Cycle reset done. No sobra to carry over.');
  }
}

function autoResetCycleIfNeeded() {
  const info = getCycleInfo();
  if (info.used >= CYCLE_DAYS) {
    resetCycleWithCarryover(false);
  }
}

function renderCycleStatus() {
  const status = document.getElementById('cycle-status');
  if (!status) return;
  const info = getCycleInfo();
  status.textContent = `Cycle started ${formatDate(info.start)} • ${info.remaining} day(s) before next auto reset • any sobra will carry over`;
}

/* ===== Utility Functions ===== */

/**
 * Format a number as Philippine Peso currency.
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
  return '₱' + amount.toFixed(2);
}

/**
 * Format a YYYY-MM-DD date string for display.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  return d.toLocaleDateString('en-PH', options);
}

/**
 * Escape HTML entities to prevent XSS.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(text));
  return div.innerHTML;
}

/* ===== Admin Authorization ===== */

function requireAdmin() {
  return new Promise((resolve) => {
    if (isAdmin) {
      resolve(true);
      return;
    }
    const password = prompt('Enter admin password to make changes:');
    if (password === getAdminPassword()) {
      isAdmin = true;
      resolve(true);
    } else {
      if (password !== null) {
        alert('Incorrect password.');
      }
      resolve(false);
    }
  });
}

/* ===== Initialization ===== */

document.addEventListener('DOMContentLoaded', async function () {
  migrateOldDefaultPassword();
  autoResetCycleIfNeeded();
  renderCycleStatus();
  // Set default date to today
  const today = new Date().toISOString().split('T')[0];
  const expenseDate = document.getElementById('date');
  const incomeDate = document.getElementById('income-date');
  if (expenseDate) expenseDate.value = today;
  if (incomeDate) incomeDate.value = today;

  // Initial render
  const expenses = loadExpenses();
  renderTable(expenses);
  renderSummary(expenses);
  renderBalance();
  renderIncomeTable();

  // Load saved budget into input, only if the optional budget UI exists
  const savedBudget = loadBudget();
  const budgetInput = document.getElementById('budget-input');
  if (budgetInput && savedBudget !== null && savedBudget > 0) {
    budgetInput.value = savedBudget;
  }
  renderBudget(expenses);

  // Set budget button, only if the optional budget UI exists
  const setBudgetBtn = document.getElementById('set-budget-btn');
  if (setBudgetBtn && budgetInput) {
    setBudgetBtn.addEventListener('click', async function () {
      const authorized = await requireAdmin();
      if (!authorized) return;
      const val = parseFloat(budgetInput.value);
      if (isNaN(val) || val < 0) {
        alert('Please enter a valid budget amount (0 or more).');
        return;
      }
      saveBudget(val);
      renderBudget(loadExpenses());
    });
  }

  // Change admin password form, only if the optional UI exists
  const passwordForm = document.getElementById('password-form');
  if (passwordForm) {
    passwordForm.addEventListener('submit', function (e) {
      e.preventDefault();
      const currentPassword = document.getElementById('current-password').value;
      const newPassword = document.getElementById('new-password').value;
      const result = changeAdminPassword(currentPassword, newPassword);
      alert(result.message);
      if (result.ok) {
        passwordForm.reset();
      }
    });
  }

  // Expense form submit handler
  const expenseForm = document.getElementById('expense-form');
  if (expenseForm) expenseForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const authorized = await requireAdmin();
    if (!authorized) return;

    const amount = parseFloat(document.getElementById('amount').value);
    const category = document.getElementById('category').value;
    const description = document.getElementById('description').value.trim();
    const date = document.getElementById('date').value;

    // Validation
    if (!amount || amount <= 0 || isNaN(amount)) {
      alert('Please enter a valid amount greater than 0.');
      return;
    }

    if (!description) {
      alert('Please enter a description.');
      return;
    }

    const expense = {
      id: Date.now(),
      amount,
      category,
      description,
      date,
    };

    addExpense(expense);
    this.reset();
    // Re-set default date after reset
    document.getElementById('date').value = new Date().toISOString().split('T')[0];
  });

  // Income form submit handler
  const incomeForm = document.getElementById('income-form');
  if (incomeForm) incomeForm.addEventListener('submit', async function (e) {
    e.preventDefault();

    const authorized = await requireAdmin();
    if (!authorized) return;

    const amount = parseFloat(document.getElementById('income-amount').value);
    const source = document.getElementById('income-source').value;
    const description = document.getElementById('income-description').value.trim();
    const date = document.getElementById('income-date').value;

    if (!amount || amount <= 0 || isNaN(amount)) {
      alert('Please enter a valid amount greater than 0.');
      return;
    }

    if (!description) {
      alert('Please enter a description.');
      return;
    }

    const incomeItem = {
      id: Date.now(),
      amount,
      source,
      description,
      date,
      paid: false,
    };

    addIncome(incomeItem);
    this.reset();
    document.getElementById('income-date').value = new Date().toISOString().split('T')[0];
  });

  // Filter button
  const filterBtn = document.getElementById('filter-btn');
  if (filterBtn) filterBtn.addEventListener('click', applyFilters);

  // Clear filters button
  const clearFiltersBtn = document.getElementById('clear-filters-btn');
  if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', resetFilters);

  const resetCycleBtn = document.getElementById('reset-cycle-btn');
  if (resetCycleBtn) {
    resetCycleBtn.addEventListener('click', async function () {
      const authorized = await requireAdmin();
      if (!authorized) return;
      if (!confirm('Reset this 15-day cycle now? Your remaining sobra will be carried over to the next amotan.')) return;
      resetCycleWithCarryover(true);
    });
  }

  // Event delegation for expense delete buttons
  const expensesBody = document.getElementById('expenses-body');
  if (expensesBody) expensesBody.addEventListener('click', async function (e) {
    const btn = e.target.closest('.delete-btn');
    if (btn) {
      const authorized = await requireAdmin();
      if (!authorized) return;
      const id = Number(btn.dataset.id);
      deleteExpense(id);
    }
  });

  // Event delegation for income delete buttons
  const incomeBody = document.getElementById('income-body');
  if (incomeBody) incomeBody.addEventListener('click', async function (e) {
    const paidToggle = e.target.closest('.paid-toggle');
    if (paidToggle) {
      const authorized = await requireAdmin();
      if (!authorized) {
        paidToggle.checked = !paidToggle.checked;
        return;
      }
      const id = Number(paidToggle.dataset.id);
      toggleIncomePaid(id, paidToggle.checked);
      return;
    }

    const btn = e.target.closest('.delete-btn');
    if (btn) {
      const authorized = await requireAdmin();
      if (!authorized) return;
      const id = Number(btn.dataset.id);
      deleteIncome(id);
    }
  });
});
