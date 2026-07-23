// Скрипт инициализации модуля План Дохода
var currentUser = "";
var db = null;
var carouselOffset = 1;

(function() {

  let savedCarsList = [];
  let directionsData = {};
  let tripsDataLocal = {};
  let currentSortField = "carNumber";
  let isAscending = true;
  let monthsToDisplay = [];
  let userWidgetsDataLocal = {};
  let chatMessagesCache = [];
  let dispatchersList = ["Общая"];
  let currentTab = "Общая";
  let selectedNotebookUser = "Общий";

  // Инициализируем модуль
  window.initializePlanDohodModule = function() {
      currentUser = window.ratipaGlobalAppUser || "Аноним";
      const displayUserName = document.getElementById('display-user-name');
      if (displayUserName) {
        displayUserName.innerText = currentUser;
      }
      
      // Подключаем Firebase Local Instance
      const firebaseConfig = {
          apiKey: "REMOVED_GOOGLE_API_KEY",
          authDomain: "ratipa-panel.firebaseapp.com",
          databaseURL: "https://ratipa-panel-default-rtdb.firebaseio.com",
          projectId: "ratipa-panel"
      };
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.database();

      window.restoreNotebookState();
      window.restoreNotebookDockState();
      startSystemSync();
      setupCloudConnectionStatus();
      generateCarouselMonths();

      // Привязываем события
      document.getElementById('main-car-number')?.addEventListener('keypress', function(e) { if (e.key === 'Enter') window.calculateConstructor(); });
      document.getElementById('notebook-car-input')?.addEventListener('keypress', function(e) { if (e.key === 'Enter') window.addCarToNotebookDirectly(); });
      document.getElementById('new-car-db-input')?.addEventListener('keypress', function(e) { if (e.key === 'Enter') window.addCarToDatabase(); });
      document.getElementById('chat-message-input')?.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); window.sendChatMessage(); }
          if (e.key === 'Escape') { e.preventDefault(); window.cancelEditChatMessage(); }
      });
      
      window.setupGlobalKeyboardControls();
      window.setupFloatingNotebookDrag();
      window.resetConstructorLegs();
  };
  // ... rest of the code ...

window.switchTab = function(tab) {
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active')); 
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('link-' + tab).classList.add('active'); 
    document.getElementById('tab-' + tab).classList.add('active');
};

window.formatNum = function(value, suffix = "") {
    const num = Number(value) || 0;
    return `${Math.round(num).toLocaleString('ru-RU')}${suffix}`;
};

window.escapeHtml = function(value = "") {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

function setupCloudConnectionStatus() {
    db.ref(".info/connected").on("value", (snap) => {
        const textEl = document.getElementById('cloud-status-text');
        if(textEl) textEl.innerText = snap.val() === true ? "В сети" : "Офлайн";
    });
}
window.setupCloudConnectionStatus = setupCloudConnectionStatus;

window.logAction = function(text) {
    if (!currentUser) return;
    db.ref('action_history').push({ user: currentUser, text: text, timestamp: new Date().toLocaleString('ru-RU') });
};

function startSystemSync() {
    db.ref('saved_vehicles_list').on('value', snap => {
        savedCarsList = snap.val() || [];
        window.renderCarsDatalist();
        window.renderCarsTableSettings();
    });
    db.ref('app_directions').on('value', snap => {
        directionsData = snap.val() || {};
        window.renderDirectionsSelectors();
        window.renderDirectionsTableSettings();
    });
    
    db.ref('dispatchers').on('value', snap => {
        const val = snap.val();
        if(val && Array.isArray(val)) {
            dispatchersList = val;
        } else {
            dispatchersList = ["Общая"];
        }
        window.renderTabsHeader();
        window.syncPersonalNotebookWidget();
    });

    db.ref('trips_dashboard').on('value', snap => {
        tripsDataLocal = snap.val() || {};
        window.renderActiveStrips();
        window.renderArchive();
    });

    window.listenToSystemChat();
}
window.startSystemSync = startSystemSync;

window.renderCarsDatalist = function() {
    const dl = document.getElementById('cars-datalist');
    if(dl) dl.innerHTML = savedCarsList.map(c => `<option value="${c}">`).join('');
};

window.renderDirectionsSelectors = function() {
    const mainSel = document.getElementById('main-direction-select');
    const modalSel = document.getElementById('modal-direction-select');
    const optionsHtml = Object.keys(directionsData).map(d => `<option value="${d}">${d}</option>`).join('');
    if (mainSel) { mainSel.innerHTML = optionsHtml; }
    if (modalSel) modalSel.innerHTML = optionsHtml;
};

window.handleDirectionChange = function(context) {
    const tbodyId = context === 'constructor' ? 'constructor-legs-body' : 'modal-legs-body';
    const selectId = context === 'constructor' ? 'main-direction-select' : 'modal-direction-select';
    const dir = document.getElementById(selectId).value;
    const coeff = directionsData[dir] || 1.0;
    
    document.getElementById(tbodyId).querySelectorAll('.leg-coeff').forEach(input => { input.value = coeff; });
    window.triggerRecalc(tbodyId);
};

window.triggerRecalc = function(containerId) {
    if (containerId === 'constructor-legs-body') window.calculateConstructor();
    else window.calculateModal();
};

window.calculateConstructor = function() {
    const res = window.performCalculation('constructor-legs-body', 'main-date-start', 'main-date-end', 'main-extra-expense');
    document.getElementById('res-days').innerText = res.days + ' дн.';
    document.getElementById('res-km').innerText = window.formatNum(res.totalKm, ' км');
    document.getElementById('res-freight').innerText = window.formatNum(res.totalFreight, ' €');
    document.getElementById('res-expenses').innerText = window.formatNum(res.totalExpenses, ' €');
    document.getElementById('res-profit').innerText = window.formatNum(res.profit, ' €');
    
    // Formula Explanation
    const fe = document.getElementById('constructor-formula-explanation');
    if (fe) {
        fe.innerHTML = `<strong>Расчет:</strong> Расходы = Пробег (${res.totalKm} км) × Коэф. Направления + Сумма паромов + Доп.расходы (${res.extraExpense} €)`;
    }
};

window.performCalculation = function(tbodyId, dateStartId, dateEndId, extraExpenseId = null) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return { days: 0, totalKm: 0, totalFreight: 0, totalExpenses: 0, profit: 0, legs: [] };
    const trs = tbody.querySelectorAll('tr');
    
    let totalKm = 0, totalFreight = 0, totalExpenses = 0, arr = [], activeLegIndex = 0;
    trs.forEach((tr, index) => {
        const isChecked = tr.querySelector('.radio-active-leg')?.checked;
        if (isChecked) activeLegIndex = index;
        const km = parseFloat(tr.querySelector('.leg-km').value) || 0;
        const rate = parseFloat(tr.querySelector('.leg-rate').value) || 0;
        const ferry = parseFloat(tr.querySelector('.leg-ferry').value) || 0;
        const coeff = parseFloat(tr.querySelector('.leg-coeff').value) || 1.0;
        totalKm += km; totalFreight += rate; totalExpenses += (km * coeff) + ferry; 
        arr.push({ 
            from: tr.querySelector('.leg-from').value, 
            to: tr.querySelector('.leg-to').value, 
            km, rate, ferry, coeff 
        });
    });
    const extraExpense = extraExpenseId ? (parseFloat(document.getElementById(extraExpenseId)?.value) || 0) : 0;
    totalExpenses += extraExpense;
    let profit = totalFreight - totalExpenses;
    const dStart = document.getElementById(dateStartId).value;
    const dEnd = document.getElementById(dateEndId).value;
    let days = 0;
    if (dStart && dEnd) { days = Math.ceil(Math.abs(new Date(dEnd) - new Date(dStart)) / (1000 * 60 * 60 * 24)) + 1; }
    return { days, totalKm, totalFreight, totalExpenses, extraExpense, profit, legs: arr, activeLegIndex };
};

