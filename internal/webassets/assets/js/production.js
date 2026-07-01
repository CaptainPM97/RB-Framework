// ============================================================
//  PRODUKTION
// ============================================================

let productionData  = { settings: { defaultMarge: 30 }, rohstoffe: [], products: [] };
let prodInitDone    = false;
let kalkItems       = [];
let bestellState    = { kundenname: '', rabatt: 0, items: [] };
let bestellEditId   = null; // ID der Bestellung die gerade bearbeitet wird (null = neue)
let _prodSearchRS   = '';
let _prodSearchProd = '';
let _prodTypFilter  = 'fertig';
let _prodSortMode   = '';

// ── Fokus-Erhalt bei Re-Render ───────────────────────────────
// Speichert welches Eingabefeld aktiv war (via data-focus-key)
// und stellt Fokus + Cursorposition nach innerHTML-Ersatz wieder her.
function _focusSave(paneEl) {
    const a = document.activeElement;
    if (!a || !paneEl.contains(a) || !a.dataset.focusKey) return null;
    return { key: a.dataset.focusKey, start: a.selectionStart ?? 0, end: a.selectionEnd ?? 0 };
}
function _focusRestore(paneEl, s) {
    if (!s) return;
    const t = paneEl.querySelector(`[data-focus-key="${s.key}"]`);
    if (!t) return;
    if (t.type === 'number') {
        // Chrome selektiert bei focus() alle Zahlen — Trick: kurz auf text wechseln
        t.type = 'text';
        t.focus();
        const len = t.value.length;
        try { t.setSelectionRange(len, len); } catch (_) {}
        t.type = 'number';
        return;
    }
    t.focus();
    try { t.setSelectionRange(s.start, s.end); } catch (_) {}
}

// ── Formatierung ─────────────────────────────────────────────
function prodFmtMoney(n) {
    return '$ ' + (n || 0).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function prodFmtN(n) {
    const r = Math.round((n || 0) * 100) / 100;
    return r === Math.round(r) ? String(Math.round(r)) : r.toFixed(2);
}
// Rundet auf max. 2 Nachkommastellen für editierbare number-Inputs (value-Attribut)
function _round2(n) {
    return Math.round((parseFloat(n) || 0) * 100) / 100;
}

// Einheitlicher Preisblock: Prod. Preis / Gewinn / Gesamtpreis
function _priceBlockHtml(unitCost, marge, qty, exportPreis) {
    qty = qty || 1;
    const hasExport = exportPreis !== null && exportPreis !== undefined && exportPreis > 0;
    const vk        = hasExport ? exportPreis : (marge < 100 ? unitCost / (1 - marge / 100) : unitCost);
    const gewinn    = vk - unitCost;
    const suf       = qty > 1 ? ' (gesamt)' : '';
    if (hasExport) {
        const gewinnStyle = gewinn < 0.01 ? 'color:var(--red);font-weight:700' : 'color:var(--emerald)';
        return `<div class="prod-price-block">
            <div class="prod-price-row">
                <span class="prod-price-lbl">Prod. Preis${suf}</span>
                <span class="prod-price-val">${prodFmtMoney(unitCost * qty)}</span>
            </div>
            <div class="prod-price-row">
                <span class="prod-price-lbl">Export Preis${suf}</span>
                <span class="prod-price-val">${prodFmtMoney(vk * qty)}</span>
            </div>
            <div class="prod-price-row prod-price-row-total">
                <span class="prod-price-lbl">Geschätzter Gewinn${suf}</span>
                <span class="prod-price-val" style="${gewinnStyle}">${prodFmtMoney(gewinn * qty)}</span>
            </div>
        </div>`;
    }
    return `<div class="prod-price-block">
        <div class="prod-price-row">
            <span class="prod-price-lbl">Prod. Preis${suf}</span>
            <span class="prod-price-val">${prodFmtMoney(unitCost * qty)}</span>
        </div>
        <div class="prod-price-row">
            <span class="prod-price-lbl">Gewinn${suf}</span>
            <span class="prod-price-val prod-p-gewinn">${prodFmtMoney(gewinn * qty)}</span>
        </div>
        <div class="prod-price-row prod-price-row-total">
            <span class="prod-price-lbl">Gesamtpreis${suf}</span>
            <span class="prod-price-val prod-p-gesamt">${prodFmtMoney(vk * qty)}</span>
        </div>
    </div>`;
}

// ── API ──────────────────────────────────────────────────────
async function loadProductionData() {
    const pending = window._prefetchProduction;
    if (pending) {
        window._prefetchProduction = null;
        const data = await pending;
        if (data) { productionData = data; return; }
    }
    const res = await fetch('api/production.php', { headers: { Accept: 'application/json' } });
    if (res.status === 401) { location.href = 'login.php'; return; }
    if (!res.ok) throw new Error(`Laden fehlgeschlagen (${res.status})`);
    productionData = await res.json();
}
async function prodPost(body) {
    const res = await fetch('api/production.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || `Fehler ${res.status}`);
    return j;
}

// ── Init ─────────────────────────────────────────────────────
function initProductionPage() {
    if (prodInitDone) {
        const active = document.querySelector('.prod-tab-btn.prod-tab-active');
        if (active) _renderProdPane(active.dataset.prodTab);
        return;
    }
    prodInitDone = true;

    // Letzten Kalkulator-Stand wiederherstellen
    try {
        const saved = localStorage.getItem('statev_kalk_items');
        if (saved) kalkItems = JSON.parse(saved);
    } catch (_) {}

    document.querySelectorAll('.prod-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.prod-tab-btn')
                .forEach(b => b.classList.toggle('prod-tab-active', b === btn));
            _renderProdPane(btn.dataset.prodTab);
        });
    });

    loadProductionData()
        .then(() => _renderProdAll())
        .catch(e => {
            console.error('[Production] Ladefehler:', e);
            const activeTab = document.querySelector('.prod-tab-btn.prod-tab-active')?.dataset.prodTab || 'produkte';
            const el = document.getElementById('prod-pane-' + activeTab)
                    || document.getElementById('prod-pane-produkte');
            if (el) el.innerHTML = `<div class="grid-card"><div class="info-text" style="color:var(--red)">
                Fehler beim Laden: ${escapeHtml(e.message)}<br><br>
                <button class="hero-btn" onclick="location.reload()">🔄 Seite neu laden</button>
            </div></div>`;
        });
}

function _renderProdAll() {
    const tab = document.querySelector('.prod-tab-btn.prod-tab-active')?.dataset.prodTab || 'produkte';
    _renderProdPane(tab);
}

function _renderProdPane(tab) {
    document.querySelectorAll('.prod-pane').forEach(p => {
        p.style.display = p.id === 'prod-pane-' + tab ? '' : 'none';
    });
    if (tab === 'rohstoffe')  renderRohstoffListe();
    if (tab === 'produkte')   renderProduktListe();
    if (tab === 'kalkulator') renderKalkulator();
    if (tab === 'bestellung') renderBestellung();
    if (tab === 'einkaeufe')  renderEinkaeufeListe();
}

// ── BOM ──────────────────────────────────────────────────────
function expandBOM(productId, targetQty, depth, seen) {
    seen = seen ? new Set(seen) : new Set();
    if (seen.has(productId)) return { rows: [{ kind: 'circular', depth }], rawCost: 0 };
    seen.add(productId);

    const p = (productionData.products || []).find(x => x.id === productId);
    if (!p) return { rows: [], rawCost: 0 };

    const outMenge = Math.max(1, p.outputMenge || 1);
    // Immer auf ganze Läufe aufrunden — halbe Produktionen gibt es nicht.
    // Kosten werden beim Eltern-Produkt anteilig verrechnet (siehe unten).
    const runs   = Math.ceil(targetQty / outMenge);
    const actual = runs * outMenge;
    const rows     = [];
    let rawCost    = 0;

    for (const z of (p.zutaten || [])) {
        const totalMenge = z.menge * runs;
        if (z.rohstoffId) {
            const rs = (productionData.rohstoffe || []).find(r => r.id === z.rohstoffId);
            if (rs) {
                const cost = totalMenge * (rs.preis || 0);
                // proratedCost: wird von übergeordneten Ebenen mit dem Anteil skaliert
                rows.push({ kind: 'rohstoff', name: rs.name, einheit: rs.einheit || '', menge: totalMenge, preis: rs.preis || 0, cost, proratedCost: cost, depth });
                rawCost += cost;
            }
        } else if (z.produktId) {
            const subProd = (productionData.products || []).find(x => x.id === z.produktId);
            if (subProd && subProd.verwendungspreis === 'gesamt') {
                // Gesamtpreis (VK inkl. Marge/Exportpreis) statt Produktionspreis verwenden —
                // BOM wird hier nicht weiter aufgeklappt, sondern als Pauschalpreis-Zeile geführt.
                const vk   = _calcVK(z.produktId);
                const cost = totalMenge * vk;
                rows.push({ kind: 'produkt-gesamt', name: subProd.name, einheit: subProd.einheit || '', menge: totalMenge, preis: vk, cost, proratedCost: cost, depth });
                rawCost += cost;
            } else {
                const sub = expandBOM(z.produktId, totalMenge, depth + 1, seen);
                // Anteilsfaktor: benötigte Menge ÷ tatsächliche Produktionsmenge (>= 1 Lauf)
                const factor  = sub.actual > 0 ? totalMenge / sub.actual : 1;
                const subCost = sub.rawCost * factor;
                // Eigene Zeile fürs Sub-Produkt selbst (Name/Menge/Kosten wie ein Rohstoff),
                // seine eigenen Zutaten folgen direkt darunter eingerückt.
                rows.push({ kind: 'subprodukt', name: subProd?.name || '?', einheit: subProd?.einheit || '', menge: totalMenge, cost: subCost, proratedCost: subCost, depth });
                const scaledChildren = sub.rows.map(r =>
                    (r.kind === 'rohstoff' || r.kind === 'produkt-gesamt' || r.kind === 'subprodukt')
                        ? { ...r, proratedCost: r.proratedCost * factor }
                        : r
                );
                rows.push(...scaledChildren);
                rawCost += subCost;
            }
        }
    }

    return { rows, rawCost, runs, actual, surplus: actual - targetQty };
}

function _getProductMarge(p) {
    if (p.marge !== null && p.marge !== undefined && p.marge !== '') return parseFloat(p.marge) || 0;
    return productionData.settings?.defaultMarge ?? 30;
}

function _calcUnitCost(productId) {
    const p = (productionData.products || []).find(x => x.id === productId);
    if (!p) return 0;
    const { rawCost, actual } = expandBOM(productId, p.outputMenge || 1, 0, null);
    return actual > 0 ? rawCost / actual : 0;
}

function _calcVK(productId) {
    const p = (productionData.products || []).find(x => x.id === productId);
    if (!p) return 0;
    if (p.exportPreis !== null && p.exportPreis !== undefined && p.exportPreis > 0) return p.exportPreis;
    const uc = _calcUnitCost(productId);
    const mg = _getProductMarge(p);
    return mg < 100 ? uc / (1 - mg / 100) : uc;
}

// ── Rohstoffe ─────────────────────────────────────────────────
function renderRohstoffListe(refocusSearch = false) {
    const el = document.getElementById('prod-pane-rohstoffe');
    if (!el) return;
    el.style.display = '';
    // Fokus nach Render wiederherstellen
    if (refocusSearch) {
        requestAnimationFrame(() => {
            const s = document.getElementById('rs-list-search');
            if (s) { s.focus(); const l = s.value.length; s.setSelectionRange(l, l); }
        });
    }

    const rs = (productionData.rohstoffe || [])
        .filter(r => !_prodSearchRS || r.name.toLowerCase().includes(_prodSearchRS.toLowerCase()))
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));

    const canEditRs = hasPerm('produktion.rohstoffe.edit');

    el.innerHTML = `
<div class="prod-toolbar">
    <input type="search" class="text-input prod-search" id="rs-list-search" placeholder="🔍 Rohstoff suchen…"
        value="${escapeHtml(_prodSearchRS)}" oninput="_prodSearchRS=this.value;renderRohstoffListe(true)">
    ${canEditRs ? `<button class="hero-btn" type="button" onclick="openRohstoffModal(null)">➕ Rohstoff anlegen</button>` : ''}
</div>
${rs.length ? `
<div class="prod-rs-table">
    <div class="prod-rs-header"><span>Name</span><span>Einheit</span><span>Preis / Einheit</span><span></span></div>
    ${rs.map(r => `<div class="prod-rs-row">
        <span class="prod-rs-name">${escapeHtml(r.name)}</span>
        <span class="prod-rs-einheit">${escapeHtml(r.einheit || '–')}</span>
        <span class="prod-rs-preis">${prodFmtMoney(r.preis)}</span>
        <span class="prod-rs-actions">
            ${canEditRs ? `
            <button class="icon-btn" onclick="openRohstoffModal('${escapeHtml(r.id)}')">✏️</button>
            <button class="icon-btn cv-del-btn" onclick="deleteRohstoff('${escapeHtml(r.id)}')">🗑</button>
            ` : ''}
        </span>
    </div>`).join('')}
