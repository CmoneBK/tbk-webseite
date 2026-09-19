# Klausur-API für t-bk.de

**Stand:** 19.09.2026 — **im Bau, nicht freigegeben.** Die Dateien liegen
unter `public/klausur/`, sind aber nirgends verlinkt, tragen `noindex` und
ohne handvergebenen Einladungscode entsteht kein Zugang. · Repo
`tbk-webseite`

Diese Datei ist der Vertrag: Verhalten, Felder, Tabellen und Grenzen, so
beschrieben, dass Server und Client sich darauf verlassen können. Aufgebaut
wie `FORTSCHRITT-API.md`, weil dieselben Grundregeln gelten — mit einer
Ausnahme, die gleich am Anfang stehen muss.

---

## 1. Die Ausnahme, und warum sie vertretbar ist

`FORTSCHRITT-API.md` sagt unter „Was ihr nicht baut":

> **Keine Lehreransicht.** […] Sobald jemand von außen hineinsehen kann, ist
> aus einer Lernhilfe eine Leistungserhebung geworden — mit allem, was
> schulrechtlich daran hängt.

Genau das ist hier gewollt. Der Satz bleibt trotzdem richtig, und deshalb ist
dies ein **eigener Bereich mit eigener Datenbank, eigenem Endpunkt und
eigenen Regeln** — nicht eine Erweiterung des Fortschritts.

Der Unterschied, der es trägt: **Der Server ist ein Briefkasten, kein
Prüfer.** Er sieht keine Antworten, keine Punkte, keine Namen und keine
Klassen. Er bewahrt Chiffrate auf, die nur die Lehrkraft öffnen kann, und er
löscht sie nach einer Frist, die die Lehrkraft gesetzt hat.

Was das für die Rollen bedeutet, steht in Abschnitt 9.

---

## 2. Grundregeln (nicht verhandelbar)

* **Keine Namen, keine Klassen, keine Schulen auf dem Server.** Es gibt kein
  Eingabefeld dafür. Auch nicht „freiwillig", auch nicht „nur für die
  Lehrkraft". Wer eine Zuordnung braucht, macht sie auf dem eigenen Gerät in
  der heruntergeladenen Datei.
* **Keine IP-Adresse.** Nicht gespeichert, nicht gehasht, und die Endpunkte
  gehören aus dem Zugriffsprotokoll des Webservers heraus (Abschnitt 10).
* **Kein Cookie, keine Session.** Code und Passphrase bzw. Code und PIN
  werden bei jeder Anfrage mitgeschickt; der Browser hält sie im
  Arbeitsspeicher der Seite, nicht im Speicher des Geräts.
* **Der Server sieht keinen Klartext von Antworten.** Er speichert, was der
  Browser des Teilnehmers verschlüsselt hat, und gibt es unverändert zurück.
* **Der Server kennt keinen Lösungsschlüssel.** Auch der liegt verschlüsselt
  da.
* **Keine Selbstregistrierung.** Ein Zugang entsteht nur über einen
  Einladungscode, den der Betreiber von Hand einträgt.
* **Same-Origin.** Kein CORS.
* **Keine Protokollzeile mit Inhalt.** Fehler dürfen protokolliert werden,
  aber ohne Code, ohne Passphrase, ohne Chiffrat.

---

## 3. Die Schlüssel

Das ist der Kern. Wer ihn nicht versteht, baut eine Hintertür ein, ohne es
zu merken.

Die Lehrkraft wählt **eine Passphrase**. Aus ihr leitet der Browser mit
PBKDF2-SHA-256 (600 000 Runden, Salt vom Server) einen Wert `K` ab und daraus
zwei getrennte Dinge:

```
K       = PBKDF2(passphrase, salt, 600000)
authWert = HKDF(K, "auth")        → geht zum Server
wrapKey  = HKDF(K, "wrap")        → bleibt im Browser
```

* Der Server speichert `password_hash(authWert)` — er prüft damit die
  Anmeldung und kennt die Passphrase nicht.
* `wrapKey` verschlüsselt den **privaten Schlüssel** des Kontos (AES-GCM).
  Das Chiffrat liegt auf dem Server, damit die Lehrkraft das Gerät wechseln
  kann. Öffnen kann es nur, wer die Passphrase kennt.
