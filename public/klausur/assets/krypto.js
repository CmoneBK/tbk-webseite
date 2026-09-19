/* Die Schlüssel des Klausurbereichs.
 *
 * Der Gedanke in einem Satz: Der Server ist ein Briefkasten. Er nimmt
 * Umschläge an und gibt sie zurück, aber er hat keinen Schlüssel dazu.
 *
 * Daraus folgt alles Weitere:
 *
 *   - Die Lehrkraft hat ein Schlüsselpaar. Der öffentliche Teil liegt beim
 *     Server, damit die Browser der Teilnehmer damit verschlüsseln können.
 *     Der private Teil liegt dort nur VERPACKT - geöffnet wird er mit der
 *     Passphrase, und die kennt der Server nicht.
 *
 *   - Aus der Passphrase entstehen ZWEI getrennte Dinge: ein Wert für die
 *     Anmeldung, der zum Server geht, und ein Schlüssel zum Auspacken, der
 *     den Browser nie verlässt. Aus dem einen folgt nicht das andere.
 *
 *   - Eine vergessene Passphrase ist das Ende. Es gibt keine
 *     Wiederherstellung, weil es keine geben kann. Wer eine einbaut, baut
 *     eine Hintertür ein.
 *
 * Vertrag: docs/KLAUSUR-API.md, Abschnitt 3.
 */
