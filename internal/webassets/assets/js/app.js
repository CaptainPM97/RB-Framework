// Konstanten, PERMS und API-Primitiven (apiUrl, apiHeaders, apiBatch)
// sind in api.js definiert, das vor diesem Script geladen wird.

let factories = [];
// Caches, damit Tabs nicht ständig neu laden
let marketCache    = null;  // [{firma, sellOffers, buyOffers}]
let inventoryCache = null;  // [{firma, lager, machine, isFoundry, capLager, capMachine}]
let bankCache      = null;  // [{firma, accounts}]

// Welche Firmen auf den jeweiligen Seiten eingeblendet sind (Set<firmaId>).
// Wird nach bootstrap() befüllt, sobald die Firmenliste bekannt ist.
let marktFirmaFilter = new Set();
let lagerFirmaFilter = new Set();
let bankFirmaFilter  = new Set();

const rpLoadingTexts = [
    "Synchronisiere Firmenregister mit der Handelskammer...",
    "Verbinde mit dem internen ResourceBay Mainframe...",
    "Lade aktuelle Lagerbestände aller Standorte...",
    "Frage Marktangebote im VNET ab...",
    "Zähle Paletten in den Lagerhallen nach...",
    "Kalibriert die Waage im Maschinenlager...",
    "Sortiert die Page-Options nach Relevanz...",
    "Prüft, wie viel Platz in der Gießerei noch frei ist...",
    "Poliert das Firmenschild für den nächsten Kontrollbesuch..."
];

// Sicherheitsnetz: egal was schiefgeht, der Ladebildschirm darf niemals für
// immer hängen bleiben. Notfalls nach 8 Sekunden zwangsweise ausblenden.
// Ladescreen ist nur Dekoration — nach 4 Sekunden wird er immer ausgeblendet,
// unabhängig davon ob die API-Daten schon geladen sind.
const loadingScreenFailsafe = setTimeout(hideLoadingScreen, 4000);

document.addEventListener('DOMContentLoaded', () => {
    try {
        setRandomLoadingText();
        initNavigation();

        if (PERMS.optionen) initOptionsPage();

        document.getElementById('markt-search-input').addEventListener('input', (e) =>
            filterRows('markt-container', 'markt-no-results', e.target.value));

        if (PERMS.lager) {
            document.getElementById('lager-search-input').addEventListener('input', (e) =>
                filterRows('lager-container', 'lager-no-results', e.target.value));
        }

    } catch (err) {
        console.error('Fehler bei der Initialisierung:', err && err.stack ? err.stack : err);
    }

    bootstrap();
});

async function runStep(label, fn) {
    try {
        return await fn();
    } catch (err) {
        console.error(`vAPI Bootstrap Fehler in Schritt "${label}":`, err && err.stack ? err.stack : err);
        throw err;
    }
}

