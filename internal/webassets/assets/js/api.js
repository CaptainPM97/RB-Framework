// ==========================================================================
// API LAYER  –  wird als ERSTES Script geladen
// Alle geteilten API-Primitiven und Konstanten.
// Startet lokale Prefetches sofort beim Script-Parsen, bevor
// DOMContentLoaded feuert, damit die Daten meist schon bereit
// sind wenn sie gebraucht werden.
// ==========================================================================

// ── Konstanten ──────────────────────────────────────────────
const PIC_STATEV_URL        = 'https://pic.statev.de';
const PIC_STATEV_IMAGE_BASE = 'https://pic.statev.de/images/';

const CAP_LAGER_NORMAL  = 14000;
const CAP_LAGER_FOUNDRY = 1800;
const CAP_MACHINE       = 3000;

// ── Berechtigungen ──────────────────────────────────────────
// Wird vom Server als inline-Script in index.php gesetzt,
// bevor externe Scripts geladen werden.
const PERMS = window.RB_PERMISSIONS || { isAdmin: false, lager: false, optionen: false, bank: false };

// Prüft ob der Nutzer eine bestimmte Permission hat (inkl. Admin-Bypass)
function hasPerm(key) {
    if (PERMS.isAdmin) return true;
    const raw = PERMS.raw || [];
    return raw.includes(key);
}

// Gibt alle erlaubten Produktions-Kategorien für einen Typ zurück (fertig/vorfertigt).
// null = alle erlaubt (Admin oder globales produktion.produkte.edit / .view)
// [] = keine erlaubt
// ['Nahrung', ...] = nur diese
function prodAllowedCats(mode, typ) {
    // mode: 'view' oder 'edit'; typ: 'fertig' oder 'vorfertigt'
    if (PERMS.isAdmin) return null;
    const raw = PERMS.raw || [];
    if (mode === 'edit' && raw.includes('produktion.produkte.edit')) return null;
    if (mode === 'view' && raw.includes('produktion.view')) return null;
    // Kategorie-spezifische Permissions (typ-getrennt)
    const prefix = `produktion.cat.${typ}.`;
    const suffix = `.${mode}`;
    const cats = raw
        .filter(p => p.startsWith(prefix) && p.endsWith(suffix))
        .map(p => p.slice(prefix.length, -suffix.length));
    return cats;
}

// ── StateV-API-Proxy-Helfer ──────────────────────────────────
// Der vAPI-Bearer-Key bleibt serverseitig in includes/config.php.
// Das Frontend ruft ausschließlich diesen Proxy auf.
function apiUrl(path) {
    return `api/proxy.php?path=${encodeURIComponent(path)}`;
}

function apiHeaders() {
    return {};
}

// Sendet mehrere vAPI-Pfade in einem einzigen HTTP-Request.
// Der Server führt alle parallel via curl_multi aus.
// Rückgabe: Map { path → { status, body } }
async function apiBatch(paths, force = false) {
    const res = await fetch('api/batch.php', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ paths, force }),
    });
    if (!res.ok) throw new Error(`Batch-Proxy Fehler: ${res.status}`);
    const results = await res.json();
    const map = {};
    results.forEach(r => { map[r.path] = r; });
    return map;
}

// ── Sofort-Prefetch lokaler Endpoints ───────────────────────
// production.php und contracts.php sind rein lokale PHP-Endpoints
// (kein StateV-API-Key nötig, nur Session). Diese Requests starten
// sofort beim Script-Parsen – parallel zur HTML-Verarbeitung und
// dem Rest der Initialisierung. Wenn loadProductionData() oder
// loadContractsData() das erste Mal aufgerufen werden, sind die
// Antworten in der Regel bereits vollständig angekommen.
window._prefetchProduction = fetch('api/production.php', { headers: { Accept: 'application/json' } })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);

window._prefetchContracts = fetch('api/contracts.php?action=all')
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);