* Der **öffentliche Schlüssel** (RSA-OAEP 3072) liegt im Klartext auf dem
  Server. Er muss dort liegen: Der Browser des Teilnehmers holt ihn, um seine
  Antworten damit zu verschlüsseln.

Antworten werden hybrid verschlüsselt: zufälliger AES-256-GCM-Schlüssel je
Abgabe, damit verschlüsselt der Antwortsatz, der AES-Schlüssel wiederum mit
RSA-OAEP für den öffentlichen Schlüssel der Lehrkraft.

**Eine vergessene Passphrase ist das Ende.** Es gibt keine
Wiederherstellung, weil es keine geben kann. Das steht beim Anlegen des
Zugangs im Klartext auf dem Bildschirm.

---

## 4. Der Ablauf

```
Betreiber  prüft die dienstliche Adresse der Schule
           trägt einen Einladungscode in die Datenbank ein

Lehrkraft  action=konto_neu       Einladungscode + Passphrase
             → Browser erzeugt Schlüsselpaar, verpackt den privaten Teil
             → Server gibt den Lehrkraft-Code zurück

           action=klausur_anlegen  Fragen (klar) + Lösungsschlüssel (Chiffrat)
           action=codes_erzeugen   n Teilnehmercodes + PINs
             → Download als Tabelle mit leerer Namensspalte
           action=klausur_oeffnen  jetzt dürfen Teilnehmer starten

Teilnehmer action=start            Code + PIN → Fragen + öffentlicher Schlüssel
             → beantwortet im Browser
           action=abgeben          Chiffrat

Lehrkraft  action=klausur_beenden
           action=ergebnisse       alle Chiffrate
             → Browser entschlüsselt, bewertet, erzeugt die Tabelle
```

Bewertet wird **im Browser der Lehrkraft**. Der Server rechnet nichts aus.

---

## 5. Die Endpunkte

Alles über `POST` an `/klausur/api/pruefung.php`, `Content-Type:
application/x-www-form-urlencoded`, Antwort immer JSON.

Gemeinsame Antwortfelder: `ok` (`true`/`false`) und bei `ok:false` ein
`fehler` aus Abschnitt 8.

### Anmeldung der Lehrkraft

Jede Lehrkraft-Aktion schickt `code` und `auth` mit. Es gibt keine Sitzung.

| Aktion | Felder | Antwort |
| --- | --- | --- |
| `konto_salt` | `einladung` | `salt` — vor dem Anlegen, damit der Browser ableiten kann |
| `konto_neu` | `einladung`, `auth`, `oeff`, `priv_chiffre` | `code` |
| `konto_salt_code` | `code` | `salt` — vor der Anmeldung auf einem neuen Gerät |
| `konto_schluessel` | `code`, `auth` | `oeff`, `priv_chiffre` |
| `konto_passphrase` | `code`, `auth`, `auth_neu`, `salt_neu`, `priv_chiffre_neu` | — |

### Klausuren

| Aktion | Felder | Antwort |
| --- | --- | --- |
| `klausur_anlegen` | `meta_chiffre`, `fragen`, `loesung_chiffre`, `tage` | `id` |
| `klausur_liste` | — | Liste aus `id`, `meta_chiffre`, `status`, `loeschen_ab`, Zahl der Codes und Abgaben |
| `klausur_oeffnen` / `klausur_beenden` | `id` | — |
| `klausur_loeschen` | `id` | — |
| `ergebnisse` | `id` | Liste aus `code`, `abgegeben`, `antwort_chiffre`, `resets` |
| `fragenpool` | — | `pool` — der Fragenpool, **nur für angemeldete Lehrkräfte** |

### Der Fragenpool

Liegt **außerhalb des öffentlichen Bereichs und außerhalb des Repos** unter
`/home/users/ctnutzerone/files/klausur-fragenpool.json` (Pfad in
`klausur-config.php`, Schlüssel `fragenpool`). Er enthält die **richtigen
Antworten** und wird nur an eine angemeldete Lehrkraft ausgeliefert. Format je
Frage (siehe `docs/klausur-fragenpool.beispiel.json`):

```json
{ "thema": "…", "text": "…",
  "pfad": ["Bereich", "Unterkategorie", "Einheit", "Thema"],
  "optionen": ["…", "…", …],   // gern MEHR als fünf
  "richtig":  [0, 2, 4],       // Indizes in "optionen"
  "standard": [0, 1, 2, 3, 4], // optional: was vorausgewählt erscheint
  "bild": "<svg …>…</svg>"     // optional: ein Bild zur Frage
}
```

