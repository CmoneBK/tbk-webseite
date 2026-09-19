<?php
declare(strict_types=1);
date_default_timezone_set('Europe/Berlin');

// Klausur-Endpunkt. Der Server ist ein Briefkasten, kein Pruefer:
//
//   - Er sieht keine Namen, keine Klassen, keine Schulen. Es gibt kein Feld.
//   - Er sieht keine Antworten. Was ankommt, ist mit dem oeffentlichen
//     Schluessel der Lehrkraft verschluesselt; oeffnen kann es nur, wer ihre
//     Passphrase kennt.
//   - Er sieht keinen Loesungsschluessel und rechnet keine Punkte aus.
//     Bewertet wird im Browser der Lehrkraft.
//   - Er sieht keine IP. Der vhost nimmt /klausur/ aus dem Zugriffsprotokoll
//     heraus (siehe docs/KLAUSUR-API.md, Abschnitt 10).
//
// Drei Sperren, solange der Bereich nicht freigegeben ist:
//   1. Ohne Konfigurationsdatei antwortet er "db" und tut nichts.
//   2. 'freigegeben' => false laesst nur die Codes aus 'nur_codes' und die
//      Einladungen aus 'nur_einladungen' durch.
//   3. Ein Zugang entsteht ueberhaupt nur ueber einen Einladungscode, den
//      der Betreiber von Hand eintraegt. Es gibt keine Selbstregistrierung.
//
// Eigene Datenbank ctnutzerone_db5. Vertrag: docs/KLAUSUR-API.md

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('X-Robots-Tag: noindex, nofollow');

$CONFIG_PATH = '/home/users/ctnutzerone/files/klausur-config.php';

function out(array $d, int $c = 200): void {
  http_response_code($c);
  echo json_encode($d, JSON_UNESCAPED_UNICODE);
  exit;
}
function fail(string $f, int $c): void { out(['ok' => false, 'fehler' => $f], $c); }

if (!is_file($CONFIG_PATH)) { fail('db', 500); }
$cfg = require $CONFIG_PATH;

// Ohne 0/O und 1/I/l - diese Codes werden von Papier abgetippt.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

$FREI       = (bool)($cfg['freigegeben'] ?? false);
$NUR_CODES  = (array)($cfg['nur_codes'] ?? []);
$NUR_EINL   = (array)($cfg['nur_einladungen'] ?? []);
$MAX_KLAUS  = (int)($cfg['max_klausuren_je_lehrkraft'] ?? 40);
$MAX_CODES  = (int)($cfg['max_codes_je_klausur'] ?? 40);
$MAX_FRAGEN = (int)($cfg['max_fragen_bytes'] ?? 524288);
$MAX_BILD   = (int)($cfg['max_bild_bytes'] ?? 24576);
$MAX_CHIFFRE = (int)($cfg['max_chiffre_bytes'] ?? 262144);
$MAX_TAGE   = (int)($cfg['max_tage'] ?? 60);

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') { fail('ungueltig', 405); }

$action = (string)($_POST['action'] ?? '');
$code   = strtoupper(trim((string)($_POST['code'] ?? '')));
$auth   = (string)($_POST['auth'] ?? '');

try {
  $pdo = new PDO((string)$cfg['db_dsn'], (string)$cfg['db_user'], (string)$cfg['db_pass'], [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
  ]);
} catch (Throwable $e) { fail('db', 500); }

/* ---------- kleine Helfer ---------- */

function wuerfel(int $n): string {
  $s = '';
  for ($i = 0; $i < $n; $i++) { $s .= ALPHABET[random_int(0, 31)]; }
  return $s;
}

function b64(?string $s): string { return $s === null ? '' : base64_encode($s); }

if (!function_exists('array_is_list')) {
  function array_is_list(array $a): bool {
    $i = 0;
    foreach ($a as $k => $_) { if ($k !== $i++) { return false; } }
    return true;
  }
}

