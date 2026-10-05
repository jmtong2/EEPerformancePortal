/* KPI Rate settings: targets and weights per bucket (Admin only — opened from the Data menu). */

function openKpiModal() {
    closeDataMenu();
    if (!isAdmin()) return deny('Only the Admin can change KPI settings.');
    fillKpiForm(kpiCfg());
    showModal('kpiModal');
}

function fillKpiForm(cfg) {
    cfg = sanitizeKpi(cfg);
    $('kpiTableBody').innerHTML = KPI_PARTS.map(([k, label, desc]) => `<tr class="border-b border-slate-100">
        <td class="py-2 pr-2"><b>${esc(label)}</b><br><span class="text-[10px] text-slate-400">${esc(desc)}</span></td>
        ${['curing', 'recovery'].map(t => `
            <td class="py-2 pr-2"><input type="number" step="0.1" min="0.1" max="100" id="kpi-${t}-${k}-target" value="${num(cfg[t].targets[k])}" class="inp" oninput="liveKpi()"></td>
            <td class="py-2 pr-2"><input type="number" step="1" min="0" max="100" id="kpi-${t}-${k}-weight" value="${num(cfg[t].weights[k])}" class="inp" oninput="liveKpi()"></td>`).join('')}
    </tr>`).join('');
    $('kpiCap').value = num(cfg.cap);
    liveKpi();
}

function validateKpi() {
    const errors = [], warnings = [], out = { cap: 0, curing: { weights: {}, targets: {} }, recovery: { weights: {}, targets: {} } };
    ['curing', 'recovery'].forEach(t => {
        let sum = 0;
        KPI_PARTS.forEach(([k, label]) => {
            const target = num($(`kpi-${t}-${k}-target`).value), weight = num($(`kpi-${t}-${k}-weight`).value);
            if (!(target > 0 && target <= 100)) errors.push(`${t} ${label} target must be between 0.1 and 100.`);
            if (!(weight >= 0 && weight <= 100) || !Number.isInteger(weight)) errors.push(`${t} ${label} weight must be a whole number 0–100.`);
            out[t].targets[k] = target; out[t].weights[k] = weight; sum += weight;
        });
        const Label = t[0].toUpperCase() + t.slice(1);
        $(`kpiSum${Label}`).innerHTML = `<span class="${sum === 100 ? 'text-emerald-600' : 'text-rose-600'}">${sum}</span>`;
        if (sum !== 100) errors.push(`${Label} weights add up to ${sum}; they must add up to 100.`);
    });
    out.cap = num($('kpiCap').value);
    if (!(out.cap >= 100 && out.cap <= 200)) errors.push('Score cap must be between 100 and 200.');
    return { errors, warnings, out };
}

function liveKpi() { renderChecks('kpiChecks', validateKpi()); }

async function handleSaveKpi(ev) {
    ev.preventDefault();
    if (!isAdmin()) return deny('Only the Admin can change KPI settings.');
    const v = validateKpi();
    if (!checksPass('kpiChecks', v)) return;
    try { await busy(ev.submitter, () => Backend.saveConfig({ kpi: v.out })); hideModal('kpiModal'); toast('KPI settings saved. Rankings updated.', 'ok'); } catch { }
}
