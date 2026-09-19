-- Tabellen + Aufraeum-Event fuer die Klausur-API. Einmalig in der (in
-- KeyHelp angelegten) Datenbank ctnutzerone_db5 ausfuehren.
--
-- Eigene Datenbank, nicht db3/db4 mitbenutzen: andere Fristen, anderer
-- Zweck, andere Rechtslage. Vertrag: docs/KLAUSUR-API.md
--
-- In keiner dieser Tabellen steht ein Name, eine Klasse, eine Schule, ein
-- Fach, eine IP oder eine Geraeteangabe. Das ist kein Versehen und keine
-- Luecke, die man spaeter fuellt.

-- Einladungen. Der Betreiber traegt eine Zeile von Hand ein, nachdem er die
-- dienstliche Adresse der Schule geprueft hat. Es gibt keine
-- Selbstregistrierung.
CREATE TABLE IF NOT EXISTS pr_einladung (
  code       CHAR(10)  NOT NULL PRIMARY KEY,
  angelegt   DATETIME  NOT NULL,
  eingeloest DATETIME  NULL,
  -- Freitext nur fuer den Betreiber, z. B. "BK Greven, Anfrage vom 12.09.".
  -- Keine personenbezogene Angabe hineinschreiben.
  notiz      VARCHAR(120) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ein Lehrkraft-Zugang. Der Server kennt die Passphrase nicht: Er speichert
-- den Hash eines abgeleiteten Wertes (auth) und das Salt, mit dem der
-- Browser ableitet. Der private Schluessel liegt nur verpackt hier.
CREATE TABLE IF NOT EXISTS pr_lehrkraft (
  code         CHAR(8)          NOT NULL PRIMARY KEY,
  auth_hash    VARBINARY(255)   NOT NULL,
  salt         VARBINARY(32)    NOT NULL,
  oeff         MEDIUMTEXT       NOT NULL,   -- oeffentlicher Schluessel, Base64 (SPKI)
  priv_chiffre MEDIUMTEXT       NOT NULL,   -- privater Schluessel, mit der Passphrase verpackt
  angelegt     DATETIME         NOT NULL,
  zuletzt      DATETIME         NOT NULL,
  fehlschlag   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  gesperrt_bis DATETIME         NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Eine Klausur. "fragen" steht im Klartext, weil die Teilnehmer sie lesen
-- muessen - ohne jeden Hinweis auf die richtige Antwort. Der
-- Loesungsschluessel liegt daneben, verschluesselt fuer die Lehrkraft.
-- "meta_chiffre" enthaelt Titel und Notizen, ebenfalls verschluesselt: Ein
-- Titel wie "M-BFS-12b Klausur 2" waere sonst ein Wiedererkennungsmerkmal.
CREATE TABLE IF NOT EXISTS pr_klausur (
  id              CHAR(10)    NOT NULL PRIMARY KEY,
  lehrkraft       CHAR(8)     NOT NULL,
  meta_chiffre    MEDIUMTEXT  NOT NULL,
  fragen          MEDIUMTEXT  NOT NULL,
  loesung_chiffre MEDIUMTEXT  NOT NULL,
  status          ENUM('entwurf','offen','beendet') NOT NULL DEFAULT 'entwurf',
  angelegt        DATETIME    NOT NULL,
  loeschen_ab     DATETIME    NOT NULL,
  INDEX (lehrkraft),
  INDEX (loeschen_ab),
  CONSTRAINT pr_klausur_lehrkraft FOREIGN KEY (lehrkraft)
    REFERENCES pr_lehrkraft (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Ein Teilnehmercode. Genau einmal gueltig; die Lehrkraft kann ihn
-- zuruecksetzen, und jedes Zuruecksetzen wird gezaehlt - wer zweimal
-- ansetzen durfte, soll in der Ergebnistabelle nicht unbemerkt bleiben.
CREATE TABLE IF NOT EXISTS pr_teilnahme (
  klausur         CHAR(10)         NOT NULL,
  code            CHAR(6)          NOT NULL,
  pin_hash        VARBINARY(255)   NOT NULL,
  benutzt         DATETIME         NULL,
  abgegeben       DATETIME         NULL,
  antwort_chiffre MEDIUMTEXT       NULL,
  resets          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  fehlschlag      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  gesperrt_bis    DATETIME         NULL,
  -- Der Code allein muss die Klausur finden: Der Teilnehmer tippt nur ihn
  -- und seine PIN, er kennt keine Klausur-Id. Deshalb global eindeutig.
  PRIMARY KEY (code),
  INDEX (klausur),
  CONSTRAINT pr_teilnahme_klausur FOREIGN KEY (klausur)
    REFERENCES pr_klausur (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Aufraeumen: Die Frist steht je Klausur und wird nie verlaengert.
-- pr_teilnahme haengt per CASCADE daran.
CREATE EVENT IF NOT EXISTS pr_aufraeumen
  ON SCHEDULE EVERY 1 DAY
  DO DELETE FROM pr_klausur WHERE loeschen_ab < NOW();

-- Ein Konto ohne Klausuren verfaellt nach einem Jahr ohne Anmeldung.
CREATE EVENT IF NOT EXISTS pr_konten_aufraeumen
  ON SCHEDULE EVERY 1 DAY
  DO DELETE FROM pr_lehrkraft
     WHERE zuletzt < NOW() - INTERVAL 365 DAY
       AND code NOT IN (SELECT lehrkraft FROM pr_klausur);

-- Nicht eingeloeste Einladungen verfallen nach 30 Tagen.
CREATE EVENT IF NOT EXISTS pr_einladung_aufraeumen
  ON SCHEDULE EVERY 1 DAY
  DO DELETE FROM pr_einladung
     WHERE eingeloest IS NULL AND angelegt < NOW() - INTERVAL 30 DAY;
