<?php
declare(strict_types=1);
date_default_timezone_set('Europe/Berlin');

// Fortschritts-Endpunkt (Stufe 2): Lernstand geraeteuebergreifend per Code + PIN.
// Kein Konto/Name/IP, keine Lehreransicht. PIN nur als Hash (password_hash).
// Eigene Datenbank ctnutzerone_db4. Vertrag: docs/FORTSCHRITT-API.md
// (Repo tbk-lernsituationen-uebungen). Fehlerfeld heisst "fehler".

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

$CONFIG_PATH = '/home/users/ctnutzerone/files/fortschritt-config.php';

function out(array $d, int $c = 200): void { http_response_code($c); echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; }
function fail(string $f, int $c): void { out(['ok' => false, 'fehler' => $f], $c); }

if (!is_file($CONFIG_PATH)) { fail('db', 500); }
$cfg = require $CONFIG_PATH;

$ALPHABET   = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // ohne 0/O, 1/I/l
$MAX_SEITEN = (int)($cfg['max_seiten'] ?? 60);
$MAX_BYTES  = (int)($cfg['max_bytes'] ?? 65536);     // 64 KB je Seite
$MIN_SEK    = (int)($cfg['sichern_min_sekunden'] ?? 10);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') { fail('ungueltig', 405); }
$action = (string)($_POST['action'] ?? '');
$code   = strtoupper(trim((string)($_POST['code'] ?? '')));
$pin    = (string)($_POST['pin'] ?? '');

try {
  $pdo = new PDO((string)$cfg['db_dsn'], (string)$cfg['db_user'], (string)$cfg['db_pass'], [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
  ]);
} catch (Throwable $e) { fail('db', 500); }

// Zeit-Mathematik bewusst in der DB (NOW()), damit PHP- und MySQL-Zeitzone
// nicht auseinanderlaufen (Ratenlimit, Sperre).
function auth(PDO $pdo, string $code, string $pin): void {
  $st = $pdo->prepare('SELECT pin_hash, fehlschlag, (gesperrt_bis IS NOT NULL AND gesperrt_bis > NOW()) AS gesperrt FROM fs_konto WHERE code=?');
  $st->execute([$code]);
  $row = $st->fetch();
  if (!$row) { password_hash($pin, PASSWORD_DEFAULT); fail('unbekannt', 403); } // Antwortzeit angleichen
  if ((int)$row['gesperrt'] === 1) { fail('gesperrt', 429); }
  if (!password_verify($pin, (string)$row['pin_hash'])) {
    $f = (int)$row['fehlschlag'] + 1;
    if ($f >= 10) {
      $sek = ($f >= 11) ? 300 : 60;   // erst 1 Minute, bei weiteren Fehlversuchen 5
      $pdo->prepare('UPDATE fs_konto SET fehlschlag=?, gesperrt_bis = NOW() + INTERVAL ? SECOND WHERE code=?')->execute([$f, $sek, $code]);
    } else {
      $pdo->prepare('UPDATE fs_konto SET fehlschlag=? WHERE code=?')->execute([$f, $code]);
    }
    fail('unbekannt', 403);   // gleiche Meldung wie falscher Code
  }
  $pdo->prepare('UPDATE fs_konto SET fehlschlag=0, gesperrt_bis=NULL WHERE code=?')->execute([$code]);
}

// ---------- action=neu ----------
if ($action === 'neu') {
  if (!preg_match('/^\d{4}$/', $pin)) { fail('ungueltig', 400); }
  $hash = password_hash($pin, PASSWORD_DEFAULT);
  for ($t = 0; $t < 10; $t++) {
    $c = '';
    for ($i = 0; $i < 6; $i++) { $c .= $ALPHABET[random_int(0, 31)]; }
    try {
      $pdo->prepare('INSERT INTO fs_konto (code,pin_hash,angelegt,zuletzt) VALUES (?,?,NOW(),NOW())')
          ->execute([$c, $hash]);
      out(['ok' => true, 'code' => $c]);
    } catch (PDOException $e) {
      if ($e->getCode() !== '23000') { fail('db', 500); }   // 23000 = Kollision -> neu wuerfeln
    }
  }
  fail('voll', 500);
}

