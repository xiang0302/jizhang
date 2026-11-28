/* ==========================================================================
   ui.js — 界面视图渲染、弹窗交互、排法与拖动排序及 PDF/JSON 导出控制
   ========================================================================== */
const TRASH_ICON_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

const CATEGORY_SECTIONS = [
  { kind: 'expense', title: '支出类', color: 'var(--debt-red)', sign: '-', empty: '暂无支出项目' },
  { kind: 'deposit', title: '存款', color: 'var(--deposit-indigo)', sign: '+', empty: '暂无存款项目' },
  { kind: 'income', title: '收入', color: '#34D399', sign: '+', empty: '暂无收入项目' },
  { kind: 'repay', title: '还债', color: 'var(--deposit-indigo)', sign: '-', empty: '', hideIfEmpty: true }
];

const HOME_LAYOUT_MODES = [
  { key: 'hybrid', label: '排法·混合' },
  { key: 'grid', label: '排法·双列网格' },
  { key: 'grid3', label: '排法·三列网格' },
  { key: 'list', label: '排法·横向列表' }
];
const HOME_LAYOUT_STORAGE_KEY = 'zhijian_home_layout_mode';
const CATEGORY_ORDER_STORAGE_KEY = 'zhijian_category_sort_order_v1';
let currentHomeLayoutMode = 'hybrid';

function getSavedCategoryOrder() {
  try {
    const raw = localStorage.getItem(CATEGORY_ORDER_STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function saveCategoryOrder(orderIds) {
  try {
    localStorage.setItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(orderIds));
  } catch (e) {}
}

function getSortedCategoriesForKind(kind) {
  const items = appState.categories.filter(c => c.kind === kind);
  const orderIds = getSavedCategoryOrder();
  if (orderIds.length === 0) return items;

  const rankMap = new Map();
  orderIds.forEach((id, idx) => rankMap.set(id, idx));

  return [...items].sort((a, b) => {
    const ra = rankMap.has(a.id) ? rankMap.get(a.id) : 999999;
    const rb = rankMap.has(b.id) ? rankMap.get(b.id) : 999999;
    return ra - rb;
  });
}

function applyHomeLayoutMode(mode) {
  const valid = HOME_LAYOUT_MODES.some(m => m.key === mode) ? mode : 'hybrid';
  currentHomeLayoutMode = valid;
  const listEl = document.getElementById('homeCategoriesList');
  if (listEl) {
    listEl.classList.remove('layout-hybrid', 'layout-grid', 'layout-grid3', 'layout-list');
    listEl.classList.add('layout-' + valid);
  }
  const labelEl = document.getElementById('layoutModeLabel');
  const found = HOME_LAYOUT_MODES.find(m => m.key === valid);
  if (labelEl && found) {
    labelEl.textContent = found.label;
  }
  document.querySelectorAll('#layoutModePicker .radio-pill').forEach(pill => {
    pill.classList.toggle('active', pill.getAttribute('data-mode') === valid);
  });
}

function selectHomeLayoutMode(mode) {
  applyHomeLayoutMode(mode);
  try {
    localStorage.setItem(HOME_LAYOUT_STORAGE_KEY, mode);
  } catch (e) {}
  const found = HOME_LAYOUT_MODES.find(m => m.key === mode);
  if (found) showToast(`已切换为「${found.label}」`);
}

function openLayoutSettingsModal() {
  applyHomeLayoutMode(currentHomeLayoutMode);
  renderSortableCategoryList();
  openModal('layoutSettingsModal');
}

function renderSortableCategoryList() {
  const container = document.getElementById('sortableCategoryContainer');
  if (!container) return;

  if (appState.categories.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding: 16px;">暂无记账项目，请先新增项目后再排序</div>`;
    return;
  }

  container.innerHTML = CATEGORY_SECTIONS.map(sec => {
    const items = getSortedCategoriesForKind(sec.kind);
    if (items.length === 0) return '';

    const rowsHtml = items.map((cat, index) => `
      <div class="sort-item-row" data-cat-id="${cat.id}" data-kind="${sec.kind}">
        <div class="sort-item-left">
          <span class="sort-rank-badge tabular-nums">${index + 1}</span>
          <span class="sort-item-name">${escapeHtml(cat.name)}</span>
        </div>
        <div class="sort-item-actions">
          ${index > 0 ? `<button type="button" class="icon-btn" title="置顶排第一位" onclick="pinCategoryFirst('${sec.kind}', '${cat.id}')">置顶</button>` : `<span style="font-size: 11px; color: #60A5FA; padding: 0 4px;">首位</span>`}
          <span class="sort-drag-handle" title="按住上下拖动">☰</span>
        </div>
      </div>
    `).join('');

    return `
      <div class="sort-group-block">
        <div class="sort-group-title">
          <span style="display:inline-block; width:4px; height:12px; border-radius:2px; background:${sec.color};"></span>
          <span>${sec.title}（拖动可调先后顺序）</span>
        </div>
        <div class="sort-group-list" data-kind="${sec.kind}">${rowsHtml}</div>
      </div>
    `;
  }).join('');

  bindPointerDragSort(container);
}

function pinCategoryFirst(kind, catId) {
  const items = getSortedCategoriesForKind(kind);
  const idx = items.findIndex(c => c.id === catId);
  if (idx <= 0) return;
  const [picked] = items.splice(idx, 1);
  items.unshift(picked);

  persistGroupOrder(kind, items.map(c => c.id));
  renderSortableCategoryList();
  renderHomeView();
  showToast(`已将「${picked.name}」排在第一位`);
}

function persistGroupOrder(kind, newKindIds) {
  const fullOrder = [];
  CATEGORY_SECTIONS.forEach(sec => {
    if (sec.kind === kind) {
      fullOrder.push(...newKindIds);
    } else {
      fullOrder.push(...getSortedCategoriesForKind(sec.kind).map(c => c.id));
    }
  });
  saveCategoryOrder(fullOrder);
}

function bindPointerDragSort(container) {
  container.querySelectorAll('.sort-group-list').forEach(listEl => {
    const kind = listEl.getAttribute('data-kind');
    let draggingRow = null;
    let pointerId = null;

    listEl.addEventListener('pointerdown', function (e) {
      const handle = e.target.closest('.sort-drag-handle');
      if (!handle) return;
      const row = handle.closest('.sort-item-row');
      if (!row) return;

      e.preventDefault();
      draggingRow = row;
      pointerId = e.pointerId;
      draggingRow.classList.add('dragging');
      if (handle.setPointerCapture) {
        try { handle.setPointerCapture(pointerId); } catch (err) {}
      }
    });

    listEl.addEventListener('pointermove', function (e) {
      if (!draggingRow || e.pointerId !== pointerId) return;
      const siblings = Array.from(listEl.querySelectorAll('.sort-item-row:not(.dragging)'));
      let insertBeforeEl = null;
      for (const sib of siblings) {
        const rect = sib.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        if (e.clientY < midY) {
          insertBeforeEl = sib;
          break;
        }
      }
      if (insertBeforeEl) {
        listEl.insertBefore(draggingRow, insertBeforeEl);
      } else {
        listEl.appendChild(draggingRow);
      }
    });

    const finishDrag = function (e) {
      if (!draggingRow || (e.pointerId !== undefined && e.pointerId !== pointerId)) return;
      draggingRow.classList.remove('dragging');
      draggingRow = null;
      pointerId = null;

      const newIds = Array.from(listEl.querySelectorAll('.sort-item-row')).map(r => r.getAttribute('data-cat-id'));
      persistGroupOrder(kind, newIds);
      renderSortableCategoryList();
      renderHomeView();
    };

    listEl.addEventListener('pointerup', finishDrag);
    listEl.addEventListener('pointercancel', finishDrag);
  });
}

async function initApp() {
  try {
    localStorage.removeItem('zhijian_ledger_v1');
  } catch (e) {}

  try {
    const savedLayout = localStorage.getItem(HOME_LAYOUT_STORAGE_KEY);
    if (savedLayout) applyHomeLayoutMode(savedLayout);
    else applyHomeLayoutMode('hybrid');
  } catch (e) {
    applyHomeLayoutMode('hybrid');
  }

  let loaded = null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      loaded = JSON.parse(raw);
    } catch (e) {}
  }
  if (!loaded) {
    loaded = await readFromIDB();
  }

  if (loaded && typeof loaded === 'object') {
    appState = {
      accounts: Array.isArray(loaded.accounts) ? loaded.accounts : [],
      categories: Array.isArray(loaded.categories) ? loaded.categories : [],
      transactions: Array.isArray(loaded.transactions) ? loaded.transactions : [],
      transfers: Array.isArray(loaded.transfers) ? loaded.transfers : []
    };
    saveState(true);
  } else {
    resetToEmptyState(true);
  }

  document.getElementById('openDetailBtn').addEventListener('click', () => switchView('detail'));
  window.addEventListener('beforeunload', () => saveState(true));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveState(true);
  });
  bindAccountBalanceSync();
  renderAll();

  if (typeof window.initFirebaseCloudSync === 'function') {
    window.initFirebaseCloudSync();
  }
}

/* ==========================================================================
   视图渲染 (Home View & Detail View & 财报级 PDF 选项导出)
   ========================================================================== */
function formatMoney(num) {
  const val = Number(num) || 0;
  return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function renderAll() {
  const monthStr = `${currentYear}年${currentMonth}月`;
  document.getElementById('homeMonthLabel').textContent = monthStr;

  renderHomeView();
  if (currentView === 'detail') {
    renderDetailView();
  }
}

function setLedgerFilter(filterMode) {
  ledgerFilterMode = filterMode;
  document.querySelectorAll('#ledgerFilterChips .filter-chip').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === filterMode);
  });
  renderDetailView();
}

function setReportPeriodMode(mode) {
  reportPeriodMode = mode;
  document.getElementById('tabPeriodYear').classList.toggle('active', mode === 'year');
  document.getElementById('tabPeriodMonth').classList.toggle('active', mode === 'month');
  document.getElementById('tabPeriodWeek').classList.toggle('active', mode === 'week');

  if (mode === 'week') {
    const anchorDt = parseDateISO(reportWeekAnchor);
    if (anchorDt.getFullYear() !== currentYear || (anchorDt.getMonth() + 1) !== currentMonth) {
      reportWeekAnchor = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    }
  }
  renderDetailView();
}

