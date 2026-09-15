-- Tabelle fuer die zentrale Feedback-Sammelstelle.
-- Einmalig in der (in KeyHelp angelegten) MariaDB-Datenbank ausfuehren.
CREATE TABLE IF NOT EXISTS feedback (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME     NOT NULL,
  area       VARCHAR(32)  NOT NULL,   -- werkzeuge | unterrichtsmaterial | projekte | start
  path       VARCHAR(300) NOT NULL,   -- Seitenpfad des Inhalts
  title      VARCHAR(300) NOT NULL,   -- Anzeigetitel des Inhalts
  role       VARCHAR(16)  NOT NULL,   -- schueler | lehrkraft
  category   VARCHAR(24)  NOT NULL,   -- fehler | verstaendnis | lob | vorschlag | sonstiges
  message    TEXT         NOT NULL,   -- Freitext (optional, kann leer sein)
  status     VARCHAR(16)  NOT NULL DEFAULT 'neu',  -- neu | erledigt | spam
  ip_hash    CHAR(64)     NOT NULL,   -- salted SHA-256, nur fuer Ratenlimit/Spam
  KEY idx_status (status),
  KEY idx_area (area),
  KEY idx_ip_time (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
