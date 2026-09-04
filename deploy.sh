#!/usr/bin/env bash
# Deployt t-bk.de aus mehreren Repos:
#   tbk-webseite/public       -> DocumentRoot (Startseite, Impressum)
#   unterrichtsmaterial (main)-> /werkzeuge/         (Tools + generierte Uebersicht)
#   valis (main)              -> /projekte/valis/
#   bk-e-plan (master)        -> /projekte/e-plan/
#   + generierte /projekte/-Uebersicht
# Laeuft nur bei Aenderungen. Aufruf (als root):
#   runuser -u ctnutzerone -- bash /home/users/ctnutzerone/git/tbk-webseite/deploy.sh
set -euo pipefail

DOCROOT="/home/users/ctnutzerone/www/t-bk.de/"
GIT_BASE="/home/users/ctnutzerone/git"
SITE_DIR="$GIT_BASE/tbk-webseite"
MAT_DIR="$GIT_BASE/unterrichtsmaterial"
VALIS_DIR="$GIT_BASE/valis"
EPLAN_DIR="$GIT_BASE/bk-e-plan"

WERKZEUGE="${DOCROOT}werkzeuge/"
PROJEKTE="${DOCROOT}projekte/"

# Jekyll-Front-Matter (--- ... ---) am Dateianfang entfernen.
strip_fm() { awk 'NR==1&&$0=="---"{fm=1;next} fm&&$0=="---"{fm=0;next} !fm'; }

# origin/<branch> holen; bei neuem Commit fast-forwarden und "yes" ausgeben.
repo_advanced() {  # $1 = repo-dir, $2 = branch
  local d="$1" b="$2" l r
  git -C "$d" fetch --quiet origin "$b"
  l=$(git -C "$d" rev-parse HEAD)
  r=$(git -C "$d" rev-parse "origin/$b")
  if [ "$l" != "$r" ]; then
    git -C "$d" merge --ff-only "origin/$b" >/dev/null
    echo yes
  fi
}

rev() { if [ -d "$1/.git" ]; then git -C "$1" rev-parse --short HEAD; else echo "-"; fi; }

# --- Seiten-Geruest (gemeinsames Design) ---
page_head() {  # $1 = <title>, $2 = H1, $3 = lead
  printf '<!DOCTYPE html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>%s</title>\n<style>\n' "$1"
  cat <<'CSS'
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
CSS
  printf '</style>\n</head>\n<body>\n  <header class="wrap">\n    <a class="back" href="/">&larr; Startseite</a>\n    <h1>%s</h1>\n    <p class="lead">%s</p>\n  </header>\n  <main class="wrap">\n' "$2" "$3"
}
page_foot() {
  printf '  </main>\n  <footer class="wrap">&copy; 2026 t-bk.de &middot; <a href="/impressum.html">Impressum</a> &middot; <a href="/datenschutz.html">Datenschutz</a></footer>\n</body>\n</html>\n'
}

# Titel einer HTML-Datei robust auslesen (vertraegt '<' im Titel), HTML-maskiert.
html_title() {  # $1 = datei, $2 = optionaler prefix zum Strippen
  local f="$1" pre="${2:-}" raw t
  raw=$(grep -iom1 '<title>.*</title>' "$f" || true)
  t=$(printf '%s' "$raw" | sed -E 's|.*<title>(.*)</title>.*|\1|I')
  [ -z "$pre" ] || t=$(printf '%s' "$t" | sed -E "s/^${pre}[[:space:]]*//")
  printf '%s' "$t" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'
}

# --- /werkzeuge/ : Tools nach Kategorien ---
gen_werkzeuge() {
  page_head "Werkzeuge &middot; t-bk.de" "Werkzeuge" "Interaktive Web-Tools und Simulationen f&uuml;r die Fertigungs- und Pr&uuml;ftechnik."
  local mm="" tol="" son="" f base t card
  for f in "${WERKZEUGE}tools/"*.html; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    t=$(html_title "$f" "Fertigungstechnik:")
    [ -n "$t" ] || t=$(printf '%s' "${base%.html}" | sed 's/-/ /g')
    card=$(printf '      <a class="card" href="tools/%s"><span>%s</span></a>\n' "$base" "$t")
    case "$base" in
      fertigungstechnik-messmittel-*)              mm="$mm$card"$'\n' ;;
      fertigungstechnik-form-und-lagetoleranzen-*) tol="$tol$card"$'\n' ;;
      *)                                           son="$son$card"$'\n' ;;
    esac
  done
  emit_cat() { [ -n "$2" ] || return 0; printf '    <h2 class="cat">%s</h2>\n    <div class="grid">\n%s    </div>\n' "$1" "$2"; }
  emit_cat "Messmittel" "$mm"
  emit_cat "Form- und Lagetoleranzen" "$tol"
  emit_cat "Weitere Werkzeuge" "$son"
  page_foot
}