</div>` : `<div class="grid-card" style="margin-top:12px"><div class="info-text">${_prodSearchRS ? 'Keine Ergebnisse.' : 'Noch keine Rohstoffe angelegt.'}</div></div>`}`;
}

function openRohstoffModal(id) {
    const rs = id ? (productionData.rohstoffe || []).find(r => r.id === id) : null;
    cvOpenModal({
        title: id ? `${escapeHtml(rs?.name || '')} bearbeiten` : 'Neuer Rohstoff',
        saveLabel: '💾 Speichern',
        bodyHTML: `<div class="cv-form-sections"><div class="cv-section"><div class="cv-form-row">
            <div class="cv-form-col">
                <label class="cv-label">Name *</label>
                <input class="form-control" id="rs-name" type="text" placeholder="z.B. Weizen" value="${escapeHtml(rs?.name || '')}">
            </div>
            <div class="cv-form-col">
                <label class="cv-label">Einheit</label>
                <select class="form-control" id="rs-einheit">
                    <option value="Stück"${(rs?.einheit||'Stück')==='Stück'?' selected':''}>Stück</option>
                    <option value="Liter"${rs?.einheit==='Liter'?' selected':''}>Liter</option>
                </select>
            </div>
            <div class="cv-form-col">
                <label class="cv-label">Preis / Einheit ($)</label>
                <input class="form-control" id="rs-preis" type="number" min="0" step="0.01" placeholder="0.00" value="${rs?.preis !== undefined && rs?.preis !== null ? _round2(rs.preis) : ''}">
            </div>
        </div></div></div>`,
        onSave: () => _saveRohstoffFromModal(id),
    });
}

async function _saveRohstoffFromModal(id) {
    const name = document.getElementById('rs-name')?.value?.trim() || '';
    if (!name) return cvModalErr('Name ist Pflicht.');
    cvModalBusy('Speichern…');
    try {
        await prodPost({
            action: 'save_rohstoff', id,
            name,
            einheit: document.getElementById('rs-einheit')?.value?.trim() || 'Stück',
            preis: parseFloat(document.getElementById('rs-preis')?.value) || 0,
        });
        await loadProductionData();
        cvCloseModal();
        renderRohstoffListe();
    } catch (e) { cvModalBusy(''); cvModalErr(e.message); }
}

async function deleteRohstoff(id) {
    const rs = (productionData.rohstoffe || []).find(r => r.id === id);
    if (!confirm(`"${rs?.name || 'Rohstoff'}" wirklich löschen?`)) return;
    try {
        await prodPost({ action: 'delete_rohstoff', id });
        productionData.rohstoffe = (productionData.rohstoffe || []).filter(r => r.id !== id);
        renderRohstoffListe();
    } catch (e) { alert('Fehler: ' + e.message); }
}

// ── Produkte ──────────────────────────────────────────────────
function _renderProduktListeInner() {
    const el = document.getElementById('prod-pane-produkte');
    if (!el) return;
    el.style.display = '';

    const defaultMarge = productionData.settings?.defaultMarge ?? 30;
    const rohstoffe    = productionData.rohstoffe || [];
    const allProducts  = productionData.products  || [];

    const viewCatsFertig     = prodAllowedCats('view', 'fertig');
    const viewCatsVorfertigt = prodAllowedCats('view', 'vorfertigt');
    const editCatsFertig     = prodAllowedCats('edit', 'fertig');
    const editCatsVorfertigt = prodAllowedCats('edit', 'vorfertigt');

    // Welche Typen (Produkte/Exportprodukte) hat der Nutzer überhaupt Zugriff auf?
    // Basiert darauf ob mind. ein Produkt dieses Typs in einer erlaubten Kategorie liegt — typ-getrennt.
    const visibleByCat = p => {
        const cats = p.typ === 'vorfertigt' ? viewCatsVorfertigt : viewCatsFertig;
        return cats === null || cats.includes((p.kategorie || '').trim());
    };
    const canSeeFertig     = allProducts.some(p => p.typ === 'fertig'     && visibleByCat(p));
    const canSeeVorfertigt = allProducts.some(p => p.typ === 'vorfertigt' && visibleByCat(p));

    // Falls der aktuell aktive Tab nicht sichtbar ist, auf den sichtbaren wechseln
    if (_prodTypFilter === 'vorfertigt' && !canSeeVorfertigt && canSeeFertig) _prodTypFilter = 'fertig';
    else if (_prodTypFilter === 'fertig' && !canSeeFertig && canSeeVorfertigt) _prodTypFilter = 'vorfertigt';

    const filtered = allProducts
        .filter(p => !_prodSearchProd || p.name.toLowerCase().includes(_prodSearchProd.toLowerCase()))
        .filter(p => !_prodTypFilter  || p.typ === _prodTypFilter)
        // Kategorie-Permission: null = alle sehen, sonst nur erlaubte Kategorien
        .filter(visibleByCat)
        .sort((a, b) => {
            if (_prodSortMode) {
                const ucA = _calcUnitCost(a.id), ucB = _calcUnitCost(b.id);
                const gA  = _calcVK(a.id) - ucA,  gB  = _calcVK(b.id) - ucB;
                const pA  = ucA > 0 ? gA / ucA * 100 : 0;
                const pB  = ucB > 0 ? gB / ucB * 100 : 0;
                if (_prodSortMode === 'gewinn_desc') return gB - gA;
                if (_prodSortMode === 'cost_asc')   return ucA - ucB;
                if (_prodSortMode === 'pct_desc')   return pB - pA;
            }
            const ca = (a.kategorie || '').trim(), cb = (b.kategorie || '').trim();
            if (!ca && cb) return 1; if (ca && !cb) return -1;
            const cmp = ca.localeCompare(cb, 'de');
            return cmp !== 0 ? cmp : (a.name || '').localeCompare(b.name || '', 'de');
        });

    const groups  = {};
    const hasCats = filtered.some(p => p.kategorie?.trim());
    for (const p of filtered) {
        const cat = (p.kategorie || '').trim();
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(p);
    }

    el.innerHTML = `
<div class="prod-toolbar" style="flex-wrap:wrap;gap:8px">
    <input type="search" class="text-input prod-search" id="prod-list-search" placeholder="🔍 Produkt suchen…"
        value="${escapeHtml(_prodSearchProd)}" oninput="_prodSearchProd=this.value;renderProduktListe(true)">
    <div class="prod-typ-pills">
        ${canSeeFertig ? `<button class="prod-typ-pill${_prodTypFilter==='fertig'?' prod-typ-active':''}" onclick="_prodTypFilter='fertig';_prodSortMode='';renderProduktListe()">Produkte</button>` : ''}
        ${canSeeVorfertigt ? `<button class="prod-typ-pill${_prodTypFilter==='vorfertigt'?' prod-typ-active':''}" onclick="_prodTypFilter='vorfertigt';renderProduktListe()">Exportprodukte</button>` : ''}
    </div>
    ${_prodTypFilter === 'vorfertigt' ? `<div class="prod-typ-pills">
        <button class="prod-typ-pill${!_prodSortMode?' prod-typ-active':''}" onclick="_prodSortMode='';renderProduktListe()">Standard</button>
        <button class="prod-typ-pill${_prodSortMode==='gewinn_desc'?' prod-typ-active':''}" onclick="_prodSortMode='gewinn_desc';renderProduktListe()">💰 Höchster Gewinn</button>
        <button class="prod-typ-pill${_prodSortMode==='cost_asc'?' prod-typ-active':''}" onclick="_prodSortMode='cost_asc';renderProduktListe()">📉 Niedr. Prod-Preis</button>
        <button class="prod-typ-pill${_prodSortMode==='pct_desc'?' prod-typ-active':''}" onclick="_prodSortMode='pct_desc';renderProduktListe()">📈 Höchste % Marge</button>
    </div>` : ''}
    ${(() => {
        const ec = _prodTypFilter === 'vorfertigt' ? editCatsVorfertigt : editCatsFertig;
        return ec === null || ec.length > 0;
    })() ? `
    <button class="hero-btn" type="button" onclick="openProdModal(null,'${_prodTypFilter}')">➕ Produkt anlegen</button>
    <button class="hero-btn" type="button" style="background:var(--bg-card);color:var(--text-muted);border:1px solid var(--border-color)" onclick="_openBulkRename()">✏️ Umbenennen</button>
    <button class="hero-btn" type="button" style="background:var(--bg-card);color:var(--text-muted);border:1px solid var(--border-color)" onclick="_openSwapZutat()">🔄 Zutat tauschen</button>
    ` : ''}
</div>
<div class="prod-marge-bar grid-card">
    <label class="contact-label" style="margin:0;white-space:nowrap">Allgemeine Marge:</label>
    <div style="display:flex;align-items:center;gap:10px;flex:1">
        <input type="number" class="text-input" id="prod-default-marge" min="0" max="99" step="1"
            style="width:80px" value="${defaultMarge}"
            ${hasPerm('produktion.produkte.edit') ? `onchange="_saveDefaultMarge(this.value)"` : 'disabled title="Keine Berechtigung zum Bearbeiten"'}>
        <span style="color:var(--text-muted);font-size:13px">%</span>
        <span style="color:var(--text-muted);font-size:12px">— gilt wenn kein eigener Wert gesetzt</span>
    </div>
</div>
${filtered.length
    ? Object.entries(groups).map(([cat, items]) => `
        ${hasCats ? `<div class="vc-cat-header">${escapeHtml(cat || 'Ohne Kategorie')}</div>` : ''}
        <div class="prod-karte-grid">${items.map(p => _buildProdCard(p, defaultMarge, rohstoffe, allProducts)).join('')}</div>
    `).join('')
    : `<div class="grid-card" style="margin-top:8px"><div class="info-text">${_prodSearchProd || _prodTypFilter ? 'Keine Ergebnisse.' : 'Noch keine Produkte angelegt.'}</div></div>`}`;
}

function renderProduktListe(refocusSearch = false) {
    _renderProduktListeInner();
    if (refocusSearch) {
        const s = document.getElementById('prod-list-search');
        if (s) { s.focus(); const l = s.value.length; s.setSelectionRange(l, l); }
    }
}

function _canEditProdCard(p) {
    const cats = prodAllowedCats('edit', p.typ === 'vorfertigt' ? 'vorfertigt' : 'fertig');
    if (cats === null) return true;
    return cats.includes((p.kategorie || '').trim());
}

function _buildProdCard(p, defaultMarge, rohstoffe, allProducts) {
    const marge       = (p.marge !== null && p.marge !== undefined && p.marge !== '') ? parseFloat(p.marge) : null;
    const margeEff    = marge !== null ? marge : (defaultMarge ?? 30);
    const exportPreis = (p.exportPreis !== null && p.exportPreis !== undefined && p.exportPreis > 0) ? p.exportPreis : null;
    const unitCost    = _calcUnitCost(p.id);
    const vkCalc      = _calcVK(p.id);
    const gewinnAbs   = vkCalc - unitCost;
    const gewinnPct   = unitCost > 0 ? (gewinnAbs / unitCost * 100) : 0;
    const pctColor    = gewinnPct >= 20 ? 'var(--emerald)' : gewinnPct >= 0 ? 'var(--primary)' : 'var(--red)';
    const zutatItems = (p.zutaten || [])
        .map(z => {
            if (z.rohstoffId) {
                const rs = rohstoffe.find(r => r.id === z.rohstoffId);
                if (!rs) return null;
                return { name: rs.name, einheit: rs.einheit || '', menge: z.menge, cost: z.menge * (rs.preis || 0) };
            }
            if (z.produktId) {
                const sub = allProducts.find(x => x.id === z.produktId);
                if (!sub) return null;
                return { name: sub.name, einheit: sub.einheit || '', menge: z.menge, cost: z.menge * _calcUnitCost(z.produktId) };
            }
            return null;
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));

    const zutatHtml = zutatItems.length ? `
        <div class="prod-zutaten-list">
            <div class="prod-zutaten-lbl">Zutaten (pro Durchlauf)</div>
            ${zutatItems.map(z => `<div class="prod-zutat-item">
                <span class="prod-zutat-dot">•</span>
                <span class="prod-zutat-iname">${escapeHtml(z.name)}</span>
                <span class="prod-zutat-iqty">${prodFmtN(z.menge)} ${escapeHtml(z.einheit)}</span>
                <span class="prod-zutat-icost">${prodFmtMoney(z.cost)}</span>
            </div>`).join('')}
        </div>` : '';

    return `<div class="grid-card" style="margin-bottom:0">
        <div style="margin-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
                <strong style="font-size:14px;flex:1">${escapeHtml(p.name)}</strong>
                <span style="font-size:11px;font-weight:700;padding:2px 7px;border-radius:20px;background:${pctColor}22;color:${pctColor};white-space:nowrap">${gewinnPct >= 0 ? '+' : ''}${gewinnPct.toFixed(0)}%</span>
            </div>
            ${_canEditProdCard(p) ? `<div class="cv-card-actions">
                <button class="icon-btn" onclick="openProdModal('${escapeHtml(p.id)}')">✏️ Bearbeiten</button>
                <button class="icon-btn cv-del-btn" onclick="deleteProd('${escapeHtml(p.id)}')">🗑 Löschen</button>
            </div>` : ''}
        </div>
        <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px">
            1 Durchlauf → <strong style="color:var(--text-main)">${prodFmtN(p.outputMenge||1)} ${escapeHtml(p.einheit||'Stück')}</strong>
            ${exportPreis
                ? `· Export Preis: <strong style="color:var(--primary)">${prodFmtMoney(exportPreis)}</strong>`
                : `· Marge: <strong style="color:var(--text-main)">${marge !== null ? marge+'%' : defaultMarge+'% (Standard)'}</strong>`}
        </div>
        ${_priceBlockHtml(unitCost, margeEff, 1, exportPreis)}
        ${zutatHtml}
    </div>`;
}