function chiffreOk(string $s, int $max): bool {
  if ($s === '' || strlen($s) > $max) { return false; }
  // Der Server liest den Inhalt nicht - er prueft nur, dass es der Umschlag
  // ist, den der Client schickt: JSON mit Base64-Feldern.
  $d = json_decode($s, true);
  return is_array($d) && isset($d['iv'], $d['daten']);
}

/* ---------- Anmeldung der Lehrkraft ----------
   Eine Meldung und eine Antwortzeit fuer "Code unbekannt" und "Passphrase
   falsch". Sonst laesst sich absuchen, welche Codes es gibt. */
function anmelden(PDO $pdo, string $code, string $auth): array {
  if (!preg_match('/^[' . ALPHABET . ']{8}$/', $code) || $auth === '') {
    password_hash($auth === '' ? 'x' : $auth, PASSWORD_DEFAULT);
    fail('unbekannt', 403);
  }
  $st = $pdo->prepare('SELECT code, auth_hash, fehlschlag,
      (gesperrt_bis IS NOT NULL AND gesperrt_bis > NOW()) AS gesperrt
      FROM pr_lehrkraft WHERE code=?');
  $st->execute([$code]);
  $row = $st->fetch();
  if (!$row) { password_hash($auth, PASSWORD_DEFAULT); fail('unbekannt', 403); }
  if ((int)$row['gesperrt'] === 1) { fail('gesperrt', 429); }
  if (!password_verify($auth, (string)$row['auth_hash'])) {
    $f = (int)$row['fehlschlag'] + 1;
    // Frueher als beim Fortschritt zumachen: Hier haengt mehr dran als ein
    // Lernstand, und eine Lehrkraft vertippt sich selten fuenfmal.
    if ($f >= 5) {
      $sek = ($f >= 8) ? 900 : 120;
      $pdo->prepare('UPDATE pr_lehrkraft SET fehlschlag=?, gesperrt_bis = NOW() + INTERVAL ? SECOND WHERE code=?')
          ->execute([$f, $sek, $code]);
    } else {
      $pdo->prepare('UPDATE pr_lehrkraft SET fehlschlag=? WHERE code=?')->execute([$f, $code]);
    }
    fail('unbekannt', 403);
  }
  $pdo->prepare('UPDATE pr_lehrkraft SET fehlschlag=0, gesperrt_bis=NULL, zuletzt=NOW() WHERE code=?')
      ->execute([$code]);
  return $row;
}

function freigabePruefen(bool $frei, array $nur, string $code): void {
  if ($frei) { return; }
  if (!in_array($code, $nur, true)) { fail('gesperrt', 403); }
}

/* Gehoert die Klausur dieser Lehrkraft? Sonst dieselbe Meldung wie bei einer
   unbekannten Id - wer fremde Ids absucht, soll nichts erfahren. */
function klausurVon(PDO $pdo, string $lehrkraft, string $id): array {
  if (!preg_match('/^[' . ALPHABET . ']{10}$/', $id)) { fail('ungueltig', 400); }
  $st = $pdo->prepare('SELECT * FROM pr_klausur WHERE id=? AND lehrkraft=?');
  $st->execute([$id, $lehrkraft]);
  $k = $st->fetch();
  if (!$k) { fail('unbekannt', 403); }
  return $k;
}

/* =====================================================================
   Konto
   ===================================================================== */

// ---------- action=konto_salt_code ----------
// Vor der Anmeldung auf einem neuen Geraet braucht der Browser das Salt.
// Fuer einen unbekannten Code kommt trotzdem eines zurueck - aus dem Code
// abgeleitet, immer dasselbe, nicht von einem echten zu unterscheiden.
if ($action === 'konto_salt_code') {
  if (!preg_match('/^[' . ALPHABET . ']{8}$/', $code)) { fail('ungueltig', 400); }
  $st = $pdo->prepare('SELECT salt FROM pr_lehrkraft WHERE code=?');
  $st->execute([$code]);
  $row = $st->fetch();
  if ($row) { out(['ok' => true, 'salt' => b64((string)$row['salt'])]); }
  $geheim = (string)($cfg['salt_geheim'] ?? 'kein-geheimnis-gesetzt');
  out(['ok' => true, 'salt' => b64(hash_hmac('sha256', $code, $geheim, true))]);
}

// ---------- action=konto_neu ----------
if ($action === 'konto_neu') {
  $einl = strtoupper(trim((string)($_POST['einladung'] ?? '')));
  $salt = base64_decode((string)($_POST['salt'] ?? ''), true);
  $oeff = (string)($_POST['oeff'] ?? '');
  $priv = (string)($_POST['priv_chiffre'] ?? '');

  if (!preg_match('/^[' . ALPHABET . ']{10}$/', $einl)) { fail('ungueltig', 400); }
  if (!$FREI && !in_array($einl, $NUR_EINL, true)) { fail('gesperrt', 403); }
  if ($salt === false || strlen($salt) !== 32) { fail('ungueltig', 400); }
  if ($auth === '' || strlen($auth) > 512) { fail('ungueltig', 400); }
  if ($oeff === '' || strlen($oeff) > 4096) { fail('ungueltig', 400); }
  if (!chiffreOk($priv, 8192)) { fail('ungueltig', 400); }

  $pdo->beginTransaction();
  try {
    $st = $pdo->prepare('SELECT eingeloest FROM pr_einladung WHERE code=? FOR UPDATE');
    $st->execute([$einl]);
    $e = $st->fetch();
    if (!$e || $e['eingeloest'] !== null) { $pdo->rollBack(); fail('unbekannt', 403); }

    $hash = password_hash($auth, PASSWORD_DEFAULT);
    for ($t = 0; $t < 12; $t++) {
      $c = wuerfel(8);
      try {
        $pdo->prepare('INSERT INTO pr_lehrkraft (code,auth_hash,salt,oeff,priv_chiffre,angelegt,zuletzt)
                       VALUES (?,?,?,?,?,NOW(),NOW())')
            ->execute([$c, $hash, $salt, $oeff, $priv]);
        $pdo->prepare('UPDATE pr_einladung SET eingeloest=NOW() WHERE code=?')->execute([$einl]);
        $pdo->commit();
        out(['ok' => true, 'code' => $c]);
      } catch (PDOException $ex) {
        if ($ex->getCode() !== '23000') { throw $ex; }
      }
    }
    $pdo->rollBack();
    fail('voll', 500);
  } catch (Throwable $ex) {
    if ($pdo->inTransaction()) { $pdo->rollBack(); }
    fail('db', 500);
  }
}

// ---------- action=konto_schluessel ----------
if ($action === 'konto_schluessel') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);
  $st = $pdo->prepare('SELECT oeff, priv_chiffre FROM pr_lehrkraft WHERE code=?');
  $st->execute([$code]);
  $r = $st->fetch();
  out(['ok' => true, 'oeff' => $r['oeff'], 'priv_chiffre' => $r['priv_chiffre']]);
}

