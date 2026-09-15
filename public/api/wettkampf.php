<?php
declare(strict_types=1);

// Wettkampf-Endpunkt fuer t-bk.de. Macht die Mitstreiter einer Trainings-Runde
// sichtbar (Live-Rangliste). Kein Name/PII (Server vergibt Tiernamen),
// trackingfrei, IP nur gehasht. Datenbank ctnutzerone_db3; Tabellen wk_runde /
// wk_teil und das 24h-Aufraeum-Event stehen bereits (siehe WETTKAMPF-API.md).
// Vertrag: docs/WETTKAMPF-API.md im Repo tbk-lernsituationen-uebungen.

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

$CONFIG_PATH = '/home/users/ctnutzerone/files/wettkampf-config.php';

function out(array $d, int $c = 200): void { http_response_code($c); echo json_encode($d, JSON_UNESCAPED_UNICODE); exit; }
function fail(string $e, int $c): void { out(['ok' => false, 'error' => $e], $c); }
function clampi($v, int $lo, int $hi): int { $v = (int)$v; return $v < $lo ? $lo : ($v > $hi ? $hi : $v); }

if (!is_file($CONFIG_PATH)) { fail('config missing', 500); }
$cfg = require $CONFIG_PATH;

$ALPHABET  = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // ohne O/0, I/1
$TIERE = [
  'Adler','Ameise','Biber','Bussard','Dachs','Delfin','Distel','Eiche',
  'Eisvogel','Elch','Falke','Fasan','Fichte','Fuchs','Gemse','Habicht',
  'Hase','Hecht','Igel','Iltis','Kauz','Kiebitz','Kranich','Krebs',
  'Lachs','Luchs','Marder','Mauser','M'."\u{00F6}".'we','Otter','Pirol','Rabe',
  'Reiher','Robbe','Rotkehl','Salamander','Schwalbe','Seehund','Specht','Star',
  'Steinbock','Storch','Tanne','Taube','Uhu','Wiesel','Zeisig','Zilpzalp',
];
$NEU_LIMIT = (int)($cfg['neu_limit_per_hour'] ?? 20);
$OFFEN_MAX = (int)($cfg['offene_runden_max'] ?? 500);
$TEIL_MAX  = 60;

function tier(array $t, int $nr): string {
  $base = $t[($nr - 1) % count($t)];
  $suf  = intdiv($nr - 1, count($t)) + 1;
  return $suf > 1 ? "$base $suf" : $base;
}

