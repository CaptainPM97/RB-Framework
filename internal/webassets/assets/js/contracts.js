// ============================================================
// contracts.js – Vertragsmodul StateV Verwaltung
// ============================================================

let contractsData = { templates: [], contracts: [], vehicles: [], firmConfigs: [], buildingHash: '' };
let cvInitialized      = false;
let cvContractFilter   = 'active';
let vehicleCatFilter   = '';
let buildingInfo     = null; // { freeRooms, totalRooms, occupiedRooms, bankBalance, bankVban }

// Co-Mieter Aufschläge (Quelle: ResourceBay IC-Website)
const CO_MIETER_RATES = {
    miete: { Stündlich: 0.40, Wöchentlich: 0.10, Monatlich: 0.05 },
    pacht: { Stündlich: 0.30, Wöchentlich: 0.15, Monatlich: 0.05 },
};
const CO_MIETER_MAX = { miete: 2, pacht: 4 };

function cvCoMieterRate(type, tarifName) {
    return (CO_MIETER_RATES[type] || CO_MIETER_RATES.miete)[tarifName] ?? 0.05;
}

function cvTarifKürzel(tarif) {
    return { Stündlich:'Std.', Wöchentlich:'Wo.', Monatlich:'Mo.' }[tarif] ?? tarif;
}

// Nur intern für gesamtbetrag-Sortierung – wird nicht angezeigt
function cvMonthlyValue(tarifName, betrag) {
    const f = { Stündlich:720, Wöchentlich:4.333, Monatlich:1 };
    return (Number(betrag)||0) * (f[tarifName]||1);
}

const CONTRACT_TYPES  = { vermietung: 'Vermietung', kooperation: 'Kooperation' };
const TARIF_NAMEN       = ['Stündlich', 'Wöchentlich', 'Monatlich'];
const FIRMA_TARIF_NAMEN = ['Wöchentlich', 'Monatlich']; // Stunden- und Tagesmiete für Firmen nicht erlaubt
const TYPE_LABELS    = { vermietung: '🏠 Vermietung', verpachtung: '🏠 Vermietung', kooperation: '🤝 Kooperation' };
const TYPE_COLORS    = { vermietung: 'var(--primary)', verpachtung: 'var(--primary)', kooperation: 'var(--green)' };

const TEMPLATE_VARS = [
    ['{{mieter_name}}',   'Name des Mieters / Pächters'],
    ['{{mieter_vban}}',   'VBAN des Mieters'],
    ['{{vertragstyp}}',   'Art des Vertrags'],
    ['{{start_datum}}',   'Vertragsbeginn (Datum)'],
    ['{{start_uhrzeit}}', 'Vertragsbeginn (Uhrzeit)'],
    ['{{end_datum}}',     'Vertragsende (leer = unbefristet)'],
    ['{{garage}}',        'Abstellplatz / Garage'],
    ['{{kaution}}',       'Kautionsbetrag'],
    ['{{datum_heute}}',   'Heutiges Datum'],
];

// ── API ─────────────────────────────────────────────────────
async function loadContractsData() {
    const pending = window._prefetchContracts;
    if (pending) {
        window._prefetchContracts = null;
        const data = await pending;
        if (data) {
            contractsData = data;
            if (!contractsData.firmConfigs) contractsData.firmConfigs = [];
            return;
        }
    }
    const res = await fetch('api/contracts.php?action=all');
    if (!res.ok) throw new Error(`Server-Fehler ${res.status}`);
    contractsData = await res.json();
    if (!contractsData.firmConfigs) contractsData.firmConfigs = [];
}

