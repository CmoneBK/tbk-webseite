#!/usr/bin/env bash
# Deployt t-bk.de aus mehreren Repos:
#   tbk-webseite/public       -> DocumentRoot (Startseite, Impressum)
#   unterrichtsmaterial (main)-> /werkzeuge/         (Tools + Uebersicht, 1:1 kopiert)
#   tbk-lernsituationen-uebungen (main)
#                             -> /unterrichtsmaterial/ (Lernsituationen, Uebungen,
#                                                       Trainings - 1:1 kopiert)
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
# Achtung, aehnliche Namen: MAT_DIR ist das Werkzeuge-Repo (Tools aus CodePen),
# LERN_DIR das Material-Repo (Lernsituationen, Uebungen, Trainings).
LERN_DIR="$GIT_BASE/tbk-lernsituationen-uebungen"
VALIS_DIR="$GIT_BASE/valis"
EPLAN_DIR="$GIT_BASE/bk-e-plan"

WERKZEUGE="${DOCROOT}werkzeuge/"
MATERIAL="${DOCROOT}unterrichtsmaterial/"
PROJEKTE="${DOCROOT}projekte/"

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
  /* Dunkel bei dunklem System, sofern nicht ausdruecklich hell gewaehlt. */
  @media (prefers-color-scheme:dark){:root:not([data-thema="hell"]){--bg:#151517;--fg:#ececec;--muted:#a0a0a0;--card:#1e1e21;--border:#2c2c30;--accent:#5b9bd5;--shadow:0 1px 3px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);}}
  /* Ausdruecklich dunkel gewaehlt - auch auf einem hellen System. */
  :root[data-thema="dunkel"]{--bg:#151517;--fg:#ececec;--muted:#a0a0a0;--card:#1e1e21;--border:#2c2c30;--accent:#5b9bd5;--shadow:0 1px 3px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  .wrap{width:100%;max-width:960px;margin:0 auto;padding:0 20px}
  a{color:var(--accent)}
  header.wrap{padding-top:62px;padding-bottom:8px}
  h1{font-size:clamp(26px,4vw,34px);letter-spacing:-.5px;margin:0 0 10px}
  .lead{color:var(--muted);font-size:17px;margin:0}
  .grid{display:grid;gap:14px;padding:14px 0 8px;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));}
  .bereich{font-size:21px;font-weight:700;letter-spacing:-.3px;margin:42px 0 0;padding-top:26px;border-top:1px solid var(--border);}
  .bereich:first-of-type{border-top:0;padding-top:6px;margin-top:18px}
  .cat{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:26px 0 0;}
  a.card{display:flex;align-items:center;min-height:64px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;text-decoration:none;color:inherit;box-shadow:var(--shadow);transition:transform .15s ease,border-color .15s ease;font-weight:600;font-size:15px;}
  a.card:hover{transform:translateY(-3px);border-color:var(--accent)}
  footer{text-align:center;color:var(--muted);font-size:13px;padding:40px 0 32px;border-top:1px solid var(--border);margin-top:48px}
  footer a{color:var(--muted)}
CSS
  printf '</style>\n<script src="/assets/thema.js"></script>\n</head>\n<body>\n  <header class="wrap">\n    <h1>%s</h1>\n    <p class="lead">%s</p>\n  </header>\n  <main class="wrap">\n' "$2" "$3"
}
page_foot() {
  printf '  </main>\n  <footer class="wrap">&copy; 2026 t-bk.de &middot; <a href="/impressum.html">Impressum</a> &middot; <a href="/datenschutz.html">Datenschutz</a></footer>\n<script src="/assets/back-nav.js" data-ziel="/" data-text="Startseite"></script>\n</body>\n</html>\n'
}

# Titel einer HTML-Datei roh auslesen (vertraegt '<' im Titel).
# Mehrfach-Leerzeichen werden zusammengezogen, damit ein vertippter Titel
# ("Messmittel  - Messuhr") die Gruppierung nicht aushebelt.
raw_title() {  # $1 = datei
  local raw
  raw=$(grep -iom1 '<title>.*</title>' "$1" || true)
  printf '%s' "$raw" \
    | sed -E 's|.*<title>(.*)</title>.*|\1|I' \
    | sed -E 's/[[:space:]]+/ /g; s/^ //; s/ $//'
}

