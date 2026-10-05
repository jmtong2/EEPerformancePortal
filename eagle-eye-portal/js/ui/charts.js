/* Charts (Chart.js, loaded on first use): campaign ranking bars and the grouped Repo chart.
   Colours come from a colour-blind-checked palette: one blue for single-series rankings; blue / orange / aqua for the
   grouped Repo chart (fixed per series, never by rank). Every chart has a table with the same figures next to it. */

const CHART = { blue: '#2a78d6', orange: '#eb6834', aqua: '#1baf7a', grid: '#e1e0d9', axis: '#898781', ink: '#334155', font: "'Inter', sans-serif" };
const chartRegistry = {};

async function ensureCharts() {
    await loadScript(LIB.chartjs);
    if (!window.Chart) throw new Error('The chart library did not load.');
    if (!ensureCharts.ready) { Chart.defaults.font.family = CHART.font; Chart.defaults.color = CHART.axis; ensureCharts.ready = true; }
    return window.Chart;
}

function destroyChart(id) { if (chartRegistry[id]) { chartRegistry[id].destroy(); delete chartRegistry[id]; } }

// Message on top of an empty / failed chart area.
function chartMessage(canvasId, text) {
    const box = $(canvasId).parentElement;
    let m = box.querySelector('.chart-msg');
    if (!m) { m = document.createElement('div'); m.className = 'chart-msg absolute inset-0 flex items-center justify-center text-xs text-slate-400 text-center px-4'; box.appendChild(m); }
    m.textContent = text || '';
    m.classList.toggle('hidden', !text);
}

// ₱1.23M / ₱456.7K — short peso amounts for axes and bar labels.
function compactPHP(n) {
    const a = Math.abs(n), sign = n < 0 ? '-' : '';
    if (a >= 1e6) return `${sign}₱${(a / 1e6).toFixed(2)}M`;
    if (a >= 1e3) return `${sign}₱${(a / 1e3).toFixed(1)}K`;
    return `${sign}₱${a.toFixed(0)}`;
}

// Writes each bar's value at its tip (ink colour, not the series colour). Used on single-series charts only.
const eeValueLabels = {
    id: 'eeValueLabels',
    afterDatasetsDraw(chart, _args, opts) {
        if (!opts || !opts.format) return;
        const { ctx } = chart, horizontal = chart.options.indexAxis === 'y';
        ctx.save();
        ctx.font = `600 11px ${CHART.font}`;
        ctx.fillStyle = CHART.ink;
        chart.data.datasets.forEach((ds, di) => {
            const meta = chart.getDatasetMeta(di);
            if (meta.hidden) return;
            meta.data.forEach((bar, i) => {
                const v = ds.data[i];
                const text = v === null || v === undefined ? (opts.nullText || '') : opts.format(v);
                if (!text) return;
                if (horizontal) {
                    const x = v === null || v === undefined ? chart.scales.x.getPixelForValue(0) : bar.x;
                    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + 6, bar.y);
                } else { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(text, bar.x, bar.y - 4); }
            });
        });
        ctx.restore();
    }
};

const chartTooltip = extra => ({
    backgroundColor: '#0f172a', titleFont: { weight: '700' }, padding: 10, cornerRadius: 8, displayColors: extra.colors !== false,
    callbacks: { label: extra.label, afterLabel: extra.afterLabel }
});

/* Horizontal ranking bars. rows: [{ label, value (number | null), tip: [text] }] in rank order. */
async function renderRankingChart(canvasId, rows, opt) {
    const box = $(canvasId).parentElement;
    box.style.height = Math.max(120, rows.length * 30 + 40) + 'px';
    let ChartJs;
    try { ChartJs = await ensureCharts(); } catch (e) { destroyChart(canvasId); chartMessage(canvasId, 'Chart not available (no internet?). The table below has the same figures.'); return; }
    destroyChart(canvasId);
    if (!rows.length) return chartMessage(canvasId, 'No data yet.');
    chartMessage(canvasId, '');
    $(canvasId).setAttribute('aria-label', `${opt.series} by campaign: ` + rows.map(r => `${r.label} ${r.value === null ? 'no data' : opt.format(r.value)}`).join('; '));
    chartRegistry[canvasId] = new ChartJs($(canvasId), {
        type: 'bar',
        data: { labels: rows.map(r => r.label), datasets: [{ label: opt.series, data: rows.map(r => r.value), backgroundColor: CHART.blue,
            borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24, categoryPercentage: 0.82, barPercentage: 0.9 }] },
        options: {
            indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
            layout: { padding: { right: 72 } },
            scales: {
                x: { beginAtZero: true, grid: { color: CHART.grid, drawTicks: false }, border: { display: false },
                    ticks: { color: CHART.axis, font: { size: 10 }, padding: 6, maxTicksLimit: 6, callback: v => (opt.axis || opt.format)(v) } },
                y: { grid: { display: false }, border: { color: CHART.grid }, ticks: { color: CHART.ink, font: { size: 11, weight: '600' } } }
            },
            plugins: {
                legend: { display: false },
                tooltip: chartTooltip({ colors: false, label: c => `${opt.series}: ${c.raw === null ? 'no data' : opt.format(c.raw)}`, afterLabel: c => rows[c.dataIndex].tip || '' }),
                eeValueLabels: { format: opt.format, nullText: '—' }
            }
        },
        plugins: [eeValueLabels]
    });
}

/* Vertical grouped bars. series: [{ label, data: [number | null], color }]; series without any value are left out. */
async function renderGroupedChart(canvasId, labels, series, opt) {
    let ChartJs;
    try { ChartJs = await ensureCharts(); } catch (e) { destroyChart(canvasId); chartMessage(canvasId, 'Chart not available (no internet?). The table below has the same figures.'); return; }
    destroyChart(canvasId);
    const shown = series.filter(s => s.data.some(v => v !== null && v !== undefined));
    if (!labels.length || !shown.length) return chartMessage(canvasId, 'No data yet.');
    chartMessage(canvasId, '');
    $(canvasId).setAttribute('aria-label', opt.title + ': ' + labels.map((l, i) => `${l} ` + shown.map(s => `${s.label} ${s.data[i] === null ? 'no data' : opt.format(s.data[i])}`).join(', ')).join('; '));
    chartRegistry[canvasId] = new ChartJs($(canvasId), {
        type: 'bar',
        data: { labels, datasets: shown.map(s => ({ label: s.label, data: s.data, backgroundColor: s.color, borderRadius: 4, borderSkipped: 'start',
            maxBarThickness: 24, categoryPercentage: 0.7, barPercentage: 0.9 })) },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            scales: {
                y: { beginAtZero: true, grid: { color: CHART.grid, drawTicks: false }, border: { display: false },
                    ticks: { color: CHART.axis, font: { size: 10 }, padding: 6, maxTicksLimit: 6, callback: v => opt.format(v) } },
                x: { grid: { display: false }, border: { color: CHART.grid }, ticks: { color: CHART.ink, font: { size: 11, weight: '600' }, autoSkip: false, maxRotation: 45 } }
            },
            plugins: {
                legend: { display: shown.length > 1, position: 'top', align: 'start', labels: { color: CHART.ink, boxWidth: 12, boxHeight: 12, padding: 14, font: { size: 11, weight: '600' } } },
                tooltip: chartTooltip({ label: c => `${c.dataset.label}: ${c.raw === null ? 'no data' : opt.format(c.raw)}` })
            }
        }
    });
}