async function cvPost(action, body) {
    const res = await fetch(`api/contracts.php?action=${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `Fehler ${res.status}`);
    return json;
}

// ── Utilities ────────────────────────────────────────────────
function escapeHtml(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function cvFormatDate(d) {
    if (!d) return '–';
    const [y, m, day] = d.split('-');
    return `${day}.${m}.${y}`;
}

// Erster Fälligkeitstermin je nach Tarif (Stündlich → null)
function cvFirstDueDate(startDate, startTime, tarifName) {
    if (!startDate || tarifName === 'Stündlich') return null;
    const d = new Date(startDate + 'T' + (startTime || '00:00') + ':00');
    if (tarifName === 'Wöchentlich') d.setDate(d.getDate() + 7);
    if (tarifName === 'Monatlich')   d.setDate(d.getDate() + 28);
    return d;
}

function cvFormatDateObj(d) {
    if (!d) return '–';
    const day = String(d.getDate()).padStart(2,'0');
    const mon = String(d.getMonth()+1).padStart(2,'0');
    return `${day}.${mon}.${d.getFullYear()}`;
}
function cvFormatDateTimeObj(d, time) {
    if (!d) return '–';
    return cvFormatDateObj(d) + (time && time !== '00:00' ? ` ${time} Uhr` : '');
}

function cvFormatMoney(n) {
    const v = Number(n) || 0;
    return '$ ' + v.toLocaleString('de-DE');
}

function cvStatus(c) {
    if (c.status === 'terminated') return 'terminated';
    const today = new Date().toISOString().split('T')[0];
    if (c.startDate > today) return 'upcoming';
    if (!c.endDate || c.endDate >= today) return 'active';
    return 'expired';
}

function cvStatusLabel(s) {
    return { active:'Aktiv', upcoming:'Bevorstehend', expired:'Abgelaufen', terminated:'Beendet' }[s] ?? s;
}

function cvStatusColor(s) {
    return { active:'var(--green)', upcoming:'var(--yellow)', expired:'var(--text-muted)', terminated:'var(--red)' }[s] ?? 'inherit';
}

function cvFillVars(text, c) {
    if (!text) return '';
    const map = {
        '{{mieter_name}}':   c.mieterName    || '',
        '{{mieter_vban}}':   c.mieterVban    || '',
        '{{vertragstyp}}':   CONTRACT_TYPES[c.type] || c.type || '',
        '{{start_datum}}':   cvFormatDate(c.startDate),
        '{{start_uhrzeit}}': c.startTime     || '',
        '{{end_datum}}':     c.endDate ? cvFormatDate(c.endDate) : 'Unbefristet',
        '{{garage}}':        c.garage        || '–',
        '{{kaution}}':       cvFormatMoney(c.kaution),
        '{{datum_heute}}':   cvFormatDate(new Date().toISOString().split('T')[0]),
    };
    return text.replace(/\{\{[^}]+\}\}/g, m => map[m] ?? m);
}

// Intro + Auflistung + Kosten (vor dem Template-Text)
function buildContractListing(c) {
    const firmen   = c.selectedFirmen   || [];
    const vehicles = c.selectedVehicles || [];
    const k        = cvTarifKürzel;
    const isKoop   = c.kooperationsrabatt && firmen.length > 0 && vehicles.length > 0;
    const vNr      = c.vertragsnummer || '???';
    const lines    = [];

    // Alle Tarif-Gruppen ermitteln → sub-numbers
    const allItems = [
        ...firmen.map(f   => ({ label: f.firmaName, tarif: f.tarifName, betrag: f.betrag, coMieter: f.coMieter||0, baseBetrag: f.baseBetrag??f.betrag, kind:'pacht' })),
        ...vehicles.map(v => ({ label: v.vehicleName + (v.kennzeichen ? ` (${v.kennzeichen})` : ''), tarif: v.tarifName, betrag: v.betrag, coMieter: v.coMieter||0, baseBetrag: v.baseBetrag??v.betrag, kind:'miete' })),
    ];
    const ORDER = ['Stündlich','Wöchentlich','Monatlich'];
    const groups = {};
    allItems.forEach(i => { if (!groups[i.tarif]) groups[i.tarif] = []; groups[i.tarif].push(i); });
    const tarifKeys = [...ORDER.filter(x => groups[x]), ...Object.keys(groups).filter(x => !ORDER.includes(x))];
    const multiTarif = tarifKeys.length > 1;

    // Einleitung mit Vertragsnummer (keine Sub-Nummern)
    const startStr = cvFormatDate(c.startDate) + (c.startTime && c.startTime !== '00:00' ? ' um ' + c.startTime + ' Uhr' : '');
    lines.push('Vertragsnummer: ' + vNr);
    lines.push('Vertrag zwischen ResourceBay in Vertretung Titus Gruber im folgenden Vermieter genannt und ' + (c.mieterName || '–') + ' im folgenden Mieter genannt.');
    if (c.mieterVban) lines.push('VBAN Mieter: ' + c.mieterVban);
    const hotelVban = (typeof window.buildingBankVban !== 'undefined' && window.buildingBankVban) ? window.buildingBankVban : (c.einnahmeKontoVban || null);
    if (hotelVban) lines.push('Zahlungsempfänger (Hotel): ' + hotelVban);
    if (isKoop) {
        lines.push('');
        lines.push('*** KOOPERATIONSVERTRAG – 15 % Kooperationsrabatt auf alle Positionen ***');
    }
    lines.push('Mietbeginn: ' + startStr);
    lines.push('');

    if (!firmen.length && !vehicles.length) {
        lines.push('(Keine Mietgegenstände eingetragen.)');
        lines.push('');
        return lines.join('\n');
    }

    const typeParts = [...(firmen.length ? ['Firmen (Pacht)'] : []), ...(vehicles.length ? ['Fahrzeuge (Miete)'] : [])];
    lines.push(`Im Folgenden eine Aufstellung der angemieteten ${typeParts.join(' und ')}:`);
    lines.push('');

    // Firmen
    if (firmen.length) {
        lines.push('─── FIRMEN (PACHT) ' + '─'.repeat(35));
        firmen.forEach(f => {
            const coM  = f.coMieter || 0;
            const rate = cvCoMieterRate('pacht', f.tarifName);
            lines.push('');
            lines.push(`• ${f.firmaName}`);
            if (coM > 0) {
                const pct  = Math.round(rate * 100);
                const base = f.baseBetrag ?? f.betrag;
                lines.push(`  Tarif: ${f.tarifName} – Basis: ${cvFormatMoney(base)}/${k(f.tarifName)}`);
                lines.push(`  Co-Mitnutzer: ${coM} (+${pct} % je = +${Math.round(coM * rate * 100)} %) → Endpreis: ${cvFormatMoney(f.betrag)}/${k(f.tarifName)}`);
            } else {
                lines.push(`  Tarif: ${f.tarifName} – ${cvFormatMoney(f.betrag)}/${k(f.tarifName)}`);
            }
            if (isKoop) lines.push(`  inkl. Kooperationsrabatt (−15 %) → ${cvFormatMoney(f.betrag * 0.85)}/${k(f.tarifName)}`);
        });
        lines.push('');
    }

    // Fahrzeuge
    if (vehicles.length) {
        lines.push('─── FAHRZEUGE (MIETE) ' + '─'.repeat(32));
        vehicles.forEach(v => {
            const coM  = v.coMieter || 0;
            const rate = cvCoMieterRate('miete', v.tarifName);
            lines.push('');
            lines.push('• ' + v.vehicleName + (v.kennzeichen ? ' (' + v.kennzeichen + ')' : '') + (v.isTrailer ? ' [Trailer]' : ''));
            if (coM > 0) {
                const pct  = Math.round(rate * 100);
                const base = v.baseBetrag ?? v.betrag;
                lines.push(`  Tarif: ${v.tarifName} – Basis: ${cvFormatMoney(base)}/${k(v.tarifName)}`);
                lines.push(`  Co-Mitnutzer: ${coM} (+${pct} % je = +${Math.round(coM * rate * 100)} %) → Endpreis: ${cvFormatMoney(v.betrag)}/${k(v.tarifName)}`);
            } else {
                lines.push(`  Tarif: ${v.tarifName} – ${cvFormatMoney(v.betrag)}/${k(v.tarifName)}`);
            }
            if (isKoop) lines.push(`  inkl. Kooperationsrabatt (−15 %) → ${cvFormatMoney(v.betrag * 0.85)}/${k(v.tarifName)}`);
            if (!v.isTrailer) {
                lines.push('  → Das Fahrzeug ist mit vollem Kraftstofftank zurückzugeben.');
                lines.push('  → Muss bei Rückgabe fahrtüchtig und ohne Beschädigungen sein.');
            }
        });
        lines.push('');
    }

    if (c.garage) { lines.push(`Abstellplatz / Garage: ${c.garage}`); lines.push(''); }

    // Kostenübersicht – nach Tarif-Typ gruppiert, Fälligkeit je Gruppe
    lines.push('─── KOSTENÜBERSICHT ' + '─'.repeat(34));

    tarifKeys.forEach(function(tarif) {
        var items   = groups[tarif];
        var dueDate = cvFirstDueDate(c.startDate, c.startTime, tarif);
        lines.push('');
        lines.push(tarif.toUpperCase() + ':');
        var groupSum = 0;
        items.forEach(function(i) {
            lines.push('  ' + i.label + ': ' + cvFormatMoney(i.betrag) + '/' + k(tarif));
            groupSum += i.betrag;
        });
        if (items.length > 1) lines.push('  Summe: ' + cvFormatMoney(groupSum) + '/' + k(tarif));
        if (isKoop) {
            var disc = groupSum * 0.15;
            lines.push('  Kooperationsrabatt (−15 %): –' + cvFormatMoney(disc) + '/' + k(tarif));
            lines.push('  Netto: ' + cvFormatMoney(groupSum - disc) + '/' + k(tarif));
        }
        if (dueDate) {
            lines.push('  Erste Abrechnung fällig: ' + cvFormatDateTimeObj(dueDate, c.startTime));
        }
    });

    lines.push('');
    lines.push('Kaution (einmalig): ' + cvFormatMoney(c.kaution));
    lines.push('');
    return lines.join('\n');
}

// Rechtliche Klauseln (nach dem Template-Text)
function buildLegalClauses(c) {
    const allItems   = [...(c.selectedFirmen || []), ...(c.selectedVehicles || [])];
    const allTarife  = allItems.map(i => i.tarifName || '');
    const isAllHourly = allTarife.length > 0 && allTarife.every(t => t === 'Stündlich');

    const lines = ['', '─── ZAHLUNGSBEDINGUNGEN ' + '─'.repeat(29)];

    if (isAllHourly) {
        lines.push('Gehen seit mehr als 3 Tagen ohne vorherige Ankündigung oder Meldung');
        lines.push('keine Mietzahlungen ein, ist der Vermieter / Verpächter berechtigt,');
        lines.push('den Vertrag fristlos zu kündigen. Der Mieter / Pächter hat in diesem Fall');
        lines.push('keinerlei Ansprüche gegenüber dem Vermieter / Verpächter.');
    } else {
        lines.push('Bei Nichtzahlung zum vereinbarten Zeitpunkt hat der Mieter / Pächter 4 Stunden Zeit,');
        lines.push('den ausstehenden Betrag auszugleichen.');
        lines.push('Wird dieser Zeitraum überschritten, ist der Vermieter / Verpächter berechtigt,');
        lines.push('den Vertrag ohne weitere Ankündigung fristlos zu kündigen.');
    }
    if (c.kaution > 0) {
        lines.push('');
        lines.push('─── KAUTION ' + '─'.repeat(41));
        lines.push('Nach Kündigung oder Beendigung dieses Vertrags wird das Fahrzeug bzw. das Mietobjekt');
        lines.push('auf Schäden und einen vollständig gefüllten Tank geprüft. Festgestellte Schäden oder');
        lines.push('ein nicht vollständiger Tank berechtigen den Vermieter, die Kaution anteilig oder vollständig');
        lines.push('einzubehalten. Gleiches gilt für eine Rückgabe des Fahrzeugs in einer falschen Garage');
        lines.push('(Überfahrt), wofür bis zu 100 % der Kaution einbehalten werden können.');
        lines.push('Die Kaution wird nach erfolgreicher Prüfung ohne Beanstandung vollständig zurückerstattet.');
    }
    lines.push('');
    lines.push('─── INVENTAR ' + '─'.repeat(40));
    lines.push('Sämtliches Inventar, das sich zum Zeitpunkt der Vertragsbeendigung in den gemieteten bzw.');
    lines.push('gepachteten Firmen oder Fahrzeugen befindet, geht automatisch und ohne gesonderte Vereinbarung');
    lines.push('in den Besitz von ResourceBay über. Es besteht kein Anrecht auf Rückerstattung oder Entschädigung.');
    lines.push('');
    return lines.join('\n');
}

// ── Modal-System ─────────────────────────────────────────────
let cvModal = null;

function cvOpenModal({ title, bodyHTML, onSave, saveLabel = 'Speichern', wide = false, extraWide = false, noFooter = false }) {
    cvCloseModal();

    const ov = document.createElement('div');
    ov.id        = 'cv-modal-overlay';
    ov.className = 'cv-modal-overlay';
    ov.innerHTML = `
        <div class="cv-modal${extraWide ? ' cv-modal-extra-wide' : (wide ? ' cv-modal-wide' : '')}">
            <div class="cv-modal-hd">
                <span>${escapeHtml(title)}</span>
                <button class="cv-modal-close" onclick="cvCloseModal()">✕</button>
            </div>
            <div class="cv-modal-bd" id="cv-modal-bd">${bodyHTML}</div>
            ${!noFooter ? `
            <div class="cv-modal-ft" id="cv-modal-ft">
                <button class="hero-btn hero-btn-secondary" type="button" onclick="cvCloseModal()">Abbrechen</button>
                <button class="hero-btn" type="button" id="cv-modal-save">${escapeHtml(saveLabel)}</button>
            </div>` : ''}
        </div>`;

    document.body.appendChild(ov);
    document.body.style.overflow = 'hidden';
    cvModal = { onSave, saveLabel };

    if (onSave) {
        document.getElementById('cv-modal-save')?.addEventListener('click', () => {
            if (cvModal?.onSave) cvModal.onSave();
        });
    }

    requestAnimationFrame(() => ov.classList.add('cv-modal-open'));
}

function cvCloseModal() {
    const ov = document.getElementById('cv-modal-overlay');
    if (ov) ov.remove();
    document.body.style.overflow = '';
    cvModal = null;
}

function cvModalErr(msg) {
    let el = document.getElementById('cv-modal-err');
    if (!el) {
        el = document.createElement('div');
        el.id = 'cv-modal-err';
        el.className = 'cv-form-error';
        document.getElementById('cv-modal-ft')?.prepend(el);
    }
    el.textContent = msg;
}

function cvModalBusy(label) {
    const btn = document.getElementById('cv-modal-save');
    if (!btn) return;
    btn.disabled    = !!label;
    btn.textContent = label || cvModal?.saveLabel || 'Speichern';
}

// ── Hilfsfunktionen ──────────────────────────────────────────
function getActiveContracts() {
    const today = new Date().toISOString().split('T')[0];
    return (contractsData.contracts || []).filter(c =>
        c.status !== 'terminated' && c.startDate <= today && (!c.endDate || c.endDate >= today)
    );
}

function daysUntilEnd(endDate) {
    if (!endDate) return null;
    const diff = (new Date(endDate) - new Date()) / 86400000;
    return Math.ceil(diff);
}

function rentedVehicleIds() {
    return new Set(
        getActiveContracts().flatMap(c => (c.selectedVehicles || []).map(v => v.vehicleId))
    );
}

// Fahrzeuge nach Kategorie A–Z sortieren (ohne Kategorie ganz am Ende), dann nach Name
function sortVehiclesByCat(vehicles) {
    return [...vehicles].sort((a, b) => {
        const ca = (a.kategorie || '').trim();
        const cb = (b.kategorie || '').trim();
        if (!ca && cb)  return 1;
        if (ca && !cb)  return -1;
        const cmp = ca.localeCompare(cb, 'de');
        return cmp !== 0 ? cmp : (a.name || '').localeCompare(b.name || '', 'de');
    });
}

// Sortierte Fahrzeuge in Kategoriegruppen aufteilen: [{label, items}]
function groupVehiclesByCat(vehicles) {
    const sorted = sortVehiclesByCat(vehicles);
    const groups = [];
    let current  = null;
    for (const v of sorted) {
        const cat = (v.kategorie || '').trim() || null;
        if (!current || current.label !== cat) {
            current = { label: cat, items: [] };
            groups.push(current);
        }
        current.items.push(v);
    }
    return groups;
}

// ── Building-Daten laden ─────────────────────────────────────
// buildingId wird nach dem ersten Lookup gecacht, damit /building/list
// bei jedem weiteren Seitenaufruf übersprungen werden kann.
let _buildingIdCache = null;

async function loadBuildingData() {
    const hash = contractsData.buildingHash;
    console.log('[Building] hash:', hash, '| buildingBankAccounts before:', window.buildingBankAccounts?.length ?? 'unset');
    if (!hash) { console.log('[Building] kein hash → abbruch'); return; }
    try {
        let bid = _buildingIdCache || contractsData.buildingId || null;

        if (!bid) {
            // Einmaliger List-Aufruf (nur beim ersten Mal, danach gecacht in contractsData.buildingId)
            const listMap   = await apiBatch(['building/list']);
            const buildings = listMap['building/list']?.body;
            if (!Array.isArray(buildings)) return;
            const building  = buildings.find(b => b.hash === hash);
            if (!building)  { console.warn('Building hash nicht gefunden:', hash); return; }
            bid = building.id;
            _buildingIdCache = bid;
            // ID persistent in contracts.json speichern – nächster Aufruf überspringt /list
            cvPost('save_setting', { key: 'buildingId', value: String(bid) }).catch(() => {});
        }

        // Alle 3 Endpunkte in einem einzigen Batch-Request
        const dataMap  = await apiBatch([
            `building/details/${bid}`,
            `building/bankaccounts/${bid}`,
            `building/rooms/${bid}`,
        ]);

        const details  = dataMap[`building/details/${bid}`]?.body      || {};
        const accounts = dataMap[`building/bankaccounts/${bid}`]?.body  || [];
        const rooms    = dataMap[`building/rooms/${bid}`]?.body         || [];
        const mainAcc  = accounts.find(a => a.main) ?? accounts[0]     ?? null;

        console.log('[Building] details:', details);
        console.log('[Building] rooms (erste 3):', JSON.stringify(rooms.slice(0, 3), null, 2));
        console.log('[Building] accounts:', JSON.stringify(accounts, null, 2));

        buildingInfo = {
            id:            bid,
            freeRooms:     details.freeRooms     ?? null,
            totalRooms:    details.totalRooms     ?? null,
            occupiedRooms: details.occupiedRooms  ?? null,
            bankBalance:   mainAcc?.balance       ?? null,
            bankVban:      mainAcc?.vban          ?? null,
            rooms,
        };

        window.bankAccounts         = accounts;
        window.buildingBankVban     = mainAcc?.vban ?? null;
        window.buildingBankAccounts = accounts; // für Bank-Seite (bleibt erhalten)
        console.log('[Building] accounts gesetzt:', accounts.length, accounts);
        if (typeof renderBankPage === 'function') { console.log('[Building] renderBankPage wird aufgerufen'); renderBankPage(); }
        else console.warn('[Building] renderBankPage nicht gefunden!');

        renderContractsDashboard();
    } catch(e) {
        console.warn('Building-Daten konnten nicht geladen werden:', e.message);
    }
}

// ── Init ─────────────────────────────────────────────────────
let cvSearchQuery = '';

async function initVertraegePage() {
    if (cvInitialized) return;
    cvInitialized = true;

    renderContractsDashboard();
    renderContractsList();
    renderTemplatesList();
    renderVehiclesList();
    renderFirmSettingsList();

    document.querySelectorAll('.cv-filter-chip').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cv-filter-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            cvContractFilter = btn.dataset.filter;
            renderContractsList();
        });
    });

    document.getElementById('cv-contract-search')?.addEventListener('input', e => {
        cvSearchQuery = e.target.value.toLowerCase();
        renderContractsList();
    });

    document.getElementById('btn-new-contract')?.addEventListener('click', () => openContractModal(null));
    document.getElementById('btn-new-template')?.addEventListener('click', () => openTemplateModal(null));
    document.getElementById('btn-new-vehicle')?.addEventListener ('click', () => openVehicleModal(null));

    try {
        await loadContractsData();
        renderContractsDashboard();
        renderContractsList();
        renderTemplatesList();
        renderVehiclesList();
        renderFirmSettingsList();
        // Zimmer-Tab direkt einblenden wenn bank-Berechtigung vorhanden
        if (typeof PERMS !== 'undefined' && PERMS.bank) {
            const btn = document.getElementById('vtab-btn-zimmer');
            if (btn) btn.style.display = '';
        }
        // Building-Daten parallel nachladen (non-blocking)
        loadBuildingData();
    } catch (e) {
        const box = `<div class="grid-card"><div class="info-text cv-err">Ladefehler: ${escapeHtml(e.message)}</div></div>`;
        ['contracts-list','templates-list','vehicles-list','firm-settings-list'].forEach(id => {
            const el = document.getElementById(id);
            if (el && !el.children.length) el.innerHTML = box;
        });
    }
}

// ── Dashboard-Statistiken (oben im Verträge-Tab) ─────────────
function renderContractsDashboard() {
    const el = document.getElementById('cv-dashboard');
    if (!el) return;

    const active  = (contractsData.contracts || []).filter(c => cvStatus(c) === 'active');
    const kaution = active.filter(c => c.kautionStatus === 'erhalten').reduce((s, c) => s + (Number(c.kaution) || 0), 0);

    // Bestand Fahrzeuge & Firmen
    const vTotal  = (contractsData.vehicles    || []).reduce((s, v)  => s + (v.menge  || 1), 0);
    const fTotal  = (contractsData.firmConfigs || []).reduce((s, fc) => s + (fc.menge || 1), 0);
    const vRented = active.reduce((s, c) => s + (c.selectedVehicles || []).length, 0);
    const fRented = active.reduce((s, c) => s + (c.selectedFirmen   || []).length, 0);
    const vFree   = Math.max(0, vTotal - vRented);
    const fFree   = Math.max(0, fTotal - fRented);
    const soon    = active.filter(c => c.endDate && daysUntilEnd(c.endDate) <= 14 && daysUntilEnd(c.endDate) >= 0);

    // Wohnungen-Karte
    const hasBuilding = buildingInfo !== null;
    const buildingHash = contractsData.buildingHash || '';
    let wohnungVal, wohnungSub = '', wohnungExtra = '';
    if (!buildingHash) {
        wohnungVal = '–';
        wohnungSub = '<div class="cv-stat-hint" onclick="openBuildingSettingsModal()" style="cursor:pointer;color:var(--primary)">⚙ Gebäude konfigurieren</div>';
    } else if (!hasBuilding) {
        wohnungVal = '<span style="font-size:16px;color:var(--text-muted)">Lade…</span>';
        wohnungSub = `<div class="cv-stat-hint">${escapeHtml(buildingHash)}</div>`;
    } else {
        const free  = buildingInfo.freeRooms ?? 0;
        const total = buildingInfo.totalRooms ?? 0;
        const pct   = total ? Math.round((buildingInfo.occupiedRooms / total) * 100) : 0;
        wohnungVal  = `<span style="color:${free > 0 ? 'var(--green)' : 'var(--red)'}">${free}</span> <span style="font-size:16px;color:var(--text-muted)">/ ${total}</span>`;
        wohnungSub  = `<div class="cv-stat-hint">Auslastung: ${pct} %</div>`;
        wohnungExtra = `<div class="cv-occupancy-bar"><div class="cv-occupancy-fill" style="width:${pct}%"></div></div>`;
    }

    // Kontostand-Karte
    let kontoVal, kontoSub = '';
    if (!buildingHash) {
        kontoVal = '–';
    } else if (!hasBuilding || buildingInfo.bankBalance === null) {
        kontoVal = '<span style="font-size:16px;color:var(--text-muted)">Lade…</span>';
    } else {
        kontoVal = `<span style="color:var(--green)">${cvFormatMoney(buildingInfo.bankBalance)}</span>`;
        if (buildingInfo.bankVban) kontoSub = `<div class="cv-stat-hint">${escapeHtml(buildingInfo.bankVban)}</div>`;
    }

    // Ablauf-Warnung
    const warnBadge = soon.length
        ? `<div class="cv-stat-warn-badge">⚠️ ${soon.length} Vertrag${soon.length > 1 ? 'e' : ''} läuft${soon.length > 1 ? 'en' : ''} bald ab</div>`
        : '';

    el.innerHTML = `
        <div class="cv-stats-row cv-stats-row-6">
            <div class="cv-stat-card">
                <div class="cv-stat-value">${active.length}</div>
                <div class="cv-stat-label">Aktive Verträge</div>
                ${warnBadge}
            </div>
            <div class="cv-stat-card">
                <div class="cv-stat-value">${cvFormatMoney(kaution)}</div>
                <div class="cv-stat-label">Kaution gehalten</div>
            </div>
            <div class="cv-stat-card" onclick="${buildingHash ? '' : 'openBuildingSettingsModal()'}" style="${buildingHash ? '' : 'cursor:pointer'}">
                <div class="cv-stat-value">${wohnungVal}</div>
                <div class="cv-stat-label">Freie Wohnungen</div>
                ${wohnungSub}
                ${wohnungExtra}
            </div>
            <div class="cv-stat-card">
                <div class="cv-stat-value">${kontoVal}</div>
                <div class="cv-stat-label">Kontostand</div>
                ${kontoSub}
            </div>
            <div class="cv-stat-card">
                <div class="cv-stat-value" style="color:${vFree>0?'var(--green)':'var(--red)'}">${vFree}<span style="font-size:16px;color:var(--text-muted)"> / ${vTotal}</span></div>
                <div class="cv-stat-label">Fahrzeuge frei</div>
                <div class="cv-stat-hint">${vRented} vermietet</div>
            </div>
            <div class="cv-stat-card">
                <div class="cv-stat-value" style="color:${fFree>0?'var(--green)':'var(--red)'}">${fFree}<span style="font-size:16px;color:var(--text-muted)"> / ${fTotal}</span></div>
                <div class="cv-stat-label">Firmen frei</div>
                <div class="cv-stat-hint">${fRented} verpachtet</div>
            </div>
        </div>`;

    // Startseite-Statistiken synchron halten
    if (typeof updateOverviewStats === 'function') updateOverviewStats();
}

// ── Gebäude-Hash konfigurieren ────────────────────────────────
function openBuildingSettingsModal() {
    cvOpenModal({
        title: '⚙ Gebäude konfigurieren',
        bodyHTML: `
            <div class="cv-form-group">
                <label class="cv-label">Gebäude-Hash</label>
                <input class="cv-input" id="inp-building-hash" type="text"
                       value="${escapeHtml(contractsData.buildingHash || '')}"
                       placeholder="z. B. PillboxHill_Flat_15">
                <div class="cv-form-hint">Den Hash findest du in der vAPI unter /building/list (Feld "hash").</div>
            </div>`,
        saveLabel: 'Speichern',
        onSave: async () => {
            const hash = document.getElementById('inp-building-hash')?.value?.trim() || '';
            cvModalBusy('Speichere…');
            try {
                await cvPost('save_setting', { key: 'buildingHash', value: hash });
                contractsData.buildingHash = hash;
                buildingInfo = null;
                cvCloseModal();
                renderContractsDashboard();
                if (hash) loadBuildingData();
            } catch(e) { cvModalErr(e.message); cvModalBusy(''); }
        },
    });
}

function cvKautionHtml(c) {
    if (!c.kaution) return '';
    var cid = c.id;
    var ks  = c.kautionStatus || null;
    var canEdit = PERMS.vertraegeEdit;
    if (!ks) {
        return canEdit
            ? '<div class="cv-kaution-row"><button class="cv-kaution-btn" onclick="cvToggleKaution(\'' + cid + '\',\'erhalten\')">💰 Kaution erhalten</button></div>'
            : '<div class="cv-kaution-row"><span class="cv-kaution-ret">Kaution noch offen</span></div>';
    }
    if (ks === 'erhalten') {
        return '<div class="cv-kaution-row"><span class="cv-kaution-ok">✓ Kaution erhalten (' + cvFormatMoney(c.kaution) + ')</span>'
            + (canEdit ? '<button class="cv-kaution-btn cv-kaution-btn-ret" onclick="cvToggleKaution(\'' + cid + '\',\'zurueck\')">↩ Kaution zurückgesendet</button>' : '')
            + '</div>';
    }
    return '<div class="cv-kaution-row"><span class="cv-kaution-ret">↩ Kaution zurückgesendet</span>'
        + (canEdit ? '<button class="cv-kaution-btn" onclick="cvToggleKaution(\'' + cid + '\',\'erhalten\')">💰 Erneut erhalten</button>' : '')
        + '</div>';
}

// ── Liste: Verträge ──────────────────────────────────────────
function renderContractsList() {
    const el = document.getElementById('contracts-list');
    if (!el) return;

    let list = (contractsData.contracts || []).filter(c => {
        const s = cvStatus(c);
        if (cvContractFilter !== 'all' && s !== cvContractFilter) return false;
        if (cvSearchQuery) {
            const hay = `${c.mieterName} ${c.mieterVban} ${(c.selectedFirmen||[]).map(f=>f.firmaName).join(' ')} ${(c.selectedVehicles||[]).map(v=>v.vehicleName).join(' ')}`.toLowerCase();
            if (!hay.includes(cvSearchQuery)) return false;
        }
        return true;
    }).sort((a, b) => {
        // Aktive zuerst, dann nach Enddatum aufsteigend
        const sa = cvStatus(a), sb = cvStatus(b);
        const order = { active:0, upcoming:1, expired:2, terminated:3 };
        if (order[sa] !== order[sb]) return order[sa] - order[sb];
        return (a.endDate || '9999').localeCompare(b.endDate || '9999');
    });

    if (!list.length) {
        el.innerHTML = '<div class="grid-card"><div class="info-text">Keine Verträge gefunden.</div></div>';
        return;
    }

    el.innerHTML = list.map(c => {
        const s       = cvStatus(c);
        const tColor  = TYPE_COLORS[c.type] || 'var(--text-muted)';
        const firmen  = c.selectedFirmen   || [];
        const veh     = c.selectedVehicles || [];
        const days    = c.endDate ? daysUntilEnd(c.endDate) : null;
        const expiring = days !== null && days <= 14 && days >= 0 && s === 'active';

        // Objekte als Badges
        const objektBadges = [
            ...firmen.map(f => `<span class="cv-obj-badge cv-obj-firma">🏭 ${escapeHtml(f.firmaName)}</span>`),
            ...veh.map(v   => '<span class="cv-obj-badge cv-obj-vehicle">🚗 ' + escapeHtml(v.vehicleName) + (v.kennzeichen ? ' <span class="cv-kennzeichen" style="font-size:10px">' + escapeHtml(v.kennzeichen) + '</span>' : '') + '</span>'),
        ].join('');

        // Positionsauflistung – kein Monatswert, Co-Mieter anzeigen
        const allItems = [
            ...firmen.map(f => ({ icon:'🏭', label: f.firmaName, tarif: f.tarifName, baseBetrag: f.baseBetrag ?? f.betrag, coMieter: f.coMieter || 0, betrag: f.betrag })),
            ...veh.map(v   => ({ icon:'🚗', label: v.vehicleName + (v.kennzeichen ? ` (${v.kennzeichen})` : ''), tarif: v.tarifName, baseBetrag: v.baseBetrag ?? v.betrag, coMieter: v.coMieter || 0, betrag: v.betrag })),
        ];

        // Nächste Fälligkeit pro Tarif-Gruppe (nur nicht-stündlich)
        const ORDER_T = ['Stündlich','Wöchentlich','Monatlich'];
        const tarifGroupsCard = {};
        allItems.forEach(i => { if (!tarifGroupsCard[i.tarif]) tarifGroupsCard[i.tarif] = []; tarifGroupsCard[i.tarif].push(i); });
        const tarifKeysCard = [...ORDER_T.filter(x => tarifGroupsCard[x]), ...Object.keys(tarifGroupsCard).filter(x => !ORDER_T.includes(x))];
        const allHourly = allItems.length > 0 && allItems.every(i => i.tarif === 'Stündlich');

        const dueDateRows = tarifKeysCard
            .filter(t => t !== 'Stündlich')
            .map(t => {
                const due = cvFirstDueDate(c.startDate, c.startTime, t);
                if (!due) return '';
                return '<div class="cv-meta-item"><span class="cv-meta-label">' + t + ' fällig</span><span>' + cvFormatDateTimeObj(due, c.startTime) + '</span></div>';
            }).join('');

        const posRows = allItems.map(item => {
            const kürzel  = cvTarifKürzel(item.tarif);
            const coTag   = item.coMieter > 0 ? ` <span style="color:var(--yellow);font-size:10px">+${item.coMieter} Co</span>` : '';
            return `<div class="cv-pos-row">
                <span class="cv-pos-icon">${item.icon}</span>
                <span class="cv-pos-label">${escapeHtml(item.label)}${coTag}</span>
                <span class="cv-pos-tarif">${escapeHtml(item.tarif)}</span>
                <span class="cv-pos-betrag">${cvFormatMoney(item.betrag)}/${kürzel}</span>
            </div>`;
        }).join('');

        const posTable = allItems.length
            ? `<div class="cv-pos-table">${posRows}</div>`
            : '';

        // Ablauf-Warnung
        const warnHtml = expiring
            ? `<div class="cv-expiry-warn">⚠️ Läuft in ${days} Tag${days === 1 ? '' : 'en'} ab!</div>`
            : (days !== null && days < 0 && s !== 'terminated' ? '<div class="cv-expiry-expired">Abgelaufen</div>' : '');

        // Verlängerungshistorie
        const renewals = (c.renewalHistory || []);
        const renewHtml = renewals.length
            ? `<div class="cv-renewal-info">🔄 ${renewals.length}× verlängert, zuletzt bis ${cvFormatDate(renewals.at(-1).newEndDate)}</div>`
            : '';

        const vNr = c.vertragsnummer || '';
        const kautionOffen = c.kaution > 0 && !c.kautionStatus;
        const rechnungOffen = !allHourly && (c.zahlungsstatus === 'offen' || c.zahlungsstatus === 'ueberfaellig' || !c.zahlungsstatus);
        const orangeFrame = s === 'active' && (kautionOffen || rechnungOffen);

        return `<div class="grid-card cv-contract-card${expiring ? ' cv-contract-expiring' : ''}${orangeFrame ? ' cv-contract-warn-frame' : ''}">
            <div class="cv-contract-header">
                <div class="cv-contract-badges">
                    ${vNr ? '<span class="cv-badge cv-badge-nr" title="Vertragsnummer">' + vNr + '</span>' : ''}
                    <span class="cv-badge" style="background:${tColor}">${escapeHtml(TYPE_LABELS[c.type] || c.type)}</span>
                    <span class="cv-badge" style="background:${cvStatusColor(s)}">${cvStatusLabel(s)}</span>
                    ${c.kooperationsrabatt ? '<span class="cv-badge cv-badge-koop">🤝 –15 % Kooperationsrabatt</span>' : ''}
                </div>
                <div class="cv-card-actions">
                    ${PERMS.vertraegeEdit ? `<button class="icon-btn" title="Bearbeiten"  onclick="openContractModal('${c.id}')">✏️</button>` : ''}
                    <button class="icon-btn" title="Vorschau"    onclick="openContractPreview('${c.id}')">👁</button>
                    ${PERMS.vertraegeEdit ? `
                    <button class="icon-btn" title="Verlängern"  onclick="openRenewalModal('${c.id}')">🔄</button>
                    <button class="icon-btn" title="Duplizieren" onclick="openDuplicateModal('${c.id}')">📋</button>
                    ${s !== 'terminated'
                        ? `<button class="icon-btn cv-terminate-btn" title="Kündigen" onclick="cvTerminateContract('${c.id}')">🚫</button>`
                        : ''}
                    <button class="icon-btn cv-del-btn" title="Löschen" onclick="cvDeleteContract('${c.id}')">🗑</button>
                    ` : ''}
                </div>
            </div>

            ${warnHtml}

            <div class="cv-contract-mieter">
                <span class="cv-mieter-name">${escapeHtml(c.mieterName)}</span>
                ${c.mieterVban ? '<button class="cv-vban-chip" onclick="navigator.clipboard.writeText(\'' + escapeHtml(c.mieterVban) + '\').then(()=>{this.textContent=\'✓ Kopiert\';setTimeout(()=>{this.textContent=\'' + escapeHtml(c.mieterVban) + '\'},1200)})" title="Klicken zum Kopieren">' + escapeHtml(c.mieterVban) + '</button>' : '<span class="cv-mieter-vban">–</span>'}
            </div>

            <div class="cv-obj-badges">${objektBadges || '<span class="text-muted" style="font-size:13px">Keine Objekte zugeordnet</span>'}</div>

            <div class="cv-contract-meta">
                <div class="cv-meta-item">
                    <span class="cv-meta-label">Mietbeginn</span>
                    <span>${cvFormatDate(c.startDate)}${c.startTime && c.startTime !== '00:00' ? ' ' + c.startTime + ' Uhr' : ''}</span>
                </div>
                <div class="cv-meta-item">
                    <span class="cv-meta-label">Kaution</span>
                    <span>${cvFormatMoney(c.kaution)}</span>
                </div>
                ${c.garage ? `<div class="cv-meta-item">
                    <span class="cv-meta-label">Garage</span>
                    <span>${escapeHtml(c.garage)}</span>
                </div>` : ''}
                ${dueDateRows}
                ${!allHourly ? `<div class="cv-meta-item">
                    <span class="cv-meta-label">Zahlung</span>
                    <span>
                        ${c.zahlungsstatus === 'bezahlt'
                            ? '<span style="color:var(--green);font-size:13px">✓ Rechnung beglichen</span>'
                            : (PERMS.vertraegeEdit
                                ? '<button class="cv-pay-done-btn" onclick="cvMarkPaid(\'' + c.id + '\')">✓ Rechnung beglichen</button>'
                                : '<span style="color:var(--text-muted);font-size:13px">Rechnung offen</span>')}
                    </span>
                </div>` : ''}
            </div>

            ${posTable}
            ${cvKautionHtml(c)}
            ${renewHtml}
        </div>`;
    }).join('');
}

// ── Liste: Vorlagen ──────────────────────────────────────────
function renderTemplatesList() {
    const el = document.getElementById('templates-list');
    if (!el) return;

    const list = [...(contractsData.templates || [])].sort((a,b) => a.name.localeCompare(b.name));
    if (!list.length) {
        el.innerHTML = '<div class="grid-card"><div class="info-text">Noch keine Vorlagen erstellt.</div></div>';
        return;
    }

    el.innerHTML = list.map(t => `
        <div class="grid-card">
            <div class="cv-card-head">
                <div>
                    <strong>${escapeHtml(t.name)}</strong>
                    <span class="cv-badge" style="background:${TYPE_COLORS[t.type] || 'var(--text-muted)'}; margin-left:8px">${escapeHtml(TYPE_LABELS[t.type] || t.type)}</span>
                </div>
                <div class="cv-card-actions">
                    ${PERMS.vorlagenEdit ? `
                    <button class="icon-btn" onclick="openTemplateModal('${t.id}')">✏️</button>
                    <button class="icon-btn cv-del-btn" onclick="cvDeleteTemplate('${t.id}')">🗑</button>
                    ` : ''}
                </div>
            </div>
            <div class="cv-card-body">
                <div class="cv-template-preview">${escapeHtml((t.text || '').slice(0,200))}${(t.text||'').length > 200 ? '…' : ''}</div>
            </div>
        </div>`).join('');
}

// ── Liste: Fahrzeuge ─────────────────────────────────────────
function renderVehiclesList() {
    const el = document.getElementById('vehicles-list');
    if (!el) return;

    const list = contractsData.vehicles || [];

    if (!list.length) {
        el.innerHTML = '<div class="grid-card"><div class="info-text">Noch keine Fahrzeuge eingetragen.</div></div>';
        return;
    }

    const hasCats = list.some(v => (v.kategorie || '').trim());

    // Kategorie-Filter zurücksetzen falls Kategorie nicht mehr existiert
    if (vehicleCatFilter && !list.some(v => (v.kategorie || '').trim() === vehicleCatFilter)) {
        vehicleCatFilter = '';
    }

    // Filter-Chips (nur wenn mind. eine Kategorie vergeben)
    let chipsHtml = '';
    if (hasCats) {
        const cats     = [...new Set(list.map(v => (v.kategorie || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
        const allChip  = '<button class="vc-cat-chip' + (!vehicleCatFilter ? ' vc-cat-active' : '') + '" onclick="setVehicleCatFilter(\'\')">Alle</button>';
        const catChips = cats.map(c =>
            '<button class="vc-cat-chip' + (vehicleCatFilter === c ? ' vc-cat-active' : '') + '" onclick="setVehicleCatFilter(' + JSON.stringify(c) + ')">'
            + escapeHtml(c) + '</button>'
        ).join('');
        chipsHtml = '<div class="vc-cat-bar">' + allChip + catChips + '</div>';
    }

    // Gefilterte + sortierte Fahrzeuge gruppieren
    const filtered = vehicleCatFilter
        ? sortVehiclesByCat(list.filter(v => (v.kategorie || '').trim() === vehicleCatFilter))
        : null; // bei "Alle" → groupVehiclesByCat übernimmt Sortierung

    const groups = filtered
        ? [{ label: vehicleCatFilter, items: filtered }]
        : groupVehiclesByCat(list);

    const activeContracts = getActiveContracts();

    function renderVehicleCard(v) {
        const menge     = v.menge || 1;
        const usedCount = activeContracts.reduce((s, c) =>
            s + (c.selectedVehicles || []).filter(sv => sv.vehicleId === v.id).length, 0);
        const avail     = menge - usedCount;
        const allRented = avail <= 0;
        const tarife    = (v.tarife || []).map(t =>
            '<span class="cv-tarif-chip">' + escapeHtml(t.name) + ': ' + cvFormatMoney(t.betrag) + '</span>'
        ).join('');
        const mieterInfo = activeContracts
            .filter(c => (c.selectedVehicles || []).some(sv => sv.vehicleId === v.id))
            .map(ct => '<div class="cv-rented-by">Vermietet an: <strong>' + escapeHtml(ct.mieterName)
                + '</strong> (' + escapeHtml(ct.mieterVban || '–') + ')</div>')
            .join('');
        const availBadge = allRented
            ? '<span class="cv-badge" style="background:var(--red)">Kein freier Bestand</span>'
            : (menge > 1
                ? '<span class="cv-badge" style="background:var(--green)">' + avail + '/' + menge + ' verfügbar</span>'
                : '<span class="cv-badge" style="background:var(--green)">Verfügbar</span>');
        const katBadge = v.kategorie
            ? '<span class="vc-kat-badge">' + escapeHtml(v.kategorie) + '</span>'
            : '';
        const kzArr  = Array.isArray(v.kennzeichen) ? v.kennzeichen.filter(Boolean) : (v.kennzeichen ? [v.kennzeichen] : []);
        const kzHtml = kzArr.map(kz => '<span class="cv-kennzeichen">' + escapeHtml(kz) + '</span>').join('');
        return '<div class="grid-card' + (allRented ? ' cv-card-rented' : '') + '">'
            + '<div class="cv-card-head">'
            + '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'
            + '<strong>' + escapeHtml(v.name) + '</strong>'
            + kzHtml + katBadge
            + (v.isTrailer ? '<span class="cv-badge" style="background:var(--yellow)">Trailer</span>' : '')
            + availBadge
            + '</div>'
            + '<div class="cv-card-actions">'
            + (PERMS.fahrzeugeEdit ? '<button class="icon-btn" onclick="openVehicleModal(\'' + v.id + '\')">✏️</button>'
            + '<button class="icon-btn cv-del-btn" onclick="cvDeleteVehicle(\'' + v.id + '\')">🗑</button>' : '')
            + '</div></div>'
            + '<div class="cv-card-body">'
            + mieterInfo
            + '<div class="cv-tarife-row" style="margin-top:6px">' + (tarife || '<span class="text-muted">Keine Tarife hinterlegt</span>') + '</div>'
            + (v.kaution ? '<div class="cv-card-row" style="color:var(--text-muted);margin-top:4px">Kaution: ' + cvFormatMoney(v.kaution) + '</div>' : '')
            + '</div></div>';
    }

    // Kategorie-Gruppen rendern (bei "Alle" mit Überschriften, bei Filter ohne)
    const showHeaders = !vehicleCatFilter && hasCats;
    const cardsHtml = groups.map(g => {
        const header = showHeaders
            ? '<div class="vc-cat-header">' + escapeHtml(g.label || 'Ohne Kategorie') + '</div>'
            : '';
        return header + g.items.map(renderVehicleCard).join('');
    }).join('') || '<div class="grid-card"><div class="info-text">Keine Fahrzeuge in dieser Kategorie.</div></div>';

    el.innerHTML = chipsHtml + cardsHtml;
}

function setVehicleCatFilter(cat) {
    vehicleCatFilter = cat;
    renderVehiclesList();
}

// ── Liste: Firmenkonfiguration ───────────────────────────────
function renderFirmSettingsList() {
    const el = document.getElementById('firm-settings-list');
    if (!el) return;

    const list = contractsData.firmConfigs || [];

    const addBtn = PERMS.firmenEdit ? `<div style="margin-bottom:16px">
        <button class="hero-btn" type="button" onclick="openFirmConfigModal(null)">➕ Firma hinzufügen</button>
    </div>` : '';

    if (!list.length) {
        el.innerHTML = addBtn + '<div class="grid-card"><div class="info-text">Noch keine Firmen konfiguriert. Füge deine Firmen mit dem Button oben hinzu.</div></div>';
        return;
    }

    el.innerHTML = addBtn + list.map(fc => {
        const menge     = fc.menge || 1;
        const usedCount = getActiveContracts().reduce((s, c) => s + (c.selectedFirmen||[]).filter(sf => sf.firmaId === fc.id).length, 0);
        const avail     = menge - usedCount;
        const allRented = avail <= 0;
        const tarife    = (fc.tarife || []).map(t =>
            '<span class="cv-tarif-chip">' + escapeHtml(t.name) + ': ' + cvFormatMoney(t.betrag) + '</span>'
        ).join('');

        const contracts  = getActiveContracts().filter(c => (c.selectedFirmen||[]).some(sf => sf.firmaId === fc.id));
        const mieterInfo = contracts.map(ct =>
            '<div class="cv-rented-by">Verpachtet an: <strong>' + escapeHtml(ct.mieterName) + '</strong> (' + escapeHtml(ct.mieterVban || '–') + ')</div>'
        ).join('');

        const availBadge = allRented
            ? '<span class="cv-badge" style="background:var(--red)">Kein freier Bestand</span>'
            : (menge > 1
                ? '<span class="cv-badge" style="background:var(--green)">' + avail + '/' + menge + ' verfügbar</span>'
                : '<span class="cv-badge" style="background:var(--green)">Verfügbar</span>');

        return '<div class="grid-card' + (allRented ? ' cv-card-rented' : '') + '">'
            + '<div class="cv-card-head">'
            + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
            + '<strong>' + escapeHtml(fc.name) + '</strong>'
            + availBadge
            + '</div>'
            + '<div class="cv-card-actions">'
            + (PERMS.firmenEdit ? '<button class="icon-btn" onclick="openFirmConfigModal(\'' + fc.id + '\')">✏️</button>'
            + '<button class="icon-btn cv-del-btn" onclick="cvDeleteFirmConfig(\'' + fc.id + '\')">🗑</button>' : '')
            + '</div></div>'
            + '<div class="cv-card-body">'
            + mieterInfo
            + '<div class="cv-tarife-row" style="margin-top:6px">' + (tarife || '<span class="text-muted">Keine Tarife hinterlegt</span>') + '</div>'
            + (fc.kaution ? '<div class="cv-card-row" style="color:var(--text-muted);margin-top:4px">Kaution: ' + cvFormatMoney(fc.kaution) + '</div>' : '')
            + '</div></div>';
    }).join('');
}

// ── Modal: Vertrag anlegen / bearbeiten ──────────────────────
function openContractModal(id) {
    const existing = id ? (contractsData.contracts || []).find(c => c.id === id) : null;
    const c        = existing || {};

    // Templates gruppiert nach Typ
    const byType = {};
    (contractsData.templates || []).forEach(t => {
        if (!byType[t.type]) byType[t.type] = [];
        byType[t.type].push(t);
    });
    const templateOptions = Object.entries(byType).map(([type, tpls]) =>
        `<optgroup label="${escapeHtml(CONTRACT_TYPES[type] || type)}">
            ${tpls.map(t => `<option value="${t.id}"${c.templateId===t.id?' selected':''}>${escapeHtml(t.name)}</option>`).join('')}
        </optgroup>`
    ).join('');

    // Bankkonten — Hotel-Konto als Standard
    const accounts  = typeof window.bankAccounts !== 'undefined' ? window.bankAccounts : [];
    const defaultVban = c.einnahmeKontoVban
        || (typeof window.buildingBankVban !== 'undefined' ? window.buildingBankVban : '')
        || (accounts.length ? accounts[0].vban : '');
    const kontoOpts = accounts.map(a =>
        '<option value="' + escapeHtml(a.vban) + '"' + (defaultVban === a.vban ? ' selected' : '') + '>'
        + escapeHtml(a.label || a.vban) + ' (' + escapeHtml(a.vban) + ')</option>'
    ).join('');

    // Co-Mieter-Optionen für eine Zeile bauen
    function buildCoMieterOpts(type, selectedCount) {
        const max = CO_MIETER_MAX[type];
        let html  = `<option value="0"${selectedCount===0?' selected':''}>Keine weiteren Personen</option>`;
        for (let i = 1; i <= max; i++) {
            html += `<option value="${i}"${selectedCount===i?' selected':''}>${i} Co-${type==='pacht'?'Mitnutzer':'Mitmieter'}</option>`;
        }
        return html;
    }

    // Hilfsfunktion: Wie oft ist ein Item schon in aktiven Verträgen (excl. aktuellen)?
    function usedInContracts(type, itemId) {
        return (contractsData.contracts || [])
            .filter(cx => cx.id !== c.id && cvStatus(cx) !== 'terminated')
            .filter(cx => type === 'firma'
                ? (cx.selectedFirmen   || []).some(sf => sf.firmaId   === itemId)
                : (cx.selectedVehicles || []).some(sv => sv.vehicleId === itemId)
            ).length;
    }

    // Firmen aus manueller Konfiguration
    const firmConfigs = contractsData.firmConfigs || [];
    const firmenRows  = firmConfigs.map(fc => {
        const tarife = (fc.tarife || []).filter(t => t.name !== 'Stündlich' && t.name !== 'Täglich');
        if (!tarife.length) return '';
        const sel      = (c.selectedFirmen || []).find(sf => sf.firmaId === fc.id);
        const coM      = sel?.coMieter || 0;
        const menge    = fc.menge || 1;
        const used     = usedInContracts('firma', fc.id);
        const avail    = menge - used;
        const disabled = !sel && avail <= 0;
        const opts     = tarife.map((t,i) =>
            `<option value="${i}"${sel && sel.tarifName===t.name?' selected':''}>${escapeHtml(t.name)} – ${cvFormatMoney(t.betrag)}</option>`
        ).join('');
        const availColor = avail > 0 ? 'var(--green)' : 'var(--red)';
        const availText  = menge > 1 ? (avail + '/' + menge + ' frei') : (avail > 0 ? 'Verfügbar' : 'Vergeben');
        const availTag   = ' <span style="font-size:10px;color:' + availColor + '">' + availText + '</span>';
        return `<div class="cv-item-block${disabled?' cv-item-disabled':''}">
            <label class="cv-item-row">
                <input type="checkbox" class="cv-firma-cb"
                    data-id="${escapeHtml(fc.id)}"
                    data-name="${escapeHtml(fc.name).replace(/"/g,'&quot;')}"
                    ${sel?' checked':''}${disabled?' disabled':''}>
                <span class="cv-item-label">${escapeHtml(fc.name)}${availTag}</span>
                <select class="cv-tarif-sel" data-for-firma="${escapeHtml(fc.id)}"${disabled?' disabled':''}>${opts}</select>
            </label>
            <div class="cv-comieter-row">
                <label class="cv-comieter-label">Co-Mitnutzer (Pacht, max. ${CO_MIETER_MAX.pacht})</label>
                <select class="cv-comieter-sel" data-for-firma="${escapeHtml(fc.id)}"${disabled?' disabled':''}>${buildCoMieterOpts('pacht', coM)}</select>
            </div>
            <div class="cv-item-tax-note">Der Mieter ist für die Zahlung der täglichen Firmensteuer verantwortlich.</div>
        </div>`;
    }).filter(Boolean).join('');

    // Fahrzeuge — nach Kategorie A–Z sortiert und gruppiert
    function buildVehicleRow(v) {
        const tarife = (v.tarife || []).filter(t => t.name !== 'Täglich');
        if (!tarife.length) return '';
        const sel      = (c.selectedVehicles || []).find(sv => sv.vehicleId === v.id);
        const coM      = sel?.coMieter || 0;
        const menge    = v.menge || 1;
        const used     = usedInContracts('vehicle', v.id);
        const avail    = menge - used;
        const disabled = !sel && avail <= 0;
        const opts     = tarife.map((t,i) =>
            `<option value="${i}"${sel && sel.tarifName===t.name?' selected':''}>${escapeHtml(t.name)} – ${cvFormatMoney(t.betrag)}</option>`
        ).join('');
        const trailerBadge = v.isTrailer ? '<span class="cv-badge" style="background:var(--yellow);font-size:10px">Trailer</span>' : '';
        const kzArr        = Array.isArray(v.kennzeichen) ? v.kennzeichen : (v.kennzeichen ? [v.kennzeichen] : []);
        const vAvailColor  = avail > 0 ? 'var(--green)' : 'var(--red)';

        if (menge === 1) {
            const kz0      = kzArr[0] || '';
            const kzBadge  = kz0 ? '<span class="cv-kennzeichen" style="font-size:11px">' + escapeHtml(kz0) + '</span>' : '';
            const availTag = ' <span style="font-size:10px;color:' + vAvailColor + '">' + (avail > 0 ? 'Verfügbar' : 'Vergeben') + '</span>';
            return '<div class="cv-item-block' + (disabled ? ' cv-item-disabled' : '') + '">'
                + '<label class="cv-item-row">'
                + '<input type="checkbox" class="cv-vehicle-cb" data-id="' + v.id + '" data-name="' + escapeHtml(v.name).replace(/"/g,'&quot;') + '" data-kz="' + escapeHtml(kz0) + '" data-trailer="' + (v.isTrailer?'1':'0') + '"' + (sel?' checked':'') + (disabled?' disabled':'') + '>'
                + '<span class="cv-item-label">' + escapeHtml(v.name) + ' ' + kzBadge + availTag + ' ' + trailerBadge + '</span>'
                + '<select class="cv-tarif-sel" data-for-vehicle="' + v.id + '"' + (disabled?' disabled':'') + '>' + opts + '</select>'
                + '</label>'
                + '<div class="cv-comieter-row"><label class="cv-comieter-label">Co-Mitmieter (Miete, max. ' + CO_MIETER_MAX.miete + ')</label>'
                + '<select class="cv-comieter-sel" data-for-vehicle="' + v.id + '"' + (disabled?' disabled':'') + '>' + buildCoMieterOpts('miete', coM) + '</select></div>'
                + '</div>';
        }

        // menge > 1: je Einheit eine eigene Checkbox
        const usedIds = (contractsData.contracts || [])
            .filter(cx => cx.id !== c.id && cvStatus(cx) !== 'terminated')
            .flatMap(cx => (cx.selectedVehicles || []).filter(sv => sv.vehicleId === v.id).map((_, idx) => idx));
        const selSlots = (c.selectedVehicles || []).filter(sv => sv.vehicleId === v.id).map(sv => sv.slotIndex ?? 0);

        let slots = '';
        for (let i = 0; i < menge; i++) {
            const slotUsed  = usedIds.includes(i) && !selSlots.includes(i);
            const slotSel   = selSlots.includes(i);
            const kzI       = kzArr[i] || '';
            const kzBadge   = kzI ? '<span class="cv-kennzeichen" style="font-size:11px">' + escapeHtml(kzI) + '</span>' : '';
            const tag       = '<span style="font-size:10px;color:' + (slotUsed ? 'var(--red)' : 'var(--green)') + '">' + (slotUsed ? 'Vergeben' : 'Frei') + '</span>';
            slots += '<label class="cv-item-row' + (slotUsed ? ' cv-item-disabled' : '') + '">'
                + '<input type="checkbox" class="cv-vehicle-cb" data-id="' + v.id + '" data-slot="' + i + '" data-name="' + escapeHtml(v.name).replace(/"/g,'&quot;') + '" data-kz="' + escapeHtml(kzI) + '" data-trailer="' + (v.isTrailer?'1':'0') + '"' + (slotSel?' checked':'') + (slotUsed?' disabled':'') + '>'
                + '<span class="cv-item-label">Einheit ' + (i+1) + ' ' + kzBadge + ' ' + tag + '</span>'
                + '</label>';
        }
        return '<div class="cv-item-block">'
            + '<div style="font-weight:600;margin-bottom:6px">' + escapeHtml(v.name) + ' ' + trailerBadge
            + ' <span style="font-size:10px;color:' + vAvailColor + '">' + avail + '/' + menge + ' frei</span></div>'
            + slots
            + '<div style="margin-top:6px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">'
            + '<select class="cv-tarif-sel" data-for-vehicle="' + v.id + '">' + opts + '</select>'
            + '<select class="cv-comieter-sel" data-for-vehicle="' + v.id + '">' + buildCoMieterOpts('miete', coM) + '</select>'
            + '</div></div>';
    }

    const allVehicles = contractsData.vehicles || [];
    const hasCategorizedVehicles = allVehicles.some(v => (v.kategorie || '').trim());
    const vehicleGroups = groupVehiclesByCat(allVehicles);
    const vehicleRows = vehicleGroups.map(g => {
        const rows = g.items.map(buildVehicleRow).filter(Boolean).join('');
        if (!rows) return '';
        const header = hasCategorizedVehicles
            ? '<div class="vc-cat-header vc-cat-header-modal">' + escapeHtml(g.label || 'Ohne Kategorie') + '</div>'
            : '';
        return header + rows;
    }).join('');

    const typeOpts = Object.entries(CONTRACT_TYPES).map(([k,l]) =>
        `<option value="${k}"${(c.type||'vermietung')===k?' selected':''}>${l}</option>`
    ).join('');

    const body = `
    <div class="cv-form-sections">

        <div class="cv-section">
            <div class="cv-section-title">📄 Vertragsvorlage</div>
            <select class="form-control" id="cf-template">
                <option value="">– Keine Vorlage –</option>
                ${templateOptions || '<option disabled>Noch keine Vorlagen vorhanden</option>'}
            </select>
        </div>

        <div class="cv-section">
            <div class="cv-section-title">👤 Mieter / Pächter</div>
            <div class="cv-form-row">
                <div class="cv-form-col">
                    <label class="cv-label">Vollständiger Name</label>
                    <input class="form-control" id="cf-name" type="text" placeholder="Vor- und Nachname" value="${escapeHtml(c.mieterName||'')}">
                </div>
                <div class="cv-form-col">
                    <label class="cv-label">VBAN (z. B. VB123456)</label>
                    <input class="form-control" id="cf-vban" type="text" placeholder="VB123456" maxlength="12" value="${escapeHtml(c.mieterVban||'')}">
                </div>
            </div>
        </div>

        <div class="cv-section">
            <div class="cv-section-title">📅 Mietbeginn</div>
            <div class="cv-form-row">
                <div class="cv-form-col">
                    <label class="cv-label">Beginn (Datum)</label>
                    <input class="form-control" id="cf-start" type="date" value="${escapeHtml(c.startDate||'')}">
                </div>
                <div class="cv-form-col">
                    <label class="cv-label">Uhrzeit (optional)</label>
                    <input class="form-control" id="cf-time" type="time" value="${escapeHtml(c.startTime||'00:00')}">
                </div>
            </div>
        </div>

        <div class="cv-section">
            <div class="cv-section-title">💳 Zahlungsdetails</div>
            <div class="cv-form-row">
                <div class="cv-form-col">
                    <label class="cv-label">Einnahme-Konto</label>
                    ${kontoOpts
                        ? `<select class="form-control" id="cf-konto">${kontoOpts}</select>`
                        : `<input class="form-control" id="cf-konto" type="text" placeholder="VB123456" value="${escapeHtml(c.einnahmeKontoVban||'')}">`}
                </div>
                <div class="cv-form-col">
                    <label class="cv-label">Vertragstyp</label>
                    <select class="form-control" id="cf-type">${typeOpts}</select>
                </div>
            </div>
        </div>

        ${firmenRows ? `
        <div class="cv-section">
            <div class="cv-section-title">🏭 Firmen auswählen</div>
            <div class="cv-items-list" id="cf-firmen">${firmenRows}</div>
        </div>` : ''}

        ${vehicleRows ? `
        <div class="cv-section">
            <div class="cv-section-title">🚗 Fahrzeuge auswählen</div>
            <div class="cv-items-list" id="cf-vehicles">${vehicleRows}</div>
        </div>` : ''}

        <div class="cv-section">
            <div class="cv-section-title">🏠 Abstellplatz / Garage</div>
            <input class="form-control" id="cf-garage" type="text" placeholder="z. B. Garage Nord, Stellplatz 4" value="${escapeHtml(c.garage||'')}">
        </div>

        <div class="cv-section">
            <div class="cv-section-title">💰 Kostenübersicht</div>
            <div id="cf-cost-preview" class="cv-cost-box">Nach Auswahl von Objekten wird hier die Summe berechnet.</div>
            <div class="cv-form-row" style="margin-top:10px">
                <div class="cv-form-col">
                    <label class="cv-label">Kaution ($) <span style="color:var(--text-muted);font-weight:400">(wird automatisch aus Einzelkautionen berechnet)</span></label>
                    <input class="form-control" id="cf-kaution" type="number" min="0" step="100" placeholder="0" value="${escapeHtml(String(c.kaution||0))}">
                </div>
            </div>
        </div>

        <div class="cv-section">
            <div class="cv-section-title">📝 Notizen (intern)</div>
            <textarea class="form-control" id="cf-notes" rows="3" placeholder="Interne Notizen…">${escapeHtml(c.notes||'')}</textarea>
        </div>

    </div>`;

    cvOpenModal({
        title:    id ? 'Vertrag bearbeiten' : 'Neuer Vertrag',
        bodyHTML: body,
        wide:     true,
        saveLabel:'Vertrag speichern',
        onSave:   () => saveContractFromModal(id),
    });

    // Live-Kostenübersicht – Co-Mieter-Aufschlag + Koop-Rabatt, kein Monatswert
    function updateCostPreview() {
        const sfData = getSelectedFirmen();
        const svData = getSelectedVehicles();
        const type   = document.getElementById('cf-type')?.value;
        const isKoop = type === 'kooperation' && sfData.length > 0 && svData.length > 0;

        if (!sfData.length && !svData.length) {
            document.getElementById('cf-cost-preview').innerHTML =
                '<span style="color:var(--text-muted)">Nach Auswahl von Objekten erscheint hier die Aufstellung.</span>';
            return;
        }

        const allItems = [
            ...sfData.map(f => ({ icon:'🏭', kind:'pacht', label: f.firmaName, tarif: f.tarifName, baseBetrag: f.baseBetrag, coMieter: f.coMieter, betrag: f.betrag })),
            ...svData.map(v => ({ icon:'🚗', kind:'miete', label: v.vehicleName + (v.kennzeichen ? ` (${v.kennzeichen})` : ''), tarif: v.tarifName, baseBetrag: v.baseBetrag, coMieter: v.coMieter, betrag: v.betrag })),
        ];

        const ORDER = ['Stündlich','Wöchentlich','Monatlich'];
        const groups = {};
        allItems.forEach(i => { if (!groups[i.tarif]) groups[i.tarif] = []; groups[i.tarif].push(i); });
        const keys = [...ORDER.filter(x => groups[x]), ...Object.keys(groups).filter(x => !ORDER.includes(x))];

        let html = '';
        keys.forEach(tarif => {
            const items = groups[tarif];
            html += `<div class="cv-cost-group-hd">${escapeHtml(tarif)}</div>`;
            let groupRaw = 0;
            items.forEach(item => {
                groupRaw += item.betrag;
                const coTag = item.coMieter > 0 ? ` <span style="color:var(--yellow);font-size:11px">+${item.coMieter} Co</span>` : '';
                html += `<div class="cv-cost-row"><span>${item.icon} ${escapeHtml(item.label)}${coTag}</span><span>${cvFormatMoney(item.betrag)}/${cvTarifKürzel(tarif)}</span></div>`;
                if (item.coMieter > 0) {
                    const factor = (1 + item.coMieter * cvCoMieterRate(item.kind, tarif)).toFixed(2);
                    html += `<div class="cv-cost-row" style="opacity:.6;font-size:11px"><span style="padding-left:18px">Basis ${cvFormatMoney(item.baseBetrag)} × ${factor}</span></div>`;
                }
            });
            if (items.length > 1) {
                html += `<div class="cv-cost-row cv-cost-subtotal"><span>Summe ${escapeHtml(tarif)}</span><span>${cvFormatMoney(groupRaw)}/${cvTarifKürzel(tarif)}</span></div>`;
            }
            if (isKoop) {
                const disc = groupRaw * 0.15;
                html += `<div class="cv-cost-row" style="color:var(--green)"><span>🤝 Kooperationsrabatt (−15 %)</span><span>–${cvFormatMoney(disc)}/${cvTarifKürzel(tarif)}</span></div>`;
                html += `<div class="cv-cost-row cv-cost-total"><span>Netto ${escapeHtml(tarif)}</span><span>${cvFormatMoney(groupRaw - disc)}/${cvTarifKürzel(tarif)}</span></div>`;
            }
        });

        document.getElementById('cf-cost-preview').innerHTML = html;

        // Auto-Kaution
        if (!existing) {
            let kautionSum = 0;
            sfData.forEach(f => { kautionSum += Number((contractsData.firmConfigs||[]).find(x => x.id === f.firmaId)?.kaution) || 0; });
            svData.forEach(v => { kautionSum += Number((contractsData.vehicles||[]).find(x => x.id === v.vehicleId)?.kaution) || 0; });
            if (kautionSum > 0) document.getElementById('cf-kaution').value = kautionSum;
        }
    }

    document.getElementById('cv-modal-bd')?.addEventListener('change', updateCostPreview);
    updateCostPreview();
}

function getSelectedFirmen() {
    const data = [];
    document.querySelectorAll('.cv-firma-cb:checked').forEach(cb => {
        const fid   = cb.dataset.id;
        const fname = cb.dataset.name;
        const selEl = document.querySelector(`.cv-tarif-sel[data-for-firma="${fid}"]`);
        const tidx  = parseInt(selEl?.value ?? '0', 10);
        const fc    = (contractsData.firmConfigs || []).find(x => x.id === fid);
        const tarif = (fc?.tarife || [])[tidx];
        if (!tarif) return;
        const coM   = parseInt(document.querySelector(`.cv-comieter-sel[data-for-firma="${fid}"]`)?.value ?? '0', 10);
        const rate  = cvCoMieterRate('pacht', tarif.name);
        const betrag = tarif.betrag * (1 + coM * rate);
        data.push({ firmaId: fid, firmaName: fname, tarifName: tarif.name, baseBetrag: tarif.betrag, coMieter: coM, betrag });
    });
    return data;
}

function getSelectedVehicles() {
    const data = [];
    const seenVehicles = new Set();
    document.querySelectorAll('.cv-vehicle-cb:checked').forEach(cb => {
        const vid     = cb.dataset.id;
        const vname   = cb.dataset.name;
        const kz      = cb.dataset.kz;
        const trailer = cb.dataset.trailer === '1';
        const slot    = cb.dataset.slot !== undefined ? parseInt(cb.dataset.slot, 10) : 0;
        const selEl   = document.querySelector('.cv-tarif-sel[data-for-vehicle="' + vid + '"]');
        const tidx    = parseInt(selEl?.value ?? '0', 10);
        const vObj    = (contractsData.vehicles||[]).find(v => v.id === vid);
        const tarif   = (vObj?.tarife || [])[tidx];
        if (!tarif) return;
        const coM    = parseInt(document.querySelector('.cv-comieter-sel[data-for-vehicle="' + vid + '"]')?.value ?? '0', 10);
        const rate   = cvCoMieterRate('miete', tarif.name);
        const betrag = tarif.betrag * (1 + coM * rate);
        // Für menge=1 nur einmal hinzufügen; für menge>1 jeden Slot
        const key = vid + ':' + slot;
        if (seenVehicles.has(key)) return;
        seenVehicles.add(key);
        data.push({ vehicleId: vid, vehicleName: vname, kennzeichen: kz, slotIndex: slot, isTrailer: trailer, tarifName: tarif.name, baseBetrag: tarif.betrag, coMieter: coM, betrag });
    });
    return data;
}

async function saveContractFromModal(id) {
    const name   = document.getElementById('cf-name')?.value.trim();
    const vban   = document.getElementById('cf-vban')?.value.trim();
    const start  = document.getElementById('cf-start')?.value;
    const time   = document.getElementById('cf-time')?.value  || '00:00';
    const end    = document.getElementById('cf-end')?.value   || '';
    const konto  = document.getElementById('cf-konto')?.value || '';
    const type   = document.getElementById('cf-type')?.value  || 'vermietung';
    const garage = document.getElementById('cf-garage')?.value.trim() || '';
    const kaution= parseFloat(document.getElementById('cf-kaution')?.value) || 0;
    const notes  = document.getElementById('cf-notes')?.value.trim() || '';
    const tmpl   = document.getElementById('cf-template')?.value || null;

    if (!name)  return cvModalErr('Mietername ist Pflicht.');
    if (!vban)  return cvModalErr('VBAN ist Pflicht.');
    if (!start) return cvModalErr('Startdatum ist Pflicht.');

    const sfData = getSelectedFirmen();
    const svData = getSelectedVehicles();
    const isKoop = type === 'kooperation' && sfData.length > 0 && svData.length > 0;

    // gesamtbetrag = monatlich normalisierte Summe aller Positionen (für Sortierung/Vergleich)
    let subtotal = 0;
    sfData.forEach(f => subtotal += cvMonthlyValue(f.tarifName, f.betrag));
    svData.forEach(v => subtotal += cvMonthlyValue(v.tarifName, v.betrag));
    if (isKoop) subtotal *= 0.85;

    cvModalBusy('Speichern…');
    try {
        await cvPost('save_contract', {
            id, type, status: 'active',
            templateId: tmpl, mieterName: name, mieterVban: vban,
            startDate: start, startTime: time, endDate: end,
            einnahmeKontoVban: konto, garage, kaution,
            selectedFirmen: sfData, selectedVehicles: svData,
            kooperationsrabatt: isKoop, gesamtbetrag: subtotal, notes,
        });
        await loadContractsData();
        cvCloseModal();
        renderContractsList();
    } catch (e) {
        cvModalBusy('');
        cvModalErr(e.message);
    }
}

// ── Modal: Vertragsvorschau ──────────────────────────────────
function openContractPreview(id) {
    const c = (contractsData.contracts || []).find(x => x.id === id);
    if (!c) return;

    const tmpl = (contractsData.templates || []).find(t => t.id === c.templateId);
    let text = buildContractListing(c);
    if (tmpl) text += cvFillVars(tmpl.text, c) + '\n';
    text += buildLegalClauses(c);

    const nr = c.vertragsnummer ? ` · Vertrag #${c.vertragsnummer}` : '';
    cvOpenModal({
        title:    `Vertragsvorschau – ${c.mieterName}${nr}`,
        bodyHTML: `
            <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
                <button class="btn btn-sm" id="cv-copy-btn" onclick="cvCopyContractText()">📋 Text kopieren</button>
            </div>
            <pre class="cv-preview-text" id="cv-preview-text">${escapeHtml(text)}</pre>`,
        noFooter: true,
        wide:     true,
    });
}