# Text fuer die HTML-Ausgabe maskieren.
esc_html() { sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g'; }

# Titel einer HTML-Datei auslesen, HTML-maskiert.
html_title() {  # $1 = datei
  raw_title "$1" | esc_html
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
if [ -d "$LERN_DIR/.git" ];  then if [ -n "$(repo_advanced "$LERN_DIR" main)" ];    then changed=1; fi; fi
if [ -d "$VALIS_DIR/.git" ]; then if [ -n "$(repo_advanced "$VALIS_DIR" main)" ];   then changed=1; fi; fi
if [ -d "$EPLAN_DIR/.git" ]; then if [ -n "$(repo_advanced "$EPLAN_DIR" master)" ]; then changed=1; fi; fi

# Bootstrap: fehlt eine Zielseite, trotzdem deployen.
if [ ! -f "${WERKZEUGE}index.html" ]; then changed=1; fi
if [ -d "$LERN_DIR/.git" ] && [ ! -f "${MATERIAL}index.html" ]; then changed=1; fi
if [ -d "$VALIS_DIR/.git" ] && [ ! -f "${PROJEKTE}valis/index.html" ]; then changed=1; fi
if [ -d "$EPLAN_DIR/.git" ] && [ ! -f "${PROJEKTE}e-plan/index.html" ]; then changed=1; fi
if [ "$changed" -eq 0 ]; then exit 0; fi

# --- 1) Hauptseite -> DocumentRoot (Bereiche + ACME schuetzen) ---
rsync -a --delete --exclude='.well-known/' --exclude='werkzeuge/' --exclude='unterrichtsmaterial/' --exclude='projekte/' "$SITE_DIR/public/" "$DOCROOT"

# --- 2) Werkzeuge -> /werkzeuge/ ---
# Wie beim Unterrichtsmaterial gibt es hier nichts mehr zu generieren: das
# Repo nutzt kein Jekyll mehr, seine index.html erzeugt dort build/build.mjs
# und committet sie mit - dieselbe Datei liefert auch GitHub Pages aus.
# Ruecklink und Umschalter stecken schon als <script> in den Werkzeugen.
# Kopiert wird nur tools/ und die Uebersicht; Notizen und Vorlagen aus dem
# Repo-Wurzelverzeichnis bleiben aussen vor.
if [ -d "$MAT_DIR/.git" ]; then
  mkdir -p "${WERKZEUGE}tools"
  rsync -a --delete "$MAT_DIR/tools/" "${WERKZEUGE}tools/"
  cp "$MAT_DIR/index.html" "${WERKZEUGE}index.html"
fi

# --- 3) Unterrichtsmaterial -> /unterrichtsmaterial/ ---
# Hier gibt es nichts zu generieren: das Repo nutzt bewusst kein Jekyll, seine
# index.html wird dort von build/build.mjs erzeugt und mitcommittet - dieselbe
# Datei liefert auch GitHub Pages aus. Auch der Ruecklink steckt schon als
# <script src="../assets/back-nav.js"> in den Seiten. Also nur kopieren und
# weglassen, was im Web nichts zu suchen hat.
if [ -d "$LERN_DIR/.git" ]; then
  mkdir -p "$MATERIAL"
  rsync -a --delete \
    --exclude='.git/' --exclude='.github/' --exclude='.claude/' \
    --exclude='build/' --exclude='vorlagen/' \
    --exclude='README.md' --exclude='DEPLOYMENT.md' --exclude='package.json' \
    "$LERN_DIR/" "$MATERIAL"
fi

# --- 4) Projekte -> /projekte/<name>/ (+ Uebersicht) ---
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

echo "$(date '+%F %T') deployed site=$(rev "$SITE_DIR") werkzeuge=$(rev "$MAT_DIR") material=$(rev "$LERN_DIR") valis=$(rev "$VALIS_DIR") eplan=$(rev "$EPLAN_DIR")"
