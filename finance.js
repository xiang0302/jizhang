/* ==========================================================================
   finance.js — 核心数据状态、本地持久化存储、实时余额与财报/成就计算引擎
   ========================================================================== */
const STORAGE_KEY = 'zhijian_ledger_v1_clean';
function getTodayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const LIQUID_EXCLUDE_KEYWORDS = ['epf', '公积金', '定投', '定期'];

const _initNow = new Date();
let currentYear = _initNow.getFullYear();
let currentMonth = _initNow.getMonth() + 1; // 1 - 12
let currentView = 'home'; // 'home' | 'detail'
let reportPeriodMode = 'month'; // 'year' | 'month' | 'week'
let reportWeekAnchor = getTodayISO(); // 周视图基准日期 YYYY-MM-DD
let ledgerFilterMode = 'inflow'; // 'inflow' | 'income' | 'ext_deposit' | 'transfer' | 'all'
let ledgerAccountFilter = 'all';
let ledgerSearchQuery = '';
let activeHistoryCategoryId = null;
let pendingDeleteCategoryId = null;
let pendingDeleteAccountId = null;

let appState = {
  accounts: [],
  categories: [],
  transactions: [],
  transfers: []
};

/* ==========================================================================
   财富里程碑段位阶梯（动态激励与阶段成就目标）
   ========================================================================== */
const WEALTH_TIERS = [
  { min: -Infinity, target: 1000, title: '起步启航期', badge: 'LV.1 启航', desc: '建立清晰账本，迈出第一笔正结余' },
  { min: 1000, target: 5000, title: '积微成著期', badge: 'LV.2 积微', desc: '应急备用金逐步成形，掌控现金流' },
  { min: 5000, target: 10000, title: '破万稳健期', badge: 'LV.3 稳健', desc: '抗风险护城河初具雏形' },
  { min: 10000, target: 30000, title: '三万蓄势期', badge: 'LV.4 蓄势', desc: '从存钱走向复利配置的关键跃迁' },
  { min: 30000, target: 50000, title: '五万进阶期', badge: 'LV.5 进阶', desc: '拥有坚实的财务底气与选择权' },
  { min: 50000, target: 100000, title: '十万里程碑', badge: 'LV.6 里程碑', desc: '迈入六位数净资产俱乐部' },
  { min: 100000, target: 250000, title: '复利加速期', badge: 'LV.7 复利', desc: '资产规模效应开始显现' },
  { min: 250000, target: 500000, title: '半百基石期', badge: 'LV.8 基石', desc: '构建长期被动收入的坚固底座' },
  { min: 500000, target: 1000000, title: '百万跨越期', badge: 'LV.9 跨越', desc: '向百万净资产巅峰全力冲刺' },
  { min: 1000000, target: 3000000, title: '百万财富自由者', badge: 'LV.MAX 自由', desc: '时间与资本的双重掌控者' }
];

function computeWealthMilestone(netWorth) {
  const nw = Number(netWorth) || 0;
  let tierIdx = 0;
  for (let i = 0; i < WEALTH_TIERS.length; i++) {
    if (nw >= WEALTH_TIERS[i].min) {
      tierIdx = i;
    }
  }
  const tier = WEALTH_TIERS[tierIdx];
  const baseFloor = tier.min === -Infinity ? 0 : tier.min;
  const span = Math.max(1, tier.target - baseFloor);
  const rawPct = nw <= baseFloor ? 0 : ((nw - baseFloor) / span) * 100;
  const progressPct = Math.min(100, Math.max(0, rawPct));
  const remaining = Math.max(0, tier.target - nw);

  return {
    tierIdx: tierIdx + 1,
    badge: tier.badge,
    title: tier.title,
    desc: tier.desc,
    target: tier.target,
    progressPct: Number(progressPct.toFixed(1)),
    remaining: Number(remaining.toFixed(2))
  };
}

/* ==========================================================================
   双引擎本地存储读写 (localStorage + IndexedDB + 云端桥接)
   ========================================================================== */
const IDB_NAME = 'ZhijianLedgerDB';
const IDB_STORE = 'ledger_store';