window.getLegRowHTML = function(containerId, index, isChecked=false, from="", to="", km="", rate="", ferry="", coeff="1.0") {
    const groupName = containerId === 'constructor-legs-body' ? 'constructor-active-leg' : 'modal-active-leg';
    return `
        <tr class="${isChecked ? 'active-leg-row' : ''}">
            <td style="text-align:center;"><input type="radio" name="${groupName}" class="radio-active-leg" value="${index}" ${isChecked ? 'checked' : ''} onchange="window.handleLegActiveHighlight(this, '${containerId}')"></td>
            <td><input type="text" class="input-flat leg-from" value="${window.escapeHtml(from)}" placeholder="Откуда"></td>
            <td><input type="text" class="input-flat leg-to" value="${window.escapeHtml(to)}" placeholder="Куда"></td>
            <td><input type="number" class="input-flat leg-km" value="${km}" placeholder="км" oninput="window.triggerRecalc('${containerId}')"></td>
            <td><input type="number" class="input-flat leg-rate" value="${rate}" placeholder="€" oninput="window.triggerRecalc('${containerId}')"></td>
            <td><input type="text" class="input-flat leg-reference-rate" placeholder="Справка"></td>
            <td><input type="number" class="input-flat leg-ferry" value="${ferry}" placeholder="€" oninput="window.triggerRecalc('${containerId}')"></td>
            <td><input type="number" step="0.1" class="input-flat leg-coeff" value="${coeff}" placeholder="1.0" oninput="window.triggerRecalc('${containerId}')"></td>
            <td>
                <button class="btn-action btn-plus" onclick="window.insertLegRowRow(this, '${containerId}')">+</button>
                <button class="btn-action btn-minus" onclick="window.removeLegRowRow(this, '${containerId}')">✕</button>
            </td>
        </tr>
    `;
};

window.handleLegActiveHighlight = function(radio, containerId) {
    document.getElementById(containerId).querySelectorAll('tr').forEach(tr => tr.classList.remove('active-leg-row'));
    if (radio.checked) radio.closest('tr').classList.add('active-leg-row');
};
window.insertLegRowRow = function(button, containerId) {
    const targetRow = button.closest('tr');
    targetRow.insertAdjacentHTML('afterend', window.getLegRowHTML(containerId, 0, false, "", "", "", "", "", 1.0));
    window.reindexLegRows(containerId);
    window.triggerRecalc(containerId);
};
window.removeLegRowRow = function(button, containerId) {
    if(document.getElementById(containerId).querySelectorAll('tr').length <= 1) return;
    button.closest('tr').remove();
    window.reindexLegRows(containerId);
    window.triggerRecalc(containerId);
};
window.reindexLegRows = function(containerId) {
    document.getElementById(containerId).querySelectorAll('tr').forEach((tr, idx) => {
        const radio = tr.querySelector('.radio-active-leg');
        if(radio) radio.value = idx;
    });
};
window.resetConstructorLegs = function() {
    const currentCoeff = Object.keys(directionsData).length > 0 ? Object.values(directionsData)[0] : 1.0;
    const d = new Date();
    const dateStr = d.toISOString().split('T')[0];
    document.getElementById('main-date-start').value = dateStr;
    document.getElementById('main-date-end').value = dateStr;
    document.getElementById('main-extra-expense').value = "";
    document.getElementById('main-extra-note').value = "";
    document.getElementById('constructor-legs-body').innerHTML = window.getLegRowHTML('constructor-legs-body', 0, true, "Минск", "Варшава", "550", "1200", "", currentCoeff);
    window.calculateConstructor();
};

window.saveTripToFirebase = function() {
    const carNumber = document.getElementById('main-car-number').value.trim().toUpperCase();
    if(!carNumber) return alert("Введите гос. номер машины!");
    if(!savedCarsList.includes(carNumber)) { 
        savedCarsList.push(carNumber); 
        db.ref('saved_vehicles_list').set(savedCarsList); 
    }
    const calc = window.performCalculation('constructor-legs-body', 'main-date-start', 'main-date-end', 'main-extra-expense');
    const direction = document.getElementById('main-direction-select').value;
    const tripData = {
        id: 'id_' + Date.now(),
        carNumber,
        logist: currentUser,
        direction,
        dateStart: document.getElementById('main-date-start').value,
        dateEnd: document.getElementById('main-date-end').value,
        days: calc.days, totalKm: calc.totalKm, totalFreight: calc.totalFreight, totalExpenses: calc.totalExpenses,
        extraExpense: calc.extraExpense, 
        extraNote: document.getElementById('main-extra-note').value || "", 
        profit: calc.profit,
        factKm: 0, profitFact: calc.profit, tripNote: "", stripColor: "#3b82f6",
        legs: calc.legs, activeLegIndex: calc.activeLegIndex || 0,
        dispatcher: currentTab === 'Общая' ? 'Общая' : currentTab,
        currentMonth: monthsToDisplay[1] || "Текущий",
        isArchived: false
    };
    db.ref('trips_dashboard/' + tripData.id).set(tripData).then(() => {
        window.logAction("Внес рейс машины " + carNumber);
        document.getElementById('main-car-number').value = "";
        window.resetConstructorLegs();
    });
};

