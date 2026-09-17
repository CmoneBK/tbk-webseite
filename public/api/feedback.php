<?php
declare(strict_types=1);
date_default_timezone_set('Europe/Berlin');

// Zentrale Feedback-Sammelstelle fuer t-bk.de.
// Trackingfrei: keine Cookies, keine externen Dienste. Spam-Schutz per
// signiertem Token (HMAC) + Zeitfalle + Honeypot + IP-Ratenlimit
// (IP wird NUR gehasht gespeichert, nie im Klartext).
//
// GET  ?action=token  -> { ts, token }   (vor dem Absenden holen)
// POST (form oder JSON): ts, token, hp, role, category, message, path, title
//                     -> { ok:true } | { ok:false, error }

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

// Liegt in files/ (nicht private/), weil PHPs open_basedir hier nur www/, files/
// und tmp/ erlaubt. files/ ist nicht oeffentlich erreichbar und nicht deploy-verwaltet.
$CONFIG_PATH = '/home/users/ctnutzerone/files/feedback-config.php';

function out(array $data, int $code = 200): void {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE);
  exit;
}
function fail(int $code, string $msg): void { out(['ok' => false, 'error' => $msg], $code); }

if (!is_file($CONFIG_PATH)) { fail(500, 'config missing'); }
$cfg = require $CONFIG_PATH;

$MIN_SECONDS = 3;          // Zeitfalle: schneller ausgefuellt = Bot
$MAX_SECONDS = 2 * 3600;   // Token-Gueltigkeit
$RATE_LIMIT  = (int)($cfg['rate_limit_per_hour'] ?? 12);
$MSG_MAX     = 2000;

$ROLES      = ['schueler', 'lehrkraft'];
$CATEGORIES = ['fehler', 'verstaendnis', 'lob', 'vorschlag', 'sonstiges'];

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string)($_GET['action'] ?? '');

// --- Token ausgeben (stateless, HMAC ueber Zeitstempel) ---
if ($method === 'GET' && $action === 'token') {
  $ts = time();
  out(['ts' => $ts, 'token' => hash_hmac('sha256', (string)$ts, (string)$cfg['hmac_secret'])]);
}

// --- Lesen (Weg C): geschuetzte Liste NUR fuer vertrauenswuerdige Clients ---
// GET ?action=liste  mit  Authorization: Bearer <lese_key>  ODER  ?key=<lese_key>.
// Der Schluessel steht in feedback-config.php (files/), nie in Repo/Seite.
// Antwort enthaelt bewusst KEINE IP / keinen ip_hash.
if ($method === 'GET' && $action === 'liste') {
  $key = '';
  $hdr = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
  if (stripos($hdr, 'Bearer ') === 0) { $key = trim(substr($hdr, 7)); }
  if ($key === '') { $key = (string)($_GET['key'] ?? ''); }
  $expected = (string)($cfg['lese_key'] ?? '');
  if ($expected === '' || !hash_equals($expected, $key)) { fail(401, 'unauthorized'); }

  try {
    $pdo = new PDO((string)$cfg['db_dsn'], (string)$cfg['db_user'], (string)$cfg['db_pass'], [
      PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
      PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
  } catch (Throwable $e) { fail(500, 'db error'); }

  $limit = (int)($_GET['limit'] ?? 50);
  if ($limit < 1) { $limit = 1; }
  if ($limit > 200) { $limit = 200; }

  $where = []; $args = [];
  if (isset($_GET['seit']) && $_GET['seit'] !== '') {
    $seit = (string)$_GET['seit'];
    $ts = ctype_digit($seit) ? (int)$seit : (int)strtotime($seit);
    if ($ts > 0) { $where[] = 'created_at > FROM_UNIXTIME(?)'; $args[] = $ts; }
  }
  if (isset($_GET['pfad']) && $_GET['pfad'] !== '') {
    $p = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], (string)$_GET['pfad']);
    $where[] = 'path LIKE ?'; $args[] = $p . '%';
  }
  if (isset($_GET['status']) && in_array($_GET['status'], ['neu', 'erledigt', 'spam'], true)) {
    $where[] = 'status = ?'; $args[] = (string)$_GET['status'];
  }

  $sql = 'SELECT id, UNIX_TIMESTAMP(created_at) AS ts, role, category, message, path, title, status FROM feedback';
  if ($where) { $sql .= ' WHERE ' . implode(' AND ', $where); }
  $sql .= ' ORDER BY id DESC LIMIT ' . $limit;   // $limit ist int und geklemmt
  $st = $pdo->prepare($sql);
  $st->execute($args);

  $eintraege = []; $neuestes = null;
  foreach ($st->fetchAll() as $r) {
    $iso = date('c', (int)$r['ts']);
    if ($neuestes === null) { $neuestes = $iso; }   // DESC -> erster ist der neueste
    $eintraege[] = [
      'id'        => (int)$r['id'],
      'zeit'      => $iso,
      'rolle'     => $r['role'],
      'kategorie' => $r['category'],
      'nachricht' => $r['message'],
      'pfad'      => $r['path'],
      'titel'     => $r['title'],
      'status'    => $r['status'],
    ];
  }
  out(['ok' => true, 'anzahl' => count($eintraege), 'neuestes' => $neuestes, 'eintraege' => $eintraege]);
}