// ---------- action=konto_passphrase ----------
// Neue Passphrase: neues Salt, neuer auth-Wert, neu verpackter privater
// Schluessel. Das Schluesselpaar selbst bleibt - sonst waeren alle bisherigen
// Abgaben nicht mehr zu oeffnen.
if ($action === 'konto_passphrase') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);
  $saltNeu = base64_decode((string)($_POST['salt_neu'] ?? ''), true);
  $authNeu = (string)($_POST['auth_neu'] ?? '');
  $privNeu = (string)($_POST['priv_chiffre_neu'] ?? '');
  if ($saltNeu === false || strlen($saltNeu) !== 32) { fail('ungueltig', 400); }
  if ($authNeu === '' || strlen($authNeu) > 512) { fail('ungueltig', 400); }
  if (!chiffreOk($privNeu, 8192)) { fail('ungueltig', 400); }
  $pdo->prepare('UPDATE pr_lehrkraft SET auth_hash=?, salt=?, priv_chiffre=? WHERE code=?')
      ->execute([password_hash($authNeu, PASSWORD_DEFAULT), $saltNeu, $privNeu, $code]);
  out(['ok' => true]);
}

/* =====================================================================
   Klausuren
   ===================================================================== */

// ---------- action=klausur_anlegen ----------
if ($action === 'klausur_anlegen') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);

  $meta   = (string)($_POST['meta_chiffre'] ?? '');
  $fragen = (string)($_POST['fragen'] ?? '');
  $loes   = (string)($_POST['loesung_chiffre'] ?? '');
  $tage   = (int)($_POST['tage'] ?? 0);

  if (!chiffreOk($meta, 16384)) { fail('ungueltig', 400); }
  if (!chiffreOk($loes, $MAX_CHIFFRE)) { fail('ungueltig', 400); }
  if ($tage < 1 || $tage > $MAX_TAGE) { fail('ungueltig', 400); }
  if ($fragen === '' || strlen($fragen) > $MAX_FRAGEN) { fail('zugross', 413); }
  $fdec = json_decode($fragen, true);
  if (!is_array($fdec) || !$fdec) { fail('ungueltig', 400); }

  // Zwei Formen: die alte blanke Liste, oder {v, mischen, aufgaben}. Beim
  // Objekt sind nur diese Schluessel erlaubt - damit niemand einen
  // Loesungshinweis daneben schmuggelt.
  if (array_is_list($fdec)) {
    $aufgaben = $fdec;
  } else {
    foreach (array_keys($fdec) as $kk) {
      if (!in_array($kk, ['v', 'mischen', 'aufgaben'], true)) { fail('ungueltig', 400); }
    }
    $aufgaben = $fdec['aufgaben'] ?? null;
    if (!is_array($aufgaben) || !$aufgaben || !array_is_list($aufgaben)) { fail('ungueltig', 400); }
    $mischen = $fdec['mischen'] ?? null;
    if ($mischen !== null) {
      if (!is_array($mischen)) { fail('ungueltig', 400); }
      foreach (array_keys($mischen) as $kk) {
        if (!in_array($kk, ['fragen', 'optionen', 'teilmenge'], true)) { fail('ungueltig', 400); }
      }
      $tm = $mischen['teilmenge'] ?? null;
      if ($tm !== null && (!is_int($tm) || $tm < 1 || $tm > count($aufgaben))) {
        fail('ungueltig', 400);
      }
    }
  }

  // Im Klartextteil darf nichts stehen, was eine Antwort verraet.
  foreach ($aufgaben as $frage) {
    if (!is_array($frage) || !isset($frage['text'], $frage['optionen'], $frage['anzahl'])) {
      fail('ungueltig', 400);
    }
    if (!is_array($frage['optionen']) || count($frage['optionen']) < 2
        || count($frage['optionen']) > 10) { fail('ungueltig', 400); }
    if (!is_int($frage['anzahl']) || $frage['anzahl'] < 1
        || $frage['anzahl'] >= count($frage['optionen'])) { fail('ungueltig', 400); }
    foreach (['richtig', 'loesung', 'korrekt'] as $verraeter) {
      if (array_key_exists($verraeter, $frage)) { fail('ungueltig', 400); }
    }
    /* Ein Bild zur Frage ist erlaubt - aber nur als SVG-Quelltext, nur in
       Groessen, die eine Klausur nicht sprengen, und ohne alles, was ein
       SVG zu mehr als einem Bild machen wuerde. Der Teilnehmerbrowser
       stellt es ohnehin in einem <img> dar, in dem kein Skript laeuft.
       Geprueft wird hier trotzdem: Was der Server nicht annimmt, kann er
       auch nicht weiterreichen. */
    if (array_key_exists('bild', $frage)) {
      $b = $frage['bild'];
      if (!is_string($b) || strlen($b) > $MAX_BILD) { fail('ungueltig', 400); }
      if (substr($b, 0, 4) !== '<svg' || substr(rtrim($b), -6) !== '</svg>') {
        fail('ungueltig', 400);
      }
      foreach (['<script', 'javascript:', 'onload=', 'onclick=', 'onerror=',
                'xlink:href', '<foreignobject', '<use', '<image',
                '<animate', '<set', '<iframe'] as $gift) {
        if (stripos($b, $gift) !== false) { fail('ungueltig', 400); }
      }
    }
  }

  $st = $pdo->prepare('SELECT COUNT(*) AS n FROM pr_klausur WHERE lehrkraft=?');
  $st->execute([$code]);
  if ((int)$st->fetch()['n'] >= $MAX_KLAUS) { fail('voll', 409); }

  for ($t = 0; $t < 12; $t++) {
    $id = wuerfel(10);
    try {
      $pdo->prepare('INSERT INTO pr_klausur
          (id,lehrkraft,meta_chiffre,fragen,loesung_chiffre,status,angelegt,loeschen_ab)
          VALUES (?,?,?,?,?,\'entwurf\',NOW(), NOW() + INTERVAL ? DAY)')
          ->execute([$id, $code, $meta, $fragen, $loes, $tage]);
      out(['ok' => true, 'id' => $id]);
    } catch (PDOException $ex) {
      if ($ex->getCode() !== '23000') { fail('db', 500); }
    }
  }
  fail('voll', 500);
}

