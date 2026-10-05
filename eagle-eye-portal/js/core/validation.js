/* Shared form validation: input readers + the red error / amber warning panel. */

const NAME_RE = /^[A-ZÑ0-9 .,'\-]+$/;   // campaigns
const PERSON_RE = /^[A-ZÑ .,'\-]+$/;    // people: no digits

function readMoney(id, label, errors) {
    const el = $(id), raw = el.value.trim();
    if (el.validity.badInput) { errors.push(`${label}: not a valid number.`); return 0; }
    if (raw === '') return 0;
    const n = Number(raw);
    if (!isFinite(n)) { errors.push(`${label}: not a valid number.`); return 0; }
    if (n < 0) errors.push(`${label} cannot be negative.`);
    else if (!/^\d+(\.\d{1,2})?$/.test(raw)) errors.push(`${label}: use at most 2 decimal places.`);
    else if (n > 9999999999) errors.push(`${label} is unrealistically large.`);
    return n;
}

function readInt(id, label, errors) {
    const el = $(id), raw = el.value.trim();
    if (el.validity.badInput) { errors.push(`${label}: not a valid number.`); return 0; }
    if (raw === '') return 0;
    if (!/^\d+$/.test(raw)) { errors.push(`${label} must be a whole number (0 or more).`); return 0; }
    return parseInt(raw, 10);
}

// Optional fields: a blank box means "not provided" (null), not zero.
function readOptMoney(id, label, errors) { const el = $(id); return el.value.trim() === '' && !el.validity.badInput ? null : readMoney(id, label, errors); }
function readOptInt(id, label, errors) { const el = $(id); return el.value.trim() === '' && !el.validity.badInput ? null : readInt(id, label, errors); }

// v = { errors: [], warnings: [] }. Warnings need a confirmation tick before saving.
function renderChecks(boxId, v) {
    const box = $(boxId), ackId = boxId + 'Ack';
    if (!v.errors.length && !v.warnings.length) { box.innerHTML = ''; box.classList.add('hidden'); box.dataset.sig = ''; return; }
    const sig = v.warnings.join('|');
    const keepAck = box.dataset.sig === sig && $(ackId) && $(ackId).checked;
    box.dataset.sig = sig;
    box.classList.remove('hidden');
    box.innerHTML =
        v.errors.map(e => `<div class="text-rose-600 font-semibold"><i class="fa-solid fa-circle-xmark"></i> ${esc(e)}</div>`).join('') +
        v.warnings.map(w => `<div class="text-amber-700"><i class="fa-solid fa-triangle-exclamation"></i> ${esc(w)}</div>`).join('') +
        (v.warnings.length && !v.errors.length ? `<label class="flex items-center gap-2 pt-2 mt-1 border-t border-slate-100 font-semibold text-slate-700"><input type="checkbox" id="${ackId}" ${keepAck ? 'checked' : ''}> I have double-checked these values and they are correct.</label>` : '');
}

function checksPass(boxId, v) {
    renderChecks(boxId, v);
    if (v.errors.length) { toast('Please fix the errors shown in red.', 'err'); return false; }
    if (v.warnings.length && !($(boxId + 'Ack') && $(boxId + 'Ack').checked)) { toast('Please review the warnings and tick the confirmation box.', 'err'); return false; }
    return true;
}
