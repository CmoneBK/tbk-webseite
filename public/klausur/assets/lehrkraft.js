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
  var aktuelle = null;     /* {id, titel} */

  function angemeldet() { return !!ich.privKey; }

  /* ================= Anmelden und Zugang anlegen ================= */

  el('btnZeigNeu').addEventListener('click', function () {
    var k = el('kastenNeu');
    k.hidden = !k.hidden;
  });

  el('npass').addEventListener('input', function () {
    var s = Krypto.staerke(this.value);
    el('staerke').textContent = this.value
      ? 'Stärke: ' + s.urteil + ' (' + s.bits + ' Bit)' : ' ';
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

  /* Lösungen ein-/ausblenden und Teilmenge-Feld zeigen. */
  el('loesungenZeigen').addEventListener('change', poolZeichnen);
  el('teilmengeAn').addEventListener('change', function () {
    el('teilmengeZeile').hidden = !this.checked;
    poolStand();
  });

  async function poolLaden() {
    var m = el('meldungPool');
    sagen(m, 'arbeit', 'Fragenpool wird geladen …');
    var a = await ruf({ action: 'fragenpool', code: ich.code, auth: ich.auth });
    if (!a.ok) { sagen(m, 'nein', FEHLERTEXT[a.fehler] || FEHLERTEXT.ungueltig); return; }
    pool = a.pool || [];
    m.hidden = true;
    ebenenFuellen();
    poolZeichnen();
  }

  function istRichtig(f, o) { return (f.richtig || []).indexOf(o) !== -1; }

  /* UTF-8 nach Base64. btoa allein kann nur Latin-1, und in den Bildern
     stehen Umlaute und das Gradzeichen. */
  function zuBase64(s) {
    var bytes = new TextEncoder().encode(s), roh = '';
    for (var i = 0; i < bytes.length; i++) { roh += String.fromCharCode(bytes[i]); }
    return btoa(roh);
  }

  /* Ein Bild zur Frage wird als <img> gezeigt, nicht inline eingesetzt:
     In einem <img> läuft kein Skript, und die Grafik kann nichts
     nachladen. Dieselbe Regel gilt beim Teilnehmer. */
  function bildKnoten(i, svg) {
    var b = document.createElement('img');
    b.className = 'aufgabenbild';
    b.alt = 'Bild zur Aufgabe';
    /* Umrechnen ist teuer, und beim Filtern wird oft neu gezeichnet. */
    if (bildCache[i] === undefined) {
      bildCache[i] = 'data:image/svg+xml;base64,' + zuBase64(svg);
    }
    b.src = bildCache[i];
    return b;
  }

  /* Welche Antworten sind beim Aufschlagen vorausgewählt? Wenn der Pool ein
     Feld `standard` mitbringt, das; sonst alle richtigen plus so viele
     falsche, bis fünf zusammenkommen. So ist die Vorauswahl immer gültig
     (mindestens eine richtige, mindestens eine falsche) und, wenn möglich,
     genau fünf - mehr Antworten stehen im Pool zum Dazunehmen bereit. */
  function standardAuswahl(f) {
    if (Array.isArray(f.standard) && f.standard.length) { return f.standard.slice(); }
    var sel = (f.richtig || []).slice();
    for (var o = 0; o < f.optionen.length && sel.length < 5; o++) {
      if (sel.indexOf(o) === -1) { sel.push(o); }
    }
    return sel;
  }

  /* ==================== Filter und Auswahl ====================

     Der Pool ist gewachsen. Damit eine Klausur nicht aus dem besteht, was
     zufällig oben steht, wird er gefiltert - vier Ebenen tief und in der
     Sprache des Materials: Bereich, Unterkategorie, Einheit, Thema. Jede
     Ebene zeigt nur, was nach den Ebenen darüber noch übrig ist.

     Wichtig dabei: Die Auswahl darf nicht am Filter hängen. Sie liegt
     deshalb im Modell und nicht in den Kästchen. Wer zehn Aufgaben zum
     Drehen wählt und dann auf Schweißen umstellt, hat am Ende zwanzig -
     auch wenn die ersten zehn gerade nicht zu sehen sind. */

  var gewaehlt = {};        // Poolindex -> in der Klausur?
  var optWahl = {};         // Poolindex -> gewählte Antwortindizes
  var bildCache = {};       // Poolindex -> data-URL
  var suchUhr = null;

  var EBENEN = ['fBereich', 'fUnter', 'fEinheit', 'fThema'];
  var OHNE = 'ohne Zuordnung';

  /* Vier Ebenen zu einer Frage. Ältere Poolstände kennen nur "thema";
     aus "Drehen: Schnittdaten" werden dann die beiden unteren Ebenen,
     die oberen bleiben leer. Lieber zwei Ebenen als gar keine. */
  function pfadVon(f) {
    if (Array.isArray(f.pfad) && f.pfad.length === 4) { return f.pfad; }
    var t = String(f.thema || 'Ohne Thema').split(':');
    var kopf = t.length > 1 ? t.shift().trim() : OHNE;
    return [OHNE, OHNE, kopf, t.join(':').trim()];
  }

  function neueOption(wert, text) {
    var o = document.createElement('option');
    o.value = wert;
    o.textContent = text;
    return o;
  }

  /* Gesucht wird in Frage UND Antworten: Wer "Rautiefe" eingibt, will auch
     die Frage finden, bei der das Wort nur in einer Option steht. */
  function trifft(f, such) {
    if (String(f.text).toLowerCase().indexOf(such) !== -1) { return true; }
    for (var o = 0; o < f.optionen.length; o++) {
      if (String(f.optionen[o]).toLowerCase().indexOf(such) !== -1) { return true; }
    }
    return false;
  }

  /* Die Indizes der Fragen, die nach allen Filtern übrig bleiben. */
  function sichtbare() {
    var such = el('fSuche').value.trim().toLowerCase();
    var bild = el('fBild').value;
    var punkte = el('fPunkte').value;
    var reserve = el('fReserve').value;
    var stufen = EBENEN.map(function (id) { return el(id).value; });
    var raus = [];
    pool.forEach(function (f, i) {
      var p = pfadVon(f);
      for (var e = 0; e < stufen.length; e++) {
        if (stufen[e] && p[e] !== stufen[e]) { return; }
      }
      if (bild === 'mit' && !f.bild) { return; }
      if (bild === 'ohne' && f.bild) { return; }
      /* Ein Punkt je richtiger Antwort - so rechnet bewertung.js. */
      var n = (f.richtig || []).length;
      if (punkte === '4' && n < 4) { return; }
      if (punkte && punkte !== '4' && n !== Number(punkte)) { return; }
      /* Wie viele Antworten über die Vorauswahl hinaus bereitstehen.
         Nur dort lässt sich beim Zusammenstellen wirklich tauschen. */
      if (reserve
          && f.optionen.length - standardAuswahl(f).length < Number(reserve)) {
        return;
      }
      if (such && !trifft(f, such)) { return; }
      raus.push(i);
    });
    return raus;
  }

  /* Die vier Auswahllisten füllen. Jede Ebene zeigt nur, was nach den
     Ebenen darüber noch da ist, und sagt dazu, wie viele Fragen das sind.
     Steht eine getroffene Wahl nicht mehr zur Verfügung, fällt sie auf
     "alle" zurück - sonst zeigte der Filter ins Leere. */
  function ebenenFuellen() {
    var wahl = EBENEN.map(function (id) { return el(id).value; });
    EBENEN.forEach(function (id, e) {
      var zaehl = {}, gesamt = 0;
      pool.forEach(function (f) {
        var p = pfadVon(f);
        for (var o = 0; o < e; o++) {
          if (wahl[o] && p[o] !== wahl[o]) { return; }
        }
        zaehl[p[e]] = (zaehl[p[e]] || 0) + 1;
        gesamt++;
      });
      var namen = Object.keys(zaehl).sort();
      if (wahl[e] && namen.indexOf(wahl[e]) === -1) { wahl[e] = ''; }
      var sel = el(id);
      sel.textContent = '';
      sel.appendChild(neueOption('', 'alle (' + gesamt + ')'));
      namen.forEach(function (n) {
        sel.appendChild(neueOption(n, n + '  (' + zaehl[n] + ')'));
      });
      sel.value = wahl[e];
    });
  }

  function filterNeu() {
    ebenenFuellen();
    poolZeichnen();
  }

  EBENEN.forEach(function (id) {
    el(id).addEventListener('change', filterNeu);
  });
  el('fBild').addEventListener('change', poolZeichnen);
  el('fPunkte').addEventListener('change', poolZeichnen);
  el('fReserve').addEventListener('change', poolZeichnen);
  el('fSuche').addEventListener('input', function () {
    /* Bei jedem Tastendruck 404 Blöcke neu zu bauen wäre zäh. */
    clearTimeout(suchUhr);
    suchUhr = setTimeout(poolZeichnen, 200);
  });

  el('btnFilterWeg').addEventListener('click', function () {
    EBENEN.forEach(function (id) { el(id).value = ''; });
    el('fSuche').value = '';
    el('fBild').value = '';
    el('fPunkte').value = '';
    el('fReserve').value = '';
    filterNeu();
  });

  el('btnSichtbarAn').addEventListener('click', function () {
    sichtbare().forEach(function (i) { gewaehlt[i] = true; });
    poolZeichnen();
  });

  el('btnSichtbarAus').addEventListener('click', function () {
    sichtbare().forEach(function (i) { delete gewaehlt[i]; });
    poolZeichnen();
  });

  el('btnWahlLeeren').addEventListener('click', function () {
    gewaehlt = {};
    poolZeichnen();
  });

  /* ---------- Zeichnen ---------- */

  function poolZeichnen() {
    var ziel = el('pool');
    ziel.textContent = '';
    if (!pool.length) {
      ziel.innerHTML = '<p class="fussnote">Der Fragenpool ist leer. Er liegt '
        + 'auf dem Server außerhalb des öffentlichen Bereichs &ndash; siehe '
        + '<code>klausur-config.php</code>, Schlüssel <code>fragenpool</code>.</p>';
      poolStand();
      return;
    }
    var zeigL = el('loesungenZeigen').checked;
    var liste = sichtbare();

    if (!liste.length) {
      ziel.innerHTML = '<p class="fussnote">Keine Frage passt zu diesem '
        + 'Filter. Eine Ebene höher gehen oder die Suche leeren.</p>';
      poolStand();
      return;
    }

    /* Nach Pfad gruppieren, damit die Überschriften die Ordnung zeigen,
       nach der gefiltert wird. */
    var gruppen = {}, reihe = [];
    liste.forEach(function (i) {
      var p = pfadVon(pool[i]);
      var schl = p.join(' › ');
      if (!gruppen[schl]) { gruppen[schl] = { p: p, wer: [] }; reihe.push(schl); }
      gruppen[schl].wer.push(i);
    });
    reihe.sort();

    var letzterKopf = '';
    reihe.forEach(function (schl) {
      var g = gruppen[schl];
      var kopf = g.p[0] + ' / ' + g.p[1];
      if (kopf !== letzterKopf) {
        var k = document.createElement('p');
        k.className = 'poolBereich';
        k.textContent = kopf;
        ziel.appendChild(k);
        letzterKopf = kopf;
      }
      var h = document.createElement('h4');
      h.className = 'poolThema';
      h.textContent = g.p[2] + ' · ' + g.p[3];
      var n = document.createElement('span');
      n.textContent = g.wer.length + (g.wer.length === 1 ? ' Frage' : ' Fragen');
      h.appendChild(n);
      ziel.appendChild(h);

      g.wer.forEach(function (i) { ziel.appendChild(frageKnoten(i, zeigL)); });
    });
    poolStand();
  }

  function frageKnoten(i, zeigL) {
    var f = pool[i];
    var block = document.createElement('div');
    block.className = 'poolFrage';

    var kopf = document.createElement('label');
    kopf.className = 'option';
    var kq = document.createElement('input');
    kq.type = 'checkbox';
    kq.className = 'fInc';
    kq.dataset.i = String(i);
    kq.checked = !!gewaehlt[i];
    kq.addEventListener('change', function () {
      if (this.checked) { gewaehlt[i] = true; } else { delete gewaehlt[i]; }
      block.classList.toggle('drin', this.checked);
      poolStand();
    });
    var sp = document.createElement('span');
    var stark = document.createElement('strong');
    stark.textContent = f.text;
    sp.appendChild(stark);
    kopf.appendChild(kq);
    kopf.appendChild(sp);
    block.appendChild(kopf);
    if (gewaehlt[i]) { block.classList.add('drin'); }

    if (f.bild) { block.appendChild(bildKnoten(i, f.bild)); }

    var vor = optWahl[i] || standardAuswahl(f);
    var optWrap = document.createElement('div');
    optWrap.className = 'poolOptionen';
    f.optionen.forEach(function (optText, o) {
      var zeile = document.createElement('label');
      zeile.className = 'option';
      var ko = document.createElement('input');
      ko.type = 'checkbox';
      ko.className = 'oInc';
      ko.dataset.i = String(i);
      ko.dataset.o = String(o);
      ko.checked = vor.indexOf(o) !== -1;
      ko.addEventListener('change', function () {
        var sel = (optWahl[i] || standardAuswahl(f)).slice();
        var pos = sel.indexOf(o);
        if (this.checked && pos === -1) { sel.push(o); }
        if (!this.checked && pos !== -1) { sel.splice(pos, 1); }
        sel.sort(function (a, b) { return a - b; });
        optWahl[i] = sel;
        poolStand();
      });
      var os = document.createElement('span');
      var ob = document.createElement('strong');
      ob.textContent = String.fromCharCode(97 + o) + ') ';
      os.appendChild(ob);
      os.appendChild(document.createTextNode(optText));
      if (zeigL && istRichtig(f, o)) {
        var badge = document.createElement('span');
        badge.className = 'istRichtig';
        badge.textContent = '  ✓ richtig';
        os.appendChild(badge);
      }
      zeile.appendChild(ko);
      zeile.appendChild(os);
      optWrap.appendChild(zeile);
    });
    block.appendChild(optWrap);
    return block;
  }

  /* Die gewählten Aufgaben mit ihren gewählten Antwortindizes, in der
     Reihenfolge des Pools. Aus dem Modell, nicht aus dem Bildschirm -
     sonst fiele weg, was der Filter gerade nicht zeigt. */
  function gewaehltAufbereiten() {
    var out = [];
    pool.forEach(function (f, i) {
      if (!gewaehlt[i]) { return; }
      out.push({ f: f, sel: (optWahl[i] || standardAuswahl(f)).slice() });
    });
    return out;
  }

  function poolStand() {
    var g = gewaehltAufbereiten();
    var punkte = 0, krumm = 0;
    g.forEach(function (e) {
      var rich = e.sel.filter(function (o) { return istRichtig(e.f, o); });
      var falsch = e.sel.filter(function (o) { return !istRichtig(e.f, o); });
      if (rich.length < 1 || falsch.length < 1) { krumm++; }
      punkte += rich.length;
    });
    el('poolStand').textContent = g.length
      ? g.length + ' Aufgaben, zusammen bis zu ' + punkte + ' Punkte '
        + '(bei „Teilpunkte").'
        + (krumm ? '  Achtung: ' + krumm + ' Aufgabe(n) brauchen noch '
          + 'mindestens eine richtige und eine falsche Antwort.' : '')
      : 'Noch keine Aufgabe gewählt.';

    /* Wie viele Gewählte der Filter gerade verdeckt. Ohne diese Zahl
       wirkt eine Auswahl verschwunden, die in Wahrheit noch da ist. */
    var sicht = pool.length ? sichtbare() : [];
    var offen = 0;
    sicht.forEach(function (i) { if (gewaehlt[i]) { offen++; } });
    var versteckt = g.length - offen;
    el('filterStand').textContent = pool.length
      ? sicht.length + ' von ' + pool.length + ' Fragen sichtbar'
        + (versteckt ? '  ·  ' + versteckt + ' gewählte Aufgabe'
          + (versteckt === 1 ? '' : 'n') + ' liegen außerhalb des Filters '
          + '(sie bleiben in der Klausur).' : '')
      : '';

    var tn = el('teilmengeN');
    tn.max = String(g.length);
    if (Number(tn.value) > g.length) { tn.value = String(g.length || 1); }
    if (!tn.value || Number(tn.value) < 1) { tn.value = String(Math.min(g.length, Math.max(1, g.length))); }
  }

  el('btnAnlegen').addEventListener('click', async function () {
    var m = el('meldungAnlegen');
    var g = gewaehltAufbereiten();
    var titel = el('ktitel').value.trim();
    var tage = Number(el('ktage').value);
    if (!g.length) { sagen(m, 'nein', 'Ohne Aufgaben keine Klausur.'); return; }
    if (!titel) { sagen(m, 'nein', 'Ein Titel für dich selbst.'); return; }
    if (!(tage >= 1 && tage <= 60)) { sagen(m, 'nein', 'Eins bis sechzig Tage.'); return; }

    /* Jede Aufgabe braucht mindestens eine richtige und eine falsche
       ausgewählte Antwort. Der Server kann das nicht prüfen - er kennt den
       Lösungsschlüssel nicht -, also fängt es hier ab. */
    var krumm = g.filter(function (e) {
      var rich = e.sel.filter(function (o) { return istRichtig(e.f, o); }).length;
      var falsch = e.sel.length - rich;
      return rich < 1 || falsch < 1;
    });
    if (krumm.length) {
      sagen(m, 'nein', 'Bei ' + krumm.length + ' Aufgabe(n) fehlt eine richtige '
        + 'oder eine falsche Antwort: „' + krumm[0].f.text.slice(0, 60) + '“');
      return;
    }

    /* Mischen und Teilmenge. */
    var mischen = {
      fragen: el('mischFragen').checked,
      optionen: el('mischOptionen').checked,
      teilmenge: null
    };
    if (el('teilmengeAn').checked) {
      var n = Number(el('teilmengeN').value);
      if (!(n >= 1 && n <= g.length)) {
        sagen(m, 'nein', 'Die Teilmenge muss zwischen 1 und ' + g.length
          + ' liegen.');
        return;
      }
      if (n < g.length) { mischen.teilmenge = n; }
    }

    this.disabled = true;
    sagen(m, 'arbeit', 'Wird verschlüsselt …');

    /* Feste Reihenfolge: Text, gewählte Optionen, wie viele stimmen.
       Der Lösungsschlüssel geht getrennt und verschlüsselt - seine Indizes
       zeigen auf genau diese gewählte Optionen-Teilmenge. */
    var aufgaben = [], richtigAll = [];
    g.forEach(function (e) {
      var optionen = e.sel.map(function (o) { return e.f.optionen[o]; });
      var richtigNeu = [];
      e.sel.forEach(function (o, neu) { if (istRichtig(e.f, o)) { richtigNeu.push(neu); } });
      var aufgabe = { text: e.f.text, optionen: optionen, anzahl: richtigNeu.length };
      /* Das Bild hängt an der Frage, nicht an einer Option - es übersteht
         deshalb auch das Mischen der Antworten. */
      if (e.f.bild) { aufgabe.bild = e.f.bild; }
      aufgaben.push(aufgabe);
      richtigAll.push(richtigNeu);
    });

    var fragen = { v: 2, mischen: mischen, aufgaben: aufgaben };
    var loesung = { v: 1, verfahren: el('kverfahren').value, richtig: richtigAll };

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

    var aufgaben, loesung, gemischt;
    try {
      var roh = JSON.parse(a.fragen);
      aufgaben = Array.isArray(roh) ? roh : (roh.aufgaben || []);
      gemischt = !Array.isArray(roh) && roh.mischen
        && (roh.mischen.fragen || roh.mischen.optionen || roh.mischen.teilmenge);
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
      var e2 = Bewertung.abgabe(aufgaben, loesung.richtig, inhalt.antworten,
        loesung.verfahren, inhalt.auswahl);
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
      (gemischt ? ['Hinweis', 'Reihenfolge/Auswahl war je Teilnehmer '
        + 'unterschiedlich. Die Antwortbuchstaben in „Einzeln" beziehen sich '
        + 'auf die feste Reihenfolge der Aufgabe, nicht auf das, was der '
        + 'Teilnehmer auf dem Bildschirm sah.'] : []),
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