// ---------- action=klausur_liste ----------
if ($action === 'klausur_liste') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);
  $st = $pdo->prepare('SELECT k.id, k.meta_chiffre, k.status, k.angelegt, k.loeschen_ab,
      (SELECT COUNT(*) FROM pr_teilnahme t WHERE t.klausur=k.id) AS codes,
      (SELECT COUNT(*) FROM pr_teilnahme t WHERE t.klausur=k.id AND t.abgegeben IS NOT NULL) AS abgaben
      FROM pr_klausur k WHERE k.lehrkraft=? ORDER BY k.angelegt DESC');
  $st->execute([$code]);
  out(['ok' => true, 'klausuren' => $st->fetchAll()]);
}

// ---------- action=klausur_status ----------
if ($action === 'klausur_status') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);
  $id   = strtoupper(trim((string)($_POST['id'] ?? '')));
  $neu  = (string)($_POST['status'] ?? '');
  klausurVon($pdo, $code, $id);
  if (!in_array($neu, ['entwurf', 'offen', 'beendet'], true)) { fail('ungueltig', 400); }
  $pdo->prepare('UPDATE pr_klausur SET status=? WHERE id=?')->execute([$neu, $id]);
  out(['ok' => true]);
}

// ---------- action=klausur_loeschen ----------
if ($action === 'klausur_loeschen') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);
  $id = strtoupper(trim((string)($_POST['id'] ?? '')));
  klausurVon($pdo, $code, $id);
  $pdo->prepare('DELETE FROM pr_klausur WHERE id=?')->execute([$id]);
  out(['ok' => true]);
}

