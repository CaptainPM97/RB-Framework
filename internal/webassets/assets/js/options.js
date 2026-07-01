// ==========================================================================
// OPTIONEN-EDITOR  (geladen nach app.js, teilt dessen globale Variablen)
// ==========================================================================
const OPTIONS_SLOT_COUNT = 10;

let optionsCurrentFirma = '';
let optionsCurrentSlot  = '';
let optionsCacheBySlot  = {};
let optionsPrefetchMap  = {};
let optionsAutoOpened   = false;

// --------------------------------------------------------------------------
// Prefetch
// --------------------------------------------------------------------------
async function prefetchOptionsFirstFirma() {
    if (!factories.length) return;
    const firmaId = String(factories[0].id);
    if (optionsPrefetchMap[firmaId]) return;
    const paths = [];
    for (let slot = 1; slot <= OPTIONS_SLOT_COUNT; slot++) paths.push(`factory/options/${firmaId}/${slot}`);
    try { optionsPrefetchMap[firmaId] = await apiBatch(paths); } catch (_) {}
}

async function autoOpenFirstOption() {
    if (!factories.length) return;
    // Nur ausführen wenn der Options-Tab gerade sichtbar ist
    const section = document.getElementById('page-optionen');
    if (!section || !section.classList.contains('active')) return;
    const firmaSelect = document.getElementById('options-firma-select');
    if (!firmaSelect) return;
    const firstId = String(factories[0].id);
    // Schon geladen → nicht nochmal fetchen
    if (optionsCurrentFirma === firstId && Object.keys(optionsCacheBySlot).length > 0) return;
    optionsAutoOpened   = true;
    firmaSelect.value   = firstId;
    optionsCurrentFirma = firstId;
    await loadAllOptionsForFirma(firstId);
}

// --------------------------------------------------------------------------
// Init
// --------------------------------------------------------------------------
function initOptionsPage() {
    const firmaSelect = document.getElementById('options-firma-select');

    firmaSelect.addEventListener('change', async () => {
        optionsCurrentFirma = firmaSelect.value;
        optionsCurrentSlot  = '';
        closeEditor();
        if (optionsCurrentFirma) await loadAllOptionsForFirma(optionsCurrentFirma);
        else document.getElementById('options-cards-container').innerHTML =
            '<div class="info-text">Bitte zuerst eine Firma auswählen.</div>';
    });

    document.getElementById('pic-open-btn')?.addEventListener('click', () => {
        window.open(PIC_STATEV_URL, '_blank');
    });

    // Editor-Formular existiert nur im DOM wenn der Nutzer Bearbeiten-Recht hat
    document.getElementById('options-editor-form')?.addEventListener('submit', handleOptionSave);

    ['option-title-input', 'option-text-input', 'option-image-id-input'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateOptionPreview);
    });
}

// --------------------------------------------------------------------------
// Laden
// --------------------------------------------------------------------------
async function loadAllOptionsForFirma(firmaId) {
    const container = document.getElementById('options-cards-container');
    if (!container) return;
    container.innerHTML = '<div class="info-text">Lade Optionen...</div>';

    // Alle Slots als null vorbelegen (= geladen, aber leer)
    optionsCacheBySlot = {};
    for (let slot = 1; slot <= OPTIONS_SLOT_COUNT; slot++) optionsCacheBySlot[slot] = null;

    const paths = [];
    for (let slot = 1; slot <= OPTIONS_SLOT_COUNT; slot++) paths.push(`factory/options/${firmaId}/${slot}`);

    let batchMap = optionsPrefetchMap[firmaId];
    if (batchMap) { delete optionsPrefetchMap[firmaId]; }
    else {
        try { batchMap = await apiBatch(paths); }
        catch (err) {
            container.innerHTML = `<div class="info-text" style="color:var(--red);">Fehler: ${escapeHtml(err.message)}</div>`;
            return;
        }
    }

    let gotAnyResponse = false;
    let scopeError     = false;

    for (let slot = 1; slot <= OPTIONS_SLOT_COUNT; slot++) {
        const result = batchMap[`factory/options/${firmaId}/${slot}`];
        if (!result) continue;
        gotAnyResponse = true;
        if (result.status === 200 && result.body && typeof result.body === 'object') {
            optionsCacheBySlot[slot] = result.body;
        } else if (result.status === 403) {
            scopeError = true;
        }
        // 404 → leer, bleibt null in Cache
    }

    if (!gotAnyResponse) {
        container.innerHTML = `<div class="info-text" style="color:var(--red);">
            Keine API-Antwort erhalten (Scope <code>factory.options</code> fehlt möglicherweise).
        </div>`;
        return;
    }

    if (scopeError) {
        container.innerHTML = `<div class="info-text" style="color:var(--red);">
            Zugriff verweigert — Scope <code>factory.options</code> fehlt.
        </div>`;
        return;
    }

    closeEditor();
    renderOptionCards();
}