if ($method !== 'POST') { fail(405, 'method not allowed'); }

// Eingaben: form-encoded ODER JSON-Body
$in = $_POST;
if (!$in) {
  $j = json_decode((string)file_get_contents('php://input'), true);
  if (is_array($j)) { $in = $j; }
}

// --- Honeypot: gefuelltes Feld = Bot. Nach aussen "ok", aber verwerfen. ---
if (trim((string)($in['hp'] ?? '')) !== '') { out(['ok' => true]); }

// --- Token + Zeitfalle ---
$ts       = (int)($in['ts'] ?? 0);
$token    = (string)($in['token'] ?? '');
$expected = hash_hmac('sha256', (string)$ts, (string)$cfg['hmac_secret']);
if ($ts <= 0 || !hash_equals($expected, $token)) { fail(400, 'bad token'); }
$age = time() - $ts;
if ($age < $MIN_SECONDS) { fail(429, 'too fast'); }
if ($age > $MAX_SECONDS) { fail(400, 'token expired'); }

// --- Pflichtfelder (Allowlist) ---
$role     = (string)($in['role'] ?? '');
$category = (string)($in['category'] ?? '');
if (!in_array($role, $ROLES, true))         { fail(400, 'bad role'); }
if (!in_array($category, $CATEGORIES, true)) { fail(400, 'bad category'); }

// --- Freitext + Kontext (laengenbegrenzt) ---
$message = trim((string)($in['message'] ?? ''));
if (mb_strlen($message) > $MSG_MAX) { $message = mb_substr($message, 0, $MSG_MAX); }
$path  = mb_substr(trim((string)($in['path']  ?? '')), 0, 300);
$title = mb_substr(trim((string)($in['title'] ?? '')), 0, 300);

// Bereich aus dem Pfad ableiten
$area = 'start';
if (preg_match('#^/(werkzeuge|unterrichtsmaterial|projekte)(/|$)#', $path, $m)) { $area = $m[1]; }

// --- IP nur gehasht (Pseudonymisierung, ausschliesslich fuer Ratenlimit/Spam) ---
$ip_hash = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . (string)($cfg['ip_salt'] ?? ''));

// --- DB ---
try {
  $pdo = new PDO((string)$cfg['db_dsn'], (string)$cfg['db_user'], (string)$cfg['db_pass'], [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
  ]);
} catch (Throwable $e) { fail(500, 'db error'); }

// --- Ratenlimit pro IP-Hash/Stunde ---
$st = $pdo->prepare('SELECT COUNT(*) FROM feedback WHERE ip_hash = ? AND created_at > (NOW() - INTERVAL 1 HOUR)');
$st->execute([$ip_hash]);
if ((int)$st->fetchColumn() >= $RATE_LIMIT) { fail(429, 'rate limit'); }

// --- Speichern ---
$st = $pdo->prepare(
  'INSERT INTO feedback (created_at, area, path, title, role, category, message, status, ip_hash)
   VALUES (NOW(), ?, ?, ?, ?, ?, ?, "neu", ?)'
);
$st->execute([$area, $path, $title, $role, $category, $message, $ip_hash]);

out(['ok' => true]);