// ---------- action=ergebnisse ----------
if ($action === 'ergebnisse') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);
  $id = strtoupper(trim((string)($_POST['id'] ?? '')));
  $k  = klausurVon($pdo, $code, $id);
  $st = $pdo->prepare('SELECT code, benutzt, abgegeben, antwort_chiffre, resets
                       FROM pr_teilnahme WHERE klausur=? ORDER BY code');
  $st->execute([$id]);
  out([
    'ok'              => true,
    'loesung_chiffre' => $k['loesung_chiffre'],
    'fragen'          => $k['fragen'],
    'teilnahmen'      => $st->fetchAll(),
  ]);
}

/* =====================================================================
   Teilnehmercodes
   ===================================================================== */

// ---------- action=codes_erzeugen ----------
// Die PINs kommen genau einmal zurueck. Danach stehen sie nur noch als Hash
// in der Datenbank - auch die Lehrkraft kann sie nicht nachschlagen.
if ($action === 'codes_erzeugen') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);
  $id     = strtoupper(trim((string)($_POST['id'] ?? '')));
  $anzahl = (int)($_POST['anzahl'] ?? 0);
  klausurVon($pdo, $code, $id);
  if ($anzahl < 1 || $anzahl > $MAX_CODES) { fail('ungueltig', 400); }

  $st = $pdo->prepare('SELECT COUNT(*) AS n FROM pr_teilnahme WHERE klausur=?');
  $st->execute([$id]);
  if ((int)$st->fetch()['n'] + $anzahl > $MAX_CODES) { fail('voll', 409); }

  $neu = [];
  for ($i = 0; $i < $anzahl; $i++) {
    for ($t = 0; $t < 12; $t++) {
      $c   = wuerfel(6);
      $pin = '';
      for ($j = 0; $j < 6; $j++) { $pin .= (string)random_int(0, 9); }
      try {
        $pdo->prepare('INSERT INTO pr_teilnahme (klausur,code,pin_hash) VALUES (?,?,?)')
            ->execute([$id, $c, password_hash($pin, PASSWORD_DEFAULT)]);
        $neu[] = ['code' => $c, 'pin' => $pin];
        break;
      } catch (PDOException $ex) {
        if ($ex->getCode() !== '23000') { fail('db', 500); }
      }
    }
  }
  out(['ok' => true, 'codes' => $neu]);
}