window.renderActiveStrips = function() {
    const container = document.getElementById('active-strips-container');
    if(!container) return;
    container.innerHTML = "";
    
    let tripsArray = Object.keys(tripsDataLocal).map(key => ({ id: key, ...tripsDataLocal[key] }));
    tripsArray = tripsArray.filter(t => !t.isArchived);
    if (currentTab !== 'Общая') tripsArray = tripsArray.filter(t => t.dispatcher === currentTab);
    
    // Sort logic
    tripsArray.sort((a, b) => {
        let valA = a[currentSortField];
        let valB = b[currentSortField];
        if (valA === undefined) valA = "";
        if (valB === undefined) valB = "";
        
        if (typeof valA === 'string') {
            return isAscending ? valA.localeCompare(valB) : valB.localeCompare(valA);
        } else {
            return isAscending ? valA - valB : valB - valA;
        }
    });

    // Search filter
    const searchVal = document.getElementById('active-car-search')?.value.trim().toUpperCase();
    if (searchVal) {
        tripsArray = tripsArray.filter(t => {
            return t.carNumber.toUpperCase().includes(searchVal) || 
                   t.direction.toUpperCase().includes(searchVal) ||
                   (t.tripNote && t.tripNote.toUpperCase().includes(searchVal));
        });
    }

    let tKm = 0, tFr = 0, tExp = 0, tPr = 0, tDays = 0;

    tripsArray.forEach(trip => {
        tKm += Number(trip.totalKm) || 0;
        tFr += Number(trip.totalFreight) || 0;
        tExp += Number(trip.totalExpenses) || 0;
        tPr += Number(trip.profit) || 0;
        tDays += Number(trip.days) || 0;

        // Check for active notebook notes to render the badge
        const noteText = userWidgetsDataLocal[trip.carNumber] || "";
        const hasNote = noteText.trim().length > 0;
        const badgeHTML = hasNote 
            ? `<span class="notebook-indicator-dot" title="Заметка: ${window.escapeHtml(noteText)}" onclick="window.scrollToCarInNotebook('${trip.carNumber}', event)">📌</span>`
            : "";

        const strip = document.createElement('div');
        strip.className = 'car-strip';
        strip.style.borderLeft = `6px solid ${trip.stripColor || '#3b82f6'}`;
        strip.innerHTML = `
            <div class="flex items-center gap-1.5">
                <div class="strip-number-box">${window.escapeHtml(trip.carNumber)}</div>
                ${badgeHTML}
            </div>
            <div>${window.escapeHtml(trip.direction)}</div>
            <div class="text-slate-600 font-bold">${trip.dateStart} — ${trip.dateEnd}</div>
            <div class="strip-legs-col">
                ${trip.legs ? trip.legs.map((leg, li) => `
                    <div class="strip-leg-item ${li === (trip.activeLegIndex || 0) ? 'strip-leg-current-active' : ''}">
                        ${window.escapeHtml(leg.from)} → ${window.escapeHtml(leg.to)} (${leg.km} км)
                    </div>
                `).join('') : '<div class="text-slate-400 text-xs">Плеч нет</div>'}
            </div>
            <div>${window.formatNum(trip.totalKm, ' км')}</div>
            <div>${window.formatNum(trip.totalFreight, ' €')}</div>
            <div style="color:#ef4444">${window.formatNum(trip.totalExpenses, ' €')}</div>
            <div style="color:var(--text-green); font-weight:800;">${window.formatNum(trip.profit, ' €')}</div>
            <div>${trip.days} дн.</div>
            <div style="color:#b45309; font-weight:700;">${trip.days ? Math.round(trip.profit/trip.days) : 0} €/дн</div>
        `;
        strip.onclick = (e) => {
            if (e.target.classList.contains('notebook-indicator-dot')) return;
            window.openEditModal(trip.id);
        };
        container.appendChild(strip);
    });

    // Summary Card Rendering
    const summaryEl = document.getElementById('active-cars-summary');
    if (summaryEl) {
        summaryEl.innerHTML = `
            <div class="dash-card"><b>Всего машин:</b> <div>${tripsArray.length} ТС</div></div>
            <div class="dash-card"><b>Общий пробег:</b> <div>${window.formatNum(tKm, ' км')}</div></div>
            <div class="dash-card"><b>Общий фрахт:</b> <div>${window.formatNum(tFr, ' €')}</div></div>
            <div class="dash-card" style="border-color:#fca5a5;"><b>Расходы:</b> <div style="color:#ef4444">${window.formatNum(tExp, ' €')}</div></div>
            <div class="dash-card" style="background:var(--bg-green);"><b style="color:var(--text-green)">Прибыль:</b> <div style="color:var(--text-green)">${window.formatNum(tPr, ' €')}</div></div>
            <div class="dash-card"><b>Общих дней:</b> <div>${tDays} дн.</div></div>
        `;
    }
};

window.scrollToCarInNotebook = function(car, event) {
    if (event) event.stopPropagation();
    const el = document.getElementById('split-widget-container');
    if (el && el.classList.contains('hidden-state')) {
        window.toggleWidgetVisibility();
    }
    
    const tbody = document.getElementById('personal-widget-body');
    if (tbody) {
        const badges = tbody.querySelectorAll('.widget-car-badge, .plate-number-value');
        let found = false;
        badges.forEach(b => {
            if (b.innerText.trim().toUpperCase() === car.toUpperCase()) {
                const item = b.closest('.notebook-note-card') || b.closest('tr');
                if (item) {
                    item.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    item.classList.add('highlight-row-pulse');
                    setTimeout(() => item.classList.remove('highlight-row-pulse'), 2000);
                    found = true;
                }
            }
        });
        
        if (!found) {
            const input = document.getElementById('notebook-car-input');
            if (input) {
                input.value = car;
                window.addCarToNotebookDirectly();
            }
        }
    }
};

