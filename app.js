// ============================================================
// Coffee Roaster PWA — app.js
// ============================================================

// ---------- DOM refs ----------
const startBtn  = document.getElementById('startBtn');
const markBtn   = document.getElementById('markBtn');
const statusEl  = document.getElementById('status');
const tempEl    = document.getElementById('temp');
const rorEl     = document.getElementById('ror');

// ---------- state ----------
let startTime   = 0;
let lastRorSign = null;
let ws          = null;
let reconnectTimer = null;

// ---------- helper: scroll x-axis ----------
function getXMax(elapsed) {
    if (elapsed <= 10) return 10;
    return Math.ceil(elapsed / 2) * 2;
}

function applyScroll(chart, xMin) {
    // trim temp dataset
    let t = chart.data.datasets[0].data;
    while (t.length && t[0].x < xMin) t.shift();
    // trim ror dataset
    let r = chart.data.datasets[1].data;
    while (r.length && r[0].x < xMin) r.shift();
    // trim marks dataset
    let m = chart.data.datasets[2].data;
    while (m.length && m[0].x < xMin) m.shift();
}

function timeStr(ms) {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return m + ':' + String(s).padStart(2, '0');
}

// ---------- merged chart ----------
const ctx = document.getElementById('chart').getContext('2d');

const chart = new Chart(ctx, {
    type: 'line',
    data: {
        datasets: [
            {
                label: 'Temperature',
                yAxisID: 'y-temp',
                data: [],
                borderColor: 'rgb(255,99,132)',
                backgroundColor: 'rgba(255,99,132,0.05)',
                borderWidth: 2,
                tension: 0.2,
                pointRadius: 0
            },
            {
                label: 'ROR',
                yAxisID: 'y-ror',
                data: [],
                borderColor: 'rgb(54,162,235)',
                backgroundColor: 'rgba(54,162,235,0.05)',
                borderWidth: 2,
                tension: 0.2,
                pointRadius: 0
            },
            {
                label: 'Marks',
                yAxisID: 'y-temp',
                type: 'scatter',
                data: [],
                pointRadius: 5,
                pointBackgroundColor: '#FFD700',
                pointBorderColor: '#333',
                pointBorderWidth: 1,
                showLine: false,
                order: 1
            }
        ]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: true },
        plugins: {
            legend: {
                labels: { color: '#ccc', usePointStyle: true, pointStyle: 'line' }
            },
            tooltip: { mode: 'nearest', intersect: true }
        },
        scales: {
            x: {
                type: 'linear',
                title: { display: true, text: 'Time (minutes)', color: '#999' },
                min: 0, max: 10,
                ticks: {
                    stepSize: 1, color: '#888',
                    callback: v => Number.isInteger(v) ? v : null
                },
                grid: { color: '#333' }
            },
            'y-temp': {
                type: 'linear',
                position: 'left',
                title: { display: true, text: 'Temperature (°C)', color: 'rgb(255,99,132)' },
                min: 0, max: 220,
                ticks: { color: 'rgb(255,99,132)' },
                grid: { color: '#333' }
            },
            'y-ror': {
                type: 'linear',
                position: 'right',
                title: { display: true, text: 'ROR (°C/min)', color: 'rgb(54,162,235)' },
                min: 0, max: 15,
                ticks: { color: 'rgb(54,162,235)' },
                grid: { drawOnChartArea: false }
            }
        }
    },
    plugins: [{
        id: 'markLabels',
        afterDraw(chart) {
            const ds = chart.data.datasets[2];
            if (!ds || !ds.data || !ds.data.length) return;
            const ctx2 = chart.ctx;
            const xAxis = chart.scales.x;
            const yAxis = chart.scales['y-temp'];
            ctx2.save();
            ds.data.forEach(pt => {
                const px = xAxis.getPixelForValue(pt.x);
                const py = yAxis.getPixelForValue(pt.y);
                if (px === undefined || py === undefined) return;
                ctx2.fillStyle = 'rgba(0,0,0,0.75)';
                const lines = pt.label.split('\n');
                const fh = 12;
                const tw = Math.max(...lines.map(l => ctx2.measureText(l).width));
                ctx2.fillRect(px - tw/2 - 4, py - fh * lines.length - 14, tw + 8, fh * lines.length + 6);
                ctx2.fillStyle = '#fff';
                ctx2.font = '10px Arial';
                ctx2.textAlign = 'center';
                lines.forEach((line, i) => {
                    ctx2.fillText(line, px, py - 12 - (lines.length - 1 - i) * fh);
                });
            });
            ctx2.restore();
        }
    }]
});

// ---------- add mark ----------
function addMarkPoint(x, y, label) {
    chart.data.datasets[2].data.push({ x, y, label });
}