async function bootstrap() {
    try {
        // ── Schritt 1: Firmenliste + Vertragsdaten parallel ────────
        // Beide Quellen sind unabhängig – kein Grund, sie sequenziell zu laden.
        const [_factories] = await Promise.all([
            runStep('loadFactories', loadFactories),
            typeof loadContractsData === 'function'
                ? loadContractsData().catch(() => {})
                : Promise.resolve(),
        ]);
        renderFirmenListe();

        // Optionen-Prefetch sofort starten — läuft parallel zu den Markt/Lager/Bank-Batches
        if (PERMS.optionen) prefetchOptionsFirstFirma();

        // ── Schritt 2: Drei unabhängige parallele Batches ─────────
        // Getrennt damit ein Timeout bei Lager/Bank nicht die Marktdaten kaputt macht.
        const marketPaths = [];
        const lagerPaths  = [];
        const bankPaths   = [];

        for (const f of factories) {
            marketPaths.push(`factory/marketoffers/sell/${f.id}`);
            marketPaths.push(`factory/marketoffers/buy/${f.id}`);
        }
        if (PERMS.lager) {
            for (const f of factories) {
                lagerPaths.push(`factory/inventory/${f.id}`);
                lagerPaths.push(`factory/machine/${f.id}`);
            }
        }
        if (PERMS.bank) {
            for (const f of factories) {
                bankPaths.push(`factory/bankaccounts/${f.id}`);
            }
        }

        const safeBatch = async (paths) => {
            if (!paths.length) return {};
            try {
                return await apiBatch(paths);
            } catch (err) {
                console.warn('Batch fehlgeschlagen, versuche Einzelabrufe:', err && err.message);
                const results = await Promise.allSettled(
                    paths.map(p => fetch(apiUrl(p), { headers: apiHeaders() })
                        .then(async r => ({ path: p, status: r.status, body: r.ok ? await r.json() : null }))
                        .catch(() => ({ path: p, status: 0, body: null }))
                    )
                );
                const map = {};
                results.forEach(r => { if (r.status === 'fulfilled') map[r.value.path] = r.value; });
                return map;
            }
        };

        const [mBatch, lBatch, bBatch] = await Promise.all([
            safeBatch(marketPaths),
            safeBatch(lagerPaths),
            safeBatch(bankPaths),
        ]);
        const batch = { ...mBatch, ...lBatch, ...bBatch };

        marketCache = factories.map(firma => {
            const sell = batch[`factory/marketoffers/sell/${firma.id}`];
            const buy  = batch[`factory/marketoffers/buy/${firma.id}`];
            return {
                firma,
                sellOffers: (sell?.status === 200 ? sell.body : null) ?? [],
                buyOffers:  (buy?.status  === 200 ? buy.body  : null) ?? [],
            };
        });

        if (PERMS.lager) {
            inventoryCache = factories.map(firma => {
                const foundry = isFoundry(firma);
                const lager   = batch[`factory/inventory/${firma.id}`];
                const machine = batch[`factory/machine/${firma.id}`];
                return {
                    firma,
                    lager:      (lager?.status   === 200 ? lager.body   : null) ?? { totalWeight: 0, items: [] },
                    machine:    (machine?.status  === 200 ? machine.body : null) ?? { totalWeight: 0, items: [] },
                    isFoundry:  foundry,
                    capLager:   foundry ? CAP_LAGER_FOUNDRY : CAP_LAGER_NORMAL,
                    capMachine: CAP_MACHINE,
                };
            });
        }

        if (PERMS.bank) {
            bankCache = factories.map(firma => {
                const result = batch[`factory/bankaccounts/${firma.id}`];
                return {
                    firma,
                    accounts: (result?.status === 200 ? result.body : null) ?? [],
                };
            });
            window.bankAccounts = bankCache.flatMap(({ firma, accounts }) =>
                accounts.map(a => ({ ...a, label: `${firma.name || firma.id} – ${a.label || a.vban || ''}` }))
            );
        }

        renderMarketPage();
        if (PERMS.lager) renderInventoryPage();
        if (PERMS.bank)  renderBankPage();
        updateOverviewStats();
        initFirmaChips();

        // Hotel-Bankkonten über loadBuildingData() aus contracts.js laden
        if (PERMS.bank && typeof loadBuildingData === 'function') {
            loadBuildingData().catch(() => {});
        }

        // Falls User bereits auf Options-Tab ist (schneller als Bootstrap), jetzt nachholen
        if (PERMS.optionen && document.getElementById('page-optionen')?.classList.contains('active')) {
            const sel = document.getElementById('options-firma-select');
            if (sel && factories.length && !sel.value) sel.value = String(factories[0].id);
            if (typeof autoOpenFirstOption === 'function') autoOpenFirstOption();
        }

        hideLoadingScreen();
    } catch (err) {
        console.error('vAPI Bootstrap Fehler:', err && err.stack ? err.stack : err);
        showBootstrapError(err);
    }
}

function showBootstrapError(err) {
    console.error('Bootstrap-Fehler (Seite trotzdem geladen):', err?.message || err);
    hideLoadingScreen();
}


function setRandomLoadingText() {
    const el = document.getElementById('loader-dynamic-text');
    if (el) el.innerText = rpLoadingTexts[Math.floor(Math.random() * rpLoadingTexts.length)];
}