(function (global) {
  'use strict';

  var C = global.crypto && global.crypto.subtle;

  /* PBKDF2 ist absichtlich langsam. 600 000 Runden brauchen auf einem
     Tablet gut eine Sekunde - genau das soll jemand spüren, der eine
     Passphrase durchprobiert. */
  var RUNDEN = 600000;

  /* ---------- Bytes und Text ---------- */

  function ausB64(s) {
    var roh = atob(s), a = new Uint8Array(roh.length);
    for (var i = 0; i < roh.length; i++) { a[i] = roh.charCodeAt(i); }
    return a;
  }

  function nachB64(puffer) {
    var a = new Uint8Array(puffer), s = '';
    /* In Häppchen, sonst sprengt ein großes Chiffrat den Aufrufstapel. */
    for (var i = 0; i < a.length; i += 8192) {
      s += String.fromCharCode.apply(null, a.subarray(i, i + 8192));
    }
    return btoa(s);
  }

  var enc = new TextEncoder();
  var dec = new TextDecoder();

  function zufall(n) {
    var a = new Uint8Array(n);
    global.crypto.getRandomValues(a);
    return a;
  }

  /* ---------- Aus der Passphrase ---------- */

  /* Zwei Ableitungen aus demselben Geheimnis, mit verschiedenem Zweck im
     Info-Feld. Wer den einen Wert kennt, kommt nicht an den anderen: Beide
     sind Einwegfunktionen aus der Passphrase, und der Server sieht nur den
     ersten. */
  async function ableiten(passphrase, salt) {
    var roh = await C.importKey('raw', enc.encode(passphrase), 'PBKDF2',
      false, ['deriveBits']);
    var bits = await C.deriveBits(
      { name: 'PBKDF2', salt: salt, iterations: RUNDEN, hash: 'SHA-256' },
      roh, 512);
    var halb = new Uint8Array(bits);
    var authRoh = halb.slice(0, 32);
    var wrapRoh = halb.slice(32, 64);
    var wrapKey = await C.importKey('raw', wrapRoh, 'AES-GCM', false,
      ['encrypt', 'decrypt']);
    return { auth: nachB64(authRoh), wrapKey: wrapKey };
  }

  /* ---------- Umschläge ----------
     Ein Umschlag ist immer {v, iv, daten} und, wenn er an einen öffentlichen
     Schlüssel gerichtet ist, zusätzlich {schluessel}. Der Server prüft nur,
     dass die Felder da sind - lesen kann er nichts. */

  async function zuMachen(key, objekt) {
    var iv = zufall(12);
    var klar = enc.encode(JSON.stringify(objekt));
    var chiffre = await C.encrypt({ name: 'AES-GCM', iv: iv }, key, klar);
    return JSON.stringify({ v: 1, iv: nachB64(iv), daten: nachB64(chiffre) });
  }

  async function aufMachen(key, text) {
    var u = JSON.parse(text);
    var klar = await C.decrypt({ name: 'AES-GCM', iv: ausB64(u.iv) }, key,
      ausB64(u.daten));
    return JSON.parse(dec.decode(klar));
  }

  /* ---------- Das Schlüsselpaar ---------- */

  async function paarErzeugen() {
    return C.generateKey({
      name: 'RSA-OAEP',
      modulusLength: 3072,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    }, true, ['encrypt', 'decrypt']);
  }

  async function oeffExportieren(paar) {
    return nachB64(await C.exportKey('spki', paar.publicKey));
  }

  async function oeffImportieren(b64) {
    return C.importKey('spki', ausB64(b64),
      { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  }

  async function privVerpacken(paar, wrapKey) {
    var roh = await C.exportKey('pkcs8', paar.privateKey);
    var iv = zufall(12);
    var chiffre = await C.encrypt({ name: 'AES-GCM', iv: iv }, wrapKey, roh);
    return JSON.stringify({ v: 1, iv: nachB64(iv), daten: nachB64(chiffre) });
  }

  async function privAuspacken(text, wrapKey) {
    var u = JSON.parse(text);
    var roh = await C.decrypt({ name: 'AES-GCM', iv: ausB64(u.iv) }, wrapKey,
      ausB64(u.daten));
    return C.importKey('pkcs8', roh, { name: 'RSA-OAEP', hash: 'SHA-256' },
      true, ['decrypt']);
  }

  /* ---------- Hybrid: an den öffentlichen Schlüssel ----------
     RSA verschlüsselt nur wenige hundert Byte. Deshalb: ein frischer
     AES-Schlüssel je Umschlag, der Inhalt damit, und der AES-Schlüssel mit
     RSA. Das ist der übliche Weg und kein Kunstgriff. */

  async function anOeffentlich(oeffB64, objekt) {
    var oeff = await oeffImportieren(oeffB64);
    var sitzung = await C.generateKey({ name: 'AES-GCM', length: 256 }, true,
      ['encrypt']);
    var iv = zufall(12);
    var klar = enc.encode(JSON.stringify(objekt));
    var daten = await C.encrypt({ name: 'AES-GCM', iv: iv }, sitzung, klar);
    var roh = await C.exportKey('raw', sitzung);
    var verpackt = await C.encrypt({ name: 'RSA-OAEP' }, oeff, roh);
    return JSON.stringify({
      v: 1, iv: nachB64(iv), daten: nachB64(daten),
      schluessel: nachB64(verpackt)
    });
  }

  async function mitPrivat(privKey, text) {
    var u = JSON.parse(text);
    var roh = await C.decrypt({ name: 'RSA-OAEP' }, privKey,
      ausB64(u.schluessel));
    var sitzung = await C.importKey('raw', roh, 'AES-GCM', false, ['decrypt']);
    var klar = await C.decrypt({ name: 'AES-GCM', iv: ausB64(u.iv) }, sitzung,
      ausB64(u.daten));
    return JSON.parse(dec.decode(klar));
  }

  /* ---------- Wie gut ist die Passphrase? ----------
     Keine Vorschrift mit Sonderzeichen und Großbuchstaben - die erzeugt
     "Klausur2026!" und sonst nichts. Gezählt wird, wie viel Raum sie
     aufspannt; vier zufällige Wörter schlagen jedes Muster. */
  function staerke(p) {
    if (!p) { return { bits: 0, urteil: 'leer' }; }
    var arten = 0;
    if (/[a-zäöüß]/.test(p)) { arten += 26; }
    if (/[A-ZÄÖÜ]/.test(p)) { arten += 26; }
    if (/\d/.test(p)) { arten += 10; }
    if (/[^\wäöüßÄÖÜ]/.test(p)) { arten += 20; }
    var bits = Math.round(p.length * Math.log2(arten || 1));
    var urteil = bits < 60 ? 'zu schwach'
      : bits < 80 ? 'brauchbar' : 'gut';
    return { bits: bits, urteil: urteil };
  }

  global.Krypto = {
    RUNDEN: RUNDEN,
    ausB64: ausB64,
    nachB64: nachB64,
    zufall: zufall,
    ableiten: ableiten,
    zuMachen: zuMachen,
    aufMachen: aufMachen,
    paarErzeugen: paarErzeugen,
    oeffExportieren: oeffExportieren,
    oeffImportieren: oeffImportieren,
    privVerpacken: privVerpacken,
    privAuspacken: privAuspacken,
    anOeffentlich: anOeffentlich,
    mitPrivat: mitPrivat,
    staerke: staerke,
    verfuegbar: !!C
  };
}(window));
