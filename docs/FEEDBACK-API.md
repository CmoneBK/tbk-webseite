# Feedback-API für t-bk.de — vollständige Integrationsanleitung

Diese Datei enthält **alles**, was ein Content-Repo braucht, um die Feedback-Funktion
einzubauen. Das Backend (Sammelstelle, Spam-Schutz, Speicherung) steht bereits und läuft
unter `https://t-bk.de/api/`.

## Was ihr baut — und was nicht
- **Ihr baut:** die Eingabe-UI an den Inhalten — Feedback *annehmen*, *absenden* und dem
  Nutzer eine Rückmeldung geben (Danke / Fehlerhinweis).
- **Ihr baut NICHT:** Speicherung, Anzeige anderer Feedbacks, Moderation, Auswertung.
  Das passiert zentral. Abgegebenes Feedback wird **nie öffentlich angezeigt** (privat).

## Grundregeln (nicht verhandelbar)
- **Kein Name / keine PII** abfragen. Erlaubt: Rolle (Schüler:in/Lehrkraft), Kategorie,
  optionaler Freitext.
- **Trackingfrei:** keine externen Skripte/Fonts/CDNs, keine Cookies, kein localStorage nötig.
- **Same-Origin:** alles unter `t-bk.de` → normale `fetch`-Aufrufe, keine CORS-Sonderfälle.

---

## Weg A (empfohlen): fertiges Widget einbinden

Zwei Zeilen. Skript einbinden:
```html
<script src="/api/feedback-widget.js" defer></script>
```
und **an jeder Stelle, wo ein Feedback-Button erscheinen soll** (i. d. R. am Ende jeder
Lektion / jedes Tools / jeder Übung / jedes Projekts), einen Marker setzen:
```html
<div data-tbk-feedback></div>
```

**Mehrere Inhalte auf einer Seite?** Einen Marker pro Inhalt, jeweils mit eigener Kennung:
```html
<div data-tbk-feedback
     data-title="Schraubverbindungen – Übung 1"
     data-path="/unterrichtsmaterial/uebungen/schraubverbindungen/"></div>
```
Ohne diese Attribute nimmt das Widget automatisch `document.title` und `location.pathname`.

**Aussehen anpassen** (optional): Akzentfarbe über CSS-Variable setzen:
```css
.tbkfb { --tbkfb-accent: #b34700; }
```
Das Widget ist theme-neutral (hell/dunkel), ohne Abhängigkeiten, und regelt Token,
Zeitfalle, Honeypot und die Dankesmeldung selbst. **Wenn Weg A reicht, seid ihr hier fertig.**

---

## Weg B: eigene UI gegen die API bauen

### Ablauf
1. **Token holen**, sobald das Formular geöffnet wird (nicht beim Seitenladen — die
   Zeitfalle misst ab dem Token):
   ```
   GET https://t-bk.de/api/feedback.php?action=token
   → { "ts": 1789452359, "token": "72dbaefd…" }
   ```
2. **Absenden** (form-urlencoded ODER JSON-Body):
   ```
   POST https://t-bk.de/api/feedback.php
   ```
   | Feld | Pflicht | Wert |
   |------|---------|------|
   | `ts` | ja | aus Schritt 1 |
   | `token` | ja | aus Schritt 1 |
   | `hp` | ja | **muss leer sein** (Honeypot; verstecktes Feld) |
   | `role` | ja | `schueler` \| `lehrkraft` |
   | `category` | ja | `fehler` \| `verstaendnis` \| `lob` \| `vorschlag` \| `sonstiges` |
   | `message` | nein | Freitext, max **2000** Zeichen |
   | `path` | ja | `location.pathname` des Inhalts (Zuordnung) |
   | `title` | ja | Anzeigetitel des Inhalts |
   ```
   → { "ok": true }  |  { "ok": false, "error": "…" }
   ```