function cvCopyContractText() {
    const el  = document.getElementById('cv-preview-text');
    const btn = document.getElementById('cv-copy-btn');
    if (!el) return;
    const done = () => { if (btn) { btn.textContent = '✓ Kopiert!'; setTimeout(() => { btn.textContent = '📋 Text kopieren'; }, 2500); } };
    if (navigator.clipboard) {
        navigator.clipboard.writeText(el.textContent).then(done).catch(() => {});
    } else {
        const ta = document.createElement('textarea');
        ta.value = el.textContent;
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        done();
    }
}

// ── Modal: Verlängerung ──────────────────────────────────────
function openRenewalModal(id) {
    const c = (contractsData.contracts || []).find(x => x.id === id);
    if (!c) return;

    cvOpenModal({
        title:    `Vertrag verlängern – ${c.mieterName}`,
        bodyHTML: `
        <div class="cv-form-sections">
            <div class="cv-section">
                <div class="cv-card-row">Aktuelles Ende: <strong>${cvFormatDate(c.endDate) || 'Unbefristet'}</strong></div>
                <label class="cv-label" style="margin-top:12px">Neues Enddatum</label>
                <input class="form-control" id="ren-end" type="date" value="${escapeHtml(c.endDate||'')}">
            </div>
        </div>`,
        saveLabel: 'Verlängern',
        onSave: async () => {
            const newEnd = document.getElementById('ren-end')?.value || '';
            cvModalBusy('Speichern…');
            try {
                await cvPost('save_contract', { ...c, endDate: newEnd });
                await loadContractsData();
                cvCloseModal();
                renderContractsList();
            } catch(e) { cvModalBusy(''); cvModalErr(e.message); }
        },
    });
}

