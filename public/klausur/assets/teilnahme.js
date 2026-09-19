/* Die Seite, an der die Klasse sitzt.
 *
 * Zwei Dinge sind hier anders als im übrigen Material, und beide mit Absicht:
 *
 * 1. NICHTS wird auf dem Gerät gespeichert. Kein localStorage, kein
 *    sessionStorage, kein Cookie. Die Übungen merken sich ihren Stand, damit
 *    ein Tabwechsel ihn nicht frisst - hier wäre genau das ein Leck: Auf
 *    einem Schul-iPad säße nach der Stunde der Antwortbogen des Vorgängers.
 *    Code und PIN liegen in einer Variablen, solange die Seite offen ist.
 *
 * 2. Die Seite kennt die richtigen Antworten nicht. Sie bekommt nur Fragen
 *    und Optionen; der Lösungsschlüssel liegt verschlüsselt beim Server und
 *    wird erst im Browser der Lehrkraft geöffnet. Wer hier die
 *    Entwicklerwerkzeuge aufmacht, findet nichts.
 */
(function () {
  'use strict';

  var API = 'api/pruefung.php';

  function el(id) { return document.getElementById(id); }

  function sagen(knoten, art, text) {
    knoten.className = 'meldung ' + art;
    knoten.textContent = text;
    knoten.hidden = false;
  }

  var FEHLERTEXT = {
    unbekannt: 'Code oder PIN stimmt nicht.',
    gesperrt: 'Zu viele Versuche. Warte kurz und sag der Lehrkraft Bescheid.',
    schon_benutzt: 'Dieser Code war schon im Einsatz. Die Lehrkraft kann ihn '
      + 'zurücksetzen.',
    nicht_offen: 'Die Prüfung ist noch nicht freigegeben oder schon beendet.',
    zugross: 'Die Antwort ist zu lang.',
    db: 'Der Dienst antwortet gerade nicht.',
    ungueltig: 'Das hat so nicht funktioniert.'
  };

  async function ruf(felder) {
    var daten = new URLSearchParams(felder);
    var antwort;
    try {
      antwort = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: daten.toString()
      });
    } catch (e) {
      return { ok: false, fehler: 'db' };
    }
    try { return await antwort.json(); }
    catch (e) { return { ok: false, fehler: 'db' }; }
  }

  /* Nur im Arbeitsspeicher, nur solange die Seite offen ist. */
  var sitzung = { code: '', pin: '', fragen: [], oeff: '', antworten: [] };

  /* ---------- Anmelden ---------- */

  el('btnStart').addEventListener('click', async function () {
    var knopf = this;
    var code = el('tcode').value.trim().toUpperCase();
    var pin = el('tpin').value.trim();
    var m = el('meldungAnmelden');

    if (!/^[A-Z0-9]{6}$/.test(code) || !/^\d{6}$/.test(pin)) {
      sagen(m, 'nein', 'Der Code hat sechs Zeichen, die PIN sechs Ziffern.');
      return;
    }
    knopf.disabled = true;
    sagen(m, 'arbeit', 'Einen Moment …');

    var a = await ruf({ action: 'start', tcode: code, tpin: pin });
    if (!a.ok) {
      knopf.disabled = false;
      sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig);
      return;
    }

    sitzung.code = code;
    sitzung.pin = pin;
    sitzung.oeff = a.oeff;
    try { sitzung.fragen = JSON.parse(a.fragen); }
    catch (e) { sagen(m, 'nein', FEHLERTEXT.db); knopf.disabled = false; return; }
    sitzung.antworten = sitzung.fragen.map(function () { return []; });

    el('schrittAnmelden').hidden = true;
    el('schrittFragen').hidden = false;
    fragenZeichnen();
    warnenBeimVerlassen(true);
  });

  /* ---------- Die Fragen ---------- */

  function fragenZeichnen() {
    var ziel = el('fragen');
    ziel.textContent = '';

    sitzung.fragen.forEach(function (frage, i) {
      var kasten = document.createElement('div');
      kasten.className = 'frage';

      var kopf = document.createElement('div');
      kopf.className = 'kopf';
      kopf.textContent = 'Aufgabe ' + (i + 1) + ' von ' + sitzung.fragen.length
        + ' · ' + (frage.anzahl === 1 ? 'eine Antwort stimmt'
          : frage.anzahl + ' Antworten stimmen');
      kasten.appendChild(kopf);

      var text = document.createElement('p');
      text.className = 'text';
      text.textContent = frage.text;
      kasten.appendChild(text);

      frage.optionen.forEach(function (option, j) {
        var zeile = document.createElement('label');
        zeile.className = 'option';
        var kaestchen = document.createElement('input');
        kaestchen.type = 'checkbox';
        kaestchen.dataset.frage = String(i);
        kaestchen.dataset.option = String(j);
        var spanne = document.createElement('span');
        spanne.innerHTML = '<strong>' + String.fromCharCode(97 + j)
          + ')</strong> ';
        spanne.appendChild(document.createTextNode(option));
        zeile.appendChild(kaestchen);
        zeile.appendChild(spanne);
        kasten.appendChild(zeile);

        kaestchen.addEventListener('change', function () {
          kreuzen(i, j, kaestchen.checked);
        });
      });

      var zaehler = document.createElement('p');
      zaehler.className = 'zaehler';
      zaehler.id = 'zaehler' + i;
      kasten.appendChild(zaehler);

      ziel.appendChild(kasten);
      zaehlerSetzen(i);
    });
    standSetzen();
  }

  /* Mehr Kreuze als erlaubt lässt die Oberfläche gar nicht erst zu. Das ist
     Bedienkomfort, keine Sicherung: Was über die Leitung kommt, prüft die
     Bewertung im Browser der Lehrkraft noch einmal. */
  function kreuzen(i, j, an) {
    var gewaehlt = sitzung.antworten[i];
    var pos = gewaehlt.indexOf(j);
    if (an && pos === -1) { gewaehlt.push(j); }
    if (!an && pos !== -1) { gewaehlt.splice(pos, 1); }
    zaehlerSetzen(i);
    standSetzen();
  }

  function zaehlerSetzen(i) {
    var frage = sitzung.fragen[i];
    var n = sitzung.antworten[i].length;
    var voll = n >= frage.anzahl;
    var z = el('zaehler' + i);
    z.textContent = n + ' von ' + frage.anzahl + ' angekreuzt'
      + (voll ? ' – zum Ändern erst eines abwählen' : '');
    z.className = 'zaehler' + (voll ? ' voll' : '');

    var kaestchen = document.querySelectorAll(
      'input[data-frage="' + i + '"]');
    [].forEach.call(kaestchen, function (k) {
      var gewaehlt = k.checked;
      k.disabled = voll && !gewaehlt;
      k.closest('.option').classList.toggle('voll', k.disabled);
    });
  }

  function standSetzen() {
    var offen = sitzung.antworten.filter(function (a) {
      return a.length === 0;
    }).length;
    el('standZeile').textContent = offen === 0
      ? 'Alle Aufgaben bearbeitet.'
      : offen + (offen === 1 ? ' Aufgabe ist noch leer.'
        : ' Aufgaben sind noch leer.');
  }

  /* ---------- Abgeben ---------- */

  el('btnAbgeben').addEventListener('click', async function () {
    var knopf = this;
    var m = el('meldungAbgeben');
    var offen = sitzung.antworten.filter(function (a) { return !a.length; }).length;
    if (offen && !confirm(offen + ' Aufgabe(n) ohne Kreuz. Trotzdem abgeben?')) {
      return;
    }
    knopf.disabled = true;
    sagen(m, 'arbeit', 'Wird verschlüsselt und abgegeben …');

    var umschlag;
    try {
      umschlag = await Krypto.anOeffentlich(sitzung.oeff, {
        v: 1,
        abgegeben: new Date().toISOString(),
        antworten: sitzung.antworten
      });
    } catch (e) {
      knopf.disabled = false;
      sagen(m, 'nein', 'Die Verschlüsselung hat nicht geklappt. Sag der '
        + 'Lehrkraft Bescheid.');
      return;
    }

    var a = await ruf({
      action: 'abgeben',
      tcode: sitzung.code,
      tpin: sitzung.pin,
      antwort_chiffre: umschlag
    });
    if (!a.ok) {
      knopf.disabled = false;
      sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig);
      return;
    }

    warnenBeimVerlassen(false);
    sitzung.pin = '';
    el('schrittFragen').hidden = true;
    el('schrittFertig').hidden = false;
    window.scrollTo(0, 0);
  });

  /* ---------- Versehentlich weg ---------- */

  var warnen = false;
  function warnenBeimVerlassen(an) { warnen = an; }
  window.addEventListener('beforeunload', function (e) {
    if (!warnen) { return; }
    e.preventDefault();
    e.returnValue = '';
  });

  if (!Krypto.verfuegbar) {
    sagen(el('meldungAnmelden'), 'nein',
      'Dieser Browser kann nicht verschlüsseln. Bitte einen aktuellen '
      + 'Browser verwenden.');
    el('btnStart').disabled = true;
  }
}());