`pfad` ordnet die Frage im Material ein und ist die Grundlage des Filters,
mit dem die Lehrkraft ihre Klausur zusammenstellt. Die drei oberen Ebenen
sind nicht neu erfunden: `daten/kategorien.csv` des Materialrepos nennt
Bereich und Unterkategorie, die `info.json` der Einheiten die Einheit. Die
vierte Ebene ist das Thema der Frage. Fehlt `pfad`, fällt die Oberfläche auf
`thema` zurück und bekommt daraus zwei Ebenen statt vier — ein alter
Poolstand bleibt also benutzbar.

`standard` ist optional; fehlt es, wählt die Oberfläche alle richtigen plus so
viele falsche vor, bis fünf zusammenkommen. Beim Zusammenstellen wählt die
Lehrkraft je Aufgabe, welche Antworten (richtige wie falsche) tatsächlich in
die Klausur wandern; `richtig` und `anzahl` der angelegten Klausur werden aus
dieser Auswahl neu berechnet, damit Angabe und Lösungsschlüssel nie
auseinanderlaufen.

`fragen` ist JSON und liegt **im Klartext** auf dem Server — die Teilnehmer
müssen sie lesen können. Es steht kein Lösungshinweis darin; der
Lösungsschlüssel ist ein eigenes, verschlüsseltes Feld. Zwei Formen sind
erlaubt:

* die blanke Liste `[{text, optionen[], anzahl}, …]` (alt), oder
* ein Objekt `{v:2, mischen:{fragen, optionen, teilmenge}, aufgaben:[…]}`.

`mischen.fragen` / `mischen.optionen` sind Wahrheitswerte, `mischen.teilmenge`
ist `null` oder eine Zahl `1…Anzahl der Aufgaben`. Der Server **interpretiert
diese Regeln nicht** — er prüft nur ihre Form und gibt sie unverändert an den
Teilnehmer-Browser weiter. Beim Objekt sind ausschließlich die Schlüssel `v`,
`mischen`, `aufgaben` erlaubt; in einer Aufgabe sind `richtig`, `loesung`,
`korrekt` weiterhin verboten (sonst läge ein Lösungshinweis im Klartext).

`bild` ist optional und gehört zur **Frage**, nicht zu einer Antwort — es
übersteht damit auch das Mischen der Optionen. Erlaubt ist ausschließlich
SVG-Quelltext: Der Server nimmt nur an, was mit `<svg` beginnt und mit
`</svg>` endet, höchstens `max_bild_bytes` groß ist (voreingestellt 24 KB)
und keines der Stücke `<script`, `javascript:`, `onload=`, `onclick=`,
`onerror=`, `xlink:href`, `<foreignObject`, `<use`, `<image`, `<animate`,
`<set`, `<iframe` enthält. Der Teilnehmer-Browser stellt es als
`<img src="data:image/svg+xml;base64,…">` dar und **nie** als eingesetztes
SVG: In einem `<img>` läuft kein Skript, und die Grafik kann nichts
nachladen. Die Prüfung auf dem Server ist damit nicht die einzige Sperre,
sondern die zweite — weitergereicht wird nur, was auch angenommen wurde.

Bilder gehen in den Klartextteil ein und zählen gegen `max_fragen_bytes`
(voreingestellt 512 KB). Vierzig Bildfragen aus dem vorhandenen Pool sind
rund 47 KB — die Grenze ist also keine praktische Beschränkung, solange
die Bilder gezeichnete SVG bleiben und keine eingebetteten Fotos.

**Mischen und Teilmenge sind reine Präsentation, kein Täuschungsschutz.** Sie
erschweren das Abschreiben zwischen Sitznachbarn; gegen einen zweiten Tab oder
ein zweites Gerät helfen sie nicht (das kann eine Browser-Seite nicht — siehe
`hinweise.html`). Der Teilnehmer-Browser zieht Auswahl und Reihenfolge lokal
und legt die Zuordnung in seinen **verschlüsselten** Umschlag (`auswahl`);
der Server sieht sie nie, die Lehrkraft rechnet damit auf die feste
Reihenfolge zurück.