// ---------- action=sichern ----------
if ($action === 'sichern') {
  if (strlen($code) !== 6) { fail('unbekannt', 403); }
  auth($pdo, $code, $pin);
  $seite = (string)($_POST['seite'] ?? '');
  $daten = (string)($_POST['daten'] ?? '');
  if ($seite === '' || strlen($seite) > 160 || !preg_match('#^[a-z0-9/_.-]+$#', $seite)) { fail('ungueltig', 400); }
  if (strlen($daten) > $MAX_BYTES) { fail('zugross', 413); }
  json_decode($daten);
  if (json_last_error() !== JSON_ERROR_NONE) { fail('ungueltig', 400); }

  // Ratenlimit: hoechstens 1 Schreibvorgang je Seite / MIN_SEK
  $st = $pdo->prepare('SELECT (geaendert > NOW() - INTERVAL ? SECOND) AS frisch FROM fs_stand WHERE code=? AND seite=?');
  $st->execute([$MIN_SEK, $code, $seite]);
  $ex = $st->fetch();
  if ($ex !== false && (int)$ex['frisch'] === 1) { fail('zuviel', 429); }

  // 60-Seiten-Deckel: bei NEUER Seite ggf. aelteste verdraengen
  if ($ex === false) {
    $c = $pdo->prepare('SELECT COUNT(*) FROM fs_stand WHERE code=?'); $c->execute([$code]);
    if ((int)$c->fetchColumn() >= $MAX_SEITEN) {
      $pdo->prepare('DELETE FROM fs_stand WHERE code=? ORDER BY geaendert ASC LIMIT 1')->execute([$code]);
    }
  }

  $pdo->prepare('INSERT INTO fs_stand (code,seite,daten,geaendert) VALUES (?,?,?,NOW())
                 ON DUPLICATE KEY UPDATE daten=VALUES(daten), geaendert=NOW()')
      ->execute([$code, $seite, $daten]);
  $pdo->prepare('UPDATE fs_konto SET zuletzt=NOW() WHERE code=?')->execute([$code]);
  out(['ok' => true]);
}

// ---------- action=holen ----------
if ($action === 'holen') {
  if (strlen($code) !== 6) { fail('unbekannt', 403); }
  auth($pdo, $code, $pin);
  $pdo->prepare('UPDATE fs_konto SET zuletzt=NOW() WHERE code=?')->execute([$code]);
  $seite = (string)($_POST['seite'] ?? '');
  if ($seite !== '') {
    $st = $pdo->prepare('SELECT daten, UNIX_TIMESTAMP(geaendert) AS ts FROM fs_stand WHERE code=? AND seite=?');
    $st->execute([$code, $seite]);
    $r = $st->fetch();
    out(['ok' => true,
         'daten'     => $r ? $r['daten'] : null,
         'geaendert' => $r ? date('c', (int)$r['ts']) : null]);
  }
  $st = $pdo->prepare('SELECT seite, UNIX_TIMESTAMP(geaendert) AS ts FROM fs_stand WHERE code=? ORDER BY geaendert DESC');
  $st->execute([$code]);
  $seiten = [];
  foreach ($st->fetchAll() as $r) { $seiten[] = ['seite' => $r['seite'], 'geaendert' => date('c', (int)$r['ts'])]; }
  out(['ok' => true, 'seiten' => $seiten]);
}

// ---------- action=loeschen ----------
if ($action === 'loeschen') {
  if (strlen($code) !== 6) { fail('unbekannt', 403); }
  auth($pdo, $code, $pin);
  $pdo->prepare('DELETE FROM fs_konto WHERE code=?')->execute([$code]);   // ON DELETE CASCADE raeumt fs_stand
  out(['ok' => true]);
}

fail('ungueltig', 400);