$req    = array_merge($_GET, $_POST);
$action = (string)($req['action'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$ip_hash = hash('sha256', ($_SERVER['REMOTE_ADDR'] ?? '') . '|' . (string)($cfg['ip_salt'] ?? ''));

try {
  $pdo = new PDO((string)$cfg['db_dsn'], (string)$cfg['db_user'], (string)$cfg['db_pass'], [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
  ]);
} catch (Throwable $e) { fail('db error', 500); }

// Rangliste einer Runde bauen (serverseitige Sortierung, weg-Markierung).
function rangliste(PDO $pdo, string $code): array {
  $st = $pdo->prepare('SELECT nr,name,runde,richtig,gesamt,dauer,fertig,UNIX_TIMESTAMP(zuletzt) AS zt FROM wk_teil WHERE code=?');
  $st->execute([$code]);
  $rows = $st->fetchAll();
  $now = time();
  foreach ($rows as &$r) {
    $r['nr']=(int)$r['nr']; $r['runde']=(int)$r['runde']; $r['richtig']=(int)$r['richtig'];
    $r['gesamt']=(int)$r['gesamt']; $r['dauer']=(int)$r['dauer'];
    $r['fertig']=((int)$r['fertig']===1);
    $r['weg']=(!$r['fertig'] && ($now-(int)$r['zt'])>90);
    unset($r['zt']);
  }
  unset($r);
  usort($rows, function($a,$b){
    if ($a['fertig']!==$b['fertig']) return $a['fertig']?-1:1;        // fertige zuerst
    if ($a['richtig']!==$b['richtig']) return $b['richtig']-$a['richtig']; // mehr richtig
    if ($a['dauer']!==$b['dauer']) return $a['dauer']-$b['dauer'];    // kleinere dauer
    return $a['nr']-$b['nr'];                                          // kleinere nr
  });
  return $rows;
}

// ---------- action=neu ----------
if ($action === 'neu') {
  if ($method !== 'POST') { fail('method not allowed', 405); }
  $pfad  = mb_substr(trim((string)($req['pfad']  ?? '')), 0, 255);
  $titel = mb_substr(trim((string)($req['titel'] ?? '')), 0, 200);
  if ($pfad === '' || $titel === '') { fail('bad request', 400); }
  $runden = (isset($req['runden']) && $req['runden'] !== '') ? clampi($req['runden'], 1, 99) : null;

  $st = $pdo->prepare('SELECT COUNT(*) FROM wk_runde WHERE ip_hash=? AND erstellt > (NOW() - INTERVAL 1 HOUR)');
  $st->execute([$ip_hash]);
  if ((int)$st->fetchColumn() >= $NEU_LIMIT) { fail('rate limit', 429); }
  if ((int)$pdo->query('SELECT COUNT(*) FROM wk_runde')->fetchColumn() >= $OFFEN_MAX) { fail('rate limit', 429); }

  $geheim = bin2hex(random_bytes(16));
  $name1  = tier($TIERE, 1);
  for ($t = 0; $t < 12; $t++) {
    $code = '';
    for ($i = 0; $i < 5; $i++) { $code .= $ALPHABET[random_int(0, strlen($ALPHABET) - 1)]; }
    try {
      $pdo->beginTransaction();
      $pdo->prepare('INSERT INTO wk_runde (code,pfad,titel,runden,erstellt,ip_hash) VALUES (?,?,?,?,NOW(),?)')
          ->execute([$code, $pfad, $titel, $runden, $ip_hash]);
      $pdo->prepare('INSERT INTO wk_teil (code,nr,name,geheim,zuletzt) VALUES (?,?,?,?,NOW())')
          ->execute([$code, 1, $name1, $geheim]);
      $pdo->commit();
      out(['ok'=>true,'code'=>$code,'nr'=>1,'name'=>$name1,'geheim'=>$geheim,'teilnehmer'=>1]);
    } catch (PDOException $e) {
      if ($pdo->inTransaction()) $pdo->rollBack();
      if ($e->getCode() !== '23000') { fail('db error', 500); }   // 23000 = Code-Kollision -> neu ziehen
    }
  }
  fail('db error', 500);
}

// ---------- action=beitreten ----------
if ($action === 'beitreten') {
  if ($method !== 'POST') { fail('method not allowed', 405); }
  $code = strtoupper(mb_substr(trim((string)($req['code'] ?? '')), 0, 5));
  if (strlen($code) !== 5) { fail('unbekannt', 404); }
  try {
    $pdo->beginTransaction();
    $st = $pdo->prepare('SELECT pfad,titel,runden FROM wk_runde WHERE code=? FOR UPDATE');
    $st->execute([$code]);
    $runde = $st->fetch();
    if (!$runde) { $pdo->rollBack(); fail('unbekannt', 404); }
    $st = $pdo->prepare('SELECT COALESCE(MAX(nr),0) FROM wk_teil WHERE code=?');
    $st->execute([$code]);
    $max = (int)$st->fetchColumn();
    if ($max >= $TEIL_MAX) { $pdo->rollBack(); fail('voll', 409); }
    $nr = $max + 1;
    $name = tier($TIERE, $nr);
    $geheim = bin2hex(random_bytes(16));
    $pdo->prepare('INSERT INTO wk_teil (code,nr,name,geheim,zuletzt) VALUES (?,?,?,?,NOW())')
        ->execute([$code, $nr, $name, $geheim]);
    $pdo->commit();
    out(['ok'=>true,'code'=>$code,'nr'=>$nr,'name'=>$name,'geheim'=>$geheim,'teilnehmer'=>$nr,
         'pfad'=>$runde['pfad'],'titel'=>$runde['titel'],
         'runden'=>($runde['runden']!==null?(int)$runde['runden']:null)]);
  } catch (PDOException $e) {
    if ($pdo->inTransaction()) $pdo->rollBack();
    fail('db error', 500);
  }
}

// ---------- action=stand (POST = melden+lesen, GET = nur lesen) ----------
if ($action === 'stand') {
  $code = strtoupper(mb_substr(trim((string)($req['code'] ?? '')), 0, 5));
  if (strlen($code) !== 5) { fail('unbekannt', 404); }
  $st = $pdo->prepare('SELECT 1 FROM wk_runde WHERE code=?'); $st->execute([$code]);
  if (!$st->fetchColumn()) { fail('unbekannt', 404); }

  if ($method === 'POST') {
    $geheim = (string)($req['geheim'] ?? '');
    if ($geheim === '') { fail('fremd', 403); }
    $st = $pdo->prepare('SELECT id,runde,fertig FROM wk_teil WHERE code=? AND geheim=?');
    $st->execute([$code, $geheim]);
    $row = $st->fetch();
    if (!$row) { fail('fremd', 403); }
    if ((int)$row['fertig'] !== 1) {                 // fertige Zeile ist eingefroren
      $inRunde  = clampi($req['runde']  ?? 0, 0, 99);
      $inGesamt = clampi($req['gesamt'] ?? 0, 0, 99);
      $inDauer  = clampi($req['dauer']  ?? 0, 0, 36000);
      $inRicht  = min(clampi($req['richtig'] ?? 0, 0, 99), $inRunde);
      $inFertig = ((string)($req['fertig'] ?? '0') === '1') ? 1 : 0;
      if ($inFertig === 1 || $inRunde >= (int)$row['runde']) {
        $pdo->prepare('UPDATE wk_teil SET runde=?,richtig=?,gesamt=?,dauer=?,fertig=?,zuletzt=NOW() WHERE id=?')
            ->execute([$inRunde,$inRicht,$inGesamt,$inDauer,$inFertig,$row['id']]);
      } else {
        $pdo->prepare('UPDATE wk_teil SET zuletzt=NOW() WHERE id=?')->execute([$row['id']]); // veraltetes Paket: nur Lebenszeichen
      }
    }
  }
  out(['ok'=>true,'serverzeit'=>time(),'rang'=>rangliste($pdo,$code)]);
}

fail('bad action', 400);