function changeReportPeriod(delta) {
  if (reportPeriodMode === 'year') {
    currentYear += delta;
  } else if (reportPeriodMode === 'week') {
    const dt = parseDateISO(reportWeekAnchor);
    dt.setDate(dt.getDate() + delta * 7);
    reportWeekAnchor = formatDateISO(dt);
    currentYear = dt.getFullYear();
    currentMonth = dt.getMonth() + 1;
  } else {
    changeMonth(delta);
    return;
  }
  renderAll();
}

/* PDF 导出选项弹窗控制 */
function openPdfExportModal() {
  const yearSel = document.getElementById('pdfYearSelect');
  const yearsSet = new Set([currentYear, 2025, 2026, 2027]);
  appState.transactions.forEach(tx => {
    if (tx.date && tx.date.length >= 4) {
      const y = parseInt(tx.date.slice(0, 4), 10);
      if (!isNaN(y)) yearsSet.add(y);
    }
  });
  const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);
  yearSel.innerHTML = sortedYears.map(y => `<option value="${y}">${y}年</option>`).join('');
  yearSel.value = String(currentYear);
  document.getElementById('pdfMonthSelect').value = String(currentMonth);

  const defaultType = reportPeriodMode === 'year' ? 'year' : 'month';
  selectPdfPeriodType(defaultType);
  openModal('pdfExportModal');
}

function selectPdfPeriodType(type) {
  document.getElementById('pdfPeriodTypeInput').value = type;
  document.getElementById('pdfTypeMonth').className = type === 'month' ? 'radio-pill active' : 'radio-pill';
  document.getElementById('pdfTypeYear').className = type === 'year' ? 'radio-pill active' : 'radio-pill';

  const monthCol = document.getElementById('pdfMonthCol');
  const gridWrap = document.getElementById('pdfDateSelectors');
  if (type === 'year') {
    monthCol.classList.add('hidden');
    gridWrap.style.gridTemplateColumns = '1fr';
  } else {
    monthCol.classList.remove('hidden');
    gridWrap.style.gridTemplateColumns = '1fr 1fr';
  }
  updatePdfPreviewHint();
}

function getSelectedPdfBounds() {
  const type = document.getElementById('pdfPeriodTypeInput').value;
  const y = parseInt(document.getElementById('pdfYearSelect').value, 10) || currentYear;
  const m = parseInt(document.getElementById('pdfMonthSelect').value, 10) || currentMonth;
  return type === 'year' ? buildBoundsForYear(y) : buildBoundsForMonth(y, m);
}

function updatePdfPreviewHint() {
  const b = getSelectedPdfBounds();
  document.getElementById('pdfRangePreviewText').textContent = `${b.reportTitlePrefix}报表 · ${b.label}（${b.startStr} 至 ${b.endStr}）`;
}

function confirmExportReportToPDF() {
  const customBounds = getSelectedPdfBounds();
  closeModal('pdfExportModal');
  buildPrintFinancialStatement(customBounds);
  showToast(`正在生成${customBounds.reportTitlePrefix}财报 PDF...`);
  setTimeout(() => {
    window.print();
  }, 220);
}