window.openEditModal = function(id) {
    const t = tripsDataLocal[id];
    if(!t) return;
    document.getElementById('modal-trip-id').value = id;
    document.getElementById('modal-car-number').value = t.carNumber || "";
    document.getElementById('edit-trip-modal').style.display = 'flex';

    document.getElementById('modal-direction-select').value = t.direction || "";
    document.getElementById('modal-date-start').value = t.dateStart || "";
    document.getElementById('modal-date-end').value = t.dateEnd || "";
    document.getElementById('modal-extra-expense').value = t.extraExpense || "";
    document.getElementById('modal-extra-note').value = t.extraNote || "";
    document.getElementById('modal-trip-note').value = t.tripNote || "";
    document.getElementById('modal-fact-km').value = t.factKm || "";

    // Load dispatcher choices options
    const dispSelect = document.getElementById('modal-dispatcher-select');
    if (dispSelect) {
        dispSelect.innerHTML = ["Общая", ...dispatchersList.filter(d => d !== "Общая")].map(d => `<option value="${d}">${d}</option>`).join("");
        dispSelect.value = t.dispatcher || "Общая";
    }

    // Load archive month choices options
    const monthSelect = document.getElementById('modal-archive-month-select');
    if (monthSelect) {
        const tempMonths = [...monthsToDisplay];
        if (!tempMonths.includes(t.currentMonth)) tempMonths.push(t.currentMonth);
        monthSelect.innerHTML = tempMonths.map(m => `<option value="${m}">${m}</option>`).join("");
        monthSelect.value = t.currentMonth || monthsToDisplay[1];
    }

    // Load Legs List
    const tbody = document.getElementById('modal-legs-body');
    if (tbody) {
        if (t.legs && t.legs.length > 0) {
            tbody.innerHTML = t.legs.map((leg, li) => {
                return window.getLegRowHTML('modal-legs-body', li, li === (t.activeLegIndex || 0), leg.from, leg.to, leg.km, leg.rate, leg.ferry, leg.coeff);
            }).join("");
        } else {
            tbody.innerHTML = window.getLegRowHTML('modal-legs-body', 0, true, "", "", "", "", "", "1.0");
        }
    }

    window.selectStripColor(t.stripColor || "#3b82f6");
    window.calculateModal();
};

window.closeModal = function() { 
    document.getElementById('edit-trip-modal').style.display = 'none'; 
};

window.selectStripColor = function(color) {
    document.getElementById('modal-strip-color').value = color;
    document.querySelectorAll('.strip-color-preset').forEach(btn => {
        btn.classList.remove('active');
        if (btn.getAttribute('data-color') === color) {
            btn.classList.add('active');
        }
    });
};

window.calculateModal = function() {
    const res = window.performCalculation('modal-legs-body', 'modal-date-start', 'modal-date-end', 'modal-extra-expense');
    document.getElementById('m-res-days').innerText = res.days + ' дн.';
    document.getElementById('m-res-km').innerText = window.formatNum(res.totalKm, ' км');
    document.getElementById('m-res-freight').innerText = window.formatNum(res.totalFreight, ' €');
    document.getElementById('m-res-expenses').innerText = window.formatNum(res.totalExpenses, ' €');
    document.getElementById('m-res-profit').innerText = window.formatNum(res.profit, ' €');

    const factKmVal = parseFloat(document.getElementById('modal-fact-km').value) || 0;
    if (factKmVal > 0) {
        const averageCoeff = res.legs.length > 0 ? (res.legs.reduce((acc, l) => acc + (parseFloat(l.coeff) || 1), 0) / res.legs.length) : 1.0;
        const totalExpensesFact = (factKmVal * averageCoeff) + res.legs.reduce((acc, l) => acc + (parseFloat(l.ferry) || 0), 0) + res.extraExpense;
        const profitFact = res.totalFreight - totalExpensesFact;
        document.getElementById('m-res-profit-fact').innerHTML = `Факт: <strong style="color:#b45309">${window.formatNum(profitFact, ' €')}</strong>`;
    } else {
        document.getElementById('m-res-profit-fact').innerText = "—";
    }

    const fe = document.getElementById('modal-formula-explanation');
    if (fe) {
        fe.innerHTML = `<strong>Расчет:</strong> Расходы = Пробег (${res.totalKm} км) × Коэф + Паромы + Доп (${res.extraExpense} €)`;
    }
};

window.updateTripInFirebase = function() {
    const id = document.getElementById('modal-trip-id').value;
    if (!id) return;
    const carNumber = document.getElementById('modal-car-number').value.trim().toUpperCase();
    if (!carNumber) return alert("Введите гос. номер!");

    const calc = window.performCalculation('modal-legs-body', 'modal-date-start', 'modal-date-end', 'modal-extra-expense');
    const factKm = parseFloat(document.getElementById('modal-fact-km').value) || 0;
    
    const averageCoeff = calc.legs.length > 0 ? (calc.legs.reduce((acc, l) => acc + (parseFloat(l.coeff) || 1), 0) / calc.legs.length) : 1.0;
    const totalExpensesFact = factKm > 0 ? ((factKm * averageCoeff) + calc.legs.reduce((acc, l) => acc + (parseFloat(l.ferry) || 0), 0) + calc.extraExpense) : calc.totalExpenses;
    const profitFact = factKm > 0 ? (calc.totalFreight - totalExpensesFact) : calc.profit;

    const data = {
        ...tripsDataLocal[id],
        carNumber,
        direction: document.getElementById('modal-direction-select').value,
        dateStart: document.getElementById('modal-date-start').value,
        dateEnd: document.getElementById('modal-date-end').value,
        days: calc.days,
        totalKm: calc.totalKm,
        totalFreight: calc.totalFreight,
        totalExpenses: calc.totalExpenses,
        extraExpense: calc.extraExpense,
        extraNote: document.getElementById('modal-extra-note').value,
        tripNote: document.getElementById('modal-trip-note').value,
        stripColor: document.getElementById('modal-strip-color').value,
        legs: calc.legs,
        activeLegIndex: calc.activeLegIndex || 0,
        dispatcher: document.getElementById('modal-dispatcher-select').value,
        currentMonth: document.getElementById('modal-archive-month-select').value,
        factKm,
        profitFact,
        profit: calc.profit
    };

    db.ref('trips_dashboard/' + id).set(data).then(() => {
        window.logAction("Изменил рейс машины " + carNumber);
        window.closeModal();
    });
};

