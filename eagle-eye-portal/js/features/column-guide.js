/* Column Guide modal (definitions, ON TRACK, KPI explanation), printable for the OMs. */

function openGuide() {
    const cfg = sanitizeKpi(kpiCfg()), t = (b, k) => `${num(cfg[b].targets[k])}% / ${num(cfg[b].weights[k])}`;
    const prog = bdProgress(effectiveAsOf());
    const hols = (state.holidays || []).filter(h => periodOf(h.date) === prog.period);
    $('guideBody').innerHTML = `
        <table class="w-full text-left border-collapse mb-5">
            <thead><tr class="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200"><th class="py-2 px-2 w-48">Column</th><th class="py-2 px-2">Meaning / Formula</th></tr></thead>
            <tbody>${GLOSSARY.map(([k, d]) => `<tr class="border-b border-slate-100 align-top"><td class="py-2 px-2 font-bold text-slate-900">${esc(k)}</td><td class="py-2 px-2">${esc(d)}</td></tr>`).join('')}</tbody>
        </table>
        <h4 class="font-bold text-slate-900 text-sm mb-1">Company tabs (Collection · Provision · Repo)</h4>
        <p class="mb-4">Company totals for the selected campaign filter, shown as <b>Company total</b> (Curing, Recovery and the total) or <b>By campaign</b>. The portal computes every %, VARIANCE and ON TRACK column itself; the formulas are listed under each table. SAME PERIOD comes from the Excel file. Repo also has a chart of Actual vs On Track vs Same Period.</p>
        <h4 class="font-bold text-slate-900 text-sm mb-1">ON TRACK and business days</h4>
        <p class="mb-1">ON TRACK = monthly figure ÷ business days in the month × business days up to today (today included). Business days are Monday to Friday, minus holidays and non-working days set by the Admin (Data → Month &amp; holidays).</p>
        <p class="mb-4">Now: <b>${esc(periodLabel(prog.period))}</b>, up to <b>${esc(dateLabel(prog.asOf))}</b> — business day <b>${prog.elapsed} of ${prog.total}</b>${hols.length ? ` (holidays this month: ${esc(hols.map(h => `${h.date.slice(8)} ${h.name}`.trim()).join(', '))})` : ''}.</p>
        <h4 class="font-bold text-slate-900 text-sm mb-1">Buckets</h4>
        <p class="mb-4"><b>Curing</b>: accounts that are past due but can still be brought current. <b>Recovery</b>: accounts that have already rolled, where the goal is to recover the balance. Provision figures always refer to the telecollector's accounts in that bucket.</p>
        <h4 class="font-bold text-slate-900 text-sm mb-1">How the provision columns relate</h4>
        <p class="mb-1">Beginning ≥ To Retain. ACH % = Fixed Provision ÷ To Retain · Provision Variance = To Retain − Fixed Provision.</p>
        <p class="mb-4">While To Retain is blank, ACH %, the provision %, On Track Provision and Provision Variance show "—" and the KPI Rate leaves Provision out (the other weights are re-scaled).</p>
        <h4 class="font-bold text-slate-900 text-sm mb-1">KPI Rate</h4>
        <p class="mb-2">Each metric is scored as <b>actual ÷ target</b> (capped at ${num(cfg.cap)}%), then combined with the weights below. 100% = met every target. Leader (TL/OM/GM) KPI = average of their telecollectors' KPI, weighted by collectibles. Telecollectors with no figures yet are not ranked (shown as —).</p>
        <table class="w-full text-left border-collapse mb-2">
            <thead><tr class="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200"><th class="py-2 px-2">Metric</th><th class="py-2 px-2">Measured by</th><th class="py-2 px-2 text-amber-700">Curing target / weight</th><th class="py-2 px-2 text-blue-700">Recovery target / weight</th></tr></thead>
            <tbody>${KPI_PARTS.map(([k, label, desc]) => `<tr class="border-b border-slate-100"><td class="py-2 px-2 font-bold">${esc(label)}</td><td class="py-2 px-2">${esc(desc)}</td><td class="py-2 px-2">${t('curing', k)}</td><td class="py-2 px-2">${t('recovery', k)}</td></tr>`).join('')}</tbody>
        </table>
        <p class="text-[11px] text-slate-500">Example: a curing tele with EFF 30% vs a 40% target scores 75 points on Collection, multiplied by its weight of ${num(cfg.curing.weights.collection)}. Targets and weights can be changed by the Admin in Data → KPI Rate settings.</p>`;
    showModal('guideModal');
}

function printGuide() {
    document.body.classList.add('print-guide');
    window.print();
    setTimeout(() => document.body.classList.remove('print-guide'), 500);
}