// ---------- action=codes_liste ----------
if ($action === 'codes_liste') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);
  $id = strtoupper(trim((string)($_POST['id'] ?? '')));
  klausurVon($pdo, $code, $id);
  $st = $pdo->prepare('SELECT code, benutzt, abgegeben, resets
                       FROM pr_teilnahme WHERE klausur=? ORDER BY code');
  $st->execute([$id]);
  out(['ok' => true, 'codes' => $st->fetchAll()]);
}

// ---------- action=code_zuruecksetzen ----------
// Fuer den Fall, dass jemand unverschuldet herausgeflogen ist. Es wird
// gezaehlt und steht spaeter in der Ergebnistabelle.
if ($action === 'code_zuruecksetzen') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);
  $id    = strtoupper(trim((string)($_POST['id'] ?? '')));
  $tcode = strtoupper(trim((string)($_POST['tcode'] ?? '')));
  klausurVon($pdo, $code, $id);
  if (!preg_match('/^[' . ALPHABET . ']{6}$/', $tcode)) { fail('ungueltig', 400); }
  $st = $pdo->prepare('UPDATE pr_teilnahme
      SET benutzt=NULL, abgegeben=NULL, antwort_chiffre=NULL,
          resets=resets+1, fehlschlag=0, gesperrt_bis=NULL
      WHERE klausur=? AND code=?');
  $st->execute([$id, $tcode]);
  if ($st->rowCount() === 0) { fail('unbekannt', 403); }
  out(['ok' => true]);
}

/* =====================================================================
   Fragenpool - nur fuer angemeldete Lehrkraefte
   ===================================================================== */

if ($action === 'fragenpool') {
  anmelden($pdo, $code, $auth);
  freigabePruefen($FREI, $NUR_CODES, $code);
  $pfad = (string)($cfg['fragenpool'] ?? '');
  if ($pfad === '' || !is_file($pfad)) { out(['ok' => true, 'pool' => []]); }
  $roh = file_get_contents($pfad);
  $pool = json_decode((string)$roh, true);
  if (!is_array($pool)) { fail('db', 500); }
  out(['ok' => true, 'pool' => $pool]);
}

/* =====================================================================
   Teilnahme
   ===================================================================== */

