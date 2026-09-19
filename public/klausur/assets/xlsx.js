/* Eine Arbeitsmappe schreiben, ohne fremde Bibliothek.
 *
 * Warum von Hand: Die Seite bindet keine Inhalte von Dritten ein - kein CDN,
 * keine Schriftart, keine Bibliothek. Das gilt hier erst recht, denn in
 * dieser Datei stehen gleich Prüfungsergebnisse. Eine Bibliothek, die man
 * nicht gelesen hat, ist an dieser Stelle keine Bequemlichkeit, sondern ein
 * Mitleser.
 *
 * Eine .xlsx ist ein ZIP mit ein paar XML-Dateien darin. Beides ist
 * überschaubar, solange man auf Komprimierung verzichtet (Methode 0,
 * "gespeichert") und die Texte direkt in die Zellen schreibt statt in eine
 * gemeinsame Zeichenkettentabelle.
 *
 * Erzeugt wird im Browser der Lehrkraft. Der Server sieht diese Datei nie.
 */
(function (global) {
  'use strict';

  var enc = new TextEncoder();

  /* ---------- CRC-32, wie der ZIP-Standard sie will ---------- */
  var TABELLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    return t;
  }());

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = TABELLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  /* ---------- ZIP, Methode "gespeichert" ---------- */

  function zahl16(a, p, v) { a[p] = v & 255; a[p + 1] = (v >>> 8) & 255; }
  function zahl32(a, p, v) {
    a[p] = v & 255; a[p + 1] = (v >>> 8) & 255;
    a[p + 2] = (v >>> 16) & 255; a[p + 3] = (v >>> 24) & 255;
  }

  function zip(dateien) {
    var teile = [], zentral = [], versatz = 0;

    dateien.forEach(function (d) {
      var name = enc.encode(d.name);
      var inhalt = d.inhalt;
      var pruef = crc32(inhalt);

      var kopf = new Uint8Array(30 + name.length);
      zahl32(kopf, 0, 0x04034b50);
      zahl16(kopf, 4, 20);            /* Version */
      zahl16(kopf, 6, 0x0800);        /* Namen sind UTF-8 */
      zahl16(kopf, 8, 0);             /* Methode 0: gespeichert */
      zahl16(kopf, 10, 0); zahl16(kopf, 12, 0);   /* Zeit, Datum: 0 */
      zahl32(kopf, 14, pruef);
      zahl32(kopf, 18, inhalt.length);
      zahl32(kopf, 22, inhalt.length);
      zahl16(kopf, 26, name.length);
      zahl16(kopf, 28, 0);
      kopf.set(name, 30);

      teile.push(kopf, inhalt);

      var z = new Uint8Array(46 + name.length);
      zahl32(z, 0, 0x02014b50);
      zahl16(z, 4, 20); zahl16(z, 6, 20);
      zahl16(z, 8, 0x0800);
      zahl16(z, 10, 0);
      zahl16(z, 12, 0); zahl16(z, 14, 0);
      zahl32(z, 16, pruef);
      zahl32(z, 20, inhalt.length);
      zahl32(z, 24, inhalt.length);
      zahl16(z, 28, name.length);
      zahl16(z, 30, 0); zahl16(z, 32, 0); zahl16(z, 34, 0);
      zahl16(z, 36, 0); zahl32(z, 38, 0);
      zahl32(z, 42, versatz);
      z.set(name, 46);
      zentral.push(z);

      versatz += kopf.length + inhalt.length;
    });

    var zLaenge = zentral.reduce(function (s, z) { return s + z.length; }, 0);
    var ende = new Uint8Array(22);
    zahl32(ende, 0, 0x06054b50);
    zahl16(ende, 8, dateien.length);
    zahl16(ende, 10, dateien.length);
    zahl32(ende, 12, zLaenge);
    zahl32(ende, 16, versatz);

    return new Blob(teile.concat(zentral, [ende]),
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  /* ---------- XML ---------- */

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      /* Steuerzeichen sind in XML 1.0 nicht erlaubt und kommen in
         entschlüsselten Antworten theoretisch vor. */
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  }

  function spalte(i) {
    var s = '';
    i += 1;
    while (i > 0) {
      var r = (i - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  function blattXml(zeilen) {
    var aus = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetData>'];
    zeilen.forEach(function (zeile, z) {
      aus.push('<row r="' + (z + 1) + '">');
      zeile.forEach(function (wert, s) {
        if (wert === null || wert === undefined || wert === '') { return; }
        var ref = spalte(s) + (z + 1);
        if (typeof wert === 'number' && isFinite(wert)) {
          aus.push('<c r="' + ref + '"><v>' + wert + '</v></c>');
        } else {
          aus.push('<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">'
            + esc(wert) + '</t></is></c>');
        }
      });
      aus.push('</row>');
    });
    aus.push('</sheetData></worksheet>');
    return aus.join('');
  }

  /* ---------- Die Mappe ---------- */

  function erzeugen(blaetter) {
    var dateien = [];
    var typen = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'];
    var mappe = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
      + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets>'];
    var bez = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'];

    blaetter.forEach(function (b, i) {
      var n = i + 1;
      dateien.push({
        name: 'xl/worksheets/sheet' + n + '.xml',
        inhalt: enc.encode(blattXml(b.zeilen))
      });
      typen.push('<Override PartName="/xl/worksheets/sheet' + n + '.xml"'
        + ' ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>');
      mappe.push('<sheet name="' + esc(b.name) + '" sheetId="' + n
        + '" r:id="rId' + n + '"/>');
      bez.push('<Relationship Id="rId' + n
        + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"'
        + ' Target="worksheets/sheet' + n + '.xml"/>');
    });

    typen.push('</Types>');
    mappe.push('</sheets></workbook>');
    bez.push('</Relationships>');

    dateien.unshift(
      { name: '[Content_Types].xml', inhalt: enc.encode(typen.join('')) },
      {
        name: '_rels/.rels',
        inhalt: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
          + '<Relationship Id="rId1"'
          + ' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"'
          + ' Target="xl/workbook.xml"/></Relationships>')
      },
      { name: 'xl/workbook.xml', inhalt: enc.encode(mappe.join('')) },
      { name: 'xl/_rels/workbook.xml.rels', inhalt: enc.encode(bez.join('')) }
    );

    return zip(dateien);
  }

  function herunterladen(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  global.Xlsx = {
    erzeugen: erzeugen,
    herunterladen: herunterladen,
    crc32: crc32,
    spalte: spalte,
    blattXml: blattXml
  };
}(window));