async function _saveDefaultMarge(val) {
    const marge = Math.max(0, Math.min(99, parseFloat(val) || 0));
    try {
        await prodPost({ action: 'save_settings', defaultMarge: marge });
        productionData.settings.defaultMarge = marge;
        renderProduktListe();
    } catch (e) { console.error('Marge speichern:', e.message); }
}

// ── Produkt-Modal ─────────────────────────────────────────────
function openProdModal(id, defaultTyp) {
    const existing   = id ? (productionData.products || []).find(p => p.id === id) : null;
    const p          = existing || {};
    // Wenn neues Produkt: Tab-Filter als Standard-Typ verwenden
    const initTyp    = p.typ || (id ? 'fertig' : (defaultTyp === 'vorfertigt' ? 'vorfertigt' : 'fertig'));
    const rohstoffe  = (productionData.rohstoffe || []).sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const otherProds = (productionData.products  || []).filter(x => x.id !== id && x.typ !== 'vorfertigt').sort((a, b) => a.name.localeCompare(b.name, 'de'));
    const existZut   = p.zutaten || [];

    // Checked items zuerst, dann A-Z
    const sortCheckedFirst = (arr, checkFn) => [
        ...arr.filter(checkFn),
        ...arr.filter(x => !checkFn(x)),
    ];

    const rsChecked   = r  => existZut.some(z => z.rohstoffId === r.id);
    const prodChecked = op => existZut.some(z => z.produktId  === op.id);

    const buildRsRow = (r, selected) => {
        const z = existZut.find(z => z.rohstoffId === r.id);
        return `<div class="prod-zutat-check-row prod-zutat-checked" data-name="${escapeHtml(r.name.toLowerCase())}" data-source="rs">
            <label class="prod-zutat-check-label">
                <input type="checkbox" class="prod-zutat-cb" data-rs-id="${escapeHtml(r.id)}"
                    onchange="prodCbChange(this)" checked>
                <span class="prod-zutat-cb-name">${escapeHtml(r.name)}</span>
                <span class="prod-zutat-cb-einheit">${escapeHtml(r.einheit||'')}</span>
            </label>
            <div class="prod-zutat-menge-wrap">
                <span class="prod-zutat-menge-x">×</span>
                <input type="number" class="form-control prod-zutat-menge" min="0.01" step="0.01"
                    placeholder="0" value="${z ? z.menge : '1'}">
                <span class="prod-zutat-menge-unit">${escapeHtml(r.einheit||'')}</span>
            </div>
        </div>`;
    };

    const buildRsRowUnchecked = r => {
        return `<div class="prod-zutat-check-row" data-name="${escapeHtml(r.name.toLowerCase())}" data-source="rs">
            <label class="prod-zutat-check-label">
                <input type="checkbox" class="prod-zutat-cb" data-rs-id="${escapeHtml(r.id)}"
                    onchange="prodCbChange(this)">
                <span class="prod-zutat-cb-name">${escapeHtml(r.name)}</span>
                <span class="prod-zutat-cb-einheit">${escapeHtml(r.einheit||'')}</span>
            </label>
            <div class="prod-zutat-menge-wrap" style="display:none">
                <span class="prod-zutat-menge-x">×</span>
                <input type="number" class="form-control prod-zutat-menge" min="0.01" step="0.01" placeholder="0">
                <span class="prod-zutat-menge-unit">${escapeHtml(r.einheit||'')}</span>
            </div>
        </div>`;
    };

    const buildProdRow = (op, selected) => {
        const z = existZut.find(z => z.produktId === op.id);
        return `<div class="prod-zutat-check-row prod-zutat-checked" data-name="${escapeHtml(op.name.toLowerCase())}" data-source="prod">
            <label class="prod-zutat-check-label">
                <input type="checkbox" class="prod-zutat-cb" data-prod-id="${escapeHtml(op.id)}"
                    onchange="prodCbChange(this)" checked>
                <span class="prod-zutat-cb-name">${escapeHtml(op.name)}</span>
                <span class="prod-zutat-cb-einheit" style="color:rgba(99,102,241,.8)">${escapeHtml(op.einheit||'')}</span>
            </label>
            <div class="prod-zutat-menge-wrap">
                <span class="prod-zutat-menge-x">×</span>
                <input type="number" class="form-control prod-zutat-menge" min="0.01" step="0.01"
                    placeholder="0" value="${z ? z.menge : '1'}">
                <span class="prod-zutat-menge-unit">${escapeHtml(op.einheit||'')}</span>
            </div>
        </div>`;
    };

    const buildProdRowUnchecked = op => {
        return `<div class="prod-zutat-check-row" data-name="${escapeHtml(op.name.toLowerCase())}" data-source="prod">
            <label class="prod-zutat-check-label">
                <input type="checkbox" class="prod-zutat-cb" data-prod-id="${escapeHtml(op.id)}"
                    onchange="prodCbChange(this)">
                <span class="prod-zutat-cb-name">${escapeHtml(op.name)}</span>
                <span class="prod-zutat-cb-einheit" style="color:rgba(99,102,241,.8)">${escapeHtml(op.einheit||'')}</span>
            </label>
            <div class="prod-zutat-menge-wrap" style="display:none">
                <span class="prod-zutat-menge-x">×</span>
                <input type="number" class="form-control prod-zutat-menge" min="0.01" step="0.01" placeholder="0">
                <span class="prod-zutat-menge-unit">${escapeHtml(op.einheit||'')}</span>
            </div>
        </div>`;
    };

    // Checked / unchecked trennen
    const rsCheckedList   = rohstoffe.filter(rsChecked).sort((a,b) => a.name.localeCompare(b.name,'de'));
    const rsUnchecked     = rohstoffe.filter(r => !rsChecked(r)).sort((a,b) => a.name.localeCompare(b.name,'de'));
    const prodsChecked    = otherProds.filter(prodChecked);
    const prodsUnchecked  = otherProds.filter(op => !prodChecked(op));

    // Unchecked Produkte nach Kategorie gruppieren
    const _prodCatMap = {};
    prodsUnchecked.forEach(op => {
        const cat = op.kategorie?.trim() || '';
        if (!_prodCatMap[cat]) _prodCatMap[cat] = [];
        _prodCatMap[cat].push(op);
    });
    const prodCatGroups = Object.keys(_prodCatMap)
        .sort((a, b) => { if (!a) return 1; if (!b) return -1; return a.localeCompare(b, 'de'); })
        .map(cat => ({ cat, items: _prodCatMap[cat] }));
    const hasProdCats = prodCatGroups.some(g => g.cat);

    const hasSelected = rsCheckedList.length > 0 || prodsChecked.length > 0;

    const existKats      = [...new Set((productionData.products||[]).filter(x => x.typ === initTyp).map(x=>x.kategorie).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de'));
    const margeVal       = (p.marge !== null && p.marge !== undefined && p.marge !== '') ? _round2(p.marge) : '';
    const exportPreisVal = (p.exportPreis !== null && p.exportPreis !== undefined && p.exportPreis > 0) ? _round2(p.exportPreis) : '';
    const verwendungspreis = p.verwendungspreis === 'gesamt' ? 'gesamt' : 'prod';

    cvOpenModal({
        title:      id ? `${escapeHtml(p.name||'')} bearbeiten` : 'Neues Produkt',
        extraWide:  true,
        saveLabel:  '💾 Produkt speichern',
        bodyHTML: `
<div class="prod-modal-layout">
    <!-- Linke Spalte: Produktdetails -->
    <div class="prod-modal-left">
        <div class="cv-section-title" style="margin-bottom:16px">Details</div>

        <label class="cv-label">Name *</label>
        <input class="form-control" id="p-name" type="text" placeholder="Produktname" value="${escapeHtml(p.name||'')}" style="margin-bottom:12px">

        <label class="cv-label">Kategorie</label>
        ${existKats.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px" id="pm-kat-chips">
            ${existKats.map(c => `<button type="button"
                class="prod-typ-pill${(p.kategorie||'')===c?' prod-typ-active':''}"
                style="font-size:11px;padding:3px 10px"
                data-kat="${escapeHtml(c)}"
                onclick="_prodPickKat(this)"
                >${escapeHtml(c)}</button>`).join('')}
        </div>` : ''}
        <input class="form-control" id="p-kat" type="text"
            placeholder="Neue Kategorie eingeben…" value="${escapeHtml(p.kategorie||'')}"
            style="margin-bottom:12px"
            oninput="_prodKatDeselect()">

        <div class="cv-form-row" style="margin-bottom:12px">
            <div class="cv-form-col">
                <label class="cv-label">Einheit</label>
                <select class="form-control" id="p-einheit">
                    <option value="Stück"${(p.einheit||'Stück')==='Stück'?' selected':''}>Stück</option>
                    <option value="Liter"${p.einheit==='Liter'?' selected':''}>Liter</option>
                </select>
            </div>
            <div class="cv-form-col">
                <label class="cv-label">Ausgabe / Durchlauf *</label>
                <input class="form-control" id="p-out" type="number" min="1" step="0.01"
                    placeholder="5" value="${prodFmtN(p.outputMenge||1)}">
            </div>
        </div>

        <div style="border-top:1px solid var(--border-color);padding-top:14px;margin-bottom:12px">
            <div class="cv-section-title" style="margin-bottom:12px">Preiskalkulation</div>
            <label class="cv-label">Marge % <span style="font-weight:400;color:var(--text-muted)">(leer = Standard ${productionData.settings?.defaultMarge??30}%)</span></label>
            <input class="form-control" id="p-marge" type="number" min="0" max="99" step="1"
                placeholder="${productionData.settings?.defaultMarge??30}" value="${margeVal}" style="margin-bottom:12px">

            <label class="cv-label">Export Preis / Einheit <span style="font-weight:400;color:var(--text-muted)">(überschreibt Marge)</span></label>
            <input class="form-control" id="p-export" type="number" min="0" step="0.01"
                placeholder="z.B. 25.00" value="${exportPreisVal}" style="margin-bottom:12px">

            <label class="cv-label" style="margin-bottom:8px;display:block">Verwendungspreis <span style="font-weight:400;color:var(--text-muted)">(wenn dieses Produkt als Zutat in einem anderen verwendet wird)</span></label>
            <div class="prod-typ-pills">
                <label class="prod-typ-pill-radio">
                    <input type="radio" name="p-verwendungspreis" value="prod" ${verwendungspreis==='prod'?' checked':''}>Produktionspreis
                </label>
                <label class="prod-typ-pill-radio">
                    <input type="radio" name="p-verwendungspreis" value="gesamt" ${verwendungspreis==='gesamt'?' checked':''}>Gesamtpreis (VK)
                </label>
            </div>
        </div>

        <div style="border-top:1px solid var(--border-color);padding-top:14px">
            <label class="cv-label" style="margin-bottom:8px;display:block">Typ</label>
            <div class="prod-typ-pills">
                <label class="prod-typ-pill-radio">
                    <input type="radio" name="p-typ" value="fertig" ${initTyp==='fertig'?' checked':''}>Produkt
                </label>
                <label class="prod-typ-pill-radio">
                    <input type="radio" name="p-typ" value="vorfertigt" ${initTyp==='vorfertigt'?' checked':''}>Exportprodukt
                </label>
            </div>
        </div>

        <!-- Ausgewählte Zutaten -->
        <div id="pm-selected-section" style="border-top:1px solid var(--border-color);padding-top:14px;margin-top:14px${hasSelected?'':';display:none'}">
            <div class="cv-label" style="margin-bottom:8px;display:block;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted)">Ausgewählte Zutaten</div>
            <div id="pm-selected-list" class="prod-zutat-check-list">
                ${rsCheckedList.map(r => buildRsRow(r)).join('')}
                ${prodsChecked.map(op => buildProdRow(op)).join('')}
            </div>
        </div>
    </div>

    <!-- Rechte Spalte: Alle verfügbaren Zutaten (nur unchecked) -->
    <div class="prod-modal-right">
        <div class="cv-section-title" style="margin-bottom:10px">Zutaten <span style="font-weight:400;font-size:12px;color:var(--text-muted)">(Menge pro Durchlauf)</span></div>

        <!-- Schnelleingabe per Text -->
        <div style="margin-bottom:10px;flex-shrink:0">
            <textarea id="pm-text-input" class="form-control" rows="2"
                placeholder="Schnelleingabe: Baumstamm 5, Eisenerz x2&#10;Oder eine Zutat pro Zeile"
                style="resize:none;font-size:12px;line-height:1.5"
                oninput="_prodTextInputPreview(this.value)"></textarea>
            <div id="pm-text-preview" style="font-size:11px;margin-top:4px;min-height:16px"></div>
            <button type="button" class="hero-btn" style="margin-top:6px;width:100%;padding:6px"
                onclick="_prodTextInputApply()">↩ Zutaten übernehmen</button>
        </div>

        <input type="search" class="text-input prod-search" style="margin-bottom:12px;flex-shrink:0"
            placeholder="🔍 Zutat suchen…" oninput="_filterProdZutaten(this.value)">

        <div class="prod-modal-right-scroll">
        ${rsUnchecked.length ? `
        <div class="prod-zutat-group-label">Rohstoffe</div>
        <div id="pm-rs-list" class="prod-zutat-check-list">${rsUnchecked.map(buildRsRowUnchecked).join('')}</div>` : ''}

        ${prodCatGroups.length ? `
        <div class="prod-zutat-group-label" style="margin-top:12px">Produkte</div>
        <div id="pm-prod-lists">
        ${prodCatGroups.map(g => `
            ${hasProdCats && g.cat ? `<div class="prod-zutat-cat-sublabel">${escapeHtml(g.cat)}</div>` : ''}
            <div class="prod-zutat-check-list">${g.items.map(buildProdRowUnchecked).join('')}</div>
        `).join('')}
        </div>` : ''}

        ${!rsUnchecked.length && !prodCatGroups.length ? `<div class="info-text" style="color:var(--text-muted);font-size:13px">${rohstoffe.length ? 'Alle Zutaten bereits ausgewählt.' : 'Keine Rohstoffe vorhanden.'}</div>` : ''}
        </div>
    </div>
</div>`,
        onSave: () => _saveProdFromModal(id),
    });
}

window.prodCbChange = (cb) => {
    const row  = cb.closest('.prod-zutat-check-row');
    const wrap = row?.querySelector('.prod-zutat-menge-wrap');
    if (!wrap) return;

    const selectedList    = document.getElementById('pm-selected-list');
    const selectedSection = document.getElementById('pm-selected-section');

    if (cb.checked) {
        // → linke Spalte (ausgewählte Zutaten)
        wrap.style.display = 'flex';
        row.classList.add('prod-zutat-checked');
        const input = wrap.querySelector('input[type=number]');
        if (input && !input.value) input.value = 1;
        if (selectedList) selectedList.prepend(row);
        if (selectedSection) selectedSection.style.display = '';
        setTimeout(() => wrap.querySelector('input[type=number]')?.select(), 50);
    } else {
        // → rechte Spalte zurück (in passende Liste)
        wrap.style.display = 'none';
        row.classList.remove('prod-zutat-checked');
        const input = wrap.querySelector('input[type=number]');
        if (input) input.value = '';

        const source = row.dataset.source;
        if (source === 'rs') {
            const rsList = document.getElementById('pm-rs-list');
            if (rsList) rsList.append(row);
        } else {
            const prodLists = document.getElementById('pm-prod-lists');
            const firstList = prodLists?.querySelector('.prod-zutat-check-list');
            if (firstList) firstList.append(row);
        }

        // Section ausblenden wenn leer
        if (selectedList && selectedSection && selectedList.children.length === 0) {
            selectedSection.style.display = 'none';
        }
    }
};

// Fuzzy-Match: gibt Score zurück (0 = kein Match, höher = besser)
function _fuzzyScore(name, query) {
    const n = name.toLowerCase(), q = query.toLowerCase().trim();
    if (!q) return 0;
    if (n === q) return 100;
    if (n.startsWith(q)) return 80;
    if (n.includes(q)) return 60;
    // Alle Wörter des Queries müssen im Namen vorkommen
    const words = q.split(/\s+/);
    if (words.length > 1 && words.every(w => n.includes(w))) return 50;
    // Teilwort-Match (mind. 3 Zeichen)
    if (q.length >= 3 && n.includes(q.slice(0, Math.ceil(q.length * 0.7)))) return 30;
    return 0;
}

// Parst eine Zeile wie "Baumstamm 5" oder "Eisenerz x2" oder "Holzbrett: 10"
function _parseZutatLine(line) {
    line = line.trim();
    if (!line) return null;
    // Zahl am Ende (optional mit x oder :)
    const m = line.match(/^(.*?)[\s:x×*]+(\d+(?:[.,]\d+)?)$/i)
           || line.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/); // Zahl am Anfang
    if (m) {
        const isNumFirst = /^\d/.test(m[0]) && /^\d/.test(m[1]);
        const name  = isNumFirst ? m[2].trim() : m[1].trim();
        const menge = parseFloat((isNumFirst ? m[1] : m[2]).replace(',', '.'));
        return { name, menge: isNaN(menge) ? 1 : menge };
    }
    return { name: line, menge: 1 };
}

function _prodTextSplitLines(text) {
    const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
    let nameOverride = null;
    let ingredientLines = [];
    // Erste Zeile ohne Zahl = Produktname (nur wenn mehrere Zeilen)
    if (rawLines.length >= 2 && !/\d/.test(rawLines[0])) {
        nameOverride = rawLines[0];
        ingredientLines = rawLines.slice(1);
    } else {
        // Innerhalb einer Zeile: Komma-getrennt als Zutaten
        ingredientLines = rawLines.flatMap(l => l.split(',').map(x => x.trim())).filter(Boolean);
    }
    return { nameOverride, ingredientLines };
}

window._prodTextInputPreview = (text) => {
    const preview = document.getElementById('pm-text-preview');
    if (!preview) return;
    const rohstoffe = productionData.rohstoffe || [];
    const products  = productionData.products  || [];
    const { nameOverride, ingredientLines } = _prodTextSplitLines(text);
    const lines = ingredientLines;
    if (!lines.length && !nameOverride) { preview.innerHTML = ''; return; }

    const parts = [];
    if (nameOverride) parts.push(`<span style="color:var(--primary);margin-right:8px">📝 ${escapeHtml(nameOverride)}</span>`);

    const results = lines.map(line => {
        const parsed = _parseZutatLine(line);
        if (!parsed) return null;
        // Suche in Rohstoffen
        let best = null, bestScore = 0;
        for (const r of rohstoffe) {
            const s = _fuzzyScore(r.name, parsed.name);
            if (s > bestScore) { bestScore = s; best = { type: 'rs', item: r }; }
        }
        for (const p of products) {
            const s = _fuzzyScore(p.name, parsed.name);
            if (s > bestScore) { bestScore = s; best = { type: 'prod', item: p }; }
        }
        return { parsed, match: bestScore >= 30 ? best : null, score: bestScore };
    }).filter(Boolean);

    parts.push(...results.map(r => {
        if (r.match) return `<span style="color:var(--emerald);margin-right:8px">✓ ${escapeHtml(r.match.item.name)} ×${r.parsed.menge}</span>`;
        return `<span style="color:var(--red);margin-right:8px">✗ ${escapeHtml(r.parsed.name)}</span>`;
    }));
    preview.innerHTML = parts.join('');
};

window._prodTextInputApply = () => {
    const textarea = document.getElementById('pm-text-input');
    if (!textarea) return;
    const text = textarea.value;
    const rohstoffe = productionData.rohstoffe || [];
    const products  = productionData.products  || [];
    const { nameOverride, ingredientLines } = _prodTextSplitLines(text);
    const lines = ingredientLines;

    // Name setzen falls erkannt
    if (nameOverride) {
        const nameEl = document.getElementById('p-name');
        if (nameEl) nameEl.value = nameOverride;
    }

    for (const line of lines) {
        const parsed = _parseZutatLine(line);
        if (!parsed) continue;

        let best = null, bestScore = 0;
        for (const r of rohstoffe) {
            const s = _fuzzyScore(r.name, parsed.name);
            if (s > bestScore) { bestScore = s; best = { type: 'rs', id: r.id }; }
        }
        for (const p of products) {
            const s = _fuzzyScore(p.name, parsed.name);
            if (s > bestScore) { bestScore = s; best = { type: 'prod', id: p.id }; }
        }
        if (bestScore < 30 || !best) continue;

        // Checkbox finden und aktivieren
        const attr = best.type === 'rs' ? `data-rs-id="${best.id}"` : `data-prod-id="${best.id}"`;
        const cb = document.querySelector(`.prod-zutat-cb[${best.type === 'rs' ? 'data-rs-id' : 'data-prod-id'}="${best.id}"]`);
        if (!cb) continue;

        if (!cb.checked) {
            cb.checked = true;
            prodCbChange(cb);
        }
        // Menge setzen
        const row  = cb.closest('.prod-zutat-check-row');
        const inp  = row?.querySelector('input[type=number]');
        if (inp) inp.value = parsed.menge;
    }

    textarea.value = '';
    document.getElementById('pm-text-preview').innerHTML = '';
};

// ── Such-Dropdown für Produktauswahl (Kalkulator/Bestellung) ───
// Ersetzt native <select> mit langer Optionsliste durch ein durchsuchbares Dropdown.
function _prodSearchSelectHtml(prefix, idx, products, currentId, onSelectFnName) {
    const uid     = `${prefix}-${idx}`;
    const current = products.find(p => p.id === currentId);
    const optsHtml = products.map(p =>
        `<div class="prod-search-select-opt${p.id===currentId?' pss-selected':''}" data-name="${escapeHtml(p.name.toLowerCase())}"
            onclick="${onSelectFnName}(${idx},'${escapeHtml(p.id)}');_pssClose('${uid}')">${escapeHtml(p.name)}</div>`
    ).join('');
    return `<div class="prod-search-select" id="pss-${uid}">
        <input type="text" class="contact-select prod-search-select-input" readonly
            value="${escapeHtml(current?.name || '— wählen —')}"
            onclick="_pssToggle('${uid}')">
        <div class="prod-search-select-panel" id="pss-panel-${uid}">
            <input type="search" class="text-input prod-search-select-search" placeholder="🔍 Produkt suchen…"
                oninput="_pssFilter('${uid}', this.value)" onclick="event.stopPropagation()">
            <div class="prod-search-select-list" id="pss-list-${uid}">${optsHtml || '<div class="prod-search-select-empty">Keine Produkte</div>'}</div>
        </div>
    </div>`;
}

// .grid-card nutzt backdrop-filter, was einen eigenen Stacking-Context erzeugt —
// ein simples z-index am Panel reicht dann nicht, da nachfolgende Geschwister-Karten
// trotzdem darüber gerendert werden. Lösung: die umschließende Karte beim Öffnen
// kurzzeitig selbst über ihre Geschwister heben (eigener Stacking-Context, aber höher).
function _pssClosePanel(panel) {
    panel.classList.remove('pss-open');
    const host = panel.closest('.grid-card');
    if (host) host.classList.remove('pss-host-elevated');
}
window._pssToggle = (uid) => {
    const panel   = document.getElementById(`pss-panel-${uid}`);
    const wasOpen = panel?.classList.contains('pss-open');
    document.querySelectorAll('.prod-search-select-panel.pss-open').forEach(_pssClosePanel);
    if (panel && !wasOpen) {
        const host = panel.closest('.grid-card');
        if (host) host.classList.add('pss-host-elevated');
        panel.classList.add('pss-open');
        const search = panel.querySelector('.prod-search-select-search');
        if (search) { search.value = ''; _pssFilter(uid, ''); setTimeout(() => search.focus(), 0); }
    }
};
window._pssClose = (uid) => {
    const panel = document.getElementById(`pss-panel-${uid}`);
    if (panel) _pssClosePanel(panel);
};
window._pssFilter = (uid, q) => {
    q = q.toLowerCase().trim();
    document.querySelectorAll(`#pss-list-${uid} .prod-search-select-opt`).forEach(opt => {
        opt.style.display = !q || opt.dataset.name.includes(q) ? '' : 'none';
    });
};
document.addEventListener('click', (e) => {
    if (!e.target.closest('.prod-search-select')) {
        document.querySelectorAll('.prod-search-select-panel.pss-open').forEach(_pssClosePanel);
    }
});

window._filterProdZutaten = (q) => {
    q = q.toLowerCase();
    document.querySelectorAll('.prod-zutat-check-row').forEach(row => {
        row.style.display = !q || (row.dataset.name||'').includes(q) ? '' : 'none';
    });
};

window._openSwapZutat = () => {
    const rohstoffe = productionData.rohstoffe || [];
    const products  = productionData.products  || [];

    // Alle Zutaten die irgendwo verwendet werden
    const allZutaten = [];
    for (const r of rohstoffe) allZutaten.push({ key: `rs:${r.id}`, label: r.name, type: 'rs', id: r.id });
    for (const p of products)  allZutaten.push({ key: `prod:${p.id}`, label: `${p.name} (Produkt)`, type: 'prod', id: p.id });
    allZutaten.sort((a,b) => a.label.localeCompare(b.label,'de'));

    const opts = allZutaten.map(z => `<option value="${z.key}">${escapeHtml(z.label)}</option>`).join('');

    const renderPreview = () => {
        const fromKey = document.getElementById('sz-from')?.value;
        const toKey   = document.getElementById('sz-to')?.value;
        const prev    = document.getElementById('sz-preview');
        if (!prev) return;
        if (!fromKey || !toKey || fromKey === toKey) {
            prev.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Alte und neue Zutat auswählen…</span>';
            return;
        }
        const [fromType, fromId] = fromKey.split(':');
        const matches = products.filter(p =>
            (p.zutaten||[]).some(z =>
                fromType === 'rs' ? z.rohstoffId === fromId : z.produktId === fromId
            )
        );
        const toZ = allZutaten.find(z => z.key === toKey);
        if (!matches.length) {
            prev.innerHTML = '<span style="color:var(--red);font-size:12px">Keine Produkte verwenden diese Zutat</span>';
            return;
        }
        prev.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${matches.length} Produkt${matches.length!==1?'e':''} betroffen:</div>`
            + matches.map(p => `<div style="font-size:12px;margin-bottom:2px">• ${escapeHtml(p.name)}</div>`).join('');
        window._szData = { fromType, fromId, toKey, toZ, matches };
    };

    window._szData = null;
    cvOpenModal({
        title: 'Zutat tauschen',
        wide: true,
        saveLabel: 'Tauschen',
        bodyHTML: `
            <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:end;margin-bottom:12px">
                <div>
                    <label class="cv-label">Alte Zutat (ersetzen)</label>
                    <select class="form-control" id="sz-from" onchange="_szPreview()">
                        <option value="">— auswählen —</option>${opts}
                    </select>
                </div>
                <div style="padding-bottom:8px;color:var(--text-muted);font-size:18px">→</div>
                <div>
                    <label class="cv-label">Neue Zutat</label>
                    <select class="form-control" id="sz-to" onchange="_szPreview()">
                        <option value="">— auswählen —</option>${opts}
                    </select>
                </div>
            </div>
            <div id="sz-preview" style="background:var(--bg-page);border:1px solid var(--border-color);border-radius:8px;padding:10px;max-height:220px;overflow-y:auto">
                <span style="color:var(--text-muted);font-size:12px">Alte und neue Zutat auswählen…</span>
            </div>`,
        onSave: async () => {
            const d = window._szData;
            if (!d?.matches?.length) return;
            cvModalBusy('Speichern…');
            const [toType, toId] = d.toKey.split(':');
            try {
                for (const p of d.matches) {
                    const newZutaten = (p.zutaten||[]).map(z => {
                        const isMatch = d.fromType === 'rs' ? z.rohstoffId === d.fromId : z.produktId === d.fromId;
                        if (!isMatch) return z;
                        const out = { menge: z.menge };
                        if (toType === 'rs') out.rohstoffId = toId;
                        else out.produktId = toId;
                        return out;
                    });
                    await prodPost({ action: 'save_product', id: p.id, name: p.name,
                        typ: p.typ, marge: p.marge ?? null, exportPreis: p.exportPreis ?? null,
                        kategorie: p.kategorie || '', einheit: p.einheit || 'Stück',
                        verwendungspreis: p.verwendungspreis || 'prod',
                        outputMenge: p.outputMenge || 1, zutaten: newZutaten });
                }
                await loadProductionData();
                cvCloseModal();
                renderProduktListe();
            } catch (e) { cvModalBusy(''); cvModalErr(e.message); }
        }
    });
    window._szPreview = renderPreview;
};

window._openBulkRename = () => {
    const products = productionData.products || [];
    const renderPreview = () => {
        const find    = document.getElementById('br-find')?.value || '';
        const replace = document.getElementById('br-replace')?.value || '';
        const exact   = document.getElementById('br-exact')?.checked;
        const prev    = document.getElementById('br-preview');
        if (!prev) return;
        if (!find) { prev.innerHTML = '<span style="color:var(--text-muted);font-size:12px">Suchbegriff eingeben…</span>'; return; }
        const matches = products.map(p => {
            let newName;
            if (exact) newName = p.name === find ? replace : null;
            else newName = p.name.includes(find) ? p.name.replaceAll(find, replace) : null;
            return newName !== null ? { p, newName } : null;
        }).filter(Boolean);
        if (!matches.length) { prev.innerHTML = '<span style="color:var(--red);font-size:12px">Keine Treffer</span>'; return; }
        prev.innerHTML = `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px">${matches.length} Produkt${matches.length!==1?'e':''} betroffen:</div>`
            + matches.map(({p, newName}) =>
                `<div style="display:flex;gap:6px;align-items:center;font-size:12px;margin-bottom:3px">
                    <span style="color:var(--red);text-decoration:line-through">${escapeHtml(p.name)}</span>
                    <span style="color:var(--text-muted)">→</span>
                    <span style="color:var(--emerald)">${escapeHtml(newName)}</span>
                </div>`
            ).join('');
        window._brMatches = matches;
    };

    window._brMatches = [];
    cvOpenModal({
        title: 'Produktnamen ersetzen',
        wide: true,
        saveLabel: 'Umbenennen',
        bodyHTML: `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
                <div>
                    <label class="cv-label">Suchen</label>
                    <input class="form-control" id="br-find" type="text" placeholder="z.B. Verp." oninput="_openBulkRenamePreview()">
                </div>
                <div>
                    <label class="cv-label">Ersetzen durch</label>
                    <input class="form-control" id="br-replace" type="text" placeholder="z.B. Verpackter" oninput="_openBulkRenamePreview()">
                </div>
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;margin-bottom:12px;cursor:pointer">
                <input type="checkbox" id="br-exact" onchange="_openBulkRenamePreview()">
                Nur exakte Übereinstimmung (ganzer Name)
            </label>
            <div id="br-preview" style="background:var(--bg-page);border:1px solid var(--border-color);border-radius:8px;padding:10px;max-height:220px;overflow-y:auto">
                <span style="color:var(--text-muted);font-size:12px">Suchbegriff eingeben…</span>
            </div>`,
        onSave: async () => {
            const matches = window._brMatches || [];
            if (!matches.length) return;
            cvModalBusy('Speichern…');
            try {
                for (const { p, newName } of matches) {
                    await prodPost({ action: 'save_product', id: p.id, name: newName,
                        typ: p.typ, marge: p.marge ?? null, exportPreis: p.exportPreis ?? null,
                        kategorie: p.kategorie || '', einheit: p.einheit || 'Stück',
                        verwendungspreis: p.verwendungspreis || 'prod',
                        outputMenge: p.outputMenge || 1, zutaten: p.zutaten || [] });
                }
                await loadProductionData();
                cvCloseModal();
                renderProduktListe();
            } catch (e) { cvModalBusy(''); cvModalErr(e.message); }
        }
    });
    window._openBulkRenamePreview = renderPreview;
};

window._prodPickKat = (btn) => {
    const kat = btn.dataset.kat;
    const inp = document.getElementById('p-kat');
    if (inp) inp.value = kat;
    document.querySelectorAll('#pm-kat-chips .prod-typ-pill').forEach(b =>
        b.classList.toggle('prod-typ-active', b === btn));
};

window._prodKatDeselect = () => {
    document.querySelectorAll('#pm-kat-chips .prod-typ-pill').forEach(b =>
        b.classList.remove('prod-typ-active'));
};

async function _saveProdFromModal(id) {
    const name = document.getElementById('p-name')?.value?.trim() || '';
    if (!name) return cvModalErr('Name ist Pflicht.');
    const outMenge = parseFloat(document.getElementById('p-out')?.value) || 1;
    if (outMenge < 0.01) return cvModalErr('Ausgabemenge muss > 0 sein.');

    const zutaten = [];
    document.querySelectorAll('[data-rs-id]').forEach(cb => {
        if (!cb.checked) return;
        const menge = parseFloat(cb.closest('.prod-zutat-check-row')?.querySelector('.prod-zutat-menge')?.value) || 0;
        if (menge > 0) zutaten.push({ rohstoffId: cb.dataset.rsId, menge });
    });
    document.querySelectorAll('[data-prod-id]').forEach(cb => {
        if (!cb.checked) return;
        const menge = parseFloat(cb.closest('.prod-zutat-check-row')?.querySelector('.prod-zutat-menge')?.value) || 0;
        if (menge > 0) zutaten.push({ produktId: cb.dataset.prodId, menge });
    });

    const margeInput       = document.getElementById('p-marge')?.value?.trim();
    const marge            = margeInput !== '' ? parseFloat(margeInput) : null;
    const exportPreisInput = document.getElementById('p-export')?.value?.trim();
    const exportPreis      = exportPreisInput !== '' && exportPreisInput ? (parseFloat(exportPreisInput) || null) : null;
    const typ              = document.querySelector('input[name="p-typ"]:checked')?.value || 'fertig';
    const verwendungspreis = document.querySelector('input[name="p-verwendungspreis"]:checked')?.value === 'gesamt' ? 'gesamt' : 'prod';
    const kategorie        = document.getElementById('p-kat')?.value?.trim() || '';

    // Eine Kategorie darf nur einem Typ angehören (Produkt ODER Export) —
    // sonst würden Berechtigungen für den anderen Typ versehentlich mit-gelten.
    if (kategorie) {
        const otherTyp = typ === 'vorfertigt' ? 'fertig' : 'vorfertigt';
        const conflict = (productionData.products || []).some(p =>
            p.id !== id && p.typ === otherTyp && (p.kategorie || '').trim().toLowerCase() === kategorie.toLowerCase()
        );
        if (conflict) {
            return cvModalErr(`Kategorie "${kategorie}" existiert bereits bei ${otherTyp === 'vorfertigt' ? 'Exportprodukten' : 'Produkten'}. Eine Kategorie kann nur einem Typ angehören.`);
        }
    }

    cvModalBusy('Speichern…');
    try {
        await prodPost({
            action: 'save_product', id, name, typ, marge, exportPreis, kategorie, verwendungspreis,
            einheit:     document.getElementById('p-einheit')?.value?.trim() || 'Stück',
            outputMenge: outMenge,
            zutaten,
        });
        await loadProductionData();
        cvCloseModal();
        _renderProdAll();
    } catch (e) { cvModalBusy(''); cvModalErr(e.message); }
}

async function deleteProd(id) {
    const p = (productionData.products || []).find(x => x.id === id);
    if (!confirm(`"${p?.name||'Produkt'}" wirklich löschen?`)) return;
    try {
        await prodPost({ action: 'delete_product', id });
        productionData.products = (productionData.products||[]).filter(x => x.id !== id);
        renderProduktListe();
    } catch (e) { alert('Fehler: ' + e.message); }
}

// ── BOM-Baum HTML ─────────────────────────────────────────────
// Flache Posten-Liste: jede Zutat (Rohstoff oder Sub-Produkt) ist eine Zeile
// mit Name/Menge/Kosten. Sub-Produkte zeigen ihre eigenen Zutaten direkt
// darunter, eingerückt mit "*"-Präfix.
function _bomTreeHtml(rows) {
    return rows.map(r => {
        if (r.kind === 'subprodukt') {
            const pl = r.depth * 16;
            const bullet = r.depth > 0 ? '* ' : '';
            return `<div class="prod-bom-rs" style="padding-left:${pl}px">
                <span class="prod-bom-rs-name">${bullet}${escapeHtml(r.name)}</span>
                <span class="prod-bom-rs-detail">${prodFmtN(r.menge)} ${escapeHtml(r.einheit)}</span>
                <span class="prod-bom-rs-cost">${prodFmtMoney(r.proratedCost)}</span>
            </div>`;
        }
        if (r.kind === 'rohstoff') {
            const pl = r.depth * 16;
            const bullet = r.depth > 0 ? '* ' : '';
            return `<div class="prod-bom-rs" style="padding-left:${pl}px">
                <span class="prod-bom-rs-name">${bullet}${escapeHtml(r.name)}</span>
                <span class="prod-bom-rs-detail">${prodFmtN(r.menge)} ${escapeHtml(r.einheit)}</span>
                <span class="prod-bom-rs-cost">${prodFmtMoney(r.proratedCost)}</span>
            </div>`;
        }
        if (r.kind === 'produkt-gesamt') {
            const pl = r.depth * 16;
            const bullet = r.depth > 0 ? '* ' : '';
            return `<div class="prod-bom-rs" style="padding-left:${pl}px">
                <span class="prod-bom-rs-name">${bullet}${escapeHtml(r.name)} <span style="font-size:10px;color:var(--primary)" title="Gesamtpreis (VK) statt Produktionspreis">Σ</span></span>
                <span class="prod-bom-rs-detail">${prodFmtN(r.menge)} ${escapeHtml(r.einheit)}</span>
                <span class="prod-bom-rs-cost">${prodFmtMoney(r.proratedCost)}</span>
            </div>`;
        }
        if (r.kind === 'circular') {
            return `<div style="padding-left:${r.depth * 16}px;color:#f87171;font-size:11px;padding:4px 0">⚠ Zirkuläre Abhängigkeit</div>`;
        }
        return '';
    }).join('');
}

// ── Globale Einkaufsliste (kombiniert Sub-Produkt-Runs) ────────
// Berechnet die tatsächlich benötigten Rohstoffe global:
// Wenn Holzbrett von 3 verschiedenen Produkten benötigt wird,
// werden alle Bedarfe zusammengezählt BEVOR die Läufe berechnet werden.
// So verhindert man, dass für jedes Elternprodukt ein eigener
// Holzbrett-Lauf (inklusive Baumstamm) entsteht.
function _computeGlobalShopping(grouped) {
    const products  = productionData.products  || [];
    const rohstoffe = productionData.rohstoffe || [];
    const shopping  = {};
    const allNeeds  = {};

    // Startmengen aus den Top-Level-Kalk-Positionen
    for (const [id, qty] of Object.entries(grouped)) allNeeds[id] = qty;

    // Alle Sub-Produkte rekursiv entdecken — Produkte mit Verwendungspreis
    // "Gesamtpreis" werden NICHT weiter aufgeklappt (Pauschalpreis statt Rohstoffliste).
    const allIds = new Set(Object.keys(allNeeds));
    const discover = (productId) => {
        const p = products.find(x => x.id === productId);
        if (!p) return;
        for (const z of (p.zutaten || [])) {
            if (z.produktId && !allIds.has(z.produktId)) {
                const subP = products.find(x => x.id === z.produktId);
                if (subP && subP.verwendungspreis === 'gesamt') continue;
                allIds.add(z.produktId);
                discover(z.produktId);
            }
        }
    };
    for (const id of Object.keys(grouped)) discover(id);

    // Eltern-Map aufbauen: welche Produkte verwenden dieses Produkt?
    const parentOf = {};
    for (const id of allIds) {
        const p = products.find(x => x.id === id);
        if (!p) continue;
        for (const z of (p.zutaten || [])) {
            if (z.produktId && allIds.has(z.produktId)) {
                if (!parentOf[z.produktId]) parentOf[z.produktId] = new Set();
                parentOf[z.produktId].add(id);
            }
        }
    }

    // Topologisch verarbeiten: erst Eltern, dann Kinder
    // So sammeln sich alle Bedarfe für z.B. Holzbrett an, bevor
    // Holzbrett seine Läufe berechnet.
    const processed = new Set();
    const getReady  = () => [...allIds].filter(id =>
        !processed.has(id) &&
        [...(parentOf[id] || new Set())].every(p => processed.has(p))
    );

    for (let iter = 0; iter < 30; iter++) {
        const ready = getReady();
        if (!ready.length) break;
        for (const productId of ready) {
            processed.add(productId);
            const totalMenge = allNeeds[productId] || 0;
            if (totalMenge <= 0) continue;
            const p = products.find(x => x.id === productId);
            if (!p) continue;
            const runs = Math.ceil(totalMenge / Math.max(1, p.outputMenge || 1));
            for (const z of (p.zutaten || [])) {
                const menge = z.menge * runs;
                if (z.rohstoffId) {
                    const rs = rohstoffe.find(r => r.id === z.rohstoffId);
                    if (rs) {
                        if (!shopping[rs.name]) shopping[rs.name] = { menge: 0, cost: 0, preis: rs.preis, einheit: rs.einheit };
                        shopping[rs.name].menge += menge;
                        shopping[rs.name].cost  += menge * (rs.preis || 0);
                    }
                } else if (z.produktId) {
                    const subP = products.find(x => x.id === z.produktId);
                    if (subP && subP.verwendungspreis === 'gesamt') {
                        // Pauschalpreis (VK) statt Rohstoff-Aufschlüsselung
                        const vk = _calcVK(z.produktId);
                        if (!shopping[subP.name]) shopping[subP.name] = { menge: 0, cost: 0, preis: vk, einheit: subP.einheit || 'Stück' };
                        shopping[subP.name].menge += menge;
                        shopping[subP.name].cost  += menge * vk;
                    } else {
                        allNeeds[z.produktId] = (allNeeds[z.produktId] || 0) + menge;
                    }
                }
            }
        }
    }
    return shopping;
}

// ── Kalkulator (mehrere Produkte + Gesamtübersicht) ───────────
function renderKalkulator() {
    const el = document.getElementById('prod-pane-kalkulator');
    if (!el) return;
    el.style.display = '';

    const products = productionData.products || [];
    if (!products.length) {
        el.innerHTML = `<div class="grid-card"><div class="info-text">Noch keine Produkte angelegt.<br><br>
            <button class="hero-btn" onclick="document.querySelector('[data-prod-tab=produkte]').click()">🏭 Produkte anlegen</button>
        </div></div>`;
        return;
    }

    // Sicherstellen dass alle Items gültige Produkte referenzieren
    kalkItems = kalkItems.filter(i => i.productId && products.find(p => p.id === i.productId));
    if (!kalkItems.length) kalkItems = [{ productId: products[0].id, qty: 1 }];
    localStorage.setItem('statev_kalk_items', JSON.stringify(kalkItems));

    // ── Gleiche Produkte zusammenfassen → weniger Überschuss ──
    // Wenn dasselbe Produkt mehrfach in der Liste steht, werden die Mengen
    // kombiniert bevor expandBOM läuft. So entfallen unnötige Extraläufe.
    const grouped = {};
    for (const { productId, qty } of kalkItems) {
        if (!grouped[productId]) grouped[productId] = 0;
        grouped[productId] += Math.max(1, qty || 1);
    }
    const itemData = Object.entries(grouped).map(([productId, qty]) => {
        const p = products.find(x => x.id === productId);
        if (!p) return null;
        const { rows, rawCost, runs, actual, surplus } = expandBOM(p.id, qty, 0, null);
        return { p, qty, rows, rawCost, runs, actual, surplus, vkGes: _calcVK(p.id) * qty };
    }).filter(Boolean);

    const totalVK = itemData.reduce((s, d) => s + d.vkGes, 0);

    // Globale Einkaufsliste: Sub-Produkt-Bedarfe werden kombiniert
    // bevor Läufe berechnet werden (kein doppelter Baumstamm für Holzbrett)
    const shopping = _computeGlobalShopping(grouped);
    const totalProdKosten = Object.values(shopping).reduce((s, d) => s + d.cost, 0);
    const gewinn          = totalVK - totalProdKosten;

    // Produkt-Zeilen (Kalkulator-Tabelle oben) — individuelle Einträge für Übersicht
    const rowsHtml = kalkItems.map(({ productId, qty }, idx) => {
        const p = products.find(x => x.id === productId);
        if (!p) return '';
        const q        = Math.max(1, qty || 1);
        const unitCost = _calcUnitCost(p.id);
        const vkUnit   = _calcVK(p.id);
        return `<div class="prod-kalk-row">
            ${_prodSearchSelectHtml('kalk', idx, products, productId, 'kalkSetProduct')}
            <div class="prod-kalk-qty-wrap">
                <input type="number" class="text-input" min="1" value="${q}" style="width:80px"
                    data-focus-key="kalk-qty-${idx}"
                    onclick="this.select()"
                    oninput="kalkSetQty(${idx},this.value)">
                <span class="prod-kalk-einheit">${escapeHtml(p.einheit||'Stück')}</span>
            </div>
            <span class="prod-kalk-num">${prodFmtMoney(unitCost * q)}</span>
            <span class="prod-kalk-num prod-p-gesamt">${prodFmtMoney(vkUnit * q)}</span>
            <button class="icon-btn cv-del-btn" onclick="kalkRemoveItem(${idx})">🗑</button>
        </div>`;
    }).join('');

    // Hierarchischer BOM-Baum je Produkt
    const bomSectionsHtml = itemData.map(({ p, runs, actual, surplus, rawCost, rows }, idx) =>
        `<div class="prod-bom-section${idx < itemData.length - 1 ? ' prod-bom-sep' : ''}">
            <div class="prod-bom-prod-hdr">
                <span class="prod-bom-prod-name">${escapeHtml(p.name)}</span>
                <span class="prod-bom-prod-runs">${runs}× → ${actual} ${escapeHtml(p.einheit||'Stück')}${surplus>0?` <span class="prod-surplus">+${surplus}</span>`:''}</span>
                <span class="prod-bom-prod-cost">${prodFmtMoney(rawCost)}</span>
            </div>
            ${_bomTreeHtml(rows) || '<div class="info-text" style="padding-left:16px;margin-top:4px">Keine Zutaten definiert.</div>'}
        </div>`
    ).join('');

    const _kalkSaved = _focusSave(el);
    el.innerHTML = `
<div class="grid-card" style="margin-bottom:16px">
    <div class="card-header" style="margin-bottom:14px">
        <div class="card-title">Kalkulator</div>
        <button class="hero-btn" type="button" onclick="kalkAddItem()">➕ Produkt hinzufügen</button>
    </div>
    <div class="prod-kalk-header">
        <span>Produkt</span><span>Zielmenge</span>
        <span>Rohstoffkosten</span><span>VK gesamt</span><span></span>
    </div>
    ${rowsHtml}
</div>

<div class="prod-kalk-bottom">
    <div class="grid-card">
        ${bomSectionsHtml || '<div class="info-text">Keine Produkte ausgewählt.</div>'}
        ${bomSectionsHtml ? `
        <div class="prod-total-row" style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border-color)">
            <span style="font-weight:600">Rohstoffkosten gesamt</span>
            <strong>${prodFmtMoney(totalProdKosten)}</strong>
        </div>` : ''}
    </div>
    <div class="grid-card">
        <div class="card-header" style="margin-bottom:12px">
            <div class="card-title" style="font-size:14px">Preisübersicht</div>
        </div>
        <div class="prod-price-block">
            <div class="prod-price-row">
                <span class="prod-price-lbl">Prod. Preis</span>
                <span class="prod-price-val">${prodFmtMoney(totalProdKosten)}</span>
            </div>
            <div class="prod-price-row">
                <span class="prod-price-lbl">Gewinn</span>
                <span class="prod-price-val prod-p-gewinn">${prodFmtMoney(gewinn)}</span>
            </div>
            <div class="prod-price-row prod-price-row-total">
                <span class="prod-price-lbl">Gesamtpreis</span>
                <span class="prod-price-val prod-p-gesamt">${prodFmtMoney(totalVK)}</span>
            </div>
        </div>
    </div>
</div>`;
    _focusRestore(el, _kalkSaved);
}

