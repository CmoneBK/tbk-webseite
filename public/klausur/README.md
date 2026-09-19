# Klausurbereich

**Gebaut, nicht freigegeben.** Diese Datei sagt, wie man ihn ausprobiert und
was vor einem echten Einsatz noch fehlt. Der Vertrag steht in
[`../../docs/KLAUSUR-API.md`](../../docs/KLAUSUR-API.md), die Bewertung der
Rechtslage in dessen Abschnitt 9.

## Der Gedanke in einem Satz

Der Server ist ein Briefkasten, kein Prüfer: Er nimmt Umschläge an und gibt
sie zurück, aber er hat keinen Schlüssel dazu. Verschlüsselt wird im Browser
des Teilnehmers, geöffnet und bewertet im Browser der Lehrkraft.

## Was hier liegt

| Datei | Was |
| --- | --- |
| `index.html` | Der Arbeitsplatz der Lehrkraft |
| `teilnahme.html` | Die Seite, an der die Klasse sitzt |
| `api/pruefung.php` | Der einzige Endpunkt |
| `assets/krypto.js` | Schlüssel, Umschläge, Passphrasen |
| `assets/bewertung.js` | Aus Kreuzen werden Punkte — hier, nicht auf dem Server |
| `assets/xlsx.js` | Arbeitsmappe ohne fremde Bibliothek |
| `assets/lehrkraft.js`, `assets/teilnahme.js` | Die beiden Oberflächen |

Nicht hier, mit Absicht:

* **Die Konfiguration** — `/home/users/ctnutzerone/files/klausur-config.php`,
  Vorlage in `docs/klausur-config.sample.php`. Fehlt sie, tut der Endpunkt
  nichts.
* **Der Fragenpool** — er enthält die richtigen Antworten und hat unter
  `public/` nichts zu suchen. Vorlage: `docs/klausur-fragenpool.beispiel.json`.
  Eine Frage darf **mehr als fünf Antworten** anbieten; ein optionales Feld
  `standard` bestimmt, welche vorausgewählt erscheinen (sonst: alle richtigen
  plus falsche bis fünf).

## Was die Lehrkraft beim Zusammenstellen einstellt

* **Antworten je Frage** — welche richtigen und falschen Optionen aus dem Pool
  tatsächlich in der Klausur stehen. `anzahl` und Lösungsschlüssel werden aus
  der Auswahl neu berechnet.
* **Lösung einblenden** — ein Schalter zeigt beim Zusammenstellen, welche
  Antworten richtig sind.
* **Mischen / Teilmenge** — Reihenfolge der Aufgaben und/oder Antworten je
  Teilnehmer mischen, und optional nur eine zufällige Auswahl der Aufgaben je
  Teilnehmer ziehen. Das erschwert das Abschreiben zwischen Sitznachbarn.
  **Kein Täuschungsschutz gegen zweiten Tab oder zweites Gerät** — das kann
  eine Browser-Seite nicht; das leistet nur Aufsicht bzw. ein Kiosk-Modus auf
  verwalteten Geräten (siehe `hinweise.html`). Der Teilnehmer-Browser mischt
  lokal und legt die Zuordnung in seinen verschlüsselten Umschlag; der Server
  sieht davon nichts, es wird nichts über das Verhalten gespeichert.

## Drei Sperren

1. Ohne Konfigurationsdatei antwortet der Endpunkt `db` und tut nichts.
2. `'freigegeben' => false` lässt nur die Codes aus `nur_codes` und die
   Einladungen aus `nur_einladungen` durch.
3. Ein Zugang entsteht **nur** über einen Einladungscode, den der Betreiber
   von Hand in `pr_einladung` einträgt. Es gibt keine Selbstregistrierung.

Dazu: nirgends verlinkt, `noindex` in beiden Seiten, `Disallow: /klausur/` in
der `robots.txt`.

> **Der Pfad ist kein Schutz.** Dieses Repo liegt öffentlich auf GitHub —
> wer wissen will, dass es `/klausur/` gibt, findet es dort. Der Schutz sind
> die drei Sperren, nicht die Unauffälligkeit.

## Ausprobieren

**Ohne Server** geht alles, was im Browser läuft. Die Seiten lassen sich
direkt öffnen; ohne Endpunkt bleibt es bei „Der Dienst antwortet gerade
nicht", aber Aussehen, Bedienung und die Verschlüsselung selbst lassen sich
so beurteilen.

**Mit Server:**

1. Datenbank `ctnutzerone_db5` in KeyHelp anlegen, `docs/klausur-schema.sql`
   einspielen.
2. `docs/klausur-config.sample.php` nach `files/klausur-config.php` kopieren,
   Passwort und `salt_geheim` eintragen.
3. Einen Einladungscode setzen — zehn Zeichen aus `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`:

   ```sql
   INSERT INTO pr_einladung (code, angelegt, notiz)
     VALUES ('MNPQ23456R', NOW(), 'Probelauf');
   ```

4. Denselben Code in `nur_einladungen` eintragen, `freigegeben` auf `false`
   lassen.
5. `/klausur/` öffnen, Zugang anlegen. Den Zugangscode, den die Seite nennt,
   anschließend in `nur_codes` eintragen — sonst ist nach dem Anlegen
   Schluss.
6. Fragenpool nach `files/klausur-fragenpool.json` legen.

Die Prüfung im Material-Repo (`node pruefungen/test-klausur.js`) prüft, was
sich ohne Datenbank prüfen lässt: die Zusagen im Quelltext, die
Verschlüsselung, die Bewertung und dass die Arbeitsmappe eine ist.

## Was vor dem ersten echten Einsatz fehlt

Technik ist nicht das Problem. Was fehlt, steht in `docs/KLAUSUR-API.md`,
Abschnitt 9:

1. **AV-Vertrag mit jeder Schule** — die Schule ist verantwortlich, der
   Betreiber ist Auftragsverarbeiter.
2. **Zustimmung der Schulleitung** nach VO-DV I NRW.
3. **Eintrag im Verzeichnis der Verarbeitungstätigkeiten** der Schule.
4. **Information der Schüler** nach Art. 13 DSGVO, vor der Prüfung.
5. **Ein Abschnitt in der Datenschutzerklärung** von t-bk.de.
6. **vhost:** `/klausur/` aus dem Zugriffsprotokoll nehmen, sonst steht dort
   IP und Zeitpunkt zu jeder Abgabe.
7. **Backup-Zyklus klären** — was in einer Sicherung liegt, überlebt die
   Löschfrist.

Der erste Schritt ist keiner am Rechner: die Frage an den
Datenschutzbeauftragten einer Schule, ob er das überhaupt mitträgt.

## Was hier bewusst fehlt

* Keine Wiederherstellung der Passphrase. Aus ihr entsteht der Schlüssel;
  eine Hintertür wäre eine Hintertür.
* Keine Auswertung auf dem Server, keine Statistik, kein Zählen.
* Keine Rückmeldung an den Teilnehmer — die Seite kennt die Lösung nicht.
* Keine Freitextaufgaben. Handschrift im Wortsinn ist personenbeziehbar.
* Keine Noten, nur Punkte. Begründung: Art. 22 DSGVO.
