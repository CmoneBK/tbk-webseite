/* Der Arbeitsplatz der Lehrkraft.
 *
 * Alles, was mit Inhalt zu tun hat, passiert hier im Browser: Der
 * Lösungsschlüssel wird hier verschlüsselt, die Abgaben werden hier
 * geöffnet, die Punkte werden hier gerechnet und die Tabelle wird hier
 * geschrieben. Der Server bekommt Umschläge und gibt Umschläge zurück.
 *
 * Auch hier: nichts auf dem Gerät. Der Zugangscode könnte gespeichert
 * werden, die Passphrase nie - und ein halb gemerkter Zugang verleitet nur
 * dazu, das Tablet offen liegen zu lassen. Wer sich neu anmeldet, tippt
 * beides.
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
    unbekannt: 'Code oder Passphrase stimmt nicht.',
    gesperrt: 'Gesperrt – entweder zu viele Fehlversuche, oder dieser Bereich '
      + 'ist für diesen Zugang noch nicht freigegeben.',
    schon_benutzt: 'Der Einladungscode ist bereits eingelöst.',
    nicht_offen: 'Die Klausur ist nicht freigegeben.',
    zugross: 'Zu groß.',
    voll: 'Die Obergrenze ist erreicht.',
    db: 'Der Dienst antwortet gerade nicht.',
    ungueltig: 'Das hat so nicht funktioniert.'
  };

  async function ruf(felder) {
    try {
      var antwort = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(felder).toString()
      });
      return await antwort.json();
    } catch (e) {
      return { ok: false, fehler: 'db' };
    }
  }

  /* Nur im Arbeitsspeicher. */
  var ich = { code: '', auth: '', wrapKey: null, privKey: null, oeff: '' };
  var pool = [];
  var aktuelle = null;     /* {id, titel, verfahren, fragen, loesung} */

  function angemeldet() { return !!ich.privKey; }

  /* ================= Anmelden und Zugang anlegen ================= */

  el('btnZeigNeu').addEventListener('click', function () {
    var k = el('kastenNeu');
    k.hidden = !k.hidden;
  });

  el('npass').addEventListener('input', function () {
    var s = Krypto.staerke(this.value);
    el('staerke').textContent = this.value
      ? 'Stärke: ' + s.urteil + ' (' + s.bits + ' Bit)' : ' ';
  });

  el('btnAnmelden').addEventListener('click', async function () {
    var m = el('meldungAnmelden');
    var code = el('lcode').value.trim().toUpperCase();
    var pass = el('lpass').value;
    if (!/^[A-Z0-9]{8}$/.test(code) || !pass) {
      sagen(m, 'nein', 'Acht Zeichen Code und die Passphrase.');
      return;
    }
    this.disabled = true;
    sagen(m, 'arbeit', 'Schlüssel wird abgeleitet – das dauert bewusst einen '
      + 'Moment.');

    var s = await ruf({ action: 'konto_salt_code', code: code });
    if (!s.ok) { this.disabled = false; sagen(m, 'nein', FEHLERTEXT[s.fehler]); return; }

    var abgeleitet = await Krypto.ableiten(pass, Krypto.ausB64(s.salt));
    var a = await ruf({ action: 'konto_schluessel', code: code, auth: abgeleitet.auth });
    if (!a.ok) {
      this.disabled = false;
      sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig);
      return;
    }
    try {
      ich.privKey = await Krypto.privAuspacken(a.priv_chiffre, abgeleitet.wrapKey);
    } catch (e) {
      this.disabled = false;
      sagen(m, 'nein', 'Der Schlüssel ließ sich nicht öffnen. Stimmt die '
        + 'Passphrase?');
      return;
    }
    ich.code = code;
    ich.auth = abgeleitet.auth;
    ich.wrapKey = abgeleitet.wrapKey;
    ich.oeff = a.oeff;
    el('lpass').value = '';
    bereichZeigen();
  });

  el('btnNeu').addEventListener('click', async function () {
    var m = el('meldungNeu');
    var einl = el('neinladung').value.trim().toUpperCase();
    var p1 = el('npass').value, p2 = el('npass2').value;
    if (!/^[A-Z0-9]{10}$/.test(einl)) {
      sagen(m, 'nein', 'Der Einladungscode hat zehn Zeichen.'); return;
    }
    if (p1 !== p2) { sagen(m, 'nein', 'Die beiden Passphrasen sind verschieden.'); return; }
    if (Krypto.staerke(p1).bits < 60) {
      sagen(m, 'nein', 'Zu schwach. Nimm vier zufällige Wörter.'); return;
    }
    this.disabled = true;
    sagen(m, 'arbeit', 'Schlüsselpaar wird erzeugt …');

    var salt = Krypto.zufall(32);
    var abgeleitet = await Krypto.ableiten(p1, salt);
    var paar = await Krypto.paarErzeugen();
    var oeff = await Krypto.oeffExportieren(paar);
    var priv = await Krypto.privVerpacken(paar, abgeleitet.wrapKey);

    var a = await ruf({
      action: 'konto_neu', einladung: einl, salt: Krypto.nachB64(salt),
      auth: abgeleitet.auth, oeff: oeff, priv_chiffre: priv
    });
    this.disabled = false;
    if (!a.ok) { sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig); return; }

    ich.code = a.code;
    ich.auth = abgeleitet.auth;
    ich.wrapKey = abgeleitet.wrapKey;
    ich.privKey = paar.privateKey;
    ich.oeff = oeff;
    el('npass').value = ''; el('npass2').value = '';
    alert('Dein Zugangscode lautet: ' + a.code
      + '\n\nNotiere ihn. Zusammen mit der Passphrase ist er der einzige Weg '
      + 'zu deinen Klausuren.');
    bereichZeigen();
  });

  el('btnAbmelden').addEventListener('click', function () {
    ich = { code: '', auth: '', wrapKey: null, privKey: null, oeff: '' };
    aktuelle = null;
    el('schrittBereich').hidden = true;
    el('schrittAnmelden').hidden = false;
  });

  function bereichZeigen() {
    el('schrittAnmelden').hidden = true;
    el('schrittBereich').hidden = false;
    el('werBinIch').textContent = '· Zugang ' + ich.code;
    el('teilnahmeLink').textContent =
      location.href.replace(/[^/]*$/, '') + 'teilnahme.html';
    verfahrenFuellen();
    listeLaden();
  }

  /* ========================= Klausurliste ========================= */

  el('btnListe').addEventListener('click', listeLaden);

  async function listeLaden() {
    var m = el('meldungListe');
    var a = await ruf({ action: 'klausur_liste', code: ich.code, auth: ich.auth });
    if (!a.ok) { sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig); return; }
    m.hidden = true;

    var tb = el('liste');
    tb.textContent = '';
    if (!a.klausuren.length) {
      var leer = tb.insertRow();
      var z = leer.insertCell();
      z.colSpan = 6;
      z.className = 'fussnote';
      z.textContent = 'Noch keine Klausur.';
      return;
    }
    for (var i = 0; i < a.klausuren.length; i++) {
      var k = a.klausuren[i];
      var titel = '(nicht lesbar)';
      try {
        var meta = await Krypto.mitPrivat(ich.privKey, k.meta_chiffre);
        titel = meta.titel || '(ohne Titel)';
      } catch (e) { /* fremder Schluessel - sollte nicht vorkommen */ }
      var tr = tb.insertRow();
      tr.insertCell().textContent = titel;
      tr.insertCell().textContent = k.status;
      var c1 = tr.insertCell(); c1.className = 'zahl'; c1.textContent = k.codes;
      var c2 = tr.insertCell(); c2.className = 'zahl'; c2.textContent = k.abgaben;
      tr.insertCell().textContent = (k.loeschen_ab || '').slice(0, 10);
      var b = document.createElement('button');
      b.className = 'leise';
      b.textContent = 'öffnen';
      b.dataset.id = k.id;
      b.dataset.titel = titel;
      b.addEventListener('click', function () {
        klausurOeffnen(this.dataset.id, this.dataset.titel);
      });
      tr.insertCell().appendChild(b);
    }
  }

  /* ======================= Zusammenstellen ======================= */

  function verfahrenFuellen() {
    var s = el('kverfahren');
    if (s.options.length) { return; }
    Object.keys(Bewertung.VERFAHREN).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = Bewertung.VERFAHREN[k].name;
      s.appendChild(o);
    });
    s.addEventListener('change', verfahrenText);
    verfahrenText();
  }

  function verfahrenText() {
    var v = Bewertung.VERFAHREN[el('kverfahren').value];
    el('verfahrenText').textContent = v ? v.beschreibung : '';
  }

  el('btnZeigAnlegen').addEventListener('click', async function () {
    el('kastenAnlegen').hidden = false;
    el('kastenKlausur').hidden = true;
    if (!pool.length) { await poolLaden(); }
  });

  el('btnAbbrechen').addEventListener('click', function () {
    el('kastenAnlegen').hidden = true;
  });

  async function poolLaden() {
    var m = el('meldungPool');
    sagen(m, 'arbeit', 'Fragen werden geladen …');
    var a = await ruf({ action: 'fragenpool', code: ich.code, auth: ich.auth });
    if (!a.ok) { sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig); return; }
    pool = a.pool || [];
    m.hidden = true;
    poolZeichnen();
  }

  function poolZeichnen() {
    var ziel = el('pool');
    ziel.textContent = '';
    if (!pool.length) {
      ziel.innerHTML = '<p class="fussnote">Der Fragenpool ist leer. Er liegt '
        + 'auf dem Server außerhalb des öffentlichen Bereichs &ndash; siehe '
        + '<code>klausur-config.php</code>, Schlüssel <code>fragenpool</code>.</p>';
      return;
    }
    var themen = {};
    pool.forEach(function (f, i) {
      var t = f.thema || 'Ohne Thema';
      (themen[t] = themen[t] || []).push({ f: f, i: i });
    });
    Object.keys(themen).sort().forEach(function (t) {
      var h = document.createElement('h4');
      h.textContent = t;
      h.style.margin = '18px 0 6px';
      ziel.appendChild(h);
      themen[t].forEach(function (e) {
        var zeile = document.createElement('label');
        zeile.className = 'option';
        var k = document.createElement('input');
        k.type = 'checkbox';
        k.dataset.i = String(e.i);
        k.addEventListener('change', poolStand);
        var sp = document.createElement('span');
        sp.textContent = e.f.text + '  ('
          + (e.f.anzahl === 1 ? '1 richtig' : e.f.anzahl + ' richtig') + ')';
        zeile.appendChild(k);
        zeile.appendChild(sp);
        ziel.appendChild(zeile);
      });
    });
    poolStand();
  }

  function gewaehltePool() {
    return [].slice.call(document.querySelectorAll('#pool input:checked'))
      .map(function (k) { return pool[Number(k.dataset.i)]; });
  }

  function poolStand() {
    var g = gewaehltePool();
    var punkte = g.reduce(function (s, f) { return s + f.anzahl; }, 0);
    el('poolStand').textContent = g.length
      ? g.length + ' Aufgaben, zusammen bis zu ' + punkte + ' Punkte '
        + '(beim Verfahren „Teilpunkte").'
      : 'Noch keine Aufgabe gewählt.';
  }

  el('btnAnlegen').addEventListener('click', async function () {
    var m = el('meldungAnlegen');
    var gewaehlt = gewaehltePool();
    var titel = el('ktitel').value.trim();
    var tage = Number(el('ktage').value);
    if (!gewaehlt.length) { sagen(m, 'nein', 'Ohne Aufgaben keine Klausur.'); return; }
    if (!titel) { sagen(m, 'nein', 'Ein Titel für dich selbst.'); return; }
    if (!(tage >= 1 && tage <= 60)) { sagen(m, 'nein', 'Eins bis sechzig Tage.'); return; }

    /* Die Angabe "so viele stimmen" und der Loesungsschluessel muessen
       zusammenpassen. Der Server kann das nicht pruefen - er kennt den
       Schluessel nicht -, also faengt es hier ab und nicht erst bei der
       Auswertung. */
    var krumm = gewaehlt.filter(function (f) {
      return !Array.isArray(f.richtig) || f.richtig.length !== f.anzahl;
    });
    if (krumm.length) {
      sagen(m, 'nein', 'Bei ' + krumm.length + ' Aufgabe(n) passt die Anzahl '
        + 'der richtigen Antworten nicht zum Lösungsschlüssel: „'
        + krumm[0].text.slice(0, 60) + '“');
      return;
    }

    this.disabled = true;
    sagen(m, 'arbeit', 'Wird verschlüsselt …');

    /* Was die Teilnehmer sehen: Text, Optionen, wie viele stimmen.
       Der Lösungsschlüssel geht getrennt und verschlüsselt. */
    var fragen = gewaehlt.map(function (f) {
      return { text: f.text, optionen: f.optionen, anzahl: f.anzahl };
    });
    var loesung = {
      v: 1,
      verfahren: el('kverfahren').value,
      richtig: gewaehlt.map(function (f) { return f.richtig; })
    };

    var a = await ruf({
      action: 'klausur_anlegen',
      code: ich.code, auth: ich.auth,
      meta_chiffre: await Krypto.zuMachen(ich.wrapKey, { titel: titel }),
      fragen: JSON.stringify(fragen),
      loesung_chiffre: await Krypto.anOeffentlich(ich.oeff, loesung),
      tage: String(tage)
    });
    this.disabled = false;
    if (!a.ok) { sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig); return; }
    sagen(m, 'ja', 'Angelegt.');
    el('kastenAnlegen').hidden = true;
    el('ktitel').value = '';
    listeLaden();
    klausurOeffnen(a.id, titel);
  });

  /* ======================== Eine Klausur ======================== */

  function klausurOeffnen(id, titel) {
    aktuelle = { id: id, titel: titel };
    el('kastenAnlegen').hidden = true;
    el('kastenKlausur').hidden = false;
    el('klausurTitel').textContent = titel;
    el('codeTabelle').textContent = '';
    el('meldungCodes').hidden = true;
    el('meldungStatus').hidden = true;
    el('meldungErgebnisse').hidden = true;
    el('kastenKlausur').scrollIntoView({ behavior: 'smooth' });
  }

  el('btnZurueckListe').addEventListener('click', function () {
    el('kastenKlausur').hidden = true;
    listeLaden();
  });

  el('btnOeffnen').addEventListener('click', function () { statusSetzen('offen'); });
  el('btnBeenden').addEventListener('click', function () { statusSetzen('beendet'); });

  async function statusSetzen(neu) {
    var m = el('meldungStatus');
    var a = await ruf({
      action: 'klausur_status', code: ich.code, auth: ich.auth,
      id: aktuelle.id, status: neu
    });
    if (!a.ok) { sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig); return; }
    sagen(m, 'ja', neu === 'offen'
      ? 'Freigegeben. Die Klasse kann jetzt starten.'
      : 'Beendet. Es kommt nichts mehr herein.');
    listeLaden();
  }

  /* ---------- Teilnehmercodes ---------- */

  el('btnCodes').addEventListener('click', async function () {
    var m = el('meldungCodes');
    var n = Number(el('anzahl').value);
    if (!(n >= 1 && n <= 40)) { sagen(m, 'nein', 'Eins bis vierzig.'); return; }
    this.disabled = true;
    var a = await ruf({
      action: 'codes_erzeugen', code: ich.code, auth: ich.auth,
      id: aktuelle.id, anzahl: String(n)
    });
    this.disabled = false;
    if (!a.ok) { sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig); return; }

    codeTabelleZeigen(a.codes, true);
    sagen(m, 'ja', a.codes.length + ' Codes erzeugt. Die Tabelle wird jetzt '
      + 'heruntergeladen – die PINs stehen nur dort.');
    codesHerunterladen(a.codes);
  });

  el('btnCodesTabelle').addEventListener('click', async function () {
    var m = el('meldungCodes');
    var a = await ruf({
      action: 'codes_liste', code: ich.code, auth: ich.auth, id: aktuelle.id
    });
    if (!a.ok) { sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig); return; }
    codeTabelleZeigen(a.codes, false);
    m.hidden = true;
  });

  function codeTabelleZeigen(codes, mitPin) {
    var t = el('codeTabelle');
    t.textContent = '';
    var kopf = t.createTHead().insertRow();
    ['Code', mitPin ? 'PIN' : 'benutzt', mitPin ? '' : 'abgegeben',
      mitPin ? '' : 'Resets', ''].forEach(function (x) {
      if (x === '') { return; }
      var th = document.createElement('th');
      th.textContent = x;
      kopf.appendChild(th);
    });
    var tb = t.createTBody();
    codes.forEach(function (c) {
      var tr = tb.insertRow();
      tr.insertCell().textContent = c.code;
      if (mitPin) {
        tr.insertCell().textContent = c.pin;
      } else {
        tr.insertCell().textContent = c.benutzt ? c.benutzt.slice(11, 16) : '–';
        tr.insertCell().textContent = c.abgegeben ? c.abgegeben.slice(11, 16) : '–';
        tr.insertCell().textContent = c.resets;
        var b = document.createElement('button');
        b.className = 'leise';
        b.textContent = 'zurücksetzen';
        b.addEventListener('click', function () { zuruecksetzen(c.code); });
        tr.insertCell().appendChild(b);
      }
    });
  }

  async function zuruecksetzen(tcode) {
    if (!confirm('Code ' + tcode + ' zurücksetzen? Eine vorhandene Abgabe '
      + 'geht dabei verloren, und der Vorgang steht später in der '
      + 'Ergebnistabelle.')) { return; }
    var a = await ruf({
      action: 'code_zuruecksetzen', code: ich.code, auth: ich.auth,
      id: aktuelle.id, tcode: tcode
    });
    sagen(el('meldungCodes'), a.ok ? 'ja' : 'nein',
      a.ok ? 'Zurückgesetzt.' : (FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig));
    if (a.ok) { el('btnCodesTabelle').click(); }
  }

  function codesHerunterladen(codes) {
    var zeilen = [['Code', 'PIN', 'Nachname', 'Vorname', 'Bildungsgang',
      'Klasse', 'Fach']];
    codes.forEach(function (c) { zeilen.push([c.code, c.pin, '', '', '', '', '']); });
    zeilen.push([]);
    zeilen.push(['Hinweis: Diese Datei bleibt auf deinem Gerät. Die Namen '
      + 'trägst du hier ein – auf dem Server gibt es dafür kein Feld.']);
    Xlsx.herunterladen(
      Xlsx.erzeugen([{ name: 'Codes', zeilen: zeilen }]),
      'teilnehmercodes.xlsx');
  }

  /* ---------- Ergebnisse ---------- */

  el('btnErgebnisse').addEventListener('click', async function () {
    var m = el('meldungErgebnisse');
    this.disabled = true;
    sagen(m, 'arbeit', 'Wird geholt, entschlüsselt und bewertet …');

    var a = await ruf({
      action: 'ergebnisse', code: ich.code, auth: ich.auth, id: aktuelle.id
    });
    if (!a.ok) {
      this.disabled = false;
      sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig);
      return;
    }

    var fragen, loesung;
    try {
      fragen = JSON.parse(a.fragen);
      loesung = await Krypto.mitPrivat(ich.privKey, a.loesung_chiffre);
    } catch (e) {
      this.disabled = false;
      sagen(m, 'nein', 'Der Lösungsschlüssel ließ sich nicht öffnen.');
      return;
    }

    var uebersicht = [['Code', 'Nachname', 'Vorname', 'Bildungsgang', 'Klasse',
      'Fach', 'Punkte', 'von', 'Prozent', 'abgegeben', 'Resets']];
    var einzeln = [['Code', 'Nachname', 'Vorname', 'Aufgabe', 'Frage',
      'stimmen', 'angekreuzt', 'richtig wäre', 'Punkte', 'von', 'Hinweis']];

    for (var i = 0; i < a.teilnahmen.length; i++) {
      var t = a.teilnahmen[i];
      if (!t.antwort_chiffre) {
        uebersicht.push([t.code, '', '', '', '', '', '', '', '',
          'nicht abgegeben', t.resets]);
        continue;
      }
      var inhalt;
      try {
        inhalt = await Krypto.mitPrivat(ich.privKey, t.antwort_chiffre);
      } catch (e) {
        uebersicht.push([t.code, '', '', '', '', '', '', '', '',
          'nicht lesbar', t.resets]);
        continue;
      }
      var e2 = Bewertung.abgabe(fragen, loesung.richtig, inhalt.antworten,
        loesung.verfahren);
      uebersicht.push([t.code, '', '', '', '', '', e2.punkte, e2.max,
        Math.round(e2.anteil * 100), (t.abgegeben || '').slice(0, 16), t.resets]);
      e2.zeilen.forEach(function (z) {
        einzeln.push([t.code, '', '', z.nr, z.text, z.anzahl,
          Bewertung.buchstaben(z.gewaehlt) || '–',
          Bewertung.buchstaben(z.richtig), z.punkte, z.max, z.hinweis]);
      });
    }

    var kopfzeilen = [
      ['Klausur', aktuelle.titel],
      ['Bewertung', (Bewertung.VERFAHREN[loesung.verfahren]
        || Bewertung.VERFAHREN.teilpunkte).name],
      ['Ausgewertet am', new Date().toLocaleString('de-DE')],
      ['Hinweis', 'Punkte, keine Noten. Die Namensspalten sind leer – auf '
        + 'dem Server gibt es dafür kein Feld.'],
      []
    ];

    Xlsx.herunterladen(Xlsx.erzeugen([
      { name: 'Übersicht', zeilen: kopfzeilen.concat(uebersicht) },
      { name: 'Einzeln', zeilen: einzeln }
    ]), 'ergebnisse.xlsx');

    this.disabled = false;
    sagen(m, 'ja', 'Fertig. Die Datei liegt in deinen Downloads und bleibt '
      + 'auf diesem Gerät.');
  });

  /* ---------- Was ohne WebCrypto nicht geht ---------- */
  if (!Krypto.verfuegbar) {
    sagen(el('meldungAnmelden'), 'nein',
      'Dieser Browser kann nicht verschlüsseln. Ohne das geht hier nichts.');
    el('btnAnmelden').disabled = true;
    el('btnNeu').disabled = true;
  }
}());