// ── Kündigen: setzt Status auf terminated ────────────────────
async function cvTerminateContract(id) {
    if (!confirm('Vertrag wirklich kündigen? Der Vertrag bleibt als "Beendet" gespeichert.')) return;
    const c = (contractsData.contracts||[]).find(x => x.id === id);
    if (!c) return;
    try {
        await cvPost('save_contract', { ...c, status: 'terminated' });
        await loadContractsData();
        renderContractsDashboard();
        renderContractsList();
        renderVehiclesList();
        renderFirmSettingsList();
    } catch(e) { alert('Fehler: ' + e.message); }
}

// ── Zahlungsstatus durchschalten ──────────────────────────────
async function cvToggleKaution(id, newStatus) {
    const c = (contractsData.contracts||[]).find(x => x.id === id);
    if (!c) return;
    try {
        await cvPost('save_contract', { ...c, kautionStatus: newStatus });
        await loadContractsData();
        renderContractsDashboard();
        renderContractsList();
    } catch(e) { alert('Fehler: ' + e.message); }
}

async function cvMarkPaid(id) {
    const c = (contractsData.contracts||[]).find(x => x.id === id);
    if (!c) return;
    try {
        await cvPost('save_contract', { ...c, zahlungsstatus: 'bezahlt' });
        await loadContractsData();
        renderContractsDashboard();
        renderContractsList();
    } catch(e) { alert('Fehler: ' + e.message); }
}

