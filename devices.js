/* devices.js – Gerätefronten, die über den Monitor gelegt werden:
   Defibrillator corpuls1 und externer Zweikammer-Schrittmacher Oscor
   PACE 203H.

   Die Fronten sind die Herstellerabbildungen selbst: freigestellt, und an
   den Stellen, an denen Werte stehen, leergeräumt. Darüber liegen – auf den
   Bildpunkt genau positioniert – die Felder, die der Simulator füllt: die
   Ziffern des Schrittmachers als Siebensegmentanzeige, die Kurven des
   corpuls1 auf eigenen Leinwänden, dazu unsichtbare Schaltflächen über den
   echten Tasten, Rädern und Menüzeilen.

   Dadurch skaliert alles mit: Jede Position steht in Bildpunkten des
   Originals und wird in Prozent umgerechnet.

   Beide Fenster laden diese Datei. Gezeichnet wird aus der Engine des
   eigenen Fensters, geändert wird über den Host: In der Steuerung landet die
   Änderung direkt im Zustand, am Monitor wird sie zur Steuerung geschickt.

   Die Abbildungen gehören ihren Herstellern und werden hier nur für den
   internen Unterricht verwendet. */
(function (global) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function el(id) { return document.getElementById(id); }
  function dec(v, n) { return v.toFixed(n === undefined ? 1 : n).replace('.', ','); }
  function two(n) { return (n < 10 ? '0' : '') + n; }

  var VER = '202611242213';
  var host = null, openDev = null, raf = null, built = false;

  /* Grundmaße der beiden Abbildungen */
  var IMG = {
    corpuls: { src: 'geraet-corpuls1.png', w: 1150, h: 803 },
    pacer:   { src: 'geraet-pace203h.png', w: 675,  h: 1495 }
  };

  /* ---------- Einstellbereiche des PACE 203H ----------
     Der PACE 203H stellt die Stimulation in Volt ein, nicht in Milliampere. */
  var KNOBS = {
    rate:  { min: 30,  max: 180, step: 5,   unit: 'ppm', lcd: 'RATE',    dec: 0 },
    av:    { min: 20,  max: 300, step: 10,  unit: 'ms',  lcd: 'A-V DLY', dec: 0 },
    outA:  { min: 0,   max: 10,  step: 0.5, unit: 'V',   lcd: 'A-STIM',  dec: 1 },
    sensA: { min: 0.4, max: 10,  step: 0.2, unit: 'mV',  lcd: 'A-SENSE', dec: 1 },
    outV:  { min: 0,   max: 10,  step: 0.5, unit: 'V',   lcd: 'V-STIM',  dec: 1 },
    sensV: { min: 0.8, max: 20,  step: 0.5, unit: 'mV',  lcd: 'V-SENSE', dec: 1 }
  };
  var knobSel = { top: 'rate', mid: 'outA', bot: 'outV' };
  var KNOB_ALT = { top: ['rate', 'av'], mid: ['outA', 'sensA'], bot: ['outV', 'sensV'] };

  /* ---------- Siebensegmentanzeige ----------
     Nachgezeichnet in der Zellengröße des Originals: 25 x 50 Bildpunkte,
     Segmentstärke 6,5, Zellenabstand 6. */
  var SEG = {
    '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
    '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg',
    '-': 'g', ' ': ''
  };
  var CW = 25, CH = 50, ST = 6.5, PITCH = 31, DOTW = 10;

  function hseg(x0, x1, y) {
    var h = ST / 2;
    return [[x0, y], [x0 + h, y - h], [x1 - h, y - h], [x1, y], [x1 - h, y + h], [x0 + h, y + h]];
  }
  function vseg(x, y0, y1) {
    var h = ST / 2;
    return [[x, y0], [x + h, y0 + h], [x + h, y1 - h], [x, y1], [x - h, y1 - h], [x - h, y0 + h]];
  }
  function cellSegs() {
    var L = ST / 2, R = CW - ST / 2, T = ST / 2, M = CH / 2, B = CH - ST / 2, g = 1.2;
    return {
      a: hseg(L + g, R - g, T), b: vseg(R, T + g, M - g), c: vseg(R, M + g, B - g),
      d: hseg(L + g, R - g, B), e: vseg(L, M + g, B - g), f: vseg(L, T + g, M - g),
      g: hseg(L + g, R - g, M)
    };
  }
  var SEGPATH = cellSegs();

  /* Zeichnet den Text rechtsbündig in ein Feld von bw x bh Bildpunkten. */
  function segSvg(txt, bw, bh) {
    var i, c, w = 0;
    for (i = 0; i < txt.length; i++) w += (txt[i] === ',' || txt[i] === '.') ? DOTW : PITCH;
    w -= (txt.length ? (txt[txt.length - 1] === ',' ? 0 : PITCH - CW) : 0);
    var scale = w > bw ? bw / w : 1;
    var x = (bw - w * scale) / scale;          /* rechtsbündig, in Zelleneinheiten */
    var parts = [];
    for (i = 0; i < txt.length; i++) {
      c = txt[i];
      if (c === ',' || c === '.') {
        parts.push('<rect x="' + (x + 1) + '" y="' + (CH - ST) + '" width="' + ST +
                   '" height="' + ST + '"/>');
        x += DOTW;
        continue;
      }
      var segs = SEG[c] || '';
      for (var s = 0; s < segs.length; s++) {
        var p = SEGPATH[segs[s]];
        parts.push('<polygon points="' + p.map(function (q) {
          return (q[0] + x).toFixed(2) + ',' + q[1].toFixed(2);
        }).join(' ') + '"/>');
      }
      x += PITCH;
    }
    return '<svg viewBox="0 0 ' + (bw / scale) + ' ' + CH + '" preserveAspectRatio="none" ' +
           'width="100%" height="100%"><g fill="#15171b">' + parts.join('') + '</g></svg>';
  }

  /* ---------- Feldlagen in Bildpunkten des Originals ---------- */

  var C = {   /* corpuls1 */
    clock:   [410, 188, 476, 212],
    elapsed: [500, 188, 592, 212],
    hr:      [246, 232, 312, 292],
    spo2:    [380, 232, 446, 292],
    pr:      [510, 232, 576, 292],
    /* Der Defibrillator zeigt nur das EKG. Die Spur laeuft deshalb ueber die
       ganze Kurvenflaeche des Schirms - die Trennlinie und der Schriftzug
       "Pleth" sind im Bild entfernt. */
    ecg:     [250, 307, 744, 575],
    softbar: [209, 549, 744, 576],
    chg:     [212, 182, 404, 216],
    keys:    [[228, 596, 298, 650], [332, 596, 402, 650], [437, 596, 507, 650],
              [542, 596, 612, 650], [647, 596, 717, 650]],
    defib:   [846, 311, 935, 360],
    analyse: [846, 404, 935, 454],
    shock:   [840, 495, 940, 595]
  };

  var P = {   /* PACE 203H */
    mode:  [163, 253, 256, 292],
    rate:  [170, 319, 258, 371],
    sensA: [170, 403, 258, 455],
    outA:  [170, 487, 258, 539],
    av:    [170, 571, 258, 623],
    outV:  [170, 654, 258, 706],
    sensV: [170, 738, 258, 790],
    heart: [284, 318, 324, 358],
    dots:  { ddd: [284, 948, 312, 976], vvi: [284, 1034, 312, 1062],
             aai: [284, 1119, 312, 1147], vdd: [284, 1204, 312, 1232] },
    rows:  [[110, 928, 335, 1000], [110, 1002, 335, 1085], [110, 1087, 335, 1170],
            [110, 1172, 335, 1258], [110, 1268, 335, 1334]],
    mkeys: [[340, 933, 400, 993], [340, 1017, 400, 1077], [340, 1102, 400, 1162],
            [340, 1187, 400, 1247], [340, 1270, 400, 1330]],
    knobs: { top: [503, 264, 627, 388], mid: [506, 450, 634, 578], bot: [510, 607, 640, 737] },
    small: { top: [436, 383, 500, 447], mid: [440, 558, 500, 618], bot: [440, 726, 502, 788] },
    emg:   [452, 880, 516, 944],
    off:   [103, 1373, 167, 1437],
    on:    [273, 1373, 337, 1437]
  };

  function box(dev, b, extra) {
    var m = IMG[dev];
    return 'left:' + (b[0] / m.w * 100) + '%;top:' + (b[1] / m.h * 100) +
           '%;width:' + ((b[2] - b[0]) / m.w * 100) + '%;height:' +
           ((b[3] - b[1]) / m.h * 100) + '%;' + (extra || '');
  }

  /* ---------- Aufbau ---------- */

  function build() {
    if (built) return;
    var wrap = el('devOverlay');
    if (!wrap) return;
    wrap.innerHTML = '<div class="devSheet">' + corpulsHtml() + pacerHtml() +
      '<div class="devNote" id="devNote"></div>' +
      '<div class="devBtns"><button id="devClose">Schließen</button></div></div>';
    built = true;
    wireCorpuls();
    wirePacer();
    el('devClose').onclick = function () { hide(true); };
    wrap.addEventListener('click', function (e) { if (e.target === wrap) hide(true); });
  }

  function corpulsHtml() {
    var h = '<div class="dev devimg" id="devCorpuls">' +
      '<img class="base" src="' + IMG.corpuls.src + '?v=' + VER + '" alt="corpuls1">' +
      '<div class="ov t mono" id="cp-clock" style="' + box('corpuls', C.clock) + '"></div>' +
      '<div class="ov t mono" id="cp-elapsed" style="' + box('corpuls', C.elapsed) + '"></div>' +
      '<div class="ov num hr" id="cp-hr" style="' + box('corpuls', C.hr) + '"></div>' +
      '<div class="ov num bl" id="cp-spo2" style="' + box('corpuls', C.spo2) + '"></div>' +
      '<div class="ov num bl" id="cp-pr" style="' + box('corpuls', C.pr) + '"></div>' +
      '<canvas class="ov" id="c-ecg" style="' + box('corpuls', C.ecg) + '"></canvas>' +
      '<div class="ov softbar" id="cp-soft" style="' + box('corpuls', C.softbar) + '"></div>';
    C.keys.forEach(function (k, i) {
      h += '<button class="hot" data-soft="' + i + '" style="' + box('corpuls', k) + '"></button>';
    });
    h += '<button class="hot" id="c-load" style="' + box('corpuls', C.defib) + '"></button>' +
         '<button class="hot" id="c-analyse" style="' + box('corpuls', C.analyse) + '"></button>' +
         '<button class="hot rnd" id="c-shock" style="' + box('corpuls', C.shock) + '"></button>' +
         '<div class="ov chg" id="cp-chg" style="' + box('corpuls', C.chg) + '"></div>' +
      '</div>';
    return h;
  }

  function pacerHtml() {
    var h = '<div class="dev devimg" id="devPacer">' +
      '<img class="base" src="' + IMG.pacer.src + '?v=' + VER + '" alt="Oscor PACE 203H">' +
      '<div class="ov mode" id="pc-mode" style="' + box('pacer', P.mode) + '"></div>' +
      '<div class="ov heart" id="pc-heart" style="' + box('pacer', P.heart) + '">' +
        '<svg viewBox="0 0 40 40"><path d="M20 10c4.6-4.1 13.4-.3 13.4 7.6C33.4 25 23.4 31 20 35' +
        'c-3.4-4-13.4-10-13.4-17.4C6.6 9.7 15.4 5.9 20 10z"/></svg></div>';
    ['rate', 'sensA', 'outA', 'av', 'outV', 'sensV'].forEach(function (k) {
      h += '<div class="ov seg" id="pc-' + k + '" style="' + box('pacer', P[k]) + '"></div>';
    });
    Object.keys(P.dots).forEach(function (m) {
      h += '<div class="ov dot" id="pd-' + m + '" style="' + box('pacer', P.dots[m]) + '"></div>';
    });
    P.rows.forEach(function (r, i) {
      h += '<button class="hot" data-menu="' + i + '" style="' + box('pacer', r) + '"></button>';
    });
    P.mkeys.forEach(function (r, i) {
      h += '<button class="hot rnd" data-menu="' + i + '" style="' + box('pacer', r) + '"></button>';
    });
    Object.keys(P.knobs).forEach(function (k) {
      h += '<div class="hot rnd knob" data-knob="' + k + '" style="' + box('pacer', P.knobs[k]) + '"></div>';
    });
    Object.keys(P.small).forEach(function (k) {
      h += '<button class="hot rnd" data-alt="' + k + '" style="' + box('pacer', P.small[k]) + '"></button>';
    });
    h += '<button class="hot rnd" id="pc-emg" style="' + box('pacer', P.emg) + '"></button>' +
         '<button class="hot rnd" id="pc-off" style="' + box('pacer', P.off) + '"></button>' +
         '<button class="hot rnd" id="pc-on" style="' + box('pacer', P.on) + '"></button>' +
      '</div>';
    return h;
  }

  /* ---------- corpuls1 ---------- */

  function defiState() {
    var d = (host.engine.state && host.engine.state.defi) || {};
    return { mode: d.mode || 'defib', energy: d.energy || 200,
             charged: !!d.charged, charging: !!d.charging };
  }

  function wireCorpuls() {
    el('c-load').onclick = function () { host.command('charge'); };
    el('c-shock').onclick = function () { host.command('shock'); };
    el('c-analyse').onclick = function () {
      note('Die AED-Analyse ist nicht nachgebildet – im Unterricht wird manuell defibrilliert.');
    };
    Array.prototype.forEach.call(document.querySelectorAll('#devCorpuls [data-soft]'), function (b) {
      b.onclick = function () { softPress(parseInt(b.getAttribute('data-soft'), 10)); };
    });
  }

  function softPress(i) {
    var d = defiState();
    if (i === 0) {
      var m = d.mode === 'cardio' ? 'defib' : 'cardio';
      var nl = Engine.energies(m), best = nl[0];
      nl.forEach(function (j) { if (Math.abs(j - d.energy) < Math.abs(best - d.energy)) best = j; });
      host.patch({ defi: { mode: m, energy: best, charged: false, charging: false } });
      return;
    }
    var list = Engine.energies(d.mode);
    if (list[i - 1] === undefined) return;
    /* Energie ändern entlädt das Gerät – wie am echten Defibrillator. */
    host.patch({ defi: { energy: list[i - 1], charged: false, charging: false } });
  }

  var noteT = 0, lastNote = '';
  function note(txt) {
    var n = el('devNote');
    if (!n) return;
    n.textContent = txt; n.classList.add('flash'); noteT = performance.now();
  }

  function refreshDefi() {
    var d = defiState(), st = host.engine.state, ro = host.engine.readout();
    var list = Engine.energies(d.mode);
    var bar = el('cp-soft');
    var key = d.mode + ':' + d.energy;
    if (bar.getAttribute('data-key') !== key) {
      bar.setAttribute('data-key', key);
      bar.innerHTML = '<span class="c' + (d.mode === 'cardio' ? ' on' : '') + '">Sync</span>' +
        list.map(function (j) {
          return '<span class="c' + (j === d.energy ? ' on' : '') + '">' + j + ' J</span>';
        }).join('');
    }
    el('cp-hr').textContent = (ro.hr === null || ro.hr === undefined) ? '--' : ro.hr;
    el('cp-pr').textContent = (ro.hr === null || ro.hr === undefined || !ro.perfusing) ? '--' : ro.hr;
    el('cp-spo2').textContent = (ro.spo2 === null || ro.spo2 === undefined) ? '--' : ro.spo2;
    var now = new Date();
    el('cp-clock').textContent = two(now.getHours()) + ':' + two(now.getMinutes());
    var sec = Math.floor(host.engine.t);
    el('cp-elapsed').textContent = two(Math.floor(sec / 3600)) + ':' +
      two(Math.floor(sec / 60) % 60) + ':' + two(sec % 60);

    var chg = el('cp-chg');
    chg.className = 'ov chg' + (d.charging ? ' busy' : (d.charged ? ' ready' : ''));
    chg.textContent = d.charging ? 'LÄDT …' : (d.charged ? 'GELADEN  ' + d.energy + ' J' : '');
    el('c-shock').classList.toggle('armed', d.charged);

    if (performance.now() - noteT > 6000) {
      var txt = d.mode === 'cardio'
        ? (Engine.hasR(st.rhythm)
            ? 'Kardioversion: Sync ist an, der Schock fällt auf die nächste R-Zacke (gelbe Marken über der Kurve).'
            : 'Kein Rhythmus mit R-Zacke – hier wird defibrilliert, nicht kardiovertiert.')
        : 'Defibrillation: Sync ist aus, der Schock geht sofort raus. „Defib" lädt, der rote Knopf löst aus.';
      if (txt !== lastNote) { el('devNote').textContent = txt; lastNote = txt; }
      el('devNote').classList.remove('flash', 'warn');
    }
  }

  /* ---------- PACE 203H ---------- */

  var MODE_SPRITE = { ddd: 'lcd-ddd.png', vvi: 'lcd-vvi.png', aai: 'lcd-aai.png' };

  function wirePacer() {
    function pick(i) {
      var m = ['ddd', 'vvi', 'aai', 'vdd', null][i];
      if (!m) { note('Das Hauptmenü ist nicht nachgebildet.'); return; }
      if (m === 'vdd') {
        note('VDD ist nicht nachgebildet: Dazu müsste das Gerät einen Eigenrhythmus wahrnehmen.');
        return;
      }
      host.command('pacer:' + m);
    }
    Array.prototype.forEach.call(document.querySelectorAll('#devPacer [data-menu]'), function (b) {
      b.onclick = function () { pick(parseInt(b.getAttribute('data-menu'), 10)); };
    });
    el('pc-off').onclick = function () { host.command('pacer:aus'); };
    el('pc-on').onclick = function () { host.command('pacer:ddd'); };
    el('pc-emg').onclick = function () { host.command('pacer:emergency'); };

    /* Räder: Mausrad, Ziehen oder Klick auf die linke bzw. rechte Hälfte. */
    Array.prototype.forEach.call(document.querySelectorAll('#devPacer .knob'), function (kb) {
      var pos = kb.getAttribute('data-knob');
      kb.addEventListener('wheel', function (e) {
        e.preventDefault(); bump(knobSel[pos], e.deltaY < 0 ? 1 : -1);
      }, { passive: false });
      var dragY = null, acc = 0, moved = false;
      kb.addEventListener('pointerdown', function (e) {
        dragY = e.clientY; acc = 0; moved = false;
        try { kb.setPointerCapture(e.pointerId); } catch (err) {}
      });
      kb.addEventListener('pointermove', function (e) {
        if (dragY === null) return;
        acc += dragY - e.clientY; dragY = e.clientY;
        while (Math.abs(acc) >= 9) {
          moved = true;
          bump(knobSel[pos], acc > 0 ? 1 : -1);
          acc += acc > 0 ? -9 : 9;
        }
      });
      kb.addEventListener('pointerup', function (e) {
        if (dragY !== null && !moved) {
          var r = kb.getBoundingClientRect();
          bump(knobSel[pos], e.clientX < r.left + r.width / 2 ? -1 : 1);
        }
        dragY = null;
      });
      kb.addEventListener('pointercancel', function () { dragY = null; });
    });
    Array.prototype.forEach.call(document.querySelectorAll('#devPacer [data-alt]'), function (b) {
      b.onclick = function () {
        var pos = b.getAttribute('data-alt'), pair = KNOB_ALT[pos];
        knobSel[pos] = knobSel[pos] === pair[0] ? pair[1] : pair[0];
        note('Rad stellt jetzt ' + KNOBS[knobSel[pos]].lcd + ' ein.');
        refresh();
      };
    });
  }

  function stateVal(k) {
    var st = host.engine.state;
    if (k === 'rate') return st.hr;
    var p = st.pacer || {};
    return p[k] === undefined ? KNOBS[k].min : p[k];
  }

  /* Im Monitorfenster läuft jede Änderung erst zur Steuerung und wieder
     zurück. Bis der neue Wert ankommt, zeigt das Rad den selbst gesetzten. */
  var pending = {};
  function pacerVal(k) {
    var cur = stateVal(k), p = pending[k];
    if (!p) return cur;
    if (p.v === cur || performance.now() - p.at > 1800) { delete pending[k]; return cur; }
    return p.v;
  }
  function bump(k, dir) {
    var c = KNOBS[k];
    var v = clamp(Math.round((pacerVal(k) + dir * c.step) / c.step) * c.step, c.min, c.max);
    v = Math.round(v * 100) / 100;
    pending[k] = { v: v, at: performance.now() };
    if (k === 'rate') host.patch({ hr: v });
    else { var p = {}; p[k] = v; host.patch({ pacer: p }); }
  }

  var shown = {};
  function refreshPacer() {
    var st = host.engine.state, mode = Engine.pacerMode(st.rhythm);
    var md = el('pc-mode');
    if (shown.mode !== mode) {
      shown.mode = mode;
      md.innerHTML = MODE_SPRITE[mode]
        ? '<img src="' + MODE_SPRITE[mode] + '?v=' + VER + '" alt="' + mode.toUpperCase() + '">'
        : '';
      el('devPacer').classList.toggle('standby', mode === 'aus');
    }
    ['ddd', 'vvi', 'aai', 'vdd'].forEach(function (m) {
      el('pd-' + m).classList.toggle('on', m === mode);
    });
    Object.keys(KNOBS).forEach(function (k) {
      var c = KNOBS[k], v = pacerVal(k), txt = dec(v, c.dec);
      var b = P[k], bw = b[2] - b[0], bh = b[3] - b[1];
      if (shown[k] !== txt) { shown[k] = txt; el('pc-' + k).innerHTML = segSvg(txt, bw, bh); }
    });

    if (performance.now() - noteT > 6000) {
      var p = st.pacer || {}, warn = [];
      if ((mode === 'ddd' || mode === 'vvi') && (p.outV === undefined ? 8 : p.outV) < Engine.PACE_THR)
        warn.push('V-STIM unter der Reizschwelle: Impuls ohne Antwort');
      if ((mode === 'ddd' || mode === 'aai') && (p.outA === undefined ? 5 : p.outA) < Engine.PACE_THR)
        warn.push('A-STIM unter der Reizschwelle: Impuls ohne Antwort');
      var n = el('devNote');
      n.textContent = mode === 'aus'
        ? 'Aus – das Gerät stimuliert nicht. ON startet wieder im DDD-Betrieb.'
        : (warn.length ? warn.join(' · ')
          : 'Räder: drehen, ziehen oder links/rechts klicken. Die kleine Taste daneben schaltet das Rad um ('
            + KNOBS[knobSel.top].lcd + ' · ' + KNOBS[knobSel.mid].lcd + ' · ' + KNOBS[knobSel.bot].lcd
            + '). Reizschwelle ' + dec(Engine.PACE_THR, 1) + ' V.');
      n.classList.toggle('warn', warn.length > 0);
      n.classList.remove('flash');
    }
  }

  function refresh() {
    if (!openDev || !host) return;
    if (openDev === 'defi') refreshDefi(); else refreshPacer();
  }

  /* ---------- Kurven im corpuls1 ---------- */

  var lanes = null, cx = 0, lastEng = 0;

  /* Grundlinie und Ausschlag haengen an der Eichzacke im Bild: sie ist
     39 Bildpunkte hoch (1 mV), die Spur ist 268 Bildpunkte hoch, und ihre
     Grundlinie liegt auf halber Hoehe - dorthin ist die Zacke im Bild
     geruckt. 1 mV im EKG erreicht damit genau die Hoehe der Eichzacke. */
  var BASE = 0.50, AMP = 39 / 268;

  function fitCanvas() {
    var dpr = global.devicePixelRatio || 1;
    lanes = [];
    [['c-ecg', '#17191c', 'ecg']].forEach(function (d) {
      var c = el(d[0]);
      if (!c) return;
      var w = c.clientWidth, h = c.clientHeight;
      if (!w || !h) return;
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      var x = c.getContext('2d');
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.lineJoin = 'round'; x.lineCap = 'round';
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      lanes.push({ ctx: x, w: w, h: h, col: d[1], kind: d[2], y: h * BASE });
    });
    cx = 0;
  }

  function drawCurves() {
    if (!lanes || !lanes.length) return;
    var eng = host.engine, t0 = lastEng, t1 = eng.t;
    lastEng = t1;
    if (t1 <= t0 || t1 - t0 > 2) return;
    var W = lanes[0].w, span = 5, px = W / span;
    var rem = (t1 - t0) * px, tc = t0, guard = 0;
    var cardio = defiState().mode === 'cardio';
    while (rem > 0.01 && guard++ < 12) {
      var step = Math.min(rem, W - cx), te = tc + step / px;
      var n = Math.max(2, Math.ceil(step * 4));
      for (var li = 0; li < lanes.length; li++) {
        var L = lanes[li], c = L.ctx;
        c.fillStyle = '#fff';
        c.fillRect(cx, 0, Math.min(step + 7, L.w - cx), L.h);
        c.strokeStyle = L.col; c.lineWidth = 1.4;
        c.beginPath(); c.moveTo(cx, L.y);
        for (var i = 1; i <= n; i++) {
          var f = i / n, tt = tc + (te - tc) * f, v;
          v = clamp(L.h * BASE - eng.ecgAt(tt) * L.h * AMP, 2, L.h - 2);
          L.y = v;
          c.lineTo(cx + step * f, v);
        }
        c.stroke();
        if (cardio) {
          c.strokeStyle = '#e8a400'; c.lineWidth = 1.8;
          for (var k = 0; k < eng.vent.length; k++) {
            var bt = eng.vent[k].t;
            if (bt < tc || bt > te) continue;
            var mx = cx + (bt - tc) * px;
            c.beginPath(); c.moveTo(mx, 2); c.lineTo(mx, 12); c.stroke();
          }
        }
      }
      cx += step; tc = te; rem -= step;
      if (cx >= W - 0.01) {
        cx = 0;
        for (var j = 0; j < lanes.length; j++) {
          lanes[j].ctx.fillStyle = '#fff';
          lanes[j].ctx.fillRect(0, 0, 7, lanes[j].h);
        }
      }
    }
  }

  /* ---------- Herzsymbol blinkt mit jedem Impuls ---------- */

  var beatUntil = 0, seen = 0;
  function heart(now) {
    var eng = host.engine, i;
    for (i = 0; i < eng.spikes.length; i++)
      if (eng.spikes[i].t > seen && eng.spikes[i].t <= eng.t) beatUntil = now + 150;
    for (i = 0; i < eng.vent.length; i++)
      if (eng.vent[i].pace && eng.vent[i].t > seen && eng.vent[i].t <= eng.t) beatUntil = now + 150;
    for (i = 0; i < eng.atrial.length; i++)
      if (eng.atrial[i].pace && eng.atrial[i].t > seen && eng.atrial[i].t <= eng.t) beatUntil = now + 150;
    seen = eng.t;
    el('pc-heart').classList.toggle('on', now < beatUntil);
  }

  /* ---------- Schleife ---------- */

  var lastRefresh = 0;
  function loop(now) {
    if (!openDev) { raf = null; return; }
    if (openDev === 'defi') drawCurves(); else heart(now);
    if (now - lastRefresh > 150) { lastRefresh = now; refresh(); }
    raf = requestAnimationFrame(loop);
  }

  /* ---------- Öffnen und Schließen ---------- */

  /* Das Geraet so gross wie moeglich, aber ganz sichtbar. Die Schriftgroesse
     wird mitskaliert: 1em entspricht 10 Bildpunkten des Originals, damit alle
     Felder in em-Einheiten angegeben werden koennen. */
  function sizeDev() {
    var wrap = el('devOverlay');
    if (!wrap || !openDev) return;
    var d = openDev === 'defi' ? el('devCorpuls') : el('devPacer');
    var m = openDev === 'defi' ? IMG.corpuls : IMG.pacer;
    /* Platz fuer Hinweis und Tasten. Die Handy-Fassung legt beides neben
       das Geraet und gibt das ueber --dev-reserve-h/-w an (mobil.css). */
    var cs = global.getComputedStyle ? global.getComputedStyle(wrap) : null;
    var rh = cs ? parseFloat(cs.getPropertyValue('--dev-reserve-h')) : NaN;
    var rw = cs ? parseFloat(cs.getPropertyValue('--dev-reserve-w')) : NaN;
    var availH = Math.max(180, wrap.clientHeight - (isNaN(rh) ? 76 : rh));
    var availW = Math.max(200, wrap.clientWidth - (isNaN(rw) ? 28 : rw));
    var w = Math.min(openDev === 'defi' ? 760 : 460, availW, availH * m.w / m.h);
    d.style.width = Math.round(w) + 'px';
    d.style.fontSize = (w / m.w * 10) + 'px';
  }

  function show(which) {
    build();
    var wrap = el('devOverlay');
    if (!wrap) return;
    openDev = which;
    el('devCorpuls').style.display = which === 'defi' ? '' : 'none';
    el('devPacer').style.display = which === 'pacer' ? '' : 'none';
    wrap.style.display = 'flex';
    sizeDev();
    shown = {};
    noteT = 0; lastNote = '';
    if (which === 'defi') {
      var img = document.querySelector('#devCorpuls .base');
      if (img.complete) fitCanvas(); else img.onload = fitCanvas;
      setTimeout(fitCanvas, 60);
      lastEng = host.engine.t;
    }
    seen = host.engine.t;
    refresh();
    if (!raf) raf = requestAnimationFrame(loop);
  }

  function hide(tell) {
    openDev = null;
    var wrap = el('devOverlay');
    if (wrap) wrap.style.display = 'none';
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    if (tell && host && host.command) host.command('devclose');
  }

  function toggle(which) { if (openDev === which) hide(false); else show(which); }

  global.addEventListener('resize', function () {
    sizeDev();
    if (openDev === 'defi') fitCanvas();
  });

  global.Devices = {
    init: function (opts) { host = opts; },
    show: show,
    hide: function () { hide(false); },
    toggle: toggle,
    isOpen: function () { return openDev; }
  };
})(window);