# --- /projekte/ : je Unterordner ein Projekt ---
gen_projekte() {
  page_head "Projekte &middot; t-bk.de" "Projekte" "Gr&ouml;&szlig;ere interaktive Entwicklungen."
  printf '    <div class="grid">\n'
  local d name t
  for d in "${PROJEKTE}"*/; do
    [ -f "${d}index.html" ] || continue
    name=$(basename "$d")
    t=$(html_title "${d}index.html")
    [ -n "$t" ] || t="$name"
    printf '      <a class="card" href="%s/"><span>%s</span></a>\n' "$name" "$t"
  done
  printf '    </div>\n'
  page_foot
}

# --- Aenderungen erkennen ---
changed=0
if [ -n "${TBK_REEXEC:-}" ]; then changed=1; fi

site_changed=""
if [ -n "$(repo_advanced "$SITE_DIR" main)" ]; then site_changed=1; changed=1; fi
# Hat sich deploy.sh selbst geaendert, die AKTUALISIERTE Version ausfuehren.
if [ -n "$site_changed" ] && [ -z "${TBK_REEXEC:-}" ]; then
  export TBK_REEXEC=1
  exec bash "$SITE_DIR/deploy.sh"
fi

if [ -d "$MAT_DIR/.git" ];   then if [ -n "$(repo_advanced "$MAT_DIR" main)" ];     then changed=1; fi; fi
if [ -d "$VALIS_DIR/.git" ]; then if [ -n "$(repo_advanced "$VALIS_DIR" main)" ];   then changed=1; fi; fi
if [ -d "$EPLAN_DIR/.git" ]; then if [ -n "$(repo_advanced "$EPLAN_DIR" master)" ]; then changed=1; fi; fi

# Bootstrap: fehlt eine Zielseite, trotzdem deployen.
if [ ! -f "${WERKZEUGE}index.html" ]; then changed=1; fi
if [ -d "$VALIS_DIR/.git" ] && [ ! -f "${PROJEKTE}valis/index.html" ]; then changed=1; fi
if [ -d "$EPLAN_DIR/.git" ] && [ ! -f "${PROJEKTE}e-plan/index.html" ]; then changed=1; fi
if [ "$changed" -eq 0 ]; then exit 0; fi

# --- 1) Hauptseite -> DocumentRoot (Bereiche + ACME schuetzen) ---
rsync -a --delete --exclude='.well-known/' --exclude='werkzeuge/' --exclude='projekte/' "$SITE_DIR/public/" "$DOCROOT"

# --- 2) Werkzeuge -> /werkzeuge/ ---
if [ -d "$MAT_DIR/.git" ]; then
  mkdir -p "${WERKZEUGE}tools"
  rsync -a --delete "$MAT_DIR/tools/" "${WERKZEUGE}tools/"
  for f in "${WERKZEUGE}tools/"*.html; do
    [ -e "$f" ] || continue
    strip_fm < "$f" > "$f.tmp" && mv "$f.tmp" "$f"
  done
  gen_werkzeuge > "${WERKZEUGE}index.html"
fi

# --- 3) Projekte -> /projekte/<name>/ (+ Uebersicht) ---
mkdir -p "$PROJEKTE"
if [ -d "$VALIS_DIR/.git" ]; then
  mkdir -p "${PROJEKTE}valis"
  rsync -a --delete --exclude='.git/' --exclude='.claude/' --exclude='splash/' "$VALIS_DIR/" "${PROJEKTE}valis/"
fi
if [ -d "$EPLAN_DIR/.git" ]; then
  mkdir -p "${PROJEKTE}e-plan"
  rsync -a --delete --exclude='.git/' --exclude='.claude/' "$EPLAN_DIR/" "${PROJEKTE}e-plan/"
fi
gen_projekte > "${PROJEKTE}index.html"

echo "$(date '+%F %T') deployed site=$(rev "$SITE_DIR") material=$(rev "$MAT_DIR") valis=$(rev "$VALIS_DIR") eplan=$(rev "$EPLAN_DIR")"