// ── Duplizieren: Kopie mit leerem Mieter ─────────────────────
function openDuplicateModal(id) {
    const c = (contractsData.contracts||[]).find(x => x.id === id);
    if (!c) return;
    cvOpenModal({
        title:    'Vertrag duplizieren',
        bodyHTML: `
        <div class="cv-form-sections">
            <div class="cv-section">
                <div class="cv-card-row" style="color:var(--text-muted);margin-bottom:12px">
                    Erstellt eine Kopie von "${escapeHtml(c.mieterName)}" mit neuem Mieter und Startdatum.
                </div>
                <label class="cv-label">Neuer Mieter</label>
                <input class="form-control" id="dup-name" type="text" placeholder="Name des neuen Mieters">
                <label class="cv-label" style="margin-top:10px">Neue VBAN</label>
                <input class="form-control" id="dup-vban" type="text" placeholder="VB123456" maxlength="12">
                <label class="cv-label" style="margin-top:10px">Startdatum</label>
                <div style="display:flex;gap:8px">
                    <input class="form-control" id="dup-start" type="date" value="${new Date().toISOString().split('T')[0]}" style="flex:2">
                    <input class="form-control" id="dup-time" type="time" value="00:00" style="flex:1">
                </div>
            </div>
        </div>`,
        saveLabel: 'Duplizieren',
        onSave: async () => {
            const name  = document.getElementById('dup-name')?.value.trim();
            const vban  = document.getElementById('dup-vban')?.value.trim();
            const start = document.getElementById('dup-start')?.value;
            const time  = document.getElementById('dup-time')?.value || '00:00';
            if (!name) return cvModalErr('Mietername ist Pflicht.');
            if (!vban) return cvModalErr('VBAN ist Pflicht.');
            cvModalBusy('Duplizieren…');
            try {
                const { id: _id, createdAt: _c, updatedAt: _u, renewalHistory: _r, ...rest } = c;
                await cvPost('save_contract', { ...rest, id: null, mieterName: name, mieterVban: vban, startDate: start, startTime: time, status: 'active', zahlungsstatus: 'offen' });
                await loadContractsData();
                cvCloseModal();
                renderContractsDashboard();
                renderContractsList();
            } catch(e) { cvModalBusy(''); cvModalErr(e.message); }
        },
    });
}