function kalkAddItem() {
    const pp = productionData.products || [];
    if (!pp.length) return;
    kalkItems.push({ productId: pp[0].id, qty: 1 });
    renderKalkulator();
}
function kalkRemoveItem(idx) {
    kalkItems.splice(idx, 1);
    if (!kalkItems.length) {
        const pp = productionData.products || [];
        if (pp.length) kalkItems = [{ productId: pp[0].id, qty: 1 }];
    }
    renderKalkulator();
}
function kalkSetProduct(idx, val) { kalkItems[idx].productId = val; renderKalkulator(); }
let _kalkQtyTimer = null;
function kalkSetQty(idx, val) {
    const n = parseInt(val);
    if (val === '' || isNaN(n)) return;
    kalkItems[idx].qty = Math.max(1, n);
    clearTimeout(_kalkQtyTimer);
    _kalkQtyTimer = setTimeout(renderKalkulator, 350);
}

// ── Bestellungs-Konfigurator ──────────────────────────────────
function renderBestellung() {
    const el = document.getElementById('prod-pane-bestellung');
    if (!el) return;
    el.style.display = '';

    const products = productionData.products || [];
    if (!products.length) {
        el.innerHTML = `<div class="grid-card"><div class="info-text">Noch keine Produkte angelegt.
            <br><br><button class="hero-btn" onclick="document.querySelector('[data-prod-tab=produkte]').click()">🏭 Produkte anlegen</button>
        </div></div>`;
        return;
    }

    const rabatt = Math.max(0, Math.min(100, parseFloat(bestellState.rabatt) || 0));

    // Summen — nur die bestellten Fertigprodukte, keine Rohstoff-/Kostenkalkulation.
    let totalVK = 0;
    for (const item of bestellState.items) {
        if (!item.productId) continue;
        const p = products.find(x => x.id === item.productId);
        if (!p) continue;
        const qty = Math.max(1, item.qty || 1);
        totalVK += _calcVK(p.id) * qty;
    }
    const rabattBetrag = totalVK * rabatt / 100;
    const zuZahlen      = totalVK - rabattBetrag;

    const itemRowsHtml = bestellState.items.map((item, idx) => {
        const p       = item.productId ? products.find(x => x.id === item.productId) : null;
        const vkUnit  = p ? _calcVK(p.id) : 0;
        const qty     = Math.max(1, item.qty || 1);
        return `<div class="prod-bestell-row">
            ${_prodSearchSelectHtml('bestell', idx, products, item.productId, 'bestellSetProduct')}
            <div style="display:flex;align-items:center;gap:6px">
                <input type="number" class="text-input" min="1" value="${qty}" style="width:72px"
                    data-focus-key="bestell-qty-${idx}"
                    onclick="this.select()"
                    oninput="bestellSetQty(${idx},this.value)">
                <span style="font-size:12px;color:var(--text-muted)">${escapeHtml(p?.einheit||'Stück')}</span>
            </div>
            <span class="prod-bestell-vk">${prodFmtMoney(vkUnit)}<span style="color:var(--text-muted);font-size:11px"> / ${escapeHtml(p?.einheit||'Stück')}</span></span>
            <span class="prod-bestell-total">${prodFmtMoney(vkUnit * qty)}</span>
            <button class="icon-btn cv-del-btn" title="Artikel entfernen" onclick="bestellRemoveItem(${idx})">🗑</button>
        </div>`;
    }).join('');

    // Gespeicherte Bestellungen — pro Kunde gruppiert mit Gesamtrechnung
    const bestellungen = productionData.bestellungen || [];
    // Vorschau-Kosten je Bestellung einmal berechnen (wird mehrfach gebraucht)
    const bestellWithTotal = bestellungen.map(b => {
        let bVK = 0;
        for (const it of (b.items||[])) {
            const bp = products.find(x => x.id === it.productId);
            if (bp) bVK += _calcVK(bp.id) * Math.max(1, it.qty||1);
        }
        return { b, bVKnetto: bVK * (1 - (b.rabatt||0)/100) };
    });
    const bestellGroups = {};
    for (const item of bestellWithTotal) {
        const key = (item.b.kundenname || '').trim() || '– Ohne Name –';
        if (!bestellGroups[key]) bestellGroups[key] = [];
        bestellGroups[key].push(item);
    }
    const bestellGroupNames = Object.keys(bestellGroups).sort((a,b) => a.localeCompare(b,'de'));
    for (const name of bestellGroupNames) {
        bestellGroups[name].sort((a,b) =>
            (b.b.savedAt||b.b.updatedAt||'').localeCompare(a.b.savedAt||a.b.updatedAt||''));
    }

    const savedHtml = bestellungen.length ? `
<div class="grid-card" style="margin-top:12px">
    <div class="card-header" style="margin-bottom:12px">
        <div class="card-title">Gespeicherte Bestellungen</div>
        <span class="prod-section-lbl">${bestellungen.length} Einträge · ${bestellGroupNames.length} Kunden</span>
    </div>
    ${bestellGroupNames.map(kundenName => {
        const items = bestellGroups[kundenName];
        const kundenGesamt = items.reduce((s,i) => s + i.bVKnetto, 0);
        return `<div style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:6px">
                <strong style="font-size:13px">${escapeHtml(kundenName)}</strong>
                <strong style="font-size:13px">${prodFmtMoney(kundenGesamt)}</strong>
            </div>
            ${items.map(({b, bVKnetto}) => {
                const isEditing = bestellEditId === b.id;
                const date = new Date(b.savedAt||b.updatedAt||Date.now()).toLocaleString('de-DE',
                    {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
                const n = (b.items||[]).length;
                return `<div class="prod-saved-bestellung${isEditing ? ' prod-saved-active' : ''}">
                    <div style="min-width:0;flex:1">
                        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                            ${b.rabatt ? `<span style="font-size:11px;background:rgba(99,102,241,.15);color:var(--primary);padding:1px 6px;border-radius:4px">−${b.rabatt}%</span>` : ''}
                            ${isEditing ? `<span style="font-size:11px;background:rgba(99,102,241,.2);color:var(--primary);padding:1px 6px;border-radius:4px">✏️ wird bearbeitet</span>` : ''}
                        </div>
                        <span class="prod-saved-meta">${date} · ${n} Artikel · <strong style="color:var(--text-main)">${prodFmtMoney(bVKnetto)}</strong></span>
                    </div>
                    <div class="prod-saved-actions">
                        <button class="icon-btn" onclick="editBestellung('${escapeHtml(b.id)}')" title="Bearbeiten">✏️</button>
                        <button class="hero-btn prod-lieferung-btn" onclick="confirmLieferung('${escapeHtml(b.id)}')">✅ Lieferung</button>
                        <button class="icon-btn cv-del-btn" onclick="deleteBestellung('${escapeHtml(b.id)}')" title="Löschen">🗑</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
    }).join('')}
</div>` : '';

    const _bestellSaved = _focusSave(el);
    el.innerHTML = `
<div class="prod-bestell-layout">
    <div class="grid-card">
        <div class="card-header" style="margin-bottom:16px">
            <div>
                <div class="card-title">${bestellEditId ? 'Bestellung bearbeiten' : 'Neue Bestellung'}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
                ${bestellEditId ? `<button class="icon-btn" onclick="cancelBestellungEdit()" title="Abbrechen">✕ Abbrechen</button>` : ''}
                ${bestellState.items.length ? `<button class="hero-btn" onclick="saveBestellung()">${bestellEditId ? '💾 Aktualisieren' : '💾 Speichern'}</button>` : ''}
            </div>
        </div>

        <div class="prod-bestell-config">
            <div>
                <label class="contact-label">Kundenname</label>
                <input class="text-input" type="text" placeholder="Max Mustermann"
                    data-focus-key="bestell-name"
                    value="${escapeHtml(bestellState.kundenname)}"
                    oninput="bestellState.kundenname=this.value;_bestellUpdateTitle()">
            </div>
            <div>
                <label class="contact-label">Rabatt %</label>
                <input class="text-input" type="number" min="0" max="100" step="1"
                    placeholder="0" value="${rabatt||''}"
                    data-focus-key="bestell-rabatt"
                    oninput="bestellState.rabatt=parseFloat(this.value)||0">
            </div>
        </div>

        ${bestellState.items.length ? `
        <div class="prod-bestell-header" style="margin-top:14px"><span>Produkt</span><span>Menge</span><span>VK / Einheit</span><span>Gesamt</span><span></span></div>
        ${itemRowsHtml}` : `<div class="info-text" style="padding:16px 0;text-align:center;margin-top:8px">Noch keine Artikel hinzugefügt.</div>`}

        <div style="margin-top:10px">
            <button class="hero-btn" style="width:100%" onclick="bestellAddItem()">➕ Artikel hinzufügen</button>
        </div>
    </div>

    <div>
        ${bestellState.items.length ? `
        <div class="grid-card" style="margin-bottom:12px">
            <div class="card-title" id="bestell-summary-title" style="margin-bottom:16px">
                Zusammenfassung${bestellState.kundenname?' — '+escapeHtml(bestellState.kundenname):''}
            </div>
            <div class="prod-price-block">
                <div class="prod-price-row">
                    <span class="prod-price-lbl">Verkaufspreis</span>
                    <span class="prod-price-val">${prodFmtMoney(totalVK)}</span>
                </div>
                ${rabatt > 0 ? `
                <div class="prod-price-row" style="color:var(--red)">
                    <span class="prod-price-lbl">Rabatt (${rabatt}%)</span>
                    <span class="prod-price-val">−${prodFmtMoney(rabattBetrag)}</span>
                </div>
                <div class="prod-price-row prod-price-row-total">
                    <span class="prod-price-lbl">Netto-Einnahme</span>
                    <span class="prod-price-val prod-p-gesamt">${prodFmtMoney(zuZahlen)}</span>
                </div>` : ''}
            </div>
        </div>
        ` : `<div class="grid-card"><div class="info-text" style="padding:20px 0;text-align:center">Füge Artikel hinzu,<br>um die Zusammenfassung zu sehen.</div></div>`}
    </div>
</div>
${savedHtml}`;
    _focusRestore(el, _bestellSaved);
}

window._bestellUpdateTitle = () => {
    const el = document.getElementById('bestell-summary-title');
    if (el) el.textContent = 'Zusammenfassung' + (bestellState.kundenname ? ' — ' + bestellState.kundenname : '');
};

function bestellAddItem() {
    const products = productionData.products || [];
    if (!products.length) return;
    bestellState.items.push({ productId: products[0].id, qty: 1 });
    renderBestellung();
}
function bestellRemoveItem(idx) { bestellState.items.splice(idx, 1); renderBestellung(); }
function bestellSetProduct(idx, val) { bestellState.items[idx].productId = val; renderBestellung(); }
let _bestellQtyTimer = null;
function bestellSetQty(idx, val) {
    const n = parseInt(val);
    if (val === '' || isNaN(n)) return;
    bestellState.items[idx].qty = Math.max(1, n);
    clearTimeout(_bestellQtyTimer);
    _bestellQtyTimer = setTimeout(renderBestellung, 350);
}

async function saveBestellung() {
    if (!bestellState.items.length) return;
    try {
        await prodPost({
            action: bestellEditId ? 'update_bestellung' : 'save_bestellung',
            id: bestellEditId,
            kundenname: bestellState.kundenname,
            rabatt: bestellState.rabatt,
            items: bestellState.items,
        });
        bestellEditId = null;
        await loadProductionData();
        renderBestellung();
    } catch (e) { alert('Fehler beim Speichern: ' + e.message); }
}

function editBestellung(id) {
    const saved = (productionData.bestellungen || []).find(b => b.id === id);
    if (!saved) return;
    bestellEditId = id;
    bestellState = {
        kundenname: saved.kundenname || '',
        rabatt: saved.rabatt || 0,
        items: (saved.items || []).map(i => ({ ...i })),
    };
    renderBestellung();
    document.getElementById('prod-pane-bestellung')?.scrollTo({ top: 0, behavior: 'smooth' });
}

function cancelBestellungEdit() {
    bestellEditId = null;
    bestellState = { kundenname: '', rabatt: 0, items: [] };
    renderBestellung();
}

async function confirmLieferung(id) {
    const saved = (productionData.bestellungen || []).find(b => b.id === id);
    const name = saved?.kundenname ? `"${saved.kundenname}"` : 'diese Bestellung';
    if (!confirm(`Lieferung für ${name} bestätigen?\nDie Bestellung wird danach gelöscht.`)) return;
    if (bestellEditId === id) { bestellEditId = null; bestellState = { kundenname: '', rabatt: 0, items: [] }; }
    try {
        await prodPost({ action: 'delete_bestellung', id });
        productionData.bestellungen = (productionData.bestellungen || []).filter(b => b.id !== id);
        renderBestellung();
    } catch (e) { alert('Fehler: ' + e.message); }
}

async function deleteBestellung(id) {
    if (!confirm('Bestellung wirklich löschen?')) return;
    if (bestellEditId === id) { bestellEditId = null; bestellState = { kundenname: '', rabatt: 0, items: [] }; }
    try {
        await prodPost({ action: 'delete_bestellung', id });
        productionData.bestellungen = (productionData.bestellungen || []).filter(b => b.id !== id);
        renderBestellung();
    } catch (e) { alert('Fehler: ' + e.message); }
}

// ── Einkäufe (Rohstoff-Bestellungen erfassen) ──────────────────
let _ekPosten = [];
let _ekEditId = null;
let _ekSearchText = '';

function renderEinkaeufeListe() {
    const el = document.getElementById('prod-pane-einkaeufe');
    if (!el) return;
    el.style.display = '';

    const canEdit = hasPerm('produktion.rohstoffe.edit');
    const rohstoffe = productionData.rohstoffe || [];
    const products  = productionData.products  || [];
    const ekItemInfo = (p) => {
        if (p.rohstoffId) { const r = rohstoffe.find(x => x.id === p.rohstoffId); return r ? { name: r.name, einheit: r.einheit } : null; }
        if (p.produktId)  { const x = products.find(x => x.id === p.produktId);  return x ? { name: x.name, einheit: x.einheit } : null; }
        return null;
    };
    const einkaeufe = [...(productionData.einkaeufe || [])]
        .filter(e => !_ekSearchText || (e.lieferant||'').toLowerCase().includes(_ekSearchText) ||
            (e.posten||[]).some(p => (ekItemInfo(p)?.name||'').toLowerCase().includes(_ekSearchText)));

    const gesamtSumme = einkaeufe.reduce((s,e) => s + (e.posten||[]).reduce((s2,p) => s2 + p.menge*p.preis, 0), 0);

    // Nach Lieferant gruppieren — mehrere Einkäufe desselben Lieferanten erscheinen zusammen
    const groups = {};
    for (const e of einkaeufe) {
        const key = (e.lieferant || '').trim() || '– Ohne Lieferant –';
        if (!groups[key]) groups[key] = [];
        groups[key].push(e);
    }
    const sortedGroupNames = Object.keys(groups).sort((a,b) => a.localeCompare(b,'de'));
    for (const name of sortedGroupNames) {
        groups[name].sort((a,b) => (b.datum||'').localeCompare(a.datum||'') || (b.createdAt||'').localeCompare(a.createdAt||''));
    }

    el.innerHTML = `
<div class="prod-toolbar" style="flex-wrap:wrap;gap:8px">
    <input type="search" class="text-input prod-search" id="ek-list-search" placeholder="🔍 Lieferant oder Produkt suchen…"
        value="${escapeHtml(_ekSearchText)}" oninput="_ekSearchText=this.value.toLowerCase();renderEinkaeufeListe()">
    ${canEdit ? `<button class="hero-btn" type="button" onclick="openEinkaufModal()">➕ Einkauf erfassen</button>` : ''}
</div>
${einkaeufe.length ? `
<div class="grid-card" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:var(--text-muted)">${einkaeufe.length} Einkäufe · ${sortedGroupNames.length} Lieferanten</span>
        <span style="font-size:15px;font-weight:700">${prodFmtMoney(gesamtSumme)}</span>
    </div>
</div>
${sortedGroupNames.map(lieferantName => {
    const entries = groups[lieferantName];
    const vban = entries.find(e => e.vban)?.vban || '';
    const lieferantSumme = entries.reduce((s,e) => s + (e.posten||[]).reduce((s2,p) => s2 + p.menge*p.preis, 0), 0);

    return `<div class="grid-card" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
            <div style="display:flex;align-items:center;gap:8px">
                <strong style="font-size:15px">${escapeHtml(lieferantName)}</strong>
                ${vban ? `<span class="cv-kennzeichen">VBAN ${escapeHtml(vban)}</span>` : ''}
            </div>
            <strong style="font-size:14px">${prodFmtMoney(lieferantSumme)}</strong>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px">
            ${entries.map(e => {
                const posten = e.posten || [];
                const einkaufSumme = posten.reduce((s,p) => s + p.menge*p.preis, 0);
                return `<div style="border-top:1px solid var(--border-color);padding-top:10px">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                        <div style="display:flex;align-items:center;gap:10px">
                            <span style="font-size:12px;color:var(--text-muted)">📅 ${escapeHtml(e.datum||'')}</span>
                            <span style="font-size:13px;font-weight:700">${prodFmtMoney(einkaufSumme)}</span>
                        </div>
                        ${canEdit ? `<div style="display:flex;gap:4px">
                            <button class="icon-btn" onclick="openEinkaufModal('${escapeHtml(e.id)}')">✏️</button>
                            <button class="icon-btn cv-del-btn" onclick="deleteEinkauf('${escapeHtml(e.id)}')">🗑</button>
                        </div>` : ''}
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px">
                        ${posten.map((p, pIdx) => {
                            const info = ekItemInfo(p);
                            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px;color:var(--text-muted)">
                                <span>${escapeHtml(info?.name || '– gelöschtes Produkt –')}</span>
                                <span style="display:flex;align-items:center;gap:10px">
                                    <span>${prodFmtN(p.menge)} ${escapeHtml(info?.einheit||'')} × ${prodFmtMoney(p.preis)} = <strong style="color:var(--text-main)">${prodFmtMoney(p.menge*p.preis)}</strong></span>
                                    ${canEdit ? `<button class="cv-kaution-btn${p.bezahlt?' cv-kaution-btn-ret':''}" style="white-space:nowrap"
                                        onclick="toggleEinkaufBezahlt('${escapeHtml(e.id)}',${pIdx})">${p.bezahlt ? '✓ Bezahlt' : '💰 Als bezahlt markieren'}</button>`
                                        : (p.bezahlt ? `<span class="cv-kaution-ok">✓ Bezahlt</span>` : `<span style="color:var(--red);font-size:11px">Offen</span>`)}
                                </span>
                            </div>`;
                        }).join('')}
                    </div>
                    ${e.notiz ? `<div style="margin-top:6px;font-size:12px;color:var(--text-dark);font-style:italic">${escapeHtml(e.notiz)}</div>` : ''}
                </div>`;
            }).join('')}
        </div>
    </div>`;
}).join('')}
` : `<div class="grid-card"><div class="info-text">${_ekSearchText ? 'Keine Ergebnisse.' : 'Noch keine Einkäufe erfasst.'}</div></div>`}`;
}

async function toggleEinkaufBezahlt(einkaufId, postenIndex) {
    const e = (productionData.einkaeufe || []).find(x => x.id === einkaufId);
    if (!e || !e.posten[postenIndex]) return;
    e.posten[postenIndex].bezahlt = !e.posten[postenIndex].bezahlt;
    renderEinkaeufeListe();
    try {
        await prodPost({ action: 'toggle_einkauf_bezahlt', id: einkaufId, postenIndex });
    } catch (err) {
        e.posten[postenIndex].bezahlt = !e.posten[postenIndex].bezahlt;
        renderEinkaeufeListe();
        alert('Fehler: ' + err.message);
    }
}

function openEinkaufModal(id) {
    const e = id ? (productionData.einkaeufe || []).find(x => x.id === id) : null;
    _ekEditId = id || null;
    _ekPosten = e ? e.posten.map(p => ({...p})) : [{ rohstoffId: '', produktId: '', menge: 1, preis: 0 }];

    cvOpenModal({
        title: id ? 'Einkauf bearbeiten' : 'Einkauf erfassen',
        wide: true,
        saveLabel: 'Speichern',
        bodyHTML: `
            <div class="cv-form-row" style="margin-bottom:12px">
                <div style="flex:1">
                    <label class="cv-label">Lieferant</label>
                    <input class="form-control" id="ek-lieferant" type="text" placeholder="z.B. Max Mustermann" value="${escapeHtml(e?.lieferant || '')}">
                </div>
                <div style="flex:1">
                    <label class="cv-label">VBAN <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
                    <input class="form-control" id="ek-vban" type="text" placeholder="z.B. 123456" value="${escapeHtml(e?.vban || '')}">
                </div>
                <div style="flex:1">
                    <label class="cv-label">Datum</label>
                    <input class="form-control" id="ek-datum" type="date" value="${escapeHtml(e?.datum || new Date().toISOString().slice(0,10))}">
                </div>
            </div>
            <label class="cv-label" style="margin-bottom:8px;display:block">Artikel <span style="font-weight:400;color:var(--text-muted)">(Produkt / Menge / Preis)</span></label>
            <div id="ek-posten-list" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px"></div>
            <button type="button" class="hero-btn hero-btn-secondary" style="margin-bottom:14px" onclick="_ekAddPosten()">➕ Posten hinzufügen</button>
            <div>
                <label class="cv-label">Notiz <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
                <textarea class="form-control" id="ek-notiz" rows="2" style="resize:vertical">${escapeHtml(e?.notiz || '')}</textarea>
            </div>
        `,
        onSave: async () => {
            const datum     = document.getElementById('ek-datum')?.value || new Date().toISOString().slice(0,10);
            const lieferant = document.getElementById('ek-lieferant')?.value?.trim() || '';
            const vban      = document.getElementById('ek-vban')?.value?.trim() || '';
            const notiz     = document.getElementById('ek-notiz')?.value?.trim() || '';
            const posten    = _ekPosten.filter(p => (p.rohstoffId || p.produktId) && p.menge > 0);
            if (!lieferant) return cvModalErr('Lieferant ist Pflicht.');
            if (!posten.length) return cvModalErr('Mindestens ein Artikel mit Produkt und Menge erforderlich.');

            cvModalBusy('Speichern…');
            try {
                await prodPost({ action: 'save_einkauf', id: _ekEditId, datum, lieferant, vban, notiz, posten });
                await loadProductionData();
                cvCloseModal();
                renderEinkaeufeListe();
            } catch (err) { cvModalBusy(''); cvModalErr(err.message); }
        }
    });
    _ekRenderPostenList();
}

// Kombinierte Auswahlliste: Rohstoffe UND Produkte, über zusammengesetzten Key unterschieden
function _ekItemOptions() {
    const rohstoffe = productionData.rohstoffe || [];
    const products  = productionData.products  || [];
    return [
        ...rohstoffe.map(r => ({ id: 'rs:'   + r.id, name: r.name + ' · Rohstoff' })),
        ...products.map(p  => ({ id: 'prod:' + p.id, name: p.name + ' · Produkt' })),
    ].sort((a,b) => a.name.localeCompare(b.name,'de'));
}
function _ekCurrentKey(p) {
    if (p.rohstoffId) return 'rs:' + p.rohstoffId;
    if (p.produktId)  return 'prod:' + p.produktId;
    return '';
}

function _ekRenderPostenList() {
    const el = document.getElementById('ek-posten-list');
    if (!el) return;
    const options = _ekItemOptions();
    el.innerHTML = _ekPosten.map((p, idx) => `
        <div style="display:grid;grid-template-columns:1fr 90px 110px 34px;gap:8px;align-items:center">
            ${_prodSearchSelectHtml('ek-item', idx, options, _ekCurrentKey(p), '_ekSetItem')}
            <input type="number" class="form-control" min="0" step="0.01" value="${_round2(p.menge)}"
                placeholder="Menge" oninput="_ekPosten[${idx}].menge=_round2(this.value)">
            <input type="number" class="form-control" min="0" step="0.01" value="${_round2(p.preis)}"
                placeholder="Preis/Einheit" oninput="_ekPosten[${idx}].preis=_round2(this.value)">
            <button type="button" class="icon-btn cv-del-btn" onclick="_ekRemovePosten(${idx})">🗑</button>
        </div>
    `).join('');
}

window._ekSetItem = (idx, key) => {
    const [type, id] = key.split(':');
    _ekPosten[idx].rohstoffId = type === 'rs'   ? id : '';
    _ekPosten[idx].produktId  = type === 'prod' ? id : '';
    // Aktuellen Preis als Vorschlag übernehmen, falls noch keiner gesetzt
    if (!_ekPosten[idx].preis) {
        if (type === 'rs') {
            const rs = (productionData.rohstoffe || []).find(r => r.id === id);
            if (rs) _ekPosten[idx].preis = rs.preis || 0;
        } else if (type === 'prod') {
            _ekPosten[idx].preis = _calcVK(id) || 0;
        }
    }
    _ekRenderPostenList();
};

function _ekAddPosten() {
    _ekPosten.push({ rohstoffId: '', produktId: '', menge: 1, preis: 0 });
    _ekRenderPostenList();
}
function _ekRemovePosten(idx) {
    _ekPosten.splice(idx, 1);
    if (!_ekPosten.length) _ekPosten = [{ rohstoffId: '', produktId: '', menge: 1, preis: 0 }];
    _ekRenderPostenList();
}

async function deleteEinkauf(id) {
    if (!confirm('Einkauf wirklich löschen?')) return;
    try {
        await prodPost({ action: 'delete_einkauf', id });
        productionData.einkaeufe = (productionData.einkaeufe || []).filter(e => e.id !== id);
        renderEinkaeufeListe();
    } catch (e) { alert('Fehler: ' + e.message); }
}