### Teilnehmercodes

| Aktion | Felder | Antwort |
| --- | --- | --- |
| `codes_erzeugen` | `id`, `anzahl` (1–40) | Liste aus `code` und `pin` — **einmalig**, die PIN steht danach nur noch als Hash da |
| `codes_liste` | `id` | `code`, `benutzt`, `abgegeben`, `resets` |
| `code_zuruecksetzen` | `id`, `tcode` | — |

### Teilnahme

| Aktion | Felder | Antwort |
| --- | --- | --- |
| `start` | `tcode`, `tpin` | `fragen`, `oeff` |
| `abgeben` | `tcode`, `tpin`, `antwort_chiffre` | — |

Der Umschlag in `antwort_chiffre` entschlüsselt zu `{v, abgegeben, antworten,
auswahl}`. `antworten` ist je gezeigter Aufgabe die Liste der angekreuzten
**gezeigten** Positionen; `auswahl` = `{fragen:[feste Indizes …],
optionen:[[feste Optionsindizes …], …]}` bildet die gezeigte auf die feste
Reihenfolge ab. Ohne Mischen/Teilmenge ist `auswahl` die Identität und
optional. Der Server prüft nur, dass es ein wohlgeformter Umschlag ist
(`iv`, `daten`, `schluessel`), und liest nichts davon.

`start` ist **einmal gültig**. Der zweite Versuch scheitert mit
`schon_benutzt`, bis die Lehrkraft zurücksetzt. Jedes Zurücksetzen wird
gezählt und erscheint in der Ergebnistabelle — wer zweimal ansetzen durfte,
soll nicht unbemerkt bleiben.

---

## 6. Die Tabellen

**Eigene Datenbank** `ctnutzerone_db5`, eigener Benutzer. Nicht db3 oder db4
mitbenutzen: andere Fristen, anderer Zweck, andere Rechtslage. Die Trennung
soll auch im Betrieb sichtbar sein.

Das Schema steht in `klausur/sql/schema.sql`. Kurz:

| Tabelle | Inhalt |
| --- | --- |
| `pr_einladung` | Einladungscode, angelegt, eingelöst-am. Vom Betreiber von Hand gefüllt. |
| `pr_lehrkraft` | Code, `auth_hash`, `salt`, öffentlicher Schlüssel, verpackter privater Schlüssel, Sperrzähler |
| `pr_klausur` | Id, Lehrkraft, `meta_chiffre`, `fragen` (klar), `loesung_chiffre`, Status, `loeschen_ab` |
| `pr_teilnahme` | Klausur, Code, `pin_hash`, benutzt, abgegeben, `antwort_chiffre`, `resets` |

Kein Feld für Name, Klasse, Schule, Fach, Gerät, IP oder Browser. Wenn später
jemand eines vermisst, ist das ein Grund nachzufragen, kein Grund es
hinzuzufügen.

---

## 7. Die Aufbewahrung

Die Lehrkraft setzt beim Anlegen eine Frist von **1 bis 60 Tagen**. Daraus
berechnet der Server einmal `loeschen_ab` und **verlängert sie nie**. Ein
Ereignis räumt täglich auf:

```sql
CREATE EVENT pr_aufraeumen
  ON SCHEDULE EVERY 1 DAY
  DO DELETE FROM pr_klausur WHERE loeschen_ab < NOW();
```

`pr_teilnahme` hängt per `ON DELETE CASCADE` daran. Dass die Kaskade greift
und der `event_scheduler` läuft, gehört einmal nachgemessen — beim Wettkampf
war er anfangs aus.

**Die Sicherungen des Hosters sind damit nicht erfasst.** Was in einem
netcup-Backup liegt, überlebt die Frist um den Backup-Zyklus. Das gehört so
in die Datenschutzerklärung und in den AV-Vertrag, nicht schöngeredet.

---

## 8. Fehlerwerte

| Wert | HTTP | Bedeutung |
| --- | --- | --- |
| `ungueltig` | 400 | Feld fehlt oder passt nicht ins Format |
| `unbekannt` | 403 | Code oder Passphrase falsch — **eine** Meldung für beides |
| `gesperrt` | 429 | zu viele Fehlversuche |
| `schon_benutzt` | 409 | Teilnehmercode war schon im Einsatz |
| `nicht_offen` | 409 | Klausur ist Entwurf oder beendet |
| `zugross` | 413 | Chiffrat über der Grenze |
| `voll` | 500 | kein freier Code gefunden |
| `db` | 500 | Datenbank nicht erreichbar |