window.deleteTripFromDB = function() {
    const id = document.getElementById('modal-trip-id').value;
    if (!id) return;
    const car = tripsDataLocal[id]?.carNumber || "";
    if (!confirm(`Удалить рейс машины ${car}?`)) return;

    db.ref('trips_dashboard/' + id).remove().then(() => {
        window.logAction("Удалил рейс машины " + car);
        window.closeModal();
    });
};

window.archiveTripDirectlyFromModal = function() {
    const id = document.getElementById('modal-trip-id').value;
    if (!id) return;
    const car = tripsDataLocal[id]?.carNumber || "";

    db.ref('trips_dashboard/' + id).update({ isArchived: true }).then(() => {
        window.logAction("Архивировал рейс машины " + car);
        window.closeModal();
    });
};

function toggleWidgetVisibility(saveState=true) { 
    const el = document.getElementById('split-widget-container');
    const pill = document.getElementById('notebook-minimized-pill');
    if(!el) return;
    
    if(el.classList.contains('hidden-state')) {
        el.classList.remove('hidden-state');
        if (pill) pill.classList.remove('active');
        if (saveState) localStorage.setItem('ratipa_notebook_open', 'true');
    } else {
        el.classList.add('hidden-state');
        if (pill) pill.classList.add('active');
        if (saveState) localStorage.setItem('ratipa_notebook_open', 'false');
    }
}
window.toggleWidgetVisibility = toggleWidgetVisibility;

window.restoreNotebookState = function() {
    const open = localStorage.getItem('ratipa_notebook_open') !== 'false';
    const el = document.getElementById('split-widget-container');
    const pill = document.getElementById('notebook-minimized-pill');
    if (el) {
        if (open) {
            el.classList.remove('hidden-state');
            if (pill) pill.classList.remove('active');
        } else {
            el.classList.add('hidden-state');
            if (pill) pill.classList.add('active');
        }
    }
};

var isNotebookDocked = false;

window.restoreNotebookDockState = function() {
    isNotebookDocked = localStorage.getItem('ratipa_notebook_docked') === 'true';
    window.applyNotebookDockState();
};

window.toggleNotebookDock = function(saveState=true) {
    isNotebookDocked = !isNotebookDocked;
    if (saveState) localStorage.setItem('ratipa_notebook_docked', String(isNotebookDocked));
    window.applyNotebookDockState();
};

window.applyNotebookDockState = function() {
    const el = document.getElementById('split-widget-container');
    const root = document.getElementById('split-layout-root');
    const dockBtn = document.querySelector('.notebook-dock-btn');
    const handle = document.getElementById('notebook-drag-handle');

    if (!el || !root) return;

    if (isNotebookDocked) {
        el.classList.remove('floating-notebook');
        el.classList.add('docked-notebook');
        root.classList.add('docked-layout');
        if (dockBtn) {
            dockBtn.innerText = '🔓';
            dockBtn.title = 'Открепить (сделать плавающим)';
        }
        if (handle) {
            handle.style.cursor = 'default';
        }
    } else {
        el.classList.remove('docked-notebook');
        el.classList.add('floating-notebook');
        root.classList.remove('docked-layout');
        if (dockBtn) {
            dockBtn.innerText = '📌';
            dockBtn.title = 'Закрепить (прижать к панели)';
        }
        if (handle) {
            handle.style.cursor = 'move';
        }
    }
};

window.syncPersonalNotebookWidget = function() {
    const select = document.getElementById('notebook-user-select');
    if (select) {
        const users = ["Общий", currentUser, ...dispatchersList.filter(d => d !== "Общая" && d !== currentUser)];
        const uniq = [...new Set(users)];
        const lastVal = select.value || selectedNotebookUser;
        select.innerHTML = uniq.map(u => `<option value="${u}">${u === currentUser ? "Мой блокнот ("+u+")" : u}</option>`).join('');
        select.value = lastVal;
    }

    const path = 'personal_notebooks/' + (selectedNotebookUser || "Общий");
    db.ref(path).on('value', snap => {
        userWidgetsDataLocal = snap.val() || {};
        renderNotebookTable();
        window.renderActiveStrips();
    });
};

function renderNotebookTable() {
    const tbody = document.getElementById('personal-widget-body');
    if (!tbody) return;
    tbody.innerHTML = "";
    
    const cars = Object.keys(userWidgetsDataLocal);
    if (cars.length === 0) {
        tbody.innerHTML = `<div style="text-align:center; padding: 40px 20px; color:var(--text-muted); font-size:13px; font-weight:700; font-style:italic;">Блокнот пуст. Внесите номера авто выше.</div>`;
        return;
    }

    cars.forEach(car => {
        const noteText = userWidgetsDataLocal[car] || "";
        const card = document.createElement('div');
        card.className = 'notebook-note-card';
        card.setAttribute('data-car', car);
        card.innerHTML = `
            <div class="note-card-header">
                <div class="car-plate-wrapper" onclick="window.scrollToCarInNotebook('${car}')">
                    <div class="physical-plate">
                        <div class="plate-euro-identifier">
                            <span class="euro-stars">★<br>★</span>
                            <span class="euro-country-code">BY</span>
                        </div>
                        <div class="plate-number-value">${window.escapeHtml(car)}</div>
                    </div>
                </div>
                <button class="note-card-delete-btn" onclick="window.removeCarFromNotebook('${car}')" title="Удалить">✕</button>
            </div>
            <div class="note-card-body">
                <textarea class="note-card-textarea" placeholder="Заметка к авто..." oninput="window.saveNoteText('${car}', this.value)">${window.escapeHtml(noteText)}</textarea>
            </div>
            <div class="note-card-chips">
                <span class="status-preset-chip" onclick="window.addPresetToNote('${car}', '🔧 Ремонт: ')">🔧 Ремонт</span>
                <span class="status-preset-chip" onclick="window.addPresetToNote('${car}', '⏳ Загрузка: ')">⏳ Загрузка</span>
                <span class="status-preset-chip" onclick="window.addPresetToNote('${car}', '🚚 В рейсе: ')">🚚 В пути</span>
                <span class="status-preset-chip" onclick="window.addPresetToNote('${car}', '📂 Док-ты: ')">📂 Доки</span>
            </div>
        `;
        tbody.appendChild(card);
    });
}