// --------------------------------------------------------------------------
// Karten-Rendering
// --------------------------------------------------------------------------
function renderOptionCards() {
    const container = document.getElementById('options-cards-container');
    if (!container) return;

    container.innerHTML = '';

    for (let slot = 1; slot <= OPTIONS_SLOT_COUNT; slot++) {
        const data    = optionsCacheBySlot[slot]; // null = leer, object = hat Inhalt
        const isEmpty = !data || !data.title || data.title === '.' || data.title === '';
        const parsed  = isEmpty ? { text: '', img: '' } : parseOptionData(data.data);
        const title   = isEmpty ? '' : (data.title || '');
        const imgId   = parsed.img || '';
        const text    = parsed.text || '';
        const isActive = String(slot) === String(optionsCurrentSlot);

        const card = document.createElement('div');
        card.className   = 'opt-pv-card' + (isEmpty ? ' opt-pv-empty' : '') + (isActive ? ' opt-pv-active' : '');
        card.dataset.slot = slot;

        const imgHtml = imgId
            ? `<div class="opt-pv-img-wrap"><img class="opt-pv-img" src="${escapeHtml(PIC_STATEV_IMAGE_BASE + imgId)}" alt=""></div>`
            : '';

        card.innerHTML = `
            <div class="opt-pv-head">
                <span class="opt-slot">Slot ${slot}</span>
                ${isEmpty
                    ? '<span class="opt-pv-badge opt-pv-badge-empty">Leer</span>'
                    : '<span class="opt-pv-badge opt-pv-badge-filled">Belegt</span>'}
            </div>
            ${imgHtml}
            <div class="opt-pv-title">${isEmpty ? '<em style="color:var(--text-muted)">– leer –</em>' : escapeHtml(title)}</div>
            ${text ? `<div class="opt-pv-text">${escapeHtml(text).replace(/\n/g,'<br>')}</div>` : ''}
            <div class="opt-pv-actions">
                ${PERMS.optionenEdit ? `
                <button type="button" class="opt-pv-btn opt-pv-edit">✏️ Bearbeiten</button>
                <button type="button" class="opt-pv-btn opt-pv-dup">📋 Kopieren</button>
                ${!isEmpty ? `<button type="button" class="opt-pv-btn opt-pv-del">🗑️ Leeren</button>` : ''}
                ` : ''}
            </div>
        `;

        card.querySelector('.opt-pv-edit')?.addEventListener('click', (e) => {
            e.stopPropagation();
            openEditor(slot);
        });
        card.querySelector('.opt-pv-dup')?.addEventListener('click', (e) => {
            e.stopPropagation();
            duplicateSlot(slot);
        });
        card.querySelector('.opt-pv-del')?.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteSlot(slot);
        });
        if (PERMS.optionenEdit) card.addEventListener('click', () => openEditor(slot));

        container.appendChild(card);
    }

}

// --------------------------------------------------------------------------
// Editor öffnen / schließen
// --------------------------------------------------------------------------
function openEditor(slot) {
    optionsCurrentSlot = String(slot);

    document.querySelectorAll('.opt-pv-card').forEach(c =>
        c.classList.toggle('opt-pv-active', c.dataset.slot === String(slot))
    );

    const existing = optionsCacheBySlot[slot];
    const parsed   = parseOptionData(existing?.data);

    const isEmpty = !existing || !existing.title || existing.title === '.' || existing.title === '';

    document.getElementById('options-editor-slot-label').textContent = `${slot} bearbeiten`;
    document.getElementById('option-title-input').value    = isEmpty ? '' : (existing.title || '');
    document.getElementById('option-text-input').value     = parsed.text;
    document.getElementById('option-image-id-input').value = parsed.img;
    document.getElementById('option-last-updated').innerText = existing?.lastUpdated
        ? new Date(existing.lastUpdated).toLocaleString('de-DE')
        : '–';
    document.getElementById('option-save-status').style.display = 'none';

    // Editor immer sichtbar — nur Form/Empty-State toggeln
    document.getElementById('options-editor-empty-state').style.display = 'none';
    document.getElementById('options-editor-form').style.display = '';
}

function closeEditor() {
    optionsCurrentSlot = '';
    document.querySelectorAll('.opt-pv-card').forEach(c => c.classList.remove('opt-pv-active'));
    const slotLabel = document.getElementById('options-editor-slot-label');
    if (slotLabel) slotLabel.textContent = '–';
    const form = document.getElementById('options-editor-form');
    if (form) form.style.display = 'none';
    const emptyState = document.getElementById('options-editor-empty-state');
    if (emptyState) emptyState.style.display = '';
}

