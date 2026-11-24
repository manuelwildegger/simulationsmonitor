/* bga.js – Blutgasanalyse: plausible Werte aus der eingestellten Situation
   ableiten und als Ausdruck im Format des Radiometer ABL800 FLEX darstellen.

   Die Werte sind nicht hinterlegt, sondern gerechnet:
     pCO2  aus der Atemfrequenz (alveoläre Ventilation)
     Laktat aus Perfusion (MAD) und Sättigung
     HCO3  aus Laktat und akuter respiratorischer Kompensation
     pH    nach Henderson-Hasselbalch
     BE    nach van Slyke (Ecf)
     pO2   aus der Sauerstoffbindungskurve (Severinghaus), gedeckelt durch
           die alveoläre Gasgleichung
   Dadurch passen die Werte untereinander zusammen und reagieren auf jede
   Änderung an Beatmung, Kreislauf und Rhythmus. */
(function (global) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function jit(v, d) { return v + (Math.random() - 0.5) * 2 * d; }

  /* Rhythmen ohne Auswurf – falls kein Monitor verbunden ist */
  var NOPERF = { vf_grob: 1, vf_fein: 1, vt_pulslos: 1, asystolie: 1, pea: 1 };

  var DEF = {
    fio2: 21, temp: 37.0, hb: 13.8, na: 140, k: 4.1, cl: 103, ca: 1.19,
    glu: 95, cohb: 1.2, methb: 0.8, lac: 1.0, lacAuto: true,
    beOffset: 0, pco2Offset: 0, probe: 'Arteriell', benutzer: '46547'
  };

  /* Sauerstoffbindungskurve nach Severinghaus */
  function sat(po2) {
    if (po2 <= 0) return 0;
    return 1 / (23400 / (po2 * po2 * po2 + 150 * po2) + 1);
  }
  function satInv(s) {
    var lo = 1, hi = 800, mid = 100;
    for (var i = 0; i < 60; i++) {
      mid = (lo + hi) / 2;
      if (sat(mid) < s) lo = mid; else hi = mid;
    }
    return mid;
  }

  function autoLac(perf, map, spo2) {
    if (!perf) return jit(11, 2.5);                       // Kreislaufstillstand
    var v = 0.9 + Math.max(0, 75 - map) * 0.14;
    if (spo2 < 88) v += (88 - spo2) * 0.10;
    return clamp(jit(v, 0.15), 0.4, 20);
  }

  function generate(st, ro) {
    var L = {}, k;
    for (k in DEF) L[k] = DEF[k];
    if (st.lab) for (k in st.lab) if (st.lab[k] !== undefined) L[k] = st.lab[k];

    var fio2 = clamp(L.fio2, 21, 100) / 100;
    var af = clamp(st.af, 4, 60);
    var spo2 = (ro && ro.spo2 !== null && ro.spo2 !== undefined) ? ro.spo2 : st.spo2;
    var map = (ro && ro.artMap !== null && ro.artMap !== undefined)
      ? ro.artMap : Math.round(st.dia + (st.sys - st.dia) / 3);
    var perf = (ro && ro.perfusing !== undefined) ? ro.perfusing !== false : !NOPERF[st.rhythm];

    /* Ventilation */
    var pco2 = clamp(40 * Math.pow(14 / af, 0.55) + L.pco2Offset, 14, 110);
    if (!perf) pco2 = clamp(pco2 * 0.7 + 6, 14, 110);     // minimale Lungenperfusion
    pco2 = jit(pco2, 0.6);

    /* Metabolik */
    var lac = L.lacAuto ? autoLac(perf, map, spo2) : L.lac;
    var hco3 = clamp(24 - 0.85 * (lac - 1) + (pco2 - 40) / 10 + L.beOffset, 3, 45);
    var ph = 6.1 + Math.log(hco3 / (0.03 * pco2)) / Math.LN10;
    var be = 0.93 * (hco3 - 24.4 + 14.8 * (ph - 7.4));

    /* Oxygenierung */
    var pAO2 = fio2 * 713 - pco2 / 0.8;
    var po2;
    if (spo2 === null || spo2 === undefined) spo2 = 88;
    if (spo2 >= 99.5) po2 = 0.92 * pAO2;
    else po2 = Math.min(satInv(clamp(spo2, 40, 99.4) / 100), 0.97 * pAO2);
    po2 = clamp(jit(po2, 1.5), 12, 650);
    var so2 = sat(po2) * 100;

    /* Oxymetrie */
    var cohb = jit(L.cohb, 0.2), methb = jit(L.methb, 0.15);
    var fo2hb = so2 * (100 - cohb - methb) / 100;
    var fhhb = 100 - fo2hb - cohb - methb;
    var hb = jit(L.hb, 0.15);

    /* Elektrolyte – Kalium steigt mit Azidose und Minderperfusion */
    var na = jit(L.na, 1.2);
    var cl = jit(L.cl, 1.2);
    var kal = clamp(jit(L.k, 0.12) + Math.max(0, lac - 2) * 0.12, 2.2, 8.5);
    var ca = jit(L.ca, 0.02);
    var glu = jit(L.glu, 5);
    var ag = na - cl - hco3;

    /* Alpha-stat: die Probe wird immer bei 37 C gemessen, die Patienten-
       temperatur wird nicht eingegeben. Die temperaturkorrigierten Werte sind
       deshalb mit den gemessenen identisch. Die Koerpertemperatur steht am
       Monitor und geht hier bewusst nicht ein. */
    var T = 37.0;
    var d = {
      ts: new Date(),
      probeNr: 6000 + Math.floor(Math.random() * 3000),
      probentyp: L.probe, benutzer: L.benutzer, temp: T, fio2: L.fio2,
      patient: st.patient || {},
      k: kal, na: na, ca: ca, cl: cl, ag: ag,
      hb: hb, cohb: cohb, methb: methb, o2hb: fo2hb, hhb: fhhb, hct: hb * 3.14,
      lac: lac,
      ph: ph, po2: po2, pco2: pco2, hco3: hco3, so2: so2, be: be,
      glu: glu,
      horovitz: po2 / fio2,
      tPat: L.temp,
      phT: ph,
      pco2T: pco2,
      po2T: po2
    };
    return d;
  }

  /* ---------- Ausdruck ---------- */

  function n(v, dec) {
    return v.toFixed(dec).replace('.', ',');
  }
  function row(label, value, unit, sub) {
    return '<div class="r"><span class="l">' + label + (sub ? '<sub>' + sub + '</sub>' : '') +
           '</span><span class="v">' + value + '</span><span class="u">' + (unit || '') + '</span></div>';
  }
  function head(t) { return '<div class="h">' + t + '</div>'; }

  function time(d) { return d.toLocaleTimeString('de-DE'); }
  function date(d) { return d.toLocaleDateString('de-DE'); }

  function html(d) {
    var p = d.patient || {};
    var o = '';
    o += '<div class="ttl">RADIOMETER ABL800 FLEX</div>';
    o += '<div class="meta"><span>ABL825 IZ 2.1</span><span>' + time(d.ts).slice(0, 5) + '</span><span>' + date(d.ts) + '</span></div>';
    o += '<div class="meta"><span>PATIENTENBERICHT</span><span>Spritze - S 195 µL</span><span>Probe Nr. ' + d.probeNr + '</span></div>';
    o += '<hr>';

    o += head('Identifikation');
    o += row('Patienten ID', p.id || '—', '');
    o += row('Nachname (Pat.)', (p.name || '').split(',')[0] || '—', '');
    o += row('Vorname (Pat.)', ((p.name || '').split(',')[1] || '').trim() || '—', '');
    o += row('Probentyp', d.probentyp, '');
    o += row('Probenart', '...', '');
    o += row('<i>T</i>', n(d.temp, 1), '°C');
    o += row('<i>F</i>O₂(I)', n(d.fio2, 1), '%');
    o += row('Benutzer', d.benutzer, '');
    o += '<hr>';

    o += head('Elektrolyt Ergebnis');
    o += row('<i>c</i>K⁺', n(d.k, 1), 'mmol/L');
    o += row('<i>c</i>Na⁺', n(d.na, 0), 'mmol/L');
    o += row('<i>c</i>Ca²⁺', n(d.ca, 2), 'mmol/L');
    o += row('<i>c</i>Cl⁻', n(d.cl, 0), 'mmol/L');
    o += row('Anion Gap', n(d.ag, 1), 'mmol/L', 'c');

    o += head('Oxymetrie Ergebnis');
    o += row('<i>ct</i>Hb', n(d.hb, 1), 'g/dL');
    o += row('<i>F</i>COHb', n(d.cohb, 1), '%');
    o += row('<i>F</i>MetHb', n(d.methb, 1), '%');
    o += row('<i>F</i>O₂Hb', n(d.o2hb, 1), '%');
    o += row('<i>F</i>HHb', n(d.hhb, 1), '%');
    o += row('Hct', n(d.hct, 1), '%', 'c');

    o += head('Metabolit Ergebnis');
    o += row('<i>c</i>Lac', n(d.lac, 1), 'mmol/L');

    o += head('Blutgas Ergebnis');
    o += row('pH', n(d.ph, 3), '');
    o += row('<i>p</i>O₂', n(d.po2, 0), 'mmHg');
    o += row('<i>p</i>CO₂', n(d.pco2, 1), 'mmHg');
    o += row('<i>c</i>HCO₃⁻(P)', n(d.hco3, 1), 'mmol/L', 'c');
    o += row('<i>s</i>O₂', n(d.so2, 1), '%');
    o += row('<i>c</i>Base(Ecf)', n(d.be, 1), 'mmol/L', 'c');

    o += head('Metabolit Ergebnis');
    o += row('<i>c</i>Glu', n(d.glu, 0), 'mg/dL');

    o += head('Temperatur Korrektur (37 °C, α-stat)');
    o += row('<i>p</i>O₂(a,<i>T</i>)/<i>F</i>O₂(I)', n(d.horovitz, 0), 'mmHg', 'c');
    o += row('pH(<i>T</i>)', n(d.phT, 3), '');
    o += row('<i>p</i>O₂(<i>T</i>)', n(d.po2T, 0), 'mmHg');
    o += row('<i>p</i>CO₂(<i>T</i>)', n(d.pco2T, 1), 'mmHg');

    o += '<hr class="dash">';
    o += head('Meldungen');
    o += '<div class="r"><span class="l"><i>c</i></span><span class="v2">Kalkulierte(r) Wert(e)</span></div>';
    o += '<div class="r"><span class="l">α-stat</span><span class="v2">Messung bei 37,0 °C, keine Temperaturkorrektur</span></div>';
    o += '<hr>';
    o += '<div class="meta foot"><span>Gedruckt:</span><span>' + time(d.ts) + '</span><span>' + date(d.ts) + '</span></div>';
    return o;
  }

  /* ---------- Overlay ---------- */

  function show(d) {
    var ov = document.getElementById('bgaOverlay');
    if (!ov) return;
    document.getElementById('bgaPaper').innerHTML = html(d);
    ov.style.display = 'flex';
  }
  function hide() {
    var ov = document.getElementById('bgaOverlay');
    if (ov) ov.style.display = 'none';
  }

  function wire() {
    var ov = document.getElementById('bgaOverlay');
    if (!ov) return;
    ov.addEventListener('click', function (e) { if (e.target === ov) hide(); });
    var c = document.getElementById('bgaClose'); if (c) c.onclick = hide;
    var pr = document.getElementById('bgaPrint'); if (pr) pr.onclick = function () { window.print(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  }

  global.BGA = { generate: generate, html: html, show: show, hide: hide, wire: wire };
})(window);