let notepadSaveTimeout = null;
window.saveNoteText = function(car, val) {
    userWidgetsDataLocal[car] = val;
    if (notepadSaveTimeout) clearTimeout(notepadSaveTimeout);
    notepadSaveTimeout = setTimeout(() => {
        const path = 'personal_notebooks/' + (selectedNotebookUser || "Общий") + '/' + car;
        db.ref(path).set(val);
    }, 400);
};

window.addPresetToNote = function(car, preset) {
    const card = document.querySelector(`.notebook-note-card[data-car="${car}"]`);
    if (!card) return;
    const textarea = card.querySelector('.note-card-textarea');
    if (!textarea) return;
    
    let text = textarea.value.trim();
    if (text.startsWith(preset.trim()) || text.includes(preset.trim())) {
        return;
    }
    
    textarea.value = preset + textarea.value;
    window.saveNoteText(car, textarea.value);
};

window.switchNotebookUser = function(val) {
    selectedNotebookUser = val;
    window.syncPersonalNotebookWidget();
};

window.addCarToNotebookDirectly = function() {
    const input = document.getElementById('notebook-car-input');
    if (!input) return;
    const car = input.value.trim().toUpperCase();
    if (!car) return;

    db.ref('personal_notebooks/' + (selectedNotebookUser || "Общий") + '/' + car).set("").then(() => {
        input.value = "";
    });
};

window.removeCarFromNotebook = function(car) {
    if (!confirm(`Удалить машину ${car} из блокнота?`)) return;
    db.ref('personal_notebooks/' + (selectedNotebookUser || "Общий") + '/' + car).remove();
};

window.addMyCarsToNotebook = function() {
    const myCars = [];
    Object.values(tripsDataLocal).forEach(trip => {
        if ((trip.logist === currentUser || trip.dispatcher === currentUser) && trip.carNumber) {
            myCars.push(trip.carNumber);
        }
    });
    
    const uniqueCars = [...new Set(myCars)];
    if (uniqueCars.length === 0) {
        alert("У вас пока нет оформленных машин в текущем журнале.");
        return;
    }
    
    const updates = {};
    uniqueCars.forEach(car => {
        if (userWidgetsDataLocal[car] === undefined) {
            updates[car] = "";
        }
    });
    
    if (Object.keys(updates).length === 0) {
        alert("Все ваши машины уже внесены в ваш блокнот.");
        return;
    }
    
    db.ref('personal_notebooks/' + (selectedNotebookUser || "Общий")).update(updates).then(() => {
        alert(`Добавлены машины в блокнот: ${Object.keys(updates).join(', ')}`);
    });
};

// AI Parsing of text from chats
window.processRouteAIInput = function() {
    const inputEl = document.getElementById('route-ai-input');
    const outEl = document.getElementById('route-ai-output');
    if (!inputEl) return;
    const text = inputEl.value;
    if (!text.trim()) {
        if (outEl) outEl.innerText = "Пожалуйста, введите текст для парсинга!";
        return;
    }
    
    // City Regex e.g. "Минск — Стамбул" or "Минск Варшава"
    const cityRegex = /([А-Яа-яA-Za-z]+)\s*[\-—–тоdо]+\s*([А-Яа-яA-Za-z]+)/;
    const cityMatch = text.match(cityRegex);
    let fromCity = cityMatch ? cityMatch[1] : "Минск";
    let toCity = cityMatch ? cityMatch[2] : "Рим";

    // Rate Stavka
    const rateRegex = /(?:ставка|фрахт|цена|цена:)?\s*(\d{3,5})\s*(?:евро|eur|€)?/i;
    const rateMatch = text.match(rateRegex);
    let rate = rateMatch ? parseFloat(rateMatch[1]) : 2000;

    // Distances km
    const kmRegex = /(?:дистанция|расстояние|пробег|км)?\s*(\d{2,5})\s*(?:км|km)/i;
    const kmMatch = text.match(kmRegex);
    let km = kmMatch ? parseFloat(kmMatch[1]) : 1000;

    // Ferry
    const ferryRegex = /(?:паром|ферри)?\s*(\d{2,4})/i;
    const ferryMatch = text.match(ferryRegex);
    let ferry = ferryMatch ? parseFloat(ferryMatch[1]) : 0;

    // Coeff
    const coeffRegex = /(?:коэффициент|коэф|коэфф|k)?\s*(\d\.\d+)/i;
    const coeffMatch = text.match(coeffRegex);
    let coeff = coeffMatch ? parseFloat(coeffMatch[1]) : 1.0;

    // Change legs table of Constructor
    const containerId = 'constructor-legs-body';
    document.getElementById(containerId).innerHTML = window.getLegRowHTML(containerId, 0, true, fromCity, toCity, km, rate, ferry, coeff);
    window.calculateConstructor();

    if (outEl) {
        outEl.innerHTML = `<span style="color:var(--text-green); font-weight:800;">Готово!</span> ${fromCity} → ${toCity}, ${km} км, ставка ${rate} €, паром ${ferry} €, коэф ${coeff}`;
    }
    window.logAction(`Распознан рейс через AI-парсер: ${fromCity} — ${toCity}`);
};

window.copyConstructorTemplate = function() {
    const calc = window.performCalculation('constructor-legs-body', 'main-date-start', 'main-date-end', 'main-extra-expense');
    const template = {
        direction: document.getElementById('main-direction-select').value,
        extraExpense: calc.extraExpense,
        extraNote: document.getElementById('main-extra-note').value,
        legs: calc.legs
    };
    localStorage.setItem('ratipa_constructor_template', JSON.stringify(template));
    alert("Шаблон рейса зафиксирован в памяти (без гос. номера машины).");
};