function teilnahmeHolen(PDO $pdo, string $tcode, string $tpin): array {
  if (!preg_match('/^[' . ALPHABET . ']{6}$/', $tcode) || !preg_match('/^\d{6}$/', $tpin)) {
    password_hash($tpin === '' ? 'x' : $tpin, PASSWORD_DEFAULT);
    fail('unbekannt', 403);
  }
  $st = $pdo->prepare('SELECT t.*, k.status, k.fragen, l.oeff
      FROM pr_teilnahme t
      JOIN pr_klausur k ON k.id = t.klausur
      JOIN pr_lehrkraft l ON l.code = k.lehrkraft
      WHERE t.code=?');
  $st->execute([$tcode]);
  $row = $st->fetch();
  if (!$row) { password_hash($tpin, PASSWORD_DEFAULT); fail('unbekannt', 403); }
  if ($row['gesperrt_bis'] !== null && strtotime((string)$row['gesperrt_bis']) > time()) {
    fail('gesperrt', 429);
  }
  if (!password_verify($tpin, (string)$row['pin_hash'])) {
    $f = (int)$row['fehlschlag'] + 1;
    if ($f >= 5) {
      $pdo->prepare('UPDATE pr_teilnahme SET fehlschlag=?, gesperrt_bis = NOW() + INTERVAL 120 SECOND WHERE code=?')
          ->execute([$f, $tcode]);
    } else {
      $pdo->prepare('UPDATE pr_teilnahme SET fehlschlag=? WHERE code=?')->execute([$f, $tcode]);
    }
    fail('unbekannt', 403);
  }
  return $row;
}

// ---------- action=start ----------
// Genau einmal gueltig. Wer schon gestartet hat, kommt nicht wieder herein,
// bis die Lehrkraft zuruecksetzt.
if ($action === 'start') {
  $tcode = strtoupper(trim((string)($_POST['tcode'] ?? '')));
  $tpin  = (string)($_POST['tpin'] ?? '');
  $t = teilnahmeHolen($pdo, $tcode, $tpin);
  if (!$FREI) {
    $st = $pdo->prepare('SELECT lehrkraft FROM pr_klausur WHERE id=?');
    $st->execute([$t['klausur']]);
    freigabePruefen($FREI, $NUR_CODES, (string)$st->fetch()['lehrkraft']);
  }
  if ($t['status'] !== 'offen') { fail('nicht_offen', 409); }
  if ($t['benutzt'] !== null) { fail('schon_benutzt', 409); }
  $pdo->prepare('UPDATE pr_teilnahme SET benutzt=NOW(), fehlschlag=0 WHERE code=?')->execute([$tcode]);
  // Kein Titel fuer den Teilnehmer. Er ist fuer die Lehrkraft verschluesselt
  // und bliebe unlesbar - und ein zusaetzliches Klartextfeld waere die
  // Einladung, "BFS 12b Klausur 2" hineinzuschreiben. Die Klasse weiss auch
  // so, wovor sie sitzt.
  out(['ok' => true, 'fragen' => $t['fragen'], 'oeff' => $t['oeff']]);
}

// ---------- action=abgeben ----------
if ($action === 'abgeben') {
  $tcode = strtoupper(trim((string)($_POST['tcode'] ?? '')));
  $tpin  = (string)($_POST['tpin'] ?? '');
  $chif  = (string)($_POST['antwort_chiffre'] ?? '');
  $t = teilnahmeHolen($pdo, $tcode, $tpin);
  if ($t['status'] !== 'offen') { fail('nicht_offen', 409); }
  if ($t['benutzt'] === null) { fail('ungueltig', 409); }
  if ($t['abgegeben'] !== null) { fail('schon_benutzt', 409); }
  if (!chiffreOk($chif, $MAX_CHIFFRE)) { fail('zugross', 413); }
  $pdo->prepare('UPDATE pr_teilnahme SET abgegeben=NOW(), antwort_chiffre=? WHERE code=?')
      ->execute([$chif, $tcode]);
  out(['ok' => true]);
}

fail('ungueltig', 400);
