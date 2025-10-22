// ==UserScript==
// @name         Team Sonic - Definitive Suite (v25.4 - Full Code)
// @namespace    http://tampermonkey.net/
// @version      25.4
// @description  [FULL CODE] Complete script with Per-Center Configs, Operational Day Logic, Post-Shift Summaries, and robust ETA Subtext with Early/Late status.
// @author       Rh. | Team Sonic
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

    // --- DEFAULT CONFIGURATION (for new centers) ---
    const MAPBOX_ACCESS_TOKEN = 'pk.eyJ1IjoicmFodWxwaCIsImEiOiJjbWZpbTVnMnYwbjg3MmxweTRmcG1rdDNtIn0.mIOYkpIEShhheDWZ8BvtHA';
    const AUTO_CLEAR_GPS_VEHICLES_AFTER_HOURS = 5;

    const DEFAULT_CENTER_CONFIG = {
        baysAvailable: 3,
        unloadRatePerHourPerBay: 350,
        mixBagProcessRatePerHour: 3000,
        shiftBreakHours: 1,
        prepBufferMins: 30,
        shiftExtensionMins: 60,
        highPriorityThreshold: 1000,
        shifts: {
            A: { name: 'Shift A', start: 7, end: 16, color: '#007bff' },
            B: { name: 'Shift B', start: 13, end: 22, color: '#28a745' },
            C: { name: 'Shift C', start: 22, end: 7, color: '#dc3545' }
        }
    };

    // --- STATE ---
    let activeTimers = { inbound: [], modal: [], insights: [] };
    let insightsHeaderInterval = null;
    let notifiedVehicles = {};
    let userSettings = {
        notifications: {
            enabled: false,
            on60min: true,
            on30min: true,
            onArrival: true,
            onSync: true
        }
    };
    let centers = {};
    let currentCenterId = null;

    // --- INITIALIZATION & SPA HANDLING ---

    const runSetup = () => {
        detectCurrentCenter();
        setupGlobalViewerButton();
        setupShiftInsightsButton();

        const targetTable = document.querySelector('table.table_custom_1');
        if (targetTable && window.location.href.includes('tab=inbound')) {
            setupInboundDashboard(targetTable);
            setupCenterManagementButton(targetTable);
        }
    };

    const debounce = (func, delay) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };

    const debouncedRunSetup = debounce(runSetup, 500);

    const initialize = async () => {
        try {
            // Load and migrate centers data
            const savedCenters = JSON.parse(await GM_getValue('teamSonicCenters', '{}'));
            if (Object.keys(savedCenters).length > 0) {
                // Migration logic: check if a center is missing the new config structure
                const firstCenterKey = Object.keys(savedCenters)[0];
                if (savedCenters[firstCenterKey] && savedCenters[firstCenterKey].config === undefined) {
                    console.log('Team Sonic: Migrating old center data to new format.');
                    for (const id in savedCenters) {
                        savedCenters[id].isGpsEnabled = false; // Default to off during migration
                        savedCenters[id].config = JSON.parse(JSON.stringify(DEFAULT_CENTER_CONFIG)); // Deep copy
                    }
                    await GM_setValue('teamSonicCenters', JSON.stringify(savedCenters));
                    console.log('Team Sonic: Migration complete.');
                }
                centers = savedCenters;
            } else {
                 // Initialize with a default center if none exist
                centers = {
                    'Hubli_Budarshingi_H': {
                        name: 'Hubli Budarshingi H',
                        coords: '75.14236961256525,15.288102693806877',
                        isGpsEnabled: true,
                        config: JSON.parse(JSON.stringify(DEFAULT_CENTER_CONFIG))
                    }
                };
                await GM_setValue('teamSonicCenters', JSON.stringify(centers));
            }

            const savedSettings = JSON.parse(await GM_getValue('teamSonicSettings', '{}'));
            if (savedSettings.notifications) {
                userSettings.notifications = { ...userSettings.notifications, ...savedSettings.notifications };
            }
        } catch (e) {
            console.error('Team Sonic Script: Could not load settings, using defaults.', e);
        }
        setTimeout(runSetup, 2500);
        const observer = new MutationObserver(() => debouncedRunSetup());
        observer.observe(document.body, { childList: true, subtree: true });
    };

    window.addEventListener('load', initialize, false);

    // --- CENTER DETECTION & MANAGEMENT ---

    function detectCurrentCenter() {
        const centerTitleElement = document.querySelector('.page_title.m-l-5.f-w-500');
        currentCenterId = centerTitleElement ? centerTitleElement.textContent.trim() : null;
        return currentCenterId;
    }

    function setupCenterManagementButton(targetTable) {
        let container = document.getElementById('team-sonic-saver-container');
        if (!targetTable || !container || document.getElementById('team-sonic-center-mgmt-button')) return;
        const btn = document.createElement('button');
        btn.id = 'team-sonic-center-mgmt-button';
        btn.innerHTML = '⚙️ Manage Centers';
        btn.className = 'action-button center-mgmt';
        btn.onclick = showCenterManagementModal;
        container.appendChild(btn);
    }

    async function showCenterManagementModal() {
        document.getElementById('center-mgmt-modal')?.remove();
        let centerRowsHtml = Object.entries(centers).map(([id, data]) => `
            <tr data-id="${id}">
                <td>
                    <div class="center-main-details">
                        <label>Display Name</label>
                        <input type="text" class="center-name-input" value="${data.name || ''}" data-field="name">
                        <label>GPS Coordinates (Lon,Lat)</label>
                        <input type="text" class="center-coords-input" value="${data.coords || ''}" placeholder="Longitude,Latitude" data-field="coords">
                        <div class="center-actions">
                             <div class="gps-toggle-container-modal">
                                <label for="gps-enabled-${id}">Use GPS API</label>
                                <label class="switch">
                                    <input type="checkbox" id="gps-enabled-${id}" data-field="isGpsEnabled" ${data.isGpsEnabled ? 'checked' : ''}>
                                    <span class="slider round"></span>
                                </label>
                            </div>
                            <button class="delete-center-btn" data-id="${id}">&times; Delete</button>
                        </div>
                    </div>
                    <div class="center-config-details">
                        <div class="config-grid">
                            <div><label>Bays Available</label><input type="number" value="${data.config.baysAvailable}" data-config="baysAvailable"></div>
                            <div><label>Unload Rate/Bay/Hr</label><input type="number" value="${data.config.unloadRatePerHourPerBay}" data-config="unloadRatePerHourPerBay"></div>
                            <div><label>Mix Bag Rate/Hr</label><input type="number" value="${data.config.mixBagProcessRatePerHour}" data-config="mixBagProcessRatePerHour"></div>
                            <div><label>Break (Hrs)</label><input type="number" step="0.5" value="${data.config.shiftBreakHours}" data-config="shiftBreakHours"></div>
                            <div><label>Prep Buffer (Mins)</label><input type="number" value="${data.config.prepBufferMins}" data-config="prepBufferMins"></div>
                            <div><label>Extension (Mins)</label><input type="number" value="${data.config.shiftExtensionMins}" data-config="shiftExtensionMins"></div>
                            <div><label>High Priority Bags</label><input type="number" value="${data.config.highPriorityThreshold}" data-config="highPriorityThreshold"></div>
                        </div>
                        <h4>Shift Timings (24h format)</h4>
                        <div class="shift-grid">
                           ${Object.entries(data.config.shifts).map(([key, shift]) => `
                             <div class="shift-time-inputs">
                                <strong>${shift.name}</strong>
                                <input type="number" min="0" max="23" value="${shift.start}" data-shift="${key}" data-shifttime="start" placeholder="Start">
                                <span>-</span>
                                <input type="number" min="0" max="23" value="${shift.end}" data-shift="${key}" data-shifttime="end" placeholder="End">
                             </div>
                           `).join('')}
                        </div>
                    </div>
                </td>
            </tr>
        `).join('');

        const modal = document.createElement('div');
        modal.id = 'center-mgmt-modal';
        modal.innerHTML = `
            <div class="modal-overlay"></div>
            <div class="modal-content" style="width: 900px;">
                <div class="modal-header"><h2>Manage Center Operations</h2></div>
                <button class="close-btn">&times;</button>
                <div class="modal-body">
                    <p>Add or edit centers and their unique operational parameters.</p>
                    <table id="center-mgmt-table"><tbody>${centerRowsHtml}</tbody></table>
                    <hr style="margin: 20px 0;">
                    <h3>Add New Center</h3>
                    <div id="add-center-form">
                        <input type="text" id="new-center-id" placeholder="Center ID (e.g., Hubli_Budarshingi_H)" value="${currentCenterId || ''}">
                        <input type="text" id="new-center-name" placeholder="Display Name (e.g., Hubli Hub)">
                        <input type="text" id="new-center-coords" placeholder="Coordinates (Lon,Lat)">
                        <button id="add-center-btn">Add Center</button>
                    </div>
                </div>
                <div class="modal-footer"><button id="save-centers-btn">Save All Changes</button></div>
            </div>`;
        document.body.appendChild(modal);

        modal.querySelector('.close-btn').onclick = () => modal.remove();
        modal.querySelector('#save-centers-btn').onclick = saveCenterChanges;
        modal.querySelector('#add-center-btn').onclick = addNewCenter;
        modal.querySelectorAll('.delete-center-btn').forEach(btn => {
            btn.onclick = (e) => e.target.closest('tr').remove();
        });
    }

    async function saveCenterChanges() {
        const newCenters = {};
        let hasError = false;
        document.querySelectorAll('#center-mgmt-table tbody tr').forEach(row => {
            if (hasError) return;
            const id = row.dataset.id;
            const name = row.querySelector('.center-name-input').value.trim();
            const coords = row.querySelector('.center-coords-input').value.trim();
            const isGpsEnabled = row.querySelector('input[data-field="isGpsEnabled"]').checked;

            if (!id || !name) {
                alert(`Error: A center is missing its ID or Name.`);
                hasError = true;
                return;
            }

            const config = { ...DEFAULT_CENTER_CONFIG, shifts: JSON.parse(JSON.stringify(DEFAULT_CENTER_CONFIG.shifts)) };
            row.querySelectorAll('input[data-config]').forEach(input => {
                config[input.dataset.config] = parseFloat(input.value) || 0;
            });
            row.querySelectorAll('input[data-shift]').forEach(input => {
                const shift = input.dataset.shift;
                const type = input.dataset.shifttime;
                config.shifts[shift][type] = parseInt(input.value, 10);
            });

            newCenters[id] = { name, coords, isGpsEnabled, config };
        });

        if (hasError) return;

        centers = newCenters;
        await GM_setValue('teamSonicCenters', JSON.stringify(centers));
        alert('Center information saved!');
        document.getElementById('center-mgmt-modal')?.remove();
    }

    function addNewCenter() {
        const id = document.getElementById('new-center-id').value.trim();
        const name = document.getElementById('new-center-name').value.trim();
        const coords = document.getElementById('new-center-coords').value.trim();
        if (!id || !name) { alert('Please fill at least the Center ID and Display Name.'); return; }
        if (centers[id]) { alert('A center with this ID already exists.'); return; }

        const newCenterData = {
            name,
            coords,
            isGpsEnabled: !!coords,
            config: JSON.parse(JSON.stringify(DEFAULT_CENTER_CONFIG))
        };
        centers[id] = newCenterData;
        showCenterManagementModal();
        alert(`Center "${name}" added with default settings. You can now customize it.`);
    }

    // --- UI & BUTTON SETUP ---

    function setupGlobalViewerButton() {
        if (document.getElementById('team-sonic-viewer-button')) return;
        const btn = document.createElement('button');
        btn.id = 'team-sonic-viewer-button';
        btn.innerHTML = `👁️ View Live Data`;
        btn.onclick = () => showDataModal(currentCenterId);
        document.body.appendChild(btn);
    }

    function setupShiftInsightsButton() {
        if (document.getElementById('team-sonic-insights-button')) return;
        const btn = document.createElement('button');
        btn.id = 'team-sonic-insights-button';
        btn.innerHTML = `🚀 Shift Insights`;
        btn.onclick = () => showShiftInsightsModal(currentCenterId);
        document.body.appendChild(btn);
    }

    function setupInboundDashboard(targetTable) {
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

    // --- DATA MODAL & LOGIC ---
    async function showDataModal(initialCenterId) {
        document.getElementById('saved-data-modal')?.remove();
        activeTimers.modal.forEach(clearInterval);
        activeTimers.modal = [];

        let viewingCenterId = initialCenterId || Object.keys(centers)[0];

        const modal = document.createElement('div');
        modal.id = 'saved-data-modal';

        const renderModalContent = async (centerId) => {
            viewingCenterId = centerId;
            const centerName = centers[centerId]?.name || centerId;
            const centerOptions = Object.keys(centers).map(id => `<option value="${id}" ${id === centerId ? 'selected' : ''}>${centers[id].name}</option>`).join('');
            const lastSync = await GM_getValue(`lastSyncTimestamp_${centerId}`, null);
            const syncInfo = lastSync ? `<b>${formatTimeAgo(lastSync)}</b> ago` : `No data synced yet.`;
            const storedData = await getCleanedVehicleData(centerId);
            const allVehicles = Object.entries(storedData).map(([number, data]) => ({ number, ...data }));
            allVehicles.sort((a, b) => new Date(a.liveArrivalTime || a.estimatedArrivalTime) - new Date(b.liveArrivalTime || b.estimatedArrivalTime));

            let tableHtml = allVehicles.length === 0
                ? `<tr><td colspan="6" class="no-data-cell">No vehicle data for ${centerName}. Go to the "Inbound" tab to sync.</td></tr>`
                : allVehicles.map(d => `<tr class="${d.hasGps ? 'gps-row' : 'no-gps-row'}" id="vehicle-row-${d.number}"><td>${d.number}</td><td>${d.originFacility||'N/A'}</td><td>${d.totalLoad.toLocaleString()}</td><td>${d.mixedBagPkgCountForAlert.toLocaleString()}</td><td id="countdown-${d.number}">...</td><td><button class="complete-btn" data-vehicle-num="${d.number}">Complete</button></td></tr>`).join('');

            modal.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-content">
                    <div class="modal-header">
                        <div class="header-main-title">
                            <h2>${centerName} Inbound</h2>
                            <select id="center-view-selector" class="center-selector">${centerOptions}</select>
                        </div>
                        <div class="header-controls">
                            <div class="modal-sync-info">Last synced: ${syncInfo}</div>
                            <button class="settings-btn" title="Settings">⚙️</button>
                        </div>
                    </div>
                    <div id="settings-panel" class="settings-panel hidden">
                         <h3>Notification Settings</h3>
                         <div class="setting-item"><label for="notifications-enabled">Enable Notifications</label><label class="switch"><input type="checkbox" id="notifications-enabled" ${userSettings.notifications.enabled ? 'checked' : ''}><span class="slider round"></span></label></div>
                         <fieldset id="notification-types" ${!userSettings.notifications.enabled ? 'disabled' : ''}>
                             <div class="setting-item"><label>60-Min Approach</label><label class="switch"><input type="checkbox" name="on60min" ${userSettings.notifications.on60min ? 'checked' : ''}><span class="slider round"></span></label></div>
                             <div class="setting-item"><label>30-Min Arrival</label><label class="switch"><input type="checkbox" name="on30min" ${userSettings.notifications.on30min ? 'checked' : ''}><span class="slider round"></span></label></div>
                             <div class="setting-item"><label>Vehicle Arrived</label><label class="switch"><input type="checkbox" name="onArrival" ${userSettings.notifications.onArrival ? 'checked' : ''}><span class="slider round"></span></label></div>
                             <div class="setting-item"><label>Post-Sync Briefing</label><label class="switch"><input type="checkbox" name="onSync" ${userSettings.notifications.onSync ? 'checked' : ''}><span class="slider round"></span></label></div>
                         </fieldset>
                    </div>
                    <button class="close-btn">&times;</button>
                    <div class="modal-body">
                        <h3>All Incoming Vehicles (Sorted by ETA/STA)</h3>
                        <table>
                            <thead><tr><th>Vehicle</th><th>Origin</th><th>Load</th><th>Mixed Bags</th><th>Arrival Countdown</th><th>Action</th></tr></thead>
                            <tbody>${tableHtml}</tbody>
                        </table>
                    </div>
                    <div class="modal-footer"><p>Designed & Crafted by Rh. | for ⚡ Team Sonic</p></div>
                </div>`;

            if (!document.body.contains(modal)) document.body.appendChild(modal);

            allVehicles.forEach(d => startTickingCountdown(modal.querySelector(`#countdown-${d.number}`), d, d.number, activeTimers.modal));

            modal.querySelector('.close-btn').onclick = () => { modal.remove(); activeTimers.modal.forEach(clearInterval); };
            modal.querySelectorAll('.complete-btn').forEach(btn => btn.onclick = () => markAsComplete(btn.dataset.vehicleNum, viewingCenterId));
            modal.querySelector('.settings-btn').onclick = () => modal.querySelector('#settings-panel').classList.toggle('hidden');
            modal.querySelector('#center-view-selector').onchange = (e) => renderModalContent(e.target.value);
            const masterToggle = modal.querySelector('#notifications-enabled');
            const typesFieldset = modal.querySelector('#notification-types');
            masterToggle.onchange = e => { userSettings.notifications.enabled = e.target.checked; typesFieldset.disabled = !e.target.checked; saveSettings(); };
            typesFieldset.querySelectorAll('input[type="checkbox"]').forEach(toggle => { toggle.onchange = e => { userSettings.notifications[e.target.name] = e.target.checked; saveSettings(); }; });
        };
        const saveSettings = async () => { await GM_setValue('teamSonicSettings', JSON.stringify(userSettings)); };
        await renderModalContent(viewingCenterId);
    }

    // --- SAVE ANALYSIS & INBOUND DASHBOARD ---
    async function runSaveAnalysis(table) {
        if (!currentCenterId) {
            alert('Could not detect the current center. Cannot save data.');
            return;
        }

        if (!centers[currentCenterId]) {
            const newCenterData = {
                name: currentCenterId.replace(/_/g, ' '),
                coords: '',
                isGpsEnabled: false,
                config: JSON.parse(JSON.stringify(DEFAULT_CENTER_CONFIG))
            };
            centers[currentCenterId] = newCenterData;
            await GM_setValue('teamSonicCenters', JSON.stringify(centers));
            alert(`New center "${currentCenterId}" auto-added. You can add its GPS coordinates and configure it in 'Manage Centers'.`);
        }

        const btn = document.querySelector('#team-sonic-saver-container .saver');
        btn.textContent = 'Enhancing & Saving...';
        btn.disabled = true;

        activeTimers.inbound.forEach(clearInterval);
        activeTimers.inbound = [];
        notifiedVehicles = {};

        let storedData = JSON.parse(await GM_getValue(`inboundVehicleData_${currentCenterId}`, '{}'));
        const rows = Array.from(table.querySelectorAll('tbody tr'));
        const vehicles = (await Promise.all(rows.map(fetchAndProcessVehicleData))).filter(v => v !== null);

        vehicles.forEach(v => {
            storedData[v.vehicleNumber] = {
                hasGps: v.hasGps,
                liveArrivalTime: v.hasGps ? v.liveArrivalTime.toISOString() : null,
                estimatedArrivalTime: v.estimatedArrivalTime.toISOString(),
                originFacility: v.loadData.originFacility,
                totalLoad: v.loadData.totalLoad,
                mixedBagPkgCountForAlert: v.loadData.mixedBagPkgCountForAlert,
                savedAt: new Date().toISOString()
            };
        });

        await GM_setValue(`inboundVehicleData_${currentCenterId}`, JSON.stringify(storedData));
        await GM_setValue(`lastSyncTimestamp_${currentCenterId}`, new Date().toISOString());

        triggerPostSyncNotification(storedData, currentCenterId);
        renderInboundUI(table, vehicles);

        btn.textContent = 'Data Enhanced & Saved!';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Team Sonic: Enhance Incoming Data'; }, 3000);
    }

    function renderInboundUI(table, allVehicles) {
        allVehicles.sort((a, b) => new Date(a.liveArrivalTime || a.estimatedArrivalTime) - new Date(b.liveArrivalTime || b.estimatedArrivalTime));
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = '';
        allVehicles.forEach(v => {
            tbody.appendChild(v.rowElement);
            startTickingCountdown(v.etaCell, { ...v.data, ...v.loadData }, v.vehicleNumber, activeTimers.inbound);
        });
    }

    async function fetchAndProcessVehicleData(row) {
        try {
            const cells = row.cells;
            if (!cells || cells.length < 9) return null;

            const vehicleNumber = cells[0]?.querySelector('a')?.textContent.trim();
            if (!vehicleNumber) return null;

            let etaString;
            if (row.dataset.originalEta) {
                etaString = row.dataset.originalEta;
            } else {
                etaString = cells[3]?.textContent?.trim().split('\n')[0];
                if (etaString) row.dataset.originalEta = etaString;
            }

            if (!etaString) return null;

            const mixedStr = cells[6]?.textContent || "";
            const loadData = {
                originFacility: cells[2]?.textContent?.trim() || 'N/A',
                totalLoad: (parseInt(cells[5]?.textContent, 10) || 0) + (parseInt(cells[7]?.textContent, 10) || 0) + (parseInt(mixedStr, 10) || 0),
                mixedBagPkgCountForAlert: (mixedStr.match(/\((\d+)\)/) ? parseInt(mixedStr.match(/\((\d+)\)/)[1], 10) : 0)
            };
            const mapLink = cells[8]?.querySelector('a[href*="google.co.in/maps"]')?.href;
            const vehicleDataObject = { vehicleNumber, loadData, estimatedArrivalTime: parseDateTimeString(etaString) };

            if (!row.closest('table').querySelector('.live-kms-header')) {
                row.closest('table').querySelector('thead tr').insertAdjacentHTML('beforeend', '<th class="live-kms-header">Live KMs</th>');
            }
            let liveKmsCell = row.querySelector('.live-kms-cell');
            if (!liveKmsCell) {
                row.insertAdjacentHTML('beforeend', '<td class="live-kms-cell"></td>');
                liveKmsCell = row.querySelector('.live-kms-cell');
            }

            const currentCenter = centers[currentCenterId];
            const useGps = currentCenter?.isGpsEnabled && mapLink && currentCenter?.coords;

            if (useGps) {
                try {
                    const liveData = await getLiveRouteData(mapLink, currentCenter.coords);
                    const color = liveData.distanceKm < 75 ? '#28a745' : liveData.distanceKm < 200 ? '#007bff' : '#343a40';
                    liveKmsCell.innerHTML = `<span style="font-weight:bold;color:${color};">${liveData.distanceKm.toFixed(1)} km</span>`;
                    vehicleDataObject.hasGps = true;
                    vehicleDataObject.liveArrivalTime = new Date(Date.now() + liveData.durationSeconds * 1000);
                } catch (apiError) {
                    console.error(`API Failsafe for ${vehicleNumber}:`, apiError.message);
                    liveKmsCell.innerHTML = `<span style="color: #dc3545; font-weight: bold;" title="${apiError.message}">API Error</span>`;
                    vehicleDataObject.hasGps = false;
                }
            } else {
                let reason = 'GPS Disabled';
                if (currentCenter?.isGpsEnabled) {
                    if (!mapLink) reason = 'No GPS Link';
                    else if (!currentCenter?.coords) reason = 'Center GPS Missing';
                }
                liveKmsCell.textContent = reason;
                vehicleDataObject.hasGps = false;
            }

            row.classList.toggle('no-gps-row', !vehicleDataObject.hasGps);
            row.classList.toggle('gps-row', vehicleDataObject.hasGps);

            return { ...vehicleDataObject, rowElement: row, etaCell: cells[3], data: vehicleDataObject };
        } catch (e) {
            console.error('Row Processing Error:', row, e);
            return null;
        }
    }


    // --- SHIFT INSIGHTS ---

    async function showShiftInsightsModal(initialCenterId) {
        if (!initialCenterId && Object.keys(centers).length === 0) {
            alert('No centers configured. Please add one via "Manage Centers" on the Inbound tab.');
            return;
        }

        document.getElementById('shift-insights-modal')?.remove();
        if (insightsHeaderInterval) clearInterval(insightsHeaderInterval);
        activeTimers.insights = [];

        const modal = document.createElement('div');
        modal.id = 'shift-insights-modal';

        const renderInsightsContent = async (centerId) => {
            if (!centerId) return;

            if (insightsHeaderInterval) clearInterval(insightsHeaderInterval);
            activeTimers.insights.forEach(clearInterval);
            activeTimers.insights = [];

            const centerOptions = Object.keys(centers).map(id => `<option value="${id}" ${id === centerId ? 'selected' : ''}>${centers[id].name}</option>`).join('');
            const storedData = await getCleanedVehicleData(centerId);
            const centerConfig = centers[centerId]?.config;

            if (!centerConfig) {
                 modal.innerHTML = `Error: No configuration found for center ${centerId}.`;
                 return;
            }

            const analysis = runShiftAnalysis(storedData, centerConfig);

            modal.innerHTML = `
                <div class="modal-overlay"></div>
                <div class="modal-content">
                    <div id="insights-header" class="modal-header"></div>
                    <div class="modal-body">
                        <div class="insights-controls">
                           <select id="insights-center-selector">${centerOptions}</select>
                        </div>
                        ${generateShiftPanels(analysis, centerConfig)}
                    </div>
                    <div class="modal-footer"><p>Designed & Crafted by Rh. | for ⚡ Team Sonic</p></div>
                </div>
                <button class="close-btn">&times;</button>`;

            if (!document.body.contains(modal)) document.body.appendChild(modal);

            insightsHeaderInterval = setInterval(() => updateDynamicHeader(modal.querySelector('#insights-header')), 1000);
            updateDynamicHeader(modal.querySelector('#insights-header'));
            startShiftCountdownTimers(analysis);

            modal.querySelector('.close-btn').onclick = () => {
                clearInterval(insightsHeaderInterval);
                activeTimers.insights.forEach(clearInterval);
                modal.remove();
            };
            modal.querySelector('#insights-center-selector').onchange = (e) => renderInsightsContent(e.target.value);
        };

        await renderInsightsContent(initialCenterId || Object.keys(centers)[0]);
    }

    function runShiftAnalysis(vehicleData, config) {
        const now = new Date();
        const analysis = { overall: { totalLoad: 0, totalMixedBags: 0, vehicleCount: 0 } };
        const laterVehicles = [];

        const getShiftBounds = (baseDate, shiftsConfig) => {
            const C_END_HOUR = shiftsConfig.C.end;
            const C_START_HOUR = shiftsConfig.C.start;

            const shiftCStarts = new Date(baseDate);
            shiftCStarts.setHours(C_START_HOUR, 0, 0, 0);

            const shiftCEnds = new Date(baseDate);
            if (C_END_HOUR < C_START_HOUR) {
                shiftCEnds.setDate(shiftCEnds.getDate() + 1);
            }
            shiftCEnds.setHours(C_END_HOUR, 0, 0, 0);

            return {
                A: { s: new Date(new Date(baseDate).setHours(shiftsConfig.A.start, 0)), e: new Date(new Date(baseDate).setHours(shiftsConfig.A.end, 0)) },
                B: { s: new Date(new Date(baseDate).setHours(shiftsConfig.B.start, 0)), e: new Date(new Date(baseDate).setHours(shiftsConfig.B.end, 0)) },
                C: { s: shiftCStarts, e: shiftCEnds }
            };
        };

        const today = new Date(new Date().setHours(0, 0, 0, 0));
        const yesterday = new Date(new Date().setDate(today.getDate() - 1));
        const yesterdayShiftBounds = getShiftBounds(yesterday, config.shifts);

        let currentOperationalDate = today;
        if (now < yesterdayShiftBounds.C.e && now >= yesterdayShiftBounds.C.s) {
            currentOperationalDate = yesterday;
        }

        const dateKeys = [];
        for (let i = 0; i < 2; i++) {
            const date = new Date(currentOperationalDate);
            date.setDate(date.getDate() + i);
            const dateString = date.toLocaleDateString('en-CA');
            dateKeys.push(dateString);
            analysis[dateString] = {
                date: date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }),
                shifts: {
                    A: { ...config.shifts.A, v: [] },
                    B: { ...config.shifts.B, v: [] },
                    C: { ...config.shifts.C, v: [] }
                }
            };
            const bounds = getShiftBounds(date, config.shifts);
            analysis[dateString].shifts.A.endDate = bounds.A.e;
            analysis[dateString].shifts.B.endDate = bounds.B.e;
            analysis[dateString].shifts.C.endDate = bounds.C.e;
        }

        for (const [id, details] of Object.entries(vehicleData)) {
            if (!details) continue;
            const eta = new Date(details.liveArrivalTime || details.estimatedArrivalTime);
            if (isNaN(eta.getTime())) continue;

            const readyTime = new Date(eta.getTime() + (config.prepBufferMins * 60000));
            let assigned = false;

            for (const dateKey of dateKeys) {
                const day = analysis[dateKey];
                const dayBaseDate = new Date(dateKey);
                const shiftBounds = getShiftBounds(dayBaseDate, config.shifts);

                for (const [shiftKey, bounds] of Object.entries(shiftBounds)) {
                    if (readyTime >= bounds.s && readyTime < bounds.e) {
                        const unloadCompletionTime = new Date(readyTime.getTime() + (details.totalLoad / (config.baysAvailable * config.unloadRatePerHourPerBay)) * 3600000);
                        const mixedBagProcessingMinutes = (details.mixedBagPkgCountForAlert / config.mixBagProcessRatePerHour) * 60;
                        const finalCompletionTime = new Date(unloadCompletionTime.getTime() + (mixedBagProcessingMinutes * 60000));

                        let status = 'onTime';
                        let spilloverMinutes = 0;
                        const shiftEnd = new Date(bounds.e);
                        const extendedEnd = new Date(shiftEnd.getTime() + (config.shiftExtensionMins * 60000));

                        if (finalCompletionTime > shiftEnd) {
                            status = (finalCompletionTime > extendedEnd) ? 'handover' : 'overtime';
                            spilloverMinutes = Math.round((finalCompletionTime - shiftEnd) / 60000);
                        }

                        const processedVehicle = { ...details, id, eta, readyTime, finalCompletionTime, status, isPastETA: eta < now, spilloverMinutes };
                        day.shifts[shiftKey].v.push(processedVehicle);

                        analysis.overall.totalLoad += details.totalLoad;
                        analysis.overall.totalMixedBags += details.mixedBagPkgCountForAlert;
                        analysis.overall.vehicleCount++;
                        assigned = true;
                        break;
                    }
                }
                if (assigned) break;
            }
             if (!assigned) {
                laterVehicles.push({ ...details, id, eta });
            }
        }
        analysis.later = { date: "Later", v: laterVehicles };
        return analysis;
    }


    function generateShiftPanels(analysis, config) {
        let html = generateSummaryKPIs(analysis.overall);
        Object.keys(analysis).forEach(key => {
            if (key === 'overall' || key === 'later') return;
            const day = analysis[key];
            html += `<div class="day-forecast"><h2 class="day-header">${day.date}</h2><div class="day-panels-container">`;
            html += Object.values(day.shifts).map(s => {
                const isCompleted = new Date() > s.endDate;
                const totalLoad = s.v.reduce((acc, curr) => acc + curr.totalLoad, 0);
                const totalMixedBags = s.v.reduce((acc, curr) => acc + curr.mixedBagPkgCountForAlert, 0);

                if (isCompleted) {
                     const handoverVehicles = s.v.filter(v => v.status === 'handover' || v.status === 'overtime');
                     const handoverLoad = handoverVehicles.reduce((acc, v) => acc + v.totalLoad, 0);
                     const handoverMixedBags = handoverVehicles.reduce((acc, v) => acc + v.mixedBagPkgCountForAlert, 0);

                    return `
                    <div class="shift-panel shift-completed" style="border-left-color:${s.color};">
                        <div class="shift-header"><h3><strong>${s.name}</strong></h3><span class="shift-completed-flag">Completed</span></div>
                        <div class="shift-summary-completed">
                            <div class="summary-kpi"><span>Vehicles</span><strong>${s.v.length}</strong></div>
                            <div class="summary-kpi"><span>Total Load</span><strong>${totalLoad.toLocaleString()}</strong></div>
                            <div class="summary-kpi"><span>Mixed Bags</span><strong>${totalMixedBags.toLocaleString()}</strong></div>
                        </div>
                        <div class="handover-summary">
                            <h4>Possible Handover</h4>
                            <div class="handover-item"><span>For Unloading:</span><strong>${handoverLoad.toLocaleString()}</strong></div>
                            <div class="handover-item"><span>For Mix Bag:</span><strong>${handoverMixedBags.toLocaleString()}</strong></div>
                        </div>
                    </div>`;
                }

                const shiftDurationHours = s.end < s.start ? (s.end + 24) - s.start : s.end - s.start;
                const shiftWorkHours = shiftDurationHours - config.shiftBreakHours;
                const hubUnloadRate = config.baysAvailable * config.unloadRatePerHourPerBay;
                const unloadCapacity = shiftWorkHours * hubUnloadRate;
                const mixedBagCapacity = shiftWorkHours * config.mixBagProcessRatePerHour;
                const unloadStress = unloadCapacity > 0 ? totalLoad / unloadCapacity : 0;
                const mixedBagStress = mixedBagCapacity > 0 ? totalMixedBags / mixedBagCapacity : 0;
                const dateKey = key.split('T')[0];

                return `
                    <div class="shift-panel" style="border-left-color:${s.color};">
                        <div class="shift-header"><h3><strong>${s.name}</strong></h3><span class="shift-countdown" id="countdown-${dateKey}-${s.name.replace(" ","")}"></span></div>
                        <div class="shift-summary">
                            <div><span>Total Load</span><strong>${totalLoad.toLocaleString()}</strong></div>
                            <div><span>Mixed Bags</span><strong>${totalMixedBags.toLocaleString()}</strong></div>
                            <div><span>Vehicles</span><strong>${s.v.length}</strong></div>
                        </div>
                        <div class="capacity-bar-container" title="Load: ${totalLoad.toLocaleString()} / Capacity: ${unloadCapacity.toLocaleString()}">
                            <div class="capacity-bar" style="width:${Math.min(unloadStress * 100, 100)}%; background-color:${unloadStress > 0.8 ? '#dc3545' : s.color};"></div>
                            <span>${(unloadStress * 100).toFixed(0)}% Unload Stress</span>
                        </div>
                        <div class="capacity-bar-container" title="Mixed Bags: ${totalMixedBags.toLocaleString()} / Capacity: ${mixedBagCapacity.toLocaleString()}">
                            <div class="capacity-bar" style="width:${Math.min(mixedBagStress * 100, 100)}%; background-color:${mixedBagStress > 0.8 ? '#fd7e14' : '#6c757d'};"></div>
                            <span>${(mixedBagStress * 100).toFixed(0)}% Mix Bag Stress</span>
                        </div>
                        <div class="vehicle-list">${(s.v.length > 0 ? s.v.map(v => generateVehicleCard(v, config)).join('') : `<p class="no-vehicles">No vehicles projected.</p>`)}</div>
                    </div>`;
            }).join('');
            html += `</div></div>`;
        });
        return html;
    }

    function generateVehicleCard(v, config){
        const eta = v.eta.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
        const completion = v.finalCompletionTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
        const spillover = v.spilloverMinutes > 0 ? ` (+${Math.floor(v.spilloverMinutes / 60)}h ${v.spilloverMinutes % 60}m)` : '';
        const statusMap = { onTime: { c: 'status-ontime', t: 'On-Time' }, overtime: { c: 'status-overtime', t: 'Overtime' }, handover: { c: 'status-handover', t: 'Handover' }};
        const statusStyle = statusMap[v.status];
        const priorityIcon = v.mixedBagPkgCountForAlert > config.highPriorityThreshold ? `<span class="priority-icon" title="High mixed bag count">🔥</span>` : '';
        const arrivedText = v.isPastETA ? `<span class="arrived-badge">Arrived</span> <span class="arrived-ago">(${formatTimeSince(v.eta)})</span>` : '';
        return `<div class="vehicle-card"><div class="vehicle-id">${priorityIcon}${v.id} <span class="origin">from ${v.originFacility||"N/A"}</span></div><div class="vehicle-details"><div><strong>ETA:</strong>${eta} ${arrivedText}</div><div><strong>Load:</strong>${v.totalLoad.toLocaleString()}</div><div><strong>Mixed Bags:</strong>${v.mixedBagPkgCountForAlert.toLocaleString()}</div><div><strong>Est. Clear:</strong>${completion}</div></div><div class="vehicle-status ${statusStyle.c}">${statusStyle.t}${spillover}</div></div>`
    }


    // --- UTILITY & HELPER FUNCTIONS ---

    function triggerPostSyncNotification(storedData, centerId){
        if (!userSettings.notifications.enabled || !userSettings.notifications.onSync || !centers[centerId]) return;
        const centerConfig = centers[centerId].config;
        const analysis = runShiftAnalysis(storedData, centerConfig);
        const { currentShift } = getShiftStatus(centerConfig);
        if (!currentShift) return;

        let currentShiftData = null;
        for (const key in analysis) {
            if (analysis[key].shifts) {
                const shift = analysis[key].shifts[currentShift.name.charAt(6)];
                if (shift) {
                    const now = new Date();
                    if (now >= new Date(new Date(key).setHours(0,0,0,0)) && now < shift.endDate) {
                         currentShiftData = shift;
                         break;
                    }
                }
            }
        }

        if (!currentShiftData) return;

        const vehicleCount = currentShiftData.v.length;
        const totalLoad = currentShiftData.v.reduce((a, c) => a + c.totalLoad, 0);
        const totalMixedBags = currentShiftData.v.reduce((a, c) => a + c.mixedBagPkgCountForAlert, 0);

        GM_notification({
            title: `📊 Sync Complete: ${centers[centerId].name}`,
            text: `Current shift (${currentShift.name}) has ${vehicleCount} vehicles expected.\nTotal Load: ${totalLoad.toLocaleString()}\nTotal Mixed Bags: ${totalMixedBags.toLocaleString()}`,
            image: "https://www.google.com/s2/favicons?domain=delhivery.com",
            highlight: false,
            onclick: () => window.focus()
        });
    }

    function getShiftStatus(config){
        if (!config) config = DEFAULT_CENTER_CONFIG;
        const SHIFTS = config.shifts;
        const now = new Date, h = now.getHours();
        let cs=null,st="Between Shifts";
        if(h>=SHIFTS.A.start&&h<SHIFTS.B.start) cs=SHIFTS.A;
        else if(h>=SHIFTS.B.start&&h<SHIFTS.C.start) cs=SHIFTS.B;
        else if(h>=SHIFTS.C.start||h<SHIFTS.C.end) cs=SHIFTS.C;

        if (h >= SHIFTS.A.start && h < SHIFTS.B.start) st = "Shift A in Progress";
        else if (h >= SHIFTS.B.start && h < SHIFTS.C.start) {
            st = (h < SHIFTS.A.end) ? "⚡ Shift A & B Overlap" : "Shift B in Progress";
        } else if (h >= SHIFTS.C.start || h < SHIFTS.C.end) st = "🌙 Night Shift in Progress";
        else st = "Between Shifts";

        let endsIn = "N/A";
        if(cs){
            let ed=new Date;
            if (cs.end < cs.start && h >= cs.start) ed.setDate(ed.getDate()+1);
            ed.setHours(cs.end,0,0,0);
            const df = ed - now;
            const eh=Math.floor(df/36e5), em=Math.floor(df%36e5/6e4);
            endsIn = `${eh}h ${em}m`;
        }
        return{st,endsIn,now,currentShift:cs}
    }

    function startTickingCountdown(cell, vehicleData, vehicleId, arr) {
        const arrival = new Date(vehicleData.liveArrivalTime || vehicleData.estimatedArrivalTime);
        const sta = new Date(vehicleData.estimatedArrivalTime);

        if (!cell || !arrival || isNaN(arrival.getTime()) || !sta || isNaN(sta.getTime())) {
            if (cell) cell.innerHTML = 'Invalid Date';
            return;
        }

        const timer = setInterval(() => {
            try {
                const now = new Date();
                const diffMs = arrival - now;
                const remainingSeconds = Math.abs(diffMs) / 1000;

                let fullSubtext = '';
                try {
                    const timeDiffFromStaMs = arrival - sta;
                    const isEarly = timeDiffFromStaMs < 0;
                    const diffFromStaMinutes = Math.abs(timeDiffFromStaMs / 60000);
                    const formattedArrival = arrival.toLocaleDateString('en-IN', { month: 'short', day: 'numeric'}) + ', ' + arrival.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
                    let earlyLateText = '';

                    if (diffFromStaMinutes > 5) {
                        const diffHours = Math.floor(diffFromStaMinutes / 60);
                        const diffMins = Math.round(diffFromStaMinutes % 60);
                        const status = isEarly ? 'Early' : 'Late';
                        const color = isEarly ? '#28a745' : '#dc3545';
                        let timeString = '';
                        if (diffHours > 0) timeString += `${diffHours}h `;
                        timeString += `${diffMins}m`;
                        earlyLateText = ` <span style="color:${color}; font-weight: bold;">(${status} ${timeString})</span>`;
                    }
                    fullSubtext = `<br><span class="eta-subtext">${formattedArrival}${earlyLateText}</span>`;
                } catch (e) {
                     console.error("Team Sonic: Error calculating ETA subtext", e);
                     fullSubtext = '';
                }

                let mainText = '';
                if (diffMs > 0) {
                    const h = Math.floor(remainingSeconds / 3600);
                    const m = Math.floor((remainingSeconds % 3600) / 60);
                    const sec = Math.floor(remainingSeconds % 60);
                    mainText = `<span class="countdown-timer">${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}</span>`;

                    if (userSettings.notifications.enabled && vehicleData.hasGps) {
                        const load = vehicleData.totalLoad || 0, origin = vehicleData.originFacility || "N/A";
                        if(userSettings.notifications.on60min && remainingSeconds <= 3660 && remainingSeconds > 3540 && !notifiedVehicles[vehicleId]?.notified60) {
                            notifiedVehicles[vehicleId] = { ...notifiedVehicles[vehicleId], notified60: true };
                            GM_notification({ title: `⏳ Approaching: ${vehicleId}`, text: `From: ${origin}\nETA: ~1 hour\nLoad: ${load.toLocaleString()}`, image: "https://www.google.com/s2/favicons?domain=delhivery.com", onclick: () => window.focus() });
                        }
                        if(userSettings.notifications.on30min && remainingSeconds <= 1860 && remainingSeconds > 1740 && !notifiedVehicles[vehicleId]?.notified30) {
                            notifiedVehicles[vehicleId] = { ...notifiedVehicles[vehicleId], notified30: true };
                            GM_notification({ title: `🔥 Arriving Soon: ${vehicleId}`, text: `From: ${origin}\nETA: ~30 mins\nLoad: ${load.toLocaleString()}`, image: "https://www.google.com/s2/favicons?domain=delhivery.com", highlight: true, onclick: () => window.focus() });
                        }
                    }
                } else {
                    if (vehicleData.hasGps) {
                        mainText = `<span class="arrived-text">Arrived<br><span class="arrived-ago">(${formatTimeSince(arrival)})</span></span>`;
                        if (userSettings.notifications.enabled && userSettings.notifications.onArrival && !notifiedVehicles[vehicleId]?.notifiedArrived) {
                            notifiedVehicles[vehicleId] = { ...notifiedVehicles[vehicleId], notifiedArrived: true };
                            const origin = vehicleData.originFacility || "N/A";
                            GM_notification({ title: `✅ Vehicle Arrived: ${vehicleId}`, text: `From: ${origin}\nReady for unloading.`, image: "https://www.google.com/s2/favicons?domain=delhivery.com", highlight: true, onclick: () => window.focus() });
                        }
                    } else {
                        const agoText = formatTimeSince(arrival);
                        mainText = `<span class="should-have-arrived-text">Should have arrived<br><span class="arrived-ago">(${agoText})</span></span>`;
                    }
                }

                cell.innerHTML = mainText + fullSubtext;

            } catch (err) {
                console.error(`Team Sonic: Error in countdown timer for ${vehicleId}:`, err);
                clearInterval(timer);
                cell.innerHTML = '<span style="color:red;">Error</span>';
            }
        }, 1000);
        arr.push(timer);
    }

    async function getCleanedVehicleData(centerId) {
        if (!centerId) return {};
        let storedData = JSON.parse(await GM_getValue(`inboundVehicleData_${centerId}`, "{}"));
        const now = new Date, autoClearThreshold = 36e5 * AUTO_CLEAR_GPS_VEHICLES_AFTER_HOURS;
        for (const vehicleNum in storedData) {
            const vehicle = storedData[vehicleNum];
            if (vehicle.hasGps && (now - new Date(vehicle.liveArrivalTime || vehicle.savedAt)) > autoClearThreshold) {
                delete storedData[vehicleNum];
            }
        }
        await GM_setValue(`inboundVehicleData_${centerId}`, JSON.stringify(storedData));
        return storedData;
    }

    function generateSummaryKPIs(overall) { return `<div class="kpi-container"><div class="kpi-card"><span>Total Incoming Load</span><strong>${overall.totalLoad.toLocaleString()}</strong></div><div class="kpi-card"><span>Total Mixed Bags</span><strong>${overall.totalMixedBags.toLocaleString()}</strong></div><div class="kpi-card"><span>Total Vehicles</span><strong>${overall.vehicleCount}</strong></div></div>`; }

    function updateDynamicHeader(el) {
        const now = new Date();
        const time = now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true });
        el.innerHTML = `<h1><strong>📊 Shift Operations Forecast</strong></h1><div class="header-status"><div class="current-time">${time}</div></div>`;
    }

    function startShiftCountdownTimers(analysis) {
        Object.keys(analysis).forEach(dateKey => {
            if(analysis[dateKey].shifts) {
                 for (const [shiftKey, shiftDetails] of Object.entries(analysis[dateKey].shifts)) {
                    const countdownEl = document.getElementById(`countdown-${dateKey}-${shiftKey}`);
                    if (countdownEl) {
                        const timer = setInterval(() => {
                            const remaining = new Date(shiftDetails.endDate) - new Date();
                            if (remaining < 0) {
                                countdownEl.textContent = "Ended";
                                clearInterval(timer);
                            } else {
                                const h = Math.floor(remaining / 36e5), m = Math.floor(remaining % 36e5 / 6e4), s = Math.floor(remaining % 6e4 / 1e3);
                                countdownEl.textContent = `Ends in ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
                            }
                        }, 1000);
                        activeTimers.insights.push(timer);
                    }
                }
            }
        });
    }

    function parseDateTimeString(str) { return new Date(str.replace(",", " " + (new Date).getFullYear() + ",")); }
    function formatTimeAgo(iso) { const s = Math.round((new Date - new Date(iso)) / 1e3), m = Math.round(s / 60), h = Math.round(m / 60); return s < 60 ? s + "s" : m < 60 ? m + "m" : h < 24 ? h + "h" : (new Date(iso)).toLocaleDateString("en-IN"); }
    function formatTimeSince(date) { const diffMs = new Date - date, elapsedMinutes = Math.floor(diffMs / 6e4), h = Math.floor(elapsedMinutes / 60), m = elapsedMinutes % 60; let agoText = ""; h > 0 && (agoText += `${h}h `); agoText += `${m}m ago`; return agoText; }

    async function markAsComplete(vNum, centerId) {
        let d = JSON.parse(await GM_getValue(`inboundVehicleData_${centerId}`, "{}"));
        d[vNum] && delete d[vNum], await GM_setValue(`inboundVehicleData_${centerId}`, JSON.stringify(d));
        const r = document.getElementById(`vehicle-row-${vNum}`);
        r && (r.style.opacity = "0", setTimeout(() => r.remove(), 300));
    }

    function getLiveRouteData(link, destinationCoords) {
        return new Promise((resolve, reject) => {
            if (!MAPBOX_ACCESS_TOKEN) return reject(new Error("Invalid Mapbox API Key provided."));
            const coordRegex = /@?(-?\d+\.\d+),(-?\d+\.\d+)/;
            const match = link.match(coordRegex);
            if (!match || match.length < 3) return reject(new Error("Could not parse coordinates from the Google Maps link."));
            const lat = match[1];
            const lon = match[2];
            const url = `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${lon},${lat};${destinationCoords}?access_token=${MAPBOX_ACCESS_TOKEN}`;
            GM_xmlhttpRequest({
                method: "GET",
                url,
                onload: r => {
                    if (r.status >= 200 && r.status < 300) {
                        const d = JSON.parse(r.responseText);
                        if (d.routes?.length > 0 && d.routes[0].distance !== undefined && d.routes[0].duration !== undefined) {
                            resolve({ durationSeconds: d.routes[0].duration, distanceKm: d.routes[0].distance / 1000 });
                        } else {
                            reject(new Error(d.message || "No route found in API response."));
                        }
                    } else {
                         reject(new Error(`API Error: ${r.status} ${r.statusText}. Response: ${r.responseText}`));
                    }
                },
                onerror: err => reject(new Error("A network error occurred while trying to fetch live route data."))
            });
        });
    }

    // --- STYLES ---
    GM_addStyle(`
        /* General & Switch Styles */
        .switch{position:relative;display:inline-block;width:44px;height:24px}.switch input{opacity:0;width:0;height:0}.slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:#ccc;-webkit-transition:.4s;transition:.4s}.slider:before{position:absolute;content:"";height:16px;width:16px;left:4px;bottom:4px;background-color:white;-webkit-transition:.4s;transition:.4s}input:checked+.slider{background-color:#28a745}input:focus+.slider{box-shadow:0 0 1px #2196F3}input:checked+.slider:before{-webkit-transform:translateX(20px);-ms-transform:translateX(20px);transform:translateX(20px)}.slider.round{border-radius:34px}.slider.round:before{border-radius:50%}
        #notification-types { border: none; padding: 0; margin: 0; margin-top: 10px; } #notification-types > div { margin-left: 10px; padding-left: 10px; border-left: 2px solid #dee2e6; } #notification-types[disabled] { opacity: 0.5; }

        /* Floating Buttons */
        #team-sonic-viewer-button, #team-sonic-insights-button { position: fixed; bottom: 20px; z-index: 9998; background-color: #00796B; color: white; border: none; border-radius: 25px; cursor: pointer; box-shadow: 0 4px 12px rgba(0,0,0,0.2); display: flex; align-items: center; padding: 8px 16px; font-family: sans-serif; font-weight: bold; font-size: 14px; transition: all 0.3s ease; }
        #team-sonic-viewer-button { left: 50%; transform: translateX(-50%); } #team-sonic-viewer-button:hover { background-color: #004D40; transform: translateX(-50%) scale(1.05); }
        #team-sonic-insights-button { left: calc(50% + 150px); transform: translateX(-50%); background-color: #6f42c1; } #team-sonic-insights-button:hover { background-color: #5a32a3; transform: translateX(-50%) scale(1.05); }

        /* Inbound Dashboard Buttons */
        #team-sonic-saver-container { display: flex; gap: 15px; margin-bottom: 15px; align-items: center; }
        .action-button.saver { padding: 10px 15px; font-size: 14px; font-weight: bold; color: white; background-color: #007bff; border: none; border-radius: 5px; cursor: pointer; }
        .action-button.center-mgmt { padding: 10px 15px; font-size: 14px; font-weight: bold; color: #212529; background-color: #e9ecef; border: 1px solid #ced4da; border-radius: 5px; cursor: pointer; }

        /* Table & Row Styles */
        .no-gps-row { background-color: rgba(255, 193, 7, 0.08) !important; border-left: 3px solid #ffc107; }
        .gps-row { border-left: 3px solid #28a745; }
        .countdown-timer { font-family: 'monospace'; font-size: 1.2em; font-weight: bold; color: #0056b3; }
        .arrived-text { font-weight: bold; color: #28a745; text-align: center; } .should-have-arrived-text { font-weight: bold; color: #fd7e14; text-align: center; } .arrived-ago { font-size: 0.8em; font-weight: normal; color: #6c757d; }

        /* Modal Styles */
        #saved-data-modal, #shift-insights-modal, #center-mgmt-modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 10000; display: flex; align-items: center; justify-content: center; font-family: sans-serif; }
        .modal-overlay { position: absolute; width: 100%; height: 100%; background: rgba(0,0,0,0.5); }
        .modal-content { position: relative; display: flex; flex-direction: column; border-radius: 12px; background: rgba(255, 255, 255, 0.9); backdrop-filter: blur(10px); max-height: 90vh; box-shadow: 0 5px 25px rgba(0,0,0,0.2); }
        .modal-header { padding: 20px 25px; border-bottom: 1px solid rgba(0,0,0,0.1); color: #212529; }
        .modal-body { flex-grow: 1; overflow-y: auto; padding: 20px; }
        .modal-footer { padding: 15px; text-align: center; font-size: 12px; color: #6c757d; border-top: 1px solid #e9ecef; }
        .close-btn { position: absolute; top: 10px; right: 15px; background: none; border: none; font-size: 32px; cursor: pointer; color: #6c757d; }
        .settings-panel { padding: 15px 25px; background-color: rgba(248,249,250, 0.9); border-bottom: 1px solid rgba(0,0,0,0.1); } .settings-panel.hidden { display: none; }
        .setting-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; }

        /* Data Viewer Modal Specific */
        #saved-data-modal .modal-content { width: 950px; }
        #saved-data-modal .modal-header { display:flex; justify-content: space-between; align-items: center; }
        #saved-data-modal .header-main-title { display: flex; flex-direction: column; gap: 5px; }
        .center-selector { padding: 5px; border-radius: 5px; border: 1px solid #ced4da; background-color: #fff; }
        #saved-data-modal .header-controls { display: flex; align-items: center; gap: 15px; }
        #saved-data-modal .modal-sync-info { font-size: 13px; }
        #saved-data-modal .settings-btn { background: none; border: none; font-size: 20px; cursor: pointer; padding: 5px; }
        #saved-data-modal table { width: 100%; border-collapse: collapse; }
        #saved-data-modal th, #saved-data-modal td { padding: 14px; text-align: left; border-bottom: 1px solid #dee2e6; }
        #saved-data-modal .complete-btn { background-color: #c82333; color: white; border: none; border-radius: 5px; padding: 8px 12px; cursor: pointer; }

        /* Center Management Modal */
        #center-mgmt-modal .modal-body { background: #f8f9fa; }
        #center-mgmt-table { width: 100%; border-collapse: separate; border-spacing: 0 15px;}
        #center-mgmt-table td { padding: 15px; border: 1px solid #dee2e6; background: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); display: flex; gap: 20px;}
        #center-mgmt-table .center-main-details { flex-basis: 40%; display: flex; flex-direction: column; gap: 8px; border-right: 1px solid #e9ecef; padding-right: 20px;}
        #center-mgmt-table .center-config-details { flex-basis: 60%; }
        #center-mgmt-table label { font-weight: bold; font-size: 12px; color: #495057; margin-bottom: -4px; }
        #center-mgmt-table input { width: 100%; padding: 8px; border: 1px solid #ced4da; border-radius: 4px; box-sizing: border-box; }
        #center-mgmt-table .center-actions { margin-top: auto; display:flex; justify-content: space-between; align-items: center; }
        #center-mgmt-table .delete-center-btn { background: #dc3545; color: white; border: none; cursor: pointer; border-radius: 5px; padding: 8px 12px; font-size: 13px; }
        #center-mgmt-table .config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 15px;}
        #center-mgmt-table .config-grid div { display: flex; flex-direction: column; }
        #center-mgmt-table h4 { margin-top: 15px; margin-bottom: 10px; font-size: 14px;}
        #center-mgmt-table .shift-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
        #center-mgmt-table .shift-time-inputs { display: flex; align-items: center; gap: 5px; }
        #center-mgmt-table .shift-time-inputs input { text-align: center; }
        .gps-toggle-container-modal { display: flex; align-items: center; gap: 8px; }
        #add-center-form { display: flex; gap: 10px; margin-top: 10px; }
        #add-center-form input { flex-grow: 1; padding: 8px; border: 1px solid #ccc; border-radius: 4px;}
        #add-center-form button { padding: 8px 15px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; }

        /* Shift Insights Modal */
        #shift-insights-modal .modal-content { width: 1500px; max-width: 95vw; background: #f8f9fa; }
        #shift-insights-modal .modal-header { background-color: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
        #shift-insights-modal .modal-header h1 { font-weight: bold; }
        #shift-insights-modal .header-status { display: flex; justify-content: flex-end; align-items: center; font-size: 16px; }
        #shift-insights-modal .current-time { font-family: 'monospace'; background: #e9ecef; padding: 5px 10px; border-radius: 5px; }
        #shift-insights-modal .insights-controls { padding-bottom: 15px; }
        #insights-center-selector { font-size: 16px; padding: 8px; border-radius: 5px; border: 1px solid #ced4da; background-color: #fff; width: 100%;}
        #shift-insights-modal .kpi-container { display: flex; gap: 20px; padding-bottom: 15px; }
        #shift-insights-modal .kpi-card { background: #fff; border-radius: 8px; padding: 15px; flex-grow: 1; text-align: center; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border: 1px solid #e9ecef; }
        #shift-insights-modal .kpi-card span { display: block; font-size: 14px; color: #6c757d; margin-bottom: 5px; }
        #shift-insights-modal .kpi-card strong { font-size: 24px; color: #212529; }
        #shift-insights-modal .day-forecast { margin-bottom: 20px; }
        #shift-insights-modal .day-header { color: #343a40; font-size: 20px; padding-bottom: 10px; border-bottom: 2px solid #dee2e6; margin-bottom: 15px; font-weight: bold; }
        #shift-insights-modal .day-panels-container { display: flex; gap: 20px; }
        #shift-insights-modal .shift-panel { background: #fff; box-shadow: 0 2px 4px rgba(0,0,0,0.05); border-radius: 8px; flex: 1; display: flex; flex-direction: column; min-width: 0; border: 1px solid #e9ecef; border-left: 5px solid; transition: all 0.3s ease; }
        #shift-insights-modal .shift-panel.shift-completed { background-color: #f1f3f5; }
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
        #shift-insights-modal .vehicle-list { padding: 0 15px 15px 15px; overflow-y: auto; flex-grow: 1; max-height: 300px; }
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
        .shift-summary-completed { display: flex; justify-content: space-around; padding: 15px; border-bottom: 1px solid #e0e0e0; background: #f1f3f5; }
        .summary-kpi { text-align: center; }
        .summary-kpi span { font-size: 12px; color: #6c757d; display: block; }
        .summary-kpi strong { font-size: 18px; color: #212529; }
        .handover-summary { padding: 15px; }
        .handover-summary h4 { font-size: 14px; text-align: center; margin-top: 0; margin-bottom: 10px; color: #c82333; }
        .handover-item { display: flex; justify-content: space-between; font-size: 13px; padding: 4px 0; }
        .shift-completed-flag { font-weight: bold; color: #28a745; font-size: 14px; }
        .eta-subtext { font-size: 0.8em; color: #495057; font-weight: normal; }
    `);
})();