window.pasteConstructorTemplate = function() {
    const saved = localStorage.getItem('ratipa_constructor_template');
    if (!saved) return alert("Шаблон памяти пуст! Скопируйте сначала рейс.");
    
    try {
        const template = JSON.parse(saved);
        if (template.direction) document.getElementById('main-direction-select').value = template.direction;
        if (template.extraExpense) document.getElementById('main-extra-expense').value = template.extraExpense;
        if (template.extraNote) document.getElementById('main-extra-note').value = template.extraNote;
        
        if (template.legs && template.legs.length > 0) {
            const tbody = document.getElementById('constructor-legs-body');
            tbody.innerHTML = template.legs.map((leg, li) => {
                return window.getLegRowHTML('constructor-legs-body', li, li === 0, leg.from, leg.to, leg.km, leg.rate, leg.ferry, leg.coeff);
            }).join("");
        }
        window.calculateConstructor();
        alert("Параметры шаблона успешно загружены!");
    } catch(e) {
        console.error(e);
    }
};

window.handleHeaderClick = function(field) {
    if (currentSortField === field) {
        isAscending = !isAscending;
    } else {
        currentSortField = field;
        isAscending = true;
    }
    
    document.querySelectorAll('.sortable-header').forEach(sh => {
        sh.classList.remove('active-sort');
        const icon = sh.querySelector('.sort-icon');
        if (icon) icon.innerText = "▼";
    });
    
    const activeHeader = document.getElementById('th-' + field);
    if (activeHeader) {
        activeHeader.classList.add('active-sort');
        const icon = activeHeader.querySelector('.sort-icon');
        if (icon) icon.innerText = isAscending ? "▲" : "▼";
    }
    
    window.renderActiveStrips();
};

window.shiftCarousel = function(val) {
    carouselOffset += val;
    generateCarouselMonths();
    window.renderArchive();
};

function generateCarouselMonths() {
    const list = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
    const d = new Date();
    const curYear = d.getFullYear();
    const curM = d.getMonth();
    
    monthsToDisplay = [];
    for (let i = -1; i <= 1; i++) {
        const offsetM = curM + i + carouselOffset;
        const tempD = new Date(curYear, offsetM, 1);
        monthsToDisplay.push(`${list[tempD.getMonth()]} ${tempD.getFullYear()}`);
    }
    
    const viewLabel = document.getElementById('carousel-current-view-label');
    if (viewLabel) viewLabel.innerText = monthsToDisplay[1];
}

window.renderArchive = function() {
    const container = document.getElementById('archive-columns-container');
    if (!container) return;
    container.innerHTML = "";

    monthsToDisplay.forEach(mLabel => {
        const trips = Object.values(tripsDataLocal).filter(t => t.currentMonth === mLabel);
        let freightSum = 0, profitSum = 0;
        trips.forEach(t => {
            freightSum += Number(t.totalFreight) || 0;
            profitSum += Number(t.profit) || 0;
        });

        const col = document.createElement('div');
        col.className = 'archive-column';
        col.style.minWidth = '330px';
        col.innerHTML = `
            <div style="background:var(--bg-input); padding:16px; border-radius:16px; margin-bottom:12px;">
                <h4 style="font-weight:900; font-size:16px; margin:0;">${mLabel}</h4>
                <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Рейсов: ${trips.length}</div>
                <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:700; margin-top:8px;">
                    <span>Фрахт: <span style="color:var(--text-dark)">${window.formatNum(freightSum, ' €')}</span></span>
                    <span>Прибыль: <span style="color:var(--text-green)">${window.formatNum(profitSum, ' €')}</span></span>
                </div>
            </div>
            <div style="display:flex; flex-direction:column; gap:8px; max-height:430px; overflow-y:auto; padding-right:4px;">
                ${trips.map(t => `
                    <div class="archive-mini-strip" style="background:var(--bg-input); display:flex; justify-content:space-between; align-items:center; padding:10px 14px; border-radius:10px; cursor:pointer;" onclick="window.openEditModal('${t.id}')">
                        <div>
                            <span class="widget-car-badge" style="font-size:10px;">${window.escapeHtml(t.carNumber)}</span>
                            <span style="font-size:11px; color:var(--text-muted); margin-left:6px;">${window.escapeHtml(t.direction)}</span>
                        </div>
                        <span style="font-weight:900; color:var(--text-green); font-size:12px;">${window.formatNum(t.profit, ' €')}</span>
                    </div>
                `).join('')}
                ${trips.length === 0 ? '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:30px 0;">Нет данных</div>' : ''}
            </div>
        `;
        container.appendChild(col);
    });
};

window.renderTabsHeader = function() {
    const container = document.getElementById('journal-tabs');
    if (!container) return;
    
    const tabs = ["Общая", ...dispatchersList.filter(d => d !== "Общая")];
    container.innerHTML = tabs.map(tab => {
        const isActive = currentTab === tab;
        return `<button class="tab-btn ${isActive ? 'active' : ''}" onclick="window.switchTabToDispatcher('${tab}')">${window.escapeHtml(tab)}</button>`;
    }).join("") + `<button class="btn-add-tab" onclick="window.addNewDispatcherTab()">+</button>`;
};

window.switchTabToDispatcher = function(tab) {
    currentTab = tab;
    window.renderTabsHeader();
    window.renderActiveStrips();
};

window.addNewDispatcherTab = function() {
    const name = prompt("Введите имя нового диспетчера:");
    if (!name) return;
    const clean = name.trim();
    if (!clean) return;

    if (!dispatchersList.includes(clean)) {
        dispatchersList.push(clean);
        db.ref('dispatchers').set(dispatchersList).then(() => {
            window.logAction(`Создал вкладку диспетчера ${clean}`);
        });
    }
};

window.renderCarsTableSettings = function() {
    const tbody = document.getElementById('settings-cars-tbody');
    if(!tbody) return;
    tbody.innerHTML = savedCarsList.map(c => `
        <tr>
            <td><strong class="widget-car-badge">${window.escapeHtml(c)}</strong></td>
            <td style="text-align:right;"><button class="btn-action btn-minus" onclick="window.removeCarFromSettings('${c}')">✕</button></td>
        </tr>
    `).join('');
};

