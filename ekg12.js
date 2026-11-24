/* ekg12.js – 12-Kanal-EKG: schreibt zehn Sekunden auf Millimeterpapier und
   legt auf Wunsch die Messpunkte darueber.

   Laeuft in beiden Fenstern. Geschrieben wird aus einem Zustand und einer
   Zufallszahl, die die Steuerung vorgibt – deshalb zeigen Steuerung und
   Monitor dasselbe Blatt. Entschieden wird in der Steuerung: Die Tasten auf
   dem Blatt schicken nur einen Befehl hinauf.

   Aufbau des Blatts: 25 mm/s, 10 mm/mV, zwei Spalten mit denselben fuenf
   Sekunden - links die Extremitaetenableitungen I, II, III, aVR, aVL, aVF
   untereinander, rechts die Brustwandableitungen V1 bis V6. Fuenf Sekunden
   sind 25 grosse Kaestchen je Spalte, 50 ueber das ganze Blatt. */
(function (global) {
  'use strict';

  var MM_W = 279, MM_H = 162;                      /* Blatt in Millimetern */
  var COLX = [12, 150];                            /* linker Rand der beiden Spalten */
  var ROW0 = 28, PITCH = 24;                       /* Grundlinie der ersten Zeile, Zeilenabstand */
  var SEC = 5;                                     /* gezeigte Sekunden je Spalte */
  var GRID_Y = 14, GRID_H = 145, LUPE_H = 50;      /* mit Lupe wird das Blatt unten laenger */
  var SPEED = 25, GAIN = 10;
  /* Grenzen fuer den oberen Umschlagpunkt in Millisekunden, nach den
     Kriterien von fokus-ekg.de (AHA/ACCF/HRS 2009): Rechtsschenkelblock in V1
     ueber 50 ms, Linksschenkelblock in V6 ab 60 ms, linksanteriorer
     Faszikelblock in aVL ueber 45 ms. Verspaetet ist, was ueber dem Wert liegt. */
  var OUP_LIMIT = { 6: 50, 11: 59, 4: 45 };
  var OUP_HINT = { 6: 'normal bis 50 ms', 11: 'normal unter 60 ms', 4: 'normal bis 45 ms' };
  /* V1 und V6 fuer die Schenkelbloecke, I, aVL, III und aVF fuer die
     Faszikelbloecke (qR und rS) */
  var LUPE = [6, 11, 0, 4, 2, 5];                  /* V1, V6, I, aVL, III, aVF */
  var KRIT_H = 66;                                 /* Hoehe des Kriterienfelds */

  var host = null, root = null, cv = null, ctx = null;
  var data = null, meas = null, payload = null, overlay = false, S = 4;
  /* nameOn: eingestellter Rhythmus in der Kopfzeile. krit: Kriterien-Overlay.
     K = was EKGKRIT aus diesem Blatt gelesen hat, ref = der normale Schlag. */
  var nameOn = false, krit = false, K = null, ref = null, refCache = {};
  function extra() { return overlay ? LUPE_H : (krit && K ? KRIT_H : 0); }

  /* Der normale Schlag zum Vergleich: Sinusrhythmus ohne Block und ohne
     Besonderheiten, mit der eingestellten Frequenz (begrenzt auf 60 bis 100),
     damit die QT-Zeit vergleichbar bleibt. */
  function reference(hr) {
    if (refCache[hr] !== undefined) return refCache[hr];
    var st = JSON.parse(JSON.stringify(Engine.defaults)), b = null;
    st.hr = hr;
    var d = Engine.write12(st, 4711, 6);
    d.beats.forEach(function (x) {
      if (x.on > 0.6 && x.tend !== null && x.tend < 5.4 &&
          (!b || Math.abs(x.t - 3) < Math.abs(b.t - 3))) b = x;
    });
    return (refCache[hr] = b ? { d: d, b: b, hr: hr } : null);
  }

  /* ---------- Messen ---------- */

  function idx(t) { return Math.max(0, Math.min(data.n - 1, Math.round(t * data.fs))); }

  /* Oberer Umschlagpunkt: der letzte positive Gipfel im Kammerkomplex, also
     der Punkt, ab dem die Kurve endgueltig nach unten laeuft. Gemessen wird
     ab dem Beginn des QRS. Gibt es keine positive Zacke (QS), gibt es auch
     keinen Umschlagpunkt. */
  function oup(L, b) {
    var x = data.leads[L], i0 = idx(b.on), i1 = idx(b.off), base = x[i0], i;
    var mx = 0, last = -1;
    for (i = i0; i <= i1; i++) if (x[i] - base > mx) mx = x[i] - base;
    if (mx < 0.05) return null;
    for (i = i0 + 1; i < i1; i++) {
      var v = x[i] - base;
      if (v >= x[i - 1] - base && v > x[i + 1] - base && v > Math.max(0.045, 0.22 * mx)) last = i;
    }
    if (last < 0) return null;
    return { t: last / data.fs, ms: Math.round((last / data.fs - b.on) * 1000), v: x[last] };
  }

  function measure() {
    var B = data.beats.filter(function (b) { return b.on > 0.35 && b.off < SEC - 0.35; });
    var m = { hr: null, pq: null, qrs: null, qt: null, qtc: null, axis: null, beat: null };
    if (data.beats.length >= 2) {
      var f = data.beats[0].t, l = data.beats[data.beats.length - 1].t;
      if (l > f) m.hr = Math.round(60 * (data.beats.length - 1) / (l - f));
    }
    if (!B.length) return m;
    /* Gemessen wird am uebergeleiteten Schlag, wenn es einen gibt. */
    var nar = B.filter(function (b) { return !b.wide && !b.pace; });
    var pool = nar.length ? nar : B;
    var b = pool[0];
    pool.forEach(function (x) { if (Math.abs(x.t - SEC / 2) < Math.abs(b.t - SEC / 2)) b = x; });
    m.beat = b;
    m.qrs = Math.round((b.off - b.on) * 1000);

    if (b.hp) {
      var p = null;
      data.ps.forEach(function (x) { if (x.t < b.on - 0.02 && x.t > b.t - 0.6) p = x; });
      if (p) m.pq = Math.round((b.on - (p.t - 0.052 + (p.pace ? 0.022 : 0))) * 1000);
    }
    if (b.tend !== null) {
      m.qt = Math.round((b.tend - b.on) * 1000);
      /* Korrigiert wird mit dem mittleren RR-Abstand, wie es ein EKG-Geraet
         tut - der Abstand zum Vorgaenger allein waere nach einer
         kompensatorischen Pause viel zu lang. */
      var rr = m.hr ? 60 / m.hr : null;
      if (rr && rr > 0.2) m.qtc = Math.round(m.qt / Math.sqrt(rr));
    }
    /* Achse so, wie man sie von Hand bestimmt: groesster Ausschlag nach oben
       minus groesster nach unten, in I und in aVF. */
    var i0 = idx(b.on), i1 = idx(b.off), k;
    var net = function (L) {
      var x = data.leads[L], mx = 0, mn = 0, j;
      for (j = i0; j <= i1; j++) {
        var v = x[j] - x[i0];
        if (v > mx) mx = v;
        if (v < mn) mn = v;
      }
      return mx + mn;
    };
    var aI = net(0), aF = net(5);
    if (Math.abs(aI) + Math.abs(aF) > 0.08)
      m.axis = Math.round(Math.atan2(aF / 0.866, aI) * 180 / Math.PI);

    m.oup = [];
    for (k = 0; k < 12; k++) m.oup.push(oup(k, b));

    return m;
  }

  /* ---------- Zeichnen ---------- */

  function px(mm) { return mm * S; }

  function grid(x0, y0, w, h, step, fine) {
    var i;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(214, 74, 74, 0.20)';
    ctx.beginPath();
    for (i = 0; i <= w / fine + 0.001; i++) {
      var x = Math.round(px(x0 + i * fine)) + 0.5;
      ctx.moveTo(x, px(y0)); ctx.lineTo(x, px(y0 + h));
    }
    for (i = 0; i <= h / fine + 0.001; i++) {
      var y = Math.round(px(y0 + i * fine)) + 0.5;
      ctx.moveTo(px(x0), y); ctx.lineTo(px(x0 + w), y);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(206, 58, 58, 0.50)';
    ctx.beginPath();
    for (i = 0; i <= w / step + 0.001; i++) {
      var X = Math.round(px(x0 + i * step)) + 0.5;
      ctx.moveTo(X, px(y0)); ctx.lineTo(X, px(y0 + h));
    }
    for (i = 0; i <= h / step + 0.001; i++) {
      var Y = Math.round(px(y0 + i * step)) + 0.5;
      ctx.moveTo(px(x0), Y); ctx.lineTo(px(x0 + w), Y);
    }
    ctx.stroke();
  }

  /* Kurvenstueck einer Ableitung: Zeit a..z, links bei x0 (mm), Grundlinie
     bei y0 (mm), mmps = Papiergeschwindigkeit. */
  function trace(L, a, z, x0, y0, mmps, gain, lim) {
    var x = data.leads[L], i0 = idx(a), i1 = idx(z), i;
    ctx.beginPath();
    for (i = i0; i <= i1; i++) {
      var X = px(x0 + (i / data.fs - a) * mmps);
      var d = x[i] * gain;
      if (lim) d = Math.max(-lim, Math.min(lim, d));
      var Y = px(y0 - d);
      if (i === i0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }

  function text(t, x, y, size, col, weight, align) {
    ctx.font = (weight || 400) + ' ' + Math.max(8, px(size)) + 'px "Helvetica Neue", Helvetica, Arial, sans-serif';
    ctx.fillStyle = col || '#15151a';
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(t, px(x), px(y));
  }

  function font(size, weight) {
    ctx.font = (weight || 400) + ' ' + Math.max(8, px(size)) + 'px "Helvetica Neue", Helvetica, Arial, sans-serif';
  }
  function twid(t, size, weight) { font(size, weight); return ctx.measureText(t).width / S; }

  function fmtAxis(a) { return a === null ? '–' : (a > 0 ? '+' : (a < 0 ? '−' : '')) + Math.abs(a) + '°'; }

  function header() {
    var p = (payload.state && payload.state.patient) || {};
    var d = new Date(payload.at || Date.now());
    text((p.name || '') + '   ' + (p.alter || '') + '   ' + (p.bett || ''), COLX[0], 6.2, 3.3, '#15151a', 700);
    text(d.toLocaleDateString('de-DE') + '   ' + d.toLocaleTimeString('de-DE').slice(0, 5) +
         '      12-Kanal-Ruhe-EKG      25 mm/s      10 mm/mV      0,05–150 Hz',
         COLX[0], 11.2, 2.6, '#444');
    var m = meas, v = function (x, u) { return x === null ? '–' : x + (u || ''); };
    var line = 'HF ' + v(m.hr, '/min') + '     PQ ' + v(m.pq, ' ms') + '     QRS ' + v(m.qrs, ' ms') +
               '     QT/QTc ' + v(m.qt) + '/' + v(m.qtc, ' ms') + '     Achse ' + fmtAxis(m.axis);
    text(line, MM_W - 4, 6.2, 3.1, '#15151a', 600, 'right');
    if (nameOn && K) {
      var nm = 'Eingestellt:  ' + K.name, sz = 3.3;
      while (sz > 2.2 && twid(nm, sz, 700) > 128) sz -= 0.1;
      text(nm, MM_W - 4, 11.4, sz, BLUE, 700, 'right');
    }
  }

  function sheet() {
    var r, c;
    ctx.fillStyle = '#fffaf7';
    ctx.fillRect(0, 0, px(MM_W), px(MM_H));
    grid(2, GRID_Y, 275, GRID_H + extra(), 5, 1);
    header();

    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    /* Der normale Schlag liegt unter der Kurve: wo beide gleich laufen,
       bleibt nur ein gruener Saum, wo sie abweichen, steht er frei. */
    if (krit && K && ref) {
      ctx.strokeStyle = KGREEN; ctx.lineWidth = Math.max(2.6, S * 0.72); ctx.globalAlpha = 0.85;
      for (c = 0; c < 2; c++) for (r = 0; r < 6; r++)
        refTrace(c * 6 + r, 0, SEC, COLX[c], ROW0 + r * PITCH, SPEED, GAIN, 17.5);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.05, S * 0.26);

    for (c = 0; c < 2; c++) for (r = 0; r < 6; r++) {
      var L = c * 6 + r, x0 = COLX[c], y = ROW0 + r * PITCH;
      /* Eichzacke: 10 mm = 1 mV, 5 mm = 0,2 s */
      ctx.beginPath();
      ctx.moveTo(px(x0 - 9), px(y)); ctx.lineTo(px(x0 - 7.5), px(y));
      ctx.lineTo(px(x0 - 7.5), px(y - GAIN)); ctx.lineTo(px(x0 - 2.5), px(y - GAIN));
      ctx.lineTo(px(x0 - 2.5), px(y)); ctx.lineTo(px(x0 - 1), px(y));
      ctx.stroke();
      trace(L, 0, SEC, x0, y, SPEED, GAIN, 17.5);
      /* Der Name steht ueber der Eichzacke, dort kreuzt ihn keine Kurve. */
      text(Engine.LEADS[L], x0 - 9, y - 11.6, 3.4, '#15151a', 700);
    }
    text('Fit for ICU \u00b7 Simulationsmonitor \u00b7 simuliertes EKG, nicht zur Diagnostik',
         MM_W - 4, MM_H - 0.9, 2.2, '#8a6a6a', 400, 'right');
  }

  /* ---------- Overlay: Umschlagpunkte ---------- */

  var BLUE = '#1565c0', RED = '#d81b1b', GREEN = '#1b8a3a';

  /* Beide Spalten zeigen dieselben fuenf Sekunden, also auch denselben
     Schlag: ein Band ueber die Breite des QRS durch alle sechs Zeilen und ein
     Punkt am oberen Umschlagpunkt jeder Ableitung. */
  function marks() {
    var b = meas.beat, c, r;
    if (!b) return;
    var top = ROW0 - 12, bot = ROW0 + 5 * PITCH + 10;
    for (c = 0; c < 2; c++) {
      var x0 = COLX[c], xa = x0 + b.on * SPEED, xz = x0 + b.off * SPEED;
      ctx.fillStyle = 'rgba(21, 101, 192, 0.13)';
      ctx.fillRect(px(xa), px(top), px(xz - xa), px(bot - top));
      ctx.strokeStyle = BLUE; ctx.lineWidth = Math.max(1, S * 0.18);
      ctx.setLineDash([px(0.8), px(0.8)]);
      ctx.beginPath();
      ctx.moveTo(px(xa), px(top)); ctx.lineTo(px(xa), px(bot));
      ctx.moveTo(px(xz), px(top)); ctx.lineTo(px(xz), px(bot));
      ctx.stroke(); ctx.setLineDash([]);
      for (r = 0; r < 6; r++) {
        var o = meas.oup[c * 6 + r];
        if (!o) continue;
        var X = x0 + o.t * SPEED, Y = ROW0 + r * PITCH - Math.max(-17.5, Math.min(17.5, o.v * GAIN));
        ctx.fillStyle = RED;
        ctx.beginPath(); ctx.arc(px(X), px(Y), Math.max(2.4, S * 0.62), 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
      }
    }
  }

  /* Lupe: derselbe Schlag in sechs Ableitungen, in der Zeit fuenffach
     gedehnt (125 mm/s). Ein grosses Kaestchen sind hier 40 ms. */
  function lupe() {
    var b = meas.beat;
    if (!b) return;
    var X = 4, Y = GRID_Y + GRID_H + 2, W = MM_W - 8, H = LUPE_H - 5;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = px(2.5); ctx.shadowOffsetY = px(0.6);
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.fillRect(px(X), px(Y), px(W), px(H));
    ctx.restore();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    ctx.strokeRect(px(X) + 0.5, px(Y) + 0.5, px(W), px(H));

    text('Oberer Umschlagpunkt (OUP)', X + 3, Y + 5.2, 3.2, '#15151a', 700);
    text('Zeit vom Beginn des QRS bis zum letzten positiven Gipfel  ·  Lupe 125 mm/s, ein großes Kästchen = 40 ms',
         X + 62, Y + 5.2, 2.5, '#444');
    /* Breite des QRS: ab 120 ms kompletter, 110 bis 119 ms inkompletter Schenkelblock */
    text('QRS ' + meas.qrs + ' ms' + (meas.qrs >= 120 ? ' · breit (ab 120 ms)' : (meas.qrs >= 110 ? ' · 110–119 ms' : '')),
         X + W - 24, Y + 5.2, 3.2, meas.qrs >= 120 ? RED : (meas.qrs >= 110 ? '#c06a00' : GREEN), 700, 'right');


    var gap = 2.4, bw = (W - 6 - 5 * gap) / 6, by = Y + 8.5, bh = H - 11, MMPS = 125, pre = 0.05;
    /* Ausschlag so gross wie moeglich, in allen sechs Feldern gleich. */
    var hi = 0.1, lo = 0.1, j0 = idx(b.on - pre), j1 = idx(b.on - pre + bw / MMPS);
    LUPE.forEach(function (L) {
      for (var j = j0; j <= j1; j++) {
        var v = data.leads[L][j];
        if (v > hi) hi = v;
        if (-v > lo) lo = -v;
      }
    });
    var G = Math.floor(Math.max(6, Math.min(20, (bh - 13) / (hi + lo))));
    var base = by + 7 + hi * G + (bh - 13 - (hi + lo) * G) / 2;
    text(G + ' mm/mV', X + W - 3, Y + 5.2, 2.5, '#444', 400, 'right');
    LUPE.forEach(function (L, k) {
      var bx = X + 3 + k * (bw + gap);
      ctx.save();
      ctx.beginPath(); ctx.rect(px(bx), px(by), px(bw), px(bh)); ctx.clip();
      ctx.fillStyle = '#fffaf7'; ctx.fillRect(px(bx), px(by), px(bw), px(bh));
      grid(bx, by, bw, bh, 5, 1);
      var a = b.on - pre, z = a + bw / MMPS;
      var xOn = bx + pre * MMPS, xOff = bx + (b.off - a) * MMPS;
      var o = meas.oup[L], lim = OUP_LIMIT[L];
      var late = o && lim !== undefined && o.ms > lim;
      if (o) {
        var xo = bx + (o.t - a) * MMPS;
        ctx.fillStyle = lim === undefined ? 'rgba(21, 101, 192, 0.10)'
                      : (late ? 'rgba(216, 27, 27, 0.16)' : 'rgba(27, 138, 58, 0.14)');
        ctx.fillRect(px(xOn), px(by), px(xo - xOn), px(bh));
      }
      ctx.strokeStyle = BLUE; ctx.lineWidth = Math.max(1.2, S * 0.24);
      ctx.setLineDash([px(1), px(0.8)]);
      ctx.beginPath(); ctx.moveTo(px(xOn), px(by)); ctx.lineTo(px(xOn), px(by + bh));
      ctx.moveTo(px(xOff), px(by)); ctx.lineTo(px(xOff), px(by + bh)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.4, S * 0.36);
      ctx.lineJoin = 'round';
      trace(L, a, z, bx, base, MMPS, G, 0);
      if (o) {
        var xp = bx + (o.t - a) * MMPS, yp = base - o.v * G;
        var oc = lim === undefined ? '#333' : (late ? RED : GREEN);
        ctx.strokeStyle = oc; ctx.lineWidth = Math.max(1.4, S * 0.3);
        ctx.beginPath(); ctx.moveTo(px(xp), px(by)); ctx.lineTo(px(xp), px(by + bh)); ctx.stroke();
        ctx.fillStyle = oc;
        ctx.beginPath(); ctx.arc(px(xp), px(yp), Math.max(3, S * 0.8), 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = '#777'; ctx.lineWidth = 1;
      ctx.strokeRect(px(bx) + 0.5, px(by) + 0.5, px(bw), px(bh));

      /* Beschriftung: Ableitung links oben, Messwert rechts oben */
      ctx.fillStyle = 'rgba(255,255,255,.88)';
      ctx.fillRect(px(bx + 0.6), px(by + 0.6), px(9), px(4.6));
      text(Engine.LEADS[L], bx + 1.4, by + 4.2, 3.2, '#15151a', 700);
      var lab = o ? 'OUP ' + o.ms + ' ms' : 'kein R (QS)';
      var col = !o ? '#555' : (lim === undefined ? '#15151a' : (late ? RED : GREEN));
      ctx.font = '700 ' + Math.max(8, px(2.9)) + 'px "Helvetica Neue", Helvetica, Arial, sans-serif';
      var tw = ctx.measureText(lab).width / S;
      ctx.fillStyle = 'rgba(255,255,255,.88)';
      ctx.fillRect(px(bx + bw - tw - 2.2), px(by + 0.6), px(tw + 1.8), px(4.6));
      text(lab, bx + bw - 1.2, by + 4.2, 2.9, col, 700, 'right');
      if (lim !== undefined) {
        var hint = OUP_HINT[L] +
                   (o ? (late ? '  → verspätet' : '') : '');
        ctx.font = '600 ' + Math.max(8, px(2.3)) + 'px "Helvetica Neue", Helvetica, Arial, sans-serif';
        var hw = ctx.measureText(hint).width / S;
        ctx.fillStyle = 'rgba(255,255,255,.88)';
        ctx.fillRect(px(bx + bw - hw - 2.2), px(by + bh - 4.6), px(hw + 1.8), px(4));
        text(hint, bx + bw - 1.2, by + bh - 1.6, 2.3, late ? RED : '#444', 600, 'right');
      }
    });
  }

  /* ---------- Overlay: Kriterien ---------- */

  var KGREEN = '#12a150';
  function col(bad) { return bad ? RED : GREEN; }

  /* Der normale Schlag in Ableitung L, mit seinem QRS-Beginn auf dem des
     Vergleichsschlags. a..z = gezeigter Zeitraum des Blatts. */
  function refTrace(L, a, z, x0, y0, mmps, gain, lim) {
    if (!ref) return;
    var x = ref.d.leads[L], fs = ref.d.fs, sh = K.tA - ref.b.on, first = true, i;
    var i0 = Math.max(0, Math.round((ref.b.on - 0.24) * fs));
    var i1 = Math.min(ref.d.n - 1, Math.round((ref.b.tend + 0.05) * fs));
    ctx.beginPath();
    for (i = i0; i <= i1; i++) {
      var ts = i / fs + sh;
      if (ts < a || ts > z) continue;
      var d = x[i] * gain;
      if (lim) d = Math.max(-lim, Math.min(lim, d));
      var X = px(x0 + (ts - a) * mmps), Y = px(y0 - d);
      if (first) { ctx.moveTo(X, Y); first = false; } else ctx.lineTo(X, Y);
    }
    ctx.stroke();
  }

  /* Beschriftung mit hellem Grund, damit sie auf Kurve und Raster lesbar bleibt */
  function tag(t, x, y, size, c, align, weight) {
    var w = twid(t, size, weight || 700);
    var x0 = align === 'right' ? x - w : (align === 'center' ? x - w / 2 : x);
    ctx.fillStyle = 'rgba(255,255,255,.88)';
    ctx.fillRect(px(x0 - 0.5), px(y - size * 0.95), px(w + 1), px(size * 1.25));
    text(t, x, y, size, c, weight || 700, align);
  }
  /* Messstrecke mit Endstrichen */
  function bar(x1, x2, y, c) {
    ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.5, S * 0.34); ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(px(x1), px(y)); ctx.lineTo(px(x2), px(y));
    ctx.moveTo(px(x1), px(y - 1.2)); ctx.lineTo(px(x1), px(y + 1.2));
    ctx.moveTo(px(x2), px(y - 1.2)); ctx.lineTo(px(x2), px(y + 1.2));
    ctx.stroke();
  }
  /* Dreieck, Spitze nach unten auf (x, y) */
  function tri(x, y, c, s) {
    s = s || 1.5;
    ctx.fillStyle = c; ctx.beginPath();
    ctx.moveTo(px(x), px(y));
    ctx.lineTo(px(x - s * 0.7), px(y - s * 1.3)); ctx.lineTo(px(x + s * 0.7), px(y - s * 1.3));
    ctx.closePath(); ctx.fill();
  }
  function fmm(v) { return (v >= 0 ? '+' : '\u2212') + Math.abs(v * 10).toFixed(1).replace('.', ','); }

  /* Markierungen auf dem Blatt: Zeiten unter Ableitung II, Baender durch
     alle Zeilen, ST-Strecke in jeder Ableitung. */
  function kritMarks() {
    var a = K.anchor, sh = K.sheet, x0 = COLX[0], yII = ROW0 + PITCH, yb = yII + 7.6, c, r, i;
    var vis = data.beats.filter(function (b) { return b.t > 0.02 && b.t < SEC - 0.02; });
    var top = ROW0 - 12, bot = ROW0 + 5 * PITCH + 10;
    function band(b, label, bad) {
      for (var k = 0; k < 2; k++) {
        var xa = COLX[k] + Math.max(0, b.on) * SPEED, xz = COLX[k] + Math.min(SEC, b.off) * SPEED;
        ctx.fillStyle = bad ? 'rgba(216, 27, 27, 0.14)' : 'rgba(27, 138, 58, 0.12)';
        ctx.fillRect(px(xa), px(top), px(xz - xa), px(bot - top));
        if (label) tag(label, (xa + xz) / 2, top + 0.6, 2.4, col(bad), 'center');
      }
    }
    function cap(t, y) { text(t, x0 - 9.6, y + 0.8, 2.1, RED, 700); }

    if (sh.ves) vis.forEach(function (b) { if (b.lab === 'V') band(b, 'VES', true); });
    if (sh.sves) vis.forEach(function (b) { if (b.lab === 'S') band(b, 'SVES', true); });
    if (sh.qrsband && a) band(a, 'QRS ' + a.qrs + ' ms', a.qrs >= 110);

    if (sh.pq) {
      cap('PQ ms', yb);
      vis.forEach(function (b) {
        if (b.pq === null || b.p.on < 0) return;
        var bad = b.pq > 200 || b.pq < 120;
        bar(x0 + b.p.on * SPEED, x0 + b.on * SPEED, yb, col(bad));
        tag(String(b.pq), x0 + (b.p.on + b.on) / 2 * SPEED, yb + 3.7, 2.3, col(bad), 'center');
      });
    }
    if (sh.pblk) data.ps.forEach(function (p) {
      if (p.used || p.t < 0.08 || p.t > SEC - 0.08) return;
      var X = x0 + p.t * SPEED, Y = yII - data.leads[1][idx(p.t)] * GAIN;
      ctx.strokeStyle = RED; ctx.lineWidth = Math.max(1.5, S * 0.34);
      ctx.beginPath(); ctx.arc(px(X), px(Y), px(2.4), 0, 2 * Math.PI); ctx.stroke();
      tag('kein QRS', X, yb + 3.7, 2.3, RED, 'center');
    });
    if (sh.pall) {
      cap('P', yII - 6.2);
      data.ps.forEach(function (p) {
        if (p.t < 0.04 || p.t > SEC - 0.04) return;
        tri(x0 + p.t * SPEED, yII - 3.6, RED, 1.6);
      });
    }
    if (sh.rr) {
      var two = sh.pq || sh.qt, y2 = yb + (two ? 5.6 : 0);
      /* In der zweiten Zeile steht links schon der Name der naechsten Ableitung */
      if (!two) cap('RR ms', y2);
      else if (vis.length && vis[0].t * SPEED > 8.5)
        text('RR ms', x0 + vis[0].t * SPEED - 1.6, y2 + 0.8, 2.1, RED, 700, 'right');
      for (i = 1; i < vis.length; i++) {
        var t1 = vis[i - 1].t, t2 = vis[i].t;
        bar(x0 + t1 * SPEED, x0 + t2 * SPEED, y2, RED);
        if ((t2 - t1) * SPEED > 6.5)
          tag(String(Math.round((t2 - t1) * 1000)), x0 + (t1 + t2) / 2 * SPEED, y2 + 3.7, 2.3, RED, 'center');
      }
    }
    if (sh.qt && a && a.tend !== null) {
      var bq = a.qtc !== null && a.qtc > K.c.qtLim;
      if (!sh.pq) cap('QT ms', yb);
      bar(x0 + a.on * SPEED, x0 + a.tend * SPEED, yb, col(bq));
      tag((sh.pq ? 'QT ' : '') + a.qtms, x0 + (a.on + a.tend) / 2 * SPEED, yb + 3.7, 2.3, col(bq), 'center');
    }
    /* J-Welle und U-Welle: Dreieck ueber dem Gipfel in jeder Ableitung, in
       der sie mindestens 0,5 mm hoch ist */
    [['j', 'J', K.jv, a && a.j], ['u', 'U', K.uv, a && a.u]].forEach(function (w) {
      if (!sh[w[0]] || !w[2] || w[3] === null || w[3] === undefined) return;
      for (var cc = 0; cc < 2; cc++) for (var rr = 0; rr < 6; rr++) {
        var Lw = cc * 6 + rr, vw = w[2][Lw];
        if (vw < 0.05) continue;
        var xw = COLX[cc] + w[3] * SPEED, yw = ROW0 + rr * PITCH - data.leads[Lw][idx(w[3])] * GAIN;
        tri(xw, yw - 1.2, RED, 1.3);
        tag(w[1], xw, yw - 3.9, 2.2, RED, 'center');
      }
    });
    if (sh.st && a && K.st) for (c = 0; c < 2; c++) for (r = 0; r < 6; r++) {
      var Lx = c * 6 + r, v = K.st[Lx], y0 = ROW0 + r * PITCH, xx = COLX[c];
      if (Math.abs(v) < 0.045) continue;
      var bl = data.leads[Lx][idx(a.on - 0.02)], tj = a.off + 0.04;
      var yB = y0 - bl * GAIN, yJ = y0 - (bl + v) * GAIN, xj = xx + tj * SPEED;
      ctx.strokeStyle = GREEN; ctx.lineWidth = Math.max(1.2, S * 0.26);
      ctx.setLineDash([px(0.9), px(0.7)]);
      ctx.beginPath(); ctx.moveTo(px(xx + (a.on - 0.10) * SPEED), px(yB));
      ctx.lineTo(px(xj + 4.5), px(yB)); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = RED; ctx.lineWidth = Math.max(2, S * 0.5);
      ctx.beginPath(); ctx.moveTo(px(xj), px(yB)); ctx.lineTo(px(xj), px(yJ)); ctx.stroke();
      /* Mit U- oder J-Welle steht der Wert unter der Kurve, sonst verdeckt er sie */
      if ((sh.u || sh.j) && v < 0) tag(fmm(v), xj + 1.2, yJ + 3.4, 2.3, RED, 'left');
      else tag(fmm(v), xj + 5.2, yB + (v > 0 ? 2.6 : -0.6), 2.3, RED, 'left');
    }
  }

  /* Umbruch auf eine Breite in Millimetern */
  function wrap(str, size, weight, maxW) {
    font(size, weight);
    var lines = [], cur = '';
    str.split(' ').forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (cur && ctx.measureText(t).width / S > maxW) { lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }

  /* Die Kriterien als Text. Passt nicht alles, wird die Schrift kleiner. */
  function kritText(X, Y, W, H) {
    var f, ops, y;
    for (f = 1.5; f >= 0.6; f -= 0.05) {
      ops = []; y = 0;
      var hs = 3.1 * f, ls = 2.75 * f, lh = ls * 1.36;
      K.sections.forEach(function (sec, si) {
        if (si) y += lh * 0.45;
        y += hs * 1.2; ops.push({ k: 'h', t: sec.h, y: y, s: hs });
        y += lh * 0.12;
        sec.lines.forEach(function (ln) {
          var ws = wrap(ln.t, ls, 400, W - 4);
          ws.forEach(function (w, wi) { y += lh; ops.push({ k: wi ? 'c' : 'l', t: w, y: y, s: ls }); });
          if (ln.v) {
            var vt = '\u2192 ' + ln.v, wl = twid(ws[ws.length - 1], ls, 400), wv = twid(vt, ls, 700);
            if (wl + 2 + wv <= W - 4) ops.push({ k: 'v', t: vt, y: y, x: 4 + wl + 2, s: ls, bad: ln.bad });
            else { y += lh; ops.push({ k: 'v', t: vt, y: y, x: 4, s: ls, bad: ln.bad }); }
          }
          y += lh * 0.14;
        });
      });
      if (y <= H) break;
    }
    ops.forEach(function (o) {
      if (o.k === 'h') text(o.t, X, Y + o.y, o.s, '#15151a', 700);
      else if (o.k === 'v') text(o.t, X + o.x, Y + o.y, o.s, col(o.bad), 700);
      else {
        if (o.k === 'l') text('\u2022', X + 0.9, Y + o.y, o.s, '#15151a', 700);
        text(o.t, X + 4, Y + o.y, o.s, '#15151a', 400);
      }
    });
  }

  /* Kriterienfeld: der Vergleichsschlag in drei Ableitungen bei 50 mm/s,
     darunter gruen der normale Schlag, rot die Messstrecken; rechts die
     Kriterien mit dem gemessenen Wert. */
  function kritPanel() {
    var a = K.anchor, bm = K.box;
    var X = 4, Y = GRID_Y + GRID_H + 2, W = MM_W - 8, H = KRIT_H - 5;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = px(2.5); ctx.shadowOffsetY = px(0.6);
    ctx.fillStyle = 'rgba(255,255,255,0.97)';
    ctx.fillRect(px(X), px(Y), px(W), px(H));
    ctx.restore();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.strokeRect(px(X) + 0.5, px(Y) + 0.5, px(W), px(H));

    var gap = 2.4, bw = 50, by = Y + 8.5, bh = H - 11, MMPS = 50;
    var pre = Math.max(0.30, Math.min(0.42, ((a && a.pq) ? a.pq / 1000 : 0.17) + 0.09));
    var t0 = K.tA - pre, t1 = t0 + bw / MMPS, j;
    /* Ausschlag so gross wie moeglich, in allen drei Feldern gleich */
    var hi = 0.1, lo = 0.1;
    K.leads.forEach(function (L) {
      var x = data.leads[L];
      for (j = idx(t0); j <= idx(t1); j++) { if (x[j] > hi) hi = x[j]; if (-x[j] > lo) lo = -x[j]; }
      if (!ref) return;
      x = ref.d.leads[L];
      for (j = Math.round((ref.b.on - 0.24) * ref.d.fs); j <= Math.round((ref.b.tend + 0.05) * ref.d.fs); j++) {
        if (x[j] > hi) hi = x[j]; if (-x[j] > lo) lo = -x[j];
      }
    });
    var room = bh - 22;
    var G = Math.floor(Math.max(4, Math.min(20, room / (hi + lo))));
    var base = by + 10 + hi * G + Math.max(0, room - (hi + lo) * G) / 2;

    text('Kriterien', X + 3, Y + 5.2, 3.2, '#15151a', 700);
    text('50 mm/s  ·  ein großes Kästchen = 100 ms  ·  ' + G + ' mm/mV', X + 24, Y + 5.2, 2.5, '#444');
    /* Legende ueber der Textspalte */
    var TX = X + 3 + 3 * bw + 2 * gap + 4, lx = TX;
    function leg(c, lw, label) {
      ctx.strokeStyle = c; ctx.lineWidth = Math.max(1.4, S * lw);
      ctx.beginPath(); ctx.moveTo(px(lx), px(Y + 4.3)); ctx.lineTo(px(lx + 7), px(Y + 4.3)); ctx.stroke();
      text(label, lx + 8.2, Y + 5.2, 2.5, '#444');
      lx += 8.2 + twid(label, 2.5) + 4.5;
    }
    leg(KGREEN, 0.8, 'normaler Schlag' + (ref ? ' (' + ref.hr + '/min)' : ''));
    leg('#111', 0.36, 'dieses EKG');
    leg(RED, 0.5, 'auffällig');

    K.leads.forEach(function (L, k) {
      var bx = X + 3 + k * (bw + gap);
      function tx(t) { return bx + (t - t0) * MMPS; }
      function vy(v) { return base - v * G; }
      function val(t) { return data.leads[L][idx(t)]; }
      ctx.save();
      ctx.beginPath(); ctx.rect(px(bx), px(by), px(bw), px(bh)); ctx.clip();
      ctx.fillStyle = '#fffaf7'; ctx.fillRect(px(bx), px(by), px(bw), px(bh));
      grid(bx, by, bw, bh, 5, 1);
      if (a) {
        ctx.strokeStyle = 'rgba(21, 101, 192, .75)'; ctx.lineWidth = Math.max(1, S * 0.2);
        ctx.setLineDash([px(1), px(0.8)]);
        ctx.beginPath(); ctx.moveTo(px(tx(a.on)), px(by)); ctx.lineTo(px(tx(a.on)), px(by + bh));
        ctx.moveTo(px(tx(a.off)), px(by)); ctx.lineTo(px(tx(a.off)), px(by + bh)); ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.strokeStyle = KGREEN; ctx.lineWidth = Math.max(3, S * 0.85); ctx.globalAlpha = 0.85;
      refTrace(L, t0, t1, bx, base, MMPS, G, 0);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(1.4, S * 0.36);
      trace(L, t0, t1, bx, base, MMPS, G, 0);

      /* ST-Strecke gegen die PQ-Strecke */
      if (bm.st && a && K.st) {
        var v = K.st[L], bl = val(a.on - 0.02), tj = a.off + 0.04;
        ctx.strokeStyle = GREEN; ctx.lineWidth = Math.max(1.3, S * 0.3);
        ctx.setLineDash([px(1.2), px(0.9)]);
        ctx.beginPath(); ctx.moveTo(px(tx(a.on - 0.14)), px(vy(bl)));
        ctx.lineTo(px(tx(tj + 0.22)), px(vy(bl))); ctx.stroke(); ctx.setLineDash([]);
        if (Math.abs(v) >= 0.045) {
          ctx.strokeStyle = RED; ctx.lineWidth = Math.max(2.2, S * 0.6);
          ctx.beginPath(); ctx.moveTo(px(tx(tj)), px(vy(bl))); ctx.lineTo(px(tx(tj)), px(vy(bl + v))); ctx.stroke();
          tag('ST ' + fmm(v) + ' mm', tx(tj) + 1.6, vy(bl) + (v > 0 ? 3.6 : -1.2), 2.6, RED, 'left');
        } else tag('ST \u00b10', tx(tj) + 1.6, vy(bl) + 3.6, 2.6, GREEN, 'left');
      }
      /* oberer Umschlagpunkt in den Ableitungen, in denen er zaehlt */
      if (bm.oup && a && OUP_LIMIT[L] !== undefined && K.c.oup[L]) {
        var o = K.c.oup[L], late = o.ms > OUP_LIMIT[L];
        ctx.fillStyle = col(late);
        ctx.beginPath(); ctx.arc(px(tx(o.t)), px(vy(o.v)), Math.max(3, S * 0.8), 0, 2 * Math.PI); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.stroke();
        tag('OUP ' + o.ms + ' ms', tx(o.t) + 2, vy(o.v) + (vy(o.v) - by < 14 ? 3.4 : -0.4), 2.6, col(late), 'left');
      }
      if (bm.u && a && a.u !== null) {
        tri(tx(a.u), vy(val(a.u)) - 1, RED, 1.7);
        tag('U' + (K.uv && K.uv[L] >= 0.05 ? ' ' + fmm(K.uv[L]) : ''), tx(a.u), vy(val(a.u)) - 4.2, 2.6, RED, 'center');
      }
      if (bm.j && a && a.j !== null && K.jv && K.jv[L] >= 0.03) {
        tri(tx(a.j), vy(val(a.j)) - 1, RED, 1.7);
        tag('J ' + fmm(K.jv[L]) + ' mm', tx(a.j) + 1.8, vy(val(a.j)) - 3.6, 2.6, RED, 'left');
      }
      if (bm.rp && a && a.rp !== null) {
        tri(tx(a.rp), vy(val(a.rp)) - 1, RED, 1.7);
        tag('P\u2032', tx(a.rp), vy(val(a.rp)) - 4.2, 2.6, RED, 'center');
      }
      if (bm.pall) data.ps.forEach(function (p) {
        if (p.t < t0 + 0.03 || p.t > t1 - 0.03) return;
        tri(tx(p.t), vy(val(p.t)) - 1, RED, 1.7);
        tag('P', tx(p.t), vy(val(p.t)) - 4.2, 2.6, RED, 'center');
      });
      if (bm.spike) {
        var sp = [];
        data.ps.forEach(function (p) { if (p.pace) sp.push(p.t); });
        data.beats.forEach(function (b) { if (b.pace) sp.push(b.t + 0.002); });
        sp.forEach(function (t) {
          if (t < t0 + 0.02 || t > t1 - 0.02) return;
          tri(tx(t), by + 16, RED, 1.7);
          if (k === 0) tag('Spike', tx(t), by + 12.6, 2.4, RED, 'center');
        });
      }
      /* Zeiten und Hinweise nur im ersten Feld – sie gelten fuer alle */
      if (k === 0 && a) {
        if (bm.t && a.tp !== null && K.tw) {
          /* hohes T: Hinweis neben dem Gipfel, sonst unter der Kurve –
             darueber stehen QRS-Breite und ST-Strecke */
          var yt = vy(val(a.tp));
          if (K.tw === 'T hoch') {
            tri(tx(a.tp), yt - 1, RED, 1.7);
            tag(K.tw, tx(a.tp) + 2.4, yt + 0.6, 2.6, RED, 'left');
          } else {
            tri(tx(a.tp), yt + 1, RED, -1.7);
            tag(K.tw, tx(a.tp), yt + 6, 2.6, RED, 'center');
          }
        }
        if (bm.nop) {
          var yn = vy(val(a.on - 0.03)) - 3.2;
          bar(tx(a.on - 0.21), tx(a.on - 0.03), yn, RED);
          tag('keine P-Welle', tx(a.on - 0.12), yn - 1.6, 2.5, RED, 'center');
        }
        if (bm.qrs) {
          bar(tx(a.on), tx(a.off), by + 7.6, col(a.qrs >= 110));
          tag('QRS ' + a.qrs + ' ms', tx(a.off) + 1.5, by + 8.5, 2.6, col(a.qrs >= 110), 'left');
        }
        var yq = by + bh - 7.5;
        if (bm.pq && a.pq !== null) {
          var pb = a.pq > 200 || a.pq < 120;
          bar(tx(a.p.on), tx(a.on), yq, col(pb));
          tag('PQ ' + a.pq + ' ms', tx(a.on) - 0.8, yq + 4.2, 2.6, col(pb), 'right');
        }
        if (bm.qt && a.tend !== null) {
          var qb = a.qtc !== null && a.qtc > K.c.qtLim;
          bar(tx(a.on), tx(a.tend), yq, col(qb));
          tag('QT ' + a.qtms + '  ·  QTc ' + (a.qtc === null ? '–' : a.qtc) + ' ms', tx(a.on) + 0.8, yq + 4.2, 2.6, col(qb), 'left');
        }
      }
      ctx.restore();
      ctx.strokeStyle = '#777'; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.strokeRect(px(bx) + 0.5, px(by) + 0.5, px(bw), px(bh));
      ctx.fillStyle = 'rgba(255,255,255,.88)';
      ctx.fillRect(px(bx + 0.6), px(by + 0.6), px(9), px(4.6));
      text(Engine.LEADS[L], bx + 1.4, by + 4.2, 3.2, '#15151a', 700);
    });

    kritText(TX, by - 1.5, X + W - 3 - TX, bh + 2.5);
  }

  function draw() {
    if (!root || !data) return;
    var wrap = root.querySelector('.ekgPaper');
    var aw = wrap.clientWidth, ah = wrap.clientHeight;
    if (aw < 50 || ah < 50) return;
    MM_H = 162 + extra();
    S = Math.min(aw / MM_W, ah / MM_H);
    var dpr = global.devicePixelRatio || 1;
    cv.style.width = Math.floor(MM_W * S) + 'px';
    cv.style.height = Math.floor(MM_H * S) + 'px';
    cv.width = Math.floor(MM_W * S * dpr);
    cv.height = Math.floor(MM_H * S * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    sheet();
    if (overlay) { marks(); lupe(); }
    else if (krit && K) { kritMarks(); kritPanel(); }
  }

  /* ---------- Fenster ---------- */

  function build() {
    root = document.createElement('div');
    root.id = 'ekgOverlay';
    root.innerHTML =
      '<div class="ekgSheet">' +
        '<div class="ekgBar">' +
          '<span class="ekgTtl">12-Kanal-EKG</span>' +
          '<button id="ekgOv" title="Taste U">Umschlagpunkte zeigen</button>' +
          '<button id="ekgNm" title="Taste R">Rhythmus zeigen</button>' +
          '<button id="ekgKr" title="Taste K">Kriterien zeigen</button>' +
          '<button id="ekgNew">Neu schreiben</button>' +
          '<span class="ekgSp"></span>' +
          '<button id="ekgClose">Schließen</button>' +
        '</div>' +
        '<div class="ekgPaper"><canvas></canvas></div>' +
      '</div>';
    document.body.appendChild(root);
    cv = root.querySelector('canvas');
    ctx = cv.getContext('2d');
    root.querySelector('#ekgOv').onclick = function () { host.command('ecg12:overlay'); };
    root.querySelector('#ekgNm').onclick = function () { host.command('ecg12:name'); };
    root.querySelector('#ekgKr').onclick = function () { host.command('ecg12:krit'); };
    root.querySelector('#ekgNew').onclick = function () { host.command('ecg12:new'); };
    root.querySelector('#ekgClose').onclick = function () { host.command('ecg12:close'); };
    global.addEventListener('resize', function () { if (isOpen()) draw(); });
    /* Vollbild und Fensterwechsel aendern die Flaeche, ohne dass immer ein
       resize-Ereignis kommt. */
    if (global.ResizeObserver) {
      var lw = 0, lh = 0;
      new ResizeObserver(function () {
        var w = root.querySelector('.ekgPaper');
        if (!isOpen() || (w.clientWidth === lw && w.clientHeight === lh)) return;
        lw = w.clientWidth; lh = w.clientHeight;
        draw();
      }).observe(root);
    }
  }

  function isOpen() { return !!root && root.style.display === 'flex'; }

  function syncBtn() {
    if (!root) return;
    var b = root.querySelector('#ekgOv');
    b.classList.toggle('on', overlay);
    b.textContent = overlay ? 'Umschlagpunkte ausblenden' : 'Umschlagpunkte zeigen';
    b = root.querySelector('#ekgNm');
    b.classList.toggle('on', nameOn);
    b.textContent = nameOn ? 'Rhythmus ausblenden' : 'Rhythmus zeigen';
    b = root.querySelector('#ekgKr');
    b.classList.toggle('on', krit);
    b.textContent = krit ? 'Kriterien ausblenden' : 'Kriterien zeigen';
  }

  /* p = { state, seed, at, ov, nm, kr } – die drei Schalter reisen mit, damit
     ein spaeter geoeffnetes Fenster dasselbe zeigt. */
  function show(p) {
    if (!root) build();
    payload = p;
    data = Engine.write12(p.state, p.seed, 10);
    meas = measure();
    K = global.EKGKRIT ? global.EKGKRIT.build(data, meas, oup) : null;
    ref = K ? reference(K.refHr) : null;
    if (p.ov !== undefined) overlay = !!p.ov;
    if (p.nm !== undefined) nameOn = !!p.nm;
    if (p.kr !== undefined) krit = !!p.kr && !overlay;
    root.style.display = 'flex';
    syncBtn();
    draw();
  }
  function hide() { if (root) root.style.display = 'none'; }
  /* Lupe und Kriterienfeld teilen sich den Platz unter dem Blatt: Es ist
     immer nur eines von beiden offen. */
  function setOverlay(on) { overlay = !!on; if (overlay) krit = false; syncBtn(); if (isOpen()) draw(); }
  function setKrit(on) { krit = !!on; if (krit) overlay = false; syncBtn(); if (isOpen()) draw(); }
  function setName(on) { nameOn = !!on; syncBtn(); if (isOpen()) draw(); }

  global.EKG12 = {
    init: function (h) { host = h; },
    show: show, hide: hide, isOpen: isOpen, setOverlay: setOverlay,
    setName: setName, setKrit: setKrit,
    _krit: function () { return K; },
    /* fuer Pruefungen von aussen */
    _data: function () { return data; }, _meas: function () { return meas; }
  };
})(window);
