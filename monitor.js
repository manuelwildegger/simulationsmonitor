/* monitor.js – Darstellung des Patientenmonitors (Sweep-Rendering auf Canvas) */
(function () {
  'use strict';

  var eng = new Engine();
  var cv = document.getElementById('cv');
  var ctx = cv.getContext('2d');
  var wrap = document.getElementById('waves');

  var W = 0, H = 0, dpr = 1;
  var x = 0, lanes = [], GAP = 16;
  /* Handy-Fassung (mobil.html): Pixeldichte begrenzen – dreifach aufgeloest
     kostet nur Akku, scharf genug ist es auch zweifach. */
  var MOBILE = document.body.classList.contains('mobile');
  function pixelRatio() {
    var r = window.devicePixelRatio || 1;
    return MOBILE ? Math.min(r, 2) : r;
  }
  var connected = false;
  var frozen = false, pendingRebuild = false;

  var COL = { ecg: '#e8ecf2', art: '#ff4d4d', pleth: '#ff6fb5', cvp: '#36d5e0',
              pace: '#3ce06a' };   /* Schrittmacherimpulse */

  /* ---------- Layout ---------- */

  function resize() {
    dpr = pixelRatio();
    W = wrap.clientWidth; H = wrap.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    buildLanes();
    clearAll();
    fitDraw();
  }

  /* Druckmassstab wie am Geraet: der naechstgroessere der festen Bereiche.
     Bei niedrigem Druck wird die Kurve dadurch groesser gezeichnet – sonst
     sieht man weder die Form noch das Undulieren. */
  var ART_SCALES = [150, 210, 300];
  var artMax = 150;
  function artScale() {
    var sys = eng.state.sys || 120;
    for (var i = 0; i < ART_SCALES.length; i++) if (sys * 1.06 <= ART_SCALES[i]) return ART_SCALES[i];
    return 400;
  }

  /* Hilfslinien: sieben gestrichelte Linien ueber den Kanal, also sechs
     gleiche Abschnitte. Beschriftet wird nur die mittlere. */
  var GRID_N = 6;
  var GRID_COL = { art: 'rgba(255, 77, 77, .26)', pleth: 'rgba(255, 111, 181, .20)' };

  function buildLanes() {
    var show = eng.state.show || {};
    artMax = artScale();
    var defs = [{ key: 'ecg', lab: 'II', sub: 'EKG' }];
    if (show.art !== false) defs.push({ key: 'art', lab: 'ABP', sub: '0 – ' + artMax + ' mmHg' });
    if (show.pleth !== false) defs.push({ key: 'pleth', lab: 'Pleth', sub: 'SpO₂' });
    if (show.cvp !== false) defs.push({ key: 'cvp', lab: 'ZVD', sub: '–5 – 25 mmHg' });

    Array.prototype.slice.call(document.querySelectorAll('.lanelab')).forEach(function (n) { n.remove(); });
    Array.prototype.slice.call(document.querySelectorAll('.gridlab')).forEach(function (n) { n.remove(); });

    var h = H / defs.length;
    lanes = defs.map(function (d, i) {
      var y0 = i * h;
      var ln = { key: d.key, color: COL[d.key], y0: y0, h: h, lastX: 0, lastY: y0 + h / 2 };
      if (d.key === 'ecg') ln.toY = function (v) { return clampY(y0 + h * 0.66 - v * h * 0.30, y0, h); };
      else if (d.key === 'art') ln.toY = function (v) { return clampY(y0 + h - h * 0.06 - (v / artMax) * h * 0.88, y0, h); };
      else if (d.key === 'pleth') ln.toY = function (v) { return clampY(y0 + h - h * 0.10 - v * h * 0.72, y0, h); };
      else ln.toY = function (v) { return clampY(y0 + h - h * 0.08 - ((v + 5) / 30) * h * 0.84, y0, h); };

      /* Gestrichelte Hilfslinien in Druck- und Plethkurve: sie erleichtern
         das Ablesen, ohne die Kurve zu verdecken. */
      if (d.key === 'art' || d.key === 'pleth') {
        ln.gridColor = GRID_COL[d.key];
        ln.grid = [];
        for (var g = 0; g <= GRID_N; g++) {
          ln.grid.push(d.key === 'art' ? ln.toY(artMax * g / GRID_N)
                                       : ln.toY(g / GRID_N));
        }
        if (d.key === 'art') {
          var mid = document.createElement('div');
          mid.className = 'gridlab';
          mid.style.top = (ln.grid[GRID_N / 2] - 14) + 'px';
          mid.style.color = ln.color;
          mid.textContent = String(artMax / 2);
          wrap.appendChild(mid);
        }
      }

      var el = document.createElement('div');
      el.className = 'lanelab';
      el.style.top = (y0 + 5) + 'px';
      el.style.color = ln.color;
      el.innerHTML = d.lab + '<small>' + d.sub + '</small>';
      wrap.appendChild(el);
      return ln;
    });
  }

  function clampY(y, y0, h) { return y < y0 + 2 ? y0 + 2 : (y > y0 + h - 2 ? y0 + h - 2 : y); }

  function clearAll() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    separators(0, W);
    x = 0;
    lanes.forEach(function (l) { l.lastX = 0; l.lastY = l.toY(0); });
  }

  function separators(x0, w) {
    ctx.strokeStyle = '#171c24'; ctx.lineWidth = 1;
    for (var i = 1; i < lanes.length; i++) {
      var y = Math.round(lanes[i].y0) + 0.5;
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
    }
    grid(x0, w);
  }

  /* Die Striche werden am Bildrand ausgerichtet (lineDashOffset), sonst
     verschiebt sich das Muster mit jedem neu gezeichneten Streifen. */
  function grid(x0, w) {
    if (w <= 0) return;
    ctx.save();
    ctx.setLineDash([2, 6]);
    ctx.lineWidth = 1;
    for (var i = 0; i < lanes.length; i++) {
      var ln = lanes[i];
      if (!ln.grid) continue;
      ctx.strokeStyle = ln.gridColor;
      ctx.lineDashOffset = -x0;
      for (var g = 0; g < ln.grid.length; g++) {
        var y = Math.round(ln.grid[g]) + 0.5;
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + w, y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* ---------- Zeichnen ---------- */

  function drawSpan(x0, x1, t0, t1) {
    var n = Math.max(2, Math.ceil((x1 - x0) * 6));
    var xs = new Array(n), vals = new Array(n), spk = new Array(n), i, j;
    for (i = 0; i < n; i++) {
      var f = (i + 1) / n, t = t0 + (t1 - t0) * f;
      xs[i] = x0 + (x1 - x0) * f;
      vals[i] = eng.sample(t);
      spk[i] = eng.isSpike(t);
    }
    for (j = 0; j < lanes.length; j++) {
      var ln = lanes[j];
      if (ln.key === 'ecg') { drawEcg(ln, xs, vals, spk, n); continue; }
      ctx.strokeStyle = ln.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(ln.lastX, ln.lastY);
      var y = ln.lastY;
      for (i = 0; i < n; i++) { y = ln.toY(vals[i][ln.key]); ctx.lineTo(xs[i], y); }
      ctx.stroke();
      ln.lastX = xs[n - 1]; ln.lastY = y;
    }
  }

  /* EKG in Abschnitten zeichnen, damit Schrittmacherimpulse farbig absetzen. */
  function drawEcg(ln, xs, vals, spk, n) {
    var px = ln.lastX, py = ln.lastY, cur = false, i;
    ctx.strokeStyle = COL.ecg; ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(px, py);
    for (i = 0; i < n; i++) {
      var y = ln.toY(vals[i].ecg);
      if (spk[i] !== cur) {
        ctx.stroke();
        cur = spk[i];
        ctx.strokeStyle = cur ? COL.pace : COL.ecg;
        ctx.lineWidth = cur ? 2.1 : 1.7;
        ctx.beginPath(); ctx.moveTo(px, py);
      }
      ctx.lineTo(xs[i], y);
      px = xs[i]; py = y;
    }
    ctx.stroke();
    ln.lastX = px; ln.lastY = py;
  }

  /* ---------- Standbild und Hineinmalen ---------- */

  /* Eingefroren wird, indem die Schleife weiterlaeuft, die Simulation aber
     nicht mehr weitergerechnet und nichts mehr gezeichnet wird. Das Bild
     bleibt also genau so stehen, wie es ist. Gemalt wird auf einer eigenen
     Ebene ueber den Kurven – nur so kann der Radierer die Striche wieder
     wegnehmen, ohne die Kurve mit abzutragen. */

  var dcv = document.getElementById('draw');
  var dctx = dcv.getContext('2d');
  var drawTool = 'pen', penCol = '#ffd23f';
  var drawing = false, lastPt = null;
  /* Jeder Strich wird als Punktfolge gemerkt. Nur so kann der Radierer einen
     ganzen Strich wegnehmen, sobald er ihn beruehrt. */
  var strokes = [], cur = null;
  var PEN_W = 3, ERASE_R = 9;

  function fitDraw() {
    dcv.width = Math.round(W * dpr); dcv.height = Math.round(H * dpr);
    dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dctx.lineJoin = 'round'; dctx.lineCap = 'round';
    strokes = []; cur = null;
  }
  function clearDraw() { strokes = []; cur = null; dctx.clearRect(0, 0, W, H); }

  function paintStroke(st) {
    var p = st.pts;
    if (p.length === 1) {            /* nur angetippt: ein Punkt */
      dctx.fillStyle = st.col;
      dctx.beginPath(); dctx.arc(p[0][0], p[0][1], PEN_W / 2, 0, 6.2832); dctx.fill();
      return;
    }
    dctx.strokeStyle = st.col; dctx.lineWidth = PEN_W;
    dctx.beginPath(); dctx.moveTo(p[0][0], p[0][1]);
    for (var i = 1; i < p.length; i++) dctx.lineTo(p[i][0], p[i][1]);
    dctx.stroke();
  }
  function repaint() {
    dctx.clearRect(0, 0, W, H);
    strokes.forEach(paintStroke);
  }

  /* Abstand zweier Strecken – fuer den Radierer */
  function distPS(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy;
    var t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var ex = p[0] - a[0] - t * dx, ey = p[1] - a[1] - t * dy;
    return Math.sqrt(ex * ex + ey * ey);
  }
  function orient(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
  function distSS(a, b, c, d) {
    var o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    if (((o1 > 0) !== (o2 > 0)) && ((o3 > 0) !== (o4 > 0)) && o1 && o2 && o3 && o4) return 0;
    return Math.min(distPS(a, c, d), distPS(b, c, d), distPS(c, a, b), distPS(d, a, b));
  }
  function touches(st, a, b) {
    var p = st.pts, lim = ERASE_R + PEN_W / 2;
    if (p.length === 1) return distPS(p[0], a, b) <= lim;
    for (var i = 1; i < p.length; i++) if (distSS(a, b, p[i - 1], p[i]) <= lim) return true;
    return false;
  }
  /* Radieren: jeder Strich, den der Weg des Radierers beruehrt, verschwindet ganz. */
  function eraseAlong(a, b) {
    var n = strokes.length;
    strokes = strokes.filter(function (st) { return !touches(st, a, b); });
    if (strokes.length !== n) repaint();
  }

  function setFreeze(on) {
    if (frozen === on) return;
    frozen = on;
    document.getElementById('frozenTag').style.display = on ? '' : 'none';
    document.getElementById('drawbar').style.display = on ? '' : 'none';
    dcv.style.pointerEvents = on ? 'auto' : 'none';
    document.getElementById('skFreeze').classList.toggle('on', on);
    document.getElementById('skFreezeVal').textContent = on ? 'beenden' : 'einfrieren';
    if (!on) {
      clearDraw();
      drawing = false;
      /* Was waehrend des Standbilds umgestellt wurde, wird jetzt nachgezogen. */
      if (wrap.clientWidth !== W || wrap.clientHeight !== H) { pendingRebuild = false; resize(); }
      else if (pendingRebuild) { buildLanes(); clearAll(); pendingRebuild = false; }
      last = performance.now();
    }
    post({ type: 'freeze', on: on });
    post({ type: 'event', text: on ? 'Standbild am Monitor' : 'Standbild beendet' });
  }

  /* Mausposition in den Koordinaten der Zeichenflaeche. Gerechnet wird ueber
     die tatsaechlich dargestellte Groesse: Strich und Zeiger liegen so auch
     dann uebereinander, wenn die Flaeche im Standbild ihre Groesse aendert. */
  function pt(e) {
    var r = dcv.getBoundingClientRect();
    return [(e.clientX - r.left) * (r.width ? W / r.width : 1),
            (e.clientY - r.top) * (r.height ? H / r.height : 1)];
  }
  dcv.addEventListener('pointerdown', function (e) {
    if (!frozen) return;
    drawing = true;
    try { dcv.setPointerCapture(e.pointerId); } catch (err) {}
    lastPt = pt(e);
    if (drawTool === 'erase') eraseAlong(lastPt, lastPt);
    else { cur = { col: penCol, pts: [lastPt] }; strokes.push(cur); paintStroke(cur); }
    e.preventDefault();
  });
  dcv.addEventListener('pointermove', function (e) {
    if (!drawing) return;
    var p = pt(e);
    if (drawTool === 'erase') eraseAlong(lastPt, p);
    else if (cur) {
      cur.pts.push(p);
      dctx.strokeStyle = cur.col; dctx.lineWidth = PEN_W;
      dctx.beginPath(); dctx.moveTo(lastPt[0], lastPt[1]); dctx.lineTo(p[0], p[1]); dctx.stroke();
    }
    lastPt = p;
    e.preventDefault();
  });
  ['pointerup', 'pointercancel'].forEach(function (t) {
    dcv.addEventListener(t, function () { drawing = false; cur = null; });
  });

  (function () {
    var bar = document.getElementById('drawbar');
    Array.prototype.forEach.call(bar.querySelectorAll('[data-tool]'), function (b) {
      b.onclick = function () {
        drawTool = b.getAttribute('data-tool');
        dcv.classList.toggle('erase', drawTool === 'erase');
        Array.prototype.forEach.call(bar.querySelectorAll('[data-tool]'), function (o) {
          o.classList.toggle('on', o === b);
        });
      };
    });
    Array.prototype.forEach.call(bar.querySelectorAll('[data-col]'), function (b) {
      b.onclick = function () {
        penCol = b.getAttribute('data-col');
        drawTool = 'pen';
        dcv.classList.remove('erase');
        Array.prototype.forEach.call(bar.querySelectorAll('[data-col]'), function (o) {
          o.classList.toggle('on', o === b);
        });
        Array.prototype.forEach.call(bar.querySelectorAll('[data-tool]'), function (o) {
          o.classList.toggle('on', o.getAttribute('data-tool') === 'pen');
        });
      };
    });
    document.getElementById('dkClear').onclick = clearDraw;
  })();

  /* ---------- Ton ---------- */

  var actx = null, soundOn = false;

  function initAudio() {
    if (actx) return;
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { actx = null; }
  }

  function tone(freq, dur, gain, type) {
    if (!actx || !soundOn) return;
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type || 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(gain, actx.currentTime + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(); o.stop(actx.currentTime + dur + 0.02);
  }

  var beepUntil = 0;

  function pulseTone() {
    var ro = lastRo;
    if (!ro) return;
    if (ro.spo2 === null || !ro.perfusing) { tone(520, 0.05, 0.05, 'square'); return; }
    var f = 500 + (ro.spo2 - 70) * 13;          /* Tonhöhe sinkt mit der Sättigung */
    tone(Math.max(420, Math.min(960, f)), 0.07, 0.07);
  }

  /* ---------- Zahlenwerte ---------- */

  var lastRo = null, lastNumUpd = 0;

  function txt(id, v) { var e = document.getElementById(id); if (e && e.textContent !== v) e.textContent = v; }

  function updateNumbers() {
    var ro = eng.readout(); lastRo = ro;
    var s = eng.state, L = s.limits;

    /* Druck gewandert? Dann den Massstab nachziehen, auch mitten in einem
       langsamen Uebergang. */
    if (artScale() !== artMax) {
      if (frozen) pendingRebuild = true; else { buildLanes(); clearAll(); }
    }

    txt('v-hr', ro.hr === null ? '- - -' : String(ro.hr));
    txt('s-hr', (s.show && s.show.rhythmName) ? ro.rhythmLabel : '');
    txt('l-hr', L.hr[0] + ' – ' + L.hr[1]);

    txt('v-spo2', ro.spo2 === null ? '- - -' : String(ro.spo2));
    txt('l-spo2', L.spo2[0] + ' – ' + L.spo2[1]);

    /* Hausüblich: Mitteldruck in Klammern direkt neben Systole/Diastole. */
    txt('v-art', ro.artSys === null ? '--/-- (--)'
                                    : ro.artSys + '/' + ro.artDia + ' (' + ro.artMap + ')');
    txt('l-art', L.sys[0] + ' – ' + L.sys[1]);
    txt('s-art', ro.ppv !== null ? 'invasiv · PPV ' + ro.ppv + ' %'
               : (ro.ppvNote ? 'invasiv · PPV ' + ro.ppvNote : 'invasiv'));

    /* Rhythmusmeldung wie beim IntelliVue: grün, klein, rechts über dem EKG. */
    var rsBox = document.getElementById('rhystat');
    if (s.show && s.show.rhythmStatus === false) rsBox.style.display = 'none';
    else {
      rsBox.style.display = '';
      txt('rs-rhythm', ro.rhythmStatus || '');
      txt('rs-ect', ro.ectopic || '');
    }

    /* Temperatur gruen, Grenzen wie bei den anderen Kacheln. */
    txt('v-temp', (ro.temp === null || ro.temp === undefined) ? '- -'
                : ro.temp.toFixed(1).replace('.', ','));
    if (L.temp) txt('l-temp', L.temp[0].toFixed(1).replace('.', ',') + ' – ' +
                              L.temp[1].toFixed(1).replace('.', ','));

    txt('v-cvp', String(ro.cvp));
    txt('l-cvp', L.cvp[0] + ' – ' + L.cvp[1]);
    txt('v-af', String(ro.af));

    /* Alarme */
    var al = eng.alarms(ro);
    var bar = document.getElementById('alarmbar');
    if (!(s.show && s.show.alarmText)) {
      bar.style.display = 'none';
    } else {
      bar.style.display = '';
      if (!al.length) bar.innerHTML = '<span style="opacity:.45">keine Alarme</span>';
      else bar.innerHTML = al.slice(0, 4).map(function (a) {
        return '<span class="a p' + a.p + '">' + a.text + '</span>';
      }).join('');
    }

    var crit = {};
    al.forEach(function (a) {
      if (/HF/.test(a.text)) crit['t-hr'] = 1;
      if (/SpO/.test(a.text)) crit['t-spo2'] = 1;
      if (/ABP|MAD/.test(a.text)) crit['t-art'] = 1;
      if (/ZVD/.test(a.text)) crit['t-cvp'] = 1;
      if (/TEMP/.test(a.text)) crit['t-temp'] = 1;
      if (a.p === 3) crit['t-hr'] = 1;
    });
    ['t-hr', 't-spo2', 't-art', 't-cvp', 't-temp'].forEach(function (id) {
      document.getElementById(id).classList.toggle('alarm', !!crit[id]);
    });

    /* Auch ohne postMessage-Gegenstelle senden: ueber einen Webserver sind
       Steuerung und Monitor zwei eigene Tabs, die nur den BroadcastChannel
       teilen. Sonst blieben dort die Istwerte leer. */
    post({ type: 'readout', ro: { hr: ro.hr, spo2: ro.spo2, artSys: ro.artSys, artDia: ro.artDia,
      artMap: ro.artMap, cvp: ro.cvp, af: ro.af, perfusing: ro.perfusing,
      ppv: ro.ppv, ppvNote: ro.ppvNote, rhythmStatus: ro.rhythmStatus, ectopic: ro.ectopic,
      temp: ro.temp } });

    renderMeds();

    var p = s.patient || {};
    txt('pat', (p.name || '–'));
    txt('meta', [p.alter, p.geschlecht, p.bett].filter(Boolean).join('  ·  '));
  }

  /* ---------- Medikation ---------- */

  /* Gegebene Medikamente als Spritzenaufkleber in der Kennfarbe nach
     ISO 26825 / DIVI, dazu Uhrzeit und verstrichene Zeit. Das zuletzt
     gegebene Etikett blinkt eine Weile, damit die Gabe auffaellt. */
  var medKey = '';

  function mmss(ms) {
    var s2 = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s2 / 60) + ':' + ('0' + (s2 % 60)).slice(-2);
  }

  function renderMeds() {
    var bar = document.getElementById('medbar');
    var box = document.getElementById('medItems');
    if (!bar || !box) return;
    var list = eng.state.meds || [];
    var key = list.map(function (g) { return g.id + '@' + g.at; }).join('|');
    if (key !== medKey) {
      medKey = key;
      bar.style.display = list.length ? '' : 'none';
      box.innerHTML = list.map(function (g, i) {
        var h = Engine.entryHtml(g);
        if (!h) return '';
        return '<span class="medgiv' + (i === list.length - 1 ? ' fresh' : '') + '">' + h +
               '<span class="mt"><b>' + new Date(g.at).toLocaleTimeString('de-DE').slice(0, 5) +
               '</b><i data-el="' + g.at + '">+0:00</i></span></span>';
      }).join('');
      box.scrollLeft = box.scrollWidth;
    }
    Array.prototype.forEach.call(box.querySelectorAll('[data-el]'), function (e) {
      e.textContent = '+' + mmss(Date.now() - parseInt(e.getAttribute('data-el'), 10));
    });
  }

  /* ---------- Schleife ---------- */

  var last = performance.now(), clockT = 0;

  function frame(now) {
    var dt = (now - last) / 1000; last = now;
    if (dt > 0.3) dt = 0.3;
    if (frozen) { requestAnimationFrame(frame); return; }

    var t0 = eng.t;
    eng.update(dt);
    var t1 = eng.t;

    var px = W / Math.max(2, eng.state.sweep);
    var remaining = px * dt;
    var tc = t0;
    var guard = 0;
    while (remaining > 0.001 && guard++ < 10) {
      var avail = W - x;
      var step = Math.min(remaining, avail);
      var tStep = tc + step / px;
      /* Geloescht wird der ganze Abschnitt, der gleich neu gezeichnet wird,
         plus der uebliche Vorlauf. Auf langsamen Rechnern rueckt die Kurve
         pro Bild weiter als der Vorlauf breit ist – dann blieben sonst
         Reste des vorigen Durchlaufs stehen und die Kurve sieht zerrissen
         aus. */
      var eraseW = Math.min(step + GAP, W - x);
      ctx.fillStyle = '#000';
      ctx.fillRect(x, 0, eraseW, H);
      separators(x, eraseW);
      drawSpan(x, x + step, tc, tStep);
      x += step; tc = tStep; remaining -= step;
      if (x >= W - 0.01) {
        x = 0;
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, GAP, H); separators(0, GAP);
        lanes.forEach(function (l) { l.lastX = 0; });
      }
    }

    /* Pulston bei jedem Kammerkomplex */
    for (var i = 0; i < eng.vent.length; i++) {
      var e = eng.vent[i];
      if (e.t <= eng.t && e.t > beepUntil) { beepUntil = e.t; pulseTone(); }
    }

    if (now - lastNumUpd > 260) { lastNumUpd = now; updateNumbers(); }
    if (now - clockT > 1000) {
      clockT = now;
      document.getElementById('clock').textContent = new Date().toLocaleTimeString('de-DE');
    }
    requestAnimationFrame(frame);
  }

  /* ---------- Verbindung ---------- */

  var peer = null, bc = null;
  /* Handy-Fassung: Die Steuerung steckt als Rahmen in dieser Seite und meldet
     sich per postMessage. Kein BroadcastChannel – sonst steuerten sich zwei
     offene Tabs gegenseitig. */
  if (!MOBILE) try { bc = new BroadcastChannel('fiticu-monitor'); } catch (e) { bc = null; }

  function post(msg) {
    try { if (peer) peer.postMessage(msg, '*'); } catch (e) {}
    try { if (bc) bc.postMessage(msg); } catch (e) {}
  }

  function handle(msg, src) {
    if (!msg || !msg.type) return;
    if (src) peer = src;
    if (msg.type === 'state') {
      var prevSweep = eng.state.sweep, prevShow = JSON.stringify(eng.state.show);
      eng.apply(msg.state, msg.ramp);
      if (!connected) { connected = true; document.getElementById('noconn').style.display = 'none'; }
      var rebuild = JSON.stringify(eng.state.show) !== prevShow || artScale() !== artMax;
      if (eng.state.sweep !== prevSweep) {
        document.getElementById('skSweepVal').textContent = eng.state.sweep + ' s';
        rebuild = true;
      }
      /* Im Standbild bleibt das Bild stehen; nachgezogen wird beim Fortsetzen. */
      if (rebuild) {
        if (frozen) pendingRebuild = true;
        else { buildLanes(); clearAll(); }
      }
    } else if (msg.type === 'cmd') {
      if (msg.cmd === 'freeze') setFreeze(!frozen);
      if (msg.cmd === 'adeno') eng.adenosine();
      if (msg.cmd === 'defib') eng.defib(msg.arg);
      if (msg.cmd === 'cardio') eng.cardiovert(msg.arg);
      if (msg.cmd === 'devDefi') Devices.show('defi');
      if (msg.cmd === 'devPacer') Devices.show('pacer');
      if (msg.cmd === 'devClose') Devices.hide();
      if (msg.cmd === 'ecg12') EKG12.show(msg.arg);
      if (msg.cmd === 'ecg12close') EKG12.hide();
      if (msg.cmd === 'ecg12ov') EKG12.setOverlay(msg.arg);
      if (msg.cmd === 'ecg12nm') EKG12.setName(msg.arg);
      if (msg.cmd === 'ecg12kr') EKG12.setKrit(msg.arg);
      if (msg.cmd === 'clear') clearAll();
    } else if (msg.type === 'bga') {
      BGA.show(msg.data);
    } else if (msg.type === 'ping') {
      post({ type: 'pong' });
    }
  }

  window.addEventListener('message', function (e) { handle(e.data, e.source); });
  if (bc) bc.onmessage = function (e) { handle(e.data, null); };
  if (window.opener) { peer = window.opener; post({ type: 'hello' }); }
  post({ type: 'hello' });
  post({ type: 'freeze', on: frozen });

  /* ---------- Bedienelemente ---------- */

  var SWEEPS = [4, 6, 10];

  document.getElementById('skSound').onclick = function () {
    initAudio();
    if (actx && actx.state === 'suspended') actx.resume();
    soundOn = !soundOn;
    document.getElementById('skSoundVal').textContent = soundOn ? 'an' : 'aus';
    this.classList.toggle('on', soundOn);
  };
  document.getElementById('skFs').onclick = function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen();
  };
  document.getElementById('skBga').onclick = function () {
    var d = BGA.generate(eng.state, eng.readout());
    BGA.show(d);
    post({ type: 'bga', data: d });
  };
  document.getElementById('skFreeze').onclick = function () { setFreeze(!frozen); };
  document.getElementById('skSweep').onclick = function () {
    var i = SWEEPS.indexOf(eng.state.sweep);
    eng.state.sweep = SWEEPS[(i + 1) % SWEEPS.length];
    document.getElementById('skSweepVal').textContent = eng.state.sweep + ' s';
    clearAll();
  };

  /* Spritzensymbol vor der Medikationszeile */
  (function () {
    var i = document.getElementById('mbIcon');
    if (i) i.innerHTML = Engine.SYRINGE + '<span>Therapie</span>';
  })();

  /* Geraetefronten. Bedient wird hier, entschieden wird in der Steuerung:
     Jede Eingabe geht hinauf und kommt als Zustand zurueck. */
  Devices.init({
    engine: eng,
    patch: function (p) { post({ type: 'patch', patch: p }); },
    command: function (c) { post({ type: 'devcmd', cmd: c }); }
  });
  document.getElementById('skDefi').onclick = function () {
    post({ type: 'devcmd', cmd: 'dev:defi' });
  };
  document.getElementById('skPacer').onclick = function () {
    post({ type: 'devcmd', cmd: 'dev:pacer' });
  };
  /* 12-Kanal-EKG: geschrieben wird in der Steuerung, hier wird nur gebeten. */
  EKG12.init({ command: function (c) { post({ type: 'devcmd', cmd: c }); } });
  document.getElementById('skEkg').onclick = function () {
    post({ type: 'devcmd', cmd: 'dev:ecg12' });
  };

  BGA.wire();
  /* Die Kurvenflaeche aendert ihre Groesse auch ohne das Fenster – etwa wenn
     die Therapiezeile erscheint. Ohne Nachziehen wuerde das Bild gestaucht,
     und Zeiger und Strich laegen beim Malen nicht mehr uebereinander. Im
     Standbild wird erst beim Beenden nachgezogen, damit das Bild stehen bleibt. */
  function onResize() {
    if (wrap.clientWidth === W && wrap.clientHeight === H &&
        pixelRatio() === dpr) return;
    if (frozen) return;            /* wird beim Beenden des Standbilds nachgezogen */
    resize();
  }
  window.addEventListener('resize', onResize);
  if (window.ResizeObserver) new ResizeObserver(onResize).observe(wrap);

  resize();
  requestAnimationFrame(frame);
})();