function addMark() {
    if (startTime === 0) return;
    const ds = chart.data.datasets[0].data;
    if (!ds.length) return;
    const last = ds[ds.length - 1];
    const elapsed = Date.now() - startTime;
    addMarkPoint(last.x, last.y, last.y.toFixed(1) + '°C\n' + timeStr(elapsed));
    chart.update('none');
}

// ---------- auto-mark on ROR sign change ----------
function checkAutoMark(temp, ror, elapsedMin, elapsedMs) {
    const sign = ror === 0 ? 0 : (ror > 0 ? 1 : -1);
    if (lastRorSign !== null && lastRorSign !== 0 && sign !== 0 && sign !== lastRorSign) {
        addMarkPoint(elapsedMin, temp, temp.toFixed(1) + '°C\n' + timeStr(elapsedMs));
    }
    if (sign !== 0) lastRorSign = sign;
}

// ---------- handle history batch ----------
function loadHistory(arr) {
    if (!arr.length) return;
    chart.data.datasets[0].data = [];
    chart.data.datasets[1].data = [];
    chart.data.datasets[2].data = [];
    lastRorSign = null;
    for (let i = 0; i < arr.length; i++) {
        const min = i / 60;
        chart.data.datasets[0].data.push({ x: min, y: arr[i][0] });
        chart.data.datasets[1].data.push({ x: min, y: arr[i][1] });
        if (i > 0) checkAutoMark(arr[i][0], arr[i][1], min, i * 1000);
    }
    const lastElapsed = (arr.length - 1) / 60;
    const xMax = getXMax(lastElapsed);
    const xMin = xMax - 10;
    applyScroll(chart, xMin);
    chart.options.scales.x.min = xMin;
    chart.options.scales.x.max = xMax;
    startTime = Date.now() - arr.length * 1000;
    chart.update('none');
}

// ---------- START / RESET ----------
function handleStartReset() {
    if (startTime === 0 || startBtn.textContent === '重置') {
        // Start or Reset
        sendWS('START');
        startTime = Date.now();
        chart.data.datasets[0].data = [];
        chart.data.datasets[1].data = [];
        chart.data.datasets[2].data = [];
        lastRorSign = null;
        chart.options.scales.x.min = 0;
        chart.options.scales.x.max = 10;
        chart.update('none');
        startBtn.textContent = '重置';
        startBtn.classList.add('running');
        markBtn.disabled = false;
    }
}

function sendWS(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(msg);
}

// ---------- WebSocket ----------
function connectWS() {
    if (ws) { ws.onclose = null; ws.close(); }
    const host = window.location.hostname;
    ws = new WebSocket('ws://' + host + '/ws');

    ws.onopen = function () {
        statusEl.innerHTML = '● 已连接';
        statusEl.className = 'status online';
        if (reconnectTimer) { clearInterval(reconnectTimer); reconnectTimer = null; }
    };

    ws.onmessage = function (e) {
        const data = JSON.parse(e.data);

        if (Array.isArray(data)) {
            loadHistory(data);
            if (data.length > 0) {
                startBtn.textContent = '重置';
                startBtn.classList.add('running');
                markBtn.disabled = false;
            }
            return;
        }

        if (data.cmd === 'start') {
            startTime = Date.now();
            chart.data.datasets[0].data = [];
            chart.data.datasets[1].data = [];
            chart.data.datasets[2].data = [];
            lastRorSign = null;
            chart.options.scales.x.min = 0;
            chart.options.scales.x.max = 10;
            chart.update('none');
            startBtn.textContent = '重置';
            startBtn.classList.add('running');
            markBtn.disabled = false;
            return;
        }

        // real-time update
        tempEl.innerHTML = data.temp.toFixed(1) + '<span class="unit">&deg;C</span>';
        rorEl.innerHTML  = data.ror.toFixed(1) + '<span class="unit">&deg;C/min</span>';

        if (startTime === 0) return;

        const elapsed = Date.now() - startTime;
        const elapsedMin = elapsed / 60000;
        const xMax = getXMax(elapsedMin);
        const xMin = xMax - 10;

        chart.data.datasets[0].data.push({ x: elapsedMin, y: data.temp });
        chart.data.datasets[1].data.push({ x: elapsedMin, y: data.ror });
        checkAutoMark(data.temp, data.ror, elapsedMin, elapsed);
        applyScroll(chart, xMin);
        chart.options.scales.x.min = xMin;
        chart.options.scales.x.max = xMax;
        chart.update('none');
    };

    ws.onclose = function () {
        statusEl.innerHTML = '● 断开，重连中...';
        statusEl.className = 'status offline';
        if (!reconnectTimer) reconnectTimer = setInterval(connectWS, 3000);
    };

    ws.onerror = function () { ws.close(); };
}

// ---------- init ----------
function init() {
    // register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    connectWS();
}

init();