### Empfohlene deutsche Beschriftungen
- Rollen: `schueler` → „Schüler:in", `lehrkraft` → „Lehrkraft".
- Kategorien: `lob` → „Lob", `fehler` → „Fehler / etwas stimmt nicht",
  `verstaendnis` → „Verständnisproblem", `vorschlag` → „Vorschlag / Idee",
  `sonstiges` → „Sonstiges".

### Antworten behandeln
| Antwort (HTTP) | Bedeutung | So reagiert die UI |
|---|---|---|
| `{"ok":true}` (200) | gespeichert | Formular durch „Danke für dein Feedback!" ersetzen |
| `error:"too fast"` (429) | < 3 s ausgefüllt | kurz warten, **nochmal senden** (Token bleibt gültig) |
| `error:"rate limit"` (429) | zu viele von dieser IP (max. 12/Std.) | „Zu viele Einsendungen, bitte später." |
| `error:"bad token"` / `"token expired"` (400) | Token ungültig/älter als 2 h | neues Token holen, erneut senden |
| `error:"bad role"` / `"bad category"` (400) | Pflichtfeld fehlt/ungültig | Auswahl prüfen |
| `error:"db error"` / `"config missing"` (500) | Serverseitig | „Gerade nicht möglich, später erneut." (nicht euer Fehler) |

### Spam-Schutz (vom Server erzwungen — nur damit ihr das Verhalten kennt)
- Gültiges HMAC-Token **und** Formular ≥ 3 s offen (darum Token erst beim Öffnen holen).
- Honeypot `hp` muss leer sein.
- Ratenlimit 12/Stunde je IP (IP wird nur **gehasht** verarbeitet, nie im Klartext).

### Vollständiges Referenz-Beispiel (eigenständig, ohne Abhängigkeiten)
```html
<div id="fb"></div>
<script>
(function () {
  var API = "/api/feedback.php";
  var PATH = location.pathname;   // oder feste Kennung des Inhalts
  var TITLE = document.title;
  var mount = document.getElementById("fb");
  mount.innerHTML =
    '<button type="button" id="fb-open">Feedback geben</button>' +
    '<form id="fb-form" hidden>' +
    '  <p><label><input type="radio" name="role" value="schueler" checked> Schüler:in</label> ' +
    '     <label><input type="radio" name="role" value="lehrkraft"> Lehrkraft</label></p>' +
    '  <p><select name="category">' +
    '     <option value="lob">Lob</option>' +
    '     <option value="fehler">Fehler / etwas stimmt nicht</option>' +
    '     <option value="verstaendnis">Verständnisproblem</option>' +
    '     <option value="vorschlag">Vorschlag / Idee</option>' +
    '     <option value="sonstiges">Sonstiges</option>' +
    '  </select></p>' +
    '  <p><textarea name="message" maxlength="2000" placeholder="Optional – kein Name nötig"></textarea></p>' +
    '  <input type="text" name="hp" tabindex="-1" autocomplete="off" aria-hidden="true" ' +
    '         style="position:absolute;left:-9999px;width:1px;height:1px">' +
    '  <p><button type="submit">Absenden</button> <span id="fb-msg"></span></p>' +
    '</form>';

  var form = mount.querySelector("#fb-form");
  var msg  = mount.querySelector("#fb-msg");
  var tok  = null;

  mount.querySelector("#fb-open").addEventListener("click", function () {
    form.hidden = !form.hidden;
    if (!form.hidden && !tok) {                 // Token erst beim Öffnen holen
      fetch(API + "?action=token").then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.token) tok = d; }).catch(function () {});
    }
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!tok) { msg.textContent = "Bitte kurz warten …"; return; }
    var body = new URLSearchParams(new FormData(form)); // enthält role, category, message, hp
    body.set("ts", tok.ts); body.set("token", tok.token);
    body.set("path", PATH); body.set("title", TITLE);
    fetch(API, { method: "POST",
                 headers: { "Content-Type": "application/x-www-form-urlencoded" },
                 body: body.toString() })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.ok) { form.innerHTML = "Danke für dein Feedback!"; }
        else if (d && d.error === "too fast") { msg.textContent = "Kurz warten und nochmal senden."; }
        else if (d && d.error === "rate limit") { msg.textContent = "Zu viele Einsendungen – bitte später."; }
        else { msg.textContent = "Konnte nicht gesendet werden – bitte später erneut."; tok = null; }
      })
      .catch(function () { msg.textContent = "Netzwerkfehler – bitte später erneut."; });
  });
})();
</script>
```

