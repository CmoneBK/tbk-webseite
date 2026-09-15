<?php
// VORLAGE. Kopiere diese Datei nach
//   /home/users/ctnutzerone/files/feedback-config.php
// (in files/, weil PHPs open_basedir nur www/, files/, tmp/ erlaubt; files/ ist
//  nicht oeffentlich erreichbar und nicht deploy-verwaltet) und trage echte Werte ein.
// NIEMALS ins Repo committen. Zufallswerte z. B. mit:  openssl rand -hex 32
return [
  'db_dsn'  => 'mysql:host=localhost;dbname=DEINE_DB;charset=utf8mb4',
  'db_user' => 'DEIN_DB_USER',
  'db_pass' => 'DEIN_DB_PASSWORT',
  'hmac_secret' => 'LANGER_ZUFALL_1',
  'ip_salt'     => 'LANGER_ZUFALL_2',
  'rate_limit_per_hour' => 12,
];