window.addCarToDatabase = function() {
    const input = document.getElementById('new-car-db-input');
    if (!input) return;
    const car = input.value.trim().toUpperCase();
    if (!car) return;

    if (!savedCarsList.includes(car)) {
        savedCarsList.push(car);
        db.ref('saved_vehicles_list').set(savedCarsList).then(() => {
            input.value = "";
            window.logAction(`Внес машину ${car} в справочник ТС`);
        });
    }
};

window.removeCarFromSettings = function(car) {
    if(!confirm(`Удалить машину ${car} из справочника базы ТС?`)) return;
    const filtered = savedCarsList.filter(c => c !== car);
    db.ref('saved_vehicles_list').set(filtered).then(() => {
        window.logAction(`Исключил машину ${car} из справочника ТС`);
    });
};

window.renderDirectionsTableSettings = function() {
    const tbody = document.getElementById('settings-directions-tbody');
    if(!tbody) return;
    tbody.innerHTML = Object.keys(directionsData).map(dir => {
        const val = directionsData[dir] || 1.0;
        return `
            <tr>
                <td><strong>${window.escapeHtml(dir)}</strong></td>
                <td>Тариф: <strong>${val} €/км</strong></td>
                <td style="text-align:right;"><button class="btn-action btn-minus" onclick="window.removeDirectionFromSettings('${dir}')">✕</button></td>
            </tr>
        `;
    }).join('');
};

window.addDirectionToDB = function() {
    const key = document.getElementById('new-dir-name').value.trim();
    const val = parseFloat(document.getElementById('new-dir-coeff').value) || 1.0;
    if(!key) return alert("Введите название!");

    directionsData[key] = val;
    db.ref('app_directions').set(directionsData).then(() => {
        document.getElementById('new-dir-name').value = "";
        document.getElementById('new-dir-coeff').value = "";
        window.logAction(`Создал направление ${key} с тарифом ${val}`);
    });
};

window.removeDirectionFromSettings = function(dir) {
    if(!confirm(`Удалить направление ${dir} со справочника?`)) return;
    delete directionsData[dir];
    db.ref('app_directions').set(directionsData).then(() => {
        window.logAction(`Удалил направление ${dir} со справочника`);
    });
};

window.listenToSystemChat = function() {
    db.ref('panelChat').on('value', snap => {
         const val = snap.val() || {};
         chatMessagesCache = Object.keys(val).map(key => ({ id: key, ...val[key] }));
         chatMessagesCache.sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
         renderChatMessages();
    });
};

function renderChatMessages() {
    const container = document.getElementById('chat-messages-container');
    if (!container) return;
    
    const isAtBottom = container.scrollHeight - container.clientHeight <= container.scrollTop + 40;
    
    container.innerHTML = chatMessagesCache.map(msg => {
        const isOwn = msg.owner === currentUser || msg.author === currentUser;
        return `
            <div class="chat-msg-bubble ${isOwn ? 'own-msg' : ''}" style="margin-bottom:6px;">
                <div style="font-size:9px; font-weight:800; color:var(--text-muted); display:flex; justify-content:space-between; gap:10px; margin-bottom:2px;">
                    <span>${window.escapeHtml(msg.author || msg.username || 'Диспетчер')}</span>
                    <span>${msg.time || ''}</span>
                </div>
                <div style="font-weight:600; word-break:break-word; line-height:1.4;">${window.escapeHtml(msg.text)}</div>
            </div>
        `;
    }).join('');

    if (isAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

window.sendChatMessage = function() {
    const input = document.getElementById('chat-message-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    db.ref('panelChat').push({
        author: currentUser,
        owner: currentUser,
        text: text,
        time: new Date().toLocaleTimeString('ru-RU', {hour: '2-digit', minute:'2-digit'}),
        timestamp: Date.now()
    }).then(() => {
        input.value = "";
    });
};

window.cancelEditChatMessage = function() {
    const input = document.getElementById('chat-message-input');
    if(input) input.value = "";
};

window.setupGlobalKeyboardControls = function() {
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.key === 'Enter') {
            if (document.activeElement.id === 'route-ai-input') {
                e.preventDefault();
                window.processRouteAIInput();
            } else if (document.activeElement.closest('.legs-table') || document.activeElement.id === 'main-car-number') {
                e.preventDefault();
                window.saveTripToFirebase();
            }
        }
    });
};

window.setupFloatingNotebookDrag = function() {
    const header = document.getElementById('notebook-drag-handle');
    const panel = document.getElementById('split-widget-container');
    if (!header || !panel) return;

    let dragging = false;
    let sx, sy, ix, iy;

    const pos = localStorage.getItem('ratipa_notebook_position');
    if (pos) {
        try {
            const { x, y, w, h } = JSON.parse(pos);
            panel.style.left = x;
            panel.style.bottom = y;
            panel.style.top = 'auto';
            if (w) panel.style.width = w;
            if (h) panel.style.height = h;
        } catch(e){}
    }

    header.addEventListener('mousedown', function(e) {
        if (e.target.closest('.notebook-window-actions')) return;
        dragging = true;
        sx = e.clientX;
        sy = e.clientY;
        const rect = panel.getBoundingClientRect();
        ix = rect.left;
        iy = window.innerHeight - rect.bottom;
        header.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        const dx = e.clientX - sx;
        const dy = sy - e.clientY;
        panel.style.left = (ix + dx) + 'px';
        panel.style.bottom = (iy + dy) + 'px';
        panel.style.top = 'auto';
    });

    document.addEventListener('mouseup', function() {
        if (dragging) {
            dragging = false;
            header.style.cursor = 'move';
            
            localStorage.setItem('ratipa_notebook_position', JSON.stringify({
                x: panel.style.left,
                y: panel.style.bottom,
                w: panel.style.width,
                h: panel.style.height
            }));
        }
    });
};

// Empty mechanics to maintain support
window.loadChatReadStateForUser = () => {};
window.registerCurrentPlanUser = () => {};
window.openChatFromToast = () => {};
window.toggleSystemChatWindow = function() {
    const el = document.getElementById('system-chat-box-root');
    if(el) {
        el.style.display = el.style.display === 'flex' ? 'none' : 'flex';
    }
};

})();
