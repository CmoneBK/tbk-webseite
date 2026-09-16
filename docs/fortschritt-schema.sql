-- Tabellen + Aufraeum-Event fuer die Fortschritts-API. Einmalig in der (in
-- KeyHelp angelegten) Datenbank ctnutzerone_db4 ausfuehren.
CREATE TABLE IF NOT EXISTS fs_konto (
  code         CHAR(6)          NOT NULL PRIMARY KEY,
  pin_hash     VARBINARY(255)   NOT NULL,
  angelegt     DATETIME         NOT NULL,
  zuletzt      DATETIME         NOT NULL,
  fehlschlag   TINYINT UNSIGNED NOT NULL DEFAULT 0,
  gesperrt_bis DATETIME         NULL,
  INDEX (zuletzt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS fs_stand (
  code      CHAR(6)      NOT NULL,
  seite     VARCHAR(160) NOT NULL,
  daten     MEDIUMTEXT   NOT NULL,
  geaendert DATETIME     NOT NULL,
  PRIMARY KEY (code, seite),
  INDEX (code, geaendert),
  CONSTRAINT fs_stand_konto FOREIGN KEY (code)
    REFERENCES fs_konto (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Aufraeumen: 60 Tage ohne Zugriff -> Konto (und per CASCADE die Staende) weg.
CREATE EVENT IF NOT EXISTS fs_aufraeumen
  ON SCHEDULE EVERY 1 DAY
  DO DELETE FROM fs_konto WHERE zuletzt < NOW() - INTERVAL 60 DAY;