function switchView(viewName, focusSection = null) {
  currentView = viewName;
  if (viewName === 'home') {
    document.getElementById('homeView').classList.remove('hidden');
    document.getElementById('detailView').classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    document.getElementById('homeView').classList.add('hidden');
    document.getElementById('detailView').classList.remove('hidden');
    renderDetailView();
    if (focusSection === 'ledger') {
      setTimeout(() => {
        const target = document.getElementById('fundDetailsCard');
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth > 12) {
    currentMonth = 1;
    currentYear += 1;
  } else if (currentMonth < 1) {
    currentMonth = 12;
    currentYear -= 1;
  }
  renderAll();
}

function buildCategoryCardHtml(cat, mKey) {
  const catMonthTxs = appState.transactions.filter(t => t.categoryId === cat.id && t.date && t.date.startsWith(mKey));
  const monthSum = catMonthTxs.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);

  let badgeClass = 'badge-essential';
  let badgeText = '维持性支出';
  let iconChar = '支';
  let amountColor = 'var(--text-primary)';
  let amountPrefix = '';

  if (cat.kind === 'expense') {
    if (cat.subType === 'discretionary') {
      badgeClass = 'badge-discretionary';
      badgeText = '非必要支出';
      iconChar = '玩';
      amountColor = 'var(--discretionary-amber)';
    } else {
      badgeClass = 'badge-essential';
      badgeText = '维持性支出';
      iconChar = '刚';
    }
    amountPrefix = monthSum > 0 ? '-' : '';
  } else if (cat.kind === 'income') {
    badgeClass = 'badge-income';
    badgeText = '收入';
    iconChar = '收';
    amountColor = '#34D399';
    amountPrefix = monthSum > 0 ? '+' : '';
  } else if (cat.kind === 'deposit') {
    badgeClass = 'badge-deposit';
    badgeText = cat.sourceMode === 'internal' ? '存入·互转' : '存入·外部';
    iconChar = '存';
    amountColor = 'var(--deposit-indigo)';
    amountPrefix = monthSum > 0 ? '+' : '';
  } else if (cat.kind === 'repay') {
    badgeClass = 'badge-deposit';
    badgeText = '还债减债';
    iconChar = '还';
    amountColor = 'var(--deposit-indigo)';
    amountPrefix = monthSum > 0 ? '-' : '';
  }

  const defaultAcc = appState.accounts.find(a => a.id === cat.defaultAccountId);
  const accHint = defaultAcc ? defaultAcc.name : '未指定账户';

  return `
    <div class="category-grid-card" onclick="openQuickRecordModal('${cat.id}')">
      <div class="cat-grid-top">
        <div class="category-icon-box ${badgeClass}">${iconChar}</div>
        <div class="category-action-btns" onclick="event.stopPropagation()">
          <button class="icon-btn" title="查看本月明细" onclick="openTxHistoryModal('${cat.id}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
          </button>
          <button class="icon-btn" title="编辑项目" onclick="openCategoryModal('${cat.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
      </div>

      <div class="cat-grid-mid">
        <div class="category-name" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</div>
        <span class="tag-pill ${badgeClass}">${badgeText}</span>
      </div>

      <div class="cat-grid-bottom">
        <div class="category-month-sum tabular-nums" style="color: ${amountColor};">
          ${amountPrefix}${formatMoney(monthSum)}
        </div>
        <div class="category-sub">${escapeHtml(accHint)} · ${catMonthTxs.length}笔</div>
      </div>
    </div>
  `;
}

function renderInvestPanel(snap) {
  const panelEl = document.getElementById('investPanel');
  if (!panelEl) return;

  const list = snap.accountDetails.filter(a => a.isInvestment && a.type !== 'liability');
  let bodyHtml = '';

  if (list.length === 0) {
    bodyHtml = `
      <div class="empty-state">
        点右上「+ 新增投资账户」创建一个，就能看到本金、现值、盈亏和占总资产比例。<br>
        每月入金用「存入」项目（目标选这个投资账户，从现金账户转入）或「互转」记录即可。
      </div>
    `;
  } else {
    let costSum = 0;
    let valueSum = 0;
    let gainSum = 0;

    const rowsHtml = list.map(a => {
      const cost = a.costBalance;
      const valued = a.marketValue != null && a.marketValue !== '' && isFinite(Number(a.marketValue));
      const value = valued ? a.currentBalance : cost;
      const gain = valued ? value - cost : 0;
      costSum += cost;
      valueSum += value;
      gainSum += gain;

      const rate = valued && cost > 0 ? (gain / cost * 100) : null;
      const share = snap.totalAssets > 0 ? (value / snap.totalAssets * 100) : 0;
      const gainColor = gain >= 0 ? '#34D399' : '#F87171';
      const gainSign = gain >= 0 ? '+' : '-';
      const gainText = valued
        ? `${gainSign}${formatMoney(Math.abs(gain))}${rate !== null ? ` (${rate >= 0 ? '+' : ''}${rate.toFixed(2)}%)` : ''}`
        : '--';

      return `
        <div class="invest-row" ${list.length === 1 ? 'style="border-top: none; margin-top: 0; padding-top: 2px;"' : ''}>
          <div class="invest-row-top">
            <strong style="font-size: 14px;">${escapeHtml(a.name)}</strong>
            <div style="display: flex; align-items: center; gap: 6px;">
              <button class="btn btn-sm btn-secondary" onclick="openInvestModal('${a.id}')">更新现值</button>
              <button class="icon-btn" title="取消投资账户标记" onclick="removeInvestFlag('${a.id}')">&times;</button>
            </div>
          </div>
          <div class="invest-row-grid tabular-nums">
            <div>投入本金<b>${formatMoney(cost)}</b></div>
            <div>${valued ? '现值' : '现值（未录入）'}<b>${valued ? formatMoney(value) : '--'}</b></div>
            <div>盈亏<b style="color: ${valued ? gainColor : 'var(--text-muted)'};">${gainText}</b></div>
            <div>${currentMonth}月投入<b>${formatMoney(getAccountMonthInflow(a.id))}</b></div>
          </div>
          <div style="margin-top: 12px;">
            <div class="progress-header" style="font-size: 12px;">
              <span style="color: var(--text-secondary);">占总资产</span>
              <span class="tabular-nums">${share.toFixed(1)}%</span>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width: ${Math.min(share, 100)}%; background: #60A5FA;"></div>
            </div>
          </div>
          ${valued ? `<div style="font-size: 11px; color: var(--text-muted); margin-top: 6px;">现值更新于 ${escapeHtml(a.valueDate || '')}</div>` : ''}
        </div>
      `;
    }).join('');

    const totalShare = snap.totalAssets > 0 ? (valueSum / snap.totalAssets * 100) : 0;
    const totalGainColor = gainSum >= 0 ? '#34D399' : '#F87171';
    const totalGainSign = gainSum >= 0 ? '+' : '-';

    const summaryHtml = list.length > 1 ? `
      <div class="invest-summary tabular-nums">
        <div class="invest-stat">
          <div class="invest-stat-label">投入本金合计</div>
          <div class="invest-stat-val">${formatMoney(costSum)}</div>
        </div>
        <div class="invest-stat">
          <div class="invest-stat-label">现值合计</div>
          <div class="invest-stat-val">${formatMoney(valueSum)}</div>
        </div>
        <div class="invest-stat">
          <div class="invest-stat-label">总盈亏</div>
          <div class="invest-stat-val" style="color: ${totalGainColor};">${totalGainSign}${formatMoney(Math.abs(gainSum))}</div>
        </div>
        <div class="invest-stat">
          <div class="invest-stat-label">占总资产</div>
          <div class="invest-stat-val" style="color: #60A5FA;">${totalShare.toFixed(1)}%</div>
        </div>
      </div>
    ` : '';

    bodyHtml = `${summaryHtml}${rowsHtml}`;
  }

  panelEl.innerHTML = `
    <div class="section-header-bar">
      <div class="section-title">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2.2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>
        我的投资
      </div>
      <div class="account-actions">
        <button class="btn btn-sm btn-primary" onclick="openInvestModal()">+ 新增投资账户</button>
      </div>
    </div>
    ${bodyHtml}
  `;
}

function renderHomeView() {
  const snap = computeAssetsSnapshot(null);

  document.getElementById('homeTotalAssets').textContent = formatMoney(snap.totalAssets);
  document.getElementById('homeNetWorth').textContent = formatMoney(snap.netWorth);
  document.getElementById('homeTotalDebt').textContent = snap.totalDebt > 0 ? '-' + formatMoney(snap.totalDebt) : '0.00';

  // 1. 渲染我的小账户卡片（含快捷互转与删除按钮）
  const gridEl = document.getElementById('homeAccountsGrid');
  if (snap.accountDetails.length === 0) {
    gridEl.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;">暂无小账户，点击右上角“+ 添加小账户”开始配置</div>`;
  } else {
    gridEl.innerHTML = snap.accountDetails.map(acc => {
      const isDebt = acc.type === 'liability';
      const displayBal = isDebt
        ? (acc.currentBalance > 0 ? '-' + formatMoney(acc.currentBalance) : '0.00')
        : formatMoney(acc.currentBalance);
      const initBalStr = formatMoney(acc.initialBalance || 0);
      return `
        <div class="account-mini-card" onclick="openEditAccountModal('${acc.id}')" title="点击设置或修改起始金额">
          <div class="account-mini-top">
            <span class="account-name">${escapeHtml(acc.name)}</span>
            <div class="account-mini-actions" onclick="event.stopPropagation()">
              <button class="account-transfer-shortcut" title="从此账户转出" onclick="openTransferModal('${acc.id}')">
                互转
              </button>
            </div>
          </div>
          <div>
            <div class="account-balance tabular-nums ${isDebt ? 'text-debt' : 'text-asset'}">${displayBal}</div>
            <div class="account-type-tag" style="display: flex; justify-content: space-between; align-items: center;">
              <span>${isDebt ? '负债账户' : (acc.isInvestment ? '投资账户' : '资产账户')}</span>
              <span class="tabular-nums">起始: ${initBalStr}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // 2. 渲染我的投资面板
  renderInvestPanel(snap);

  // 3. 按大类板块与自定义排序渲染当月记账项目栏
  const mKey = getMonthKey(currentYear, currentMonth);
  const listEl = document.getElementById('homeCategoriesList');
  applyHomeLayoutMode(currentHomeLayoutMode);

  if (appState.categories.length === 0) {
    listEl.innerHTML = `<div class="detail-card empty-state">暂无记账项目，点击上方“+ 新增项目”创建您的第一个账目分类</div>`;
    return;
  }

  const sumByCatId = {};
  appState.transactions.forEach(t => {
    if (t.date && t.date.startsWith(mKey)) {
      sumByCatId[t.categoryId] = (sumByCatId[t.categoryId] || 0) + (Number(t.amount) || 0);
    }
  });

  listEl.innerHTML = CATEGORY_SECTIONS.map(sec => {
    const items = getSortedCategoriesForKind(sec.kind);
    if (items.length === 0 && sec.hideIfEmpty) return '';

    const total = items.reduce((acc, c) => acc + (sumByCatId[c.id] || 0), 0);
    const totalText = total > 0 ? sec.sign + formatMoney(total) : '0.00';

    const cardsHtml = items.length > 0
      ? items.map(cat => buildCategoryCardHtml(cat, mKey)).join('')
      : `<div class="cat-section-empty">${sec.empty}，点右上「+ 新增项目」添加</div>`;

    return `
      <section class="cat-section">
        <div class="cat-section-head">
          <span class="cat-section-bar" style="background: ${sec.color};"></span>
          <span class="cat-section-title">${sec.title}</span>
          <span class="cat-section-count">${items.length}个项目</span>
          <span class="cat-section-total tabular-nums" style="color: ${sec.color};">本月 ${totalText}</span>
        </div>
        <div class="categories-grid">${cardsHtml}</div>
      </section>
    `;
  }).join('');
}

function renderDetailView() {
  const bounds = getReportPeriodBounds();
  document.getElementById('detailMonthLabel').textContent = bounds.label;
  document.getElementById('detailOverviewTitle').textContent = `1. 核心资产概览 (${bounds.endPointTitle})`;
  document.getElementById('detailGrowthLabel').textContent = bounds.growthLabel;

  const snap = computeAssetsSnapshot(bounds.endStr);
  const prevSnap = computeAssetsSnapshot(bounds.prevEndStr);
  const metrics = computePeriodMetrics(bounds.startStr, bounds.endStr);

  document.getElementById('detailTotalAssets').textContent = formatMoney(snap.totalAssets);
  document.getElementById('detailNetWorth').textContent = formatMoney(snap.netWorth);

  const detailAccEl = document.getElementById('detailAccountsList');
  if (snap.accountDetails.length === 0) {
    detailAccEl.innerHTML = `<div class="empty-state">暂无小账户</div>`;
  } else {
    detailAccEl.innerHTML = snap.accountDetails.map(acc => {
      const isDebt = acc.type === 'liability';
      const displayBal = isDebt
        ? (acc.currentBalance > 0 ? '-' + formatMoney(acc.currentBalance) : '0.00')
        : formatMoney(acc.currentBalance);
      const typeDesc = isDebt ? '负债账户' : (acc.isInvestment ? '投资账户' : '资产账户');
      return `
        <div class="detail-account-row">
          <div>
            <div style="font-weight: 700; font-size: 14px;">${escapeHtml(acc.name)}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${typeDesc} · 初始设定: ${formatMoney(acc.initialBalance)}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
            <span class="tabular-nums ${isDebt ? 'text-debt' : 'text-asset'}" style="font-weight: 700; font-size: 15px;">${displayBal}</span>
            <button class="btn btn-sm btn-secondary no-print" onclick="openEditAccountModal('${acc.id}')">修改/校准</button>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('detailCashRetention').textContent = formatMoney(snap.liquidCash);
  document.getElementById('detailMonthSurplusNote').textContent = `本周期净结余: ${metrics.netProfit >= 0 ? '+' : ''}${formatMoney(metrics.netProfit)}`;
  document.getElementById('detailTotalDebt').textContent = snap.totalDebt > 0 ? '-' + formatMoney(snap.totalDebt) : '0.00';

  const growthEl = document.getElementById('detailWealthGrowth');
  document.getElementById('detailPrevNetNote').textContent = `${bounds.prevPointLabel}: ${formatMoney(prevSnap.netWorth)}`;
  if (prevSnap.netWorth === 0) {
    growthEl.textContent = '--';
    growthEl.style.color = 'var(--text-muted)';
  } else {
    const rate = ((snap.netWorth - prevSnap.netWorth) / Math.abs(prevSnap.netWorth)) * 100;
    const sign = rate >= 0 ? '+' : '';
    growthEl.textContent = `${sign}${rate.toFixed(2)}%`;
    growthEl.style.color = rate >= 0 ? '#34D399' : '#F87171';
  }

  // 渲染第 3 板块：资金明细与所有资金来源
  renderFundDetailsSection(metrics, snap);

  // 渲染第 4 板块：支出占比图表
  document.getElementById('detailTotalExpenseBadge').textContent = `总支出: ${formatMoney(metrics.totalExpense)}`;
  document.getElementById('donutCenterTotal').textContent = formatMoney(metrics.totalExpense);
  renderExpenseDonutChart(metrics);

  // 渲染第 5 板块：现金流与利润表
  document.getElementById('tableIncome').textContent = `+${formatMoney(metrics.totalIncome)}`;
  const netProfitEl = document.getElementById('tableNetProfit');
  netProfitEl.textContent = `${metrics.netProfit >= 0 ? '+' : ''}${formatMoney(metrics.netProfit)}`;
  netProfitEl.style.color = metrics.netProfit >= 0 ? '#34D399' : '#F87171';

  document.getElementById('tableDiscretionary').textContent = `-${formatMoney(metrics.discretionaryExpense)}`;
  const freeCashEl = document.getElementById('tableFreeCash');
  freeCashEl.textContent = `${metrics.freeCashAfterEssential >= 0 ? '+' : ''}${formatMoney(metrics.freeCashAfterEssential)}`;
  freeCashEl.style.color = metrics.freeCashAfterEssential >= 0 ? '#60A5FA' : '#F87171';

  document.getElementById('tableDepositTotal').textContent = formatMoney(metrics.totalDeposit);

  // 同步更新财报级打印 DOM
  buildPrintFinancialStatement(bounds);
}

function renderFundDetailsSection(metrics, snap) {
  document.getElementById('detailTotalInflowBadge').textContent = `周期新增资金总流入: +${formatMoney(metrics.totalNewInflow)}`;

  const summaryBody = document.getElementById('fundSourcesSummaryBody');
  const totalInflow = metrics.totalNewInflow;

  let summaryRowsHtml = '';
  if (metrics.fundSourcesList.length === 0) {
    summaryRowsHtml = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 18px;">
          所选周期内暂无新增资金流入记录（“收入”或“外部直接存入”类目）
        </td>
      </tr>
    `;
  } else {
    summaryRowsHtml = metrics.fundSourcesList.map(src => {
      const pct = totalInflow > 0 ? ((src.amount / totalInflow) * 100).toFixed(1) + '%' : '0.0%';
      const isIncome = src.sourceType.includes('收入');
      return `
        <tr>
          <td>
            <strong>${escapeHtml(src.name)}</strong>
            <span style="font-size: 11px; color: var(--text-muted);">(${src.count}笔)</span>
          </td>
          <td>
            <span class="tag-pill ${isIncome ? 'badge-income' : 'badge-deposit'}">${escapeHtml(src.sourceType)}</span>
          </td>
          <td style="color: var(--text-secondary);">${escapeHtml(src.accountsDisplay)}</td>
          <td class="num-col text-asset" style="font-weight: 700;">+${formatMoney(src.amount)}</td>
          <td class="num-col" style="font-weight: 600; color: var(--text-secondary);">${pct}</td>
        </tr>
      `;
    }).join('');

    summaryRowsHtml += `
      <tr style="background: var(--bg-subtle); font-weight: 800;">
        <td colspan="3">合计新增资金流入（所有外部资金来源总和）</td>
        <td class="num-col text-asset">+${formatMoney(totalInflow)}</td>
        <td class="num-col">100.0%</td>
      </tr>
    `;
  }

  const initAccounts = snap.accountDetails.filter(a => Number(a.initialBalance) > 0);
  if (initAccounts.length > 0) {
    const totalInit = initAccounts.reduce((s, a) => s + (a.type === 'liability' ? 0 : Number(a.initialBalance)), 0);
    if (totalInit > 0) {
      summaryRowsHtml += `
        <tr style="background: rgba(255, 255, 255, 0.02);">
          <td colspan="3" style="font-size: 12px; color: var(--text-secondary);">
            <strong>存量本金来源（开账起始资产余额）</strong>：
            ${initAccounts.filter(a => a.type !== 'liability').map(a => `${escapeHtml(a.name)}(${formatMoney(a.initialBalance)})`).join('、')}
          </td>
          <td class="num-col" style="font-weight: 700; color: var(--text-primary);">${formatMoney(totalInit)}</td>
          <td class="num-col" style="font-size: 11px; color: var(--text-muted);">期初本金</td>
        </tr>
      `;
    }
  }
  summaryBody.innerHTML = summaryRowsHtml;

  const ledgerBody = document.getElementById('fundLedgerTableBody');
  let filteredTxs = [...metrics.periodTxs].sort((a, b) => b.date.localeCompare(a.date));

  if (ledgerFilterMode === 'inflow') {
    filteredTxs = filteredTxs.filter(t => t.kind === 'income' || (t.kind === 'deposit' && t.sourceMode !== 'internal'));
  } else if (ledgerFilterMode === 'income') {
    filteredTxs = filteredTxs.filter(t => t.kind === 'income');
  } else if (ledgerFilterMode === 'ext_deposit') {
    filteredTxs = filteredTxs.filter(t => t.kind === 'deposit' && t.sourceMode !== 'internal');
  }

  if (filteredTxs.length === 0) {
    ledgerBody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; color: var(--text-muted); padding: 18px;">
          当前筛选条件下暂无对应的资金流水记录
        </td>
      </tr>
    `;
    return;
  }

  ledgerBody.innerHTML = filteredTxs.map(tx => {
    const catObj = appState.categories.find(c => c.id === tx.categoryId);
    const catName = catObj ? catObj.name : (tx.categoryNameSnapshot || '已删除项目');
    const targetAcc = appState.accounts.find(a => a.id === tx.accountId);
    let accText = targetAcc ? targetAcc.name : '未知账户';
    if ((tx.kind === 'deposit' && tx.sourceMode === 'internal') || (tx.kind === 'repay' && tx.fromAccountId)) {
      const fromAcc = appState.accounts.find(a => a.id === tx.fromAccountId);
      accText = `${fromAcc ? fromAcc.name : '未知'} → ${accText}`;
    }

    let typeBadge = '';
    let amountHtml = '';
    if (tx.kind === 'income') {
      typeBadge = `<span class="tag-pill badge-income">收入来源</span>`;
      amountHtml = `<span class="text-asset" style="font-weight: 700;">+${formatMoney(tx.amount)}</span>`;
    } else if (tx.kind === 'deposit') {
      const isExt = tx.sourceMode !== 'internal';
      typeBadge = `<span class="tag-pill badge-deposit">${isExt ? '外部存入' : '内部转存'}</span>`;
      amountHtml = `<span style="color: var(--deposit-indigo); font-weight: 700;">+${formatMoney(tx.amount)}</span>`;
    } else if (tx.kind === 'repay') {
      typeBadge = `<span class="tag-pill badge-deposit">还债</span>`;
      amountHtml = `<span style="color: var(--deposit-indigo); font-weight: 700;">-${formatMoney(tx.amount)}</span>`;
    } else {
      const isDis = tx.subType === 'discretionary';
      typeBadge = `<span class="tag-pill ${isDis ? 'badge-discretionary' : 'badge-essential'}">${isDis ? '非必要支出' : '维持支出'}</span>`;
      amountHtml = `<span class="text-debt" style="font-weight: 700;">-${formatMoney(tx.amount)}</span>`;
    }

    return `
      <tr>
        <td style="white-space: nowrap; color: var(--text-secondary);">${tx.date}</td>
        <td>
          <strong>${escapeHtml(catName)}</strong>
          ${tx.note ? `<div style="font-size: 11px; color: var(--text-muted);">${escapeHtml(tx.note)}</div>` : ''}
        </td>
        <td>${typeBadge}</td>
        <td style="color: var(--text-secondary);">${escapeHtml(accText)}</td>
        <td class="num-col">${amountHtml}</td>
      </tr>
    `;
  }).join('');
}

function buildPrintFinancialStatement(targetBounds = null) {
  const bounds = targetBounds || getReportPeriodBounds();
  const snap = computeAssetsSnapshot(bounds.endStr);
  const prevSnap = computeAssetsSnapshot(bounds.prevEndStr);
  const metrics = computePeriodMetrics(bounds.startStr, bounds.endStr);

  let growthStr = '--';
  if (prevSnap.netWorth !== 0) {
    const rate = ((snap.netWorth - prevSnap.netWorth) / Math.abs(prevSnap.netWorth)) * 100;
    growthStr = `${rate >= 0 ? '+' : ''}${rate.toFixed(2)}%`;
  }

  const assetRows = snap.accountDetails.map(acc => {
    const isDebt = acc.type === 'liability';
    const kindDesc = isDebt ? '负债类账户' : (acc.isInvestment ? '投资类账户' : '资产类账户');
    return `
      <tr>
        <td>${escapeHtml(acc.name)}</td>
        <td>${kindDesc}</td>
        <td class="num">${formatMoney(acc.initialBalance)}</td>
        <td class="num">${isDebt && acc.currentBalance > 0 ? '-' : ''}${formatMoney(acc.currentBalance)}</td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="4" style="text-align:center;">暂无账户记录</td></tr>`;

  const totalInflow = metrics.totalNewInflow;
  const sourceRows = metrics.fundSourcesList.map(src => {
    const pct = totalInflow > 0 ? ((src.amount / totalInflow) * 100).toFixed(1) + '%' : '0.0%';
    return `
      <tr>
        <td>${escapeHtml(src.name)}</td>
        <td>${escapeHtml(src.sourceType)}</td>
        <td>${escapeHtml(src.accountsDisplay)}</td>
        <td class="num">${src.count}</td>
        <td class="num">+${formatMoney(src.amount)}</td>
        <td class="num">${pct}</td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="6" style="text-align:center;">本统计周期内暂无新增资金流入</td></tr>`;

  const sortedTxs = [...metrics.periodTxs].sort((a, b) => a.date.localeCompare(b.date));
  const txRows = sortedTxs.map((tx, idx) => {
    const catObj = appState.categories.find(c => c.id === tx.categoryId);
    const catName = catObj ? catObj.name : (tx.categoryNameSnapshot || '已删除项目');
    const targetAcc = appState.accounts.find(a => a.id === tx.accountId);
    let accText = targetAcc ? targetAcc.name : '未知账户';
    if ((tx.kind === 'deposit' && tx.sourceMode === 'internal') || (tx.kind === 'repay' && tx.fromAccountId)) {
      const fromAcc = appState.accounts.find(a => a.id === tx.fromAccountId);
      accText = `${fromAcc ? fromAcc.name : '未知'} -> ${accText}`;
    }

    let kindLabel = '维持性支出';
    let sign = '-';
    if (tx.kind === 'income') {
      kindLabel = '收入(资金来源)';
      sign = '+';
    } else if (tx.kind === 'deposit') {
      kindLabel = tx.sourceMode === 'internal' ? '内部转存' : '外部存入(资金来源)';
      sign = '+';
    } else if (tx.kind === 'repay') {
      kindLabel = '偿还负债';
      sign = '-';
    } else if (tx.subType === 'discretionary') {
      kindLabel = '非必要支出';
      sign = '-';
    }

    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${tx.date}</td>
        <td>${escapeHtml(catName)}</td>
        <td>${kindLabel}</td>
        <td>${escapeHtml(accText)}</td>
        <td>${escapeHtml(tx.note || '-')}</td>
        <td class="num">${sign}${formatMoney(tx.amount)}</td>
      </tr>
    `;
  }).join('') || `<tr><td colspan="7" style="text-align:center;">本统计周期内暂无资金流水记录</td></tr>`;

  const container = document.getElementById('printFinancialStatement');
  container.innerHTML = `
    <div class="stmt-header">
      <div>
        <div class="stmt-title">智简账本 · ${bounds.reportTitlePrefix}财务与资金明细报告</div>
        <div style="font-size: 9.5pt; color: #334155; margin-top: 4px;">
          报告类型：<strong>${bounds.reportTitlePrefix}报表</strong> ｜ 统计周期：<strong>${bounds.label}</strong>（${bounds.startStr} 至 ${bounds.endStr}）
        </div>
      </div>
      <div class="stmt-meta">
        <div>编制基准日：${DEFAULT_TODAY}</div>
        <div>货币单位：元（标准会计精度 0.00）</div>
      </div>
    </div>

    <div class="stmt-kpi-strip">
      <div class="stmt-kpi-cell">
        <div class="stmt-kpi-label">期末总资产</div>
        <div class="stmt-kpi-val">${formatMoney(snap.totalAssets)}</div>
      </div>
      <div class="stmt-kpi-cell">
        <div class="stmt-kpi-label">期末总负债</div>
        <div class="stmt-kpi-val">${snap.totalDebt > 0 ? '-' : ''}${formatMoney(snap.totalDebt)}</div>
      </div>
      <div class="stmt-kpi-cell">
        <div class="stmt-kpi-label">期末净资产 (环比 ${growthStr})</div>
        <div class="stmt-kpi-val">${formatMoney(snap.netWorth)}</div>
      </div>
      <div class="stmt-kpi-cell">
        <div class="stmt-kpi-label">${bounds.reportTitlePrefix}新增资金总流入</div>
        <div class="stmt-kpi-val">+${formatMoney(metrics.totalNewInflow)}</div>
      </div>
    </div>

    <div class="stmt-section">
      <div class="stmt-section-title">表一：资产负债状况明细表（${bounds.endPointTitle}：${bounds.endStr}）</div>
      <table class="stmt-table">
        <thead>
          <tr>
            <th>账户名称</th>
            <th>账户性质</th>
            <th class="num">开账起始余额</th>
            <th class="num">期末结存余额</th>
          </tr>
        </thead>
        <tbody>
          ${assetRows}
          <tr class="stmt-total-row">
            <td colspan="3">期末净资产合计（总资产 ${formatMoney(snap.totalAssets)} - 总负债 ${formatMoney(snap.totalDebt)}）</td>
            <td class="num">${formatMoney(snap.netWorth)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="stmt-section">
      <div class="stmt-section-title">表二：${bounds.reportTitlePrefix}全部资金来源汇总表（收入及外部直接注入资金）</div>
      <table class="stmt-table">
        <thead>
          <tr>
            <th>资金来源项目</th>
            <th>来源类型</th>
            <th>入账目标账户</th>
            <th class="num">笔数</th>
            <th class="num">${bounds.reportTitlePrefix}累计金额</th>
            <th class="num">占总流入比</th>
          </tr>
        </thead>
        <tbody>
          ${sourceRows}
          <tr class="stmt-total-row">
            <td colspan="4">${bounds.reportTitlePrefix}新增资金来源总计（常规收入 + 外部直接存入）</td>
            <td class="num">+${formatMoney(metrics.totalNewInflow)}</td>
            <td class="num">100.0%</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="stmt-section">
      <div class="stmt-section-title">表三：${bounds.reportTitlePrefix}损益与自由现金流量表</div>
      <table class="stmt-table">
        <thead>
          <tr>
            <th>财务报表项目</th>
            <th>核算口径说明</th>
            <th class="num">本周期金额</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><strong>一、${bounds.reportTitlePrefix}营业/常规总收入</strong></td>
            <td>所选周期内全部“收入”类项目入账总和</td>
            <td class="num">+${formatMoney(metrics.totalIncome)}</td>
          </tr>
          <tr>
            <td><strong>二、${bounds.reportTitlePrefix}总支出</strong></td>
            <td>维持性支出 (${formatMoney(metrics.essentialExpense)}) + 非必要支出 (${formatMoney(metrics.discretionaryExpense)})</td>
            <td class="num">-${formatMoney(metrics.totalExpense)}</td>
          </tr>
          <tr>
            <td><strong>三、${bounds.reportTitlePrefix}净利润</strong></td>
            <td>总收入 - 总支出（内部存入与还债不扣减净利润）</td>
            <td class="num">${metrics.netProfit >= 0 ? '+' : ''}${formatMoney(metrics.netProfit)}</td>
          </tr>
          <tr>
            <td><strong>四、扣除维持性开支后可用现金</strong></td>
            <td>总收入 - 维持性支出（衡量真实自由支配能力）</td>
            <td class="num">${metrics.freeCashAfterEssential >= 0 ? '+' : ''}${formatMoney(metrics.freeCashAfterEssential)}</td>
          </tr>
          <tr>
            <td><strong>五、外部直接存入资金</strong></td>
            <td>不计入常规收入但直接增加净资产的外部注入（如公司代缴公积金等）</td>
            <td class="num">+${formatMoney(metrics.externalDeposit)}</td>
          </tr>
          <tr class="stmt-total-row">
            <td colspan="2">六、期末流动资金现金留存总额（扣除投资/公积金/定期等资产后可用余额）</td>
            <td class="num">${formatMoney(snap.liquidCash)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="stmt-section">
      <div class="stmt-section-title">表四：${bounds.reportTitlePrefix}资金明细流水总账（共 ${sortedTxs.length} 笔凭证记录）</div>
      <table class="stmt-table">
        <thead>
          <tr>
            <th style="width: 36px;">序号</th>
            <th style="width: 86px;">日期</th>
            <th>项目名称</th>
            <th>资金性质</th>
            <th>账户流向</th>
            <th>备注说明</th>
            <th class="num">发生金额</th>
          </tr>
        </thead>
        <tbody>
          ${txRows}
        </tbody>
      </table>
    </div>

    <div class="stmt-footer-note">
      <span>智简账本 · 个人财务管理系统自动生成（${bounds.reportTitlePrefix}报告）</span>
      <span>数据校验一致 · 资产平衡校验通过</span>
    </div>
  `;
}

function renderExpenseDonutChart(metrics) {
  const svg = document.getElementById('expenseDonutSvg');
  const breakdownEl = document.getElementById('expenseBreakdownArea');
  const total = metrics.totalExpense;

  const cx = 85, cy = 85, r = 64;
  const circumference = 2 * Math.PI * r;

  if (total <= 0) {
    svg.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1E293B" stroke-width="20" />`;
    breakdownEl.innerHTML = `
      <div style="font-size: 13px; color: var(--text-muted); padding: 12px 0;">
        本月暂无支出记录。记入支出后，此处将自动展示“维持性支出”与“非必要支出”的金额与占比。
      </div>
    `;
    return;
  }

  const essPct = (metrics.essentialExpense / total) * 100;
  const disPct = (metrics.discretionaryExpense / total) * 100;
  const essDash = (essPct / 100) * circumference;
  const disDash = (disPct / 100) * circumference;

  svg.innerHTML = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#1E293B" stroke-width="20" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#38BDF8" stroke-width="20"
      stroke-dasharray="${essDash} ${circumference}"
      transform="rotate(-90 ${cx} ${cy})" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#FBBF24" stroke-width="20"
      stroke-dasharray="${disDash} ${circumference}"
      stroke-dashoffset="-${essDash}"
      transform="rotate(-90 ${cx} ${cy})" />
  `;

  let html = `
    <div class="progress-row">
      <div class="progress-header">
        <span style="color: #38BDF8;">● 维持性支出</span>
        <span class="tabular-nums">${formatMoney(metrics.essentialExpense)} (${essPct.toFixed(1)}%)</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${essPct}%; background: #38BDF8;"></div>
      </div>
    </div>
    <div class="progress-row">
      <div class="progress-header">
        <span style="color: #FBBF24;">● 非必要支出</span>
        <span class="tabular-nums">${formatMoney(metrics.discretionaryExpense)} (${disPct.toFixed(1)}%)</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: ${disPct}%; background: #FBBF24;"></div>
      </div>
    </div>
  `;

  if (metrics.expenseByCategory.length > 0) {
    html += `<div style="margin-top: 14px; padding-top: 10px; border-top: 1px dashed var(--border-strong); font-size: 12px; font-weight: 700; color: var(--text-secondary);">各具体支出项目占比明细</div>`;
    html += metrics.expenseByCategory.map(item => {
      const pct = (item.amount / total) * 100;
      const barColor = item.subType === 'discretionary' ? '#FBBF24' : '#38BDF8';
      return `
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 12px; margin-top: 6px;">
          <span>${escapeHtml(item.name)} <span style="color: var(--text-muted);">(${item.subType === 'discretionary' ? '非必要' : '维持'})</span></span>
          <span class="tabular-nums" style="font-weight: 600;">${formatMoney(item.amount)} · <span style="color: ${barColor};">${pct.toFixed(1)}%</span></span>
        </div>
      `;
    }).join('');
  }

  breakdownEl.innerHTML = html;
}

/* ==========================================================================
   交互逻辑：小账户添加、起始金额设置、删除确认、互转与投资账户管理
   ========================================================================== */
function selectAccountType(type) {
  document.getElementById('accTypeInput').value = type;
  document.getElementById('pillAsset').className = type === 'asset' ? 'radio-pill active-green' : 'radio-pill';
  document.getElementById('pillLiability').className = type === 'liability' ? 'radio-pill active-red' : 'radio-pill';
}

function openAddAccountModal() {
  document.getElementById('accountModalTitle').textContent = '添加小账户';
  document.getElementById('editAccountId').value = '';
  document.getElementById('accNameInput').value = '';
  document.getElementById('accInitialInput').value = '0';
  document.getElementById('accTypeGroup').classList.remove('hidden');
  document.getElementById('accBalanceLabel').textContent = '起始金额 (默认为 0)';
  document.getElementById('accBalanceHint').classList.remove('hidden');
  document.getElementById('accCalibrateGroup').classList.add('hidden');
  toggleModalDeleteBtn('accountForm', false);
  selectAccountType('asset');
  openModal('accountModal');
}

function openEditAccountModal(accId) {
  const acc = appState.accounts.find(a => a.id === accId);
  if (!acc) return;
  const currentBal = calculateAccountBalance(acc.id, null);

  document.getElementById('accountModalTitle').textContent = '设置小账户与起始金额';
  document.getElementById('editAccountId').value = acc.id;
  document.getElementById('accNameInput').value = acc.name;
  document.getElementById('accTypeInput').value = acc.type;
  document.getElementById('accTypeGroup').classList.add('hidden');

  document.getElementById('accBalanceLabel').textContent = '起始金额 (开账初始余额)';
  document.getElementById('accInitialInput').value = Number(acc.initialBalance || 0).toFixed(2);
  document.getElementById('accBalanceHint').classList.add('hidden');

  document.getElementById('accCalibrateGroup').classList.remove('hidden');
  document.getElementById('accCalibrateCurrentInput').value = currentBal.toFixed(2);
  toggleModalDeleteBtn('accountForm', true, '删除此账户', function () {
    closeModal('accountModal');
    openDeleteAccountModal(acc.id);
  });

  openModal('accountModal');
}

function bindAccountBalanceSync() {
  const initInput = document.getElementById('accInitialInput');
  const currInput = document.getElementById('accCalibrateCurrentInput');

  initInput.addEventListener('input', function () {
    const editId = document.getElementById('editAccountId').value;
    if (!editId) return;
    const acc = appState.accounts.find(a => a.id === editId);
    if (!acc) return;
    const oldCurrent = calculateAccountBalance(editId, null);
    const oldInit = Number(acc.initialBalance) || 0;
    const txDelta = oldCurrent - oldInit;
    const newInit = parseFloat(initInput.value) || 0;
    currInput.value = (newInit + txDelta).toFixed(2);
  });

  currInput.addEventListener('input', function () {
    const editId = document.getElementById('editAccountId').value;
    if (!editId) return;
    const acc = appState.accounts.find(a => a.id === editId);
    if (!acc) return;
    const oldCurrent = calculateAccountBalance(editId, null);
    const oldInit = Number(acc.initialBalance) || 0;
    const txDelta = oldCurrent - oldInit;
    const targetCurrent = parseFloat(currInput.value) || 0;
    initInput.value = (targetCurrent - txDelta).toFixed(2);
  });
}

function saveAccountForm(e) {
  e.preventDefault();
  const editId = document.getElementById('editAccountId').value;
  const name = document.getElementById('accNameInput').value.trim();
  const type = document.getElementById('accTypeInput').value;
  const inputInitVal = parseFloat(document.getElementById('accInitialInput').value) || 0;

  if (!name) return;

  if (!editId) {
    appState.accounts.push({
      id: generateId('acc'),
      name,
      type,
      initialBalance: Number(Math.abs(inputInitVal).toFixed(2))
    });
    showToast(`已创建小账户「${name}」`);
  } else {
    const acc = appState.accounts.find(a => a.id === editId);
    if (acc) {
      acc.name = name;
      acc.initialBalance = Number(inputInitVal.toFixed(2));
      showToast(`已更新账户「${name}」起始金额`);
    }
  }

  saveState();
  closeModal('accountModal');
  renderAll();
}

function openDeleteAccountModal(accId) {
  const acc = appState.accounts.find(a => a.id === accId);
  if (!acc) return;
  pendingDeleteAccountId = accId;

  const bal = calculateAccountBalance(accId, null);
  const txCount = appState.transactions.filter(t => t.accountId === accId || t.fromAccountId === accId).length;
  const trCount = appState.transfers.filter(t => t.fromAccountId === accId || t.toAccountId === accId).length;
  const balLabel = acc.type === 'liability' ? '当前欠款' : '当前余额';

  document.getElementById('delAccIntro').innerHTML =
    `您正在删除账户 <strong style="color: var(--text-primary);">「${escapeHtml(acc.name)}」</strong>` +
    `（${balLabel} ${formatMoney(bal)}，相关流水 ${txCount} 笔、互转 ${trCount} 笔）。请选择如何处理这些历史记录：`;
  openModal('deleteAccountModal');
}

function confirmDeleteAccount(deleteHistory) {
  const id = pendingDeleteAccountId;
  if (!id) return;

  if (deleteHistory) {
    appState.transactions = appState.transactions.filter(t => t.accountId !== id && t.fromAccountId !== id);
    appState.transfers = appState.transfers.filter(t => t.fromAccountId !== id && t.toAccountId !== id);
  }

  appState.categories.forEach(c => {
    if (c.defaultAccountId === id) c.defaultAccountId = '';
    if (c.fromAccountId === id) c.fromAccountId = null;
  });

  appState.accounts = appState.accounts.filter(a => a.id !== id);
  pendingDeleteAccountId = null;

  saveState();
  closeModal('deleteAccountModal');
  renderAll();
  showToast(deleteHistory ? '已删除账户及相关记录，余额已重算' : '已仅删除账户本身，历史记录已保留');
}

/* 投资账户新增、更新现值与取消标记 */
function fillInvestFields() {
  const id = document.getElementById('invAccSelect').value;
  const acc = appState.accounts.find(a => a.id === id);
  if (!acc) return;
  const cost = calculateAccountBalance(id, null);
  document.getElementById('invCostHint').textContent = `投入本金（累计净投入）：${formatMoney(cost)}`;
  const hasValue = acc.marketValue != null && acc.marketValue !== '';
  document.getElementById('invValueInput').value = hasValue ? Number(acc.marketValue).toFixed(2) : cost.toFixed(2);
}

function openInvestModal(accId = null) {
  if (!accId) {
    document.getElementById('invNewName').value = '';
    document.getElementById('invNewCost').value = '0';
    document.getElementById('invNewValue').value = '';
    document.getElementById('invNewDate').value = formatDateISO(new Date());
    openModal('investNewModal');
    setTimeout(() => document.getElementById('invNewName').focus(), 120);
    return;
  }

  const assets = appState.accounts.filter(a => a.type !== 'liability');
  if (assets.length === 0) {
    showToast('请先添加一个资产类小账户');
    return;
  }
  const sel = document.getElementById('invAccSelect');
  sel.innerHTML = assets.map(a => `<option value="${a.id}">${escapeHtml(a.name)}${a.isInvestment ? '（投资账户）' : ''}</option>`).join('');
  sel.value = accId;
  const picked = assets.find(a => a.id === accId);
  document.getElementById('investModalTitle').textContent = picked && picked.isInvestment ? '更新现值' : '设为投资账户';
  document.getElementById('invDateInput').value = formatDateISO(new Date());
  fillInvestFields();
  openModal('investModal');
}

function saveNewInvest(e) {
  e.preventDefault();
  const name = document.getElementById('invNewName').value.trim();
  const cost = parseFloat(document.getElementById('invNewCost').value) || 0;
  const valueStr = document.getElementById('invNewValue').value;
  const date = document.getElementById('invNewDate').value;
  if (!name) return;
  if (cost < 0) {
    showToast('本金不能为负数');
    return;
  }

  const acc = {
    id: generateId('acc'),
    name,
    type: 'asset',
    initialBalance: Number(cost.toFixed(2)),
    isInvestment: true
  };
  if (valueStr !== '') {
    const value = parseFloat(valueStr);
    if (isNaN(value) || value < 0) {
      showToast('请输入有效的现值');
      return;
    }
    acc.marketValue = Number(value.toFixed(2));
    acc.valueDate = date;
  }

  appState.accounts.push(acc);
  saveState();
  closeModal('investNewModal');
  renderAll();
  showToast(`已创建投资账户「${name}」`);
}

function saveInvestForm(e) {
  e.preventDefault();
  const acc = appState.accounts.find(a => a.id === document.getElementById('invAccSelect').value);
  const value = parseFloat(document.getElementById('invValueInput').value);
  const date = document.getElementById('invDateInput').value;
  if (!acc || isNaN(value) || value < 0) {
    showToast('请输入有效的现值');
    return;
  }
  acc.isInvestment = true;
  acc.marketValue = Number(value.toFixed(2));
  acc.valueDate = date;
  saveState();
  closeModal('investModal');
  renderAll();
  showToast(`已更新「${acc.name}」现值`);
}

function removeInvestFlag(accId) {
  const acc = appState.accounts.find(a => a.id === accId);
  if (!acc) return;
  showConfirmModal(
    '取消投资账户标记',
    `只取消「${acc.name}」的投资标记并清除现值记录，账户和余额都不会被删除。`,
    function () {
      acc.isInvestment = false;
      delete acc.marketValue;
      delete acc.valueDate;
      saveState();
      renderAll();
      showToast('已取消投资账户标记');
    }
  );
}

function openTransferModal(presetFromId = null) {
  if (appState.accounts.length < 2) {
    showToast('请至少创建两个小账户后再进行互转');
    return;
  }
  const fromSel = document.getElementById('transferFromSelect');
  const toSel = document.getElementById('transferToSelect');

  const optionsHtml = appState.accounts.map(a => {
    const bal = calculateAccountBalance(a.id, null);
    const tag = a.type === 'liability' ? '负债' : '资产';
    return `<option value="${a.id}">${escapeHtml(a.name)} (${tag}: ${formatMoney(bal)})</option>`;
  }).join('');

  fromSel.innerHTML = optionsHtml;
  toSel.innerHTML = optionsHtml;

  if (presetFromId) {
    fromSel.value = presetFromId;
  }
  const otherAcc = appState.accounts.find(a => a.id !== fromSel.value);
  if (otherAcc) toSel.value = otherAcc.id;

  document.getElementById('transferAmountInput').value = '';
  document.getElementById('transferDateInput').value = DEFAULT_TODAY;
  document.getElementById('transferNoteInput').value = '';
  openModal('transferModal');
}

function saveTransferForm(e) {
  e.preventDefault();
  const amount = parseFloat(document.getElementById('transferAmountInput').value);
  const fromId = document.getElementById('transferFromSelect').value;
  const toId = document.getElementById('transferToSelect').value;
  const date = document.getElementById('transferDateInput').value;
  const note = document.getElementById('transferNoteInput').value.trim();

  if (!amount || amount <= 0) {
    showToast('请输入有效的转账金额');
    return;
  }
  if (fromId === toId) {
    showToast('转出账户与转入账户不能相同');
    return;
  }

  appState.transfers.push({
    id: generateId('tr'),
    fromAccountId: fromId,
    toAccountId: toId,
    amount: Number(amount.toFixed(2)),
    date,
    note
  });

  saveState();
  closeModal('transferModal');
  renderAll();
  showToast('账户互转成功，总净资产保持平衡');
}

function openTransferHistoryModal() {
  const mKey = getMonthKey(currentYear, currentMonth);
  document.getElementById('thMonthLabel').textContent = `${currentYear}年${currentMonth}月`;
  const listEl = document.getElementById('transferHistoryList');
  const monthTransfers = appState.transfers.filter(t => t.date && t.date.startsWith(mKey));

  if (monthTransfers.length === 0) {
    listEl.innerHTML = `<div class="empty-state">本月暂无账户互转记录</div>`;
  } else {
    listEl.innerHTML = monthTransfers.map(tr => {
      const fromAcc = appState.accounts.find(a => a.id === tr.fromAccountId);
      const toAcc = appState.accounts.find(a => a.id === tr.toAccountId);
      return `
        <div class="tx-row">
          <div>
            <div style="font-size: 14px; font-weight: 700;">
              ${escapeHtml(fromAcc ? fromAcc.name : '已删账户')} → ${escapeHtml(toAcc ? toAcc.name : '已删账户')}
            </div>
            <div class="tx-meta">${tr.date} ${tr.note ? '· ' + escapeHtml(tr.note) : ''}</div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <span class="tabular-nums" style="font-weight: 700;">${formatMoney(tr.amount)}</span>
            <button class="btn btn-sm btn-danger" onclick="deleteTransfer('${tr.id}')">撤销</button>
          </div>
        </div>
      `;
    }).join('');
  }
  openModal('transferHistoryModal');
}

function deleteTransfer(trId) {
  appState.transfers = appState.transfers.filter(t => t.id !== trId);
  saveState();
  openTransferHistoryModal();
  renderAll();
  showToast('已撤销该笔账户互转');
}

/* ==========================================================================
   交互逻辑：创建/编辑/删除记账项目
   ========================================================================== */
function populateAccountSelect(selectId, selectedId = null) {
  const el = document.getElementById(selectId);
  if (appState.accounts.length === 0) {
    el.innerHTML = `<option value="">请先添加小账户</option>`;
    return;
  }
  el.innerHTML = appState.accounts.map(a => {
    const tag = a.type === 'liability' ? '负债' : '资产';
    return `<option value="${a.id}">${escapeHtml(a.name)} (${tag})</option>`;
  }).join('');
  if (selectedId && appState.accounts.some(a => a.id === selectedId)) {
    el.value = selectedId;
  }
}

function selectCategoryKind(kind) {
  document.getElementById('catKindInput').value = kind;
  document.getElementById('catKindExpense').className = kind === 'expense' ? 'radio-pill active-red' : 'radio-pill';
  document.getElementById('catKindIncome').className = kind === 'income' ? 'radio-pill active-green' : 'radio-pill';
  document.getElementById('catKindDeposit').className = kind === 'deposit' ? 'radio-pill active-indigo' : 'radio-pill';
  document.getElementById('catKindRepay').className = kind === 'repay' ? 'radio-pill active-indigo' : 'radio-pill';

  document.getElementById('expenseConfigArea').classList.toggle('hidden', kind !== 'expense');
  document.getElementById('incomeConfigArea').classList.toggle('hidden', kind !== 'income');
  document.getElementById('depositConfigArea').classList.toggle('hidden', kind !== 'deposit');
  document.getElementById('repayConfigArea').classList.toggle('hidden', kind !== 'repay');
}

function selectExpenseSubType(sub) {
  document.getElementById('expSubTypeInput').value = sub;
  document.getElementById('expSubEssential').className = sub === 'essential' ? 'radio-pill active' : 'radio-pill';
  document.getElementById('expSubDiscretionary').className = sub === 'discretionary' ? 'radio-pill active' : 'radio-pill';
}

function selectDepositSourceMode(mode) {
  document.getElementById('depSourceModeInput').value = mode;
  document.getElementById('depSrcExternal').className = mode === 'external' ? 'radio-pill active-indigo' : 'radio-pill';
  document.getElementById('depSrcInternal').className = mode === 'internal' ? 'radio-pill active-indigo' : 'radio-pill';
  document.getElementById('depFromAccountGroup').classList.toggle('hidden', mode !== 'internal');
}

function openCategoryModal(catId = null) {
  if (appState.accounts.length === 0) {
    showToast('请先在上方至少添加一个小账户');
    return;
  }
  populateAccountSelect('expDefaultAccountSelect');
  populateAccountSelect('incDefaultAccountSelect');
  populateAccountSelect('depTargetAccountSelect');
  populateAccountSelect('depFromAccountSelect');
  populateAccountSelect('repayLiabilityAccountSelect');
  populateAccountSelect('repayFromAccountSelect');

  const repayFromEl = document.getElementById('repayFromAccountSelect');
  repayFromEl.insertAdjacentHTML('afterbegin', '<option value="">不指定扣款账户 (仅减少欠债)</option>');
  repayFromEl.value = '';

  if (!catId) {
    document.getElementById('categoryModalTitle').textContent = '新增记账项目';
    document.getElementById('editCategoryId').value = '';
    document.getElementById('catNameInput').value = '';
    document.getElementById('incSourceNoteInput').value = '';
    selectCategoryKind('expense');
    selectExpenseSubType('essential');
    selectDepositSourceMode('external');
    const firstDebt = appState.accounts.find(a => a.type === 'liability');
    if (firstDebt) document.getElementById('repayLiabilityAccountSelect').value = firstDebt.id;
    toggleModalDeleteBtn('#categoryModal form', false);
  } else {
    const cat = appState.categories.find(c => c.id === catId);
    if (!cat) return;
    document.getElementById('categoryModalTitle').textContent = '修改记账项目';
    document.getElementById('editCategoryId').value = cat.id;
    document.getElementById('catNameInput').value = cat.name;
    selectCategoryKind(cat.kind);

    if (cat.kind === 'expense') {
      selectExpenseSubType(cat.subType || 'essential');
      populateAccountSelect('expDefaultAccountSelect', cat.defaultAccountId);
    } else if (cat.kind === 'income') {
      populateAccountSelect('incDefaultAccountSelect', cat.defaultAccountId);
      document.getElementById('incSourceNoteInput').value = cat.sourceNote || '';
    } else if (cat.kind === 'deposit') {
      populateAccountSelect('depTargetAccountSelect', cat.defaultAccountId);
      selectDepositSourceMode(cat.sourceMode || 'external');
      populateAccountSelect('depFromAccountSelect', cat.fromAccountId);
    } else if (cat.kind === 'repay') {
      populateAccountSelect('repayLiabilityAccountSelect', cat.defaultAccountId);
      if (cat.fromAccountId) repayFromEl.value = cat.fromAccountId;
    }
    toggleModalDeleteBtn('#categoryModal form', true, '删除此项目', function () {
      closeModal('categoryModal');
      openDeleteCategoryModal(cat.id);
    });
  }
  openModal('categoryModal');
}

function saveCategoryForm(e) {
  e.preventDefault();
  const editId = document.getElementById('editCategoryId').value;
  const name = document.getElementById('catNameInput').value.trim();
  const kind = document.getElementById('catKindInput').value;

  if (!name) return;

  const payload = { name, kind };
  if (kind === 'expense') {
    payload.subType = document.getElementById('expSubTypeInput').value;
    payload.defaultAccountId = document.getElementById('expDefaultAccountSelect').value;
  } else if (kind === 'income') {
    payload.defaultAccountId = document.getElementById('incDefaultAccountSelect').value;
    payload.sourceNote = document.getElementById('incSourceNoteInput').value.trim();
  } else if (kind === 'deposit') {
    payload.defaultAccountId = document.getElementById('depTargetAccountSelect').value;
    payload.sourceMode = document.getElementById('depSourceModeInput').value;
    payload.fromAccountId = payload.sourceMode === 'internal' ? document.getElementById('depFromAccountSelect').value : null;
    if (payload.sourceMode === 'internal' && payload.defaultAccountId === payload.fromAccountId) {
      showToast('存入目标账户与扣款来源账户不能相同');
      return;
    }
  } else if (kind === 'repay') {
    payload.defaultAccountId = document.getElementById('repayLiabilityAccountSelect').value;
    payload.fromAccountId = document.getElementById('repayFromAccountSelect').value || null;
    if (payload.fromAccountId && payload.defaultAccountId === payload.fromAccountId) {
      showToast('还款负债账户与扣款账户不能相同');
      return;
    }
  }

  if (!editId) {
    appState.categories.push({ id: generateId('cat'), ...payload });
    showToast(`已创建项目「${name}」`);
  } else {
    const idx = appState.categories.findIndex(c => c.id === editId);
    if (idx !== -1) {
      appState.categories[idx] = { ...appState.categories[idx], ...payload };
      appState.transactions.forEach(tx => {
        if (tx.categoryId === editId) {
          tx.categoryNameSnapshot = name;
          if (kind === 'expense') tx.subType = payload.subType;
        }
      });
      showToast(`已更新项目「${name}」`);
    }
  }

  saveState();
  closeModal('categoryModal');
  renderAll();
}

function openDeleteCategoryModal(catId) {
  const cat = appState.categories.find(c => c.id === catId);
  if (!cat) return;
  pendingDeleteCategoryId = catId;
  document.getElementById('delCatTargetName').textContent = `「${cat.name}」`;
  openModal('deleteCategoryModal');
}

function confirmDeleteCategory(deleteHistory) {
  if (!pendingDeleteCategoryId) return;
  const cat = appState.categories.find(c => c.id === pendingDeleteCategoryId);
  const catName = cat ? cat.name : '已删除项目';

  appState.categories = appState.categories.filter(c => c.id !== pendingDeleteCategoryId);
  const cleanedOrder = getSavedCategoryOrder().filter(id => id !== pendingDeleteCategoryId);
  saveCategoryOrder(cleanedOrder);

  if (deleteHistory) {
    appState.transactions = appState.transactions.filter(t => t.categoryId !== pendingDeleteCategoryId);
    showToast('已删除项目及所有历史账单，余额已重算');
  } else {
    appState.transactions.forEach(t => {
      if (t.categoryId === pendingDeleteCategoryId) {
        t.categoryNameSnapshot = catName;
      }
    });
    showToast('已仅删除项目本身，历史数据已保留在报表中');
  }

  pendingDeleteCategoryId = null;
  saveState();
  closeModal('deleteCategoryModal');
  renderAll();
}

/* ==========================================================================
   交互逻辑：日常极速记账 & 明细查改撤销
   ========================================================================== */
function openQuickRecordModal(catId) {
  const cat = appState.categories.find(c => c.id === catId);
  if (!cat) return;

  document.getElementById('qrCategoryId').value = cat.id;
  document.getElementById('qrCategoryTitle').textContent = cat.name;

  const badgeEl = document.getElementById('qrCategoryBadge');
  const primaryLabel = document.getElementById('qrPrimaryAccountLabel');
  const depFromGroup = document.getElementById('qrDepositFromGroup');

  if (cat.kind === 'expense') {
    badgeEl.textContent = cat.subType === 'discretionary' ? '非必要支出' : '维持性支出';
    badgeEl.className = 'tag-pill ' + (cat.subType === 'discretionary' ? 'badge-discretionary' : 'badge-essential');
    primaryLabel.textContent = '扣款小账户 (默认带出，点击可临时切换)';
    depFromGroup.classList.add('hidden');
  } else if (cat.kind === 'income') {
    badgeEl.textContent = '收入入账';
    badgeEl.className = 'tag-pill badge-income';
    primaryLabel.textContent = '入账小账户 (默认带出，点击可临时切换)';
    depFromGroup.classList.add('hidden');
  } else if (cat.kind === 'deposit') {
    badgeEl.textContent = cat.sourceMode === 'internal' ? '存入 (从账户扣款转入)' : '存入 (外部直接存入)';
    badgeEl.className = 'tag-pill badge-deposit';
    primaryLabel.textContent = '存入目标小账户 (点击可临时切换)';
    if (cat.sourceMode === 'internal') {
      depFromGroup.classList.remove('hidden');
      document.getElementById('qrDepositFromLabel').textContent = '扣款来源小账户 (可临时切换)';
      populateAccountSelect('qrDepositFromSelect', cat.fromAccountId);
    } else {
      depFromGroup.classList.add('hidden');
    }
  } else if (cat.kind === 'repay') {
    badgeEl.textContent = '还债 (欠债账户同步减少)';
    badgeEl.className = 'tag-pill badge-deposit';
    primaryLabel.textContent = '偿还目标负债账户 (点击可临时切换)';
    depFromGroup.classList.remove('hidden');
    document.getElementById('qrDepositFromLabel').textContent = '扣款资产账户 (可选)';
    populateAccountSelect('qrDepositFromSelect', cat.fromAccountId);
    const fromSel = document.getElementById('qrDepositFromSelect');
    fromSel.insertAdjacentHTML('afterbegin', '<option value="">不扣减资产账户 (仅减少欠债)</option>');
    fromSel.value = cat.fromAccountId || '';
  }

  populateAccountSelect('qrPrimaryAccountSelect', cat.defaultAccountId);
  document.getElementById('qrAmountInput').value = '';
  document.getElementById('qrDateInput').value = DEFAULT_TODAY;
  document.getElementById('qrNoteInput').value = '';

  openModal('quickRecordModal');
  setTimeout(() => document.getElementById('qrAmountInput').focus(), 120);
}

function saveQuickRecordForm(e) {
  e.preventDefault();
  const catId = document.getElementById('qrCategoryId').value;
  const cat = appState.categories.find(c => c.id === catId);
  if (!cat) return;

  const amount = parseFloat(document.getElementById('qrAmountInput').value);
  const date = document.getElementById('qrDateInput').value;
  const primaryAccountId = document.getElementById('qrPrimaryAccountSelect').value;
  const note = document.getElementById('qrNoteInput').value.trim();

  if (!amount || amount <= 0) {
    showToast('请输入有效金额');
    return;
  }

  let fromAccountId = null;
  if (cat.kind === 'deposit' && cat.sourceMode === 'internal') {
    fromAccountId = document.getElementById('qrDepositFromSelect').value;
    if (fromAccountId === primaryAccountId) {
      showToast('存入目标账户与扣款账户不能相同');
      return;
    }
  } else if (cat.kind === 'repay') {
    fromAccountId = document.getElementById('qrDepositFromSelect').value || null;
    if (fromAccountId && fromAccountId === primaryAccountId) {
      showToast('还款目标与扣款账户不能相同');
      return;
    }
  }

  appState.transactions.push({
    id: generateId('tx'),
    categoryId: cat.id,
    categoryNameSnapshot: cat.name,
    kind: cat.kind,
    subType: cat.subType || null,
    amount: Number(amount.toFixed(2)),
    date,
    accountId: primaryAccountId,
    sourceMode: cat.sourceMode || 'external',
    fromAccountId,
    note
  });

  saveState();
  closeModal('quickRecordModal');
  renderAll();
  showToast(`已记录「${cat.name}」 ${formatMoney(amount)}`);
}

function switchQuickRecordToHistory() {
  const catId = document.getElementById('qrCategoryId').value;
  closeModal('quickRecordModal');
  openTxHistoryModal(catId);
}

function openTxHistoryModal(catId) {
  activeHistoryCategoryId = catId;
  const cat = appState.categories.find(c => c.id === catId);
  const mKey = getMonthKey(currentYear, currentMonth);

  document.getElementById('txHistoryTitle').textContent = `${cat ? cat.name : '项目'} · 本月明细`;
  document.getElementById('txHistorySub').textContent = `${currentYear}年${currentMonth}月`;
  cancelEditSingleTx();

  const txs = appState.transactions
    .filter(t => t.categoryId === catId && t.date && t.date.startsWith(mKey))
    .sort((a, b) => b.date.localeCompare(a.date));

  const listEl = document.getElementById('txHistoryList');
  if (txs.length === 0) {
    listEl.innerHTML = `<div class="empty-state">本月该项目暂无流水记录</div>`;
  } else {
    listEl.innerHTML = txs.map(tx => {
      const acc = appState.accounts.find(a => a.id === tx.accountId);
      let accDesc = acc ? acc.name : '未知账户';
      if ((tx.kind === 'deposit' && tx.sourceMode === 'internal') || (tx.kind === 'repay' && tx.fromAccountId)) {
        const fAcc = appState.accounts.find(a => a.id === tx.fromAccountId);
        accDesc = `${fAcc ? fAcc.name : '未知'} → ${accDesc}`;
      }
      return `
        <div class="tx-row">
          <div>
            <div class="tabular-nums" style="font-size: 15px; font-weight: 700;">${formatMoney(tx.amount)}</div>
            <div class="tx-meta">${tx.date} · ${escapeHtml(accDesc)} ${tx.note ? '· ' + escapeHtml(tx.note) : ''}</div>
          </div>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-sm btn-secondary" onclick="startEditSingleTx('${tx.id}')">修改</button>
          </div>
        </div>
      `;
    }).join('');
  }
  openModal('txHistoryModal');
}

function startEditSingleTx(txId) {
  const tx = appState.transactions.find(t => t.id === txId);
  if (!tx) return;
  document.getElementById('editTxId').value = tx.id;
  document.getElementById('editTxAmount').value = tx.amount;
  document.getElementById('editTxDate').value = tx.date;
  populateAccountSelect('editTxAccount', tx.accountId);
  document.getElementById('editTxNote').value = tx.note || '';
  const editBox = document.getElementById('editSingleTxBox');
  editBox.classList.remove('hidden');
  const actionRow = editBox.querySelector('div:last-child');
  if (actionRow) {
    actionRow.style.justifyContent = 'space-between';
    let delBtn = document.getElementById('editTxInlineDeleteBtn');
    if (!delBtn) {
      delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.id = 'editTxInlineDeleteBtn';
      delBtn.className = 'btn btn-sm btn-danger';
      delBtn.textContent = '删除此笔';
      actionRow.insertBefore(delBtn, actionRow.firstChild);
    }
    delBtn.onclick = function () {
      deleteSingleTx(tx.id);
    };
  }
}

function cancelEditSingleTx() {
  document.getElementById('editSingleTxBox').classList.add('hidden');
  document.getElementById('editTxId').value = '';
}

function saveEditSingleTx() {
  const txId = document.getElementById('editTxId').value;
  const tx = appState.transactions.find(t => t.id === txId);
  if (!tx) return;

  const newAmt = parseFloat(document.getElementById('editTxAmount').value);
  const newDate = document.getElementById('editTxDate').value;
  const newAccId = document.getElementById('editTxAccount').value;
  const newNote = document.getElementById('editTxNote').value.trim();

  if (!newAmt || newAmt <= 0) {
    showToast('金额必须大于 0');
    return;
  }

  tx.amount = Number(newAmt.toFixed(2));
  tx.date = newDate;
  tx.accountId = newAccId;
  tx.note = newNote;

  saveState();
  cancelEditSingleTx();
  openTxHistoryModal(activeHistoryCategoryId);
  renderAll();
  showToast('已修改该笔流水，账户余额已自动同步重算');
}

function deleteSingleTx(txId) {
  appState.transactions = appState.transactions.filter(t => t.id !== txId);
  saveState();
  openTxHistoryModal(activeHistoryCategoryId);
  renderAll();
  showToast('已删除该笔错账，对应小账户余额已退回');
}

/* ==========================================================================
   数据安全：JSON 备份导出、导入恢复与清空重置
   ========================================================================== */
function exportBackupJSON() {
  const dataStr = JSON.stringify(appState, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `智简记账本备份_${DEFAULT_TODAY}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('已导出 JSON 备份文件');
}

function importBackupJSON(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported || !Array.isArray(imported.accounts) || !Array.isArray(imported.categories) || !Array.isArray(imported.transactions)) {
        showToast('备份文件格式无效，请选择正确的 JSON 备份');
        return;
      }
      appState = {
        accounts: imported.accounts,
        categories: imported.categories,
        transactions: imported.transactions,
        transfers: Array.isArray(imported.transfers) ? imported.transfers : []
      };
      saveState();
      renderAll();
      showToast('备份数据导入恢复成功！');
    } catch (err) {
      showToast('解析备份文件失败，请检查文件是否损坏');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function promptClearAllData() {
  showConfirmModal(
    '清空所有数据重置',
    '确定要清空当前所有小账户、记账项目及历史流水吗？清空后所有数据将恢复为零且无法撤销。',
    function () {
      resetToEmptyState();
      renderAll();
      showToast('已清空所有数据，账本已恢复为零');
    }
  );
}

/* ==========================================================================
   通用弹窗控制与辅助工具
   ========================================================================== */
function toggleModalDeleteBtn(formSelector, show, labelText = '', onClickFn = null) {
  const formEl = formSelector.startsWith('#')
    ? document.querySelector(formSelector)
    : document.getElementById(formSelector);
  if (!formEl) return;

  let zone = formEl.querySelector('.hidden-danger-zone');
  if (!zone) {
    zone = document.createElement('div');
    zone.className = 'hidden-danger-zone';
    zone.style.cssText = 'margin-top: 14px; padding-top: 12px; border-top: 1px dashed var(--border-strong); text-align: center;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-sm btn-danger';
    btn.style.width = '100%';
    zone.appendChild(btn);
    formEl.appendChild(zone);
  }

  const btn = zone.querySelector('button');
  if (!show) {
    zone.classList.add('hidden');
    btn.onclick = null;
  } else {
    zone.classList.remove('hidden');
    btn.textContent = labelText;
    btn.onclick = onClickFn;
  }
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

function closeModalOnBackdrop(event, id) {
  if (event.target.id === id) {
    closeModal(id);
  }
}

function showConfirmModal(title, message, onConfirm) {
  document.getElementById('confirmModalTitle').textContent = title;
  document.getElementById('confirmModalBody').textContent = message;
  const okBtn = document.getElementById('confirmModalOkBtn');
  const newBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newBtn, okBtn);
  newBtn.addEventListener('click', function () {
    closeModal('confirmModal');
    if (typeof onConfirm === 'function') onConfirm();
  });
  openModal('confirmModal');
}

function showToast(msg) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = 'toast-msg';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.2s';
    setTimeout(() => el.remove(), 220);
  }, 2400);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

window.onload = initApp;