Gleiche Meldung und gleiche Antwortzeit für „Code unbekannt" und „Passphrase
falsch" — sonst lassen sich gültige Codes absuchen.

---

## 9. Datenschutz und Rollen

**Verantwortlich ist die Schule**, nicht der Betreiber und nicht die
Lehrkraft persönlich. Eine bewertete Leistungserhebung ist eine Aufgabe der
Schule; Rechtsgrundlage ist Art. 6 Abs. 1 lit. e DSGVO in Verbindung mit dem
SchulG NRW — **keine Einwilligung**, denn an einer Klausur nimmt niemand
freiwillig teil.

**Der Betreiber ist Auftragsverarbeiter** nach Art. 28 DSGVO. Vor dem ersten
echten Einsatz braucht es deshalb je Schule:

1. einen AV-Vertrag,
2. die Zustimmung der Schulleitung nach VO-DV I NRW,
3. einen Eintrag im Verzeichnis der Verarbeitungstätigkeiten der Schule,
4. eine Information der Schüler nach Art. 13.

Das Briefkasten-Modell macht diese Pflichten kleiner, aber es hebt sie nicht
auf. **Die Technik steht vor der Rechtslage, nicht umgekehrt** — deshalb ist
der Bereich gebaut und nicht freigegeben.

Was der Betreiber tatsächlich sehen kann, wenn er in die Datenbank schaut:
Codes, Zeitstempel, Fragentexte, Chiffrate. Keine Antwort, keine Punktzahl,
keinen Namen. Das ist der Punkt des Entwurfs.

**Zugang zum Konto** entsteht nur über eine dienstliche Adresse der Schule.
Keine Schulbescheinigung per E-Mail: Ein unverschlüsselt zugesandtes Dokument
mit Name, Schule und Unterschrift wäre mehr Datenverarbeitung, nicht weniger.
Gespeichert wird nur, dass ein Einladungscode vergeben und eingelöst wurde.

**Punkte, keine Noten.** Die Auswertung gibt erreichte Punkte aus. Eine
automatisch erzeugte Note, die ungeprüft übernommen wird, rückte in die Nähe
von Art. 22 DSGVO. Die Lehrkraft macht aus Punkten eine Note, nicht das
Werkzeug.

---

## 10. Was am Server eingestellt sein muss

* **Kein Zugriffsprotokoll für den Endpunkt.** Im vhost:

  ```apache
  SetEnvIf Request_URI "^/klausur/" tbk_ohne_log
  CustomLog /pfad/access.log combined env=!tbk_ohne_log
  ```

* **`noindex`** für den ganzen Ordner — die Seiten setzen den Header selbst,
  zusätzlich gehört `Disallow: /klausur/` in die `robots.txt`.
* **Die Konfiguration liegt außerhalb des Repos**, wie bei den übrigen
  Endpunkten: `/home/users/ctnutzerone/files/klausur-config.php`. Fehlt sie,
  antwortet der Endpunkt mit `db` und tut nichts.
* **Solange nicht freigegeben:** `'freigegeben' => false` in der
  Konfiguration. Dann beantwortet der Endpunkt ausschließlich Anfragen, deren
  Lehrkraft-Code in `'nur_codes'` steht.

---

## 11. Was hier bewusst fehlt

* **Keine Wiederherstellung der Passphrase.** Siehe Abschnitt 3.
* **Keine Auswertung auf dem Server.** Keine Statistik, keine Mittelwerte,
  kein Zählen über Klausuren hinweg.
* **Keine Rückmeldung an den Teilnehmer.** Er sieht, dass abgegeben wurde,
  sonst nichts. Für eine Klausur ist das richtig, und es folgt ohnehin
  daraus, dass der Server die Lösung nicht kennt.
* **Keine Freitextaufgaben.** Multiple Choice, mehr nicht. Freitext wäre
  personenbeziehbar durch Handschrift im Wortsinn — Stil, Tippfehler,
  Formulierungen.
* **Kein Nachreichen.** Wer nicht abgegeben hat, hat nicht abgegeben. Die
  Lehrkraft setzt zurück oder lässt es.