// ── Löschen: Vertrag ─────────────────────────────────────────
async function cvDeleteContract(id) {
    if (!confirm('Vertrag endgültig löschen? Zum Kündigen stattdessen 🚫 nutzen.')) return;
    try {
        await cvPost('delete_contract', { id });
        contractsData.contracts = (contractsData.contracts||[]).filter(c => c.id !== id);
        renderContractsDashboard();
        renderContractsList();
        renderVehiclesList();
        renderFirmSettingsList();
    } catch(e) { alert('Fehler: ' + e.message); }
}

// ── Modal: Vorlage ───────────────────────────────────────────
function openTemplateModal(id) {
    const existing = id ? (contractsData.templates||[]).find(t => t.id === id) : null;
    const t        = existing || {};

    const varsHTML = TEMPLATE_VARS.map(([v]) =>
        `<button type="button" class="cv-var-btn" onclick="cvInsertVar('tmpl-text','${v}')">${v}</button>`
    ).join('');

    const typeOpts = Object.entries(CONTRACT_TYPES).map(([k,l]) =>
        `<option value="${k}"${(t.type||'vermietung')===k?' selected':''}>${l}</option>`
    ).join('');

    cvOpenModal({
        title:    id ? 'Vorlage bearbeiten' : 'Neue Vorlage',
        bodyHTML: `
        <div class="cv-form-sections">
            <div class="cv-section">
                <div class="cv-form-row">
                    <div class="cv-form-col">
                        <label class="cv-label">Name der Vorlage</label>
                        <input class="form-control" id="tmpl-name" type="text" value="${escapeHtml(t.name||'')}" placeholder="Vorlagenname">
                    </div>
                    <div class="cv-form-col">
                        <label class="cv-label">Vertragstyp</label>
                        <select class="form-control" id="tmpl-type">${typeOpts}</select>
                    </div>
                </div>
            </div>
            <div class="cv-section">
                <div class="cv-section-title">Variablen einfügen</div>
                <div class="cv-vars-bar">${varsHTML}</div>
                <div class="cv-vars-help">${TEMPLATE_VARS.map(([v,d]) => `<code>${escapeHtml(v)}</code> ${escapeHtml(d)}`).join(' &nbsp;·&nbsp; ')}</div>
            </div>
            <div class="cv-section">
                <label class="cv-label">Vertragstext (wird beim Erstellen mit Werten befüllt)</label>
                <textarea class="form-control cv-template-textarea" id="tmpl-text" rows="16" placeholder="Vertragstext eingeben…">${escapeHtml(t.text||'')}</textarea>
                <div class="cv-hint">💡 Der Abschnitt mit Mietgegenständen, Kosten und Zahlungsbedingungen wird automatisch unten angehängt.</div>
            </div>
        </div>`,
        wide:     true,
        saveLabel:'Vorlage speichern',
        onSave:   () => saveTemplateFromModal(id),
    });
}

