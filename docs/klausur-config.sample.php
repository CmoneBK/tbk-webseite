<?php
// VORLAGE. Kopiere nach /home/users/ctnutzerone/files/klausur-config.php
// (in files/, wegen open_basedir; nicht deployt, nicht web-erreichbar) und
// trage das echte db5-Passwort ein. NICHT ins Repo committen.
//
// Fehlt diese Datei, antwortet der Endpunkt mit "db" und tut nichts. Das ist
// die erste von drei Sperren; die zweite ist "freigegeben", die dritte ist,
// dass ein Zugang nur ueber einen handvergebenen Einladungscode entsteht.
//
// Kein ip_salt: dieser Endpunkt sieht keine IP und speichert keine.
// Vertrag: docs/KLAUSUR-API.md
return [
  'db_dsn'  => 'mysql:host=localhost;dbname=ctnutzerone_db5;charset=utf8mb4',
  'db_user' => 'ctnutzerone_db5',
  'db_pass' => 'DB5_PASSWORT',

  // Fuer das Salt, das ein UNBEKANNTER Lehrkraft-Code zurueckbekommt. Ohne
  // dieses Geheimnis liesse sich an der Antwort ablesen, welche Codes es
  // gibt. Einmal lang und zufaellig setzen, danach nie aendern - sonst
  // bekommen unbekannte Codes ploetzlich andere Salts.
  'salt_geheim' => 'HIER-ETWAS-LANGES-ZUFAELLIGES',

  // ---- Freigabe ----------------------------------------------------------
  // false = der Bereich ist gebaut, aber nicht in Betrieb. Dann arbeitet der
  // Endpunkt ausschliesslich fuer die Codes aus 'nur_codes' und weist alles
  // andere ab - auch das Anlegen eines Kontos, ausser mit einem
  // Einladungscode aus 'nur_einladungen'.
  //
  // Solange hier false steht, ist der Bereich zwar im Netz erreichbar (die
  // Seiten liegen unter /klausur/ und sind nirgends verlinkt), aber fuer
  // niemanden ausser den hier genannten benutzbar.
  'freigegeben'      => false,
  'nur_codes'        => [],   // z. B. ['ABCD2345']
  'nur_einladungen'  => [],   // z. B. ['MNPQ23456R']

  // ---- Grenzen -----------------------------------------------------------
  'max_klausuren_je_lehrkraft' => 40,
  'max_codes_je_klausur'       => 40,
  'max_fragen_bytes'           => 524288,   // 512 KB Fragentext je Klausur
  'max_bild_bytes'             => 24576,    // 24 KB je SVG-Bild einer Frage
  'max_chiffre_bytes'          => 262144,   // 256 KB je Abgabe
  'max_tage'                   => 60,       // Obergrenze der Aufbewahrung

  // ---- Fragenpool --------------------------------------------------------
  // Liegt bewusst NICHT unter public/: Er enthaelt die richtigen Antworten.
  // Ausgeliefert wird er nur an eine angemeldete Lehrkraft.
  // Vorlage: docs/klausur-fragenpool.beispiel.json
  'fragenpool' => '/home/users/ctnutzerone/files/klausur-fragenpool.json',
];
