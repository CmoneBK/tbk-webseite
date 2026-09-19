/* Wie aus Kreuzen Punkte werden.
 *
 * Läuft ausschließlich im Browser der Lehrkraft, beim Herunterladen der
 * Ergebnisse. Der Server kennt den Lösungsschlüssel nicht und rechnet
 * nichts aus - er könnte es gar nicht.
 *
 * Es gibt mehrere Verfahren, weil es mehrere vertretbare gibt. Die Wahl
 * gehört zur Klausur und wird mit ihr gespeichert (verschlüsselt, im
 * Lösungsschlüssel), damit später nachvollziehbar ist, wonach bewertet
 * wurde.
 *
 * MISCHEN UND TEILMENGE. Bekommt jede Teilnehmerin eine andere Reihenfolge
 * oder nur eine zufällige Auswahl der Aufgaben, dann trägt ihr Umschlag die
 * Zuordnung selbst mit sich: "gezeigte Aufgabe 1 war Aufgabe 3, gezeigte
 * Antwort b war Antwort d". Diese Zuordnung (`auswahl`) steckt im
 * verschlüsselten Umschlag - der Server sieht sie nicht -, und hier wird
 * damit auf die feste Reihenfolge des Lösungsschlüssels zurückgerechnet.
 *
 * PUNKTE, KEINE NOTEN. Eine automatisch erzeugte Note, die ungeprüft
 * übernommen wird, rückt in die Nähe von Art. 22 DSGVO. Aus Punkten macht
 * die Lehrkraft eine Note, nicht dieses Werkzeug.
 */
