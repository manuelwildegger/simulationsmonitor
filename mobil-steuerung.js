/* mobil-steuerung.js – nur in der Handy-Fassung, wenn die Steuerung als
   Rahmen in mobil.html steckt (index.html?embed=1): Sprungleiste zu den
   Abschnitten, weil am Handy alles in einer Spalte untereinander steht. */
(function () {
  'use strict';
  if (!document.documentElement.classList.contains('embed')) return;

  var scroller = document.getElementById('cbody');
  if (!scroller) return;

  var SHORT = [
    [/^Szenarien/, 'Szenarien'], [/^Artefakte/, 'Artefakte'], [/^EKG-Form/, 'EKG-Form'],
    [/^Medikamente/, 'Medikamente'], [/^Defibrillation/, 'Defi'],
    [/^Nur der Herzrhythmus/, 'Rhythmus'], [/^Anzeige/, 'Anzeige'],
    [/^Vorschau/, 'Istwerte'], [/^Parameter/, 'Parameter'], [/^Labor/, 'Labor'],
    [/^Patient/, 'Patient'], [/^Protokoll/, 'Protokoll']
  ];

  var nav = document.createElement('nav');
  nav.id = 'jump';
  var heads = Array.prototype.slice.call(scroller.querySelectorAll('h2.sec, #rhythmDet > summary'));
  var chips = heads.map(function (h) {
    var first = h.firstChild && h.firstChild.nodeType === 3 ? h.firstChild.nodeValue : h.textContent;
    var t = first.trim(), name = t.split(/\s/)[0];
    SHORT.forEach(function (s) { if (s[0].test(t)) name = s[1]; });
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.onclick = function () {
      var det = h.closest('details');
      if (det) det.open = true;
      var top = h.getBoundingClientRect().top - scroller.getBoundingClientRect().top +
                scroller.scrollTop - nav.offsetHeight - 6;
      scroller.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    };
    nav.appendChild(b);
    return b;
  });
  scroller.insertBefore(nav, scroller.firstChild);

  /* Den Abschnitt hervorheben, in dem man gerade steht. */
  var cur = -1, pend = false;
  function mark() {
    pend = false;
    var lim = scroller.getBoundingClientRect().top + nav.offsetHeight + 24, idx = 0;
    heads.forEach(function (h, i) { if (h.offsetParent && h.getBoundingClientRect().top <= lim) idx = i; });
    if (idx === cur) return;
    if (chips[cur]) chips[cur].classList.remove('on');
    cur = idx;
    chips[cur].classList.add('on');
    var c = chips[cur];
    nav.scrollTo({ left: c.offsetLeft - nav.clientWidth / 2 + c.offsetWidth / 2, behavior: 'smooth' });
  }
  scroller.addEventListener('scroll', function () {
    if (!pend) { pend = true; requestAnimationFrame(mark); }
  }, { passive: true });
  mark();
})();
