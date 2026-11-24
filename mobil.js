/* mobil.js – Handy-Fassung (mobil.html): Monitor im Querformat, die Steuerung
   klappt von rechts herein. Die Steuerung ist dieselbe Seite wie am Rechner
   (index.html), nur als Rahmen geladen; sie liefert den Zustand per
   postMessage an diese Seite (siehe EMBED in control.js). */
(function () {
  'use strict';

  var VER = '202611242213';
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');
  var skCtl = document.getElementById('skCtl');
  var frame = null;

  /* ---------- Steuerung als Schublade ---------- */

  /* Der Rahmen wird erst hier angelegt: monitor.js hoert dann schon zu, und
     der erste Zustand der Steuerung geht nicht verloren. */
  frame = document.createElement('iframe');
  frame.id = 'ctlFrame';
  frame.title = 'Steuerung';
  frame.src = 'index.html?embed=1&v=' + VER;
  document.getElementById('drawerBody').appendChild(frame);

  function isOpen() { return drawer.classList.contains('open'); }
  function setOpen(on) {
    drawer.classList.toggle('open', on);
    scrim.classList.toggle('on', on);
    drawer.setAttribute('aria-hidden', on ? 'false' : 'true');
    skCtl.classList.toggle('on', on);
    skCtl.innerHTML = on ? 'Steuerung<br>schließen' : 'Steuerung<br>öffnen';
    if (on) hideTip();
  }

  skCtl.onclick = function () { setOpen(!isOpen()); };
  document.getElementById('ctlHandle').onclick = function () { setOpen(true); };
  document.getElementById('drawerClose').onclick = function () { setOpen(false); };
  scrim.onclick = function () { setOpen(false); };

  /* Was die Steuerung am Monitor aufmacht, soll man auch sehen: Gerät, EKG,
     BGA und Standbild schliessen die Schublade. */
  window.addEventListener('message', function (e) {
    if (e.source !== frame.contentWindow) return;
    var m = e.data;
    if (!m || !isOpen()) return;
    if (m.type === 'bga' ||
        (m.type === 'cmd' && /^(devDefi|devPacer|ecg12|freeze)$/.test(m.cmd))) setOpen(false);
  });

  /* ---------- Vollbild ---------- */

  /* Am iPhone gibt es kein Vollbild fuer Webseiten – dort hilft nur
     „Zum Home-Bildschirm“. Als App gestartet ist es ohnehin bildschirmfuellend. */
  var de = document.documentElement;
  var standalone = window.navigator.standalone === true ||
    (window.matchMedia && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches);
  var canFs = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  var fsBtn = document.getElementById('skFs');

  function lockLandscape() {
    try {
      if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {});
    } catch (e) {}
  }
  if (!canFs || standalone) {
    fsBtn.style.display = 'none';
  } else {
    fsBtn.onclick = function () {
      var cur = document.fullscreenElement || document.webkitFullscreenElement;
      try {
        if (cur) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
        else {
          var p = (de.requestFullscreen || de.webkitRequestFullscreen).call(de);
          if (p && p.then) p.then(lockLandscape).catch(function () {});
          else lockLandscape();
        }
      } catch (e) {}
    };
  }
  function syncFs() {
    fsBtn.classList.toggle('on', !!(document.fullscreenElement || document.webkitFullscreenElement));
  }
  document.addEventListener('fullscreenchange', syncFs);
  document.addEventListener('webkitfullscreenchange', syncFs);

  /* ---------- Bildschirm wach halten ---------- */

  var lock = null;
  function wake() {
    if (lock || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
    navigator.wakeLock.request('screen').then(function (l) {
      lock = l;
      l.addEventListener('release', function () { lock = null; });
    }).catch(function () {});
  }
  document.addEventListener('visibilitychange', wake);
  document.addEventListener('pointerdown', wake, { passive: true });
  wake();

  /* Ton auch bei stummgeschaltetem iPhone, sobald er eingeschaltet ist
     (Safari ab 16.4; sonst bleibt alles wie gehabt). */
  document.getElementById('skSound').addEventListener('click', function () {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
  });

  /* ---------- Einmaliger Hinweis ---------- */

  var TIP_KEY = 'simmon-tip-v1';
  var tip = document.getElementById('tip');
  var tipT = null;
  function hideTip() {
    tip.classList.remove('on');
    if (tipT) { clearTimeout(tipT); tipT = null; }
  }
  document.getElementById('tipClose').onclick = function () {
    hideTip();
    try { localStorage.setItem(TIP_KEY, '1'); } catch (e) {}
  };
  (function () {
    var seen = false;
    try { seen = localStorage.getItem(TIP_KEY) === '1'; } catch (e) {}
    if (seen) return;
    var ios = /iP(hone|od|ad)/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var t = '„Steuerung“ unten links: Szenarien, Medikamente, Defi, Laborwerte.';
    if (!standalone) {
      if (ios) t += ' Tipp: Teilen → „Zum Home-Bildschirm“ – dann ohne Browserleisten.';
      else if (canFs) t += ' Tipp: „Vollbild“ blendet die Browserleisten aus.';
    }
    document.getElementById('tipText').textContent = t;
    setTimeout(function () { tip.classList.add('on'); }, 1200);
    tipT = setTimeout(hideTip, 16000);
  })();
})();