(function (global) {
  'use strict';

  /* Jedes Verfahren bekommt:
       frage   {text, optionen[], anzahl}      - anzahl = wie viele stimmen
       richtig [Indizes]                       - aus dem Lösungsschlüssel
       gewaehlt[Indizes]                       - was angekreuzt wurde
     Alle Indizes beziehen sich auf die feste Reihenfolge des
     Lösungsschlüssels, nicht auf das, was der Teilnehmer gesehen hat -
     zurückgerechnet wird vorher. Gibt {punkte, max, hinweis} zurück. */

  var VERFAHREN = {

    /* Das Verfahren, mit dem angefangen wird.
       - Bei jeder Aufgabe steht, wie viele Antworten stimmen.
       - Wer mehr ankreuzt, bekommt nichts. Die Oberfläche lässt es gar
         nicht erst zu; hier steht die Regel trotzdem, denn was über die
         Leitung kommt, muss man nicht glauben.
       - Jede richtig angekreuzte Antwort gibt einen Teilpunkt. */
    teilpunkte: {
      name: 'Teilpunkte, Überkreuzen gibt null',
      beschreibung: 'Bei jeder Aufgabe steht, wie viele Antworten stimmen. '
        + 'Jede richtig angekreuzte gibt einen Punkt. Wer mehr ankreuzt als '
        + 'angegeben, bekommt für die Aufgabe keine Punkte.',
      punkte: function (frage, richtig, gewaehlt) {
        /* Die Hoechstpunktzahl steht im Loesungsschluessel, nicht in der
           Angabe. Beides SOLL gleich sein - die Zusammenstellung laesst
           nichts anderes zu -, aber was hier ankommt, ist durch einen
           Server gelaufen, der den Schluessel nicht kennt und deshalb auch
           nicht pruefen konnte. Im Zweifel gilt der Schluessel, und der
           Widerspruch wird gemeldet statt verschwiegen. */
        var max = richtig.length;
        var krumm = frage.anzahl !== richtig.length
          ? 'Angabe und Lösung widersprechen sich' : '';
        if (gewaehlt.length > frage.anzahl) {
          return { punkte: 0, max: max, hinweis: 'zu viele Kreuze' };
        }
        var treffer = gewaehlt.filter(function (i) {
          return richtig.indexOf(i) !== -1;
        }).length;
        return { punkte: treffer, max: max, hinweis: krumm };
      }
    },

    /* Zum Vergleich und für Aufgaben, bei denen Halbwissen nichts nützt:
       entweder der ganze Satz stimmt oder gar nichts. */
    alles_oder_nichts: {
      name: 'Alles oder nichts',
      beschreibung: 'Die Aufgabe zählt nur, wenn genau die richtigen '
        + 'Antworten angekreuzt sind - kein Teilpunkt.',
      punkte: function (frage, richtig, gewaehlt) {
        var max = 1;
        if (gewaehlt.length !== richtig.length) {
          return { punkte: 0, max: max, hinweis: 'Anzahl passt nicht' };
        }
        var alle = richtig.every(function (i) { return gewaehlt.indexOf(i) !== -1; });
        return { punkte: alle ? 1 : 0, max: max, hinweis: '' };
      }
    }
  };

  function sortiert(a) {
    return (a || []).slice().sort(function (x, y) { return x - y; });
  }

  /* Aus dem, was der Teilnehmer angekreuzt hat, die Indizes in der festen
     Reihenfolge des Loesungsschluessels machen. Ohne `auswahl` (keine
     Mischung, keine Teilmenge) war die gezeigte Reihenfolge schon die feste:
     dann ist jede gezeigte Aufgabe i die Aufgabe i, und jede Option die
     Option. */
  function abbilden(aufgaben, antworten, auswahl) {
    if (auswahl && Array.isArray(auswahl.fragen) && Array.isArray(auswahl.optionen)) {
      return auswahl.fragen.map(function (q, p) {
        var karte = auswahl.optionen[p] || [];
        var roh = (antworten && antworten[p]) || [];
        var gewaehlt = roh.map(function (pos) { return karte[pos]; })
          .filter(function (x) { return typeof x === 'number'; });
        return { nr: p + 1, q: q, gewaehlt: gewaehlt };
      });
    }
    return aufgaben.map(function (_, q) {
      return { nr: q + 1, q: q, gewaehlt: (antworten && antworten[q]) || [] };
    });
  }

  /* Eine ganze Abgabe bewerten.
       aufgaben  [{text, optionen[], anzahl}]  - feste Reihenfolge
       richtig   [[Indizes], ...]              - Loesungsschluessel, feste Reihenfolge
       antworten [[Positionen], ...]           - wie der Teilnehmer sie gesehen hat
       auswahl   {fragen[], optionen[][]}       - optional, seine Zuordnung */
  function abgabe(aufgaben, richtig, antworten, verfahrenName, auswahl) {
    var v = VERFAHREN[verfahrenName] || VERFAHREN.teilpunkte;
    var zeilen = [], summe = 0, maxSumme = 0;

    abbilden(aufgaben, antworten, auswahl).forEach(function (e) {
      var frage = aufgaben[e.q];
      if (!frage) { return; }
      var rich = sortiert(richtig[e.q]);
      var gewaehlt = sortiert(e.gewaehlt);
      var r = v.punkte(frage, rich, gewaehlt);
      summe += r.punkte;
      maxSumme += r.max;
      zeilen.push({
        nr: e.nr,
        text: frage.text,
        anzahl: frage.anzahl,
        richtig: rich,
        gewaehlt: gewaehlt,
        punkte: r.punkte,
        max: r.max,
        hinweis: r.hinweis
      });
    });

    return {
      verfahren: v.name,
      punkte: summe,
      max: maxSumme,
      anteil: maxSumme ? summe / maxSumme : 0,
      zeilen: zeilen
    };
  }

  /* Die Optionen einer Aufgabe als Buchstaben - a, b, c ... Diese Buchstaben
     beziehen sich auf die feste Reihenfolge des Loesungsschluessels; hatte
     der Teilnehmer die Antworten gemischt, sah er andere Buchstaben. Fuer die
     Auswertung ist die feste Reihenfolge die verlaessliche. */
  function buchstaben(indizes) {
    return indizes.map(function (i) {
      return String.fromCharCode(97 + i);
    }).join(' ');
  }

  global.Bewertung = {
    VERFAHREN: VERFAHREN,
    abgabe: abgabe,
    buchstaben: buchstaben
  };
}(window));
