# Feedback-API für t-bk.de — Integrationsanleitung für Content-Repos

Zentrale, **trackingfreie** Feedback-Funktion. Das Backend (Sammelstelle, Spam-Schutz,
Speicherung) liegt im Website-Repo `tbk-webseite` und läuft unter
`https://t-bk.de/api/`. **Dieses Repo baut nur die UI-Einbindung.**

## Grundregeln (nicht verhandelbar)
- **Kein Name / keine PII** abfragen. Erlaubt: Rolle (Schüler:in/Lehrkraft),
  Kategorie, optionaler Freitext.
- **Trackingfrei:** keine externen Skripte/Fonts/CDNs, keine Cookies.
- **Same-Origin:** alles läuft unter `t-bk.de`, also keine CORS-Sonderbehandlung nötig.
- Feedback ist **privat** — nichts davon wird auf der Seite öffentlich angezeigt.

## Weg A (empfohlen, ein Zweizeiler): fertiges Widget einbinden
Es gibt ein zentral gehostetes, fertiges Widget. Nur einbinden:

```html
<script src="/api/feedback-widget.js" defer></script>
```

und **dort, wo im Inhalt der Feedback-Button erscheinen soll** (z. B. am Ende jeder
Lektion / jedes Tools / jeder Übung), einen Marker platzieren:

```html
<div data-tbk-feedback></div>
```

Optional pro Marker (sonst automatisch `document.title` bzw. `location.pathname`):

```html
<div data-tbk-feedback data-title="Schraubverbindungen – Übung 1" data-path="/unterrichtsmaterial/uebungen/schraubverbindungen/"></div>
```

Das Widget rendert einen „💬 Feedback geben"-Button, klappt ein Formular auf
(Rolle · Kategorie · optionaler Text), holt selbst das Anti-Spam-Token und sendet.
Fertig. Es ist theme-neutral und kommt ohne Abhängigkeiten.

## Weg B: eigenes UI gegen die API bauen
Wenn ihr die UI selbst gestaltet, haltet euch an diesen Ablauf.

**1) Token holen** (beim Öffnen des Formulars):
```
GET https://t-bk.de/api/feedback.php?action=token
→ { "ts": 1694780000, "token": "<hmac>" }
```

**2) Absenden** (form-urlencoded ODER JSON):
```
POST https://t-bk.de/api/feedback.php
Felder:
  ts        (aus Schritt 1)
  token     (aus Schritt 1)
  hp        Honeypot – muss LEER bleiben (verstecktes Feld, für Menschen unsichtbar)
  role      "schueler" | "lehrkraft"
  category  "fehler" | "verstaendnis" | "lob" | "vorschlag" | "sonstiges"
  message   Freitext, optional, max 2000 Zeichen
  path      location.pathname des Inhalts
  title     Anzeigetitel des Inhalts
→ { "ok": true }  |  { "ok": false, "error": "..." }
```

**Spam-Schutz (vom Server erzwungen):**
- Token muss gültig sein (HMAC) und das Formular **≥ 3 Sekunden** offen gewesen sein
  (Token nicht vorab auf Vorrat holen — erst beim Öffnen).
- Honeypot-Feld `hp` muss leer sein.
- Ratenlimit: max. 12 Einsendungen pro Stunde und IP (IP wird nur **gehasht**
  verarbeitet, nie gespeichert im Klartext).

**Pflicht:** `role` und `category` müssen gesetzt/aus der Allowlist sein; `message`
ist optional. Nach Erfolg eine schlichte Dankesmeldung zeigen, **keine** Liste
anderer Feedbacks (privat!).

## Was ihr NICHT tun müsst/sollt
- Keine Server-/DB-/Clone-Schritte — das Backend steht schon.
- Keine IDs vergeben — `path` + `title` genügen zur Zuordnung.
- Keine externen Captcha-/Analytics-Dienste einbauen.

## Fragen zur Backend-Seite
Die klärt der Website-/Infra-Chat (dieser hier gehört nicht dazu). Meldet dort, falls
ihr zusätzliche Felder braucht.
