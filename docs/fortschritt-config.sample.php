<?php
// VORLAGE. Kopiere nach /home/users/ctnutzerone/files/fortschritt-config.php
// (in files/, wegen open_basedir; nicht deployt, nicht web-erreichbar) und
// trage das echte db4-Passwort ein. NICHT ins Repo committen.
// Kein ip_salt noetig: dieser Endpunkt speichert bewusst keine IP.
return [
  'db_dsn'  => 'mysql:host=localhost;dbname=ctnutzerone_db4;charset=utf8mb4',
  'db_user' => 'ctnutzerone_db4',
  'db_pass' => 'DB4_PASSWORT',
  'max_seiten'           => 60,
  'max_bytes'            => 65536,   // 64 KB je Seite
  'sichern_min_sekunden' => 10,      // Ratenlimit: 1 Schreibvorgang je Seite / 10 s
];
