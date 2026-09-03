#!/usr/bin/env bash
# Deployt t-bk.de aus zwei Repos:
#   tbk-webseite/public   -> DocumentRoot (Startseite, Impressum)
#   unterrichtsmaterial   -> DocumentRoot/unterricht/ (Tools + generierte Uebersicht)
# Laeuft nur, wenn sich etwas geaendert hat. Aufruf (als root):
#   runuser -u ctnutzerone -- bash /home/users/ctnutzerone/git/tbk-webseite/deploy.sh
set -euo pipefail

DOCROOT="/home/users/ctnutzerone/www/t-bk.de/"
GIT_BASE="/home/users/ctnutzerone/git"
SITE_DIR="$GIT_BASE/tbk-webseite"
MAT_DIR="$GIT_BASE/unterrichtsmaterial"
UNTERRICHT="${DOCROOT}unterricht/"
VALIS_DIR="$GIT_BASE/valis"
VALIS_WEB="${DOCROOT}valis/"

# Jekyll-Front-Matter (--- ... ---) am Dateianfang entfernen.
strip_fm() { awk 'NR==1&&$0=="---"{fm=1;next} fm&&$0=="---"{fm=0;next} !fm'; }

# origin/main holen; bei neuem Commit fast-forwarden und "yes" ausgeben.
repo_advanced() {
  local d="$1" l r
  git -C "$d" fetch --quiet origin main
  l=$(git -C "$d" rev-parse HEAD)
  r=$(git -C "$d" rev-parse origin/main)
  if [ "$l" != "$r" ]; then
    git -C "$d" merge --ff-only origin/main >/dev/null
    echo yes
  fi
}

# Uebersichtsseite /unterricht/ aus den Tools erzeugen (t-bk.de-Design).
gen_overview() {
cat <<'HEAD'
<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unterrichtsmaterial &middot; t-bk.de</title>
<style>
  :root{--bg:#f7f7f5;--fg:#1a1a1a;--muted:#5f5f5a;--card:#fff;--border:#e3e3df;--accent:#2b6cb0;--shadow:0 1px 3px rgba(0,0,0,.06),0 8px 24px rgba(0,0,0,.05);}
  @media (prefers-color-scheme:dark){:root{--bg:#151517;--fg:#ececec;--muted:#a0a0a0;--card:#1e1e21;--border:#2c2c30;--accent:#5b9bd5;--shadow:0 1px 3px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{width:100%;max-width:960px;margin:0 auto;padding:0 20px}
  a{color:var(--accent)}
  header{padding:48px 0 8px}
  .back{display:inline-block;margin-bottom:18px;font-size:14px;text-decoration:none}
  .back:hover{text-decoration:underline}
  h1{font-size:clamp(26px,4vw,34px);letter-spacing:-.5px;margin:0 0 10px}
  .lead{color:var(--muted);font-size:17px;margin:0}
  .grid{display:grid;gap:14px;padding:14px 0 8px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));}
  .cat{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:34px 0 0;padding-top:22px;border-top:1px solid var(--border);}
  .cat:first-of-type{border-top:0;padding-top:6px;margin-top:16px}
  a.card{display:flex;align-items:center;min-height:64px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;text-decoration:none;color:inherit;box-shadow:var(--shadow);transition:transform .15s ease,border-color .15s ease;font-weight:600;font-size:15px;}
  a.card:hover{transform:translateY(-3px);border-color:var(--accent)}
  footer{text-align:center;color:var(--muted);font-size:13px;padding:40px 0 32px;border-top:1px solid var(--border);margin-top:48px}
  footer a{color:var(--muted)}
</style>
</head>
<body>
  <header class="wrap">
    <a class="back" href="/">&larr; Startseite</a>
    <h1>Unterrichtsmaterial</h1>
    <p class="lead">Interaktive Werkzeuge f&uuml;r die Fertigungs- und Pr&uuml;ftechnik.</p>
  </header>
  <main class="wrap">
HEAD
  # Karte fuer eine Tool-Datei bauen (Titel robust gegen '<', HTML-maskiert).
  card_for() {
    local f="$1" base raw t
    base=$(basename "$f")
    raw=$(grep -iom1 '<title>.*</title>' "$f" || true)
    t=$(printf '%s' "$raw" | sed -E 's|.*<title>(.*)</title>.*|\1|I; s/^Fertigungstechnik:[[:space:]]*//')
    [ -n "$t" ] || t=$(printf '%s' "${base%.html}" | sed 's/-/ /g')
    t=$(printf '%s' "$t" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')
    printf '      <a class="card" href="tools/%s"><span>%s</span></a>\n' "$base" "$t"
  }
  # Tools nach Dateinamen in Kategorien einsortieren.
  mm=""; tol=""; son=""
  for f in "${UNTERRICHT}tools/"*.html; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    card=$(card_for "$f")
    case "$base" in
      fertigungstechnik-messmittel-*)              mm="$mm$card"$'\n' ;;
      fertigungstechnik-form-und-lagetoleranzen-*) tol="$tol$card"$'\n' ;;
      *)                                           son="$son$card"$'\n' ;;
    esac
  done
  emit_cat() {  # $1 = Titel, $2 = Karten-HTML
    [ -n "$2" ] || return 0
    printf '    <h2 class="cat">%s</h2>\n    <div class="grid">\n%s    </div>\n' "$1" "$2"
  }
  emit_cat "Messmittel" "$mm"
  emit_cat "Form- und Lagetoleranzen" "$tol"
  emit_cat "Weitere Werkzeuge" "$son"
