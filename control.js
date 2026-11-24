/* control.js – Instruktorensteuerung: setzt den Zustand und schickt ihn ans Monitorfenster */
(function () {
  'use strict';

  var state = JSON.parse(JSON.stringify(Engine.defaults));
  var prev = new Engine();                 /* nur für die Vorschaukurve */
  var monitorWin = null, bc = null, linked = false;

  /* Handy-Fassung (mobil.html): Die Steuerung steckt als Rahmen in der
     Monitorseite und spricht nur mit ihr – kein BroadcastChannel, sonst
     steuerte ein zweiter offener Tab denselben Monitor mit. */
  var EMBED = /[?&]embed=1\b/.test(location.search) && window.parent !== window;
  if (EMBED) {
    monitorWin = window.parent;
    document.documentElement.classList.add('embed');
  } else {
    try { bc = new BroadcastChannel('fiticu-monitor'); } catch (e) { bc = null; }
  }

  /* ---------- Versand ---------- */

  /* Nicht über requestAnimationFrame drosseln: ein verdecktes Steuerfenster
     würde sonst keine Änderungen mehr ausliefern. */
  /* `ramp` = { dur, keys }: nur diese Werte laufen ueber ihre eigene Zeit
     ins Ziel. Damit flutet ein Medikament an, ohne die eingestellte
     Uebergangszeit zu veraendern. */
  function send(ramp) {
    var msg = { type: 'state', state: state };
    if (ramp) msg.ramp = ramp;
    try { if (monitorWin && !monitorWin.closed) monitorWin.postMessage(msg, '*'); } catch (e) {}
    try { if (bc) bc.postMessage(msg); } catch (e) {}
    prev.apply(JSON.parse(JSON.stringify(state)), ramp);
  }
  function cmd(c, arg) {
    var msg = { type: 'cmd', cmd: c, arg: arg };
    try { if (monitorWin && !monitorWin.closed) monitorWin.postMessage(msg, '*'); } catch (e) {}
    try { if (bc) bc.postMessage(msg); } catch (e) {}
    if (c === 'adeno') prev.adenosine();
    if (c === 'defib') prev.defib(arg);
    if (c === 'cardio') prev.cardiovert(arg);
  }

  function setLinked(v) {
    linked = v;
    var el = document.getElementById('link');
    el.textContent = v ? 'verbunden' : 'nicht verbunden';
    el.className = v ? 'ok' : '';
  }

  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || !m.type) return;
    if (m.type === 'hello') { monitorWin = e.source || monitorWin; setLinked(true); send(); }
    if (m.type === 'readout') { setLinked(true); showLive(m.ro); }
    if (m.type === 'bga') { BGA.show(m.data); log('BGA am Monitor abgenommen'); }
    if (m.type === 'freeze') syncFreeze(m.on);
    if (m.type === 'patch') devPatch(m.patch);
    if (m.type === 'devcmd') devCommand(m.cmd);
    if (m.type === 'event') log(m.text);
  });
  if (bc) bc.onmessage = function (e) {
    var m = e.data;
    if (!m || !m.type) return;
    if (m.type === 'hello') { setLinked(true); send(); }
    if (m.type === 'readout') { setLinked(true); showLive(m.ro); }
    if (m.type === 'bga') { BGA.show(m.data); log('BGA am Monitor abgenommen'); }
    if (m.type === 'freeze') syncFreeze(m.on);
    if (m.type === 'patch') devPatch(m.patch);
    if (m.type === 'devcmd') devCommand(m.cmd);
    if (m.type === 'event') log(m.text);
  };

  var lastRo = null;

  function showLive(ro) {
    lastRo = ro;
    function t(id, v) { document.getElementById(id).textContent = v; }
    t('lv-hr', ro.hr === null ? '- -' : ro.hr);
    t('lv-spo2', ro.spo2 === null ? '- -' : ro.spo2);
    t('lv-art', ro.artSys === null ? '- -' : ro.artSys + '/' + ro.artDia + ' (' + ro.artMap + ')');
    t('lv-af', ro.af);
    t('lv-cvp', ro.cvp);
    t('lv-temp', (ro.temp === null || ro.temp === undefined) ? '- -'
               : ro.temp.toFixed(1).replace('.', ','));
    /* Was der Monitor gerade oben rechts am EKG anzeigt. */
    var st = [ro.rhythmStatus, ro.ectopic].filter(Boolean).join('  ·  ');
    if (ro.ppv !== null && ro.ppv !== undefined) st += '  ·  PPV ' + ro.ppv + ' %';
    else if (ro.ppvNote) st += '  ·  PPV ' + ro.ppvNote;
    t('lvstat', st || '–');
  }

  /* ---------- Protokoll ---------- */

  function log(txt) {
    var box = document.getElementById('log');
    var d = document.createElement('div');
    d.innerHTML = '<b>' + new Date().toLocaleTimeString('de-DE') + '</b> &nbsp;' + txt;
    box.insertBefore(d, box.firstChild);
    while (box.children.length > 120) box.removeChild(box.lastChild);
  }

  /* ---------- Rhythmen ---------- */

  var rhythmBtns = {};
  (function buildRhythms() {
    var box = document.getElementById('rhythmBox');
    Engine.RHYTHMS.forEach(function (g) {
      var h = document.createElement('div');
      h.style.cssText = 'font-size:11px;color:var(--dim);margin:10px 0 5px;letter-spacing:.08em;text-transform:uppercase';
      h.textContent = g.group;
      box.appendChild(h);
      var row = document.createElement('div'); row.className = 'btnrow';
      g.items.forEach(function (it) {
        var b = document.createElement('button');
        b.className = 'b' + (g.group === 'Reanimation' ? ' crit' : '');
        b.textContent = it[1];
        b.onclick = function () { setRhythm(it[0], it[2]); };
        rhythmBtns[it[0]] = b;
        row.appendChild(b);
      });
      box.appendChild(row);
    });
  })();

  /* Hebt den Rhythmus in der zugeklappten Liste hervor und schreibt ihn in die
     Ueberschrift, damit er auch im zugeklappten Zustand ablesbar bleibt. */
  function markRhythm(id) {
    Object.keys(rhythmBtns).forEach(function (k) {
      rhythmBtns[k].classList.toggle('active', k === id);
    });
    var now = document.getElementById('rhythmNow');
    if (now) now.textContent = Engine.rhythmLabel(id);
  }

  function setRhythm(id, defHr) {
    cancelConv();
    state.rhythm = id;
    if (defHr) { state.hr = defHr; syncSlider('hr'); }
    markRhythm(id);
    log('Rhythmus: <b>' + Engine.rhythmLabel(id) + '</b>' + (defHr ? ' (HF ' + defHr + ')' : ''));
    send();
  }

  /* ---------- Artefakte ---------- */

  var artBtns = {};
  (function () {
    var row = document.getElementById('artRow');
    Engine.ARTEFAKTE.forEach(function (a) {
      var b = document.createElement('button');
      b.className = 'b'; b.textContent = a[1];
      b.onclick = function () {
        stopCycle();
        setArtefakt(a[0]);
        log('Artefakt: ' + a[1]); send();
      };
      artBtns[a[0]] = b; row.appendChild(b);
    });
    artBtns.keine.classList.add('active');
  })();

  function setArtefakt(id) {
    state.artefakt = id;
    Object.keys(artBtns).forEach(function (k) { artBtns[k].classList.toggle('active', k === id); });
  }

  /* ---------- Übergangszeit ---------- */

  (function () {
    var row = document.getElementById('transRow');
    [[0, 'sofort'], [5, '5 s'], [15, '15 s'], [30, '30 s'], [60, '60 s'], [180, '3 min']].forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'b'; b.textContent = o[1];
      b.style.padding = '5px 9px'; b.style.fontSize = '12px';
      b.onclick = function () {
        state.transition = o[0];
        Array.prototype.forEach.call(row.children, function (c) { c.classList.remove('active'); });
        b.classList.add('active'); send();
      };
      if (o[0] === 0) b.classList.add('active');
      row.appendChild(b);
    });
  })();

  /* ---------- Parameter-Regler ---------- */

  var SLIDERS = [
    ['hr',   'Herzfrequenz',      '/min',  20, 220, 1],
    ['spo2', 'SpO₂',              '%',     50, 100, 1],
    ['sys',  'Blutdruck systolisch', 'mmHg', 40, 230, 1],
    ['dia',  'Blutdruck diastolisch', 'mmHg', 20, 140, 1],
    ['cvp',  'ZVD',               'mmHg',  -2,  30, 1],
    ['af',   'Atemfrequenz',      '/min',   4,  45, 1],
    ['vaso', 'Vasodilatation',    '%',      0, 100, 5],
    ['ppv',  'Pulsdruckvariation', '%',      0,  40, 1],
    ['st',   'ST-Strecke',        'mm',    -6,   8, 0.5],
    ['qrs',  'QRS-Breite',        'ms',    70, 200, 5],
    ['pamp', 'P-Welle',           '%',      0, 150, 5],
    ['qtf',  'QT-Zeit',           '%',     70, 200, 5],
    ['uw',   'U-Welle',           '%',      0, 100, 5],
    ['jw',   'J-Welle (Osborn)',  '%',      0, 100, 5],
    ['pq',   'PQ-Verlängerung',   'ms',     0, 200, 10]
  ];
  var sliderEls = {};

  (function () {
    var box = document.getElementById('sliders');
    SLIDERS.forEach(function (s) {
      var key = s[0];
      var d = document.createElement('div');
      d.className = 'slider ' + key;
      d.innerHTML =
        '<div class="top"><span class="name">' + s[1] + '</span>' +
        '<span class="v num"><span id="sv-' + key + '">0</span> <span class="u">' + s[2] + '</span></span></div>' +
        '<div class="ctl"><button data-d="-1">−</button>' +
        '<input type="range" min="' + s[3] + '" max="' + s[4] + '" step="' + s[5] + '">' +
        '<button data-d="1">+</button></div>';
      box.appendChild(d);
      var inp = d.querySelector('input');
      sliderEls[key] = { input: inp, val: d.querySelector('#sv-' + key) };
      inp.addEventListener('input', function () { setParam(key, parseFloat(inp.value), false); });
      inp.addEventListener('change', function () { logParam(key); });
      Array.prototype.forEach.call(d.querySelectorAll('button'), function (b) {
        b.onclick = function () {
          setParam(key, clampP(key, state[key] + parseInt(b.dataset.d, 10) * (key === 'cvp' ? 1 : 1)), true);
        };
      });
    });
  })();

  function clampP(key, v) {
    var s = SLIDERS.filter(function (x) { return x[0] === key; })[0];
    return Math.max(s[3], Math.min(s[4], v));
  }
  function setParam(key, v, doLog) {
    state[key] = v;
    if (key === 'sys' && state.dia > v - 10) { state.dia = v - 10; syncSlider('dia'); }
    if (key === 'dia' && v > state.sys - 10) { state.sys = v + 10; syncSlider('sys'); }
    syncSlider(key);
    if (doLog) logParam(key);
    send();
  }
  function logParam(key) {
    var s = SLIDERS.filter(function (x) { return x[0] === key; })[0];
    log(s[1] + ': <b>' + state[key] + ' ' + s[2] + '</b>');
  }
  function syncSlider(key) {
    var e = sliderEls[key]; if (!e) return;
    e.input.value = state[key];
    e.val.textContent = Math.round(state[key]);
  }

  /* ---------- Laborwerte und BGA ---------- */

  var LAB = [
    ['fio2', 'FiO₂',        '%',     21, 100, 1],
    ['hb',   'Hämoglobin',  'g/dL',   4,  19, 0.1],
    ['lac',  'Laktat',      'mmol/L', 0.4, 20, 0.1],
    ['k',    'Kalium',      'mmol/L', 2.2, 8, 0.1],
    ['glu',  'Glukose',     'mg/dL',  40, 420, 1],
    ['temp', 'Temperatur',  '°C',     25, 43, 0.1],
    ['beOffset', 'BE-Korrektur (ohne Laktat)', 'mmol/L', -20, 10, 0.5]
  ];
  var labEls = {};

  (function () {
    var box = document.getElementById('labSliders');
    LAB.forEach(function (c) {
      var key = c[0];
      var d = document.createElement('div');
      d.className = 'slider lab-' + key;
      d.innerHTML =
        '<div class="top"><span class="name">' + c[1] + '</span>' +
        '<span class="v num"><span id="lb-' + key + '">0</span> <span class="u">' + c[2] + '</span></span></div>' +
        '<div class="ctl"><button data-d="-1">−</button>' +
        '<input type="range" min="' + c[3] + '" max="' + c[4] + '" step="' + c[5] + '">' +
        '<button data-d="1">+</button></div>';
      box.appendChild(d);
      var inp = d.querySelector('input');
      labEls[key] = { input: inp, val: d.querySelector('#lb-' + key), box: d, step: c[5] };
      inp.addEventListener('input', function () { setLab(key, parseFloat(inp.value)); });
      inp.addEventListener('change', function () { log(c[1] + ': <b>' + fmt(state.lab[key], c[5]) + ' ' + c[2] + '</b>'); });
      Array.prototype.forEach.call(d.querySelectorAll('button'), function (b) {
        b.onclick = function () {
          var v = state.lab[key] + parseInt(b.dataset.d, 10) * c[5];
          setLab(key, Math.max(c[3], Math.min(c[4], Math.round(v / c[5]) * c[5])));
          log(c[1] + ': <b>' + fmt(state.lab[key], c[5]) + ' ' + c[2] + '</b>');
        };
      });
    });
  })();

  function fmt(v, step) { return step < 1 ? v.toFixed(1).replace('.', ',') : String(Math.round(v)); }

  /* Die Kaliumstufen nennen die QRS-Breite fuer ein Herz ohne Block (90 ms
     normal). Liegt ein Schenkelblock vor, verbreitert sich dessen Komplex
     im selben Verhaeltnis. */
  function kQrs(ms) {
    return Math.min(200, Math.round(ms / 90 * Engine.blockDur(state.block || 'none') / 5) * 5);
  }

  /* Stufe des Serumkaliums - dieselben Grenzen wie Engine.kaliumEkg. */
  function kStage(k) {
    return k < 3.0 ? 0 : (k < 3.5 ? 1 : (k < 5.3 ? 2 : (k < 6.5 ? 3 : (k < 7.5 ? 4 : 5))));
  }
  /* Wechselt das Kalium am Regler in eine andere Stufe, zieht die EKG-Form
     mit. Innerhalb einer Stufe bleibt sie stehen, damit eine von Hand
     gesetzte Form nicht bei jedem Zehntel ueberschrieben wird. Die
     ST-Strecke gehoert nur zur Hypokaliaemie und wird sonst nicht angefasst. */
  function kaliumForm(alt, neu) {
    var a = kStage(alt), b = kStage(neu);
    if (a === b) return;
    var kf = Engine.kaliumEkg(neu);
    kf.qrs = kQrs(kf.qrs);
    state.tw = kf.tw; syncTw();
    ['uw', 'pamp', 'qrs'].forEach(function (key) { state[key] = kf[key]; syncSlider(key); });
    if (a < 2 || b < 2) { state.st = kf.st; syncSlider('st'); }
    kBeforeTw = null;
    log('&nbsp;&nbsp;↳ EKG-Form folgt dem Kalium (' + fmt(neu, 0.1) + ' mmol/l)');
  }

  /* Dasselbe fuer die Temperatur: Die J-Welle (Osborn) folgt der Stufe.
     Wird der Patient im Unterricht wiedererwaermt, verschwindet sie. */
  function tempForm(alt, neu) {
    if (Engine.tempStage(alt) === Engine.tempStage(neu)) return;
    state.jw = Engine.tempEkg(neu).jw;
    syncSlider('jw');
    log('&nbsp;&nbsp;↳ J-Welle folgt der Temperatur (' + fmt(neu, 0.1) + ' °C)');
  }

  function setLab(key, v) {
    if (key === 'k') kaliumForm(state.lab.k, v);
    if (key === 'temp') tempForm(state.lab.temp, v);
    state.lab[key] = v;
    if (key === 'lac') state.lab.lacAuto = false, syncLacAuto();
    syncLab(key); send();
  }
  function syncLab(key) {
    var e = labEls[key]; if (!e) return;
    e.input.value = state.lab[key];
    e.val.textContent = fmt(state.lab[key], e.step);
  }
  function syncLacAuto() {
    var b = document.getElementById('btnLacAuto');
    b.classList.toggle('active', !!state.lab.lacAuto);
    labEls.lac.box.style.opacity = state.lab.lacAuto ? 0.45 : 1;
  }

  document.getElementById('btnLacAuto').onclick = function () {
    state.lab.lacAuto = !state.lab.lacAuto;
    syncLacAuto();
    log('Laktat: ' + (state.lab.lacAuto ? 'automatisch aus Perfusion' : 'manuell'));
    send();
  };
  document.getElementById('probentyp').onchange = function () {
    state.lab.probe = this.value; send();
  };

  function takeBga() {
    var d = BGA.generate(state, lastRo);
    BGA.show(d);
    var msg = { type: 'bga', data: d };
    try { if (monitorWin && !monitorWin.closed) monitorWin.postMessage(msg, '*'); } catch (e) {}
    try { if (bc) bc.postMessage(msg); } catch (e) {}
    log('BGA abgenommen – pH ' + d.ph.toFixed(2).replace('.', ',') +
        ', pCO₂ ' + d.pco2.toFixed(0) + ', pO₂ ' + d.po2.toFixed(0) +
        ', Laktat ' + d.lac.toFixed(1).replace('.', ','));
  }
  document.getElementById('btnBga').onclick = takeBga;

  /* ---------- Szenarien ---------- */

  /* Szenarien. Zuerst die klinischen Bilder, danach ein Szenario je Rhythmus –
     jeweils mit der Hämodynamik, die dazu gehört, damit Druckkurve und
     Rhythmus nicht auseinanderlaufen. Nicht genannte Laborwerte fallen auf
     den Normalbefund zurück, Laktat rechnet sich bei lacAuto aus MAD und
     Sättigung. */
  var PRESET_GROUPS = [
    { group: 'Klinische Bilder', items: [
      ['Normalbefund',            { rhythm: 'sinus', hr: 72, spo2: 98, sys: 122, dia: 72, cvp: 6, af: 14,
                                    lab: { temp: 36.8 } }],
      ['Anaphylaxie',             { rhythm: 'sinustachy', hr: 132, spo2: 88, sys: 72, dia: 38, cvp: 2, af: 30, vaso: 100, ppv: 14,
                                    lab: { fio2: 60, hb: 13.0, k: 4.0, na: 139, cl: 104, glu: 148, temp: 36.6, lac: 3.6, lacAuto: false, beOffset: -2 } }],
      ['Septischer Schock',       { rhythm: 'sinustachy', hr: 124, spo2: 92, sys: 82, dia: 44, cvp: 3, af: 28, vaso: 100, ppv: 15,
                                    lab: { fio2: 40, hb: 9.4, k: 4.5, na: 138, cl: 109, glu: 165, temp: 38.9, lac: 5.2, lacAuto: false, beOffset: -3 } }],
      ['Hypovolämischer Schock',  { rhythm: 'sinustachy', hr: 136, spo2: 94, sys: 76, dia: 54, cvp: 0, af: 26, ppv: 21,
                                    lab: { fio2: 35, hb: 7.1, k: 4.3, na: 142, cl: 108, glu: 132, temp: 35.6, lac: 4.8, lacAuto: false, beOffset: -2 } }],
      ['Hypervolämie',            { rhythm: 'sinus', hr: 94, spo2: 90, sys: 146, dia: 84, cvp: 19, af: 24, ppv: 2,
                                    lab: { fio2: 40, hb: 9.6, k: 4.2, na: 134, cl: 108, glu: 118, temp: 36.8, lac: 1.4, lacAuto: false, beOffset: -2 } }],
      ['Kardiogener Schock',      { rhythm: 'sinustachy', hr: 112, spo2: 89, sys: 80, dia: 56, cvp: 18, af: 26, ppv: 7,
                                    lab: { fio2: 50, hb: 11.6, k: 4.7, na: 136, cl: 100, glu: 158, temp: 35.9, lac: 6.5, lacAuto: false, beOffset: -2 } }],
      ['STEMI (Hinterwand)',      { rhythm: 'sinusbrady', hr: 52, spo2: 95, sys: 104, dia: 62, cvp: 8, af: 18, st: 5,
                                    lab: { fio2: 28, hb: 14.2, k: 4.0, na: 139, cl: 103, glu: 142, temp: 36.4, lac: 1.8, lacAuto: false } }],
      ['NSTEMI',                  { rhythm: 'sinustachy', hr: 104, spo2: 95, sys: 148, dia: 86, cvp: 7, af: 20, st: -3, tw: 'negativ',
                                    lab: { fio2: 28, hb: 13.1, k: 3.9, na: 140, cl: 104, glu: 160, temp: 36.9, lac: 1.9, lacAuto: false } }],
      ['Hyperkaliämie',           { rhythm: 'sinusbrady', hr: 48, spo2: 96, sys: 108, dia: 64, cvp: 8, af: 16, tw: 'hoch', pamp: 10, qrs: 150,
                                    lab: { fio2: 28, hb: 9.8, k: 7.5, na: 134, cl: 108, glu: 126, temp: 36.5, lac: 1.6, lacAuto: false, beOffset: -6 } }],
      ['Hypokaliämie',            { rhythm: 'ves', hr: 78, spo2: 96, sys: 142, dia: 84, cvp: 4, af: 15, st: -1, tw: 'flach', uw: 100,
                                    lab: { hb: 12.6, k: 2.6, na: 141, cl: 96, glu: 118, temp: 36.7, lac: 1.2, lacAuto: false, beOffset: 4 } }],
      /* Maessige Hypothermie: Sinusknoten, AV-Knoten und Kammer werden
         langsamer, am Ende des QRS sitzt die Osborn-Welle. Kein Kaeltezittern
         mehr - das hoert unterhalb von etwa 30 bis 32 Grad auf. */
      ['Hypothermie',             { rhythm: 'sinusbrady', hr: 40, spo2: 91, sys: 94, dia: 56, cvp: 7, af: 8,
                                    jw: 80, pq: 80, qrs: 110, qtf: 125,
                                    lab: { fio2: 40, hb: 15.1, k: 3.6, na: 141, cl: 105, glu: 168, temp: 29.5, lac: 2.6, lacAuto: false, beOffset: -3 } }],
      /* Maligne Hyperthermie in Narkose: Hypermetabolismus der Muskulatur.
         Tachykardie und VES, Hyperkaliaemie aus dem Muskelzerfall (hohes T,
         kleinere P-Welle - dieselbe Stufe wie in der Kaliumtabelle),
         gemischte Azidose mit Hyperkapnie trotz Beatmung (pCO2-Zuschlag in der
         BGA), steigender Sauerstoffbedarf. Die Temperatur steigt oft erst
         spaet - hier ist sie schon ueber 40 Grad. */
      ['Maligne Hyperthermie',    { rhythm: 'ves', hr: 138, spo2: 92, sys: 148, dia: 82, cvp: 9, af: 16,
                                    tw: 'hoch', pamp: 70, qrs: 100,
                                    lab: { fio2: 40, hb: 13.6, k: 5.8, na: 141, cl: 104, ca: 1.08, glu: 168, temp: 40.2,
                                           lac: 6.4, lacAuto: false, beOffset: -4, pco2Offset: 40 } }],
      ['Lungenembolie',           { rhythm: 'sinustachy', hr: 126, spo2: 84, sys: 96, dia: 60, cvp: 16, af: 30, ppv: 17,
                                    lab: { fio2: 60, hb: 13.2, k: 4.0, glu: 124, temp: 37.2, lac: 3.2, lacAuto: false, beOffset: 0 } }],
      ['Reanimation läuft',       { rhythm: 'vf_grob', artefakt: 'cpr', spo2: 70, af: 10,
                                    lab: { fio2: 100, hb: 11.0, k: 6.5, glu: 210, temp: 35.2, lac: 11.5, lacAuto: false, beOffset: -14 } }],
      ['ROSC',                    { rhythm: 'sinustachy', hr: 108, spo2: 94, sys: 112, dia: 66, cvp: 8, af: 18,
                                    lab: { fio2: 80, hb: 11.2, k: 5.0, glu: 188, temp: 35.9, lac: 8.5, lacAuto: false, beOffset: -4 } }]
    ]},
    { group: 'Sinus / Basis', items: [
      ['Sinusrhythmus',           { rhythm: 'sinus', hr: 76, spo2: 98, sys: 118, dia: 70, cvp: 6, af: 14,
                                    lab: { temp: 36.9 } }],
      ['Sinusarrhythmie',         { rhythm: 'sinusarrhythmie', hr: 70, spo2: 98, sys: 118, dia: 70, cvp: 5, af: 13,
                                    lab: { temp: 36.7 } }]
    ]},
    { group: 'Supraventrikulär – tachykard', items: [
      ['Sinustachykardie',        { rhythm: 'sinustachy', hr: 130, spo2: 95, sys: 104, dia: 62, cvp: 4, af: 22,
                                    lab: { fio2: 28, glu: 118, temp: 38.1 } }],
      ['Vorhofflimmern',          { rhythm: 'afib', hr: 128, spo2: 95, sys: 98, dia: 62, cvp: 8, af: 18,
                                    lab: { k: 3.4, hb: 12.4, temp: 37.1 } }],
      ['Vorhofflattern 2:1',      { rhythm: 'aflutter', hr: 150, spo2: 94, sys: 92, dia: 58, cvp: 7, af: 20,
                                    lab: { k: 3.6, temp: 37.0 } }],
      ['SVT',                     { rhythm: 'svt', hr: 185, spo2: 93, sys: 82, dia: 54, cvp: 9, af: 22,
                                    lab: { fio2: 28, temp: 36.9 } }],
      ['AVNRT',                   { rhythm: 'avnrt', hr: 182, spo2: 95, sys: 88, dia: 58, cvp: 9, af: 22,
                                    lab: { fio2: 28, k: 3.9, temp: 36.8 } }],
      ['AVRT (orthodrom)',        { rhythm: 'avrt', hr: 204, spo2: 93, sys: 80, dia: 52, cvp: 10, af: 24,
                                    lab: { fio2: 28, k: 3.8, temp: 36.9 } }]
    ]},
    { group: 'Supraventrikulär – Extrasystolen', items: [
      ['SVES monomorph',          { rhythm: 'sves', hr: 74, spo2: 97, sys: 122, dia: 72, cvp: 6, af: 14,
                                    lab: { k: 3.6, temp: 36.8 } }],
      ['SVES polymorph',          { rhythm: 'sves_poly', hr: 76, spo2: 96, sys: 114, dia: 68, cvp: 7, af: 16,
                                    lab: { k: 3.3, temp: 37.6 } }]
    ]},
    { group: 'Ventrikulär – tachykard, langes QT', items: [
      ['VT mit Puls',             { rhythm: 'vt_puls', hr: 170, spo2: 90, sys: 88, dia: 54, cvp: 12, af: 24,
                                    lab: { fio2: 40, k: 3.2, temp: 37.3 } }],
      ['Torsade de Pointes',      { rhythm: 'torsade', hr: 232, spo2: 84, sys: 74, dia: 42, cvp: 12, af: 26, qtf: 180,
                                    lab: { fio2: 100, k: 2.8, ca: 1.02, temp: 36.4, lac: 4.2, lacAuto: false, beOffset: -3 } }],
      ['Long-QT-Syndrom',         { rhythm: 'longqt', hr: 56, spo2: 97, sys: 112, dia: 66, cvp: 6, af: 13, qtf: 175,
                                    lab: { k: 3.0, ca: 1.02, glu: 104, temp: 36.6 } }]
    ]},
    { group: 'Ventrikulär – Extrasystolen', items: [
      ['VES monomorph',           { rhythm: 'ves', hr: 76, spo2: 97, sys: 124, dia: 74, cvp: 6, af: 14,
                                    lab: { k: 3.5, temp: 36.9 } }],
      ['VES polymorph',           { rhythm: 'ves_poly', hr: 82, spo2: 94, sys: 108, dia: 66, cvp: 8, af: 18,
                                    lab: { fio2: 35, k: 3.0, glu: 134, temp: 37.4, lac: 2.6, lacAuto: false } }],
      ['VES-Bigeminus',           { rhythm: 'bigeminus', hr: 72, spo2: 96, sys: 104, dia: 64, cvp: 7, af: 15,
                                    lab: { k: 3.3, temp: 36.9 } }],
      ['VES-Trigeminus',          { rhythm: 'trigeminus', hr: 72, spo2: 96, sys: 106, dia: 64, cvp: 7, af: 15,
                                    lab: { k: 3.2, temp: 36.9 } }],
      ['VES-Couplets',            { rhythm: 'couplet', hr: 80, spo2: 96, sys: 112, dia: 68, cvp: 6, af: 16,
                                    lab: { k: 3.4, temp: 37.0 } }]
    ]},
    { group: 'Bradykard', items: [
      ['Sinusbradykardie',        { rhythm: 'sinusbrady', hr: 42, spo2: 96, sys: 98, dia: 58, cvp: 7, af: 13,
                                    lab: { temp: 36.2 } }],
      ['Junktionaler Rhythmus',   { rhythm: 'junktional', hr: 46, spo2: 95, sys: 96, dia: 58, cvp: 8, af: 14,
                                    lab: { temp: 36.4 } }]
    ]},
    { group: 'AV-Blöcke', items: [
      ['AV-Block I°',             { rhythm: 'avb1', hr: 62, spo2: 97, sys: 118, dia: 70, cvp: 6, af: 13,
                                    lab: { temp: 36.8 } }],
      ['AV-Block II° Wenckebach', { rhythm: 'avb2a', hr: 72, spo2: 96, sys: 108, dia: 66, cvp: 6, af: 14,
                                    lab: { temp: 36.7 } }],
      ['AV-Block II° Mobitz',     { rhythm: 'avb2b', hr: 70, spo2: 95, sys: 92, dia: 56, cvp: 7, af: 15,
                                    lab: { k: 4.6, temp: 36.6 } }],
      ['AV-Block III°',           { rhythm: 'avb3', hr: 34, spo2: 93, sys: 84, dia: 50, cvp: 9, af: 16,
                                    lab: { fio2: 30, k: 6.1, glu: 142, temp: 36.3 } }]
    ]},
    /* Schenkel- und Faszikelbloecke sind keine Rhythmen, sondern eine Form des
       Kammerkomplexes. Die Szenarien setzen deshalb einen Sinusrhythmus und
       dazu den Block; am besten sieht man sie im 12-Kanal-EKG. */
    { group: 'Schenkel- und Faszikelblöcke', items: [
      ['Rechtsschenkelblock',      { rhythm: 'sinus', hr: 74, spo2: 97, sys: 128, dia: 76, cvp: 7, af: 14, block: 'rsb',
                                    lab: { temp: 36.8 } }],
      ['Inkompletter RSB',         { rhythm: 'sinus', hr: 68, spo2: 98, sys: 122, dia: 72, cvp: 6, af: 14, block: 'irsb',
                                    lab: { temp: 36.7 } }],
      ['Linksschenkelblock',       { rhythm: 'sinus', hr: 82, spo2: 96, sys: 134, dia: 80, cvp: 8, af: 16, block: 'lsb',
                                    lab: { temp: 36.9 } }],
      ['Inkompletter LSB',         { rhythm: 'sinus', hr: 76, spo2: 97, sys: 138, dia: 82, cvp: 7, af: 15, block: 'ilsb',
                                    lab: { temp: 36.8 } }],
      ['Linksanteriorer Faszikelblock', { rhythm: 'sinus', hr: 70, spo2: 97, sys: 132, dia: 78, cvp: 6, af: 14, block: 'lahb',
                                    lab: { temp: 36.7 } }],
      ['Linksposteriorer Faszikelblock', { rhythm: 'sinus', hr: 72, spo2: 97, sys: 124, dia: 74, cvp: 6, af: 14, block: 'lphb',
                                    lab: { temp: 36.8 } }],
      /* Bifaszikulaer: Rechtsschenkelblock mit einem Faszikelblock oder mit
         einer Leitungsstoerung im His-Buendel (AV-Block I. Grades). */
      ['Bifaszikulär: RSB + LAFB', { rhythm: 'sinus', hr: 66, spo2: 96, sys: 126, dia: 74, cvp: 7, af: 15, block: 'rsb_lahb',
                                    lab: { temp: 36.6 } }],
      ['Bifaszikulär: RSB + LPFB', { rhythm: 'sinus', hr: 68, spo2: 96, sys: 122, dia: 72, cvp: 7, af: 15, block: 'rsb_lphb',
                                    lab: { temp: 36.6 } }],
      ['Bifaszikulär: RSB + AV-Block I°', { rhythm: 'avb1', hr: 60, spo2: 97, sys: 124, dia: 72, cvp: 7, af: 14, block: 'rsb',
                                    lab: { temp: 36.6 } }],
      /* Inkomplett trifaszikulaer: Rechtsschenkelblock, ein Faszikelblock
         und AV-Block I. Grades. Komplett: alle drei Faszikel blockiert –
         im EKG das Bild des AV-Blocks III. Grades. */
      ['Inkompl. trifaszikulär: RSB + LAFB + AV-Block I°', { rhythm: 'avb1', hr: 56, spo2: 96, sys: 118, dia: 68, cvp: 8, af: 15, block: 'rsb_lahb',
                                    lab: { temp: 36.5 } }],
      ['Inkompl. trifaszikulär: RSB + LPFB + AV-Block I°', { rhythm: 'avb1', hr: 58, spo2: 96, sys: 116, dia: 68, cvp: 8, af: 15, block: 'rsb_lphb',
                                    lab: { temp: 36.5 } }],
      ['Kompletter trifaszikulärer Block (AV-Block III°)', { rhythm: 'avb3', hr: 34, spo2: 93, sys: 84, dia: 50, cvp: 9, af: 16,
                                    lab: { fio2: 30, temp: 36.4 } }]
    ]},
    { group: 'Schrittmacher', items: [
      ['Schrittmacher AAI',       { rhythm: 'paced_aai', hr: 70, spo2: 97, sys: 118, dia: 70, cvp: 6, af: 14,
                                    lab: { temp: 36.8 } }],
      ['Schrittmacher VVI',       { rhythm: 'paced_vvi', hr: 70, spo2: 96, sys: 104, dia: 64, cvp: 8, af: 14,
                                    lab: { temp: 36.7 } }],
      ['Schrittmacher DDD',       { rhythm: 'paced_ddd', hr: 70, spo2: 97, sys: 120, dia: 72, cvp: 6, af: 14,
                                    lab: { temp: 36.8 } }]
    ]},
    { group: 'Reanimation', items: [
      ['Kammerflimmern grob',     { rhythm: 'vf_grob', spo2: 70, sys: 20, dia: 12, cvp: 4, af: 10,
                                    lab: { fio2: 100, hb: 11.0, k: 6.4, glu: 195, temp: 35.4, lac: 9.5, lacAuto: false, beOffset: -12 } }],
      ['Kammerflimmern fein',     { rhythm: 'vf_fein', spo2: 65, sys: 18, dia: 10, cvp: 4, af: 10,
                                    lab: { fio2: 100, hb: 10.8, k: 6.8, glu: 205, temp: 35.1, lac: 12.0, lacAuto: false, beOffset: -14 } }],
      ['Pulslose VT',             { rhythm: 'vt_pulslos', hr: 190, spo2: 70, sys: 20, dia: 12, cvp: 4, af: 10,
                                    lab: { fio2: 100, hb: 11.5, k: 6.0, glu: 180, temp: 35.6, lac: 8.8, lacAuto: false, beOffset: -11 } }],
      ['Asystolie',               { rhythm: 'asystolie', spo2: 60, sys: 15, dia: 10, cvp: 4, af: 10,
                                    lab: { fio2: 100, hb: 10.8, k: 7.0, glu: 215, temp: 34.8, lac: 13.5, lacAuto: false, beOffset: -16 } }],
      ['PEA',                     { rhythm: 'pea', hr: 42, spo2: 65, sys: 18, dia: 12, cvp: 12, af: 10,
                                    lab: { fio2: 100, hb: 10.5, k: 6.6, glu: 190, temp: 35.3, lac: 11.0, lacAuto: false, beOffset: -13 } }],
      ['Idioventrikulär',         { rhythm: 'idioventrikulaer', hr: 28, spo2: 78, sys: 46, dia: 28, cvp: 14, af: 12,
                                    lab: { fio2: 100, hb: 10.6, k: 7.0, glu: 198, temp: 35.0, lac: 12.0, lacAuto: false, beOffset: -13 } }]
    ]}
  ];

  var PRESETS = [];
  PRESET_GROUPS.forEach(function (g) { PRESETS = PRESETS.concat(g.items); });

  (function () {
    var box = document.getElementById('presetRow');
    var n = 0;
    PRESET_GROUPS.forEach(function (g) {
      var h = document.createElement('div');
      h.style.cssText = 'font-size:11px;color:var(--dim);margin:10px 0 5px;letter-spacing:.08em;text-transform:uppercase';
      h.textContent = g.group;
      box.appendChild(h);
      var row = document.createElement('div'); row.className = 'btnrow';
      g.items.forEach(function (p) {
        var b = document.createElement('button');
        b.className = 'b wide';
        b.innerHTML = p[0] + (n < 9 ? ' <span style="opacity:.4;font-size:11px">' + (n + 1) + '</span>' : '');
        b.onclick = function () { applyPreset(p); };
        row.appendChild(b);
        n++;
      });
      box.appendChild(row);
    });
  })();

  function applyPreset(p) {
    var patch = p[1];
    /* Was das Szenario nicht nennt, faellt auf den Normalbefund zurueck –
       sonst schleppt man Laktat oder Thoraxkompressionen in den naechsten Fall. */
    if (patch.vaso === undefined) { state.vaso = 0; syncSlider('vaso'); }
    if (patch.ppv === undefined) { state.ppv = 0; syncSlider('ppv'); }
    /* EKG-Form ebenfalls zuruecksetzen: sonst bleibt die ST-Hebung des STEMI
       im naechsten Fall stehen. */
    [['st', 0], ['qrs', 90], ['pamp', 100], ['qtf', 100], ['uw', 0], ['jw', 0], ['pq', 0]].forEach(function (d) {
      if (patch[d[0]] === undefined) { state[d[0]] = d[1]; syncSlider(d[0]); }
    });
    if (patch.tw === undefined) state.tw = 'normal';
    state.block = patch.block || 'none';
    if (patch.qrs === undefined) { state.qrs = Engine.blockDur(state.block); syncSlider('qrs'); }
    if (patch.artefakt === undefined) {
      state.artefakt = 'keine';
      Object.keys(artBtns).forEach(function (k) { artBtns[k].classList.toggle('active', k === 'keine'); });
    }
    state.lab = JSON.parse(JSON.stringify(Engine.defaults.lab));
    /* Neues Szenario = neuer Patient: die Medikationszeile wird geleert und
       ein noch ausstehender Rhythmusumschlag verfaellt. */
    state.meds = [];
    state.defi = Object.assign({}, state.defi, { charged: false, charging: false });
    cancelConv();
    stopCycle();
    resetDecomp();
    kBeforeTw = null;
    Object.keys(patch).forEach(function (k) {
      if (k === 'lab') {
        Object.keys(patch.lab).forEach(function (lk) { state.lab[lk] = patch.lab[lk]; });
        return;
      }
      state[k] = patch[k];
      if (sliderEls[k]) syncSlider(k);
    });
    LAB.forEach(function (c) { syncLab(c[0]); });
    syncLacAuto();
    syncTw();
    syncBlock();
    renderGiven();
    if (patch.rhythm) markRhythm(patch.rhythm);
    if (patch.artefakt) Object.keys(artBtns).forEach(function (k) {
      artBtns[k].classList.toggle('active', k === patch.artefakt);
    });
    log('Szenario: <b>' + p[0] + '</b>');
    send();
  }

  /* ---------- Medikamente ---------- */

  /* Die Wirkung ist ein Zuschlag auf die eingestellten Werte und flutet ueber
     die Anschlagzeit des Medikaments an. Eine Halbwertszeit gibt es nicht:
     der Wert bleibt stehen, bis er verstellt oder ein Szenario geladen wird. */

  function sgnTxt(v) { return (v > 0 ? '+' : '\u2212') + Math.abs(v); }

  function effText(m) {
    var e = m.eff || {}, p = [];
    if (e.hr) p.push('HF ' + sgnTxt(e.hr));
    if (e.sys || e.dia) p.push('ABP ' + sgnTxt(e.sys || 0) + '/' + sgnTxt(e.dia || 0));
    if (e.cvp) p.push('ZVD ' + sgnTxt(e.cvp));
    if (e.af) p.push('AF ' + sgnTxt(e.af));
    if (e.vaso) p.push(e.vaso > 0 ? 'Gef\u00e4\u00dfe weiter' : 'Gef\u00e4\u00dfe enger');
    p.push(m.info ? m.info : 'Anschlag ' + m.onset + ' s');
    return p.join(' \u00b7 ');
  }

  /* Rhythmusumschlag nach der Gabe. Er laeuft erst nach der Anschlagzeit und
     nur, wenn der Rhythmus in der Zwischenzeit nicht von Hand gesetzt wurde –
     sonst wuerde eine alte Spritze einen laengst anderen Fall umwerfen. */
  var medConv = true, convSeq = 0;

  function cancelConv() { convSeq++; }

  function giveMed(m) {
    var keys = [];
    Object.keys(m.eff).forEach(function (k) {
      if (!sliderEls[k]) return;
      state[k] = clampP(k, state[k] + m.eff[k]);
      keys.push(k);
    });
    /* Der diastolische Druck darf den systolischen nicht einholen. */
    if (state.dia > state.sys - 10) state.dia = state.sys - 10;
    keys.forEach(syncSlider);

    /* Kalium wirkt nicht auf den Kreislauf, sondern auf den Serumwert - und
       mit dem wandert die EKG-Form. QRS-Breite, P-Hoehe und U-Welle laufen
       ueber die Anschlagzeit mit; die Form der T-Welle ist keine Zahl und
       schaltet deshalb sofort um. */
    var kNote = '';
    if (m.special === 'kalium') {
      var kNeu = Math.round(Math.max(2.2, Math.min(8, state.lab.k + (m.dk || 0.5))) * 10) / 10;
      state.lab.k = kNeu;
      syncLab('k');
      var kf = Engine.kaliumEkg(kNeu);
      kf.qrs = kQrs(kf.qrs);
      state.tw = kf.tw; syncTw();
      ['uw', 'pamp', 'qrs', 'st'].forEach(function (key) {
        state[key] = kf[key];
        syncSlider(key);
        if (keys.indexOf(key) < 0) keys.push(key);
      });
      kNote = ' &nbsp;Kalium jetzt <b>' + fmt(kNeu, 0.1) + ' mmol/l</b>, EKG-Form angepasst';
    }

    state.meds = (state.meds || []).concat([{ id: m.id, at: Date.now() }]);
    while (state.meds.length > 10) state.meds.shift();
    renderGiven();
    log('Medikament: <b>' + m.name + ' ' + m.dose + '</b> &nbsp;' + effText(m) + kNote);
    send({ dur: m.onset, keys: keys });

    /* Adenosin wirkt nur Sekunden. Es wird deshalb als Befehl ausgeloest und
       nicht im Zustand mitgefuehrt. Was es bei diesem Rhythmus macht, steht
       im Protokoll - auch dann, wenn es gar nichts macht. */
    if (m.special === 'adeno') {
      log('&nbsp;&nbsp;↳ Adenosin: ' + Engine.adenoNote(state.rhythm));
      cmd('adeno');
    }

    var c = medConv ? Engine.medConv(m, state.rhythm) : null;
    if (c) {
      var wait = c.after === undefined ? m.onset : c.after;
      var id = convSeq, from = state.rhythm, name = m.name;
      if (m.special !== 'adeno')
        log('&nbsp;&nbsp;↳ ' + name + ' kann den Rhythmus umschlagen lassen – in ' + wait + ' s');
      setTimeout(function () {
        if (id !== convSeq || state.rhythm !== from) return;
        setRhythm(c.to, c.hr);
        log('<b>' + name + ' wirkt:</b> Umschlag auf <b>' + Engine.rhythmLabel(c.to) + '</b>');
      }, wait * 1000);
    }
  }

  (function () {
    var box = document.getElementById('medBox');
    if (!box) return;
    Engine.MED_GROUPS.forEach(function (g) {
      var h = document.createElement('div');
      h.className = 'medgrp';
      h.innerHTML = g.group + ' <span>' + g.note + '</span>';
      box.appendChild(h);
      var row = document.createElement('div'); row.className = 'btnrow';
      g.items.forEach(function (m) {
        var b = document.createElement('button');
        b.className = 'b med';
        b.innerHTML = Engine.medLabelHtml(m) + '<span class="medeff">' + effText(m) + '</span>';
        b.onclick = function () { giveMed(m); };
        row.appendChild(b);
      });
      box.appendChild(row);
    });
  })();

  /* Zeile der gegebenen Medikamente – dieselbe Darstellung wie am Monitor,
     dazu Uhrzeit und die seit der Gabe verstrichene Zeit. */
  function mmss(ms) {
    var s2 = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s2 / 60) + ':' + ('0' + (s2 % 60)).slice(-2);
  }
  function renderGiven() {
    var box = document.getElementById('medGiven');
    if (!box) return;
    var list = state.meds || [];
    if (!list.length) {
      box.innerHTML = '<span class="none">noch kein Medikament gegeben</span>';
      return;
    }
    box.innerHTML = list.map(function (g) {
      var h = Engine.entryHtml(g);
      if (!h) return '';
      return '<span class="medgiv">' + h +
             '<span class="mt"><b>' + new Date(g.at).toLocaleTimeString('de-DE').slice(0, 5) +
             '</b><i data-el="' + g.at + '">+0:00</i></span></span>';
    }).join('');
  }
  setInterval(function () {
    var box = document.getElementById('medGiven');
    if (!box) return;
    Array.prototype.forEach.call(box.querySelectorAll('[data-el]'), function (e) {
      e.textContent = '+' + mmss(Date.now() - parseInt(e.getAttribute('data-el'), 10));
    });
  }, 1000);

  (function () {
    var b = document.getElementById('btnMedConv');
    if (!b) return;
    b.classList.toggle('active', medConv);
    b.onclick = function () {
      medConv = !medConv;
      b.classList.toggle('active', medConv);
      if (!medConv) cancelConv();
      log('Rhythmusumschlag durch Medikamente: ' + (medConv ? 'an' : 'aus'));
    };
  })();

  (function () {
    var b = document.getElementById('btnMedClear');
    if (!b) return;
    b.onclick = function () {
      state.meds = [];
      renderGiven();
      log('Medikationszeile geleert (eingestellte Werte bleiben)');
      send();
    };
  })();

  /* ---------- Defibrillation und Kardioversion ---------- */

  /* Betriebsart und Energie stehen im Zustand, damit die Geraetefront im
     Monitorfenster dasselbe zeigt. Das Ergebnis des Schocks bleibt hier: Es
     ist eine Entscheidung des Instruktors und keine Eigenschaft des
     Patienten. Je Betriebsart wird es getrennt gemerkt. */
  var defiOutcome = { defib: 'kein', cardio: 'kein' };

  function defiMode() { return (state.defi && state.defi.mode) || 'defib'; }

  function setDefi(p) {
    state.defi = Object.assign({}, state.defi, p);
    send();
    buildDefiRows();
  }

  function buildDefiRows() {
    var mode = defiMode();
    var erow = document.getElementById('defiEnergy');
    var orow = document.getElementById('defiOutcome');
    if (!erow || !orow) return;
    if (erow.getAttribute('data-key') !== mode) {
      erow.setAttribute('data-key', mode);
      erow.innerHTML = '';
      Engine.energies(mode).forEach(function (j) {
        var b = document.createElement('button');
        b.className = 'b';
        b.textContent = j + ' J';
        b.setAttribute('data-j', j);
        b.onclick = function () { setDefi({ energy: j, charged: false, charging: false }); };
        erow.appendChild(b);
      });
      orow.innerHTML = '';
      Engine.outcomes(mode).forEach(function (o) {
        var b = document.createElement('button');
        b.className = 'b';
        b.textContent = o.label;
        b.setAttribute('data-o', o.id);
        b.onclick = function () {
          defiOutcome[mode] = o.id;
          syncDefi();
          log((mode === 'cardio' ? 'Kardioversion' : 'Defibrillation') +
              ', eingestelltes Ergebnis: <b>' + o.label + '</b>');
        };
        orow.appendChild(b);
      });
    }
    syncDefi();
  }

  function syncDefi() {
    var mode = defiMode(), d = state.defi || {};
    Array.prototype.forEach.call(document.querySelectorAll('#defiMode button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-m') === mode);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#defiEnergy button'), function (b) {
      b.classList.toggle('active', parseInt(b.getAttribute('data-j'), 10) === d.energy);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#defiOutcome button'), function (b) {
      b.classList.toggle('active', b.getAttribute('data-o') === defiOutcome[mode]);
    });
    var sb = document.getElementById('btnShock');
    if (sb) sb.textContent = mode === 'cardio' ? 'Kardioversion auslösen' : 'Schock abgeben';
  }

  (function () {
    var row = document.getElementById('defiMode');
    if (!row) return;
    [['defib', 'Defibrillation'], ['cardio', 'Kardioversion']].forEach(function (m) {
      var b = document.createElement('button');
      b.className = 'b';
      b.setAttribute('data-m', m[0]);
      b.textContent = m[1];
      b.onclick = function () {
        /* Beim Wechsel die naechstgelegene Stufe der neuen Energiereihe. */
        var list = Engine.energies(m[0]), cur = (state.defi || {}).energy || 200, best = list[0];
        list.forEach(function (j) { if (Math.abs(j - cur) < Math.abs(best - cur)) best = j; });
        setDefi({ mode: m[0], energy: best, charged: false, charging: false });
        log('Defibrillator: <b>' + m[1] + '</b>');
      };
      row.appendChild(b);
    });
    buildDefiRows();
  })();

  /* Laden dauert, wie am Geraet. Die Steuerung haelt den Zustand, damit die
     Front in beiden Fenstern dasselbe anzeigt. */
  function charge() {
    var d = state.defi || {};
    if (d.charged || d.charging) return;
    setDefi({ charging: true });
    log('Defibrillator lädt auf <b>' + d.energy + ' J</b>');
    setTimeout(function () {
      if (!state.defi || !state.defi.charging) return;
      setDefi({ charging: false, charged: true });
      log('Defibrillator <b>geladen</b> – ' + state.defi.energy + ' J');
    }, 2500);
  }

  /* `cpr` = es wird weiter gedrueckt. Dann beendet das Ergebnis die
     Kompressionen nicht - das tut erst die Rhythmuskontrolle. Und ein Herz,
     das gerade wieder angesprungen ist, wirft nicht sofort voll aus: Der
     eigene Druck beginnt niedrig und waechst ueber 20 Sekunden durch die
     Kompressionswellen hindurch. */
  function applyDefibOutcome(o, cpr) {
    var p = o.patch;
    var rosc = cpr && p.rhythm && Engine.perfusing(p.rhythm) &&
               p.sys !== undefined && p.dia !== undefined;
    if (rosc) {
      state.rhythm = p.rhythm;
      state.sys = 60; state.dia = 36;
      send({ dur: 0, keys: ['sys', 'dia'] });
    }
    Object.keys(p).forEach(function (k) {
      if (k === 'artefakt' && cpr) return;
      state[k] = p[k];
      if (sliderEls[k]) syncSlider(k);
    });
    if (p.rhythm) markRhythm(p.rhythm);
    if (p.artefakt && !cpr) setArtefakt(p.artefakt);
    cancelConv();
    log('<b>Nach dem Schock:</b> ' + o.label +
        (p.rhythm ? ' – ' + Engine.rhythmLabel(p.rhythm) : '') +
        (cpr ? ' &nbsp;(unter den Kompressionen, sichtbar bei der Rhythmuskontrolle)' : ''));
    if (rosc) send({ dur: 20, keys: ['sys', 'dia'] }); else send();
  }

  function shock() {
    var r = state.rhythm, mode = defiMode(), sync = mode === 'cardio';
    var e = (state.defi || {}).energy || 200;
    var wort = sync ? 'Kardioversion' : 'Schock';

    /* Ohne R-Zacke gibt es nichts zu synchronisieren. Ein echtes Geraet gibt
       dann keinen Schock ab - es will defibrilliert werden. */
    if (sync && !Engine.hasR(r)) {
      log('<b>Kardioversion nicht möglich</b> – keine R-Zacke zum Synchronisieren. ' +
          'Bei Kammerflimmern wird defibrilliert.');
      return;
    }
    var passend = sync ? Engine.cardiovertible(r) : Engine.shockable(r);

    /* Wird reanimiert, laeuft der Schock so ab wie am Bett: "Alle weg!",
       die Kompressionen stoppen, der Schock faellt, danach wird sofort
       weitergedrueckt - einen ganzen Zyklus lang, ohne vorher nach dem
       Rhythmus zu sehen. */
    var cpr = state.artefakt === 'cpr';
    var pre = cpr ? Engine.HANDS_OFF_PRE : 0;
    stopCycle();

    state.meds = (state.meds || []).concat([{ id: 'defi', at: Date.now(), e: e, s: sync }]);
    while (state.meds.length > 10) state.meds.shift();
    state.defi = Object.assign({}, state.defi, { charged: false, charging: false });
    renderGiven();
    send();
    syncDefi();
    cmd(sync ? 'cardio' : 'defib', pre);

    function gegeben() {
      log('<b>' + wort + ' ' + e + ' J</b> abgegeben' +
          (passend ? '' : ' – <b>passt nicht zu diesem Rhythmus</b> (' +
                          Engine.rhythmLabel(r) + ')'));
      log('&nbsp;&nbsp;↳ ' + (sync ? 'auf die nächste R-Zacke gelegt, ' : '') +
          'EKG für ' + Engine.DEFIB_BLANK + ' s nicht auswertbar');
    }
    var seq = ++shockSeq;
    if (cpr) {
      log('<b>„Alle weg!“</b> – Thoraxkompressionen stoppen, der Druck fällt ab. Schock in ' +
          fmt(pre, 0.1) + ' s');
      setTimeout(function () { if (seq === shockSeq) gegeben(); }, pre * 1000);
      setTimeout(function () {
        if (seq !== shockSeq || state.artefakt !== 'cpr') return;
        startCycle();
      }, (pre + (sync ? 1.0 : 0) + Engine.HANDS_OFF_POST) * 1000);
    } else gegeben();

    var o = Engine.outcomes(mode).filter(function (x) { return x.id === defiOutcome[mode]; })[0];
    if (!o || !o.patch) return;
    if (!passend) {
      setTimeout(function () {
        log('&nbsp;&nbsp;↳ ohne Wirkung – ' + (sync
          ? 'kardiovertiert wird eine zu schnelle Rhythmusstörung mit Auswurf'
          : 'ein Schock hilft nur bei Kammerflimmern und pulsloser VT'));
      }, pre * 1000);
      return;
    }
    var id = convSeq, from = r;
    setTimeout(function () {
      if (id !== convSeq || state.rhythm !== from) return;
      applyDefibOutcome(o, cpr && state.artefakt === 'cpr');
    }, (pre + Engine.DEFIB_BLANK + (sync ? 1.2 : 0.3)) * 1000);
  }

  /* ---------- Zyklus nach dem Schock ---------- */

  /* Nach dem Schock wird zwei Minuten weitergedrueckt. Erst dann pausiert
     das Team fuer die Rhythmuskontrolle - auch dann, wenn der Schock gewirkt
     hat: Das Herz wirft in der ersten Minute oft noch kaum aus. */
  var shockSeq = 0, cycleEnd = 0;

  function cycleNote() {
    var box = document.getElementById('cprCycle');
    if (!box) return;
    if (!cycleEnd) { box.style.display = 'none'; return; }
    box.style.display = '';
    document.getElementById('cprCycleT').textContent = mmss(cycleEnd - Date.now());
  }
  function startCycle() {
    cycleEnd = Date.now() + Engine.CPR_CYCLE * 1000;
    log('Thoraxkompressionen laufen wieder – <b>2 Minuten</b> bis zur Rhythmuskontrolle');
    cycleNote();
  }
  function stopCycle() { cycleEnd = 0; cycleNote(); }
  function rhythmCheck(auto) {
    if (!cycleEnd) return;
    stopCycle();
    if (state.artefakt !== 'cpr') return;
    setArtefakt('keine');
    log('<b>Rhythmuskontrolle</b> – ' + (auto ? 'der Zyklus ist um, ' : '') +
        'Thoraxkompressionen pausiert. Rhythmus: ' + Engine.rhythmLabel(state.rhythm) +
        (Engine.perfusing(state.rhythm) ? ' – Puls tastbar' : ' – kein Puls, weiterdrücken'));
    send();
  }
  setInterval(function () {
    if (!cycleEnd) return;
    if (Date.now() >= cycleEnd) rhythmCheck(true); else cycleNote();
  }, 500);
  (function () {
    var b = document.getElementById('btnRhythmCheck');
    if (b) b.onclick = function () { rhythmCheck(false); };
  })();

  (function () {
    var b = document.getElementById('btnShock');
    if (b) b.onclick = shock;
  })();

  /* ---------- Geraetefronten (corpuls1, PACE 203H) ---------- */

  /* Die Fronten laufen in beiden Fenstern. Geaendert wird immer hier: Der
     Monitor schickt seine Eingaben herauf, die Steuerung setzt den Zustand
     und schickt ihn zurueck. So gibt es nur eine Wahrheit. */
  function devPatch(p) {
    Object.keys(p).forEach(function (k) {
      if (k === 'pacer' || k === 'defi') state[k] = Object.assign({}, state[k], p[k]);
      else { state[k] = p[k]; if (sliderEls[k]) syncSlider(k); }
    });
    send();
    syncDefi();
  }

  function devToggle(which) {
    if (Devices.isOpen() === which) { Devices.hide(); cmd('devClose'); }
    else { Devices.show(which); cmd(which === 'defi' ? 'devDefi' : 'devPacer'); }
  }

  function devCommand(c) {
    if (c === 'charge') { charge(); return; }
    if (c === 'shock') {
      if (!(state.defi && state.defi.charged)) {
        log('Schock nicht ausgelöst – das Gerät ist nicht geladen');
        return;
      }
      shock(); return;
    }
    if (c === 'devclose') { Devices.hide(); cmd('devClose'); return; }
    if (c === 'dev:ecg12') { ekgToggle(); return; }
    if (c === 'ecg12:close') { ekgClose(); return; }
    if (c === 'ecg12:new') { ekgWrite(); return; }
    if (c === 'ecg12:overlay') { ekgOverlay(); return; }
    if (c === 'ecg12:name') { ekgName(); return; }
    if (c === 'ecg12:krit') { ekgKrit(); return; }
    if (c === 'dev:defi') { devToggle('defi'); return; }
    if (c === 'dev:pacer') { devToggle('pacer'); return; }
    if (c === 'pacer:emergency') {
      /* Notfallstimulation: VVI, 80/min, voller Ausgang. */
      state.pacer = Object.assign({}, state.pacer, { outV: 10, outA: 10 });
      state.hr = 80; syncSlider('hr');
      setRhythm('paced_vvi', 0);
      log('<b>Notfallstimulation</b> – VVI 80/min, V-STIM 10 V');
      return;
    }
    if (c.indexOf('pacer:') === 0) {
      var m = c.slice(6), rr = Engine.pacerRhythm(m);
      if (rr) {
        if (state.hr < 30 || state.hr > 180) { state.hr = 70; syncSlider('hr'); }
        setRhythm(rr, 0);
      } else if (Engine.pacerMode(state.rhythm) !== 'aus') {
        setRhythm('asystolie', 0);
        log('Schrittmacher auf Standby – der Patient ist schrittmacherabhängig');
      }
    }
  }

  Devices.init({ engine: prev, patch: devPatch, command: devCommand });

  (function () {
    var d = document.getElementById('btnDefi'), p = document.getElementById('btnPacer');
    if (d) d.onclick = function () { devToggle('defi'); };
    if (p) p.onclick = function () { devToggle('pacer'); };
  })();

  /* ---------- Entgleisung bei kritischen Werten ---------- */

  /* Manche Werte sind mit dem Leben nicht vereinbar. Bleibt einer davon
     stehen, kippt der Zustand von selbst:
       Kalium ab 8,0 mmol/l       -> nach 20 s Kammerflimmern
       systolisch unter 50 mmHg   -> nach 15 s terminale Bradykardie,
                                     10 s spaeter Asystolie
     Beides laesst sich abwenden, solange es noch nicht eingetreten ist -
     Kalium senken, Druck heben. Beurteilt wird der Druck, der gerade
     anliegt, nicht der eingestellte Zielwert: Bei einer langen
     Uebergangszeit laeuft die Frist erst, wenn der Druck wirklich unten ist.
     Die Grenzen stehen in engine.js (K_LETHAL, SYS_LETHAL). */
  var DECOMP = { K_WAIT: 20, BP_WAIT: 15, BRADY: 10 };
  var decompOn = true, dk = null, dbp = null, prevFrameAt = 0;

  function resetDecomp() { dk = null; dbp = null; decompNote(''); }
  function decompNote(txt) {
    var el = document.getElementById('decompNote');
    if (!el) return;
    el.textContent = txt;
    el.style.display = txt ? '' : 'none';
  }
  function secs(ms) { return Math.max(0, Math.ceil(ms / 1000)) + ' s'; }

  function decompTick() {
    var now = Date.now(), perf = Engine.perfusing(state.rhythm), notes = [];
    /* Ein verdecktes Fenster zeichnet nicht - dann steht auch die Vorschau-
       Engine. Hier wird sie weitergedreht, damit der Druck trotzdem laeuft. */
    if (performance.now() - prevFrameAt > 600) prev.update(0.25);
    if (!decompOn) { if (dk || dbp) resetDecomp(); return; }

    /* Kalium */
    var k = Math.round(state.lab.k * 10) / 10;
    if (perf && k >= Engine.K_LETHAL) {
      if (!dk) {
        dk = { at: now };
        log('<b>Kalium ' + fmt(k, 0.1) + ' mmol/l</b> – lebensbedrohlich. ' +
            'Bleibt es dabei, schlägt der Rhythmus in ' + DECOMP.K_WAIT + ' s in Kammerflimmern um');
      }
      if (now - dk.at >= DECOMP.K_WAIT * 1000) {
        dk = null; dbp = null;
        setRhythm('vf_grob', 0);
        log('<b>Hyperkaliämie:</b> Kammerflimmern. Solange das Kalium bei ' + fmt(k, 0.1) +
            ' mmol/l steht, flimmert das Herz nach jedem erfolgreichen Schock erneut');
        decompNote('');
        return;
      }
      notes.push('Kalium ' + fmt(k, 0.1) + ' mmol/l – Kammerflimmern in ' +
                 secs(dk.at + DECOMP.K_WAIT * 1000 - now));
    } else dk = null;

    /* Blutdruck: gemessen wird am Ist-Wert der Vorschau-Engine. */
    var sys = Math.round(prev.state.sys);
    if (perf && sys < Engine.SYS_LETHAL) {
      if (!dbp) {
        dbp = { at: now, stage: 0, drop: 0 };
        log('<b>Systolischer Druck ' + sys + ' mmHg</b> – darunter werden Herz und Gehirn ' +
            'nicht mehr durchblutet. Bleibt es dabei, folgt in ' + DECOMP.BP_WAIT +
            ' s die terminale Bradykardie');
      }
      if (dbp.stage === 0 && now - dbp.at >= DECOMP.BP_WAIT * 1000) {
        dbp.stage = 1; dbp.at = now;
        if (state.hr > 32) { dbp.drop = state.hr - 32; state.hr = 32; syncSlider('hr'); }
        log('<b>Terminale Bradykardie</b> – die Koronarperfusion reicht nicht mehr. ' +
            'Asystolie in ' + DECOMP.BRADY + ' s, wenn der Druck nicht steigt');
        send({ dur: 6, keys: ['hr'] });
      } else if (dbp.stage === 1 && now - dbp.at >= DECOMP.BRADY * 1000) {
        dbp = null;
        setRhythm('asystolie', 0);
        log('<b>Kreislaufstillstand:</b> Asystolie nach anhaltend systolischem Druck unter ' +
            Engine.SYS_LETHAL + ' mmHg');
        decompNote(notes.join('  ·  '));
        return;
      }
      notes.push(dbp.stage === 0
        ? 'systolisch ' + sys + ' mmHg – Bradykardie in ' + secs(dbp.at + DECOMP.BP_WAIT * 1000 - now)
        : 'terminale Bradykardie – Asystolie in ' + secs(dbp.at + DECOMP.BRADY * 1000 - now));
    } else if (dbp) {
      /* Abgewendet: Die Frequenz erholt sich um das, was sie verloren hat.
         Was ein Medikament inzwischen dazugetan hat, bleibt erhalten. */
      if (perf && dbp.stage === 1 && dbp.drop > 0) {
        state.hr = clampP('hr', state.hr + dbp.drop); syncSlider('hr');
        send({ dur: 6, keys: ['hr'] });
      }
      if (perf) log('Druck wieder über ' + Engine.SYS_LETHAL + ' mmHg systolisch – Entgleisung abgewendet');
      dbp = null;
    }
    decompNote(notes.join('  ·  '));
  }
  setInterval(decompTick, 250);

  (function () {
    var b = document.getElementById('btnDecomp');
    if (!b) return;
    b.onclick = function () {
      decompOn = !decompOn;
      b.classList.toggle('active', decompOn);
      if (!decompOn) resetDecomp();
      log('Entgleisung bei kritischen Werten: ' + (decompOn ? 'an' : 'aus'));
    };
  })();

  /* ---------- Form der T-Welle ---------- */

  /* Eine hohe, spitze T-Welle ist das erste EKG-Zeichen der Hyperkaliaemie.
     Wer sie einstellt, bekommt deshalb auch den Laborwert dazu - sonst
     zeigt die BGA ein normales Kalium und widerspricht dem Bild. Wird die
     T-Welle wieder zurueckgestellt, kehrt das Kalium auf den alten Wert
     zurueck, sofern es inzwischen niemand verstellt hat. */
  var K_TW_HOCH = 6.0, kBeforeTw = null;
  function setTw(id, label) {
    var war = state.tw;
    state.tw = id; syncTw();
    log('T-Welle: ' + label);
    if (id === 'hoch' && state.lab.k < 5.5) {
      kBeforeTw = state.lab.k;
      state.lab.k = K_TW_HOCH; syncLab('k');
      log('&nbsp;&nbsp;↳ Kalium auf <b>' + fmt(K_TW_HOCH, 0.1) + ' mmol/l</b> gesetzt – ' +
          'die hohe T-Welle gehört zur Hyperkaliämie, die BGA zeigt sie jetzt');
    } else if (war === 'hoch' && id !== 'hoch' && kBeforeTw !== null) {
      if (Math.abs(state.lab.k - K_TW_HOCH) < 0.05) {
        state.lab.k = kBeforeTw; syncLab('k');
        log('&nbsp;&nbsp;↳ Kalium wieder ' + fmt(kBeforeTw, 0.1) + ' mmol/l');
      }
      kBeforeTw = null;
    }
    send();
  }

  /* ---------- Schenkel- und Faszikelbloecke ---------- */

  /* Der Block ist eine Eigenschaft der Erregungsleitung und gilt fuer jeden
     uebergeleiteten Schlag, gleich welcher Rhythmus laeuft. Die QRS-Breite
     wandert auf den Wert, der zu ihm gehoert. */
  var blockBtns = {};
  function syncBlock() {
    Object.keys(blockBtns).forEach(function (k) {
      blockBtns[k].classList.toggle('active', k === (state.block || 'none'));
    });
  }
  function setBlock(id) {
    state.block = id;
    state.qrs = Engine.blockDur(id); syncSlider('qrs');
    syncBlock();
    log('Erregungsleitung: <b>' + Engine.BLOCKS[id].label + '</b>' +
        (id === 'none' ? '' : ' – QRS ' + state.qrs + ' ms, im 12-Kanal-EKG zu sehen'));
    send();
  }
  (function () {
    var row = document.getElementById('blockRow');
    if (!row) return;
    Engine.BLOCK_ORDER.forEach(function (id) {
      var b = document.createElement('button');
      b.className = 'b'; b.textContent = Engine.BLOCKS[id].kurz;
      b.title = Engine.BLOCKS[id].label;
      b.onclick = function () { setBlock(id); };
      blockBtns[id] = b;
      row.appendChild(b);
    });
    syncBlock();
  })();

  /* ---------- 12-Kanal-EKG ---------- */

  /* Geschrieben wird der Zustand, der gerade anliegt (die Vorschau-Engine),
     nicht der Zielwert. Zustand und Zufallszahl gehen an den Monitor, damit
     beide Fenster dasselbe Blatt zeigen. */
  var ekgOv = false, ekgNm = false, ekgKr = false;
  function ekgWrite() {
    var p = { state: prev.snapshot(), seed: Math.floor(Math.random() * 4e9) + 1, at: Date.now(),
              ov: ekgOv, nm: ekgNm, kr: ekgKr };
    EKG12.show(p);
    cmd('ecg12', p);
    log('<b>12-Kanal-EKG</b> geschrieben – ' + Engine.rhythmLabel(state.rhythm) +
        ((state.block && state.block !== 'none') ? ', ' + Engine.BLOCKS[state.block].label : ''));
    syncEkgBtn();
  }
  /* Rhythmus und Kriterien sind die Aufloesung. Mit dem Schliessen gehen sie
     wieder aus, damit das naechste Blatt nicht schon die Antwort zeigt. */
  function ekgClose() {
    EKG12.hide(); cmd('ecg12close');
    if (ekgNm) ekgName(false, true);
    if (ekgKr) ekgKrit(false, true);
    syncEkgBtn();
  }
  function ekgOverlay(on, quiet) {
    ekgOv = on === undefined ? !ekgOv : !!on;
    if (ekgOv && ekgKr) ekgKrit(false, true);      /* beide teilen sich den Platz */
    EKG12.setOverlay(ekgOv);
    cmd('ecg12ov', ekgOv);
    if (!quiet) log('12-Kanal-EKG: Umschlagpunkte ' + (ekgOv ? 'eingeblendet' : 'ausgeblendet'));
  }
  function ekgName(on, quiet) {
    ekgNm = on === undefined ? !ekgNm : !!on;
    EKG12.setName(ekgNm);
    cmd('ecg12nm', ekgNm);
    if (!quiet) log('12-Kanal-EKG: Rhythmus ' + (ekgNm ? 'eingeblendet' : 'ausgeblendet'));
  }
  function ekgKrit(on, quiet) {
    ekgKr = on === undefined ? !ekgKr : !!on;
    if (ekgKr && ekgOv) ekgOverlay(false, true);
    EKG12.setKrit(ekgKr);
    cmd('ecg12kr', ekgKr);
    if (!quiet) log('12-Kanal-EKG: Kriterien ' + (ekgKr ? 'eingeblendet' : 'ausgeblendet'));
  }
  function ekgToggle() { if (EKG12.isOpen()) ekgClose(); else ekgWrite(); }
  function syncEkgBtn() {
    var b = document.getElementById('btnEkg');
    if (b) b.classList.toggle('active', EKG12.isOpen());
  }
  EKG12.init({ command: function (c) { devCommand(c); } });
  (function () {
    var b = document.getElementById('btnEkg');
    if (b) b.onclick = ekgToggle;
  })();

  var twBtns = {};
  function syncTw() {
    Object.keys(twBtns).forEach(function (k) {
      twBtns[k].classList.toggle('active', k === state.tw);
    });
  }
  (function () {
    var row = document.getElementById('twRow');
    if (!row) return;
    [['normal', 'T normal'], ['hoch', 'T hoch und spitz'],
     ['flach', 'T flach'], ['negativ', 'T negativ']].forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'b'; b.textContent = o[1];
      b.onclick = function () { setTw(o[0], o[1]); };
      twBtns[o[0]] = b;
      row.appendChild(b);
    });
    syncTw();
  })();

  /* ---------- Anzeige ---------- */

  (function () {
    var row = document.getElementById('showRow');
    [['art', 'Arterie'], ['pleth', 'Pleth'], ['cvp', 'ZVD-Kurve']].forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'b active'; b.textContent = o[1];
      b.onclick = function () {
        state.show[o[0]] = !state.show[o[0]];
        b.classList.toggle('active', state.show[o[0]]);
        send();
      };
      row.appendChild(b);
    });
    var al = document.createElement('button');
    al.className = 'b active'; al.textContent = 'Alarme';
    al.onclick = function () { state.alarms = !state.alarms; al.classList.toggle('active', state.alarms); send(); };
    row.appendChild(al);

    /* Standardmaessig aus: die Lernenden sollen den Rhythmus selbst erkennen. */
    [['rhythmStatus', 'Rhythmusmeldung am EKG'],
     ['rhythmName', 'Rhythmusname am Monitor'],
     ['alarmText', 'Alarmtexte am Monitor']].forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'b' + (state.show[o[0]] ? ' active' : ''); b.textContent = o[1];
      b.onclick = function () {
        state.show[o[0]] = !state.show[o[0]];
        b.classList.toggle('active', state.show[o[0]]);
        log(o[1] + ': ' + (state.show[o[0]] ? 'an' : 'aus'));
        send();
      };
      row.appendChild(b);
    });

    var srow = document.getElementById('sweepRow');
    [[4, 'schnell (4 s)'], [6, 'normal (6 s)'], [10, 'langsam (10 s)']].forEach(function (o) {
      var b = document.createElement('button');
      b.className = 'b' + (o[0] === 6 ? ' active' : '');
      b.style.fontSize = '12px';
      b.textContent = o[1];
      b.onclick = function () {
        state.sweep = o[0];
        Array.prototype.forEach.call(srow.children, function (c) { c.classList.remove('active'); });
        b.classList.add('active'); send();
      };
      srow.appendChild(b);
    });
  })();

  /* ---------- Standbild ---------- */

  /* Eingefroren wird im Monitorfenster; von hier aus wird nur umgeschaltet.
     Der Monitor meldet seinen Zustand zurueck, damit die Taste stimmt, auch
     wenn dort die Funktionstaste benutzt wurde. */
  function syncFreeze(on) {
    var b = document.getElementById('btnFreeze');
    b.classList.toggle('active', !!on);
    b.textContent = on ? 'Standbild beenden' : 'Standbild';
  }
  document.getElementById('btnFreeze').onclick = function () { cmd('freeze'); };

  /* ---------- Patient ---------- */
  ['pName', 'pAge', 'pBed'].forEach(function (id) {
    document.getElementById(id).addEventListener('input', function () {
      state.patient = {
        name: document.getElementById('pName').value,
        alter: document.getElementById('pAge').value,
        geschlecht: state.patient.geschlecht,
        bett: document.getElementById('pBed').value
      };
      send();
    });
  });

  /* ---------- Monitorfenster ---------- */

  document.getElementById('btnOpen').onclick = function () {
    monitorWin = window.open('monitor.html?v=202611242213', 'fiticu_monitor',
      'width=1280,height=760,menubar=no,toolbar=no,location=no');
    if (monitorWin) { setTimeout(send, 600); setTimeout(send, 1600); }
  };

  /* ---------- Tastatur ---------- */

  document.addEventListener('keydown', function (e) {
    if (/input|textarea|select/i.test(e.target.tagName)) return;
    if (e.key >= '1' && e.key <= '9') { applyPreset(PRESETS[parseInt(e.key, 10) - 1]); e.preventDefault(); }
    if (e.key === 'v' || e.key === 'V') setRhythm('vf_grob', 0);
    if (e.key === 'a' || e.key === 'A') setRhythm('asystolie', 0);
    if (e.key === 's' || e.key === 'S') setRhythm('sinus', 75);
    if (e.key === 'p' || e.key === 'P') cmd('freeze');
    if (e.key === 'd' || e.key === 'D') shock();
    if (e.key === 'b' || e.key === 'B') takeBga();
    if (e.key === 'e' || e.key === 'E') ekgToggle();
    if ((e.key === 'u' || e.key === 'U') && EKG12.isOpen()) ekgOverlay();
    if ((e.key === 'r' || e.key === 'R') && EKG12.isOpen()) ekgName();
    if ((e.key === 'k' || e.key === 'K') && EKG12.isOpen()) ekgKrit();
  });

  /* ---------- Vorschaukurve ---------- */

  (function preview() {
    var cv = document.getElementById('preview');
    var ctx = cv.getContext('2d');
    var W = 0, H = 0, x = 0, lastY = 0, last = performance.now();

    function fit() {
      var dpr = window.devicePixelRatio || 1;
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      x = 0; lastY = H * 0.66;
    }
    window.addEventListener('resize', fit);
    setTimeout(fit, 0);

    function toY(v) {
      var y = H * 0.68 - v * H * 0.30;
      return y < 2 ? 2 : (y > H - 2 ? H - 2 : y);
    }

    function loop(now) {
      var dt = Math.min(0.2, (now - last) / 1000); last = now;
      /* Nur wenn wirklich gezeichnet wird – ist die Vorschau ausgeblendet
         (Handy-Fassung), dreht decompTick die Vorschau-Engine weiter. */
      if (W > 0) {
        prevFrameAt = now;
        var t0 = prev.t;
        prev.update(dt);
        var px = W / Math.max(2, state.sweep);
        var rem = px * dt, tc = t0, guard = 0;
        while (rem > 0.001 && guard++ < 10) {
          var step = Math.min(rem, W - x);
          var t1 = tc + step / px;
          ctx.fillStyle = '#000';
          ctx.fillRect(x + step, 0, Math.min(10, W - x - step), H);
          var n = Math.max(2, Math.ceil(step * 5)), cur = false;
          ctx.strokeStyle = '#e8ecf2'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(x, lastY);
          var lx = x;
          for (var i = 1; i <= n; i++) {
            var f = i / n, tt = tc + (t1 - tc) * f, sp = prev.isSpike(tt);
            if (sp !== cur) {
              ctx.stroke();
              cur = sp;
              ctx.strokeStyle = cur ? '#3ce06a' : '#e8ecf2';
              ctx.lineWidth = cur ? 1.8 : 1.4;
              ctx.beginPath(); ctx.moveTo(lx, lastY);
            }
            lastY = toY(prev.ecgAt(tt));
            lx = x + step * f;
            ctx.lineTo(lx, lastY);
          }
          ctx.stroke();
          x += step; tc = t1; rem -= step;
          if (x >= W - 0.01) { x = 0; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 10, H); }
        }
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  })();

  /* ---------- Start ---------- */

  SLIDERS.forEach(function (s) { syncSlider(s[0]); });
  LAB.forEach(function (c) { syncLab(c[0]); });
  syncLacAuto();
  renderGiven();
  BGA.wire();
  markRhythm(state.rhythm);
  prev.apply(JSON.parse(JSON.stringify(state)));
  if (EMBED) { setLinked(true); send(); log('Steuerung bereit.'); }
  else log('Steuerung bereit. Monitorfenster öffnen und auf den zweiten Bildschirm ziehen.');
})();