function setLoaderText(text) {
    const el = document.getElementById('loader-dynamic-text');
    if (el) el.innerText = text;
}

function hideLoadingScreen() {
    clearTimeout(loadingScreenFailsafe);
    const screen = document.getElementById('loading-screen');
    if (screen) screen.classList.add('fade-out');
}

// ==========================================================================
// NAVIGATION
// ==========================================================================
function switchToTab(targetId) {
    document.querySelectorAll('#main-nav .nav-link').forEach(l => l.classList.toggle('active', l.getAttribute('data-target') === targetId));
    document.querySelectorAll('.content-section').forEach(s => s.classList.toggle('active', s.id === targetId));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (targetId === 'page-optionen' && PERMS.optionen) {
        // Dropdown sofort auf erste Firma setzen (synchron), dann Daten laden
        const sel = document.getElementById('options-firma-select');
        if (sel && factories.length && !sel.value) {
            sel.value = String(factories[0].id);
        }
        autoOpenFirstOption();
    }
    if (targetId === 'page-vertraege' && typeof initVertraegePage === 'function') {
        setTimeout(initVertraegePage, 0);
    }
    if (targetId === 'page-produktion' && typeof initProductionPage === 'function') {
        setTimeout(initProductionPage, 0);
    }
    if (targetId === 'page-changelog' && typeof loadChangelog === 'function' && !changelogLoaded) {
        loadChangelog();
    }
}

function initNavigation() {
    const nav = document.getElementById('main-nav');
    const toggle = document.getElementById('nav-toggle');

    toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        nav.classList.toggle('nav-open');
    });
    document.addEventListener('click', (e) => {
        if (!nav.contains(e.target) && e.target !== toggle) {
            nav.classList.remove('nav-open');
        }
    });

    document.querySelectorAll('#main-nav .nav-link[data-target]').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            nav.classList.remove('nav-open');
            switchToTab(link.getAttribute('data-target'));
        });
    });
    document.querySelectorAll('[data-target].service-card').forEach(el => {
        el.addEventListener('click', () => switchToTab(el.getAttribute('data-target')));
    });

    // Verträge-interne Tab-Navigation via Event-Delegation — läuft unabhängig
    // von contracts.js, damit die Tabs auch ohne contracts.js funktionieren.
    document.addEventListener('click', e => {
        const btn = e.target.closest('#page-vertraege .vtab[data-vtab]');
        if (!btn) return;
        const tab = btn.dataset.vtab;
        document.querySelectorAll('#page-vertraege .vtab').forEach(b =>
            b.classList.toggle('active', b.dataset.vtab === tab));
        document.querySelectorAll('#page-vertraege .vtab-pane').forEach(p =>
            p.classList.toggle('hidden', p.id !== 'vtab-' + tab));
        // Contracts-Modul beim ersten Tab-Wechsel initialisieren
        if (typeof initVertraegePage === 'function') initVertraegePage();
        // Zimmer-Tab: Daten laden wenn aktiv
        if (tab === 'zimmer' && typeof loadZimmerTab === 'function') loadZimmerTab();
    });
}

