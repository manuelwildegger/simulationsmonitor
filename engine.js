/* engine.js – Simulations-Engine für Rhythmen, Druckkurven und Vitalwerte.
   Wird identisch von Monitor- und Steuerfenster geladen. */
(function (global) {
  'use strict';

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function gauss(x, w) { return Math.exp(-(x * x) / (2 * w * w)); }
  function sgn(x) { return x < 0 ? -1 : 1; }

  /* Stimulationsimpuls. Real nur ~1 ms breit; Monitore zeichnen ihn
     kuenstlich verbreitert, sonst waere er nicht zu sehen. */
  function spike(dt, amp) {
    if (dt < -0.012 || dt > 0.024) return 0;
    amp = amp === undefined ? 1.3 : amp;
    return amp * (gauss(dt - 0.002, 0.0035) - 0.23 * gauss(dt - 0.011, 0.0042));
  }

  /* ---------- Katalog ---------- */

  var RHYTHMS = [
    { group: 'Sinus / Basis', items: [
      ['sinus',          'Sinusrhythmus',            75],
      ['sinusarrhythmie','Sinusarrhythmie',          70]
    ]},
    { group: 'Supraventrikul\u00e4r \u2013 tachykard', items: [
      ['sinustachy',     'Sinustachykardie',        130],
      ['afib',           'Vorhofflimmern',          110],
      ['aflutter',       'Vorhofflattern 2:1',      150],
      ['svt',            'SVT',                     180],
      ['avnrt',          'AVNRT',                   180],
      ['avrt',           'AVRT (orthodrom)',        200]
    ]},
    { group: 'Supraventrikul\u00e4r \u2013 Extrasystolen', items: [
      ['sves',           'SVES monomorph',           74],
      ['sves_poly',      'SVES polymorph',           74]
    ]},
    { group: 'Ventrikul\u00e4r \u2013 tachykard, langes QT', items: [
      ['vt_puls',        'VT mit Puls',             170],
      ['torsade',        'Torsade de Pointes',      230],
      ['longqt',         'Long-QT-Syndrom',          58]
    ]},
    { group: 'Ventrikul\u00e4r \u2013 Extrasystolen', items: [
      ['ves',            'VES monomorph',            76],
      ['ves_poly',       'VES polymorph',            76],
      ['bigeminus',      'VES-Bigeminus',            70],
      ['trigeminus',     'VES-Trigeminus',           72],
      ['couplet',        'VES-Couplets',             78]
    ]},
    { group: 'Bradykard', items: [
      ['sinusbrady',     'Sinusbradykardie',         44],
      ['junktional',     'Junktionaler Rhythmus',    48]
    ]},
    { group: 'AV-Bl\u00f6cke', items: [
      ['avb1',           'AV-Block I\u00b0',              62],
      ['avb2a',          'AV-Block II\u00b0 Wenckebach',  72],
      ['avb2b',          'AV-Block II\u00b0 Mobitz',      72],
      ['avb3',           'AV-Block III\u00b0',            36]
    ]},
    { group: 'Schrittmacher', items: [
      ['paced_aai',      'Schrittmacher AAI',        70],
      ['paced_vvi',      'Schrittmacher VVI',        70],
      ['paced_ddd',      'Schrittmacher DDD',        70]
    ]},
    { group: 'Reanimation', items: [
      ['vf_grob',        'Kammerflimmern grob',       0],
      ['vf_fein',        'Kammerflimmern fein',       0],
      ['vt_pulslos',     'Pulslose VT',             180],
      ['asystolie',      'Asystolie',                 0],
      ['pea',            'PEA',                      40],
      ['idioventrikulaer','Idioventrikul\u00e4r',         28]
    ]}
  ];

  var ARTEFAKTE = [
    ['keine',     'kein Artefakt'],
    ['bewegung',  'Bewegung'],
    ['elektrode', 'Elektrode ab'],
    ['netz',      '50-Hz-Störung'],
    ['cpr',       'Thoraxkompressionen'],
    ['zittern',   'Muskelzittern']
  ];

  /* Rhythmen ohne Auswurf */
  var NO_PERFUSION = { vf_grob: 1, vf_fein: 1, vt_pulslos: 1, asystolie: 1, pea: 1 };
  /* Rhythmen ohne sichtbare P-Welle */
  var NO_P = { afib: 1, aflutter: 1, svt: 1, avnrt: 1, avrt: 1, junktional: 1,
               vt_puls: 1, vt_pulslos: 1, torsade: 1,
               idioventrikulaer: 1, vf_grob: 1, vf_fein: 1, asystolie: 1, paced_vvi: 1 };

  /* Formenvorrat fuer polymorphe (multiforme) VES: andere Achse, andere
     Breite, andere Amplitude – so wie bei wechselndem Ursprungsort. */
  var VMORPH = [
    { id: 1, pol: -1, amp: 1.25, w: 1.00 },
    { id: 2, pol:  1, amp: 1.10, w: 1.30 },
    { id: 3, pol: -1, amp: 0.92, w: 1.48 },
    { id: 4, pol:  1, amp: 1.38, w: 0.86 }
  ];

  /* ---------- Zwoelf Ableitungen ---------- */

  /* Das Herz wird als ein Dipol gerechnet, der sich waehrend des Schlags
     dreht: x zeigt nach links, y nach unten, z nach vorn. Jede Ableitung
     ist die Projektion dieses Vektors auf ihre Richtung. Die Extremitaeten-
     ableitungen folgen damit von selbst dem Einthoven-Dreieck (I + III = II),
     die Brustwandableitungen liegen in der Horizontalebene und bekommen
     einen Zuschlag fuer die Naehe zum Herzen. */
  var LEADS = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6'];
  function chest(deg, y, gain) {
    var a = deg * Math.PI / 180;
    return [Math.cos(a) * gain, y * gain, Math.sin(a) * gain];
  }
  var LVEC = [
    [1, 0, 0], [0.5, 0.866, 0], [-0.5, 0.866, 0],
    [-0.75, -0.433, 0], [0.75, -0.433, 0], [0, 0.866, 0],
    chest(115, 0.00, 1.00), chest(95, 0.00, 1.50), chest(72, 0.05, 1.50),
    chest(50, 0.25, 1.45), chest(22, 0.30, 1.10), chest(-5, 0.30, 0.85)
  ];
  /* Richtung so normiert, dass sie in Ableitung II genau 1 ergibt. Damit
     laesst sich jeder Kurvenanteil, der bisher nur fuer Ableitung II
     gerechnet wurde, unveraendert in den Raum stellen. */
  function nII(x, y, z) { var d = 0.5 * x + 0.866 * y; return [x / d, y / d, z / d]; }

  var D_P    = nII(0.50, 0.80, 0.25);          /* Vorhoferregung: nach links unten */
  var D_T    = nII(0.60, 0.55, 0.30);          /* Repolarisation, gleichsinnig zum QRS */
  var D_STUP = nII(-0.25, 1.10, -0.35);        /* Hebung: Hinterwand (III > II, I und aVL spiegelbildlich) */
  var D_STDN = nII(0.70, 0.60, 0.35);          /* Senkung: Innenschicht, aVR hebt sich */
  /* U-Welle: nach vorn gerichtet, deshalb am hoechsten in V2 und V3 */
  var D_U    = nII(0.25, 0.40, 0.95);
  /* J-Welle (Osborn): gleichsinnig zum Ende des QRS, am hoechsten in V3 bis
     V5 und inferior, in aVR negativ */
  var D_J    = nII(0.45, 0.75, 0.55);
  var D_BASE = nII(0.50, 0.866, 0.30);
  var D_AF   = nII(-0.25, 0.80, 0.35);          /* Flimmerwellen: am besten in V1 und inferior */
  var D_FL   = nII(0.00, 1.00, -0.80);         /* Flatterwellen: Saegezahn inferior, in V1 positiv */
  var D_SPK  = nII(0.60, 0.80, 0.20);
  /* Breite Kammerkomplexe: Die Richtung haengt vom Ursprung ab. */
  var D_WIDE = {
    neg:   nII(0.25, -0.95, -0.35),            /* Spitze des rechten Ventrikels: LSB-artig, Achse nach oben */
    pos:   nII(-0.15, 0.90, 0.40),             /* linker Ventrikel: RSB-artig, Achse nach unten */
    vt:    nII(-0.15, 0.90, 0.40),
    paced: nII(0.17, -0.98, -0.30),
    1: nII(0.25, -0.95, -0.35), 2: nII(-0.15, 0.90, 0.40),
    3: nII(-0.20, -0.80, 0.55), 4: nII(0.30, 0.85, -0.45)
  };

  /* Kammerkomplex als Folge von Teilvektoren: [Zeit, Breite, x, y, z],
     Zeiten in Sekunden bezogen auf den Gipfel der normalen R-Zacke,
     Vektoren in Millivolt.
     Normal: Septum von links nach rechts, dann Spitze und Vorderwand, dann
     die freie Wand des linken Ventrikels nach hinten, zuletzt die Basis. */
  var QRS_N = [
    [-0.022, 0.008, -0.12, -0.03,  0.18],
    [-0.006, 0.011,  0.33,  0.47,  0.28],
    [ 0.006, 0.012,  0.42,  0.42, -0.70],
    [ 0.031, 0.015, -0.16, -0.196, -0.18]
  ];
  var T_N = [0.26 * D_T[0], 0.26 * D_T[1], 0.26 * D_T[2]];
  var RV_LATE = [0.060, 0.024, -0.36, -0.22, 0.66];   /* verspaeteter rechter Ventrikel */

  /* Schenkel- und Faszikelbloecke. `c` = Teilvektoren des Kammerkomplexes,
     `t` = T-Vektor bei normaler T-Welle, `st` = Verlagerung der ST-Strecke,
     `sh` = Zeit, um die sich die Erregungsrueckbildung nach hinten schiebt.
     Die Bilder folgen den Kriterien von fokus-ekg.de (dort nach AHA/ACCF/HRS
     2009, Surawicz et al.):
       RSB   QRS ab 120 ms. Der rechte Ventrikel wird zuletzt erregt: ein
             spaeter Vektor nach rechts vorn. M-Form (rSR') in V1 und V2,
             oberer Umschlagpunkt in V1 ueber 50 ms, breites S in I, aVF,
             V5 und V6. Die ST-Strecke bleibt isoelektrisch.
       iRSB  dasselbe Bild bei 110 bis 119 ms, r' plumper als r.
       LSB   QRS ab 120 ms. Das Septum wird von rechts her erregt: kein q in
             I, V5, V6, kleines r in V1 bis V3 mit tiefem S. Der linke
             Ventrikel folgt langsam ueber die Muskulatur: breites, plumpes,
             gekerbtes R in I, aVL, V5, V6 (zweiter Gipfel hoeher), oberer
             Umschlagpunkt in V6 ab 60 ms, ST und T gegensinnig zum QRS.
       iLSB  110 bis 119 ms, Umschlagpunkt in V4 bis V6 ab 60 ms, kein q in
             I, V5, V6, Bild wie bei Linkshypertrophie.
       LAFB  Linksanteriorer Faszikelblock: Die Erregung laeuft ueber den
             hinteren Faszikel zuerst nach unten, dann nach links oben.
             Achse -45 bis -90 Grad, qR in aVL (und I) mit R-Gipfel nach mehr
             als 45 ms, rS in II, III, aVF, QRS unter 120 ms, langsamer
             R-Zuwachs: R/S-Umschlag nach links verschoben, S bis V6.
       LPFB  Linksposteriorer Faszikelblock, umgekehrt: zuerst nach links
             oben, dann nach rechts unten. Achse +80 bis +120 Grad, rS in I
             und aVL, qR in III und aVF, R/S-Umschlag nach rechts verschoben
             (relativ hohes R in V1 bis V3), QRS unter 120 ms. */
  var C_LAFB = [[-0.026, 0.008, -0.16,  0.26,  0.14],
                [-0.006, 0.010,  0.15,  0.12,  0.18],
                [ 0.013, 0.016,  0.63, -0.90, -0.50],
                [ 0.040, 0.014, -0.20, -0.40, -0.15]];
  var C_LPFB = [[-0.026, 0.008,  0.18, -0.34,  0.10],
                [-0.008, 0.010,  0.50,  0.10,  0.44],
                [ 0.008, 0.016, -0.60,  1.00, -0.14],
                [ 0.036, 0.013, -0.12,  0.15, -0.18]];
  var BLOCKS = {
    none: { label: 'kein Block', kurz: 'kein Block', c: QRS_N, t: T_N, st: null, sh: 0 },
    irsb: { label: 'Inkompletter Rechtsschenkelblock', kurz: 'inkompl. RSB',
            c: QRS_N.concat([[0.050, 0.015, -0.18, -0.06, 0.36]]),
            t: [0.20, 0.185, 0.05], st: null, sh: 0.012 },
    rsb:  { label: 'Rechtsschenkelblock', kurz: 'RSB',
            c: QRS_N.slice(0, 3).concat([RV_LATE]),
            t: [0.22, 0.17, -0.10], st: null, sh: 0.045 },
    ilsb: { label: 'Inkompletter Linksschenkelblock', kurz: 'inkompl. LSB',
            c: [[-0.030, 0.009, 0.05, 0.03, 0.32],
                [ 0.000, 0.016, 0.80, 0.50, -0.70],
                [ 0.040, 0.017, 0.80, 0.36, -0.42]],
            t: [0.10, 0.12, 0.16], st: null, sh: 0.018 },
    lsb:  { label: 'Linksschenkelblock', kurz: 'LSB',
            c: [[-0.034, 0.010, 0.05, 0.04, 0.38],
                [ 0.002, 0.020, 0.72, 0.44, -0.85],
                [ 0.055, 0.024, 0.90, 0.36, -0.55]],
            t: [-0.24, -0.10, 0.24], st: [-0.13, -0.05, 0.18], sh: 0.055 },
    lahb: { label: 'Linksanteriorer Faszikelblock (Hemiblock)', kurz: 'LAFB',
            c: C_LAFB, t: [0.22, 0.12, 0.07], st: null, sh: 0.010 },
    lphb: { label: 'Linksposteriorer Faszikelblock (Hemiblock)', kurz: 'LPFB',
            c: C_LPFB, t: [0.10, 0.24, 0.08], st: null, sh: 0.010 },
    rsb_lahb: { label: 'Bifaszikulärer Block: RSB + LAFB', kurz: 'RSB + LAFB',
            c: C_LAFB.slice(0, 3).concat([[0.062, 0.024, -0.36, -0.14, 0.66]]),
            t: [0.24, 0.10, -0.10], st: null, sh: 0.045 },
    rsb_lphb: { label: 'Bifaszikulärer Block: RSB + LPFB', kurz: 'RSB + LPFB',
            /* etwas mehr nach hinten, damit in V1 die M-Form erhalten bleibt */
            c: C_LPFB.slice(0, 2).concat([[0.008, 0.016, -0.60, 1.00, -0.42],
                                          [0.062, 0.024, -0.36, 0.05, 0.66]]),
            t: [0.12, 0.24, -0.10], st: null, sh: 0.045 }
  };
  var BLOCK_ORDER = ['none', 'irsb', 'rsb', 'ilsb', 'lsb', 'lahb', 'lphb', 'rsb_lahb', 'rsb_lphb'];
  /* Beginn und Ende des Kammerkomplexes aus den Teilvektoren, daraus die
     Nenndauer; dazu die Projektion auf Ableitung II fuer die Monitorkurve. */
  function pII(v) { return 0.5 * v[0] + 0.866 * v[1]; }
  BLOCK_ORDER.forEach(function (id) {
    var b = BLOCKS[id], on = 1, off = -1;
    b.c.forEach(function (c) {
      on = Math.min(on, c[0] - 1.8 * c[1]);
      off = Math.max(off, c[0] + 1.8 * c[1]);
    });
    b.id = id; b.on = on; b.off = off;
    b.dur = id === 'none' ? 90 : Math.round((off - on) * 200) * 5;
    b.cII = b.c.map(function (c) { return pII(c.slice(2)); });
    b.tII = pII(b.t);
    b.stII = b.st ? pII(b.st) : 0;
  });

  /* ---------- Medikamente ---------- */

  /* Kennfarben der Spritzenetiketten nach ISO 26825 und der ergaenzenden
     DIVI-Empfehlung. Die RGB-Werte stehen so in der Farbtabelle der DIVI:
       Vasopressoren              Violet 256       222.191.217
       Anticholinergika           Green 367        163.217.99
       Hypnotika                  Process yellow   255.255.0
       Muskelrelaxantien          Warm red         245.64.41
       Antiarrhythmika            Red 193 / Process Blue  191.18.56 / 0.140.204
       Inodilatatoren             Red 193 / Green 346     191.18.56 / 99.204.150
     Darstellung (Feld "iso"):
       plain  einfarbig, schwarze Schrift
       epi    Ausnahme Adrenalin: obere Haelfte schwarz, Schrift in Violett
       hatch  weisser Grund mit Randschraffur in der Kennfarbe
       bar    wie hatch, zusaetzlich schwarzer Querbalken (Relaxansantagonist)
       diag   zwei Farbfelder, diagonal geteilt: col[0] links unten,
              col[1] rechts oben, weisse Schrift

     "conv" beschreibt den Rhythmusumschlag: Laeuft bei der Gabe einer der
     unter "from" genannten Rhythmen, schaltet die Steuerung nach der
     Anschlagzeit auf "to" um. Das laesst sich in der Steuerung abschalten,
     und ein von Hand gesetzter Rhythmus bricht den Umschlag ab.

     "eff" ist ein Zuschlag auf die eingestellten Werte, "onset" die Zeit in
     Sekunden, ueber die er anflutet. Eine Halbwertszeit wird bewusst nicht
     nachgebildet: die Wirkung bleibt stehen, bis sie verstellt wird. */
  var MED_GROUPS = [
    { group: 'Vasopressoren', note: 'Violet 256, einfarbig', items: [
      { id: 'adrenalin', name: 'Adrenalin', dose: '1 mg', iso: 'epi',
        col: ['#debfd9'], onset: 15, eff: { hr: 40, sys: 55, dia: 22, vaso: -35 } },
      { id: 'noradrenalin', name: 'Noradrenalin', dose: '0,1 mg', iso: 'plain',
        col: ['#debfd9'], onset: 30, eff: { hr: -4, sys: 30, dia: 18, vaso: -45 } },
      { id: 'argipressin', name: 'Argipressin', dose: '1 IE', iso: 'plain',
        col: ['#debfd9'], onset: 45, eff: { sys: 22, dia: 14, vaso: -50 } }
    ]},
    { group: 'Inodilatatoren', note: 'Red 193 / Green 346, diagonal', items: [
      { id: 'dobutamin', name: 'Dobutamin', dose: '5 \u00b5g/kg/min', iso: 'diag',
        col: ['#bf1238', '#63cc96'], onset: 60, eff: { hr: 14, sys: 18, dia: -4 } }
    ]},
    /* Metoprolol steht hier und nicht bei den Antihypertonika: Betablocker
       sind Antiarrhythmika der Klasse II, und so sind sie am UKA auch
       etikettiert. */
    { group: 'Antiarrhythmika', note: 'Red 193 / Process Blue, diagonal', items: [
      { id: 'amiodaron', name: 'Amiodaron', dose: '300 mg', iso: 'diag',
        col: ['#bf1238', '#008ccc'], onset: 90, eff: { hr: -22, sys: -12, dia: -6 },
        conv: [{ from: ['vt_puls'], to: 'sinus', hr: 88 },
               { from: ['afib', 'aflutter'], to: 'sinus', hr: 78 },
               { from: ['svt', 'avnrt', 'avrt'], to: 'sinus', hr: 76 }] },
      { id: 'metoprolol', name: 'Metoprolol', dose: '5 mg', iso: 'diag',
        col: ['#bf1238', '#008ccc'], onset: 40, eff: { hr: -28, sys: -14, dia: -6 },
        conv: [{ from: ['svt', 'avnrt', 'avrt'], to: 'sinus', hr: 70 }] },
      /* Adenosin wirkt nur Sekunden. Eine bleibende Wirkung auf die
         Zahlenwerte waere falsch – was es macht, sieht man in der Kurve. */
      { id: 'adenosin', name: 'Adenosin', dose: '6 mg', iso: 'diag',
        col: ['#bf1238', '#008ccc'], onset: 5, eff: {}, special: 'adeno',
        info: 'blockiert den AV-Knoten f\u00fcr etwa 8 s \u00b7 keine bleibende Wirkung',
        conv: [{ from: ['svt', 'avnrt', 'avrt'], to: 'sinus', hr: 74, after: 6 }] }
    ]},
    { group: 'Anticholinergika', note: 'Green 367, einfarbig', items: [
      { id: 'atropin', name: 'Atropin', dose: '0,5 mg', iso: 'plain',
        col: ['#a3d963'], onset: 20, eff: { hr: 28 },
        /* Atropin wirkt am AV-Knoten. Auf einen AV-Block III. Grades wirkt
           es absichtlich nicht – der sitzt weiter unten. */
        conv: [{ from: ['avb2a'], to: 'sinus', hr: 74 },
               { from: ['junktional'], to: 'sinus', hr: 72 }] }
    ]},
    { group: 'Antihypertonika / Vasodilatatoren', note: 'Violet 256, Randschraffur', items: [
      { id: 'urapidil', name: 'Urapidil', dose: '10 mg', iso: 'hatch',
        col: ['#debfd9'], onset: 45, eff: { sys: -32, dia: -16, vaso: 25 } },
      { id: 'clonidin', name: 'Clonidin', dose: '75 \u00b5g', iso: 'hatch',
        col: ['#debfd9'], onset: 90, eff: { hr: -16, sys: -20, dia: -10 } }
    ]},
    { group: 'Elektrolyte', note: 'Green 349 / Pink 227, diagonal', items: [
      { id: 'magnesium', name: 'Magnesium', dose: '2 g', iso: 'diag',
        col: ['#006338', '#ab035c'], onset: 30, eff: { hr: -6, sys: -8, dia: -4 },
        conv: [{ from: ['torsade'], to: 'sinus', hr: 72 }] },
      /* Kalium ist in der DIVI-Empfehlung eine Ausnahme innerhalb der
         Elektrolyte: Green 349 links unten, Process Blue rechts oben. */
      { id: 'kalium', name: 'Kalium', dose: '20 mmol', iso: 'diag',
        col: ['#006338', '#008ccc'], onset: 45, eff: {}, special: 'kalium', dk: 0.5,
        info: 'hebt das Serumkalium um 0,5 mmol/l · das EKG folgt dem Wert' }
    ]},
    { group: 'Hypnotika', note: 'Process yellow, einfarbig', items: [
      { id: 'propofol', name: 'Propofol', dose: '2 mg/kg', iso: 'plain',
        col: ['#ffff00'], onset: 25, eff: { hr: -5, sys: -35, dia: -18, af: -8, vaso: 20 } }
    ]},
    { group: 'Muskelrelaxans-Antagonisten', note: 'Warm red, Randschraffur mit Querbalken', items: [
      { id: 'neostigmin', name: 'Neostigmin', dose: '0,5 mg', iso: 'bar',
        col: ['#f54029'], onset: 40, eff: { hr: -18 } }
    ]}
  ];

  /* Zeitraffer fuer den Unterricht: Die Anschlagzeiten oben sind die
     realistischen Werte. Gerechnet wird mit einem Fuenftel davon, damit man
     auf die Wirkung von Amiodaron nicht anderthalb Minuten warten muss.
     Wer die echten Zeiten will, setzt den Faktor auf 1. */
  var ONSET_FACTOR = 0.2;

  var MEDS = [];
  MED_GROUPS.forEach(function (g) {
    g.items.forEach(function (m) {
      m.group = g.group;
      m.onsetReal = m.onset;
      m.onset = Math.max(1, Math.round(m.onset * ONSET_FACTOR));
      MEDS.push(m);
    });
  });

  /* ---------- Kurvenformen ---------- */

  /* vd = Vasodilatation, 0 = normaler Gefaesstonus, 1 = septisch weitgestellt.
     Dazwischen wird stufenlos gemischt: steilerer Anstieg, spitzer Gipfel,
     rascher Abfluss ins weitgestellte Strombett, kaum noch Inzisur. */
  function artShape(dt, T, vd) {
    if (dt < 0) return 0;
    vd = vd || 0;
    var up = 0.095 - 0.037 * vd;
    if (dt < up) {
      var u = dt / up;
      var a = Math.pow(Math.sin(Math.PI * u / 2), 1.15);         // runder Gipfel
      var b = Math.pow(u, 1.15);                                 // gerade Rampe
      return (1 - vd) * a + vd * b;
    }
    var x = (dt - up) * (0.55 + 0.45 * (0.8 / Math.max(0.3, T || 0.8)));
    var f1 = 0.46 + 0.40 * vd;
    var v = f1 * Math.exp(-x * (4.6 + 10.4 * vd)) + (1 - f1) * Math.exp(-x * (3.0 - 0.6 * vd));
    v -= (0.13 - 0.120 * vd) * gauss(x - (0.145 - 0.055 * vd), 0.022);   // Inzisur
    v += (0.17 - 0.155 * vd) * gauss(x - (0.205 - 0.070 * vd), 0.045);   // dikrote Welle
    return Math.max(0, v);
  }

  function plethShape(dt, T) {
    dt -= 0.18;                                                  // Laufzeit zur Peripherie
    if (dt < 0) return 0;
    var up = 0.135;
    if (dt < up) return Math.pow(Math.sin(Math.PI * dt / (2 * up)), 1.5);
    var x = (dt - up) * (0.55 + 0.45 * (0.8 / Math.max(0.3, T || 0.8)));
    var v = 0.45 * Math.exp(-x * 3.6) + 0.55 * Math.exp(-x * 2.1);
    v += 0.14 * gauss(x - 0.20, 0.060);                          // dikroter Umschlag
    return Math.max(0, v);
  }

  /* ---------- Engine ---------- */

  function Engine() {
    this.t = 0;
    this.state = JSON.parse(JSON.stringify(Engine.defaults));
    this.target = {};
    this._rampT = 0;
    this._tgtRamp = {};              /* Anflutzeit je Wert, s. apply() */
    this.atrial = [];
    this.vent = [];
    this.nextBeat = 0.5;
    this.nextP = 0.5;
    this._cyc = 0;
    this._phase = Math.random() * 500;
    this._artWin = [];
    this._cvpWin = [];
    this._rrWin = [];
    this._ppWin = [];                 /* Pulsdruck je Schlag -> PPV */
    this._hist = [];                  /* Schlagprotokoll fuer die Rhythmusanalyse */
    this._respPh = 0;                 /* fortlaufende Atemphase */
    this._lastVm = 0;
    this._svesNow = false;
    this._lastVes = false;
    this._learnT = -99;
    this._ppSkip = 0;
    this._ectT = -99;
    this._vtSince = 0;
    this._band = 0;
    this._adenoBlock = -99;          /* vollstaendiger AV-Block, s. adenosine() */
    this._adeno = -99;               /* verlangsamte Ueberleitung */
    this._defibAt = -1e9;            /* Zeitpunkt des letzten Schocks */
    this._syncPending = false;       /* Kardioversion wartet auf die R-Zacke */
    this._syncArmed = 0;
    /* Thoraxkompressionen: Beginn der laufenden Serie und das Fenster, in
       dem fuer den Schock niemand den Patienten beruehrt. */
    this._cprT0 = 0;
    this._offFrom = 1e9;
    this._offUntil = -1e9;
    this._offVal = 9;
    this.spikes = [];                /* Schrittmacherimpulse ohne Antwort */
    this._lastVentT = 0;
    this.onBeat = null;   // Callback für Ton
  }

  Engine.defaults = {
    rhythm: 'sinus', hr: 75, spo2: 98, sys: 120, dia: 70, cvp: 6, af: 14,
    vaso: 0,                       /* Vasodilatation in %, formt die Druckkurve */
    ppv: 0,                        /* Pulsdruckvariation in %, laesst die Kurve undulieren */
    block: 'none',                 /* Schenkel- oder Faszikelblock, s. BLOCKS */
    st: 0,                         /* ST-Strecke in mm: + Hebung, - Senkung */
    tw: 'normal',                  /* T-Welle: normal | hoch | flach | negativ */
    qrs: 90,                       /* QRS-Breite in ms */
    pamp: 100,                     /* Hoehe der P-Welle in % */
    qtf: 100,                      /* QT-Zeit in % des frequenzbezogenen Werts */
    uw: 0,                         /* U-Welle in % (Hypokaliaemie) */
    jw: 0,                         /* J-Welle (Osborn) in % (Hypothermie) */
    pq: 0,                         /* Verlaengerung der PQ-Zeit in ms */
    meds: [],                      /* gegebene Medikamente: { id, at } */
    artefakt: 'keine', transition: 0,
    /* Externer Schrittmacher (Osypka PACE 203H). Die Betriebsart steckt im
       Rhythmus, hier stehen nur die Einstellungen des Geraets. */
    /* Der PACE 203H stellt die Stimulation in Volt ein, die Wahrnehmung
       in Millivolt. */
    pacer: { av: 180, outA: 5.0, outV: 8.0, sensA: 1.0, sensV: 2.0 },
    /* Defibrillator (corpuls1) */
    defi: { mode: 'defib', energy: 200, charged: false, charging: false },
    sweep: 6, alarms: true,
    patient: { name: 'Mustermann, Max', alter: '64 J.', geschlecht: 'm', bett: 'ICU 03', id: '4711829' },
    lab: { fio2: 21, temp: 37.0, hb: 13.8, na: 140, k: 4.1, cl: 103, ca: 1.19,
           glu: 95, cohb: 1.2, methb: 0.8, lac: 1.0, lacAuto: true, beOffset: 0 },
    show: { art: true, pleth: true, cvp: true, rhythmStatus: true, rhythmName: false, alarmText: false },
    limits: { hr: [50, 120], spo2: [90, 100], sys: [90, 170], dia: [45, 100], map: [65, 110],
              cvp: [1, 14], temp: [36.0, 38.5] }
  };

  Engine.LEADS = LEADS;
  Engine.BLOCKS = BLOCKS;
  Engine.BLOCK_ORDER = BLOCK_ORDER;
  Engine.blockDur = function (id) { return (BLOCKS[id] || BLOCKS.none).dur; };
  Engine.RHYTHMS = RHYTHMS;
  Engine.ARTEFAKTE = ARTEFAKTE;
  Engine.MED_GROUPS = MED_GROUPS;
  Engine.MEDS = MEDS;
  /* Welche EKG-Form gehoert zu diesem Serumkalium? Die Grenzen sind die
     gelaeufigen Lehrbuchstufen: Unter 3,5 mmol/l flacht die T-Welle ab und
     die U-Welle tritt hervor, ueber 5,3 wird die T-Welle hoch und spitz,
     danach verschwindet die P-Welle und der QRS-Komplex wird breit. */
  Engine.kaliumEkg = function (k) {
    if (k < 3.0)  return { tw: 'flach',  uw: 100, pamp: 110, qrs: 90,  st: -1 };
    if (k < 3.5)  return { tw: 'flach',  uw: 50,  pamp: 105, qrs: 90,  st: -0.5 };
    if (k < 5.3)  return { tw: 'normal', uw: 0,  pamp: 100, qrs: 90,  st: 0 };
    if (k < 6.5)  return { tw: 'hoch',   uw: 0,  pamp: 70,  qrs: 100, st: 0 };
    if (k < 7.5)  return { tw: 'hoch',   uw: 0,  pamp: 25,  qrs: 135, st: 0 };
    return          { tw: 'hoch',   uw: 0,  pamp: 0,   qrs: 175, st: 0 };
  };
  /* Welche J-Welle gehoert zu dieser Koerpertemperatur? Die Osborn-Welle
     taucht unterhalb von etwa 34 Grad auf und wird mit jedem Grad hoeher;
     beim Wiedererwaermen verschwindet sie wieder. */
  Engine.tempStage = function (t) {
    return t < 28 ? 0 : (t < 30 ? 1 : (t < 32 ? 2 : (t < 34 ? 3 : 4)));
  };
  Engine.tempEkg = function (t) {
    return { jw: [100, 80, 55, 25, 0][Engine.tempStage(t)] };
  };

  /* ---------- Defibrillation ---------- */

  /* ---------- Externer Schrittmacher ---------- */

  /* Reizschwelle in Volt. Darunter sieht man den Impuls, aber das Herz
     antwortet nicht - der klassische Exit-Block. */
  var PACE_THR = 2.5;

  var PACER_MODES = [
    ['aus', 'Aus',  null],
    ['aai', 'AAI',  'paced_aai'],
    ['vvi', 'VVI',  'paced_vvi'],
    ['ddd', 'DDD',  'paced_ddd']
  ];
  Engine.PACER_MODES = PACER_MODES;
  Engine.PACE_THR = PACE_THR;

  /* Die Betriebsart steht nicht doppelt im Zustand: Sie ergibt sich aus dem
     Rhythmus und wird beim Umstellen wieder in einen Rhythmus uebersetzt. */
  Engine.pacerMode = function (rhythm) {
    for (var i = 0; i < PACER_MODES.length; i++)
      if (PACER_MODES[i][2] === rhythm) return PACER_MODES[i][0];
    return 'aus';
  };
  Engine.pacerRhythm = function (mode) {
    for (var i = 0; i < PACER_MODES.length; i++)
      if (PACER_MODES[i][0] === mode) return PACER_MODES[i][2];
    return null;
  };

  /* ---------- Defibrillation ---------- */

  var DEFIB_ENERGIES = [120, 150, 200, 360];
  var CARDIO_ENERGIES = [50, 100, 150, 200];

  /* Was aus dem Schock wird, entscheidet der Instruktor vorher. Ein
     Defibrillator, der immer wirkt, nimmt dem Unterricht die Entscheidung
     ab; einer, der nie wirkt, ist nutzlos. */
  var OUTCOMES = {
    defib: [
      { id: 'kein', label: 'kein Erfolg', patch: null },
      { id: 'rosc', label: 'ROSC', patch: { rhythm: 'sinus', hr: 96, spo2: 88, sys: 102,
                                            dia: 60, cvp: 10, af: 14, artefakt: 'keine' } },
      { id: 'asys', label: 'Asystolie', patch: { rhythm: 'asystolie', spo2: 55, sys: 15, dia: 10 } }
    ],
    /* Bei der Kardioversion hat der Patient einen Puls. ROSC gibt es hier
       nicht; dafuer das Kammerflimmern als gefuerchtete Komplikation. */
    cardio: [
      { id: 'kein',  label: 'kein Erfolg',    patch: null },
      { id: 'sinus', label: 'Sinusrhythmus',  patch: { rhythm: 'sinus', hr: 82 } },
      { id: 'vf',    label: 'Kammerflimmern', patch: { rhythm: 'vf_grob', spo2: 70, sys: 20, dia: 12 } }
    ]
  };
  /* Rhythmen, bei denen ein Schock ueberhaupt angezeigt ist */
  var SHOCKABLE = { vf_grob: 1, vf_fein: 1, vt_pulslos: 1, torsade: 1 };
  /* Rhythmen, die man kardiovertiert: zu schnell, aber mit Auswurf */
  var CARDIOVERTIBLE = { afib: 1, aflutter: 1, svt: 1, avnrt: 1, avrt: 1, vt_puls: 1 };

  Engine.DEFIB_ENERGIES = DEFIB_ENERGIES;
  Engine.CARDIO_ENERGIES = CARDIO_ENERGIES;
  Engine.energies = function (mode) { return mode === 'cardio' ? CARDIO_ENERGIES : DEFIB_ENERGIES; };
  /* Rhythmen mit R-Zacke: nur auf die kann man synchronisieren. */
  Engine.hasR = function (r) {
    return r !== 'vf_grob' && r !== 'vf_fein' && r !== 'asystolie';
  };
  Engine.outcomes = function (mode) { return OUTCOMES[mode === 'cardio' ? 'cardio' : 'defib']; };
  Engine.DEFIB_BLANK = 4.0;                 /* Sekunden ohne verwertbares EKG */
  /* Ablauf um den Schock, wenn reanimiert wird: Waehrend des Ladens laufen
     die Kompressionen weiter. Auf das Kommando "Alle weg!" nimmt das Team
     die Haende vom Patienten, dann faellt der Schock, danach wird sofort
     weitergedrueckt. Die Leitlinie verlangt, dass diese Pause insgesamt
     unter fuenf Sekunden bleibt. */
  Engine.HANDS_OFF_PRE = 2.5;               /* "Alle weg!" bis zum Schock */
  Engine.HANDS_OFF_POST = 1.5;              /* Schock bis zur ersten Kompression */
  Engine.CPR_CYCLE = 120;                   /* ein Zyklus: zwei Minuten */
  Engine.perfusing = function (r) { return !NO_PERFUSION[r]; };

  /* Grenzen, ab denen der Zustand von selbst entgleist (s. control.js).
     Kalium: Eine feste Schwelle gibt es nicht, die EKG-Zeichen folgen dem
     Wert nur lose. Schwer ist die Hyperkaliaemie ab 6,5 bis 7,0 mmol/l,
     Sinuswellenmuster, Kammerflimmern und Asystolie werden meist erst um
     9 mmol/l beschrieben, koennen aber frueher auftreten. Der Simulator
     setzt die Grenze als didaktische Setzung bei 8,0.
     Druck: Bei invasiver Messung gilt ein systolischer Druck unter 50 mmHg,
     der sich nicht beheben laesst, als Kreislaufstillstand - ab da wird
     gedrueckt (Harper, Nolan, Soar, Cook 2020). */
  Engine.K_LETHAL = 8.0;
  Engine.SYS_LETHAL = 50;

  Engine.shockable = function (r) { return !!SHOCKABLE[r]; };
  Engine.cardiovertible = function (r) { return !!CARDIOVERTIBLE[r]; };

  /* Der Schock uebersteuert den Verstaerker. Danach ist das EKG fuer ein paar
     Sekunden unbrauchbar – genau das sieht man am Geraet, und genau deshalb
     wartet man nach dem Schock mit der Rhythmuskontrolle. */
  /* `pre` = Sekunden zwischen "Alle weg!" und dem Schock. Nur gesetzt, wenn
     gerade Thoraxkompressionen laufen. */
  Engine.prototype._handsOff = function (dur) {
    this._offVal = this._cprPress(this.t);
    this._offFrom = this.t;
    this._offUntil = this.t + dur;
    this._cprT0 = this._offUntil;         /* danach beginnt eine neue Serie */
  };
  Engine.prototype.defib = function (pre) {
    pre = pre > 0 ? pre : 0;
    if (pre && this.state.artefakt === 'cpr') this._handsOff(pre + Engine.HANDS_OFF_POST);
    this._defibAt = this.t + pre;
    this._syncPending = false;
  };

  /* Kardioversion: Der Schock wird nicht sofort abgegeben, sondern auf die
     naechste R-Zacke gelegt. Faellt er in die vulnerable Phase der T-Welle,
     kann er Kammerflimmern ausloesen - genau deshalb synchronisiert man. */
  Engine.prototype.cardiovert = function (pre) {
    pre = pre > 0 ? pre : 0;
    /* Die R-Zacke kommt innerhalb etwa einer Sekunde nach der Freigabe. */
    if (pre && this.state.artefakt === 'cpr') this._handsOff(pre + 1.0 + Engine.HANDS_OFF_POST);
    this._syncPending = true;
    this._syncArmed = this.t + pre;
  };
  Engine.prototype._defibBlank = function (t) {
    if (t === undefined) t = this.t;
    var d = t - this._defibAt;
    return d >= 0 && d < Engine.DEFIB_BLANK;
  };

  /* Eintrag der Therapiezeile: Medikament oder Schock. */
  Engine.entryHtml = function (g) {
    if (!g) return '';
    if (g.id === 'defi')
      return '<span class="medlab s-defi"><span class="inner">' +
             '<span class="nm">' + (g.s ? 'Kardioversion' : 'Defibrillation') + '</span>' +
             '<span class="ds">' + (g.e || '?') + ' J' + (g.s ? ' sync' : '') +
             '</span></span></span>';
    return Engine.medLabelHtml(Engine.medById(g.id));
  };

  /* Passt zu diesem Medikament und diesem Rhythmus eine Umschaltregel? */
  Engine.medConv = function (m, rhythm) {
    if (!m || !m.conv) return null;
    for (var i = 0; i < m.conv.length; i++)
      if (m.conv[i].from.indexOf(rhythm) >= 0) return m.conv[i];
    return null;
  };

  Engine.medById = function (id) {
    for (var i = 0; i < MEDS.length; i++) if (MEDS[i].id === id) return MEDS[i];
    return null;
  };

  /* Spritzenaufkleber im Kleinformat. Steuerung und Monitor zeichnen ihn aus
     derselben Quelle, damit am Monitor genau die Kennfarbe steht, die die
     Lernenden an der Spritze sehen. */
  Engine.medLabelHtml = function (m) {
    if (!m) return '';
    var st = '--c:' + m.col[0] + (m.col[1] ? ';--c2:' + m.col[1] : '');
    return '<span class="medlab s-' + m.iso + '" style="' + st + '">' +
           '<span class="inner"><span class="nm">' + m.name + '</span>' +
           '<span class="ds">' + m.dose + '</span></span></span>';
  };

  /* Spritzensymbol fuer die Medikationszeile */
  Engine.SYRINGE =
    '<svg class="syr" viewBox="0 0 28 14" fill="none" stroke="currentColor" ' +
    'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M1 7h5.6"/><path d="M6.6 5.2h2.1v3.6H6.6z"/>' +
    '<rect x="8.7" y="3" width="12" height="8" rx="0.7"/>' +
    '<path d="M11.7 3v8M14.5 3v8M17.3 3v8" stroke-width="0.8" opacity="0.7"/>' +
    '<path d="M20.7 7H24.2"/><path d="M24.2 3.7v6.6"/></svg>';
  Engine.rhythmLabel = function (id) {
    for (var g = 0; g < RHYTHMS.length; g++)
      for (var i = 0; i < RHYTHMS[g].items.length; i++)
        if (RHYTHMS[g].items[i][0] === id) return RHYTHMS[g].items[i][1];
    return id;
  };

  var NUMERIC = ['hr', 'spo2', 'sys', 'dia', 'cvp', 'af', 'vaso', 'ppv', 'st', 'qrs', 'pamp', 'qtf', 'uw', 'jw', 'pq'];

  /* Zustand von außen setzen. Zahlenwerte laufen über `transition` Sekunden.
     `ramp` = { dur, keys } laesst einzelne Werte stattdessen ueber eine eigene
     Zeit laufen – damit ein Medikament mit seiner Anschlagzeit anflutet, ohne
     die eingestellte Uebergangszeit zu veraendern. Die Anflutzeit bleibt an
     dem Wert haengen, bis sich sein Zielwert wieder aendert: die Steuerung
     schickt bei jeder Kleinigkeit den ganzen Zustand, ein laufendes
     Medikament darf dabei nicht durchschlagen. */
  Engine.prototype.apply = function (patch, ramp) {
    var self = this;
    var tr = patch.transition !== undefined ? patch.transition : this.state.transition;
    var rhythmChanged = patch.rhythm !== undefined && patch.rhythm !== this.state.rhythm;
    var rk = (ramp && ramp.keys) || [];
    /* Beginnen die Thoraxkompressionen neu, baut sich der Druck erst auf. */
    if (patch.artefakt === 'cpr' && this.state.artefakt !== 'cpr') {
      this._cprT0 = this.t;
      this._offFrom = 1e9; this._offUntil = -1e9;
    }
    /* Wird die Uebergangszeit selbst umgestellt, gilt sie sofort fuer alles,
       was gerade laeuft – auch fuer ein anflutendes Medikament. "sofort"
       heisst dann wirklich sofort. */
    var trChanged = patch.transition !== undefined && patch.transition !== this.state.transition;
    Object.keys(patch).forEach(function (k) {
      if (NUMERIC.indexOf(k) >= 0) {
        if (self.target[k] !== patch[k] || self._tgtRamp[k] === undefined) {
          self.target[k] = patch[k];
          self._tgtRamp[k] = rk.indexOf(k) >= 0 ? ramp.dur : tr;
        }
      } else if (k === 'patient' || k === 'show' || k === 'limits' || k === 'lab' ||
                 k === 'pacer' || k === 'defi') {
        self.state[k] = Object.assign({}, self.state[k], patch[k]);
      } else {
        self.state[k] = patch[k];
      }
    });
    /* Aendert sich der Druck, passen die zuletzt gemessenen Pulsdruecke nicht
       mehr zu den neuen. Das Messfenster wird verworfen, sonst zeigt der
       Monitor nach jedem Szenariowechsel kurz eine hohe PPV an. */
    if ((patch.sys !== undefined && patch.sys !== this.state.sys) ||
        (patch.dia !== undefined && patch.dia !== this.state.dia) ||
        (patch.ppv !== undefined && patch.ppv !== this.state.ppv)) {
      this._ppWin = [];
      this._ppSkip = 2;     /* die beiden Schlaege im Uebergang nicht werten */
    }

    this._rampT = tr;
    if (trChanged) NUMERIC.forEach(function (k) {
      if (rk.indexOf(k) < 0) self._tgtRamp[k] = tr;
    });
    /* Werte ohne eigene Anflutzeit sofort setzen – und zwar einzeln, damit
       ein anflutendes Medikament nicht mitspringt. */
    NUMERIC.forEach(function (k) {
      if (self.target[k] === undefined) return;
      if ((self._tgtRamp[k] || 0) <= 0) self.state[k] = self.target[k];
    });
    /* Rhythmuswechsel sofort wirksam: bereits vorausgeplante Schläge verwerfen. */
    if (rhythmChanged) {
      var t = this.t;
      this.vent = this.vent.filter(function (e) { return e.t <= t; });
      this.atrial = this.atrial.filter(function (e) { return e.t <= t; });
      this.spikes = this.spikes.filter(function (e) { return e.t <= t; });
      this._rrWin = this._rrWin.filter(function (x) { return x <= t; });
      this._lastVentT = this.vent.length ? this.vent[this.vent.length - 1].t : 0;
      this._cyc = 0;
      this._svesNow = false;
      this._lastVes = false;
      /* Das Schlagprotokoll gilt dem alten Rhythmus. Es wird verworfen, sonst
         meldet der Monitor noch eine Minute lang Extrasystolen, die es in
         diesem Fall gar nicht mehr gibt. Danach lernt er neu – genau das
         macht ein echtes Geraet nach einem Rhythmuswechsel auch. */
      this._hist = [];
      this._ppWin = [];
      this._ppSkip = 2;
      this._learnT = t;
      this.nextBeat = Math.max(t + 0.04, this._lastVentT + 0.22);
      this.nextP = t + 0.04;
    }
  };

  Engine.prototype.snapshot = function () {
    var s = JSON.parse(JSON.stringify(this.state));
    return s;
  };

  Engine.prototype._perfusing = function () {
    return !NO_PERFUSION[this.state.rhythm];
  };
  /* Wird zu diesem Zeitpunkt gedrueckt? In der Pause um den Schock nicht. */
  Engine.prototype._cprAt = function (t) {
    return this.state.artefakt === 'cpr' && !(t >= this._offFrom && t < this._offUntil);
  };
  Engine.prototype._cpr = function () {
    return this._cprAt(this.t);
  };

  /* Arterieller Druck unter Thoraxkompressionen. Er entsteht allein durch
     das Druecken: Mit jeder Kompression steigt er an, und der Druck zwischen
     den Kompressionen - der, von dem die Koronarien leben - baut sich erst
     ueber mehrere Kompressionen auf. Nimmt das Team die Haende weg, faellt
     er binnen einer Sekunde auf den Wert des Kreislaufstillstands. Deshalb
     ist jede Pause so teuer. */
  var CPR_T = 60 / 110, CPR_FLAT = 9;
  Engine.prototype._cprPress = function (t) {
    if (t >= this._offFrom && t < this._offUntil)
      return CPR_FLAT + (this._offVal - CPR_FLAT) * Math.exp(-(t - this._offFrom) / 0.42);
    var d = Math.max(0, t - this._cprT0);
    var build = 1 - Math.exp(-d / 2.4);
    return CPR_FLAT + 11 * build + (22 + 20 * build) * artShape(d % CPR_T, CPR_T);
  };

  /* ---------- Taktgeber ---------- */

  /* Die Hoehe der P-Welle laesst sich einstellen: bei Hyperkaliaemie wird sie
     flach und verschwindet schliesslich ganz. */
  /* Schrittmacherimpuls ohne Antwort des Herzens. Er zaehlt bewusst nicht
     als Schlag: Das Geraet reizt, aber es kommt nichts zurueck. */
  Engine.prototype._pushSpike = function (t, atrial) {
    this.spikes.push({ t: t, a: !!atrial });
  };

  Engine.prototype._pushP = function (t, amp, pace) {
    var a = (amp === undefined ? 0.16 : amp) * clamp(this.state.pamp, 0, 150) / 100;
    this.atrial.push({ t: t, amp: a, pace: !!pace });
  };

  /* Formen der T-Welle: Faktor auf Hoehe und Breite. Bei Hyperkaliaemie ist
     sie hoch und spitz, bei Ischaemie flach oder negativ. */
  var TWAVE = {
    normal:   { a: 1.00, w: 1.00 },
    hoch:     { a: 2.60, w: 0.60 },
    flach:    { a: 0.40, w: 0.90 },
    negativ:  { a: -1.10, w: 1.00 }
  };

  /* Verlauf der ST-Hebung bzw. -Senkung: setzt am J-Punkt an, traegt bis zum
     Gipfel der T-Welle durch und laeuft mit deren absteigendem Schenkel aus.
     So entsteht der zusammenhaengende Bogen, den man am Patienten sieht. */
  function stSeg(dt, qt, q, tw, early) {
    var a = 0.040 * q, b = qt * (early ? 0.40 : 0.60);
    if (dt < a - 0.035) return 0;
    if (dt < a) return (dt - (a - 0.035)) / 0.035;
    if (dt <= b) return 1;
    /* Bei der Hypokaliaemie (early) bleibt die Senkung in der ST-Strecke und
       gibt die flache T-Welle frei - sonst geht sie in der Senkung unter. */
    return gauss(dt - b, early ? qt * 0.10 : qt * 0.17 * (tw || 1));
  }

  /* U-Welle: eigener Gipfel kurz hinter der T-Welle, mit einer Senke
     dazwischen. 100 % sind 0,15 mV in Ableitung II und etwa das Dreifache
     in V2 bis V4 - dort deutlich groesser als die flache T-Welle der
     Hypokaliaemie. */
  var U_AMP = 0.15, U_AT = 1.04, U_W = 0.080;
  function uWave(dt, qt) { return gauss(dt - qt * U_AT, qt * U_W); }
  /* J-Welle: Hoecker direkt am Ende des QRS. 100 % sind 0,25 mV in II. */
  var J_AMP = 0.30, J_W = 0.017;
  function jAt(e) { return BLOCKS[e.blk || 'none'].off * (e.qw || 1) + 0.004; }
  Engine.jAt = jAt;

  Engine.prototype._pushQRS = function (t, o) {
    o = o || {};
    var hr = clamp(this.state.hr, 15, 300);
    /* QT-Zeit frequenzbezogen nach Bazett, dazu ein einstellbarer Faktor.
       Beim Long-QT-Syndrom liegt er mindestens bei 165 %, damit der Rhythmus
       auch ohne Regler wirkt. */
    var qf = clamp(this.state.qtf === undefined ? 100 : this.state.qtf, 60, 220);
    if (this.state.rhythm === 'longqt') qf = Math.max(qf, 165);
    var qt = 0.40 * Math.sqrt(60 / hr) * qf / 100;
    /* kurze Füllungszeit -> kleineres Schlagvolumen (Pulsdefizit bei VHF, VES) */
    var fill = 1;
    if (this._lastVentT > 0) {
      var ract = t - this._lastVentT;
      if (ract > 0 && ract < 4) fill = clamp(0.35 + 0.72 * (ract / (60 / hr)), 0.35, 1);
    }
    var strength = (o.strength === undefined ? 1 : o.strength) * fill * this._respSV(t);
    var tw = TWAVE[this.state.tw] || TWAVE.normal;
    /* Ein Block zeigt sich nur an uebergeleiteten Schlaegen. */
    var blk = (!o.wide && !o.pace && this.state.block && this.state.block !== 'none' &&
               BLOCKS[this.state.block]) ? this.state.block : null;
    this.vent.push({
      t: t,
      blk: blk,
      hp: !!o.hasP,
      dir: o.morph === 'vt' ? D_WIDE.vt : (o.morph === 'paced' ? D_WIDE.paced
         : (D_WIDE[o.vm] || ((o.pol || 1) < 0 ? D_WIDE.neg : D_WIDE.pos))),
      wide: !!o.wide,
      morph: o.morph || null,
      cyc: 60 / hr,
      pol: o.pol || 1,
      amp: o.amp === undefined ? 1 : o.amp,
      vw: o.vw || 1,                                   /* Breite polymorpher VES */
      pace: !!o.pace,
      /* rueckwaerts geleitete P-Welle: [Abstand zum QRS in s, Hoehe] */
      rp: o.rp || null,
      perf: o.perf === undefined ? this._perfusing() : o.perf,
      strength: strength,
      qt: qt,
      /* ST-Strecke und T-Form gelten nur fuer schmale Eigenkomplexe – an
         einer VES oder einem stimulierten Schlag misst auch das Geraet
         keine ST-Strecke. */
      qw: (o.wide || o.pace) ? 1
        : (blk ? clamp((this.state.qrs || BLOCKS[blk].dur) / BLOCKS[blk].dur, 0.7, 2.0)
               : clamp((this.state.qrs || 90) / 90, 0.8, 2.4)),
      st: (o.wide || o.pace) ? 0 : (this.state.st || 0) * 0.1,
      /* U-Welle: kleiner Nachschlag hinter der T-Welle, typisch fuer
         Hypokaliaemie. Nur an schmalen Eigenkomplexen. */
      uw: (o.wide || o.pace) ? 0 : clamp(this.state.uw || 0, 0, 100) / 100 * U_AMP,
      /* J-Welle (Osborn) bei Hypothermie, ebenfalls nur am schmalen Schlag */
      jw: (o.wide || o.pace) ? 0 : clamp(this.state.jw || 0, 0, 100) / 100 * J_AMP,
      tww: o.wide ? 1 : tw.w,
      twave: o.wide ? -0.30 * (o.pol || 1) : 0.26 * tw.a
    });
    /* Schlagprotokoll fuer die Rhythmusanalyse – mit denselben Kennbuchstaben,
       die der Monitor vergibt: N normal, S supraventrikulaere Extrasystole,
       V ventrikulaer, P stimuliert, J schmal ohne P-Welle. */
    /* Eine flache P-Welle sieht auch der Monitor nicht mehr: unter etwa einem
       Viertel der normalen Hoehe meldet er deshalb SV- statt Sinus-Rhythmus. */
    var seesP = o.hasP && clamp(this.state.pamp, 0, 150) >= 25;
    var lab = (o.pace || o.pacedLab) ? 'P'
            : (o.wide ? 'V' : (o.sves ? 'S' : (seesP ? 'N' : 'J')));
    this.vent[this.vent.length - 1].lab = lab;        /* fuer das 12-Kanal-EKG */
    this._hist.push({ t: t, lab: lab, vm: o.vm || 0 });
    if (lab === 'V' || lab === 'S') this._ectT = t;   /* letzte Extrasystole */
    while (this._hist.length && this._hist[0].t < t - 65) this._hist.shift();
    this._rrWin.push(t);
    if (this._rrWin.length > 12) this._rrWin.shift();
    this._lastVentT = t;
    if (this.onBeat) this.onBeat(t, o.perf === undefined ? this._perfusing() : o.perf);
  };

  /* Naechste VES-Form, moeglichst nicht dieselbe wie zuletzt. */
  Engine.prototype._vmorph = function () {
    var i = Math.floor(Math.random() * VMORPH.length);
    if (VMORPH[i].id === this._lastVm) i = (i + 1 + Math.floor(Math.random() * (VMORPH.length - 1))) % VMORPH.length;
    this._lastVm = VMORPH[i].id;
    return VMORPH[i];
  };

  /* Adenosin blockiert fuer wenige Sekunden den AV-Knoten. Es wird nicht
     ueber den Zustand verschickt, sondern als Befehl ausgeloest: Die Wirkung
     ist von sich aus voruebergehend und gehoert deshalb nicht in einen
     Zustand, der dauerhaft gilt. */
  Engine.prototype.adenosine = function () {
    this._adenoBlock = this.t + 5;   /* gar keine Ueberleitung */
    this._adeno = this.t + 9;        /* danach noch stark verlangsamt */
  };

  /* Was Adenosin bei diesem Rhythmus macht – der Text steht so im Protokoll. */
  Engine.adenoNote = function (r) {
    if (r === 'svt' || r === 'avnrt' || r === 'avrt')
      return 'der Kreis bricht zusammen: Pause, danach Sinusrhythmus';
    if (r === 'aflutter')
      return 'kurzer AV-Block – die Flatterwellen werden sichtbar, danach l\u00e4uft das Flattern weiter';
    if (r === 'afib')
      return 'kurzer AV-Block – die Flimmerwellen werden sichtbar, danach l\u00e4uft das Flimmern weiter';
    if (/^sinus/.test(r))
      return 'der Sinusrhythmus wird kurz langsamer';
    return 'am AV-Knoten wirkungslos – dieser Rhythmus entsteht woanders';
  };

  Engine.prototype._emit = function () {
    var s = this.state, r = s.rhythm, t = this.nextBeat;
    var hr = clamp(s.hr, 15, 300);
    var rr = 60 / hr;
    var jitter = function (f) { return rr * (1 + (Math.random() - 0.5) * f); };
    /* verlaengerte PQ-Zeit (Hypothermie, Medikamente): gilt fuer jeden
       uebergeleiteten Sinusschlag */
    var pqx = clamp(s.pq || 0, 0, 250) / 1000;

    /* Adenosin: Was am AV-Knoten haengt, kommt zum Stehen; was im Vorhof
       kreist, laeuft weiter und wird dabei erst richtig sichtbar. Genau
       deshalb gibt man es bei einer schmalen Tachykardie, deren Ursprung man
       nicht kennt. */
    if (t < this._adeno) {
      if (r === 'svt' || r === 'avnrt' || r === 'avrt') {
        /* Der kreisende Erregungslauf bricht ab: eine Pause, in der gar
           nichts kommt. Der Monitor meldet dann kurz Asystolie – so verhaelt
           sich ein echtes Geraet auch. */
        if (t < this._adenoBlock) { this.nextBeat = t + 0.25; return; }
      } else if (r === 'aflutter') {
        /* Hochgradiger Block: nur noch etwa jeder fuenfte Vorhofschlag wird
           uebergeleitet. Dazwischen liegt die Sagezahnlinie frei. */
        this._pushQRS(t);
        this.nextBeat = t + rr * 4.6;
        return;
      } else if (r === 'afib') {
        this._pushQRS(t);
        this.nextBeat = t + rr * (3.2 + 2.6 * Math.random());
        return;
      } else if (/^sinus/.test(r)) {
        this._pushP(t);
        this._pushQRS(t + 0.16 + pqx, { hasP: true });
        this.nextBeat = t + rr * 1.7;
        return;
      }
    }

    switch (r) {
      case 'asystolie': case 'vf_grob': case 'vf_fein':
        this.nextBeat = t + 0.4; return;

      case 'sinus': case 'sinusbrady': case 'sinustachy': case 'pea':
        this._pushP(t);
        this._pushQRS(t + 0.16 + pqx, { hasP: true });
        this.nextBeat = t + jitter(0.03); return;

      case 'sinusarrhythmie':
        this._pushP(t);
        this._pushQRS(t + 0.16 + pqx, { hasP: true });
        this.nextBeat = t + rr * (1 + 0.12 * Math.sin(2 * Math.PI * t * (s.af / 60)));
        return;

      case 'junktional':
        this._pushQRS(t, { amp: 0.9 });
        this.nextBeat = t + jitter(0.02); return;

      case 'afib':
        this._pushQRS(t);
        this.nextBeat = t + rr * (0.55 + 0.9 * Math.random()); return;

      case 'aflutter':
        this._pushQRS(t);
        this.nextBeat = t + jitter(0.01); return;

      case 'svt':
        this._pushQRS(t, { amp: 0.95 });
        this.nextBeat = t + jitter(0.005); return;

      /* AVNRT: die Erregung kreist im AV-Knoten. Streng regelmaessige
         schmale Tachykardie; die rueckwaerts geleitete P-Welle steckt im
         Ende des QRS. Der Monitor sieht keine P-Welle davor und meldet
         deshalb SV-Tachykardie. */
      case 'avnrt':
        this._pushQRS(t, { amp: 0.95, rp: [0.055, -0.135] });
        this.nextBeat = t + jitter(0.005); return;

      /* AVRT: die Erregung laeuft ueber ein zusaetzliches Buendel zurueck.
         Der Weg ist laenger, die negative P-Welle liegt deutlich abgesetzt
         in der ST-Strecke. */
      case 'avrt':
        this._pushQRS(t, { amp: 0.95, rp: [0.100, -0.200] });
        this.nextBeat = t + jitter(0.006); return;

      /* Long-QT: Sinusrhythmus, aber die Repolarisation zieht sich hin.
         Die T-Welle rueckt weit nach hinten – der Boden fuer eine Torsade. */
      case 'longqt':
        this._pushP(t);
        this._pushQRS(t + 0.17 + pqx, { hasP: true });
        this.nextBeat = t + jitter(0.03); return;

      /* Torsade de Pointes: polymorphe Kammertachykardie. Die Hauptachse
         dreht sich, dadurch kippt die Ausschlagsrichtung etwa jede Sekunde
         und die Amplitude laeuft spindelfoermig auf und ab. Auswurf gibt es
         noch, aber wenig – der Druck unduliert im Takt der Drehung. */
      case 'torsade': {
        var env = Math.sin(2 * Math.PI * t / 2.2);
        this._pushQRS(t, { wide: true, morph: 'vt', pol: env >= 0 ? 1 : -1,
                           amp: 0.45 + 0.85 * Math.abs(env),
                           strength: 0.50 + 0.50 * Math.abs(env), perf: true });
        this.nextBeat = t + jitter(0.10); return;
      }

      case 'vt_puls': case 'vt_pulslos':
        this._pushQRS(t, { wide: true, pol: 1, amp: 1.15, strength: 0.72,
                           morph: 'vt', perf: r === 'vt_puls' });
        this.nextBeat = t + jitter(0.02); return;

      case 'idioventrikulaer':
        this._pushQRS(t, { wide: true, pol: -1, amp: 1.0, strength: 0.8 });
        this.nextBeat = t + jitter(0.06); return;

      /* Schrittmacher. Liegt der Ausgang unter der Reizschwelle, sieht man
         den Impuls, aber das Herz antwortet nicht. */
      case 'paced_aai': {                                // Vorhof stimuliert, Eigenleitung
        var pa = s.pacer || {};
        if ((pa.outA === undefined ? 5 : pa.outA) >= PACE_THR) {
          this._pushP(t, 0.17, true);
          this._pushQRS(t + 0.17, { pacedLab: true, hasP: true });
        } else {
          this._pushSpike(t, true);
        }
        this.nextBeat = t + jitter(0.004); return;
      }

      case 'paced_vvi': {                                // nur Kammer stimuliert
        var pv = s.pacer || {};
        if ((pv.outV === undefined ? 8 : pv.outV) >= PACE_THR)
          this._pushQRS(t, { wide: true, pol: -1, amp: 1.0, pace: true, morph: 'paced' });
        else
          this._pushSpike(t, false);
        this.nextBeat = t + jitter(0.004); return;
      }

      case 'paced_ddd': {                                // beide Ebenen stimuliert
        var pd = s.pacer || {};
        var av = clamp(pd.av === undefined ? 180 : pd.av, 60, 350) / 1000;
        if ((pd.outA === undefined ? 5 : pd.outA) >= PACE_THR) this._pushP(t, 0.17, true);
        else this._pushSpike(t, true);
        if ((pd.outV === undefined ? 8 : pd.outV) >= PACE_THR)
          this._pushQRS(t + av, { wide: true, pol: -1, amp: 1.0, pace: true, morph: 'paced' });
        else
          this._pushSpike(t + av, false);
        this.nextBeat = t + jitter(0.004); return;
      }

      case 'ves':                                            // immer dieselbe Form
        if (!this._lastVes && Math.random() < 0.14) {
          this._pushQRS(t - rr * 0.35, { wide: true, pol: -1, amp: 1.25, vm: 1, strength: 0.35 });
          this._lastVes = true;
          this.nextBeat = t + rr * 1.25;                       // kompensatorische Pause
        } else {
          this._lastVes = false;
          this._pushP(t); this._pushQRS(t + 0.16 + pqx, { hasP: true });
          this.nextBeat = t + jitter(0.03);
        }
        return;

      case 'ves_poly': {                                       // wechselnder Ursprung
        if (!this._lastVes && Math.random() < 0.17) {
          var m = this._vmorph();
          this._pushQRS(t - rr * 0.35, { wide: true, pol: m.pol, amp: m.amp, vw: m.w,
                                         vm: m.id, strength: 0.33 });
          this._lastVes = true;
          this.nextBeat = t + rr * 1.25;
        } else {
          this._lastVes = false;
          this._pushP(t); this._pushQRS(t + 0.16 + pqx, { hasP: true });
          this.nextBeat = t + jitter(0.03);
        }
        return;
      }

      /* SVES: vorzeitiger Vorhofschlag, schmaler Kammerkomplex, danach eine
         unvollstaendige kompensatorische Pause – der Sinusknoten wird mit
         zurueckgesetzt. Der Schlag davor wird verkuerzt angesetzt, damit die
         Extrasystole wirklich vorzeitig faellt. */
      case 'sves': {
        if (this._svesNow) {
          this._pushP(t, 0.12);
          this._pushQRS(t + 0.15, { sves: true, hasP: true, amp: 0.95 });
          this._svesNow = false;
          this.nextBeat = t + rr * 1.08;
        } else {
          this._pushP(t); this._pushQRS(t + 0.16 + pqx, { hasP: true });
          if (this._cyc % 6 === 5) { this._svesNow = true; this.nextBeat = t + rr * 0.60; }
          else this.nextBeat = t + jitter(0.03);
        }
        this._cyc++; return;
      }

      case 'sves_poly': {                                      // multifokal: P' wechselt
        if (this._svesNow) {
          this._pushP(t, 0.07 + Math.random() * 0.12);
          this._pushQRS(t + 0.11 + Math.random() * 0.10, { sves: true, hasP: true, amp: 0.92 });
          this._svesNow = false;
          this.nextBeat = t + rr * (1.02 + Math.random() * 0.12);
        } else {
          this._pushP(t); this._pushQRS(t + 0.16 + pqx, { hasP: true });
          if (Math.random() < 0.17) { this._svesNow = true; this.nextBeat = t + rr * (0.52 + Math.random() * 0.22); }
          else this.nextBeat = t + jitter(0.03);
        }
        return;
      }

      case 'bigeminus':
        if (this._cyc % 2 === 0) {
          this._pushP(t); this._pushQRS(t + 0.16 + pqx, { hasP: true });
          this.nextBeat = t + rr * 0.52;
        } else {
          this._pushQRS(t, { wide: true, pol: -1, amp: 1.25, vm: 1, strength: 0.3 });
          this.nextBeat = t + rr * 1.48;
        }
        this._cyc++; return;

      case 'trigeminus':
        /* Jeder dritte Schlag ist eine VES: N N V, N N V ... */
        if (this._cyc % 3 === 2) {
          this._pushQRS(t, { wide: true, pol: -1, amp: 1.25, vm: 1, strength: 0.3 });
          this.nextBeat = t + rr * 1.45;
        } else {
          this._pushP(t); this._pushQRS(t + 0.16 + pqx, { hasP: true });
          this.nextBeat = t + (this._cyc % 3 === 1 ? rr * 0.58 : rr);
        }
        this._cyc++; return;

      case 'couplet':
        if (this._cyc > 0 && this._cyc % 7 === 0) {
          this._pushQRS(t, { wide: true, pol: -1, amp: 1.25, vm: 1, strength: 0.3 });
          this._pushQRS(t + 0.34, { wide: true, pol: -1, amp: 1.2, vm: 1, strength: 0.25 });
          this.nextBeat = t + 0.34 + rr * 1.3;
        } else {
          this._pushP(t); this._pushQRS(t + 0.16 + pqx, { hasP: true });
          this.nextBeat = t + jitter(0.03);
        }
        this._cyc++; return;

      case 'avb1':
        this._pushP(t); this._pushQRS(t + 0.30 + pqx, { hasP: true });
        this.nextBeat = t + jitter(0.02); return;

      case 'avb2a': {                                          // Wenckebach 4:3
        var pr = [0.17, 0.25, 0.34, null][this._cyc % 4];
        this._pushP(t);
        if (pr !== null) this._pushQRS(t + pr, { hasP: true });
        this.nextBeat = t + rr;
        this._cyc++; return;
      }

      case 'avb2b': {                                          // Mobitz II 3:2
        this._pushP(t);
        if (this._cyc % 3 !== 2) this._pushQRS(t + 0.18, { hasP: true });
        this.nextBeat = t + rr;
        this._cyc++; return;
      }

      case 'avb3':
        this._pushQRS(t, { wide: true, pol: -1, amp: 1.0 });
        this.nextBeat = t + jitter(0.03); return;

      default:
        this._pushP(t); this._pushQRS(t + 0.16 + pqx, { hasP: true });
        this.nextBeat = t + jitter(0.03); return;
    }
  };

  Engine.prototype.update = function (dt) {
    var s = this.state, self = this;
    dt = clamp(dt, 0, 0.25);
    this.t += dt;
    this._respPh += dt * 2 * Math.PI * (clamp(s.af, 1, 60) / 60);
    if (this._respPh > 1e5) this._respPh -= 1e5;

    /* Zahlenwerte angleichen */
    NUMERIC.forEach(function (k) {
      var tgt = self.target[k];
      if (tgt === undefined || tgt === s[k]) return;
      var rt = self._tgtRamp[k] === undefined ? self._rampT : self._tgtRamp[k];
      if (rt <= 0) { s[k] = tgt; return; }
      var step = Math.abs(tgt - s[k]) / Math.max(0.2, rt) * dt * 2.2;
      var d = tgt - s[k];
      s[k] = Math.abs(d) <= step ? tgt : s[k] + sgn(d) * step;
    });
    if (s.dia > s.sys - 10) s.dia = s.sys - 10;

    /* Schläge vorausplanen */
    var guard = 0;
    while (this.nextBeat < this.t + 0.4 && guard++ < 400) this._emit();

    /* AV-Block III: Vorhöfe laufen unabhängig weiter */
    if (s.rhythm === 'avb3') {
      while (this.nextP < this.t + 0.4) { this._pushP(this.nextP); this.nextP += 60 / 78; }
    } else {
      this.nextP = this.t + 0.2;
    }

    /* alte Ereignisse verwerfen */
    var cut = this.t - 3;
    while (this.atrial.length && this.atrial[0].t < cut) this.atrial.shift();
    while (this.vent.length && this.vent[0].t < cut) this.vent.shift();
    while (this.spikes.length && this.spikes[0].t < cut) this.spikes.shift();

    /* Wartet eine Kardioversion auf die R-Zacke? Dann faellt der Schock
       genau auf den naechsten Kammerkomplex. */
    if (this._syncPending) {
      for (var si = 0; si < this.vent.length; si++) {
        var sb = this.vent[si];
        if (sb.t > this._syncArmed && sb.t <= this.t) {
          this._syncPending = false;
          this._defibAt = sb.t;
          break;
        }
      }
      /* Kommt nichts, gibt das Geraet nach sechs Sekunden auf. */
      if (this._syncPending && this.t - this._syncArmed > 6) this._syncPending = false;
    }

    this._measurePP();
  };

  /* ---------- Kurvenwerte ---------- */

  Engine.prototype.ecgAt = function (t) {
    var s = this.state, i, v = 0;

    /* Schock: erst der uebersteuerte Ausschlag, dann die Erholung des
       Verstaerkers. In dieser Zeit ist nichts abzulesen. */
    var dd = t - this._defibAt;
    if (dd >= 0 && dd < Engine.DEFIB_BLANK) {
      if (dd < 0.07) return 3.4;
      var rec = dd - 0.07;
      return 1.5 * Math.exp(-rec * 2.6) * Math.cos(rec * 4.2)
           + 0.018 * Math.sin(t * 2.1) + 0.012 * Math.sin(t * 17.3)
           + (s.artefakt === 'cpr' ? this._artefakt(t) : 0);
    }

    if (s.artefakt === 'elektrode') {
      return 0.04 * Math.sin(t * 23.7) + 0.03 * Math.sin(t * 61.3 + 1.7) + 0.05 * Math.sin(t * 1.3);
    }

    for (i = 0; i < this.spikes.length; i++) {
      var sp = this.spikes[i], ds = t - sp.t;
      if (ds > -0.012 && ds < 0.024) v += spike(ds, sp.a ? 0.75 : 1.3);
    }
    for (i = 0; i < this.atrial.length; i++) {
      var a = this.atrial[i], dp = t - a.t;
      if (dp < -0.12 || dp > 0.22) continue;
      if (a.pace) {
        v += spike(dp, 0.75);          // Vorhofspike kleiner als der Kammerspike
        dp -= 0.022;                                     // P-Welle folgt dem Spike
      }
      v += a.amp * gauss(dp, 0.028);
    }
    for (i = 0; i < this.vent.length; i++) {
      var e = this.vent[i], dt = t - e.t;
      /* Bei langem QT reicht die T-Welle weit in den Zyklus hinein – das
         Fenster muss sie noch erfassen. */
      if (dt < -0.03 || dt > 1.15) continue;
      if (e.pace) v += spike(dt);
      /* Bei AVNRT faellt die rueckwaerts geleitete P-Welle in das Ende des
         QRS (Pseudo-S in Ableitung II), bei der AVRT liegt sie abgesetzt in
         der ST-Strecke. */
      if (e.rp) v += e.rp[1] * gauss(dt - e.rp[0], 0.026);
      if (e.morph === 'vt') {
        /* breite Komplexe, die bei hoher Frequenz ineinander uebergehen */
        var k = clamp(e.cyc / 0.35, 0.7, 1.6);
        v += e.amp * e.pol * (gauss(dt - 0.03 * k, 0.055 * k) - 0.58 * gauss(dt - 0.175 * k, 0.078 * k));
      } else if (e.morph === 'paced') {
        /* Der Komplex setzt erst nach dem Spike ein, sonst verdeckt er ihn. */
        v += e.amp * e.pol * (0.95 * gauss(dt - 0.055, 0.034) - 0.40 * gauss(dt - 0.140, 0.042));
        v += e.twave * gauss(dt - e.qt * 0.66, e.qt * 0.20);
      } else if (!e.wide && e.blk) {
        v += this._blockII(e, dt);
      } else if (!e.wide) {
        var q = e.qw || 1;
        v += e.amp * (-0.09 * gauss(dt + 0.024 * q, 0.010 * q) + gauss(dt, 0.0125 * q)
                      - 0.25 * gauss(dt - 0.031 * q, 0.015 * q));
        v += e.twave * gauss(dt - e.qt * 0.60, e.qt * 0.17 * (e.tww || 1));
        if (e.st) v += e.st * stSeg(dt, e.qt, q, e.tww || 1, e.uw > 0);
        if (e.uw) v += e.uw * uWave(dt, e.qt);
        if (e.jw) v += e.jw * gauss(dt - jAt(e), J_W * q);
      } else {
        var w = e.vw || 1;
        v += e.amp * e.pol * (0.95 * gauss(dt - 0.022 * w, 0.034 * w) - 0.42 * gauss(dt - 0.105 * w, 0.042 * w));
        v += e.twave * gauss(dt - e.qt * 0.62, e.qt * 0.20);
      }
    }
    return v + this._baseline(t) + this._artefakt(t);
  };

  /* Schlag mit Schenkelblock in Ableitung II - dieselben Teilvektoren wie
     im 12-Kanal-EKG, auf die Ableitung des Monitors projiziert. */
  Engine.prototype._blockII = function (e, dt) {
    var b = BLOCKS[e.blk], q = e.qw || 1, v = 0, i, tww = e.tww || 1, sh = b.sh * q;
    for (i = 0; i < b.c.length; i++)
      v += e.amp * b.cII[i] * gauss(dt - b.c[i][0] * q, b.c[i][1] * q);
    v += (e.twave / 0.26) * b.tII * gauss(dt - sh - e.qt * 0.60, e.qt * 0.17 * tww);
    if (e.st) v += e.st * stSeg(dt - sh, e.qt, 1, tww, e.uw > 0);
    if (b.stII) v += b.stII * stSeg(dt - sh, e.qt, 1, tww);
    if (e.uw) v += e.uw * uWave(dt - sh, e.qt);
    if (e.jw) v += e.jw * gauss(dt - jAt(e), J_W * q);
    return v;
  };

  /* Herzvektor zum Zeitpunkt t. Jeder Anteil steht mit seiner eigenen
     Richtung im Raum; die Zeitverlaeufe sind dieselben wie in ecgAt(). */
  Engine.prototype.vecAt = function (t) {
    var h = [0, 0, 0], i, k, r = this.state.rhythm;
    function add(D, a) { if (a) { h[0] += D[0] * a; h[1] += D[1] * a; h[2] += D[2] * a; } }

    for (i = 0; i < this.spikes.length; i++) {
      var sp = this.spikes[i], ds = t - sp.t;
      if (ds > -0.012 && ds < 0.024) add(D_SPK, spike(ds, sp.a ? 0.75 : 1.3));
    }
    for (i = 0; i < this.atrial.length; i++) {
      var a = this.atrial[i], dp = t - a.t;
      if (dp < -0.12 || dp > 0.22) continue;
      if (a.pace) { add(D_SPK, spike(dp, 0.75)); dp -= 0.022; }
      add(D_P, a.amp * gauss(dp, 0.028));
    }
    for (i = 0; i < this.vent.length; i++) {
      var e = this.vent[i], dt = t - e.t;
      if (dt < -0.08 || dt > 1.15) continue;
      if (e.pace) add(D_SPK, spike(dt));
      if (e.rp) add(D_P, e.rp[1] * gauss(dt - e.rp[0], 0.026));
      if (e.morph === 'vt') {
        var kk = clamp(e.cyc / 0.35, 0.7, 1.6);
        add(e.dir, e.amp * e.pol * (gauss(dt - 0.03 * kk, 0.055 * kk) - 0.58 * gauss(dt - 0.175 * kk, 0.078 * kk)));
      } else if (e.morph === 'paced') {
        add(e.dir, e.amp * e.pol * (0.95 * gauss(dt - 0.055, 0.034) - 0.40 * gauss(dt - 0.140, 0.042)));
        add(e.dir, e.twave * gauss(dt - e.qt * 0.66, e.qt * 0.20));
      } else if (!e.wide) {
        var b = BLOCKS[e.blk || 'none'], q = e.qw || 1, tww = e.tww || 1, sh = b.sh * q;
        for (k = 0; k < b.c.length; k++) {
          var c = b.c[k], g = e.amp * gauss(dt - c[0] * q, c[1] * q);
          if (g) { h[0] += c[2] * g; h[1] += c[3] * g; h[2] += c[4] * g; }
        }
        add(b.t, (e.twave / 0.26) * gauss(dt - sh - e.qt * 0.60, e.qt * 0.17 * tww));
        if (e.st) add(e.st > 0 ? D_STUP : D_STDN, e.st * stSeg(dt - sh, e.qt, e.blk ? 1 : q, tww, e.uw > 0));
        if (b.st) add(b.st, stSeg(dt - sh, e.qt, 1, tww));
        if (e.uw) add(D_U, e.uw * uWave(dt - sh, e.qt));
        if (e.jw) add(D_J, e.jw * gauss(dt - jAt(e), J_W * q));
      } else {
        var w = e.vw || 1;
        add(e.dir, e.amp * e.pol * (0.95 * gauss(dt - 0.022 * w, 0.034 * w) - 0.42 * gauss(dt - 0.105 * w, 0.042 * w)));
        add(e.dir, e.twave * gauss(dt - e.qt * 0.62, e.qt * 0.20));
      }
    }

    /* Grundlinie */
    add(D_BASE, 0.015 * Math.sin(t * 0.63 + this._phase));
    if (r === 'vf_grob' || r === 'vf_fein') {
      /* Kammerflimmern hat keine feste Achse: drei gegeneinander versetzte
         Verlaeufe, so gemischt, dass Ableitung II der Monitorkurve gleicht. */
      var v0 = this._rhythmBase(t), v1 = this._rhythmBase(t + 0.37), v2 = this._rhythmBase(t + 0.91);
      h[0] += 0.8 * v1; h[1] += (v0 - 0.4 * v1) / 0.866; h[2] += 0.9 * v2;
    } else {
      add(r === 'afib' ? D_AF : (r === 'aflutter' ? D_FL : D_BASE), this._rhythmBase(t));
    }
    return h;
  };

  /* Alle zwoelf Ableitungen zu einem Zeitpunkt. */
  Engine.prototype.ecg12At = function (t, out) {
    out = out || new Array(12);
    var i, dd = t - this._defibAt;
    if ((dd >= 0 && dd < Engine.DEFIB_BLANK) || this.state.artefakt === 'elektrode') {
      var x = this.ecgAt(t);
      for (i = 0; i < 12; i++) out[i] = x;
      return out;
    }
    var h = this.vecAt(t), art = this._artefakt(t);
    for (i = 0; i < 12; i++)
      out[i] = h[0] * LVEC[i][0] + h[1] * LVEC[i][1] + h[2] * LVEC[i][2] + art;
    return out;
  };

  /* Beginn und Ende des Kammerkomplexes, bezogen auf den Zeitpunkt des
     Schlags. Steht so im Modell und muss deshalb nicht gemessen werden. */
  Engine.qrsWindow = function (e) {
    if (e.morph === 'vt') {
      var k = clamp(e.cyc / 0.35, 0.7, 1.6);
      return [(0.03 - 1.4 * 0.055) * k, (0.03 + 1.4 * 0.055) * k];
    }
    if (e.morph === 'paced') return [0.055 - 1.8 * 0.034, 0.150];
    if (e.wide) { var w = e.vw || 1; return [(0.022 - 1.8 * 0.034) * w, 0.115 * w]; }
    var b = BLOCKS[e.blk || 'none'], q = e.qw || 1;
    return [b.on * q, b.off * q];
  };
  /* Ende der T-Welle, ebenfalls bezogen auf den Schlag. */
  Engine.tEnd = function (e) {
    if (e.morph === 'vt') return null;
    if (e.wide) return e.qt * (e.morph === 'paced' ? 0.66 : 0.62) + 1.9 * e.qt * 0.20;
    var b = BLOCKS[e.blk || 'none'];
    return b.sh * (e.qw || 1) + e.qt * 0.60 + 1.9 * e.qt * 0.17 * (e.tww || 1);
  };

  /* Schreibt ein 12-Kanal-EKG: Eine eigene Engine wird mit dem Zustand
     geladen, laeuft ein paar Sekunden vor und zeichnet dann `dur` Sekunden
     auf. Der Zufall kommt aus `seed` - zwei Fenster, die denselben Zustand
     und dieselbe Zahl bekommen, schreiben deshalb dasselbe EKG. */
  Engine.write12 = function (state, seed, dur) {
    dur = dur || 10;
    var fs = 500, n = Math.round(dur * fs), LAG = 0.6, i, k;
    var st = JSON.parse(JSON.stringify(state));
    st.transition = 0;
    var sd = (seed >>> 0) || 1, rnd = Math.random;
    Math.random = function () {
      sd = (sd + 0x6D2B79F5) | 0;
      var z = Math.imul(sd ^ (sd >>> 15), sd | 1);
      z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
    var out = { fs: fs, n: n, dur: dur, leads: [], beats: [], ps: [], state: st };
    for (k = 0; k < 12; k++) out.leads.push(new Float32Array(n));
    try {
      var e = new Engine();
      e.apply(st);
      NUMERIC.forEach(function (key) { if (st[key] !== undefined) e.state[key] = st[key]; });
      for (i = 0; i < 1500; i++) e.update(0.004);
      var t0 = e.t - LAG, buf = new Array(12);
      var collect = function () {
        var j, ev;
        for (j = 0; j < e.vent.length; j++) {
          ev = e.vent[j];
          if (!ev._w) { ev._w = 1; if (ev.t > t0 - 0.5) out.beats.push(ev); }
        }
        for (j = 0; j < e.atrial.length; j++) {
          ev = e.atrial[j];
          if (!ev._w) { ev._w = 1; if (ev.t > t0 - 0.8) out.ps.push(ev); }
        }
      };
      for (i = 0; i < n; i++) {
        e.update(1 / fs);
        collect();
        e.ecg12At(e.t - LAG, buf);
        for (k = 0; k < 12; k++) out.leads[k][i] = buf[k];
      }
      out.beats = out.beats.map(function (ev) {
        var w = Engine.qrsWindow(ev), te = Engine.tEnd(ev);
        return { t: ev.t - t0, on: ev.t - t0 + w[0], off: ev.t - t0 + w[1],
                 tend: te === null ? null : ev.t - t0 + te,
                 wide: !!ev.wide, pace: !!ev.pace, hp: !!ev.hp, blk: ev.blk || null,
                 /* fuer das Kriterien-Overlay: Art des Schlags, rueckwaerts
                    geleitete P-Welle und U-Welle mit ihrem Zeitpunkt */
                 lab: ev.lab || null, morph: ev.morph || null,
                 /* Gipfel der T-Welle */
                 tp: ev.morph === 'vt' ? null : ev.t - t0 +
                     (ev.wide ? ev.qt * (ev.morph === 'paced' ? 0.66 : 0.62)
                              : BLOCKS[ev.blk || 'none'].sh * (ev.qw || 1) + ev.qt * 0.60),
                 rp: ev.rp ? ev.t - t0 + ev.rp[0] : null,
                 u: ev.uw ? ev.t - t0 + BLOCKS[ev.blk || 'none'].sh * (ev.qw || 1) + ev.qt * U_AT : null,
                 j: ev.jw ? ev.t - t0 + jAt(ev) : null };
      }).sort(function (a, b) { return a.t - b.t; });
      out.ps = out.ps.map(function (ev) { return { t: ev.t - t0, pace: !!ev.pace, amp: ev.amp }; })
                     .sort(function (a, b) { return a.t - b.t; });
    } finally {
      Math.random = rnd;
    }
    return out;
  };

  /* Liegt dieser Zeitpunkt in einem Stimulationsimpuls? Der Monitor zeichnet
     die Spikes dann in einer eigenen Farbe. */
  Engine.prototype.isSpike = function (t) {
    var i, d;
    for (i = 0; i < this.spikes.length; i++) {
      d = t - this.spikes[i].t;
      if (d > -0.012 && d < 0.024) return true;
    }
    for (i = 0; i < this.atrial.length; i++) {
      if (!this.atrial[i].pace) continue;
      d = t - this.atrial[i].t;
      if (d > -0.012 && d < 0.024) return true;
    }
    for (i = 0; i < this.vent.length; i++) {
      if (!this.vent[i].pace) continue;
      d = t - this.vent[i].t;
      if (d > -0.012 && d < 0.024) return true;
    }
    return false;
  };

  Engine.prototype._baseline = function (t) {
    return 0.015 * Math.sin(t * 0.63 + this._phase) + this._rhythmBase(t);
  };
  /* Was der Rhythmus selbst zur Grundlinie beitraegt: Flimmer- und
     Flatterwellen, Kammerflimmern, die Nulllinie der Asystolie. */
  Engine.prototype._rhythmBase = function (t) {
    var r = this.state.rhythm;
    var v = 0;
    if (r === 'afib') {
      v += 0.040 * Math.sin(2 * Math.PI * 7.1 * t) + 0.028 * Math.sin(2 * Math.PI * 11.7 * t + 1.1)
         + 0.022 * Math.sin(2 * Math.PI * 5.1 * t + 2.3);
    } else if (r === 'aflutter') {
      var ph = (t * 5) % 1;                                    // 300/min
      v += 0.16 * (ph < 0.8 ? (0.4 - ph) : (ph - 0.8) * 4 - 0.4);
    } else if (r === 'vf_grob' || r === 'vf_fein') {
      var a = r === 'vf_grob' ? 0.62 : 0.17;
      v += a * (0.60 * Math.sin(2 * Math.PI * 4.6 * t + 1.3 * Math.sin(2 * Math.PI * 0.37 * t))
              + 0.32 * Math.sin(2 * Math.PI * 7.4 * t + 2.1 * Math.sin(2 * Math.PI * 0.23 * t))
              + 0.26 * Math.sin(2 * Math.PI * 2.9 * t + 0.6));
    } else if (r === 'asystolie') {
      v += 0.012 * Math.sin(t * 31.1) + 0.009 * Math.sin(t * 7.7 + 1.2);
    }
    return v;
  };

  Engine.prototype._artefakt = function (t) {
    var a = this.state.artefakt;
    if (a === 'netz') return 0.055 * Math.sin(2 * Math.PI * 50 * t);
    /* Kaeltezittern: feine, unregelmaessige Zacken um 8 bis 12 Hz, die in
       Schueben an- und abschwellen */
    if (a === 'zittern') {
      var sw = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.37 * t) * Math.sin(2 * Math.PI * 0.11 * t + 1.3);
      return sw * (0.050 * Math.sin(2 * Math.PI * 8.7 * t) + 0.038 * Math.sin(2 * Math.PI * 11.3 * t + 0.7)
                 + 0.030 * Math.sin(2 * Math.PI * 14.9 * t + 2.1) + 0.022 * Math.sin(2 * Math.PI * 6.1 * t + 0.4));
    }
    if (a === 'bewegung') {
      var env = Math.max(0, Math.sin(2 * Math.PI * 0.22 * t) - 0.3);
      return env * (0.5 * Math.sin(2 * Math.PI * 6.3 * t) + 0.35 * Math.sin(2 * Math.PI * 13.9 * t + 0.9)
                  + 0.25 * Math.sin(2 * Math.PI * 2.1 * t));
    }
    if (a === 'cpr') {
      /* In der Pause um den Schock liegt das EKG frei: Jetzt - und nur jetzt -
         ist der Rhythmus zu beurteilen. */
      if (!this._cprAt(t)) return 0;
      var ph = (Math.max(0, t - this._cprT0) % CPR_T) / CPR_T;
      return 0.55 * Math.sin(2 * Math.PI * ph) * (1 - 0.3 * Math.sin(2 * Math.PI * 0.3 * t));
    }
    return 0;
  };

  /* Fortlaufende Atemphase. So springt die Kurve nicht, wenn die
     Atemfrequenz verstellt wird. */
  Engine.prototype._respPhase = function (t) {
    return this._respPh + (t - this.t) * 2 * Math.PI * (this.state.af / 60);
  };
  Engine.prototype._resp = function (t) {
    return 1 + 0.020 * Math.sin(this._respPhase(t));
  };

  /* Schwankung des Schlagvolumens mit der Beatmung. Bei knapper oder
     wechselnder Vorlast fuellt sich das Herz von Schlag zu Schlag
     unterschiedlich stark – die Druckkurve unduliert, daraus rechnet man die
     Pulsdruckvariation. Die halbe Amplitude ist ppv/2, damit
     (PPmax - PPmin) / PPmittel genau den eingestellten Wert ergibt; geteilt
     wird durch (1 + a), damit der hoechste Schlag den eingestellten
     systolischen Druck erreicht und nicht darueber hinausschiesst.
     Vereinfachung: eine Sinusschwingung statt des realen Verlaufs mit
     frueher Zunahme und spaeterem Abfall des Auswurfs. */
  /* Zusaetzlich hebt und senkt die Beatmung die ganze Kurve, weil sich der
     Druck im Brustkorb auf die Arterie uebertraegt. Das ist der Anteil, den
     man am Monitor als Undulieren sieht. Er wird addiert und nicht
     multipliziert, damit er die Blutdruckamplitude und damit die gemessene
     PPV nicht verfaelscht. */
  Engine.prototype._respBase = function (t) {
    var a = 1.4 + clamp(this.state.ppv || 0, 0, 40) * 0.10;
    return a * Math.sin(this._respPhase(t) - 1.1);
  };

  Engine.prototype._respSV = function (t) {
    var a = clamp(this.state.ppv || 0, 0, 40) / 200;
    if (a <= 0) return 1;
    return (1 + a * Math.sin(this._respPhase(t) - 1.1)) / (1 + a);
  };

  Engine.prototype.artAt = function (t) {
    var s = this.state;
    var cp = s.artefakt === 'cpr' ? this._cprPress(t) : null;
    if (cp !== null && !this._perfusing())
      return cp * this._resp(t) + 0.5 * Math.sin(t * 1.7) + 0.2 * Math.sin(t * 9);
    if (!this._perfusing()) return 9 + 0.8 * Math.sin(t * 1.7) + 0.3 * Math.sin(t * 9);
    var cyc = 60 / clamp(s.hr, 15, 300);
    var vd = clamp(s.vaso || 0, 0, 100) / 100;
    var v0 = artShape(cyc, cyc, vd);             // Restwert kurz vor dem naechsten Schlag
    var v = 0, bt = t;
    for (var i = 0; i < this.vent.length; i++) {
      var e = this.vent[i];
      if (!e.perf) continue;
      var dt = t - e.t;
      if (dt >= 0 && e.t > bt - 1.6 && e.t <= t) bt = e.t;
      if (dt < 0 || dt > 1.6) continue;
      var x = e.strength * artShape(dt, cyc, vd);
      if (x > v) v = x;
    }
    v = (v - v0) / (1 - v0);
    if (v < 0) v = 0;
    var own = s.dia + (s.sys - s.dia) * v + this._respBase(bt);
    /* Eigener Auswurf unter laufenden Kompressionen: Zu sehen ist, was
       gerade hoeher ist. So waechst der eigene Puls nach einem erfolgreichen
       Schock durch die Kompressionswellen hindurch. */
    return (cp !== null && this._cprAt(t)) ? Math.max(own, cp) : own;
  };

  Engine.prototype.plethAt = function (t) {
    var s = this.state;
    if (this._cprAt(t) && !this._perfusing()) {
      var d = Math.max(0, t - this._cprT0);
      return 0.45 * (1 - Math.exp(-d / 2.4)) * plethShape(d % CPR_T, CPR_T);
    }
    if (!this._perfusing()) return 0.02 * Math.sin(t * 4.1);
    var v = 0;
    for (var i = 0; i < this.vent.length; i++) {
      var e = this.vent[i];
      if (!e.perf) continue;
      var dt = t - e.t;
      if (dt < 0 || dt > 1.8) continue;
      var x = e.strength * plethShape(dt, 60 / clamp(s.hr, 15, 300));
      if (x > v) v = x;
    }
    var perf = clamp((s.sys - 50) / 70, 0.25, 1);
    return v * perf * this._resp(t);
  };

  Engine.prototype.cvpAt = function (t) {
    var s = this.state, v = s.cvp, i;
    if (this.state.rhythm === 'asystolie') return s.cvp;
    for (i = 0; i < this.atrial.length; i++) {
      var dp = t - this.atrial[i].t;
      if (dp > -0.1 && dp < 0.3) v += 2.6 * gauss(dp - 0.06, 0.055);      // a-Welle
    }
    for (i = 0; i < this.vent.length; i++) {
      var e = this.vent[i], dt = t - e.t;
      if (dt < -0.05 || dt > 0.9) continue;
      v += 1.3 * gauss(dt - 0.07, 0.04);                                   // c-Welle
      v += 2.0 * gauss(dt - 0.42, 0.075);                                  // v-Welle
      v -= 1.2 * gauss(dt - 0.25, 0.06);                                   // x-Senke
      v -= 1.0 * gauss(dt - 0.60, 0.06);                                   // y-Senke
    }
    return v * (1 - 0.06 * Math.sin(this._respPhase(t)));
  };

  /* Alle Kanäle für einen Zeitpunkt; pflegt nebenbei die Messfenster. */
  Engine.prototype.sample = function (t) {
    var o = { ecg: this.ecgAt(t), art: this.artAt(t), pleth: this.plethAt(t), cvp: this.cvpAt(t) };
    this._artWin.push([t, o.art]);
    this._cvpWin.push([t, o.cvp]);
    while (this._artWin.length && this._artWin[0][0] < t - 6) this._artWin.shift();
    while (this._cvpWin.length && this._cvpWin[0][0] < t - 6) this._cvpWin.shift();
    return o;
  };

  /* ---------- Pulsdruckvariation ---------- */

  /* Pulsdruck je Schlag aus der tatsaechlich gezeichneten Kurve: hoechster
     Wert im Auswurf minus tiefster davor. Die PPV ergibt sich daraus von
     selbst, sie wird nicht eingestellt. */
  Engine.prototype._measurePP = function () {
    var w = this._artWin, i, j;
    if (w.length < 12) return;
    /* Gemessen wird innerhalb eines Schlages, vom Gipfel bis zum tiefsten
       Punkt kurz vor dem naechsten Schlag. Nur so faellt die langsame
       Verschiebung der Grundlinie durch die Beatmung heraus und uebrig
       bleibt der Pulsdruck selbst. */
    /* Gemessen wird erst, wenn der Schlag auch wirklich gezeichnet ist. Der
       Monitor rechnet sonst mit einem halben Schlag und zeigt eine viel zu
       hohe PPV an – und zwar je nach Bildrate unterschiedlich. */
    var drawn = w[w.length - 1][0];
    for (i = 0; i + 1 < this.vent.length; i++) {
      var e = this.vent[i], nx = this.vent[i + 1];
      if (!e.perf || e._ppDone) continue;
      if (drawn < nx.t + 0.02) continue;
      e._ppDone = true;
      var span = nx.t - e.t;
      if (span < 0.25 || span > 2.5) continue;
      var mx = -1e9, mn = 1e9, ok = false;
      for (j = 0; j < w.length; j++) {
        var tt = w[j][0];
        if (tt < e.t || tt > nx.t) continue;
        if (w[j][1] > mx) mx = w[j][1];
        if (tt > e.t + 0.3 * span && w[j][1] < mn) { mn = w[j][1]; ok = true; }
      }
      if (!ok || mx <= -1e8) continue;
      /* Der erste Schlag nach einem Druckwechsel liegt noch im Uebergang und
         wuerde die PPV fuer die naechsten 14 Sekunden verfaelschen. */
      if (this._ppSkip > 0) { this._ppSkip--; continue; }
      this._ppWin.push([e.t, mx - mn]);
    }
    while (this._ppWin.length && this._ppWin[0][0] < this.t - 14) this._ppWin.shift();
  };

  /* Anteil der Schlagabstaende, die sich um mehr als 12,5 % vom
     vorhergehenden unterscheiden. Ab dieser Schwelle spricht der Monitor von
     einem unregelmaessigen Rhythmus. */
  function irregDiffs(iv) {
    if (iv.length < 3) return 0;
    var n = 0, c = 0;
    for (var i = 1; i < iv.length; i++) {
      if (iv[i - 1] <= 0) continue;
      c++;
      if (Math.abs(iv[i] - iv[i - 1]) / iv[i - 1] > 0.125) n++;
    }
    return c ? n / c : 0;
  }
  function irregularity(ts) {
    var iv = [];
    for (var i = 1; i < ts.length; i++) iv.push(ts[i] - ts[i - 1]);
    return irregDiffs(iv);
  }

  /* ---------- Rhythmus- und Ektopiemeldung ---------- */

  /* Nachgebildet nach dem, was der Monitor oben rechts neben der EKG-Kurve
     einblendet (Philips ST/AR-Algorithmus, Gebrauchsanweisung IntelliVue,
     Abschnitt "Rhythmus-Statusmeldungen"). Der Algorithmus kennt die Diagnose
     nicht – er sieht nur Breite und Abstand der Komplexe und ob eine P-Welle
     davor liegt. Deshalb steht bei Vorhofflimmern "HF unregelmaess." und bei
     einer PEA "Sinus-Bradykardie". */
  Engine.prototype.rhythmStatus = function () {
    var s = this.state, i;
    if (this._defibBlank()) return 'Keine EKG-Analyse';
    if (s.artefakt === 'elektrode') return 'Keine EKG-Analyse';
    if (this._cpr()) return 'Keine EKG-Analyse';
    if (s.rhythm === 'vf_grob' || s.rhythm === 'vf_fein') return 'Vent Fib/Tachy';
    if (this.t - this._lastVentT > 4) return 'Asystolie';

    var rec = [];
    for (i = this._hist.length - 1; i >= 0 && rec.length < 10; i--) {
      if (this._hist[i].t < this.t - 6.5) break;
      if (this._hist[i].t > this.t) continue;              // noch nicht gelaufen
      rec.unshift(this._hist[i]);
    }
    var n = rec.length;
    if (n < 3) return (this.t - this._learnT < 8) ? 'EKG Lernphase' : 'Rhythmus unbekannt';

    var ts = rec.map(function (b) { return b.t; });
    var rate = ts[n - 1] > ts[0] ? 60 / ((ts[n - 1] - ts[0]) / (n - 1)) : s.hr;

    var cnt = { N: 0, S: 0, V: 0, P: 0, J: 0 };
    rec.forEach(function (b) { cnt[b.lab]++; });

    if (cnt.P / n >= 0.5) return 'Pacer-Rhythmus';

    var run = 0;                                            // Lauf von Kammerschlaegen
    for (i = n - 1; i >= 0 && rec[i].lab === 'V'; i--) run++;
    if (run >= 5 || (run >= 3 && run === n)) {
      if (rate > 100) {
        if (!this._vtSince) this._vtSince = this.t;
        return (this.t - this._vtSince > 15) ? 'Persistierende VT' : 'VTachy';
      }
      this._vtSince = 0;
      return 'Vent-Rhythmus';
    }
    this._vtSince = 0;

    /* Bigeminus: N V N V ..., Trigeminus: N N V N N V ... */
    function periodic(k) {
      if (n < 6) return false;
      var seg = rec.slice(n - 6), j, v = 0, nn = 0;
      for (j = 0; j < 6; j++) if (seg[j].lab !== seg[j % k].lab) return false;
      for (j = 0; j < k; j++) {
        if (seg[j].lab === 'V') v++;
        else if (seg[j].lab === 'N') nn++;
      }
      return v === 1 && nn === k - 1;
    }
    if (periodic(2)) return 'Bigeminus';
    if (periodic(3)) return 'Trigeminus';

    /* Unregelmaessig heisst: die Abstaende zwischen den normalen Schlaegen
       schwanken. Eine einzelne Extrasystole mit ihrer Pause zaehlt nicht dazu –
       der Monitor wertet dafuer ebenfalls nur die N-N-Intervalle aus. */
    var nn = [];
    for (i = 1; i < n; i++) {
      if (rec[i].lab === 'V' || rec[i].lab === 'S') continue;
      if (rec[i - 1].lab === 'V' || rec[i - 1].lab === 'S') continue;
      nn.push(rec[i].t - rec[i - 1].t);
    }
    if (irregDiffs(nn) >= 0.4) return 'HF unregelmäß.';

    /* Sinus oder supraventrikulaer: entscheidend ist allein, ob vor den
       normalen Schlaegen eine P-Welle liegt. Die Grenzen 60 und 100 greifen
       mit etwas Hysterese, damit die Meldung nicht hin- und herspringt. */
    var pre = cnt.N >= cnt.J ? 'Sinus' : 'SV';
    var lo = 60, hi = 100;
    if (this._band === -1) lo = 63; else if (this._band === 1) hi = 97;
    var band = rate < lo ? -1 : (rate > hi ? 1 : 0);
    this._band = band;
    return pre + (band < 0 ? '-Bradykardie' : (band > 0 ? '-Tachykardie' : '-Rhythmus'));
  };

  /* Zweite Zeile: Ektopie-Statusmeldung, Reihenfolge wie in der Alarmkette.
     Bei einem durchgehenden Kammerrhythmus meldet der Monitor keine Ektopie –
     das ist dann der Rhythmus und keine Extrasystole. */
  Engine.prototype.ectopicStatus = function (rs) {
    if (/^(Vent|VTachy|Persistierende|Asystolie|Keine|Rhythmus unbekannt)/.test(rs || '')) return '';
    var min = this.t - 60, i, b, runs = [], run = 0, sves = 0, morphs = {};
    for (i = 0; i < this._hist.length; i++) {
      b = this._hist[i];
      if (b.t < min || b.t > this.t) continue;
      if (b.lab === 'V') { run++; if (b.vm) morphs[b.vm] = 1; }
      else {
        if (run) runs.push(run);
        run = 0;
        if (b.lab === 'S') sves++;
      }
    }
    if (run) runs.push(run);
    var mx = runs.length ? Math.max.apply(null, runs) : 0;
    if (mx > 2) return 'VES Salve';
    if (mx === 2) return 'VES Paar';
    if (Object.keys(morphs).length > 1) return 'Multiform VES';
    if (sves > 5) return 'Häufige SVES';
    if (sves >= 1) return 'SVES';
    return '';
  };

  /* ---------- abgeleitete Zahlenwerte ---------- */

  Engine.prototype.readout = function () {
    var s = this.state, r = s.rhythm;
    var out = { rhythm: r, rhythmLabel: Engine.rhythmLabel(r) };

    /* Herzfrequenz aus den letzten RR-Intervallen */
    if (r === 'asystolie') out.hr = 0;
    else if (r === 'vf_grob' || r === 'vf_fein') out.hr = null;
    else if (this._rrWin.length >= 3) {
      var n = this._rrWin.length;
      var span = this._rrWin[n - 1] - this._rrWin[Math.max(0, n - 7)];
      var cnt = n - 1 - Math.max(0, n - 7);
      out.hr = span > 0 ? Math.round(60 / (span / cnt)) : Math.round(s.hr);
    } else out.hr = Math.round(s.hr);
    if (this.t - this._lastVentT > 4 && out.hr) out.hr = 0;
    /* Nach dem Schock zaehlt das Geraet nichts – es sieht ja nichts. */
    if (this._defibBlank()) out.hr = null;

    /* arterieller Druck aus der Kurve */
    if ((this._perfusing() || this._cpr()) && this._artWin.length > 20) {
      var mn = 1e9, mx = -1e9, sum = 0;
      for (var i = 0; i < this._artWin.length; i++) {
        var v = this._artWin[i][1];
        if (v < mn) mn = v; if (v > mx) mx = v; sum += v;
      }
      out.artSys = Math.round(mx); out.artDia = Math.round(mn);
      out.artMap = Math.round(sum / this._artWin.length);
    } else { out.artSys = null; out.artDia = null; out.artMap = null; }

    out.spo2 = this._perfusing() ? Math.round(s.spo2 + (Math.random() - 0.5) * 0.6) : null;
    if (this._cpr() && !this._perfusing()) out.spo2 = null;

    if (this._cvpWin.length > 20) {
      var cs = 0;
      for (var j = 0; j < this._cvpWin.length; j++) cs += this._cvpWin[j][1];
      out.cvp = Math.round(cs / this._cvpWin.length);
    } else out.cvp = Math.round(s.cvp);

    /* Pulsdruckvariation. Nur bei regelmaessigem Rhythmus auswertbar: sonst
       schwankt das Schlagvolumen schon wegen der wechselnden Fuellungszeit. */
    out.ppv = null; out.ppvNote = null;
    if (this._perfusing() && this._ppWin.length >= 6) {
      var pmn = 1e9, pmx = -1e9, psum = 0, k;
      for (k = 0; k < this._ppWin.length; k++) {
        var pv = this._ppWin[k][1];
        if (pv < pmn) pmn = pv;
        if (pv > pmx) pmx = pv;
        psum += pv;
      }
      var pmean = psum / this._ppWin.length;
      if (pmean > 4) {
        /* Auswertbar nur bei regelmaessigem Rhythmus und im ueblichen
           Frequenzbereich – sonst schwankt das Schlagvolumen ohnehin. */
        if (irregularity(this._rrWin) >= 0.25 || !out.hr || out.hr < 40 || out.hr > 160
            || this.t - this._ectT < 15)
          out.ppvNote = 'n. ausw.';
        else out.ppv = Math.round((pmx - pmn) / pmean * 100);
      }
    }

    /* Temperatur kommt aus den Laborwerten – am Monitor steht sie gruen. */
    out.temp = (s.lab && s.lab.temp !== undefined && s.lab.temp !== null)
      ? Math.round(s.lab.temp * 10) / 10 : null;

    out.rhythmStatus = this.rhythmStatus();
    out.ectopic = this.ectopicStatus(out.rhythmStatus);
    out.af = Math.round(s.af);
    out.perfusing = this._perfusing();
    return out;
  };

  /* ---------- Alarme ---------- */

  Engine.prototype.alarms = function (ro) {
    var s = this.state, list = [];
    if (!s.alarms) return list;
    var r = s.rhythm;
    if (r === 'vf_grob' || r === 'vf_fein') list.push({ p: 3, text: 'KAMMERFLIMMERN' });
    if (r === 'vt_pulslos' || r === 'vt_puls' || r === 'torsade')
      list.push({ p: 3, text: 'VENTRIKULÄRE TACHYKARDIE' });
    if (r === 'asystolie') list.push({ p: 3, text: 'ASYSTOLIE' });
    if (r === 'pea') list.push({ p: 3, text: 'KEIN PULS' });
    if (s.artefakt === 'elektrode') list.push({ p: 2, text: 'EKG-ELEKTRODE AB' });

    function chk(val, lim, label, unit) {
      if (val === null || val === undefined || !lim) return;
      if (val < lim[0]) list.push({ p: 2, text: label + ' NIEDRIG' });
      else if (val > lim[1]) list.push({ p: 2, text: label + ' HOCH' });
    }
    if (ro) {
      chk(ro.hr, s.limits.hr, 'HF');
      chk(ro.spo2, s.limits.spo2, 'SpO₂');
      chk(ro.artSys, s.limits.sys, 'ABP sys');
      chk(ro.artMap, s.limits.map, 'MAD');
      chk(ro.cvp, s.limits.cvp, 'ZVD');
      chk(ro.temp, s.limits.temp, 'TEMP');
    }
    list.sort(function (a, b) { return b.p - a.p; });
    return list;
  };

  global.Engine = Engine;
})(window);
