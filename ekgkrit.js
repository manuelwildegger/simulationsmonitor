/* ekgkrit.js – Kriterienkatalog fuer das 12-Kanal-EKG.

   Aus dem geschriebenen EKG und dem Zustand entsteht hier, was das Blatt auf
   Wunsch zeigt:
     name      der eingestellte Rhythmus mit Block und Besonderheiten
     sections  die Kriterien als Text, je mit dem hier gemessenen Wert
     sheet     Markierungen auf dem Blatt (Ableitung II und Baender)
     box       Markierungen in den drei vergroesserten Feldern
     leads     die drei Ableitungen, an denen man es am besten sieht
     anchor    der Schlag, ueber den der normale Komplex gelegt wird

   Gezeichnet wird in ekg12.js. Hier steht nur, was gilt und was gemessen
   wurde – wer ein Kriterium aendern will, aendert es in diesem Katalog.

   Schenkel- und Faszikelbloecke nach fokus-ekg.de (AHA/ACCF/HRS 2009),
   ST-Hebung nach der vierten universellen Infarktdefinition (ESC 2018). */
(function (global) {
  'use strict';

  var SEC = 5;

  /* Eine Zeile: Kriterium, dahinter der gemessene Wert. bad = auffaellig
     (rot), sonst im Normbereich (gruen). */
  function L(t, v, bad) {
    return { t: t, v: (v === null || v === undefined || v === '') ? null : String(v), bad: bad !== false };
  }
  function ms(x) { return (x === null || x === undefined) ? '–' : x + ' ms'; }
  function mm(v) { return (v >= 0 ? '+' : '−') + Math.abs(v * 10).toFixed(1).replace('.', ',') + ' mm'; }
  function axis(a) { return a === null || a === undefined ? '–' : (a > 0 ? '+' : (a < 0 ? '−' : '')) + Math.abs(a) + '°'; }

  /* ---------- Rhythmen ---------- */

  /* a = Schlag fuer den Vergleich: V breiter Schlag, S supraventrikulaere
     Extrasystole, maxpq = laengste PQ-Zeit; ohne Angabe ein schmaler
     Eigenschlag.  s = Markierungen auf dem Blatt, b = in den Feldern,
     l = Ableitungen der Felder, k = Kriterien. */
  var SIN_P = 'Vor jedem QRS eine P-Welle, in II positiv';
  function pqLine(c) { return L('PQ-Zeit 120–200 ms und bei jedem Schlag gleich', 'hier ' + ms(c.pq), c.pqBad); }
  function qrsNarrow(c) { return L('QRS schmal, unter 120 ms', 'hier ' + ms(c.qrs), c.qrs >= 110); }
  function qrsWide(c, t) { return L(t || 'QRS breit und verformt, ab 120 ms', c.qrs === null ? null : 'hier ' + ms(c.qrs), true); }
  function rate(c, t, bad) { return L(t, 'hier ' + (c.hr === null ? '–' : c.hr + '/min'), bad); }
  function rrRange(c, t) {
    return L(t, c.rrMin === null ? null : 'hier ' + c.rrMin + '–' + c.rrMax + ' ms', true);
  }
  var VES = [
    function (c) { return qrsWide(c, 'VES: fällt vorzeitig ein, QRS breit und verformt (ab 120 ms)'); },
    function () { return L('Keine P-Welle davor, ST und T gegensinnig zum QRS'); }
  ];

  var R = {
    sinus: { s: 'pq', b: 'pq qrs', k: function (c) { return [
      rate(c, 'Regelmäßig, 60–100/min', c.hr < 60 || c.hr > 100),
      L(SIN_P), pqLine(c), qrsNarrow(c)]; } },
    sinusarrhythmie: { s: 'rr', b: 'pq qrs', k: function (c) { return [
      rrRange(c, 'RR-Abstände schwanken mit der Atmung um mehr als 10 %'),
      L('Sonst Sinusrhythmus: P vor jedem QRS, P immer gleich geformt'),
      pqLine(c), qrsNarrow(c)]; } },
    sinustachy: { s: 'rr', b: 'pq qrs', k: function (c) { return [
      rate(c, 'Sinusrhythmus mit mehr als 100/min', true),
      L('P vor jedem QRS – bei hoher Frequenz rückt P an die T-Welle davor'),
      pqLine(c), qrsNarrow(c)]; } },
    sinusbrady: { s: 'rr', b: 'pq qrs', k: function (c) { return [
      rate(c, 'Sinusrhythmus mit weniger als 60/min', true),
      L(SIN_P), pqLine(c), qrsNarrow(c)]; } },
    pea: { s: '', b: 'pq qrs', k: function () { return [
      L('Geordnete elektrische Aktivität, aber kein Auswurf: kein Puls, keine Druckkurve'),
      L('Das EKG allein zeigt die PEA nicht – Puls und arterielle Kurve prüfen'),
      L('Kreislaufstillstand, nicht defibrillierbar: Reanimation und Ursachensuche (4 H, HITS)')]; } },

    afib: { s: 'rr', b: 'nop qrs', l: [1, 2, 6], k: function (c) { return [
      rrRange(c, 'Absolute Arrhythmie: kein RR-Abstand gleicht dem anderen'),
      L('Keine P-Wellen – stattdessen eine unruhige Grundlinie (Flimmerwellen)'),
      qrsNarrow(c)]; } },
    aflutter: { s: '', b: 'qrs', l: [1, 2, 5], k: function (c) { return [
      L('Sägezahnförmige Flatterwellen um 300/min in II, III, aVF – keine ruhige Grundlinie'),
      rate(c, 'Regelmäßige Überleitung, hier 2:1: Kammerfrequenz um 150/min', true),
      qrsNarrow(c)]; } },
    svt: { s: '', b: 'nop qrs', k: function (c) { return [
      rate(c, 'Regelmäßige Tachykardie, meist 150–250/min', true),
      qrsNarrow(c),
      L('Keine P-Wellen abgrenzbar')]; } },
    avnrt: { s: '', b: 'rp qrs', l: [1, 5, 6], k: function (c) { return [
      rate(c, 'Regelmäßige Schmalkomplextachykardie, 150–250/min', true),
      L('Vorhöfe und Kammern werden fast gleichzeitig erregt: P′ steckt im Ende des QRS'),
      L('Pseudo-S in II, III, aVF und Pseudo-r′ in V1, RP-Abstand unter 70 ms', 'hier ' + ms(c.rp), true)]; } },
    avrt: { s: '', b: 'rp qrs', l: [1, 5, 6], k: function (c) { return [
      rate(c, 'Regelmäßige Schmalkomplextachykardie, 150–250/min', true),
      L('Die Erregung läuft über eine zusätzliche Bahn zurück in den Vorhof'),
      L('Negative P′-Welle abgesetzt hinter dem QRS in der ST-Strecke, RP-Abstand über 70 ms', 'hier ' + ms(c.rp), true)]; } },

    sves: { a: 'S', s: 'sves rr', b: 'pq qrs', k: function (c) { return [
      L('Ein Schlag fällt vorzeitig ein, QRS schmal wie bei den Normalschlägen', 'hier ' + ms(c.qrs), false),
      L('Davor eine P-Welle, die anders aussieht als die Sinus-P'),
      L('Pause danach nicht voll kompensatorisch: der Sinusknoten wird zurückgesetzt')]; } },
    sves_poly: { a: 'S', s: 'sves rr', b: 'pq qrs', k: function (c) { return [
      L('Schläge fallen vorzeitig ein, QRS schmal', 'hier ' + ms(c.qrs), false),
      L('P-Form und PQ-Zeit wechseln von Extrasystole zu Extrasystole: mehrere Ursprünge', 'hier PQ ' + ms(c.pq), true),
      L('Pause danach nicht voll kompensatorisch')]; } },

    vt_puls: { a: 'V', s: 'qrsband', b: 'qrs nop', k: function (c) { return [
      rate(c, 'Regelmäßige Tachykardie, meist 120–250/min', true),
      qrsWide(c, 'QRS breit, ab 120 ms'),
      L('Monomorph: alle Komplexe gleich, keine zugeordneten P-Wellen'),
      L('Mit Puls – bei Instabilität Kardioversion')]; } },
    vt_pulslos: { a: 'V', s: 'qrsband', b: 'qrs nop', k: function (c) { return [
      rate(c, 'Regelmäßige Tachykardie, meist 120–250/min', true),
      qrsWide(c, 'QRS breit, ab 120 ms'),
      L('Monomorph: alle Komplexe gleich, keine zugeordneten P-Wellen'),
      L('Ohne Puls: Kreislaufstillstand, defibrillierbar')]; } },
    torsade: { a: 'V', s: '', b: 'qrs', k: function (c) { return [
      rate(c, 'Polymorphe Kammertachykardie, 200–250/min', true),
      L('Die Ausschläge drehen sich um die Grundlinie und werden spindelförmig größer und kleiner'),
      L('Entsteht bei verlängerter QT-Zeit')]; } },
    longqt: { s: 'qt', b: 'qt pq', k: function (c) { return [
      L('QT-Zeit verlängert: QTc über 450 ms bei Männern, über 460 ms bei Frauen',
        'hier QT ' + ms(c.qt) + ', QTc ' + ms(c.qtc), true),
      L('Die T-Welle rückt weit nach hinten'),
      L('Gefahr: Torsade de Pointes')]; } },

    ves: { a: 'V', s: 'ves rr', b: 'qrs nop', k: function (c) { return [
      VES[0](c), VES[1](c),
      L('Immer dieselbe Form: ein Ursprung (monomorph)'),
      L('Danach kompensatorische Pause')]; } },
    ves_poly: { a: 'V', s: 'ves rr', b: 'qrs nop', k: function (c) { return [
      VES[0](c), VES[1](c),
      L('Verschiedene Formen: mehrere Ursprünge (polymorph)'),
      L('Danach kompensatorische Pause')]; } },
    bigeminus: { a: 'V', s: 'ves rr', b: 'qrs nop', k: function (c) { return [
      L('Auf jeden Normalschlag folgt eine VES'),
      VES[0](c), VES[1](c),
      L('Feste Kopplung an den Normalschlag, danach kompensatorische Pause')]; } },
    trigeminus: { a: 'V', s: 'ves rr', b: 'qrs nop', k: function (c) { return [
      L('Auf zwei Normalschläge folgt jeweils eine VES'),
      VES[0](c), VES[1](c),
      L('Danach kompensatorische Pause')]; } },
    couplet: { a: 'V', s: 'ves rr', b: 'qrs nop', k: function (c) { return [
      L('Zwei VES unmittelbar hintereinander (Couplet)'),
      VES[0](c), VES[1](c),
      L('Ab drei in Folge: Salve, nicht anhaltende VT')]; } },

    junktional: { s: 'rr', b: 'nop qrs', k: function (c) { return [
      rate(c, 'Regelmäßig, 40–60/min', true),
      L('Keine P-Welle vor dem QRS: Ersatzrhythmus aus dem AV-Knoten'),
      qrsNarrow(c)]; } },

    avb1: { s: 'pq', b: 'pq', k: function (c) { return [
      L('PQ-Zeit über 200 ms', 'hier ' + ms(c.pq), true),
      L('PQ-Zeit bei jedem Schlag gleich'),
      L('Jeder P-Welle folgt ein QRS – es fällt kein Schlag aus')]; } },
    avb2a: { a: 'maxpq', s: 'pq pblk', b: 'pq', k: function (c) { return [
      L('PQ-Zeit wird von Schlag zu Schlag länger', 'hier ' + c.pqSeq, true),
      L('bis eine P-Welle nicht übergeleitet wird: der QRS fällt aus'),
      L('Danach beginnt die Periodik mit kurzer PQ-Zeit neu')]; } },
    avb2b: { s: 'pq pblk', b: 'pq', k: function (c) { return [
      L('PQ-Zeit der übergeleiteten Schläge gleich', 'hier ' + ms(c.pq), false),
      L('Einzelne P-Wellen werden plötzlich nicht übergeleitet: der QRS fällt aus'),
      L('Gefahr: Übergang in den AV-Block III°')]; } },
    avb3: { s: 'pall', b: 'pall qrs', k: function (c) { return [
      L('Vorhöfe und Kammern schlagen unabhängig voneinander: P-Wellen ohne festen Bezug zum QRS'),
      L('P-Wellen regelmäßig und schneller als die Kammern',
        'hier Vorhof ' + (c.pRate || '–') + '/min, Kammer ' + (c.hr || '–') + '/min', true),
      qrsWide(c, 'Kammerersatzrhythmus: langsam, QRS breit')]; } },

    paced_aai: { s: '', b: 'spike pq qrs', k: function (c) { return [
      L('Schrittmacherimpuls (Spike) vor jeder P-Welle'),
      L('Übergeleitet wird über den eigenen AV-Knoten', 'hier PQ ' + ms(c.pq), c.pqBad),
      qrsNarrow(c)]; } },
    paced_vvi: { a: 'any', s: '', b: 'spike qrs', k: function (c) { return [
      L('Spike unmittelbar vor jedem QRS'),
      qrsWide(c, 'QRS breit und verformt, ähnlich einem Linksschenkelblock: die Erregung beginnt im rechten Ventrikel'),
      L('Kein fester Bezug zu P-Wellen')]; } },
    paced_ddd: { a: 'any', s: '', b: 'spike qrs', k: function (c) { return [
      L('Zwei Spikes: einer vor der P-Welle, einer vor dem QRS'),
      L('Dazwischen liegt die eingestellte AV-Zeit', 'hier ' + ms(c.av), false),
      qrsWide(c)]; } },

    vf_grob: { s: '', b: '', k: function () { return [
      L('Völlig ungeordnete Wellen, keine ruhige Grundlinie'),
      L('P-Wellen, QRS-Komplexe und T-Wellen sind nicht abzugrenzen'),
      L('Grobes Flimmern: hohe Ausschläge'),
      L('Kreislaufstillstand, defibrillierbar')]; } },
    vf_fein: { s: '', b: '', k: function () { return [
      L('Völlig ungeordnete Wellen, keine ruhige Grundlinie'),
      L('P-Wellen, QRS-Komplexe und T-Wellen sind nicht abzugrenzen'),
      L('Feines Flimmern: niedrige Ausschläge – nicht mit einer Asystolie verwechseln'),
      L('Kreislaufstillstand, defibrillierbar')]; } },
    asystolie: { s: '', b: '', k: function () { return [
      L('Nulllinie: keine Kammerkomplexe'),
      L('Vor der Diagnose Elektroden, Kabel und Verstärkung prüfen'),
      L('Kreislaufstillstand, nicht defibrillierbar')]; } },
    idioventrikulaer: { a: 'any', s: 'rr', b: 'qrs nop', k: function (c) { return [
      rate(c, 'Kammerersatzrhythmus: langsam, 20–40/min', true),
      qrsWide(c),
      L('Keine P-Wellen')]; } }
  };

  /* ---------- Schenkel- und Faszikelbloecke ---------- */

  function oupLine(c, lead, t, lim) {
    var o = c.oup[lead];
    return L(t, 'hier ' + (o ? ms(o.ms) : 'kein R'), !!o && o.ms > lim);
  }
  var B = {
    rsb: { l: [6, 0, 11], k: function (c) { return [
      L('QRS ab 120 ms', 'hier ' + ms(c.qrs), true),
      L('M-förmiger Komplex (rSR′) in V1 und V2'),
      oupLine(c, 6, 'Oberer Umschlagpunkt in V1 über 50 ms', 50),
      L('Breites, plumpes S in I, aVF, V5 und V6')]; } },
    irsb: { l: [6, 0, 11], k: function (c) { return [
      L('QRS 110–119 ms', 'hier ' + ms(c.qrs), true),
      L('rSr′ in V1 und V2, r′ plumper als r'),
      oupLine(c, 6, 'Oberer Umschlagpunkt in V1 über 50 ms', 50)]; } },
    lsb: { l: [6, 0, 11], k: function (c) { return [
      L('QRS ab 120 ms', 'hier ' + ms(c.qrs), true),
      L('Breites, gekerbtes R in I, aVL, V5, V6 – kein q'),
      oupLine(c, 11, 'Oberer Umschlagpunkt in V6 ab 60 ms', 59),
      L('Kleines r und tiefes S in V1–V3, ST und T gegensinnig zum QRS')]; } },
    ilsb: { l: [6, 0, 11], k: function (c) { return [
      L('QRS 110–119 ms', 'hier ' + ms(c.qrs), true),
      oupLine(c, 11, 'Oberer Umschlagpunkt in V6 ab 60 ms', 59),
      L('Kein q in I, V5 und V6')]; } },
    lahb: { l: [4, 1, 2], k: function (c) { return [
      L('Überdrehter Linkstyp: Achse −45° bis −90°', 'hier ' + axis(c.axis), true),
      L('qR in I und aVL, rS in II, III und aVF'),
      oupLine(c, 4, 'R-Gipfel in aVL nach mehr als 45 ms', 45),
      L('QRS unter 120 ms', 'hier ' + ms(c.qrs), false)]; } },
    lphb: { l: [0, 2, 5], k: function (c) { return [
      L('Rechtstyp: Achse +80° bis +120°', 'hier ' + axis(c.axis), true),
      L('rS in I und aVL, qR in III und aVF'),
      L('QRS unter 120 ms', 'hier ' + ms(c.qrs), false),
      L('Gilt nur, wenn keine Rechtsherzbelastung den Rechtstyp erklärt')]; } },
    rsb_lahb: { l: [6, 4, 2], k: function (c) { return [
      L('Rechtsschenkelblock: QRS ab 120 ms, rSR′ in V1', 'hier ' + ms(c.qrs), true),
      oupLine(c, 6, 'Oberer Umschlagpunkt in V1 über 50 ms', 50),
      L('Dazu LAFB: Achse −45° bis −90°, qR in aVL, rS in III', 'hier ' + axis(c.axis), true),
      L('Zwei der drei Faszikel leiten nicht: bifaszikulärer Block')]; } },
    rsb_lphb: { l: [6, 0, 2], k: function (c) { return [
      L('Rechtsschenkelblock: QRS ab 120 ms, rSR′ in V1', 'hier ' + ms(c.qrs), true),
      oupLine(c, 6, 'Oberer Umschlagpunkt in V1 über 50 ms', 50),
      L('Dazu LPFB: Achse +80° bis +120°, rS in I, qR in III', 'hier ' + axis(c.axis), true),
      L('Zwei der drei Faszikel leiten nicht: bifaszikulärer Block')]; } }
  };

  /* ---------- Aufbau ---------- */

  function build(data, meas, oupFn) {
    var st = data.state || {}, r = st.rhythm, LN = Engine.LEADS, i;
    function idx(t) { return Math.max(0, Math.min(data.n - 1, Math.round(t * data.fs))); }
    function val(l, t) { return data.leads[l][idx(t)]; }

    /* P-Wellen ihren Schlaegen zuordnen */
    data.ps.forEach(function (p) {
      p.used = false;
      p.on = p.t - 0.052 + (p.pace ? 0.022 : 0);
    });
    data.beats.forEach(function (b, k) {
      b.p = null; b.pq = null;
      b.qrs = Math.round((b.off - b.on) * 1000);
      if (b.hp) {
        var p = null;
        data.ps.forEach(function (x) { if (x.t < b.on - 0.02 && x.t > b.t - 0.6) p = x; });
        if (p) { b.p = p; p.used = true; b.pq = Math.round((b.on - p.on) * 1000); }
      }
      b.rr = k > 0 ? b.t - data.beats[k - 1].t
           : (data.beats.length > 1 ? data.beats[1].t - b.t : null);
      b.qtms = b.tend === null ? null : Math.round((b.tend - b.on) * 1000);
      /* QTc mit dem mittleren RR-Abstand (s. ekg12.js) */
      var rrm = meas.hr ? 60 / meas.hr : b.rr;
      b.qtc = (b.qtms && rrm && rrm > 0.2) ? Math.round(b.qtms / Math.sqrt(rrm)) : null;
    });
    var vis = data.beats.filter(function (b) { return b.t > 0.02 && b.t < SEC - 0.02; });

    /* Schlag fuer den Vergleich */
    function pick(f, score) {
      var pool = data.beats.filter(function (b) { return b.on > 0.5 && b.on < SEC - 0.75 && (!f || f(b)); });
      if (!pool.length)
        pool = data.beats.filter(function (b) { return b.on > 0.42 && b.on < SEC - 0.3 && (!f || f(b)); });
      if (!pool.length) return null;
      var best = pool[0];
      pool.forEach(function (b) {
        if (score ? score(b) > score(best) : Math.abs(b.on - 2.3) < Math.abs(best.on - 2.3)) best = b;
      });
      return best;
    }
    var def = R[r] || R.sinus, a = null;
    var nat = function (b) { return !b.wide && !b.pace; };
    if (def.a === 'V') a = pick(function (b) { return b.lab === 'V'; });
    else if (def.a === 'S') a = pick(function (b) { return b.lab === 'S'; });
    else if (def.a === 'maxpq') a = pick(function (b) { return b.pq !== null; }, function (b) { return b.pq; });
    else if (def.a === 'any') a = pick();
    if (!a) a = pick(nat) || pick();

    /* Messwerte, bezogen auf einen Schlag */
    var rrs = [], seq = [], pRate = null;
    for (i = 1; i < vis.length; i++) rrs.push(Math.round((vis[i].t - vis[i - 1].t) * 1000));
    if (data.ps.length > 2) {
      var pf = data.ps[0].t, pl = data.ps[data.ps.length - 1].t;
      if (pl > pf) pRate = Math.round(60 * (data.ps.length - 1) / (pl - pf));
    }
    vis.forEach(function (b) { if (b.pq !== null && seq.indexOf(b.pq) < 0) seq.push(b.pq); });
    seq.sort(function (x, y) { return x - y; });
    /* PQ-Zeiten, die sich nur um die Rundung unterscheiden, zusammenfassen */
    seq = seq.filter(function (x, k) { return k === 0 || x - seq[k - 1] > 12; });
    function ctx(b) {
      var c = { hr: meas.hr, axis: meas.axis, pq: b ? b.pq : null, qrs: b ? b.qrs : null,
                qt: b ? b.qtms : null, qtc: b ? b.qtc : null, oup: [], rp: null, av: null,
                rrMin: rrs.length ? Math.min.apply(null, rrs) : null,
                rrMax: rrs.length ? Math.max.apply(null, rrs) : null,
                pRate: pRate, pqSeq: seq.length ? seq.slice(0, 4).join(' → ') + ' ms' : '–' };
      c.pqBad = c.pq !== null && (c.pq > 200 || c.pq < 120);
      c.qtLim = (st.patient && st.patient.geschlecht === 'w') ? 460 : 450;
      for (var k = 0; k < 12; k++) c.oup.push(b && oupFn ? oupFn(k, b) : null);
      if (b && b.rp !== null) c.rp = Math.round((b.rp - b.t) * 1000);
      if (b && b.pace) {
        var ap = null;
        data.ps.forEach(function (p) { if (p.pace && p.t < b.t && p.t > b.t - 0.45) ap = p; });
        if (ap) c.av = Math.round((b.t - ap.t) * 1000);
      }
      return c;
    }
    /* Block, ST-Strecke und T-Welle zeigen sich nur am schmalen Eigenschlag.
       Ist der Vergleichsschlag des Rhythmus eine Extrasystole, wird dafuer
       ein eigener Schlag gesucht. */
    var fa = (a && nat(a)) ? a : pick(nat);
    var c = ctx(a), cN = fa === a ? c : ctx(fa);

    /* ST-Strecke: 40 ms nach dem Ende des QRS gegen die PQ-Strecke */
    var isNat = !!fa, stv = null;
    if (isNat) {
      stv = [];
      for (i = 0; i < 12; i++) stv.push(val(i, fa.off + 0.04) - val(i, fa.on - 0.02));
    }
    /* Hoehe einer Welle zum Zeitpunkt t gegen die PQ-Strecke, in allen
       zwoelf Ableitungen; dazu die Ableitung mit dem groessten Wert */
    function amp12(t) {
      if (!isNat || t === null || t === undefined) return null;
      var o = [];
      for (var k = 0; k < 12; k++) o.push(val(k, t) - val(k, fa.on - 0.02));
      return o;
    }
    function peak(v, leads) {
      var best = leads[0];
      leads.forEach(function (k) { if (v[k] > v[best]) best = k; });
      return mm(v[best]) + ' in ' + LN[best];
    }
    function leadsWhere(f) {
      var o = [];
      if (stv) stv.forEach(function (v, k) { if (f(v)) o.push(LN[k]); });
      return o.length ? o.join(', ') : '–';
    }

    var K = { name: '', sections: [], sheet: {}, box: {}, leads: def.l || [1, 6, 11],
              jv: amp12(fa ? fa.j : null), uv: amp12(fa ? fa.u : null),
              anchor: a, tA: a ? a.on : 2.3, c: c, st: stv, tw: null,
              refHr: Math.max(60, Math.min(100, Math.round((st.hr || 75) / 5) * 5)) };
    function add(str, into) { (str || '').split(' ').forEach(function (m) { if (m) into[m] = true; }); }
    var names = [Engine.rhythmLabel(r)];

    /* 1  Besonderheiten der Kammerkomplexe und des Kammerendteils */
    var form = [], fn = [], sv = st.st || 0, hasP = !!fa && fa.hp;
    var blk = (st.block && st.block !== 'none' && B[st.block] &&
               data.beats.some(function (b) { return b.blk; })) ? st.block : null;
    if (isNat) {
      if (sv >= 0.5) {
        fn.push('ST-Hebung');
        form.push(L('ST-Hebung am J-Punkt ab 1 mm in zwei benachbarten Ableitungen (V2, V3: ab 2 mm)',
                    'hier in ' + leadsWhere(function (v) { return v >= 0.095; }), true));
        form.push(L('Senkung in den gegenüberliegenden Ableitungen (Spiegelbild)',
                    'hier in ' + leadsWhere(function (v) { return v <= -0.05; }), true));
        form.push(L('II, III, aVF = Hinterwand (inferior)'));
        add('st', K.sheet); add('st', K.box);
        K.leads = [2, 5, 4];
      } else if (sv <= -0.5) {
        fn.push('ST-Senkung');
        form.push(L('Horizontale oder absteigende ST-Senkung ab 0,5 mm in zwei benachbarten Ableitungen',
                    'hier in ' + leadsWhere(function (v) { return v <= -0.05; }), true));
        form.push(L('aVR kann sich heben', 'hier ' + mm(stv[3]), stv[3] >= 0.05));
        form.push(L('Zeichen der Innenschichtischämie – ob ein NSTEMI vorliegt, entscheidet das Troponin'));
        add('st', K.sheet); add('st', K.box);
        K.leads = [1, 10, 3];
      }
      if (st.tw === 'negativ') {
        fn.push('T negativ');
        form.push(L('T-Welle negativ, spitz und gleichschenklig – in Ableitungen, in denen sie positiv sein müsste'));
        add('t', K.box); K.tw = 'T negativ';
      } else if (st.tw === 'hoch') {
        fn.push('hohes T');
        form.push(L('T-Welle hoch, spitz und schmal („zeltförmig") – typisch für die Hyperkaliämie'));
        add('t', K.box); K.tw = 'T hoch';
      } else if (st.tw === 'flach') {
        fn.push('flaches T');
        form.push(L('T-Welle abgeflacht'));
        add('t', K.box); K.tw = 'T flach';
      }
      if ((st.uw || 0) >= 20) {
        fn.push('U-Welle');
        form.push(L('U-Welle: eigene Welle hinter der T-Welle, am höchsten in V2 bis V4 – bei Hypokaliämie größer als T',
                    K.uv ? 'hier ' + peak(K.uv, [6, 7, 8, 9]) : null, true));
        form.push(L('Mit ST-Senkung und flachem T das typische Bild der Hypokaliämie. Die QT-Zeit ist oft normal – wer über die U-Welle misst, misst die QU-Zeit'));
        add('u', K.sheet); add('u', K.box);
        if (!blk && (Math.abs(sv) < 0.5 || st.uw >= 50)) K.leads = [1, 7, 8];
      }
      if ((st.jw || 0) >= 15 && K.jv) {
        fn.push('J-Welle (Osborn)');
        form.push(L('J-Welle (Osborn-Welle): Höcker direkt am Ende des QRS, gleichsinnig zum QRS, am höchsten in V3–V5 und inferior',
                    'hier ' + peak(K.jv, [1, 2, 5, 8, 9, 10]), true));
        add('j', K.sheet); add('j', K.box);
        if (!blk) K.leads = [1, 5, 9];
      }
      if (hasP && (st.pamp === undefined ? 100 : st.pamp) <= 50) {
        fn.push(st.pamp <= 15 ? 'P fehlt' : 'flaches P');
        form.push(L((st.pamp <= 15 ? 'P-Welle nicht mehr zu erkennen' : 'P-Welle abgeflacht') +
                    ' – bei Hyperkaliämie: erst hohes T, dann flaches P, dann breiter QRS'));
      }
      if (!blk && cN.qrs !== null && cN.qrs >= 110 && (st.qrs || 90) >= 105) {
        fn.push('breiter QRS');
        form.push(L('QRS verbreitert, aber ohne das Bild eines Schenkelblocks (unspezifische Leitungsverzögerung)',
                    'hier ' + ms(cN.qrs), true));
        add('qrsband', K.sheet); add('qrs', K.box);
      }
      if (r !== 'longqt' && cN.qtc !== null && cN.qtc > cN.qtLim && (st.qtf || 100) >= 110) {
        fn.push('QT verlängert');
        form.push(L('QT-Zeit verlängert: QTc über ' + cN.qtLim + ' ms', 'hier QT ' + ms(cN.qt) + ', QTc ' + ms(cN.qtc), true));
        add('qt', K.sheet); add('qt', K.box);
      }
    }

    /* 2  Rhythmus – bei einem Sinusrhythmus mit Block oder auffaelliger
          Form genuegen zwei Zeilen, der Platz gehoert dann dem Befund. */
    /* Verlangt der Rhythmus eine Extrasystole als Vergleich und faellt in
       diesen fuenf Sekunden keine, gibt es dafuer auch keinen Messwert. */
    var miss = (def.a === 'V' || def.a === 'S') && !(a && a.lab === def.a);
    if (miss) c.qrs = null;
    var lines = def.k(c);
    if (miss) lines.push(L('In diesem Ausschnitt fällt keine Extrasystole – „Neu schreiben" holt ein neues Blatt'));
    if ((blk || form.length) && /^sinus/.test(r)) lines = lines.slice(0, r === 'sinus' ? 2 : 1).concat(lines.slice(-2, -1));
    /* Ohne erkennbare P-Welle laesst sich keine PQ-Zeit messen */
    var noP = hasP && isNat && (st.pamp === undefined ? 100 : st.pamp) <= 15;
    if (noP) lines = lines.filter(function (x) { return !/PQ-Zeit|P-Welle/.test(x.t); });
    K.sections.push({ h: Engine.rhythmLabel(r), lines: lines });
    /* Verglichen wird am Eigenschlag, sobald ein Block oder eine auffaellige
       Form dazukommt – die Messstrecken des Rhythmus gelten dann nicht. */
    if ((blk || form.length) && fa) { K.anchor = fa; K.tA = fa.on; K.c = cN; }
    add(def.s, K.sheet);
    if (K.anchor === a) add(def.b, K.box);

    /* 3  Block */
    if (blk) {
      var bd = Engine.BLOCKS[blk];
      names.push(bd.label.replace(' (Hemiblock)', ''));
      var bl = B[blk].k(cN);
      if (r === 'avb1')
        bl.push(L(/^rsb_/.test(blk) ? 'Mit dem AV-Block I°: inkompletter trifaszikulärer Block'
                                     : (blk === 'rsb' ? 'Mit dem AV-Block I°: bifaszikulärer Block' : '')));
      K.sections.push({ h: bd.label.replace(' (Hemiblock)', ''), lines: bl.filter(function (x) { return x.t; }) });
      add('qrsband', K.sheet); add('qrs oup', K.box);
      if (Math.abs(sv) < 0.5) K.leads = B[blk].l;
    }
    if (form.length) K.sections.push({ h: fn.join(' · '), lines: form });
    if (noP) { delete K.sheet.pq; delete K.box.pq; }

    /* 4  Koerpertemperatur: Hypothermie unter 35 Grad, Hyperthermie ab 40 */
    var T = st.lab && st.lab.temp, tn = [];
    if (T !== undefined && T !== null && (T < 35 || T >= 40)) {
      var tt = String(T.toFixed(1)).replace('.', ',') + ' °C', tl;
      if (T < 35) {
        tn.push('Hypothermie ' + tt);
        tl = [
          L('Sinusknoten, AV-Knoten und Kammern leiten langsamer: Bradykardie, PQ, QRS und QT verlängert',
            'hier HF ' + (c.hr === null ? '–' : c.hr) + '/min, PQ ' + ms(cN.pq) + ', QRS ' + ms(cN.qrs) + ', QTc ' + ms(cN.qtc), true),
          L('J-Welle ab etwa 34 °C, je kälter, desto höher – beim Wiedererwärmen verschwindet sie'),
          L('Kältezittern stört die Grundlinie bei leichter Hypothermie (32–35 °C), darunter hört es auf'),
          L('Unter 32 °C Vorhofflimmern, unter 28 °C Gefahr von Kammerflimmern, unter 24 °C Asystolie')];
        if (!(K.box.pq) && cN.pq !== null) add('pq', K.box);
        if (cN.pq !== null && cN.pq > 200) add('pq', K.sheet);
      } else {
        tn.push('Hyperthermie ' + tt);
        /* Kalium so, wie es die BGA zeigt: mit dem Laktat steigt es weiter */
        var kl = st.lab.k;
        if (kl !== undefined && st.lab.lacAuto === false && st.lab.lac > 2) kl += (st.lab.lac - 2) * 0.12;
        tl = [L('Tachykardie durch Hypermetabolismus und Sympathikus', 'hier ' + (c.hr === null ? '–' : c.hr) + '/min', true)];
        if (kl !== undefined && kl >= 5.3)
          tl.push(L('Hyperkaliämie aus zerfallender Muskulatur (Rhabdomyolyse): hohe, spitze T-Wellen, später flaches P und breiter QRS',
                    'hier K ' + String(kl.toFixed(1)).replace('.', ',') + ' mmol/l', true));
        tl.push(L('Rhythmusstörungen durch Kalium, Azidose und Katecholamine: VES bis Kammertachykardie und Kammerflimmern'));
        tl.push(L('Ein eigenes Temperaturzeichen wie die J-Welle der Hypothermie gibt es nicht'));
      }
      K.sections.push({ h: (T < 35 ? 'Hypothermie' : 'Hyperthermie') + ' · ' + tt, lines: tl });
    }

    K.name = names.concat(fn, tn).join('  ·  ');
    return K;
  }

  global.EKGKRIT = { build: build };
})(window);
