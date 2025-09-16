// ==UserScript==
// @name         Team Sonic - Definitive Suite (v22.1 - Notification Fix)
// @namespace    http://tampermonkey.net/
// @version      22.1
// @description  [NOTIFICATION FIX] Final version with a proactive, multi-stage notification system for key operational events.
// @author       Rh. | Team Sonic (Creative AI Build)
// @match        https://eye.delhivery.com/*
// @connect      api.mapbox.com
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_notification
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURATION ---
    const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoicmFodWxwaCIsImEiOiJjbWZpbTVnMnYwbjg3MmxweTRmcG1rdDNtIn0.mIOYkpIEShhheDWZ8BvtHA';
    const HUBLI_COORDS = '75.14236961256525,15.288102693806877';
    const BAYS_AVAILABLE = 3;
    const UNLOAD_RATE_PER_HOUR_PER_BAY = 350;
    const HUB_UNLOAD_RATE_PER_HOUR = BAYS_AVAILABLE * UNLOAD_RATE_PER_HOUR_PER_BAY;
    const MIX_BAG_PROCESS_RATE_PER_HOUR = 3000;
    const SHIFT_BREAK_HOURS = 1;
    const PREP_BUFFER_MINS = 30;
    const SHIFT_EXTENSION_MINS = 60;
    const HIGH_PRIORITY_THRESHOLD = 1000;
    const SHIFTS = {
        A: { name: 'Shift A', start: 7, end: 16, color: '#007bff' },
        B: { name: 'Shift B', start: 13, end: 22, color: '#28a745' },
        C: { name: 'Shift C', start: 22, end: 7, color: '#dc3545' }
    };

    // --- STATE ---
    let activeTimers = { inbound: [], modal: [], insights: [] };
    let insightsHeaderInterval = null;
    let notifiedVehicles = {}; // For tracking notifications

    // --- INITIALIZATION ---
    const initialize = () => {
        setTimeout(() => {
            cleanupUI();
            setupGlobalViewerButton();
            setupShiftInsightsButton();
            if (window.location.href.includes('tab=inbound')) {
                setupInboundDashboard();
            }
        }, 2200);
    };
    window.addEventListener('load', initialize, false);
    window.addEventListener('hashchange', initialize, false);

    function cleanupUI() {
        ['#team-sonic-saver-container', '#team-sonic-viewer-button', '#no-gps-container', '#team-sonic-insights-button']
        .forEach(sel => document.querySelector(sel)?.remove());
    }

    // ===================================================================
    //  UI & BUTTON SETUP
    // ===================================================================
    function setupGlobalViewerButton() {
        if (document.getElementById('team-sonic-viewer-button')) return;
        const btn = document.createElement('button');
        btn.id = 'team-sonic-viewer-button';
        btn.innerHTML = `👁️ View Live Data`;
        btn.onclick = showDataModal;
        document.body.appendChild(btn);
    }

    function setupShiftInsightsButton() {
        if (document.getElementById('team-sonic-insights-button')) return;
        const btn = document.createElement('button');
        btn.id = 'team-sonic-insights-button';
        btn.innerHTML = `🚀 Shift Insights`;
        btn.onclick = showShiftInsightsModal;
        document.body.appendChild(btn);
    }

    // ===================================================================
    //  "VIEWER" MODAL
    // ===================================================================
    async function showDataModal() {
        document.getElementById('saved-data-modal')?.remove();
        activeTimers.modal.forEach(clearInterval);
        activeTimers.modal = [];

        const modal = document.createElement('div');
        modal.id = 'saved-data-modal';
        const lastSync = await GM_getValue('lastSyncTimestamp', null);
        const syncInfo = lastSync ? `<b>${formatTimeAgo(lastSync)}</b> ago` : `No data synced yet.`;
        const storedData = JSON.parse(await GM_getValue('inboundVehicleData', '{}'));
        const vehicleNumbers = Object.keys(storedData);
        let noGpsHtml = '', gpsHtml = '';

        if (vehicleNumbers.length === 0) {
            noGpsHtml = '<tr><td colspan="6" class="no-data-cell">No saved data. Go to "Inbound" tab to sync.</td></tr>';
        } else {
            const noGpsVehicles = vehicleNumbers.filter(n => !storedData[n].hasGps).sort((a, b) => new Date(storedData[a].estimatedArrivalTime) - new Date(storedData[b].estimatedArrivalTime));
            const gpsVehicles = vehicleNumbers.filter(n => storedData[n].hasGps).sort((a, b) => new Date(storedData[a].liveArrivalTime) - new Date(storedData[b].liveArrivalTime));
            noGpsVehicles.forEach(n => { const d = storedData[n]; noGpsHtml += `<tr class="no-gps-row" id="vehicle-row-${n}"><td>${n}</td><td>${d.originFacility||'N/A'}</td><td>${d.totalLoad.toLocaleString()}</td><td>${d.mixedBagPkgCountForAlert.toLocaleString()}</td><td id="countdown-${n}">...</td><td><button class="complete-btn" data-vehicle-num="${n}">Complete</button></td></tr>`; });
            gpsVehicles.forEach(n => { const d = storedData[n]; gpsHtml += `<tr id="vehicle-row-${n}"><td>${n}</td><td>${d.originFacility||'N/A'}</td><td>${d.totalLoad.toLocaleString()}</td><td>${d.mixedBagPkgCountForAlert.toLocaleString()}</td><td id="countdown-${n}">...</td><td><button class="complete-btn" data-vehicle-num="${n}">Complete</button></td></tr>`; });
        }
        modal.innerHTML = `<div class="modal-overlay"></div><div class="modal-content"><div class="modal-header"><h2>Hubli Inbound Vehicles</h2><div class="modal-sync-info">Last synced: ${syncInfo}</div></div><button class="close-btn">&times;</button><div class="modal-body"><h3 class="section-title no-gps-title">No GPS (Est. ETA)</h3><table><thead><tr><th>Vehicle</th><th>Origin</th><th>Load</th><th>Mixed Bags</th><th>Countdown</th><th>Action</th></tr></thead><tbody>${noGpsHtml||'<tr><td colspan=6>None</td></tr>'}</tbody></table><h3 class="section-title">Live GPS</h3><table><thead><tr><th>Vehicle</th><th>Origin</th><th>Load</th><th>Mixed Bags</th><th>Countdown</th><th>Action</th></tr></thead><tbody>${gpsHtml||'<tr><td colspan=6>None</td></tr>'}</tbody></table></div><div class="modal-footer"><p>Designed & Crafted by Rh. | for ⚡ Team Sonic - Hubli (for internal use only)</p></div></div>`;
        document.body.appendChild(modal);
        vehicleNumbers.forEach(n => { const d = storedData[n]; startTickingCountdown(modal.querySelector(`#countdown-${n}`), d, n, activeTimers.modal); });
        modal.querySelector('.close-btn').onclick = () => { activeTimers.modal.forEach(clearInterval); modal.remove(); };
        modal.querySelectorAll('.complete-btn').forEach(btn => btn.onclick = () => markAsComplete(btn.dataset.vehicleNum));
    }

    // ===================================================================
    //  "SHIFT INSIGHTS" MODAL
    // ===================================================================
    async function showShiftInsightsModal() {
        document.getElementById('shift-insights-modal')?.remove();
        if (insightsHeaderInterval) clearInterval(insightsHeaderInterval);
        activeTimers.insights.forEach(clearInterval);
        activeTimers.insights = [];

        const storedData = JSON.parse(await GM_getValue('inboundVehicleData', '{}'));
        const analysis = runShiftAnalysis(storedData);
        const modal = document.createElement('div');
        modal.id = 'shift-insights-modal';
        modal.innerHTML = `<div class="modal-overlay"></div><div class="modal-content"><div id="insights-header" class="modal-header"></div><div class="modal-body">${generateShiftPanels(analysis)}</div><div class="modal-footer"><p>Designed & Crafted by Rh. | for ⚡ Team Sonic - Hubli (for internal use only)</p></div></div><button class="close-btn">&times;</button>`;
        document.body.appendChild(modal);

        insightsHeaderInterval = setInterval(() => updateDynamicHeader(modal.querySelector('#insights-header')), 1000);
        updateDynamicHeader(modal.querySelector('#insights-header'));
        startShiftCountdownTimers(analysis);

        modal.querySelector('.close-btn').onclick = () => {
            clearInterval(insightsHeaderInterval);
            activeTimers.insights.forEach(clearInterval);
            modal.remove();
        };
    }

    // ===================================================================
    //  "SAVER" & INBOUND DASHBOARD LOGIC
    // ===================================================================
    function setupInboundDashboard() {
        const targetTable = document.querySelector('table.table_custom_1');
        if (!targetTable || document.getElementById('team-sonic-saver-container')) return;
        const btnContainer = document.createElement('div');
        btnContainer.id = 'team-sonic-saver-container';
        const saveBtn = document.createElement('button');
        saveBtn.className = 'action-button saver';
        saveBtn.textContent = 'Team Sonic: Enhance Incoming Data';
        saveBtn.onclick = () => runSaveAnalysis(targetTable);
        btnContainer.appendChild(saveBtn);
        targetTable.parentNode.insertBefore(btnContainer, targetTable);
    }
    async function runSaveAnalysis(table) {
        const btn = document.querySelector('#team-sonic-saver-container .saver');
        btn.textContent = 'Enhancing & Saving...'; btn.disabled = true;
        activeTimers.inbound.forEach(clearInterval); activeTimers.inbound = [];
        notifiedVehicles = {}; // Reset notification tracking on new sync

        let storedData = JSON.parse(await GM_getValue('inboundVehicleData', '{}'));
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const vehicles = (await Promise.all(rows.map(fetchAndProcessVehicleData))).filter(v => v !== null);
        vehicles.forEach(v => { storedData[v.vehicleNumber] = { hasGps: v.hasGps, liveArrivalTime: v.hasGps ? v.liveArrivalTime.toISOString() : null, estimatedArrivalTime: !v.hasGps ? v.estimatedArrivalTime.toISOString() : null, originFacility: v.loadData.originFacility, totalLoad: v.loadData.totalLoad, mixedBagPkgCountForAlert: v.loadData.mixedBagPkgCountForAlert, savedAt: new Date().toISOString() }; });
        await GM_setValue('inboundVehicleData', JSON.stringify(storedData));
        await GM_setValue('lastSyncTimestamp', new Date().toISOString());

        triggerPostSyncNotification(storedData); // <-- NOTIFICATION TRIGGER
        renderInboundUI(table, vehicles);

        btn.textContent = 'Data Enhanced & Saved!';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Team Sonic: Enhance Incoming Data'; }, 3000);
    }
    function renderInboundUI(table, allVehicles) {
        const gpsVehicles = allVehicles.filter(v => v.hasGps).sort((a,b) => a.liveArrivalTime - b.liveArrivalTime);
        const noGpsVehicles = allVehicles.filter(v => !v.hasGps).sort((a,b) => a.estimatedArrivalTime - b.estimatedArrivalTime);

        table.querySelector('tbody').innerHTML = '';
        let noGpsContainer = document.getElementById('no-gps-container');
        if (!noGpsContainer) { noGpsContainer = document.createElement('div'); noGpsContainer.id = 'no-gps-container'; table.parentNode.insertBefore(noGpsContainer, table); }
        let noGpsHtml = '';
        noGpsVehicles.forEach(v => noGpsHtml += v.rowElement.outerHTML);
        noGpsContainer.innerHTML = `<h3 class="section-title no-gps-title">Vehicles without GPS</h3><table class="table_custom_1">${table.querySelector('thead').outerHTML}<tbody>${noGpsHtml}</tbody></table>`;
        noGpsVehicles.forEach((v, i) => startTickingCountdown(noGpsContainer.querySelectorAll('tbody tr')[i].cells[3], v.data, v.vehicleNumber, activeTimers.inbound));
        gpsVehicles.forEach(v => { table.querySelector('tbody').appendChild(v.rowElement); startTickingCountdown(v.etaCell, v.data, v.vehicleNumber, activeTimers.inbound); });
    }
    async function fetchAndProcessVehicleData(row) {
        try {
            const cells = row.cells, vehicleNumber = cells[0].querySelector('a')?.textContent.trim();
            if (!vehicleNumber) return null;
            const etaString = cells[3].textContent.trim().split('\n')[0];
            const mixedStr = cells[6].textContent || "";
            const loadData = { originFacility: cells[2].textContent.trim(), totalLoad: (parseInt(cells[5].textContent,10)||0)+(parseInt(cells[7].textContent,10)||0)+(parseInt(mixedStr,10)||0), mixedBagPkgCountForAlert: (mixedStr.match(/\((\d+)\)/)?parseInt(mixedStr.match(/\((\d+)\)/)[1],10):0) };
            const mapLink = cells[8].querySelector('a[href*="google.co.in/maps"]')?.href;
            const vehicleDataObject = { vehicleNumber, loadData }; // Create a base object

            if (!row.closest('table').querySelector('.live-kms-header')) row.closest('table').querySelector('thead tr').insertAdjacentHTML('beforeend', '<th class="live-kms-header">Live KMs</th>');
            if (!row.querySelector('.live-kms-cell')) row.insertAdjacentHTML('beforeend', '<td class="live-kms-cell"></td>');

            if (mapLink) {
                try {
                    const liveData = await getLiveRouteData(mapLink);
                    const color = liveData.distanceKm < 75 ? '#28a745' : liveData.distanceKm < 200 ? '#007bff' : '#343a40';
                    cells[cells.length-1].innerHTML = `<span style="font-weight:bold;color:${color};">${liveData.distanceKm.toFixed(1)} km</span>`;
                    vehicleDataObject.hasGps = true;
                    vehicleDataObject.liveArrivalTime = new Date(Date.now() + liveData.durationSeconds * 1000);
                } catch (apiError) {
                    console.error(`API Failsafe for ${vehicleNumber}:`, apiError.message);
                    row.classList.add('no-gps-row');
                    cells[cells.length - 1].innerHTML = `<span style="color: #dc3545; font-weight: bold;" title="${apiError.message}">API Error</span>`;
                    vehicleDataObject.hasGps = false;
                    vehicleDataObject.estimatedArrivalTime = parseDateTimeString(etaString);
                }
            } else {
                row.classList.add('no-gps-row'); cells[cells.length - 1].textContent = 'No GPS';
                vehicleDataObject.hasGps = false;
                vehicleDataObject.estimatedArrivalTime = parseDateTimeString(etaString);
            }
            return { ...vehicleDataObject, rowElement: row, etaCell: cells[3], data: vehicleDataObject }; // Return the full data object
        } catch (e) { console.error('Row Processing Error:', row, e); return null; }
    }

    // ===================================================================
    //  ANALYTICAL ENGINE & NOTIFICATIONS
    // ===================================================================
    function runShiftAnalysis(vehicleData) {
        const now = new Date(), todayBase = new Date(new Date().setHours(0,0,0,0)), tomorrowBase = new Date(new Date(todayBase).setDate(todayBase.getDate() + 1));
        const todayWorkdayEnd = new Date(new Date(tomorrowBase).setHours(SHIFTS.C.end, 0, 0, 0)), tomorrowWorkdayEnd = new Date(new Date(todayWorkdayEnd).setDate(todayWorkdayEnd.getDate() + 1));
        const analysis = { today: { date:'Today', shifts:{ A:{...SHIFTS.A,v:[]},B:{...SHIFTS.B,v:[]},C:{...SHIFTS.C,v:[]} } }, tomorrow: { date:'Tomorrow', shifts:{ A:{...SHIFTS.A,v:[]},B:{...SHIFTS.B,v:[]},C:{...SHIFTS.C,v:[]} } }, later: { date: 'Later', v: [] }, overall: { totalLoad: 0, totalMixedBags: 0, vehicleCount: 0 } };
        const getShiftBounds = (base) => ({ A: { s:new Date(new Date(base).setHours(SHIFTS.A.start,0)), e:new Date(new Date(base).setHours(SHIFTS.A.end,0)) }, B: { s:new Date(new Date(base).setHours(SHIFTS.B.start,0)), e:new Date(new Date(base).setHours(SHIFTS.B.end,0)) }, C: { s:new Date(new Date(base).setHours(SHIFTS.C.start,0)), e:new Date(new Date(base).setDate(base.getDate()+1)).setHours(SHIFTS.C.end,0) } });
        const todayShifts = getShiftBounds(todayBase), tomorrowShifts = getShiftBounds(tomorrowBase);
        for (const [id, details] of Object.entries(vehicleData)) {
            if (!details) continue;
            const eta = new Date(details.liveArrivalTime || details.estimatedArrivalTime); if(isNaN(eta.getTime())) continue;
            const readyTime = new Date(eta.getTime() + PREP_BUFFER_MINS*60000);
            let dayKey, shiftBounds;
            if (readyTime < todayWorkdayEnd) { dayKey = 'today'; shiftBounds = todayShifts; } else if (readyTime < tomorrowWorkdayEnd) { dayKey = 'tomorrow'; shiftBounds = tomorrowShifts; } else { dayKey = 'later'; }
            let shiftKey = null; if (dayKey !== 'later') { for (const [k, b] of Object.entries(shiftBounds)) { if (readyTime >= b.s && readyTime < b.e) { shiftKey = k; break; } } }
            const unloadCompletionTime = new Date(readyTime.getTime() + (details.totalLoad / UNLOAD_RATE_PER_HOUR_PER_BAY) * 3600000);
            const mixedBagProcessingMinutes = (details.mixedBagPkgCountForAlert / MIX_BAG_PROCESS_RATE_PER_HOUR) * 60;
            const finalCompletionTime = new Date(unloadCompletionTime.getTime() + mixedBagProcessingMinutes * 60000);
            let status = 'onTime', spilloverMinutes = 0;
            if (shiftKey) { const shiftEnd = new Date(shiftBounds[shiftKey].e); const extendedEnd = new Date(shiftEnd.getTime() + SHIFT_EXTENSION_MINS*60000); if (finalCompletionTime > shiftEnd) { status = (finalCompletionTime > extendedEnd) ? 'handover' : 'overtime'; spilloverMinutes = Math.round((finalCompletionTime - shiftEnd) / 60000); } }
            const pVehicle = { ...details, id, eta, readyTime, finalCompletionTime, status, isPastETA: eta < now, spilloverMinutes };
            analysis.overall.totalLoad += details.totalLoad; analysis.overall.totalMixedBags += details.mixedBagPkgCountForAlert; analysis.overall.vehicleCount++;
            if (dayKey === 'later') { analysis.later.v.push(pVehicle); } else if (shiftKey) { analysis[dayKey].shifts[shiftKey].v.push(pVehicle); }
        }
        analysis.today.shifts.A.endDate = todayShifts.A.e; analysis.today.shifts.B.endDate = todayShifts.B.e; analysis.today.shifts.C.endDate = todayShifts.C.e;
        analysis.tomorrow.shifts.A.endDate = tomorrowShifts.A.e; analysis.tomorrow.shifts.B.endDate = tomorrowShifts.B.e; analysis.tomorrow.shifts.C.endDate = tomorrowShifts.C.e;
        return analysis;
    }

    function triggerPostSyncNotification(storedData) {
        const analysis = runShiftAnalysis(storedData);
        const { currentShift } = getShiftStatus();
        if (!currentShift) return;

        // *** FIX: Corrected character index from 7 to 6 ***
        const currentShiftData = analysis.today.shifts[currentShift.name.charAt(6)]; // 'Shift A' -> 'A'
        if (!currentShiftData) return;

        const vehicleCount = currentShiftData.v.length;
        const totalLoad = currentShiftData.v.reduce((a,c) => a + c.totalLoad, 0);
        const totalMixedBags = currentShiftData.v.reduce((a,c) => a + c.mixedBagPkgCountForAlert, 0);

        GM_notification({
            title: '📊 Sync Complete: Current Shift Briefing',
            text: `Current shift (${currentShift.name}) has ${vehicleCount} vehicles expected.\nTotal Load: ${totalLoad.toLocaleString()}\nTotal Mixed Bags: ${totalMixedBags.toLocaleString()}`,
            image: 'https://www.google.com/s2/favicons?domain=delhivery.com',
            highlight: false,
            onclick: () => window.focus()
        });
    }

    // ===================================================================
    //  DYNAMIC HTML & HELPERS
    // ===================================================================
    /* Functions for generating UI elements */
    function generateShiftPanels(analysis) {
        let html = generateSummaryKPIs(analysis.overall);
        ['today', 'tomorrow'].forEach(dayKey => {
            const day = analysis[dayKey];
            html += `<div class="day-forecast"><h2 class="day-header">${day.date}</h2><div class="day-panels-container">`;
            html += Object.values(day.shifts).map(s => {
                const isCompleted = new Date() > s.endDate && dayKey === 'today';
                const completedClass = isCompleted ? 'shift-completed' : '';
                const totalLoad = s.v.reduce((a,c)=>a+c.totalLoad,0);
                const totalMixedBags = s.v.reduce((a,c)=>a+c.mixedBagPkgCountForAlert,0);
                const shiftDurationHours = ((s.end < s.start ? s.end + 24 : s.end) - s.start);
                const shiftWorkHours = shiftDurationHours - SHIFT_BREAK_HOURS;
                const unloadCapacity = shiftWorkHours * HUB_UNLOAD_RATE_PER_HOUR;
                const mixedBagCapacity = shiftWorkHours * MIX_BAG_PROCESS_RATE_PER_HOUR;
                const unloadStress = unloadCapacity > 0 ? totalLoad / unloadCapacity : 0;
                const mixedBagStress = mixedBagCapacity > 0 ? totalMixedBags / mixedBagCapacity : 0;
                return `<div class="shift-panel ${completedClass}" style="border-left-color:${s.color};">
                    <div class="shift-header"><h3><strong>${s.name}</strong></h3><span class="shift-countdown" id="countdown-${dayKey}-${s.name.replace(' ','')}"></span></div>
                    <div class="shift-summary"><div><span>Total Load</span><strong>${totalLoad.toLocaleString()}</strong></div><div><span>Mixed Bags</span><strong>${totalMixedBags.toLocaleString()}</strong></div><div><span>Vehicles</span><strong>${s.v.length}</strong></div></div>
                    <div class="capacity-bar-container" title="Load: ${totalLoad.toLocaleString()} / Capacity: ${unloadCapacity.toLocaleString()}"><div class="capacity-bar" style="width:${Math.min(unloadStress*100,100)}%; background-color:${unloadStress > 0.8 ? '#dc3545' : s.color};"></div><span>${(unloadStress*100).toFixed(0)}% Unload Stress</span></div>
                    <div class="capacity-bar-container" title="Mixed Bags: ${totalMixedBags.toLocaleString()} / Capacity: ${mixedBagCapacity.toLocaleString()}"><div class="capacity-bar" style="width:${Math.min(mixedBagStress*100,100)}%; background-color:${mixedBagStress > 0.8 ? '#fd7e14' : '#6c757d'};"></div><span>${(mixedBagStress*100).toFixed(0)}% Mix Bag Stress</span></div>
                    <div class="vehicle-list">${isCompleted ? '<p class="shift-completed-text">Shift Completed</p>' : (s.v.length > 0 ? s.v.map(generateVehicleCard).join('') : '<p class="no-vehicles">No vehicles projected.</p>')}</div>
                </div>`;
            }).join('');
            html += `</div></div>`;
        });
        return html;
    }
    function generateVehicleCard(v) {
        const eta = v.eta.toLocaleString('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:true});
        const completion = v.finalCompletionTime.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});
        const spillover = v.spilloverMinutes > 0 ? ` (+${Math.floor(v.spilloverMinutes/60)}h ${v.spilloverMinutes%60}m)` : '';
        const s = { onTime:{c:'status-ontime',t:'On-Time'}, overtime:{c:'status-overtime',t:'Overtime'}, handover:{c:'status-handover',t:'Handover'} }[v.status];
        const priorityIcon = v.mixedBagPkgCountForAlert > HIGH_PRIORITY_THRESHOLD ? '<span class="priority-icon" title="High mixed bag count">🔥</span>' : '';
        const arrivedText = v.isPastETA ? `<span class="arrived-badge">Arrived</span> <span class="arrived-ago">(${formatTimeSince(v.eta)})</span>` : '';
        return `<div class="vehicle-card"><div class="vehicle-id">${priorityIcon}${v.id} <span class="origin">from ${v.originFacility||'N/A'}</span></div><div class="vehicle-details"><div><strong>ETA:</strong>${eta} ${arrivedText}</div><div><strong>Load:</strong>${v.totalLoad.toLocaleString()}</div><div><strong>Mixed Bags:</strong>${v.mixedBagPkgCountForAlert.toLocaleString()}</div><div><strong>Est. Clear:</strong>${completion}</div></div><div class="vehicle-status ${s.c}">${s.t}${spillover}</div></div>`;
    }
    function generateSummaryKPIs(overall) {
        return `<div class="kpi-container">
            <div class="kpi-card"><span>Total Incoming Load</span><strong>${overall.totalLoad.toLocaleString()}</strong></div>
            <div class="kpi-card"><span>Total Mixed Bags</span><strong>${overall.totalMixedBags.toLocaleString()}</strong></div>
            <div class="kpi-card"><span>Total Vehicles</span><strong>${overall.vehicleCount}</strong></div>
        </div>`;
    }
    function getShiftStatus() {
        const now = new Date(), h = now.getHours(); let cs = null, st = "Between Shifts";
        if(h>=7&&h<13){cs=SHIFTS.A;st="Shift A in Progress";}else if(h>=13&&h<16){cs=SHIFTS.B;st="⚡ Shift A & B Overlap";}else if(h>=16&&h<22){cs=SHIFTS.B;st="Shift B in Progress";}else if(h>=22||h<7){cs=SHIFTS.C;st="🌙 Night Shift in Progress";}
        let endsIn='N/A'; if(cs){let ed=new Date();if(cs.end<cs.start&&h>=cs.start)ed.setDate(ed.getDate()+1);ed.setHours(cs.end,0,0,0);const df=ed-now,eh=Math.floor(df/36e5),em=Math.floor((df%36e5)/6e4);endsIn=`${eh}h ${em}m`;}
        return {st, endsIn, now, currentShift: cs};
    }
    function updateDynamicHeader(el) {
        const {st, endsIn, now} = getShiftStatus();
        const time = now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:true});
        el.innerHTML = `<h1><strong>📊 Shift Operations Forecast</strong></h1><div class="header-status"><div class="current-time">${time}</div><div class="shift-status">${st}</div><div class="shift-countdown">Ends in: <strong>${endsIn}</strong></div></div>`;
    }
    function startShiftCountdownTimers(analysis) {
        for (const [dayKey, day] of Object.entries(analysis)) {
            if (day.shifts) {
                for (const [shiftKey, shiftDetails] of Object.entries(day.shifts)) {
                    const countdownEl = document.getElementById(`countdown-${dayKey}-${shiftKey}`);
                    if (countdownEl) {
                        const timer = setInterval(() => {
                            const remaining = shiftDetails.endDate - new Date();
                            if (remaining < 0) { countdownEl.textContent = "Ended"; clearInterval(timer); }
                            else { const h=Math.floor(remaining/36e5),m=Math.floor((remaining%36e5)/6e4),s=Math.floor((remaining%6e4)/1000); countdownEl.textContent = `Ends in ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
                        }, 1000);
                        activeTimers.insights.push(timer);
                    }
                }
            }
        }
    }
    function parseDateTimeString(str) { return new Date(`${str.replace(',', ` ${new Date().getFullYear()},`)}`); }
    function formatTimeAgo(iso) { const s = Math.round((new Date() - new Date(iso)) / 1000), m = Math.round(s/60), h = Math.round(m/60); if(s<60)return`${s}s`;if(m<60)return`${m}m`;if(h<24)return`${h}h`;return new Date(iso).toLocaleDateString('en-IN');}
    function formatTimeSince(date) { const diffMs = new Date() - date; const elapsedMinutes = Math.floor(diffMs / 60000); const h = Math.floor(elapsedMinutes / 60); const m = elapsedMinutes % 60; let agoText = ''; if (h > 0) agoText += `${h}h `; agoText += `${m}m ago`; return agoText; }
    async function markAsComplete(vNum) { let d = JSON.parse(await GM_getValue('inboundVehicleData','{}')); if(d[vNum]) delete d[vNum]; await GM_setValue('inboundVehicleData',JSON.stringify(d)); const r = document.getElementById(`vehicle-row-${vNum}`); if (r){r.style.opacity='0';setTimeout(()=>r.remove(),300);}}
    function startTickingCountdown(cell, vehicleData, vehicleId, arr) {
        const arrival = new Date(vehicleData.liveArrivalTime || vehicleData.estimatedArrivalTime);
        if (!cell||!arrival)return;
        const timer=setInterval(()=>{
            const now = new Date();
            const diffMs = now - arrival;
            const remainingSeconds = Math.abs(diffMs) / 1000;

            if (diffMs < 0) { // Still en-route
                const h=Math.floor(remainingSeconds/3600),m=Math.floor((remainingSeconds%3600)/60),sec=Math.floor(remainingSeconds%60);
                cell.innerHTML=`<span class="countdown-timer">${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}</span>`;

                // Proximity notifications
                if (remainingSeconds <= 3660 && remainingSeconds > 3540 && !notifiedVehicles[vehicleId]?.notified60) {
                    if(!notifiedVehicles[vehicleId]) notifiedVehicles[vehicleId] = {};
                    notifiedVehicles[vehicleId].notified60 = true;
                    GM_notification({ title: `⏳ Approaching: ${vehicleId}`, text: `ETA: ~1 hour\nLoad: ${vehicleData.loadData.totalLoad.toLocaleString()}, Mixed Bags: ${vehicleData.loadData.mixedBagPkgCountForAlert.toLocaleString()}`, image: 'https://www.google.com/s2/favicons?domain=delhivery.com', onclick: () => window.focus() });
                }
                if (remainingSeconds <= 1860 && remainingSeconds > 1740 && !notifiedVehicles[vehicleId]?.notified30) {
                    if(!notifiedVehicles[vehicleId]) notifiedVehicles[vehicleId] = {};
                    notifiedVehicles[vehicleId].notified30 = true;
                    GM_notification({ title: `🔥 Arriving Soon: ${vehicleId}`, text: `ETA: ~30 minutes\nLoad: ${vehicleData.loadData.totalLoad.toLocaleString()}, Mixed Bags: ${vehicleData.loadData.mixedBagPkgCountForAlert.toLocaleString()}`, image: 'https://www.google.com/s2/favicons?domain=delhivery.com', highlight: true, onclick: () => window.focus() });
                }

            } else { // Arrived
                cell.innerHTML = `<span class="arrived-text">Arrived<br><span class="arrived-ago">(${formatTimeSince(arrival)})</span></span>`;
                if (!notifiedVehicles[vehicleId]?.notifiedArrived) {
                    if(!notifiedVehicles[vehicleId]) notifiedVehicles[vehicleId] = {};
                    notifiedVehicles[vehicleId].notifiedArrived = true;
                    GM_notification({ title: `✅ Vehicle Arrived: ${vehicleId}`, text: `Ready for unloading.`, image: 'https://www.google.com/s2/favicons?domain=delhivery.com', highlight: true, onclick: () => window.focus() });
                    setTimeout(() => clearInterval(timer), 60000); // Stop timer a minute after arrival
                }
            }
        }, 1000);
        arr.push(timer);
    }
    function getLiveRouteData(link) { return new Promise((resolve, reject) => { if (!MAPBOX_ACCESS_TOKEN) return reject(new Error('Invalid API Key')); const [, , , , , coords] = link.split('/'), [lat, lon] = coords.split(','); const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${lon},${lat};${HUBLI_COORDS}?access_token=${MAPBOX_ACCESS_TOKEN}`; GM_xmlhttpRequest({ method: "GET", url, onload: r => { if (r.status >= 200 && r.status < 300) { const d=JSON.parse(r.responseText); if (d.routes?.length>0) resolve({durationSeconds:d.routes[0].duration, distanceKm:d.routes[0].distance/1000}); else reject(new Error(d.message||'No route')); } else reject(new Error(`API Error: ${r.statusText}`)); }, onerror: err => reject(new Error('Network Error')) }); }); }

    // ===================================================================
    //  STYLES
    // ===================================================================
    GM_addStyle(`
        /* Global Buttons */
        #team-sonic-viewer-button, #team-sonic-insights-button { position: fixed; bottom: 20px; z-index: 9998; background-color: #00796B; color: white; border: none; border-radius: 25px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); display: flex; align-items: center; padding: 8px 16px; font-family: sans-serif; font-weight: bold; font-size: 14px; transition: all 0.3s ease; }
        #team-sonic-viewer-button { left: 50%; transform: translateX(-50%); }
        #team-sonic-viewer-button:hover { background-color: #004D40; transform: translateX(-50%) scale(1.05); }
        #team-sonic-insights-button { left: calc(50% + 150px); transform: translateX(-50%); background-color: #6f42c1; }
        #team-sonic-insights-button:hover { background-color: #5a32a3; transform: translateX(-50%) scale(1.05); }

        /* Inbound Page Specific */
        .action-button.saver { padding: 10px 15px; font-size: 14px; font-weight: bold; color: white; background-color: #007bff; border: none; border-radius: 5px; cursor: pointer; }
        #no-gps-container { margin-bottom: 20px; }
        .no-gps-row { background-color: rgba(220, 53, 69, 0.05) !important; }
        .countdown-timer { font-family: 'monospace'; font-size: 1.2em; font-weight: bold; color: #0056b3; }
        .arrived-text { font-weight: bold; color: #28a745; text-align: center; }
        .arrived-ago { font-size: 0.8em; font-weight: normal; color: #6c757d; }

        /* Generic Modal Styles (Scoped) */
        #saved-data-modal, #shift-insights-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10000; display: flex; align-items: center; justify-content: center; font-family: sans-serif; }
        #saved-data-modal .modal-overlay, #shift-insights-modal .modal-overlay { position: absolute; width: 100%; height: 100%; background: rgba(0,0,0,0.5); }
        #saved-data-modal .modal-content, #shift-insights-modal .modal-content { position: relative; display: flex; flex-direction: column; border-radius: 12px; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(10px); }
        #saved-data-modal .modal-header, #shift-insights-modal .modal-header { padding: 20px 25px; border-bottom: 1px solid rgba(0,0,0,0.1); color: #212529; }
        #saved-data-modal .modal-body, #shift-insights-modal .modal-body { flex-grow: 1; overflow-y: auto; padding: 20px; }
        #saved-data-modal .modal-footer, #shift-insights-modal .modal-footer { padding: 15px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef; }
        #saved-data-modal .close-btn, #shift-insights-modal .close-btn { position: absolute; top: 10px; right: 15px; background: none; border: none; font-size: 32px; cursor: pointer; color: #6c757d; }

        /* Viewer Modal Specifics */
        #saved-data-modal .modal-content { width: 950px; }
        #saved-data-modal .modal-header { display:flex; justify-content: space-between; align-items: baseline; }
        #saved-data-modal .modal-sync-info { font-size: 13px; }
        #saved-data-modal table { width: 100%; border-collapse: collapse; }
        #saved-data-modal th, #saved-data-modal td { padding: 14px; text-align: left; border-bottom: 1px solid #dee2e6; }
        #saved-data-modal .complete-btn { background-color: #c82333; color: white; border: none; border-radius: 5px; padding: 8px 12px; cursor: pointer; }
        #saved-data-modal .section-title { font-size: 18px; margin-bottom: 10px; padding-bottom: 5px; border-bottom: 2px solid #6c757d; }
        #saved-data-modal .section-title.no-gps-title { border-bottom-color: #dc3545; }

        /* Insights Modal Command Center UI */
        #shift-insights-modal .modal-content { width: 1500px; max-width: 95vw; height: 90vh; background: #f8f9fa; }
        #shift-insights-modal .modal-header { background-color: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        #shift-insights-modal .modal-header h1 { font-weight: bold; }
        #shift-insights-modal .header-status { display: flex; justify-content: space-between; align-items: center; font-size: 16px; }
        #shift-insights-modal .current-time { font-family: 'monospace'; background: #e9ecef; padding: 5px 10px; border-radius: 5px; }
        #shift-insights-modal .shift-status { font-weight: bold; font-size: 18px; color: #007bff; background: rgba(0, 123, 255, 0.1); padding: 5px 12px; border-radius: 15px; }
        #shift-insights-modal .kpi-container { display: flex; gap: 20px; padding-bottom: 15px; }
        #shift-insights-modal .kpi-card { background: #fff; border-radius: 8px; padding: 15px; flex-grow: 1; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid #e9ecef; }
        #shift-insights-modal .kpi-card span { display: block; font-size: 14px; color: #6c757d; margin-bottom: 5px; }
        #shift-insights-modal .kpi-card strong { font-size: 24px; color: #212529; }
        #shift-insights-modal .day-forecast { margin-bottom: 20px; }
        #shift-insights-modal .day-header { color: #343a40; font-size: 20px; padding-bottom: 10px; border-bottom: 2px solid #dee2e6; margin-bottom: 15px; font-weight: bold; }
        #shift-insights-modal .day-panels-container { display: flex; gap: 20px; }
        #shift-insights-modal .shift-panel { background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border-radius: 8px; flex: 1; display: flex; flex-direction: column; min-width: 0; border: 1px solid #e9ecef; border-left: 5px solid; transition: all 0.3s ease; }
        #shift-insights-modal .shift-panel.shift-completed { background-color: #e9ecef; opacity: 0.7; }
        #shift-insights-modal .shift-header { padding: 10px 15px; border-bottom: 1px solid #e9ecef; display: flex; justify-content: space-between; align-items: center; }
        #shift-insights-modal .shift-header h3 { margin: 0; font-size: 16px; font-weight: bold; }
        #shift-insights-modal .shift-countdown { font-size: 14px; font-family: monospace; color: #6c757d; }
        #shift-insights-modal .shift-summary { display: flex; justify-content: space-between; padding: 10px 15px; background: #f8f9fa; font-size: 13px; border-bottom: 1px solid #e9ecef; }
        #shift-insights-modal .shift-summary div { text-align: center; }
        #shift-insights-modal .shift-summary span { color: #6c757d; display: block; font-size: 12px; }
        #shift-insights-modal .shift-summary strong { color: #212529; font-weight: bold;}
        #shift-insights-modal .capacity-bar-container { height: 20px; background: #e9ecef; margin: 10px 15px; border-radius: 10px; position: relative; overflow: hidden; }
        #shift-insights-modal .capacity-bar { height: 100%; border-radius: 10px; transition: width 0.5s ease; }
        #shift-insights-modal .capacity-bar-container span { position: absolute; width: 100%; text-align: center; line-height: 20px; font-size: 12px; font-weight: bold; color: #212529; text-shadow: 0 0 2px white; }
        #shift-insights-modal .vehicle-list { padding: 0 15px 15px 15px; overflow-y: auto; flex-grow: 1; }
        #shift-insights-modal .shift-completed-text { font-size: 18px; font-weight: bold; color: #6c757d; text-align: center; padding: 50px 0; }
        #shift-insights-modal .no-vehicles { text-align: center; color: #6c757d; padding-top: 40px; }
        #shift-insights-modal .vehicle-card { background: #fff; border: 1px solid #dee2e6; border-left: 4px solid #6c757d; border-radius: 6px; padding: 10px; margin-bottom: 10px; display: grid; grid-template-columns: 1fr auto; gap: 5px 15px; font-size: 13px; }
        #shift-insights-modal .vehicle-id { font-weight: bold; color: #212529; font-size: 15px; }
        #shift-insights-modal .priority-icon { margin-right: 5px; cursor: pointer; }
        #shift-insights-modal .vehicle-details { grid-row: 2/3; display: flex; flex-direction: column; gap: 5px; padding-top: 5px; }
        #shift-insights-modal .vehicle-status { grid-column: 2/3; grid-row: 1/3; display: flex; align-items: center; padding: 0 15px; border-radius: 5px; font-weight: bold; font-size: 12px; }
        #shift-insights-modal .arrived-badge { background-color: #28a745; color: white; font-size: 10px; padding: 2px 5px; border-radius: 4px; margin-left: 8px; }
        #shift-insights-modal .status-ontime { background-color: rgba(40,167,69,0.1); color:#218838; border:1px solid rgba(40,167,69,0.2); }
        #shift-insights-modal .status-overtime { background-color: rgba(255,193,7,0.1); color:#e0a800; border:1px solid rgba(255,193,7,0.2); }
        #shift-insights-modal .status-handover { background-color: rgba(220,53,69,0.1); color:#c82333; border:1px solid rgba(220,53,69,0.2); }
    `);
})();
