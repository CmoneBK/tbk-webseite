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

# Ruecklink zur Werkzeug-Uebersicht in ein Tool einfuegen.
# Quelle ist das Material-Repo (_includes/back-nav.html) - dieselbe Datei nutzt
# dort _layouts/tool.html fuer die GitHub-Pages-Ausgabe, damit beide Wege
# identisch aussehen und nur an einer Stelle gepflegt werden.
BACK_NAV="$MAT_DIR/_includes/back-nav.html"
inject_back() {  # $1 = datei
  local f="$1"
  [ -f "$BACK_NAV" ] || return 0
  grep -q 'id="tbk-back"' "$f" && return 0
  awk -v nav="$BACK_NAV" '
    /<\/body>/ { while ((getline l < nav) > 0) print l; close(nav) }
    { print }
  ' "$f" > "$f.tmp" && mv "$f.tmp" "$f"
}

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
  .bereich{font-size:21px;font-weight:700;letter-spacing:-.3px;margin:42px 0 0;padding-top:26px;border-top:1px solid var(--border);}
  .bereich:first-of-type{border-top:0;padding-top:6px;margin-top:18px}
  .cat{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:26px 0 0;}
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

# Titel "Bereich: Unterkategorie - Name" zerlegen.
# Ausgabe: Bereich TAB Unterkategorie TAB Name (Unterkategorie ggf. leer).
# Getrennt wird am " - " MIT Leerzeichen, damit Bindestriche im Text
# ("Form- und Lagetoleranzen", "Wellen-CAD-Software", "Vorschub <-> Rautiefe")
# nicht faelschlich als Trenner gelten.
split_title() {  # $1 = titel
  printf '%s' "$1" | awk '
    {
      t=$0
      i=index(t,":")
      if(i>0){ b=substr(t,1,i-1); r=substr(t,i+1) } else { b="Allgemein"; r=t }
      sub(/^ +/,"",b); sub(/ +$/,"",b)
      sub(/^ +/,"",r); sub(/ +$/,"",r)
      j=index(r," - ")
      if(j>0){ u=substr(r,1,j-1); n=substr(r,j+3) } else { u=""; n=r }
      sub(/ +$/,"",u); sub(/^ +/,"",n)
      printf "%s\t%s\t%s", b, u, n
    }'
}

# --- /werkzeuge/ : Tools nach Bereich und Unterkategorie ---
# Gruppiert wird nach der Titel-Konvention "Bereich: Unterkategorie - Name".
# Die Reihenfolge kommt aus _data/kategorien.csv im Material-Repo - dieselbe
# Datei liest dort index.html fuer die GitHub-Pages-Uebersicht, damit beide
# Seiten identisch sortieren. Nicht gelistete Bereiche bzw. Unterkategorien
# werden alphabetisch angehaengt; ein neues Werkzeug erscheint also auch
# ganz ohne Pflege der CSV.
KAT_CSV="$MAT_DIR/_data/kategorien.csv"

kat_csv_rows() {  # Kopfzeile, CR und Leerzeilen entfernen
  [ -f "$KAT_CSV" ] || return 0
  tail -n +2 "$KAT_CSV" | tr -d '\r' | awk 'NF'
}

emit_grid() {  # $1 = Zeilen "bereich TAB unter TAB name TAB datei"
  [ -n "$1" ] || return 0
  local line gn gfile
  printf '    <div class="grid">\n'
  printf '%s\n' "$1" | while IFS= read -r line; do
    [ -n "$line" ] || continue
    # Bewusst cut statt "IFS=$'\t' read": bash zaehlt TAB zum IFS-Whitespace
    # und wuerde die leere Unterkategorie-Spalte verschlucken - die Felder
    # verrutschen dann genau bei Werkzeugen ohne Unterkategorie.
    gn=$(printf '%s' "$line" | cut -f3)
    gfile=$(printf '%s' "$line" | cut -f4)
    [ -n "$gfile" ] || continue
    printf '      <a class="card" href="tools/%s"><span>%s</span></a>\n' \
      "$gfile" "$(printf '%s' "$gn" | esc_html)"
  done
  printf '    </div>\n'
}

gen_werkzeuge() {
  page_head "Werkzeuge &middot; t-bk.de" "Werkzeuge" "Interaktive Web-Tools und Simulationen f&uuml;r den technischen Unterricht."
  local rows f base t b u bereiche kats block
  rows=$(mktemp)
  for f in "${WERKZEUGE}tools/"*.html; do
    [ -e "$f" ] || continue
    base=$(basename "$f")
    t=$(raw_title "$f")
    [ -n "$t" ] || t=$(printf '%s' "${base%.html}" | sed 's/-/ /g')
    printf '%s\t%s\n' "$(split_title "$t")" "$base" >> "$rows"
  done

  bereiche=$( { kat_csv_rows | cut -d, -f1; cut -f1 "$rows" | sort; } | awk 'NF && !seen[$0]++' )

  while IFS= read -r b; do
    [ -n "$b" ] || continue
    awk -F'\t' -v b="$b" '$1==b{c=1} END{exit !c}' "$rows" || continue
    printf '    <h2 class="bereich">%s</h2>\n' "$(printf '%s' "$b" | esc_html)"

    # a) Werkzeuge ohne Unterkategorie stehen direkt unter dem Bereich
    emit_grid "$(awk -F'\t' -v b="$b" '$1==b && $2==""' "$rows" | sort -t$'\t' -k3,3)"

    # b) danach je Unterkategorie ein eigener Block
    kats=$( { kat_csv_rows | awk -F, -v b="$b" '$1==b{print $2}'
              awk -F'\t' -v b="$b" '$1==b && $2!=""{print $2}' "$rows" | sort; } \
            | awk 'NF && !seen[$0]++' )
    while IFS= read -r u; do
      [ -n "$u" ] || continue
      block=$(awk -F'\t' -v b="$b" -v u="$u" '$1==b && $2==u' "$rows" | sort -t$'\t' -k3,3)
      [ -n "$block" ] || continue
      printf '    <h3 class="cat">%s</h3>\n' "$(printf '%s' "$u" | esc_html)"
      emit_grid "$block"
    done <<KATS
$kats
KATS
  done <<BEREICHE
$bereiche
BEREICHE

  rm -f "$rows"
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
    inject_back "$f"
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
