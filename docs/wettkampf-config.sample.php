<?php
// VORLAGE. Kopiere diese Datei nach
//   /home/users/ctnutzerone/files/wettkampf-config.php
// (in files/, wegen open_basedir; nicht deployt, nicht web-erreichbar) und trage
// echte Werte ein. NICHT ins Repo committen. Zufallssalz z. B.: openssl rand -hex 32
return [
  'db_dsn'  => 'mysql:host=localhost;dbname=ctnutzerone_db3;charset=utf8mb4',
  'db_user' => 'ctnutzerone_db3',
  'db_pass' => 'DB3_PASSWORT',
  'ip_salt' => 'LANGER_ZUFALL',      // eigenes Salz (nicht das der Feedback-Config wiederverwenden noetig)
  'neu_limit_per_hour' => 20,        // Runden je IP-Hash und Stunde
  'offene_runden_max'  => 500,       // Notbremse gesamt
];
