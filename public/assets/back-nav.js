/* Ruecksprung zur Uebersicht - einzige Quelle fuer alle Ausspielwege.
 *
 * Eingebunden wird der Baustein in jeder Material-Seite mit einer Zeile
 * unmittelbar vor dem schliessenden body-Tag:
 *
 *     <script src="../assets/back-nav.js"></script>
 *
 * Bewusst kein Jekyll-Layout und keine Injektion beim Deploy: die Zeile steht
 * in der Datei und funktioniert dadurch ueberall gleich - GitHub Pages,
 * t-bk.de und beim lokalen Oeffnen per Doppelklick. build/build.mjs traegt sie
 * automatisch nach, falls sie in einer neuen Datei fehlt.
 *
 * Das Ziel wird aus dem eigenen Skript-Pfad abgeleitet und nicht fest
 * verdrahtet: ".../assets/back-nav.js" minus "assets/back-nav.js" ergibt immer
 * die Wurzel des Materialbereichs - egal wie tief die Seite liegt und egal
 * unter welchem Pfad der Bereich ausgeliefert wird:
 *
 *   GitHub Pages  /tbk-unterrichtsmaterial/lernsituationen/x.html -> /tbk-unterrichtsmaterial/
 *   t-bk.de       /unterrichtsmaterial/lernsituationen/x.html     -> /unterrichtsmaterial/
 *
 * Zwei Angaben sind moeglich:
 *
 *     data-ziel="./"            wohin (Vorgabe: die Wurzel des Bereichs)
 *     data-text="Startseite"    wie er heisst (Vorgabe: "Uebersicht")
 *
 * Damit tragen auch die Bereichsseiten denselben Knopf - vorher stand dort
 * eine blaue Textzeile, waehrend jede Inhaltsseite den schwebenden Knopf hatte.
 *
 * Die Seiten bringen sehr unterschiedliche (helle wie dunkle) Designs mit,
 * darum eigene ID und !important bei allem, was globale Resets der Seiten
 * (z. B. "* { font-family: ... }") sonst ueberschreiben wuerden.
 */
(function () {
  'use strict';

  if (document.getElementById('tbk-back')) return;

  // document.currentScript ist bei einem klassischen <script src> gesetzt;
  // bei defer/async faellt es weg - dann ueber den Dateinamen nachsehen.
  var self = document.currentScript ||
    document.querySelector('script[src$="assets/back-nav.js"]');
  // self.src ist leer, wenn die Datei inline statt ueber src eingebunden
  // wird. Dann lieber der einfache relative Pfad als eine Ausnahme, die
  // die ganze Seite anhaelt.
  var wurzel = self && self.src ? new URL('../', self.src).href : '../';

  // Innerhalb eines Uebungs- oder Trainingspakets soll der Ruecklink zur
  // Paketuebersicht fuehren, nicht bis zur Startseite des Materialbereichs.
  // build/build.mjs traegt dafuer data-ziel="./" ein.
  var zielRoh = self && self.dataset ? self.dataset.ziel : '';
  var ziel = zielRoh ? new URL(zielRoh, location.href).href : wurzel;

  /* Ein "/" zeigt auf die Wurzel der Domain, und die gibt es nur auf t-bk.de:
     Auf GitHub Pages waere das die Profilseite, lokal das Dateisystem. Dort
     erscheint der Ruecklink deshalb gar nicht. */
  if (zielRoh === '/' && (location.protocol === 'file:'
      || /(^|\.)github\.io$/.test(location.hostname))) return;

  /* Beschriftung. "zur" passt zu beiden bisherigen Zielen (Uebersicht,
     Startseite); fuer alles andere gibt es data-titel. */
  var text = (self && self.dataset && self.dataset.text) || 'Übersicht';
  var titel = (self && self.dataset && self.dataset.titel) || ('Zurück zur ' + text);

  var css = '' +
    '#tbk-back{' +
      'position:fixed!important;top:12px!important;left:12px!important;z-index:2147483647!important;' +
      'display:inline-flex!important;align-items:center!important;gap:8px!important;' +
      'margin:0!important;padding:8px 14px 8px 11px!important;' +
      'box-sizing:border-box!important;border-radius:999px!important;' +
      'font:600 14px/1 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif!important;' +
      'letter-spacing:.01em!important;white-space:nowrap!important;' +
      'color:#1a1a1a!important;text-decoration:none!important;' +
      'background:rgba(255,255,255,.92)!important;' +
      'border:1px solid rgba(0,0,0,.14)!important;' +
      'box-shadow:0 1px 2px rgba(0,0,0,.10),0 6px 20px rgba(0,0,0,.14)!important;' +
      '-webkit-backdrop-filter:saturate(180%) blur(10px);backdrop-filter:saturate(180%) blur(10px);' +
      'transition:transform .15s ease,box-shadow .15s ease,border-color .15s ease!important;' +
    '}' +
    '#tbk-back:hover{' +
      'transform:translateY(-1px)!important;' +
      'border-color:rgba(43,108,176,.55)!important;' +
      'box-shadow:0 2px 4px rgba(0,0,0,.12),0 10px 26px rgba(0,0,0,.18)!important;' +
    '}' +
    '#tbk-back:focus-visible{outline:2px solid #2b6cb0!important;outline-offset:2px!important}' +
    '#tbk-back svg{width:15px!important;height:15px!important;flex:0 0 auto!important;color:#2b6cb0!important;display:block!important}' +
    '@media (max-width:640px){#tbk-back{padding:9px!important;gap:0!important}#tbk-back .tbk-back-label{display:none!important}}' +
    '@media print{#tbk-back{display:none!important}}' +
    '@media (prefers-reduced-motion:reduce){#tbk-back{transition:none!important}#tbk-back:hover{transform:none!important}}';

  var style = document.createElement('style');
  style.id = 'tbk-back-style';
  style.textContent = css;

  var a = document.createElement('a');
  a.id = 'tbk-back';
  a.href = ziel;
  a.title = titel;
  a.setAttribute('aria-label', titel);
  a.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" ' +
    'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
    '<path d="M19 12H5M12 19l-7-7 7-7"/></svg>' +
    '<span class="tbk-back-label"></span>';
  a.querySelector('.tbk-back-label').textContent = text;

  function einfuegen() {
    (document.head || document.documentElement).appendChild(style);
    document.body.appendChild(a);
  }

  if (document.body) einfuegen();
  else document.addEventListener('DOMContentLoaded', einfuegen);
})();