cat <<'FOOT'
  </main>
  <footer class="wrap">&copy; 2026 t-bk.de &middot; <a href="/impressum.html">Impressum</a></footer>
</body>
</html>
FOOT
}

# --- Aenderungen erkennen ---
changed=0
# Nach einem Selbst-Update (siehe unten) immer deployen.
if [ -n "${TBK_REEXEC:-}" ]; then changed=1; fi

site_changed=""
if [ -n "$(repo_advanced "$SITE_DIR")" ]; then site_changed=1; changed=1; fi

# Hat sich deploy.sh selbst geaendert, die AKTUALISIERTE Version ausfuehren --
# sonst liefe in diesem Prozess weiter die alte, schon geladene Logik.
if [ -n "$site_changed" ] && [ -z "${TBK_REEXEC:-}" ]; then
  export TBK_REEXEC=1
  exec bash "$SITE_DIR/deploy.sh"
fi

if [ -d "$MAT_DIR/.git" ]; then
  if [ -n "$(repo_advanced "$MAT_DIR")" ]; then changed=1; fi
fi
if [ -d "$VALIS_DIR/.git" ]; then
  if [ -n "$(repo_advanced "$VALIS_DIR")" ]; then changed=1; fi
fi
# Bootstrap: fehlt eine Zielseite, trotzdem einmal deployen.
if [ ! -f "${UNTERRICHT}index.html" ]; then changed=1; fi
if [ -d "$VALIS_DIR/.git" ] && [ ! -f "${VALIS_WEB}index.html" ]; then changed=1; fi
if [ "$changed" -eq 0 ]; then exit 0; fi

# --- 1) Hauptseite -> DocumentRoot (unterricht/ und ACME schuetzen) ---
rsync -a --delete --exclude='.well-known/' --exclude='unterricht/' --exclude='valis/' "$SITE_DIR/public/" "$DOCROOT"

# --- 2) Unterrichtsmaterial -> DocumentRoot/unterricht/ ---
if [ -d "$MAT_DIR/.git" ]; then
  mkdir -p "${UNTERRICHT}tools"
  rsync -a --delete "$MAT_DIR/tools/" "${UNTERRICHT}tools/"
  for f in "${UNTERRICHT}tools/"*.html; do
    [ -e "$f" ] || continue
    strip_fm < "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
  gen_overview > "${UNTERRICHT}index.html"
fi

# --- 3) VALIS -> DocumentRoot/valis/ (statisch; splash/ wird nicht ausgeliefert) ---
if [ -d "$VALIS_DIR/.git" ]; then
  mkdir -p "$VALIS_WEB"
  rsync -a --delete --exclude='.git/' --exclude='.claude/' --exclude='splash/' "$VALIS_DIR/" "$VALIS_WEB"
fi

MAT_REV="-"; [ -d "$MAT_DIR/.git" ] && MAT_REV=$(git -C "$MAT_DIR" rev-parse --short HEAD)
VALIS_REV="-"; [ -d "$VALIS_DIR/.git" ] && VALIS_REV=$(git -C "$VALIS_DIR" rev-parse --short HEAD)
echo "$(date '+%F %T') deployed site=$(git -C "$SITE_DIR" rev-parse --short HEAD) material=$MAT_REV valis=$VALIS_REV"