function cvInsertVar(fieldId, varStr) {
    const ta = document.getElementById(fieldId);
    if (!ta) return;
    const s = ta.selectionStart, e = ta.selectionEnd;
    ta.value = ta.value.slice(0, s) + varStr + ta.value.slice(e);
    ta.selectionStart = ta.selectionEnd = s + varStr.length;
    ta.focus();
}

async function saveTemplateFromModal(id) {
    const name = document.getElementById('tmpl-name')?.value.trim();
    const type = document.getElementById('tmpl-type')?.value;
    const text = document.getElementById('tmpl-text')?.value || '';
    if (!name) return cvModalErr('Name ist Pflicht.');
    cvModalBusy('Speichern…');
    try {
        await cvPost('save_template', { id, name, type, text });
        await loadContractsData();
        cvCloseModal();
        renderTemplatesList();
    } catch(e) { cvModalBusy(''); cvModalErr(e.message); }
}

async function cvDeleteTemplate(id) {
    if (!confirm('Vorlage wirklich löschen?')) return;
    try {
        await cvPost('delete_template', { id });
        contractsData.templates = (contractsData.templates||[]).filter(t => t.id !== id);
        renderTemplatesList();
    } catch(e) { alert('Fehler: ' + e.message); }
}

// ── Modal: Fahrzeug ──────────────────────────────────────────
function openVehicleModal(id) {
    const existing = id ? (contractsData.vehicles||[]).find(v => v.id === id) : null;
    const v        = existing || {};

    const existingBetraege = {};
    (v.tarife || []).forEach(t => { existingBetraege[t.name] = t.betrag; });

    const tarifRows = TARIF_NAMEN.map((name, i) =>
        '<div class="cv-tarif-fixed-row">'
        + '<span class="cv-tarif-fixed-label">' + escapeHtml(name) + '</span>'
        + '<input class="form-control cv-tarif-fixed-input" id="v-tbetrag-' + i + '" type="number" min="0" step="100" placeholder="0 $" value="' + (existingBetraege[name] || '') + '">'
        + '</div>'
    ).join('');

    // Kennzeichen-Array (ein Feld pro Einheit)
    const kzArr  = Array.isArray(v.kennzeichen) ? v.kennzeichen : (v.kennzeichen ? [v.kennzeichen] : []);
    const menge0 = v.menge || 1;
    function buildKzFields(n) {
        let html = '';
        for (let i = 0; i < n; i++) {
            html += '<div class="cv-kz-row">'
                + '<label class="cv-kz-label">Einheit ' + (i+1) + '</label>'
                + '<input class="form-control cv-kz-input" type="text" placeholder="SA-XX-XX" maxlength="12" value="' + escapeHtml(kzArr[i] || '') + '">'
                + '</div>';
        }
        return html;
    }

    // Vorschläge aus bereits vorhandenen Kategorien
    const existingCats = [...new Set((contractsData.vehicles || []).map(vv => (vv.kategorie||'').trim()).filter(Boolean))].sort();
    const datalistOpts = ['PKW', 'Motorrad', 'LKW', 'Van', 'Trailer', 'Boot', 'Helikopter', 'Flugzeug', ...existingCats]
        .filter((c, i, a) => a.indexOf(c) === i)
        .map(c => '<option value="' + escapeHtml(c) + '">').join('');

    cvOpenModal({
        title:    id ? 'Fahrzeug bearbeiten' : 'Neues Fahrzeug',
        bodyHTML: '<datalist id="v-kat-list">' + datalistOpts + '</datalist>'
            + '<div class="cv-form-sections">'
            + '<div class="cv-section">'
            + '<div class="cv-form-row">'
            + '<div class="cv-form-col"><label class="cv-label">Fahrzeugname</label>'
            + '<input class="form-control" id="v-name" type="text" placeholder="Fahrzeugname" value="' + escapeHtml(v.name||'') + '"></div>'
            + '<div class="cv-form-col"><label class="cv-label">Kategorie</label>'
            + '<input class="form-control" id="v-kategorie" type="text" list="v-kat-list" placeholder="z.B. PKW, LKW, Motorrad…" maxlength="60" value="' + escapeHtml(v.kategorie||'') + '"></div>'
            + '</div>'
            + '<div class="cv-form-row" style="margin-top:12px">'
            + '<div class="cv-form-col"><label class="cv-label">Verfügbare Menge</label>'
            + '<input class="form-control" id="v-menge" type="number" min="1" step="1" placeholder="1" value="' + menge0 + '" oninput="cvUpdateKzFields(this.value)"></div>'
            + '<div class="cv-form-col"><label class="cv-label">Kaution ($)</label>'
            + '<input class="form-control" id="v-kaution" type="number" min="0" step="100" placeholder="0" value="' + (v.kaution||'') + '"></div>'
            + '</div>'
            + '<div class="cv-form-row" style="margin-top:12px;align-items:center">'
            + '<label class="cv-checkbox-label"><input type="checkbox" id="v-trailer"' + (v.isTrailer?' checked':'') + '> Ist ein Trailer <span style="color:var(--text-muted)">(kein Tank- / Reparaturnachweis)</span></label>'
            + '</div>'
            + '</div>'
            + '<div class="cv-section"><div class="cv-section-title">Kennzeichen pro Einheit</div>'
            + '<div id="v-kz-container">' + buildKzFields(menge0) + '</div>'
            + '</div>'
            + '<div class="cv-section"><div class="cv-section-title">Tarife</div>'
            + '<div class="cv-tarif-fixed-grid">' + tarifRows + '</div>'
            + '</div></div>',
        saveLabel:'Fahrzeug speichern',
        onSave:   () => saveVehicleFromModal(id),
    });
}

function cvUpdateKzFields(val) {
    const n   = Math.max(1, parseInt(val) || 1);
    const con = document.getElementById('v-kz-container');
    if (!con) return;
    const existing = [...con.querySelectorAll('.cv-kz-input')].map(i => i.value);
    let html = '';
    for (let i = 0; i < n; i++) {
        html += '<div class="cv-kz-row">'
            + '<label class="cv-kz-label">Einheit ' + (i+1) + '</label>'
            + '<input class="form-control cv-kz-input" type="text" placeholder="SA-XX-XX" maxlength="12" value="' + escapeHtml(existing[i] || '') + '">'
            + '</div>';
    }
    con.innerHTML = html;
}

