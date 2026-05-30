(function() {
    'use strict';
    
    // === CONSTANTS ===
    var BINANCE_REST = 'https://fapi.binance.com';
    var BINANCE_WS_ALL = 'wss://fstream.binance.com/market/stream?streams=';
    var BINANCE_WS_SINGLE = 'wss://fstream.binance.com/market/ws/';
    var NATR_PERIOD = 14;
    var RANGE_PERIOD = 20;
    var RANGE_THRESHOLD = 3.0;
    
    // === DOM REFS ===
    var $ = document.getElementById.bind(document);
    var listEl = $('list');
    var searchBox = $('search-box');
    var chartEl = $('chart');
    var statusEl = $('status');
    var wsStatusEl = $('ws-status');
    var rulerTooltip = $('ruler-tooltip');
    var btnFav = $('btn-fav');
    var btnVolat = $('btn-volat');
    var btnRange = $('btn-range');
    var btnGain = $('btn-gain');
    var btnLose = $('btn-lose');
    var btnRuler = $('btn-ruler');
    var btnMagnet = $('btn-magnet');
    var filterGroup = $('filter-group');
    var tfGroup = $('tf-group');
    
    // === STATE ===
    var allCoins = [], coinPrices = {}, changes24h = {};
    var currentSymbol = '', currentTF = '5m';
    var favorites = [];
    var activeFilter = 'volat';
    var chart = null, candleSeries = null;
    var klineData = [];
    var natrData = {};
    var rangeData = {};
    var priceWS = null, klineWS = null;
    var natrLoading = false, natrQueue = [];
    
    // === RULER / MAGNET STATE ===
    var rulerActive = false, rulerPts = [];   // [{time, price}]
    var magnetActive = false;
    var rulerMarkers = [];  // priceLine objects
    
    try { favorites = JSON.parse(localStorage.getItem('snip_favs') || '[]'); } catch(e) { favorites = []; }
    
    // === FAVORITES ===
    function saveFavs() {
        try { localStorage.setItem('snip_favs', JSON.stringify(favorites)); } catch(e) {}
    }
    
    function toggleFav(name) {
        var i = favorites.indexOf(name);
        if (i === -1) favorites.push(name); else favorites.splice(i, 1);
        saveFavs();
        renderCoinList();
    }
    
    function isFav(name) { return favorites.indexOf(name) !== -1; }
    
    // === NATR CALC ===
    function calcNATR(klines, period) {
        if (klines.length < period + 1) return -1;
        var trSum = 0;
        for (var i = klines.length - period; i < klines.length; i++) {
            var h = klines[i].high, l = klines[i].low, pc = klines[i - 1].close;
            var tr = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
            trSum += tr;
        }
        var atr = trSum / period;
        var close = klines[klines.length - 1].close;
        return (atr / close) * 100;
    }
    
    function detectRange(klines, period) {
        if (klines.length < period) return false;
        var slice = klines.slice(-period);
        var high = -Infinity, low = Infinity;
        for (var i = 0; i < slice.length; i++) {
            if (slice[i].high > high) high = slice[i].high;
            if (slice[i].low < low) low = slice[i].low;
        }
        return ((high - low) / low) * 100 < RANGE_THRESHOLD;
    }
    
    // === LOAD NATR FOR ONE COIN ===
    function loadCoinKlines(symbol) {
        var url = BINANCE_REST + '/fapi/v1/klines?symbol=' + symbol + '&interval=4h&limit=50';
        return fetch(url)
            .then(function(r) { return r.ok ? r.json() : null; })
            .then(function(raw) {
                if (!raw || !Array.isArray(raw) || raw.length < 20) {
                    natrData[symbol] = { natr: -1, isRange: false };
                    return;
                }
                var kls = raw.map(function(d) {
                    return { time: d[0] / 1000, open: +d[1], high: +d[2], low: +d[3], close: +d[4] };
                });
                natrData[symbol] = {
                    natr: calcNATR(kls, NATR_PERIOD),
                    isRange: detectRange(kls, RANGE_PERIOD)
                };
            })
            .catch(function() {
                natrData[symbol] = { natr: -1, isRange: false };
            });
    }
    
    function loadAllNATR() {
        if (natrLoading) return;
        natrLoading = true;
        statusEl.textContent = 'Загрузка NATR-анализа...';
        
        var syms = allCoins.map(function(c) { return c.symbol; });
        var batchSize = 8;
        var index = 0;
        
        function nextBatch() {
            var batch = syms.slice(index, index + batchSize);
            if (batch.length === 0) {
                natrLoading = false;
                statusEl.textContent = 'Анализ завершён · ' + allCoins.length + ' монет';
                renderCoinList();
                return;
            }
            index += batchSize;
            Promise.all(batch.map(loadCoinKlines)).then(function() {
                statusEl.textContent = 'NATR: ' + Math.min(index, syms.length) + '/' + syms.length + ' · ' + allCoins.length + ' монет';
                renderCoinList();
                setTimeout(nextBatch, 50);
            });
        }
        nextBatch();
    }
    
    // === LOAD COINS ===
    function loadCoins() {
        statusEl.textContent = 'Загрузка списка монет...';
        fetch(BINANCE_REST + '/fapi/v1/exchangeInfo')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                allCoins = data.symbols
                    .filter(function(s) { return s.quoteAsset === 'USDT' && s.status === 'TRADING' && s.contractType === 'PERPETUAL'; })
                    .map(function(s) {
                        return { name: s.symbol.replace('USDT', ''), symbol: s.symbol, price: null, change24h: 0 };
                    });
                statusEl.textContent = allCoins.length + ' торговых пар';
                sortCoins();
                renderCoinList();
                connectPriceWS();
                loadAllNATR();
                setTimeout(function() {
                    var btc = allCoins.find(function(c) { return c.name === 'BTC'; });
                    if (btc && !currentSymbol) selectCoin(btc.symbol);
                }, 800);
            })
            .catch(function(e) {
                statusEl.textContent = 'Ошибка загрузки: ' + e.message;
            });
    }
    
    // === SORT ===
    function sortCoins() {
        if (activeFilter === 'fav') {
            allCoins.sort(function(a, b) {
                var aF = isFav(a.name) ? 1 : 0, bF = isFav(b.name) ? 1 : 0;
                if (aF !== bF) return bF - aF;
                var aN = natrData[a.symbol], bN = natrData[b.symbol];
                var aV = aN ? aN.natr : -1, bV = bN ? bN.natr : -1;
                return bV - aV;
            });
        } else if (activeFilter === 'volat') {
            allCoins.sort(function(a, b) {
                var aN = natrData[a.symbol], bN = natrData[b.symbol];
                var aV = aN ? aN.natr : -1, bV = bN ? bN.natr : -1;
                return bV - aV;
            });
        } else if (activeFilter === 'range') {
            allCoins.sort(function(a, b) {
                var aN = natrData[a.symbol], bN = natrData[b.symbol];
                var aR = aN ? (aN.isRange ? 1 : 0) : 0;
                var bR = bN ? (bN.isRange ? 1 : 0) : 0;
                return bR - aR;
            });
        } else if (activeFilter === 'gain') {
            allCoins.sort(function(a, b) { return (b.change24h || 0) - (a.change24h || 0); });
        } else if (activeFilter === 'lose') {
            allCoins.sort(function(a, b) { return (a.change24h || 0) - (b.change24h || 0); });
        }
    }
    
    // === PRICE WS ===
    function connectPriceWS() {
        if (priceWS) { try { priceWS.close(); } catch(e) {} }
        priceWS = new WebSocket(BINANCE_WS_ALL + '!miniTicker@arr');
        priceWS.onopen = function() { wsStatusEl.textContent = 'WS: Online'; };
        priceWS.onmessage = function(e) {
            try {
                var msg = JSON.parse(e.data);
                if (!msg.data || !Array.isArray(msg.data)) return;
                msg.data.forEach(function(t) {
                    var sym = t.s, p = parseFloat(t.c), o = parseFloat(t.o);
                    coinPrices[sym] = p;
                    if (o > 0) changes24h[sym] = ((p - o) / o * 100);
                    if (sym === currentSymbol) updatePriceFromTicker(p);
                });
                updatePriceDisplay();
            } catch(err) {}
        };
        priceWS.onclose = function() { wsStatusEl.textContent = 'WS: Reconnecting...'; setTimeout(connectPriceWS, 3000); };
        priceWS.onerror = function() { wsStatusEl.textContent = 'WS: Error'; };
    }
    
    function updatePriceFromTicker(p) {
        if (!currentSymbol || klineData.length === 0) return;
        coinPrices[currentSymbol] = p;
        klineData[klineData.length - 1].close = p;
        if (p > klineData[klineData.length - 1].high) klineData[klineData.length - 1].high = p;
        if (p < klineData[klineData.length - 1].low) klineData[klineData.length - 1].low = p;
        if (candleSeries) {
            try {
                candleSeries.update(klineData[klineData.length - 1]);
            } catch(ex) {}
        }
    }
    
    function updatePriceDisplay() {
        var rows = listEl.querySelectorAll('.coin-item');
        rows.forEach(function(row) {
            var sym = row.dataset.symbol;
            var p = coinPrices[sym];
            if (p == null) return;
            var priceEl = row.querySelector('.coin-price');
            if (!priceEl) return;
            var d = getDec(sym);
            var textNode = priceEl.firstChild;
            if (textNode && textNode.nodeType === 3) {
                textNode.textContent = p.toFixed(d);
            }
            var chEl = row.querySelector('.change-val');
            if (chEl && changes24h[sym] != null) {
                var ch = changes24h[sym];
                chEl.textContent = (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%';
                chEl.className = 'change-val ' + (ch >= 0 ? 'change-pos' : 'change-neg');
            }
        });
    }
    
    function getDec(sym) {
        var p = coinPrices[sym];
        if (p == null) return 4;
        if (p < 0.01) return 6; if (p < 1) return 4; if (p < 100) return 3;
        return 2;
    }
    
    // === RENDER COIN LIST ===
    function renderCoinList() {
        var q = (searchBox.value || '').toLowerCase();
        var filtered;
        
        if (activeFilter === 'range') {
            // Show only range coins first, then others
            filtered = allCoins.filter(function(c) {
                if (q && c.name.toLowerCase().indexOf(q) === -1) return false;
                return true;
            });
            // Keep all but push range to top
            filtered.sort(function(a, b) {
                var aN = natrData[a.symbol], bN = natrData[b.symbol];
                var aR = aN ? (aN.isRange ? 1 : 0) : 0;
                var bR = bN ? (bN.isRange ? 1 : 0) : 0;
                return bR - aR;
            });
        } else if (activeFilter === 'fav') {
            filtered = allCoins.filter(function(c) {
                if (q && c.name.toLowerCase().indexOf(q) === -1) return false;
                return isFav(c.name);
            });
            // If no favs match, show all
            if (filtered.length === 0 && !q) {
                filtered = allCoins.filter(function(c) {
                    if (q && c.name.toLowerCase().indexOf(q) === -1) return false;
                    return true;
                });
            }
        } else {
            filtered = allCoins.filter(function(c) {
                if (q && c.name.toLowerCase().indexOf(q) === -1) return false;
                return true;
            });
        }
        
        listEl.innerHTML = '';
        filtered.forEach(function(c) {
            var nd = natrData[c.symbol];
            var natr = nd ? nd.natr : -1;
            var isRange = nd ? nd.isRange : false;
            var fav = isFav(c.name);
            var p = coinPrices[c.symbol];
            var ch = changes24h[c.symbol];
            
            var div = document.createElement('div');
            div.className = 'coin-item';
            div.dataset.symbol = c.symbol;
            if (c.symbol === currentSymbol) div.classList.add('active');
            
            var favClass = fav ? 'active' : '';
            var star = fav ? '★' : '☆';
            
            var natrStr = natr >= 0 ? natr.toFixed(2) + '%' : '...';
            var rangeStr = isRange ? '<span class="flat-badge">FLAT</span>' : '';
            var priceStr = p != null ? p.toFixed(getDec(c.symbol)) : '---';
            var chClass = '';
            var chStr = '';
            if (ch != null) {
                chClass = ch >= 0 ? 'change-pos' : 'change-neg';
                chStr = (ch >= 0 ? '+' : '') + ch.toFixed(1) + '%';
            }
            
            div.innerHTML =
                '<span class="fav-star ' + favClass + '" data-coin="' + c.name + '">' + star + '</span>' +
                '<span class="coin-name">' + c.name + '</span>' +
                '<span class="natr-val">' + natrStr + rangeStr + '</span>' +
                '<span class="coin-price">' + priceStr + '<span class="change-val ' + chClass + '">' + chStr + '</span></span>';
            
            div.addEventListener('click', function(e) {
                if (e.target.classList.contains('fav-star')) {
                    e.stopPropagation();
                    toggleFav(c.name);
                    return;
                }
                selectCoin(c.symbol);
            });
            
            listEl.appendChild(div);
        });
    }
    
    searchBox.addEventListener('input', function() {
        sortCoins();
        renderCoinList();
    });
    
    // === CHART ===
    function initChart() {
        chart = LightweightCharts.createChart(chartEl, {
            layout: {
                background: { type: 'solid', color: '#0b0e11' },
                textColor: '#848e9c',
            },
            grid: {
                vertLines: { color: '#2b3139' },
                horzLines: { color: '#2b3139' },
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
            },
            rightPriceScale: {
                borderColor: '#2b3139',
            },
            timeScale: {
                borderColor: '#2b3139',
                timeVisible: true,
                secondsVisible: false,
            },
            handleScroll: { vertTouchDrag: false },
        });
        
        candleSeries = chart.addCandlestickSeries({
            upColor: '#0ecb81',
            downColor: '#f6465d',
            borderDownColor: '#f6465d',
            borderUpColor: '#0ecb81',
            wickDownColor: '#f6465d',
            wickUpColor: '#0ecb81',
        });
        
        chart.subscribeCrosshairMove(function(param) {
            if (!param.time || !param.point) return;
            handleCrosshairMove(param);
        });
        
        chart.subscribeClick(function(param) {
            handleChartClick(param);
        });
        
        window.addEventListener('resize', function() {
            if (chart) chart.resize(chartEl.clientWidth, chartEl.clientHeight);
        });
    }
    
    // === CROSSHAIR WITH MAGNET ===
    function handleCrosshairMove(param) {
        if (!magnetActive || !candleSeries || klineData.length === 0) return;
        // Magnet snap is handled at click time - crosshair shows natural position
    }
    
    // === CHART CLICK (RULER) ===
    function handleChartClick(param) {
        if (!rulerActive || !param.time || param.point == null) return;
        
        var price = param.point.price;
        
        // Magnet: snap price to nearest OHLC
        if (magnetActive && klineData.length > 0) {
            var clickTime = param.time; // unix seconds
            var nearest = null, minDist = Infinity;
            for (var i = 0; i < klineData.length; i++) {
                var d = klineData[i];
                var dist = Math.abs(d.time - clickTime);
                if (dist < minDist) { minDist = dist; nearest = d; }
            }
            if (nearest) {
                var ohlc = [nearest.open, nearest.high, nearest.low, nearest.close];
                var best = ohlc[0], bestDist = Math.abs(ohlc[0] - price);
                for (var j = 1; j < ohlc.length; j++) {
                    var d2 = Math.abs(ohlc[j] - price);
                    if (d2 < bestDist) { bestDist = d2; best = ohlc[j]; }
                }
                price = best;
            }
        }
        
        if (rulerPts.length === 0) {
            rulerPts.push({ time: param.time, price: price });
            addRulerMarker(price);
            rulerTooltip.style.display = 'block';
            rulerTooltip.textContent = 'Кликни вторую точку...';
            updateRulerTooltipPosition(param);
        } else {
            rulerPts.push({ time: param.time, price: price });
            addRulerMarker(price);
            var pct = ((rulerPts[1].price - rulerPts[0].price) / rulerPts[0].price * 100);
            rulerTooltip.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
            updateRulerTooltipPosition(param);
            
            // Auto-reset after 3 seconds
            setTimeout(function() {
                if (rulerPts.length === 2 && rulerActive) {
                    clearRuler();
                }
            }, 3000);
        }
    }
    
    function addRulerMarker(price) {
        if (!candleSeries) return;
        var pl = candleSeries.createPriceLine({
            price: price,
            color: '#fcd535',
            lineWidth: 2,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: price.toFixed(6),
        });
        rulerMarkers.push(pl);
    }
    
    function clearRuler() {
        rulerPts = [];
        rulerMarkers.forEach(function(m) { if (candleSeries) candleSeries.removePriceLine(m); });
        rulerMarkers = [];
        rulerTooltip.style.display = 'none';
    }
    
    function updateRulerTooltipPosition(param) {
        rulerTooltip.style.display = 'block';
        rulerTooltip.style.left = '50%';
        rulerTooltip.style.top = '20px';
    }
    
    // === SELECT COIN ===
    function selectCoin(symbol) {
        currentSymbol = symbol;
        klineData = [];
        clearRuler();
        
        document.querySelectorAll('.coin-item').forEach(function(r) { r.classList.remove('active'); });
        var rows = listEl.querySelectorAll('.coin-item');
        rows.forEach(function(r) { if (r.dataset.symbol === symbol) r.classList.add('active'); });
        
        statusEl.textContent = 'Загрузка ' + symbol + ' ' + currentTF + '...';
        loadKlines().then(function() {
            connectKlineWS();
            statusEl.textContent = symbol + ' · ' + currentTF + ' · ' + klineData.length + ' свечей';
        });
    }
    
    // === LOAD KLINES ===
    function loadKlines() {
        if (!currentSymbol) return Promise.resolve();
        var url = BINANCE_REST + '/fapi/v1/klines?symbol=' + currentSymbol + '&interval=' + currentTF + '&limit=500';
        return fetch(url)
            .then(function(r) { return r.json(); })
            .then(function(raw) {
                if (!Array.isArray(raw)) throw new Error('Bad data');
                klineData = raw.map(function(d) {
                    return {
                        time: Math.floor(d[0] / 1000),
                        open: +d[1], high: +d[2], low: +d[3], close: +d[4]
                    };
                });
                if (klineData.length > 0) {
                    coinPrices[currentSymbol] = klineData[klineData.length - 1].close;
                }
                if (candleSeries) candleSeries.setData(klineData);
                if (chart && klineData.length > 0) {
                    chart.timeScale().fitContent();
                }
            })
            .catch(function(e) {
                statusEl.textContent = 'Ошибка графика: ' + e.message;
            });
    }
    
    // === KLINES WS ===
    function connectKlineWS() {
        if (klineWS) { try { klineWS.close(); } catch(e) {} }
        if (!currentSymbol) return;
        var streamName = currentSymbol.toLowerCase() + '@kline_' + currentTF;
        klineWS = new WebSocket(BINANCE_WS_SINGLE + streamName);
        klineWS.onmessage = function(e) {
            try {
                var msg = JSON.parse(e.data);
                if (!msg.k) return;
                var k = msg.k, t = Math.floor(k.t / 1000);
                if (klineData.length === 0) return;
                var last = klineData[klineData.length - 1];
                if (k.x) {
                    klineData.push({ time: t, open: +k.o, high: +k.h, low: +k.l, close: +k.c });
                    if (klineData.length > 1000) klineData.shift();
                    if (candleSeries) candleSeries.setData(klineData);
                } else {
                    last.close = +k.c;
                    if (+k.h > last.high) last.high = +k.h;
                    if (+k.l < last.low) last.low = +k.l;
                    if (candleSeries) candleSeries.update(last);
                }
                coinPrices[currentSymbol] = last.close;
                statusEl.textContent = currentSymbol + ' · ' + currentTF + ' · ' + klineData.length + ' свечей';
            } catch(err) {}
        };
        klineWS.onclose = function() {
            if (currentSymbol) {
                wsStatusEl.textContent = 'WS Kline: Reconnecting...';
                setTimeout(connectKlineWS, 3000);
            }
        };
        klineWS.onerror = function() {};
    }
    
    // === TIMEFRAME ===
    tfGroup.addEventListener('click', function(e) {
        var btn = e.target.closest('.tf-btn');
        if (!btn) return;
        var tf = btn.dataset.tf;
        if (!tf || tf === currentTF) return;
        
        tfGroup.querySelectorAll('.tf-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        currentTF = tf;
        clearRuler();
        if (currentSymbol) {
            statusEl.textContent = 'Загрузка ' + currentSymbol + ' ' + currentTF + '...';
            loadKlines().then(function() {
                connectKlineWS();
                statusEl.textContent = currentSymbol + ' · ' + currentTF + ' · ' + klineData.length + ' свечей';
            });
        }
    });
    
    // === TOOLS ===
    btnRuler.addEventListener('click', function() {
        rulerActive = !rulerActive;
        btnRuler.classList.toggle('active', rulerActive);
        if (!rulerActive) clearRuler();
        if (rulerActive) {
            magnetActive = false;
            btnMagnet.classList.remove('active');
        }
        statusEl.textContent = rulerActive ? 'ЛИНЕЙКА: кликни 2 точки на графике' : currentSymbol + ' · ' + currentTF;
    });
    
    btnMagnet.addEventListener('click', function() {
        magnetActive = !magnetActive;
        btnMagnet.classList.toggle('active', magnetActive);
        if (magnetActive) {
            statusEl.textContent = 'МАГНИТ: привязка к OHLC активна';
        } else {
            statusEl.textContent = currentSymbol + ' · ' + currentTF;
        }
    });
    
    // Esc to cancel
    window.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            clearRuler();
            rulerActive = false;
            btnRuler.classList.remove('active');
            magnetActive = false;
            btnMagnet.classList.remove('active');
            statusEl.textContent = currentSymbol + ' · ' + currentTF;
        }
    });
    
    // === FILTERS ===
    var filterBtns = {
        fav: btnFav,
        volat: btnVolat,
        range: btnRange,
        gain: btnGain,
        lose: btnLose
    };
    
    Object.keys(filterBtns).forEach(function(key) {
        filterBtns[key].addEventListener('click', function() {
            activeFilter = key;
            Object.values(filterBtns).forEach(function(b) { b.classList.remove('active'); });
            filterBtns[key].classList.add('active');
            sortCoins();
            renderCoinList();
        });
    });
    
    // Default: TOP NATR active
    btnVolat.classList.add('active');
    
    // === INIT ===
    initChart();
    loadCoins();
})();