---

## Barrierefreiheit & UX
- Sichtbares `<label>` für jedes Feld; das Honeypot-Feld `hp` per `aria-hidden` und
  Positionierung außerhalb des Sichtfelds verstecken (nicht `display:none` allein — manche
  Bots erkennen das).
- Kein Pflicht-Freitext: `message` ist optional, Kategorie genügt.
- Nach Erfolg klar bestätigen und das Formular schließen/ersetzen.

## Verifizieren, dass eure Einbindung funktioniert
1. Formular öffnen, **≥ 3 Sekunden** warten, absenden → es muss „Danke …" erscheinen
   (Antwort `{"ok":true}`).
2. Sofort ein zweites Mal absenden ohne neues Öffnen → sollte weiterhin gehen, bis das
   Stundenlimit greift.
3. Ihr seht die gespeicherten Daten **nicht** (privat/zentral) — `{"ok":true}` ist euer
   Erfolgsnachweis.

## Was ihr NICHT tun müsst/sollt
- Keine Server-/DB-/Deploy-Schritte — das Backend steht.
- Keine IDs vergeben — `path` + `title` genügen zur Zuordnung.
- Keine externen Captcha-/Analytics-Dienste.
- Keine Anzeige/Moderation abgegebener Feedbacks bauen.

## Weg C: Feedback lesen (nur vertrauenswürdige Clients — KEINE Webseite)

Zum Auslesen der gesammelten Rückmeldungen gibt es einen **geschützten** Endpunkt.
Er ist **nicht** für eine Browser-Seite gedacht: Der Schlüssel darf **niemals** in
eine öffentliche Seite oder ein Repo. Gedacht ist er für einen vertrauenswürdigen
Client — z. B. Claude Code per `curl`, oder ein privates Skript auf einem Rechner der
Lehrkraft.

```
GET /api/feedback.php?action=liste
Authorization: Bearer <SCHLÜSSEL>        (alternativ ?key=<SCHLÜSSEL>)
```

Parameter (alle optional):

| Param | Wirkung |
|---|---|
| `seit` | ISO-Datum oder Unix-Zeit — nur Neueres |
| `limit` | 1..200, Default 50 |
| `pfad` | Präfix-Filter, z. B. `/unterrichtsmaterial/lernsituationen/` |
| `status` | `neu` \| `erledigt` \| `spam` (Zusatzfilter) |

Antwort:
```json
{ "ok": true, "anzahl": 7, "neuestes": "2026-09-17T18:22:05+02:00",
  "eintraege": [
    { "id": 143, "zeit": "2026-09-17T18:22:05+02:00", "rolle": "schueler",
      "kategorie": "fehler", "nachricht": "…", "pfad": "/unterrichtsmaterial/…",
      "titel": "…", "status": "neu" }
  ] }
```

- Ohne gültigen Schlüssel: **401**, keine Daten.
- Die Antwort enthält **keine IP / keinen IP-Hash / nichts Personenbezogenes**.
- `Authorization: Bearer` bevorzugen — steht so nicht in Server-Logs (anders als `?key=`).
- Der Schlüssel liegt serverseitig in `feedback-config.php` (`files/`) und wird separat
  übergeben, **nicht** in dieser Datei notiert.
- Als „erledigt"/„spam" markieren geht derzeit per SQL/Absprache mit dem Website-Chat;
  ein Schreib-Endpunkt lässt sich bei Bedarf nachrüsten.

## Backend-Fragen / neue Felder
Das entscheidet der Website-/Infra-Chat (nicht dieses Repo). Braucht ihr ein zusätzliches
Feld oder eine andere Kategorie, meldet es dort — dann werden Endpoint, Datenbank und
Datenschutzerklärung passend erweitert.