// ==========================================================================
// HELPERS
// ==========================================================================
function formatMoney(num) {
    return `$${(num || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatWeight(num) {
    return `${(num || 0).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kg`;
}

function isFoundry(firma) {
    const name = (firma.name || '').toLowerCase();
    const type = (firma.type || '').toLowerCase();
    return name.includes('gießerei') || name.includes('giesserei') || type.includes('foundry') || type.includes('giesserei') || type.includes('gießerei');
}

function filterRows(containerId, noResultsId, query) {
    const term = query.trim().toLowerCase();
    const container = document.getElementById(containerId);
    const noResults = document.getElementById(noResultsId);
    if (!container) return;

    let anyVisible = false;

    container.querySelectorAll('.market-firm-card').forEach(card => {
        // Firma-Filter hat Vorrang — deaktivierte Firmen werden nie durchsucht
        if (card.classList.contains('firma-hidden')) {
            card.style.display = 'none';
            return;
        }
        if (!term) {
            card.style.display = '';
            anyVisible = true;
            return;
        }
        let cardVisible = false;
        card.querySelectorAll('.market-offer-section').forEach(section => {
            let sectionVisible = false;
            section.querySelectorAll('.market-item-row').forEach(row => {
                const itemName = row.getAttribute('data-item') || '';
                const matches = itemName.includes(term);
                row.style.display = matches ? '' : 'none';
                if (matches) sectionVisible = true;
            });
            section.style.display = sectionVisible ? '' : 'none';
            if (sectionVisible) cardVisible = true;
        });
        card.style.display = cardVisible ? '' : 'none';
        if (cardVisible) anyVisible = true;
    });

    if (noResults) noResults.style.display = anyVisible ? 'none' : 'block';
}

// Firma-Filter auf einen Container anwenden (setzt/entfernt .firma-hidden).
function applyFirmaFilter(containerId, filterSet) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.market-firm-card').forEach(card => {
        const firmaId = card.dataset.firmaId;
        // Karten ohne firmaId (z.B. Hotel) immer anzeigen
        const hidden = firmaId && filterSet.size > 0 && !filterSet.has(firmaId);
        card.classList.toggle('firma-hidden', hidden);
        card.style.display = hidden ? 'none' : '';
    });
}

// Chip-Leiste für alle Seiten aufbauen — wird nach bootstrap() aufgerufen.
// Firmen mit aktivem Miet-/Pachtvertrag starten automatisch deaktiviert.
function initFirmaChips() {
    const rentedIds = getRentedFirmaIds();

    function buildChips(containerId, filterSet, onToggle) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';
        filterSet.clear();
        factories.forEach(f => {
            const id       = String(f.id);
            const isRented = rentedIds.has(id);

            // Verpachtete Firmen standardmäßig ausgeblendet (kein Add zum filterSet)
            if (!isRented) filterSet.add(id);

            const chip = document.createElement('button');
            chip.type      = 'button';
            chip.className = 'firma-chip' + (isRented ? ' firma-chip-rented' : ' active');
            chip.textContent   = f.name;
            chip.dataset.firmaId = id;
            if (isRented) chip.title = 'Aktuell verpachtet – ausgeblendet';
            chip.addEventListener('click', () => {
                if (filterSet.has(id)) { filterSet.delete(id); chip.classList.remove('active'); }
                else                   { filterSet.add(id);    chip.classList.add('active');    }
                onToggle();
            });
            container.appendChild(chip);
        });
    }

    buildChips('markt-firma-chips', marktFirmaFilter, () => {
        applyFirmaFilter('markt-container', marktFirmaFilter);
        filterRows('markt-container', 'markt-no-results',
            document.getElementById('markt-search-input')?.value || '');
    });

    if (PERMS.lager) {
        buildChips('lager-firma-chips', lagerFirmaFilter, () => {
            applyFirmaFilter('lager-container', lagerFirmaFilter);
            filterRows('lager-container', 'lager-no-results',
                document.getElementById('lager-search-input')?.value || '');
        });
    }

    if (PERMS.bank) {
        buildChips('bank-firma-chips', bankFirmaFilter, () => {
            applyFirmaFilter('bank-container', bankFirmaFilter);
        });
    }
}

// ==========================================================================
// FIRMEN LADEN
// ==========================================================================
async function loadFactories() {
    const MAX_TRIES = 3;
    let lastErr;
    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
        if (attempt > 1) {
            setLoaderText(`API nicht erreichbar – Versuch ${attempt}/${MAX_TRIES}…`);
            await new Promise(r => setTimeout(r, 1500 * (attempt - 1)));
        }
        try {
            const res = await fetch(apiUrl('factory/list/'), { headers: apiHeaders() });
            if (!res.ok) {
                let detail = '';
                try { const j = await res.json(); detail = j.message || j.error || ''; } catch {}
                const err = new Error(`Firmenliste: HTTP ${res.status}${detail ? ' – ' + detail : ''}`);
                if (res.status < 500) throw err; // 4xx sofort werfen, kein Retry
                lastErr = err;
                continue; // 5xx/502 → retry
            }
            factories = await res.json();
            window.factories = factories;
            ['options-firma-select'].forEach(id => {
                const select = document.getElementById(id);
                if (!select) return;
                const first = select.options[0];
                select.innerHTML = '';
                select.appendChild(first);
                factories.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f.id;
                    opt.textContent = f.name;
                    select.appendChild(opt);
                });
            });
            return; // Erfolg
        } catch (err) {
            lastErr = err;
            // Netzwerkfehler (fetch selbst wirft) → retry; 4xx → sofort werfen
            if (err.message?.startsWith('Firmenliste: HTTP 4')) throw err;
        }
    }
    throw lastErr || new Error('API nach 3 Versuchen nicht erreichbar');
}

function renderFirmenListe() {
    const container = document.getElementById('firmenliste-container');
    container.innerHTML = '';
    if (factories.length === 0) {
        container.innerHTML = '<div class="info-text">Keine Firmen gefunden.</div>';
        return;
    }
    factories.forEach(f => {
        const row = document.createElement('div');
        row.className = 'firm-list-row';
        const foundryBadge = isFoundry(f) ? '<span class="firm-type-badge">Gießerei</span>' : '';
        row.innerHTML = `
            <div>
                <div class="firm-name">${f.name}</div>
                <div class="firm-address">${f.address || 'Kein Standort eingetragen'}</div>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
                ${f.type ? `<span class="firm-type-badge">${f.type}</span>` : ''}
                ${foundryBadge}
                <span class="firm-type-badge">${f.isOpen ? '🟢 offen' : '🔴 geschlossen'}</span>
            </div>
        `;
        container.appendChild(row);
    });
}

// Gibt die IDs aller Firmen zurück, die gerade aktiv verpachtet/vermietet sind.
// Firmen stehen in selectedFirmen[].firmaId aller aktiven Verträge (unabhängig vom objektTyp).
function getRentedFirmaIds() {
    if (typeof contractsData === 'undefined' || !contractsData.contracts) return new Set();
    const statusFn = typeof cvStatus === 'function' ? cvStatus : (c) => {
        const today = new Date().toISOString().split('T')[0];
        if (c.status === 'terminated') return 'terminated';
        if (c.startDate > today) return 'upcoming';
        return (!c.endDate || c.endDate >= today) ? 'active' : 'expired';
    };
    const active = contractsData.contracts.filter(c => statusFn(c) === 'active');
    return new Set(
        active.flatMap(c => (c.selectedFirmen || []).map(sf => String(sf.firmaId)))
    );
}

function updateOverviewStats() {
    const rentedIds = getRentedFirmaIds();

    document.getElementById('stat-firmen').innerText = factories.length;

    // Vertragsmodul-Statistiken (Fahrzeuge + vermietete Objekte)
    if (typeof contractsData !== 'undefined') {
        const today = new Date().toISOString().split('T')[0];
        const activeContracts = (contractsData.contracts || []).filter(c =>
            c.status !== 'terminated' &&
            c.startDate <= today &&
            (!c.endDate || c.endDate >= today)
        );
        // Gesamtbestand berücksichtigt menge-Feld
        const vTotal    = (contractsData.vehicles    || []).reduce((s, v) => s + (v.menge || 1), 0);
        const fCfgTotal = (contractsData.firmConfigs || []).reduce((s, f) => s + (f.menge || 1), 0);
        // Vermietet = distinct Firmen in aktiven Verträgen (via selectedFirmen) / Fahrzeuge
        const vRented = activeContracts.reduce((s, c) => s + (c.selectedVehicles || []).length, 0);

        const statFz  = document.getElementById('stat-fahrzeuge');
        const statFzV = document.getElementById('stat-fahrzeuge-vermietet');
        const statFiV = document.getElementById('stat-firmen-vermietet');
        if (statFz)  statFz.innerText  = vTotal;
        if (statFzV) statFzV.innerText = vRented;
        if (statFiV) statFiV.innerText = rentedIds.size;

        // Firmen im Besitz: API-Firmen + firmConfigs kombinieren
        const statFi = document.getElementById('stat-firmen');
        if (statFi) statFi.innerText = Math.max(factories.length, fCfgTotal || factories.length);
    }

    // Lager- und Maschinengewichte nur für nicht verpachtete Firmen
    if (inventoryCache) {
        const totalLager   = inventoryCache
            .filter(f => !rentedIds.has(String(f.firma.id)))
            .reduce((sum, f) => sum + (f.lager?.totalWeight || 0), 0);
        const totalMachine = inventoryCache
            .filter(f => !rentedIds.has(String(f.firma.id)))
            .reduce((sum, f) => sum + (f.machine?.totalWeight || 0), 0);
        const lagerEl   = document.getElementById('stat-lagerweight');
        const machineEl = document.getElementById('stat-machineweight');
        if (lagerEl)   lagerEl.innerText   = formatWeight(totalLager);
        if (machineEl) machineEl.innerText = formatWeight(totalMachine);
    }

    // Marktangebote nur für nicht verpachtete Firmen
    if (marketCache) {
        const totalOffers = marketCache
            .filter(f => !rentedIds.has(String(f.firma.id)))
            .reduce((sum, f) => sum + f.sellOffers.length + f.buyOffers.length, 0);
        document.getElementById('stat-offers').innerText = totalOffers;
    }

    // Bankguthaben über alle Firmen (Bank gehört dem Eigentümer)
    if (bankCache) {
        const total = bankCache.reduce((sum, f) => sum + f.accounts.reduce((s, a) => s + (a.balance || 0), 0), 0);
        const el = document.getElementById('stat-bankbalance');
        if (el) el.innerText = formatMoney(total);
    }
}

// ==========================================================================
// BANKBESTÄNDE
// ==========================================================================
function renderBankPage() {
    const container = document.getElementById('bank-container');
    if (!container) return;
    container.innerHTML = '';

    const buildingAccs = typeof window.buildingBankAccounts !== 'undefined'
        ? window.buildingBankAccounts : [];

    const hasFactory = bankCache && bankCache.some(f => f.accounts.length > 0);
    const hasBuilding = buildingAccs.length > 0;

    if (!hasFactory && !hasBuilding) {
        container.innerHTML = '<div class="grid-card"><div class="info-text">Keine Bankkonten gefunden.</div></div>';
        return;
    }

    console.log('[renderBankPage] hasBuilding:', hasBuilding, '| hasFactory:', hasFactory, '| accs:', buildingAccs.length);
    // Hotel-Konten zuerst
    if (hasBuilding) {
        const total = buildingAccs.reduce((s, a) => s + (a.balance || 0), 0);
        const card = document.createElement('div');
        card.className = 'grid-card market-firm-card bank-card bank-card-hotel';

        const rows = buildingAccs.map(acc => `
            <div class="bank-account-row">
                <div class="bank-account-info">
                    <span class="bank-vban">${escapeHtml(acc.vban || '–')}</span>
                    <span class="bank-note">${escapeHtml(acc.label || acc.note || 'Hotelkonto')}</span>
                </div>
                <span class="bank-balance ${(acc.balance||0) >= 0 ? 'balance-pos' : 'balance-neg'}">${formatMoney(acc.balance || 0)}</span>
            </div>
        `).join('');

        card.innerHTML = `
            <div class="card-header">
                <div class="card-title">🏨 Hotel</div>
                <div class="bank-firma-total">${formatMoney(total)}</div>
            </div>
            <div class="bank-account-list">${rows}</div>
        `;
        container.appendChild(card);
    }

    if (bankCache) {
        bankCache.forEach(({ firma, accounts }) => {
            if (!accounts || accounts.length === 0) return;
            const firmaTotal = accounts.reduce((s, a) => s + (a.balance || 0), 0);
            const card = document.createElement('div');
            card.className = 'grid-card market-firm-card bank-card';
            card.dataset.firmaId = String(firma.id);

            const rows = accounts.map(acc => `
                <div class="bank-account-row">
                    <div class="bank-account-info">
                        <span class="bank-vban">${escapeHtml(acc.vban || '–')}</span>
                        <span class="bank-note">${escapeHtml(acc.note || 'Kein Name')}</span>
                    </div>
                    <span class="bank-balance ${acc.balance >= 0 ? 'balance-pos' : 'balance-neg'}">${formatMoney(acc.balance || 0)}</span>
                </div>
            `).join('');

            card.innerHTML = `
                <div class="card-header">
                    <div class="card-title">${escapeHtml(firma.name)}</div>
                    <div class="bank-firma-total">${formatMoney(firmaTotal)}</div>
                </div>
                <div class="bank-account-list">${rows}</div>
            `;
            container.appendChild(card);
        });
    }

    console.log('[renderBankPage] container children:', container.children.length, '| bankFirmaFilter size:', bankFirmaFilter.size);
    applyFirmaFilter('bank-container', bankFirmaFilter);
    console.log('[renderBankPage] nach filter — hotel card display:', container.querySelector('.bank-card-hotel')?.style.display ?? 'nicht gefunden');
}

// ==========================================================================
// MARKTANGEBOTE
// ==========================================================================
function renderMarketPage() {
    const container = document.getElementById('markt-container');
    container.innerHTML = '';
    if (!marketCache) return;

    const cardsWithOffers = marketCache.filter(c => c.sellOffers.length > 0 || c.buyOffers.length > 0);

    if (cardsWithOffers.length === 0) {
        container.innerHTML = '<div class="grid-card"><div class="info-text">Keine Marktangebote für diese Auswahl gefunden.</div></div>';
        return;
    }

    cardsWithOffers.forEach(({ firma, sellOffers, buyOffers }) => {
        const card = document.createElement('div');
        card.className = 'grid-card market-firm-card';
        card.dataset.firmaId = String(firma.id);

        let sellHTML = '';
        if (sellOffers.length > 0) {
            const sellTotal = sellOffers.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
            sellHTML = `
                <div class="market-offer-section market-sell-section">
                    <div class="market-section-title market-sell">
                        <span>Im Verkauf</span>
                        <span class="market-section-total">Gesamt: ${formatMoney(sellTotal)}</span>
                    </div>
                    <div class="market-item-list">
                        ${sellOffers.map(o => `
                            <div class="market-item-row market-sell-row" data-item="${o.item.toLowerCase()}">
                                <span class="market-item-name">${o.item}</span>
                                <div class="market-item-meta">
                                    <span class="market-col-price">Preis/Stk.: ${formatMoney(o.pricePerUnit)}</span>
                                    <span class="market-col-amount">Menge: ${(o.availableAmount || 0).toLocaleString('de-DE')}x</span>
                                    <span class="market-col-total">Gesamt: ${formatMoney(o.totalPrice)}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        let buyHTML = '';
        if (buyOffers.length > 0) {
            const buyTotal = buyOffers.reduce((sum, o) => sum + (o.totalPrice || 0), 0);
            buyHTML = `
                <div class="market-offer-section market-buy-section">
                    <div class="market-section-title market-buy">
                        <span>Im Ankauf</span>
                        <span class="market-section-total">Gesamt: ${formatMoney(buyTotal)}</span>
                    </div>
                    <div class="market-item-list">
                        ${buyOffers.map(o => `
                            <div class="market-item-row market-buy-row" data-item="${o.item.toLowerCase()}">
                                <span class="market-item-name">${o.item}</span>
                                <div class="market-item-meta">
                                    <span class="market-col-price">Preis/Stk.: ${formatMoney(o.pricePerUnit)}</span>
                                    <span class="market-col-amount">Menge: ${(o.availableAmount || 0).toLocaleString('de-DE')}x</span>
                                    <span class="market-col-total">Gesamt: ${formatMoney(o.totalPrice)}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        card.innerHTML = `
            <div class="card-header">
                <div class="card-title">${firma.name}</div>
                <div class="card-icon">🏢</div>
            </div>
            <p style="margin-bottom:14px; color:var(--text-muted); font-size:14px;">${firma.address || 'Kein Standort eingetragen'}</p>
            ${sellHTML}
            ${buyHTML}
        `;
        container.appendChild(card);
    });

    applyFirmaFilter('markt-container', marktFirmaFilter);
    filterRows('markt-container', 'markt-no-results', document.getElementById('markt-search-input')?.value || '');
}

// ==========================================================================
// LAGERBESTÄNDE
// ==========================================================================
function capacityBlockHTML(label, used, cap) {
    const free = cap - used;
    const pct = Math.min(100, Math.round((used / cap) * 100));
    const overClass = free < 0 ? 'over' : '';
    const freeClass = free < 0 ? 'free-negative' : 'free-positive';
    return `
        <div class="capacity-block">
            <div class="capacity-block-label"><span>${label}</span><span>${pct}%</span></div>
            <div class="capacity-bar-bg"><div class="capacity-bar-fill ${overClass}" style="width:${pct}%;"></div></div>
            <div class="capacity-block-figures">
                <span>Belegt: <b>${formatWeight(used)}</b> / ${formatWeight(cap)}</span>
                <span class="${freeClass}">Frei: ${formatWeight(free)}</span>
            </div>
        </div>
    `;
}

function inventoryItemRow(item, rowClass) {
    return `
        <div class="market-item-row ${rowClass}" data-item="${item.item.toLowerCase()}">
            <span class="market-item-name">${item.item}</span>
            <div class="market-item-meta">
                <span class="market-col-amount">Menge: ${(item.amount || 0).toLocaleString('de-DE')}x</span>
                <span class="market-col-singleweight">Stückgewicht: ${formatWeight(item.singleWeight)}</span>
                <span class="market-col-totalweight">Gesamt: ${formatWeight(item.totalWeight)}</span>
            </div>
        </div>
    `;
}

function renderInventoryPage() {
    const container = document.getElementById('lager-container');
    container.innerHTML = '';
    if (!inventoryCache) return;

    const relevant = inventoryCache;

    if (relevant.length === 0) {
        container.innerHTML = '<div class="grid-card"><div class="info-text">Keine Lagerdaten für diese Auswahl gefunden.</div></div>';
        return;
    }

    relevant.forEach(({ firma, lager, machine, isFoundry: foundry, capLager, capMachine }) => {
        const card = document.createElement('div');
        card.className = 'grid-card market-firm-card';
        card.dataset.firmaId = String(firma.id);

        const capacitySummaryHTML = `
            <div class="capacity-summary">
                ${capacityBlockHTML('Lager', lager.totalWeight || 0, capLager)}
                ${capacityBlockHTML('Maschinenlager', machine.totalWeight || 0, capMachine)}
            </div>
        `;

        const lagerItemsHTML = (lager.items && lager.items.length > 0)
            ? lager.items.map(i => inventoryItemRow(i, 'lager-row')).join('')
            : '<div class="info-text" style="padding:10px;">Lager ist leer.</div>';

        const machineItemsHTML = (machine.items && machine.items.length > 0)
            ? machine.items.map(i => inventoryItemRow(i, 'machine-row')).join('')
            : '<div class="info-text" style="padding:10px;">Maschinenlager ist leer.</div>';

        card.innerHTML = `
            <div class="card-header">
                <div class="card-title">${firma.name}${foundry ? ' (Gießerei)' : ''}</div>
                <div class="card-icon">📦</div>
            </div>
            ${capacitySummaryHTML}
            <div class="market-offer-section">
                <div class="market-section-title lager-normal">Lager</div>
                <div class="market-item-list">${lagerItemsHTML}</div>
            </div>
            <div class="market-offer-section">
                <div class="market-section-title lager-machine">Maschinenlager</div>
                <div class="market-item-list">${machineItemsHTML}</div>
            </div>
        `;
        container.appendChild(card);
    });

    applyFirmaFilter('lager-container', lagerFirmaFilter);
    filterRows('lager-container', 'lager-no-results', document.getElementById('lager-search-input')?.value || '');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// Optionen-Editor-Code → assets/js/options.js