function readFromIDB() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction(IDB_STORE, 'readonly');
        const getReq = tx.objectStore(IDB_STORE).get(STORAGE_KEY);
        getReq.onsuccess = () => resolve(getReq.result || null);
        getReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch (err) {
      resolve(null);
    }
  });
}

function writeToIDB(dataObj) {
  if (!window.indexedDB) return;
  try {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(dataObj, STORAGE_KEY);
    };
  } catch (err) {}
}

function resetToEmptyState(skipCloud = false) {
  appState = {
    accounts: [],
    categories: [],
    transactions: [],
    transfers: []
  };
  saveState(skipCloud);
}

function saveState(skipCloud = false) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (e) {}
  writeToIDB(appState);

  if (!skipCloud && typeof window.scheduleCloudPush === 'function') {
    window.scheduleCloudPush();
  }
}

function generateId(prefix) {
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

/* ==========================================================================
   实时余额与历史快照核心引擎 (Single Source of Truth)
   ========================================================================== */
function isNonLiquidAccountName(name) {
  const lower = (name || '').toLowerCase();
  return LIQUID_EXCLUDE_KEYWORDS.some(k => lower.includes(k));
}

function getMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function getMonthEndDate(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

function formatDateISO(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseDateISO(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getWeekRange(anchorDateStr) {
  const dt = parseDateISO(anchorDateStr);
  const dayOfWeek = dt.getDay();
  const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(dt);
  monday.setDate(dt.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return {
    startStr: formatDateISO(monday),
    endStr: formatDateISO(sunday),
    label: `${monday.getFullYear()}年${monday.getMonth() + 1}月${monday.getDate()}日 - ${sunday.getMonth() + 1}月${sunday.getDate()}日`
  };
}

function buildBoundsForYear(y) {
  const prevY = y - 1;
  return {
    mode: 'year',
    reportTitlePrefix: '年度',
    label: `${y}全年`,
    startStr: `${y}-01-01`,
    endStr: `${y}-12-31`,
    prevEndStr: `${prevY}-12-31`,
    endPointTitle: '截止该年末',
    prevPointLabel: '上年末净资产',
    growthLabel: '财富增加率 (较上年末净资产)'
  };
}

function buildBoundsForMonth(y, m) {
  let prevY = y;
  let prevM = m - 1;
  if (prevM < 1) {
    prevM = 12;
    prevY -= 1;
  }
  return {
    mode: 'month',
    reportTitlePrefix: '月度',
    label: `${y}年${m}月`,
    startStr: `${y}-${String(m).padStart(2, '0')}-01`,
    endStr: getMonthEndDate(y, m),
    prevEndStr: getMonthEndDate(prevY, prevM),
    endPointTitle: '截止该月末',
    prevPointLabel: '上月末净资产',
    growthLabel: '财富增加率 (环比上月净资产)'
  };
}

function getReportPeriodBounds() {
  if (reportPeriodMode === 'year') {
    return buildBoundsForYear(currentYear);
  }
  if (reportPeriodMode === 'week') {
    const currWeek = getWeekRange(reportWeekAnchor);
    const prevAnchorDt = parseDateISO(reportWeekAnchor);
    prevAnchorDt.setDate(prevAnchorDt.getDate() - 7);
    const prevWeek = getWeekRange(formatDateISO(prevAnchorDt));
    return {
      mode: 'week',
      reportTitlePrefix: '周度',
      label: currWeek.label,
      startStr: currWeek.startStr,
      endStr: currWeek.endStr,
      prevEndStr: prevWeek.endStr,
      endPointTitle: '截止该周日',
      prevPointLabel: '上周末净资产',
      growthLabel: '财富增加率 (环比上周净资产)'
    };
  }
  return buildBoundsForMonth(currentYear, currentMonth);
}

function calculateAccountBalance(accountId, upToDateStr = null) {
  const acc = appState.accounts.find(a => a.id === accountId);
  if (!acc) return 0;

  let balance = Number(acc.initialBalance) || 0;
  const isLiability = acc.type === 'liability';

  for (const tx of appState.transactions) {
    if (upToDateStr && tx.date > upToDateStr) continue;

    const amt = Number(tx.amount) || 0;
    if (tx.kind === 'income') {
      if (tx.accountId === accountId) {
        balance += isLiability ? -amt : amt;
      }
    } else if (tx.kind === 'expense') {
      if (tx.accountId === accountId) {
        balance += isLiability ? amt : -amt;
      }
    } else if (tx.kind === 'repay') {
      if (tx.accountId === accountId) {
        balance += isLiability ? -amt : amt;
      }
      if (tx.fromAccountId && tx.fromAccountId === accountId) {
        balance += isLiability ? amt : -amt;
      }
    } else if (tx.kind === 'deposit') {
      if (tx.accountId === accountId) {
        balance += isLiability ? -amt : amt;
      }
      if (tx.sourceMode === 'internal' && tx.fromAccountId === accountId) {
        const fromAcc = appState.accounts.find(a => a.id === accountId);
        if (fromAcc) {
          balance += (fromAcc.type === 'liability') ? amt : -amt;
        }
      }
    }
  }

  for (const tr of appState.transfers) {
    if (upToDateStr && tr.date > upToDateStr) continue;
    const amt = Number(tr.amount) || 0;
    if (tr.fromAccountId === accountId) {
      balance += isLiability ? amt : -amt;
    }
    if (tr.toAccountId === accountId) {
      balance += isLiability ? -amt : amt;
    }
  }

  return Number(balance.toFixed(2));
}

function computeAssetsSnapshot(upToDateStr = null) {
  let totalAssets = 0;
  let totalDebt = 0;
  let liquidCash = 0;
  let investAssets = 0;
  let lockedAssets = 0;

  const accountDetails = appState.accounts.map(acc => {
    const rawBal = calculateAccountBalance(acc.id, upToDateStr);
    let effectiveBal = rawBal;
    let costBalance = rawBal;

    if (acc.type === 'liability') {
      totalDebt += rawBal;
    } else if (acc.isInvestment) {
      const mv = Number(acc.marketValue);
      if (
        acc.marketValue != null &&
        acc.marketValue !== '' &&
        isFinite(mv) &&
        (!upToDateStr || upToDateStr >= (acc.valueDate || ''))
      ) {
        effectiveBal = Number(mv.toFixed(2));
      }
      totalAssets += effectiveBal;
      investAssets += effectiveBal;
    } else {
      totalAssets += rawBal;
      if (!isNonLiquidAccountName(acc.name)) {
        liquidCash += rawBal;
      } else {
        lockedAssets += rawBal;
      }
    }

    return {
      ...acc,
      costBalance: Number(costBalance.toFixed(2)),
      currentBalance: Number(effectiveBal.toFixed(2))
    };
  });

  const netWorth = totalAssets - totalDebt;
  const debtRatio = totalAssets > 0 ? Number(((totalDebt / totalAssets) * 100).toFixed(1)) : 0;

  return {
    totalAssets: Number(totalAssets.toFixed(2)),
    totalDebt: Number(totalDebt.toFixed(2)),
    netWorth: Number(netWorth.toFixed(2)),
    liquidCash: Number(liquidCash.toFixed(2)),
    investAssets: Number(investAssets.toFixed(2)),
    lockedAssets: Number(lockedAssets.toFixed(2)),
    debtRatio,
    accountDetails
  };
}

function getAccountMonthInflow(accId) {
  const mKey = getMonthKey(currentYear, currentMonth);
  let sum = 0;
  appState.transactions.forEach(t => {
    if (t.kind === 'deposit' && t.accountId === accId && t.date && t.date.startsWith(mKey)) {
      sum += Number(t.amount) || 0;
    }
  });
  appState.transfers.forEach(t => {
    if (t.toAccountId === accId && t.date && t.date.startsWith(mKey)) {
      sum += Number(t.amount) || 0;
    }
  });
  return Number(sum.toFixed(2));
}

function computePeriodMetrics(startStr, endStr) {
  const periodTxs = appState.transactions.filter(tx => tx.date && tx.date >= startStr && tx.date <= endStr);

  let totalIncome = 0;
  let externalDeposit = 0;
  let internalDeposit = 0;
  let essentialExpense = 0;
  let discretionaryExpense = 0;
  let totalDeposit = 0;
  let totalRepay = 0;

  const expenseByCategory = {};
  const inflowBySource = {};

  for (const tx of periodTxs) {
    const amt = Number(tx.amount) || 0;
    const catObj = appState.categories.find(c => c.id === tx.categoryId);
    const label = catObj ? catObj.name : (tx.categoryNameSnapshot || '已删除项目');
    const targetAcc = appState.accounts.find(a => a.id === tx.accountId);
    const targetAccName = targetAcc ? targetAcc.name : '未知账户';

    if (tx.kind === 'income') {
      totalIncome += amt;
      const srcKey = `income_${label}`;
      if (!inflowBySource[srcKey]) {
        inflowBySource[srcKey] = {
          name: label,
          sourceType: '主营/常规收入',
          targetAccounts: new Set(),
          count: 0,
          amount: 0
        };
      }
      inflowBySource[srcKey].amount += amt;
      inflowBySource[srcKey].count += 1;
      inflowBySource[srcKey].targetAccounts.add(targetAccName);
    } else if (tx.kind === 'expense') {
      if (tx.subType === 'discretionary') {
        discretionaryExpense += amt;
      } else {
        essentialExpense += amt;
      }
      if (!expenseByCategory[label]) {
        expenseByCategory[label] = { name: label, amount: 0, subType: tx.subType || 'essential' };
      }
      expenseByCategory[label].amount += amt;
    } else if (tx.kind === 'deposit') {
      totalDeposit += amt;
      if (tx.sourceMode !== 'internal') {
        externalDeposit += amt;
        const srcKey = `ext_${label}`;
        if (!inflowBySource[srcKey]) {
          inflowBySource[srcKey] = {
            name: label,
            sourceType: '外部直接存入',
            targetAccounts: new Set(),
            count: 0,
            amount: 0
          };
        }
        inflowBySource[srcKey].amount += amt;
        inflowBySource[srcKey].count += 1;
        inflowBySource[srcKey].targetAccounts.add(targetAccName);
      } else {
        internalDeposit += amt;
      }
    } else if (tx.kind === 'repay') {
      totalRepay += amt;
    }
  }

  const totalNewInflow = totalIncome + externalDeposit;
  const totalExpense = essentialExpense + discretionaryExpense;
  const netProfit = totalIncome - totalExpense;
  const totalWealthCreated = totalNewInflow - totalExpense;
  const freeCashAfterEssential = totalIncome - essentialExpense;
  const savingsRate = totalNewInflow > 0
    ? Number((((totalNewInflow - totalExpense) / totalNewInflow) * 100).toFixed(1))
    : 0;

  const fundSourcesList = Object.values(inflowBySource)
    .map(item => ({
      ...item,
      amount: Number(item.amount.toFixed(2)),
      accountsDisplay: Array.from(item.targetAccounts).join('、')
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    periodTxs,
    totalIncome: Number(totalIncome.toFixed(2)),
    externalDeposit: Number(externalDeposit.toFixed(2)),
    internalDeposit: Number(internalDeposit.toFixed(2)),
    totalNewInflow: Number(totalNewInflow.toFixed(2)),
    essentialExpense: Number(essentialExpense.toFixed(2)),
    discretionaryExpense: Number(discretionaryExpense.toFixed(2)),
    totalExpense: Number(totalExpense.toFixed(2)),
    totalDeposit: Number(totalDeposit.toFixed(2)),
    totalRepay: Number(totalRepay.toFixed(2)),
    netProfit: Number(netProfit.toFixed(2)),
    totalWealthCreated: Number(totalWealthCreated.toFixed(2)),
    freeCashAfterEssential: Number(freeCashAfterEssential.toFixed(2)),
    savingsRate,
    expenseByCategory: Object.values(expenseByCategory).sort((a, b) => b.amount - a.amount),
    fundSourcesList
  };
}