async function saveVehicleFromModal(id) {
    const name      = document.getElementById('v-name')?.value.trim();
    const kategorie = (document.getElementById('v-kategorie')?.value || '').trim();
    const isTrailer = document.getElementById('v-trailer')?.checked || false;
    const kaution   = parseFloat(document.getElementById('v-kaution')?.value) || 0;
    const menge     = Math.max(1, parseInt(document.getElementById('v-menge')?.value) || 1);

    if (!name) return cvModalErr('Fahrzeugname ist Pflicht.');

    const kzInputs   = [...document.querySelectorAll('.cv-kz-input')];
    const kennzeichen = kzInputs.map(i => i.value.trim());

    const tarife = TARIF_NAMEN.map((tName, i) => ({
        name: tName,
        betrag: parseFloat(document.getElementById('v-tbetrag-' + i)?.value) || 0,
    })).filter(t => t.betrag > 0);

    cvModalBusy('Speichern…');
    try {
        await cvPost('save_vehicle', { id, name, kategorie, kennzeichen, isTrailer, kaution, tarife, menge });
        await loadContractsData();
        cvCloseModal();
        renderVehiclesList();
    } catch(e) { cvModalBusy(''); cvModalErr(e.message); }
}

async function cvDeleteVehicle(id) {
    if (!confirm('Fahrzeug wirklich löschen?')) return;
    try {
        await cvPost('delete_vehicle', { id });
        contractsData.vehicles = (contractsData.vehicles||[]).filter(v => v.id !== id);
        renderVehiclesList();
    } catch(e) { alert('Fehler: ' + e.message); }
}

// ── Modal: Firma konfigurieren (manuell) ─────────────────────
function openFirmConfigModal(id) {
    const existing = id ? (contractsData.firmConfigs || []).find(fc => fc.id === id) : null;
    const fc       = existing || {};

    const existingBetraege = {};
    (fc.tarife || []).forEach(t => { existingBetraege[t.name] = t.betrag; });

    const rows = FIRMA_TARIF_NAMEN.map((name, i) => `
        <div class="cv-tarif-fixed-row">
            <span class="cv-tarif-fixed-label">${escapeHtml(name)}</span>
            <input class="form-control cv-tarif-fixed-input" id="fs-tbetrag-${i}" type="number" min="0" step="100" placeholder="0 $" value="${existingBetraege[name] || ''}">
        </div>`).join('');

    cvOpenModal({
        title:    id ? 'Firma bearbeiten' : 'Firma hinzufügen',
        bodyHTML: `
        <div class="cv-form-sections">
            <div class="cv-section">
                <label class="cv-label">Firmenname</label>
                <input class="form-control" id="fs-name" type="text" placeholder="Name der Firma" value="${escapeHtml(fc.name||'')}">
            </div>
            <div class="cv-section">
                <div class="cv-form-row" style="gap:12px">
                    <div class="cv-form-col">
                        <label class="cv-label">Kaution ($)</label>
                        <input class="form-control" id="fs-kaution" type="number" min="0" step="100" placeholder="0" value="${fc.kaution||''}">
                    </div>
                    <div class="cv-form-col">
                        <label class="cv-label">Verfügbare Menge</label>
                        <input class="form-control" id="fs-menge" type="number" min="1" step="1" placeholder="1" value="${fc.menge||1}" title="Wie viele Firmen-Slots du anbieten kannst">
                    </div>
                </div>
            </div>
            <div class="cv-section">
                <div class="cv-section-title">Tarife</div>
                <div class="cv-tarif-fixed-grid">${rows}</div>
            </div>
        </div>`,
        saveLabel: id ? 'Speichern' : 'Hinzufügen',
        onSave: async () => {
            const name    = document.getElementById('fs-name')?.value.trim();
            const kaution = parseFloat(document.getElementById('fs-kaution')?.value) || 0;
            const menge   = Math.max(1, parseInt(document.getElementById('fs-menge')?.value) || 1);
            const tarife  = FIRMA_TARIF_NAMEN.map((name, i) => ({
                name,
                betrag: parseFloat(document.getElementById(`fs-tbetrag-${i}`)?.value) || 0,
            })).filter(t => t.betrag > 0);

            if (!name) return cvModalErr('Firmenname ist Pflicht.');
            cvModalBusy('Speichern…');
            try {
                await cvPost('save_firm_config', { id, name, kaution, menge, tarife });
                await loadContractsData();
                cvCloseModal();
                renderFirmSettingsList();
            } catch(e) { cvModalBusy(''); cvModalErr(e.message); }
        },
    });
}

async function cvDeleteFirmConfig(id) {
    if (!confirm('Firma aus der Konfiguration entfernen?')) return;
    try {
        await cvPost('delete_firm_config', { id });
        contractsData.firmConfigs = (contractsData.firmConfigs || []).filter(fc => fc.id !== id);
        renderFirmSettingsList();
    } catch(e) { alert('Fehler: ' + e.message); }
}

// ── Einnahmen-Tab ────────────────────────────────────────────

// ── Zimmer-Tab: Hotelzimmer mit letzter Zahlung ──────────────
let _zimmerLoaded = false;

function zimmerSkeleton(count) {
    let html = '<div class="cv-zimmer-grid">';
    for (let i = 0; i < count; i++) {
        html += '<div class="cv-zimmer-card cv-zimmer-skeleton">'
            + '<div class="cv-zk-head"><div class="cv-sk-line cv-sk-short"></div><div class="cv-sk-badge"></div></div>'
            + '<div class="cv-zk-tenant"><div class="cv-sk-line cv-sk-med"></div></div>'
            + '<div class="cv-zk-pay-block"><div class="cv-sk-line cv-sk-long"></div><div class="cv-sk-line cv-sk-short" style="margin-top:5px"></div></div>'
            + '</div>';
    }
    return html + '</div>';
}

// Normalisiert ein Tx-Objekt auf einheitliche Felder
function zimmerNormTx(tx) {
    return {
        amount:     tx.amount     ?? tx.value      ?? tx.betrag    ?? 0,
        senderVban: tx.senderVban ?? tx.sender_vban ?? tx.sender?.vban ?? '',
        recvVban:   tx.receiverVban ?? tx.receiver_vban ?? tx.receiver?.vban ?? '',
        ts:         new Date(tx.date ?? tx.createdAt ?? tx.timestamp ?? 0).getTime(),
        raw:        tx,
    };
}

function zimmerFormatDate(raw) {
    if (!raw) return '–';
    const d = new Date(raw);
    if (isNaN(d)) return String(raw);
    return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' })
        + ' · ' + d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' }) + ' Uhr';
}

async function loadZimmerTab(force) {
    const el   = document.getElementById('zimmer-list');
    if (!el) return;

    const vban = window.buildingBankVban;
    const bid  = buildingInfo?.id || _buildingIdCache || contractsData.buildingId || null;

    if (!vban) {
        el.innerHTML = '<div class="info-text">Kein Hotel konfiguriert – Gebäude-Hash in den Einstellungen setzen.</div>';
        return;
    }
    if (_zimmerLoaded && !force) return;

    const knownCount = buildingInfo?.totalRooms || buildingInfo?.rooms?.length || 10;
    el.innerHTML = zimmerSkeleton(knownCount);

    try {
        const txPath      = 'factory/transactions/' + vban + '/25/0';
        const tenantsPath = bid ? 'building/tenants/' + bid : null;
        const needRooms   = !buildingInfo?.rooms?.length && bid;

        const paths = [txPath];
        if (tenantsPath) paths.push(tenantsPath);
        if (needRooms)   paths.push('building/rooms/' + bid);

        const batch  = await apiBatch(paths);

        // Transaktionen
        const txRaw  = batch[txPath]?.body;
        const txList = Array.isArray(txRaw) ? txRaw
                     : (txRaw?.transactions || txRaw?.data || txRaw?.items || []);

        // Mieter-Map: roomId → { tenantName, lastPayDate }
        const tenantsRaw = tenantsPath ? (batch[tenantsPath]?.body || []) : [];
        const tenantsByRoomId = {};
        if (Array.isArray(tenantsRaw)) {
            tenantsRaw.forEach(t => { if (t.roomId) tenantsByRoomId[t.roomId] = t; });
        }

        // Transaktions-Lookup nach normiertem ISO-Timestamp für Betragsabgleich
        const txByTs = {};
        txList.forEach(tx => {
            const ts = tx.timestamp || tx.createdAt || tx.date;
            if (ts) {
                try { txByTs[new Date(ts).toISOString()] = tx; } catch {}
            }
        });

        // Raum-Liste
        let rooms = buildingInfo?.rooms || [];
        if (needRooms) {
            const rRaw = batch['building/rooms/' + bid]?.body;
            if (Array.isArray(rRaw) && rRaw.length) rooms = rRaw;
        }
        if (!rooms.length) {
            const total = buildingInfo?.totalRooms || 0;
            rooms = Array.from({ length: total }, (_, i) => ({
                id: String(i + 1), name: 'Zimmer ' + (i + 1), occupied: false,
            }));
        }

        // Zimmernummer aus hash ("room_12" → 12) oder name extrahieren
        const roomNum = (r) => {
            if (r.hash) return parseInt(r.hash.replace(/\D/g, ''), 10) || 0;
            return parseInt((r.name || '').replace(/\D/g, ''), 10) || 0;
        };
        rooms = [...rooms].sort((a, b) => roomNum(a) - roomNum(b));

        let freeCount = 0, occCount = 0;
        const activeContracts = (contractsData.contracts || []).filter(c => cvStatus(c) === 'active');

        const cards = rooms.map((room, idx) => {
            // Zimmer 1–30 nach Sortierposition (Hash-Reihenfolge)
            const rName  = 'Zimmer ' + (idx + 1);
            const isFree = room.occupied !== true;

            if (isFree) freeCount++; else occCount++;

            // Mieterdaten aus /building/tenants/
            const tenantEntry = tenantsByRoomId[room.id] || null;
            const tenantName  = tenantEntry?.tenantName  || null;
            const lastPayDate = tenantEntry?.lastPayDate || null;

            // Passender Vertrag aus lokalen Daten (Name-Abgleich, case-insensitive)
            const contract = tenantName
                ? activeContracts.find(c =>
                    c.mieterName?.toLowerCase() === tenantName.toLowerCase())
                : null;

            // Passende Transaktion für Betrag suchen (Timestamp-Abgleich)
            let matchedTx = null;
            if (lastPayDate) {
                try { matchedTx = txByTs[new Date(lastPayDate).toISOString()] || null; } catch {}
            }

            // ── Kartenbau ─────────────────────────────────────────
            const statusBadge = isFree
                ? '<span class="cv-zk-badge cv-zk-badge-free">Frei</span>'
                : '<span class="cv-zk-badge cv-zk-badge-occ">Belegt</span>';

            let tenantSection = '';
            if (!isFree && tenantName) {
                const contractBadge = contract
                    ? '<span class="cv-zk-contract-badge" title="' + escapeHtml(contract.templateName || 'Vertrag') + '">Vertrag ✓</span>'
                    : '<span class="cv-zk-contract-missing" title="Kein aktiver Vertrag">Kein Vertrag</span>';
                tenantSection = '<div class="cv-zk-tenant">'
                    + '<span class="cv-zk-tenant-name">' + escapeHtml(tenantName) + '</span>'
                    + contractBadge
                    + '</div>';
            }

            let paySection;
            if (matchedTx) {
                const normed = zimmerNormTx(matchedTx);
                paySection = '<div class="cv-zk-pay-block cv-zk-pay-ok">'
                    + '<span class="cv-zk-pay-amount">' + cvFormatMoney(normed.amount) + '</span>'
                    + '<span class="cv-zk-pay-label">Letzte Zahlung</span>'
                    + '<span class="cv-zk-pay-date">' + escapeHtml(zimmerFormatDate(lastPayDate)) + '</span>'
                    + '</div>';
            } else if (lastPayDate) {
                paySection = '<div class="cv-zk-pay-block cv-zk-pay-ok">'
                    + '<span class="cv-zk-pay-label">Letzte Zahlung</span>'
                    + '<span class="cv-zk-pay-date">' + escapeHtml(zimmerFormatDate(lastPayDate)) + '</span>'
                    + '</div>';
            } else if (!isFree) {
                paySection = '<div class="cv-zk-pay-block cv-zk-pay-none">'
                    + '<span class="cv-zk-pay-warn">⚠ Keine Zahlung erfasst</span>'
                    + '</div>';
            } else {
                paySection = '<div class="cv-zk-pay-block cv-zk-pay-free"></div>';
            }

            return '<div class="cv-zimmer-card ' + (isFree ? 'cv-zimmer-free' : 'cv-zimmer-occ') + '">'
                + '<div class="cv-zk-head">'
                + '<span class="cv-zk-num">' + escapeHtml(rName) + '</span>'
                + statusBadge
                + '</div>'
                + tenantSection
                + paySection
                + '</div>';
        });

        const summary = '<div class="cv-zimmer-summary">'
            + '<span class="cv-zk-sum-occ"><strong>' + occCount + '</strong> belegt</span>'
            + '<span class="cv-zk-sum-sep">·</span>'
            + '<span class="cv-zk-sum-free"><strong>' + freeCount + '</strong> frei</span>'
            + '<span class="cv-zk-sum-sep">·</span>'
            + '<span class="cv-zk-sum-total">' + rooms.length + ' gesamt</span>'
            + '</div>';

        el.innerHTML = summary + '<div class="cv-zimmer-grid">' + cards.join('') + '</div>';
        _zimmerLoaded = true;

    } catch(e) {
        console.error('[Zimmer] Fehler:', e);
        el.innerHTML = '<div class="info-text cv-err">Fehler beim Laden: ' + escapeHtml(e.message) + '</div>';
    }
}