// --------------------------------------------------------------------------
// Speichern
// --------------------------------------------------------------------------
async function handleOptionSave(e) {
    e.preventDefault();
    if (!optionsCurrentFirma || !optionsCurrentSlot) return;

    const saveBtn  = document.getElementById('option-save-btn');
    const statusEl = document.getElementById('option-save-status');
    const title    = document.getElementById('option-title-input').value;
    const text     = document.getElementById('option-text-input').value;
    const img      = document.getElementById('option-image-id-input').value.trim();
    const data     = JSON.stringify({ text, img });

    const ok = await postOption(
        optionsCurrentFirma, optionsCurrentSlot, title, data,
        statusEl, saveBtn, 'Speichere...', 'Option gespeichert.'
    );
    saveBtn.innerText = '💾 Speichern';

    if (ok) {
        optionsCacheBySlot[optionsCurrentSlot] = {
            ...(optionsCacheBySlot[optionsCurrentSlot] || {}),
            title, data,
            lastUpdated: new Date().toISOString(),
        };
        renderOptionCards();
        openEditor(optionsCurrentSlot);
    }
}

// --------------------------------------------------------------------------
// Duplizieren / Löschen direkt von der Karte
// --------------------------------------------------------------------------
async function duplicateSlot(fromSlot) {
    if (!optionsCurrentFirma) return;
    const src = optionsCacheBySlot[fromSlot];

    const targetStr = prompt(`Slot ${fromSlot} kopieren in welchen Slot? (1–${OPTIONS_SLOT_COUNT})`);
    if (!targetStr) return;
    const targetSlot = parseInt(targetStr, 10);
    if (!targetSlot || targetSlot < 1 || targetSlot > OPTIONS_SLOT_COUNT) return;

    const title = src?.title || '';
    const data  = src?.data  || '';
    const dummy = { style: {}, innerText: '' };

    const ok = await postOption(optionsCurrentFirma, targetSlot, title, data, dummy, dummy, '', '');
    if (ok) {
        optionsCacheBySlot[targetSlot] = { title, data, lastUpdated: new Date().toISOString() };
        renderOptionCards();
    }
}

async function deleteSlot(slot) {
    if (!optionsCurrentFirma) return;
    if (!confirm(`Slot ${slot} wirklich leeren?`)) return;

    const dummy = { style: {}, innerText: '' };
    const ok = await postOption(optionsCurrentFirma, slot, '.', '.', dummy, dummy, '', '');
    if (ok) {
        optionsCacheBySlot[slot] = { title: '.', data: '.' };
        if (String(optionsCurrentSlot) === String(slot)) closeEditor();
        renderOptionCards();
    }
}

// --------------------------------------------------------------------------
// API-Post
// --------------------------------------------------------------------------
async function postOption(firmaId, slot, title, data, statusEl, busyEl, busyText, doneText) {
    if (typeof data === 'string' && data.length > 2400) {
        statusEl.style.display = 'block';
        statusEl.style.color   = 'var(--red)';
        statusEl.innerText     = `Text + Bild sind als JSON zu lang (${data.length}/2400 Zeichen). Bitte kürzen.`;
        return false;
    }
    if (busyEl.disabled !== undefined) busyEl.disabled = true;
    if (busyText) busyEl.innerText = busyText;
    if (statusEl.style) statusEl.style.display = 'none';
    try {
        const res = await fetch(apiUrl('factory/options'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ factoryId: firmaId, option: parseInt(slot, 10), title, data }),
        });
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            throw new Error(errBody.message || `Fehler ${res.status}`);
        }
        if (doneText && statusEl.style) {
            statusEl.style.display = 'block';
            statusEl.style.color   = 'var(--emerald)';
            statusEl.innerText     = doneText;
        }
        return true;
    } catch (err) {
        if (statusEl.style) {
            statusEl.style.display = 'block';
            statusEl.style.color   = 'var(--red)';
            statusEl.innerText     = `Fehler: ${err.message}`;
        }
        return false;
    } finally {
        if (busyEl.disabled !== undefined) busyEl.disabled = false;
    }
}

// --------------------------------------------------------------------------
// Vorschau-Hilfsfunktionen (für Kompatibilität mit Editor-Inputs)
// --------------------------------------------------------------------------
function parseOptionData(rawData) {
    if (!rawData) return { text: '', img: '' };
    try {
        const parsed = JSON.parse(rawData);
        if (parsed && typeof parsed === 'object') return { text: parsed.text || '', img: parsed.img || '' };
    } catch {}
    return { text: rawData, img: '' };
}

function updateOptionPreview() {
    // Karten werden live nicht neu gerendert – nur bei Save.
}

function resetOptionPreview() {}
