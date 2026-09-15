/*
 * t-bk.de Feedback-Widget (trackingfrei, ohne Abhaengigkeiten).
 *
 * Einbinden:
 *   <script src="/api/feedback-widget.js" defer></script>
 * und dort, wo der Feedback-Button erscheinen soll:
 *   <div data-tbk-feedback></div>
 *
 * Optional pro Marker:
 *   data-title="Anzeigename des Inhalts"   (Default: document.title)
 *   data-path="/pfad/zum/inhalt"           (Default: location.pathname)
 *
 * Es werden KEINE personenbezogenen Daten abgefragt (kein Name). Abgesendet
 * werden: Rolle, Kategorie, optionaler Text, Pfad, Titel.
 */
(function () {
  "use strict";
  var API = (window.TBK_FEEDBACK_API || "/api/feedback.php");

  var ROLES = [
    ["schueler", "Schüler:in"],
    ["lehrkraft", "Lehrkraft"]
  ];
  var CATS = [
    ["lob", "Lob"],
    ["fehler", "Fehler / etwas stimmt nicht"],
    ["verstaendnis", "Verständnisproblem"],
    ["vorschlag", "Vorschlag / Idee"],
    ["sonstiges", "Sonstiges"]
  ];

  function injectCSS() {
    if (document.getElementById("tbkfb-style")) return;
    var s = document.createElement("style");
    s.id = "tbkfb-style";
    s.textContent = [
      ".tbkfb{--tbkfb-accent:#2b6cb0;font:14px/1.5 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:16px 0}",
      "@media (prefers-color-scheme:dark){.tbkfb{--tbkfb-accent:#5b9bd5}}",
      ".tbkfb-btn{display:inline-flex;align-items:center;gap:.4em;background:transparent;color:var(--tbkfb-accent);border:1px solid currentColor;border-radius:8px;padding:7px 14px;font:inherit;font-weight:600;cursor:pointer}",
      ".tbkfb-btn:hover{background:color-mix(in srgb,var(--tbkfb-accent) 12%,transparent)}",
      ".tbkfb-panel{margin-top:10px;padding:16px;border:1px solid rgba(128,128,128,.35);border-radius:10px;max-width:520px;background:color-mix(in srgb,canvas 100%,transparent)}",
      ".tbkfb-panel[hidden]{display:none}",
      ".tbkfb-row{margin:10px 0}",
      ".tbkfb-row label{display:block;font-weight:600;margin-bottom:4px}",
      ".tbkfb select,.tbkfb textarea{width:100%;font:inherit;padding:8px;border:1px solid rgba(128,128,128,.5);border-radius:6px;background:transparent;color:inherit;box-sizing:border-box}",
      ".tbkfb textarea{min-height:80px;resize:vertical}",
      ".tbkfb-roles{display:flex;gap:16px;flex-wrap:wrap}",
      ".tbkfb-roles label{font-weight:400;display:inline-flex;align-items:center;gap:.4em}",
      ".tbkfb-hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}",
      ".tbkfb-actions{display:flex;gap:10px;align-items:center;margin-top:12px}",
      ".tbkfb-send{background:var(--tbkfb-accent);color:#fff;border:none;border-radius:8px;padding:8px 16px;font:inherit;font-weight:600;cursor:pointer}",
      ".tbkfb-send:disabled{opacity:.5;cursor:default}",
      ".tbkfb-cancel{background:none;border:none;color:inherit;opacity:.7;cursor:pointer;font:inherit;text-decoration:underline}",
      ".tbkfb-msg{margin-top:10px;font-weight:600}",
      ".tbkfb-ok{color:#2e7d32}@media (prefers-color-scheme:dark){.tbkfb-ok{color:#81c784}}",
      ".tbkfb-err{color:#c62828}@media (prefers-color-scheme:dark){.tbkfb-err{color:#ef9a9a}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    (kids || []).forEach(function (k) { e.appendChild(typeof k === "string" ? document.createTextNode(k) : k); });
    return e;
  }

  function build(mount) {
    var title = mount.getAttribute("data-title") || document.title || "";
    var path = mount.getAttribute("data-path") || location.pathname || "";

    var wrap = el("div", { "class": "tbkfb" });
    var btn = el("button", { "class": "tbkfb-btn", type: "button" }, ["💬 Feedback geben"]);
    var panel = el("div", { "class": "tbkfb-panel", hidden: "" });

    // Rolle
    var roleRow = el("div", { "class": "tbkfb-row" }, [el("label", {}, ["Ich bin …"])]);
    var roles = el("div", { "class": "tbkfb-roles" });
    ROLES.forEach(function (r, i) {
      var id = "tbkfb-role-" + r[0] + "-" + Math.random().toString(36).slice(2, 7);
      var input = el("input", { type: "radio", name: "tbkfb-role-" + path, id: id, value: r[0] });
      if (i === 0) input.checked = true;
      roles.appendChild(el("label", { "for": id }, [input, r[1]]));
    });
    roleRow.appendChild(roles);

    // Kategorie
    var sel = el("select", { "class": "tbkfb-cat" });
    CATS.forEach(function (c) { sel.appendChild(el("option", { value: c[0] }, [c[1]])); });
    var catRow = el("div", { "class": "tbkfb-row" }, [el("label", {}, ["Worum geht es?"]), sel]);

    // Freitext
    var ta = el("textarea", { "class": "tbkfb-text", placeholder: "Optional: Was genau? (kein Name nötig)" });
    var txtRow = el("div", { "class": "tbkfb-row" }, [el("label", {}, ["Dein Feedback (optional)"]), ta]);

    // Honeypot
    var hp = el("input", { type: "text", "class": "tbkfb-hp", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });

    // Aktionen
    var send = el("button", { "class": "tbkfb-send", type: "button" }, ["Absenden"]);
    var cancel = el("button", { "class": "tbkfb-cancel", type: "button" }, ["Abbrechen"]);
    var msg = el("div", { "class": "tbkfb-msg" });
    var actions = el("div", { "class": "tbkfb-actions" }, [send, cancel]);

    panel.appendChild(roleRow);
    panel.appendChild(catRow);
    panel.appendChild(txtRow);
    panel.appendChild(hp);
    panel.appendChild(actions);
    panel.appendChild(msg);
    wrap.appendChild(btn);
    wrap.appendChild(panel);
    mount.appendChild(wrap);

    var tokenData = null;

    btn.addEventListener("click", function () {
      var open = !panel.hidden;
      panel.hidden = open;
      if (!open && !tokenData) {
        // Token beim Oeffnen holen (Zeitfalle laeuft ab hier)
        fetch(API + "?action=token", { headers: { "Accept": "application/json" } })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d && d.token) tokenData = d; })
          .catch(function () {});
      }
    });
    cancel.addEventListener("click", function () { panel.hidden = true; });

    send.addEventListener("click", function () {
      msg.textContent = "";
      msg.className = "tbkfb-msg";
      if (!tokenData) { msg.textContent = "Bitte kurz warten und erneut versuchen."; msg.className = "tbkfb-msg tbkfb-err"; return; }
      var role = (panel.querySelector('input[name="tbkfb-role-' + path + '"]:checked') || {}).value || "";
      var body = new URLSearchParams();
      body.set("ts", tokenData.ts);
      body.set("token", tokenData.token);
      body.set("hp", hp.value);
      body.set("role", role);
      body.set("category", sel.value);
      body.set("message", ta.value);
      body.set("path", path);
      body.set("title", title);
      send.disabled = true;
      fetch(API, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() })
        .then(function (r) { return r.json().catch(function () { return { ok: r.ok }; }); })
        .then(function (d) {
          if (d && d.ok) {
            roleRow.style.display = catRow.style.display = txtRow.style.display = actions.style.display = "none";
            msg.textContent = "Danke für dein Feedback!";
            msg.className = "tbkfb-msg tbkfb-ok";
          } else {
            msg.textContent = "Konnte nicht gesendet werden. Bitte später erneut versuchen.";
            msg.className = "tbkfb-msg tbkfb-err";
            send.disabled = false;
            tokenData = null; // frisches Token beim naechsten Versuch
          }
        })
        .catch(function () {
          msg.textContent = "Netzwerkfehler. Bitte später erneut versuchen.";
          msg.className = "tbkfb-msg tbkfb-err";
          send.disabled = false;
        });
    });
  }

  function init() {
    var mounts = document.querySelectorAll("[data-tbk-feedback]");
    if (!mounts.length) return;
    injectCSS();
    mounts.forEach(build);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
