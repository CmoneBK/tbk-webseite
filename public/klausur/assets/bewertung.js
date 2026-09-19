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
     und gibt {punkte, max, hinweis} zurück. */

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

  /* Eine ganze Abgabe bewerten. */
  function abgabe(fragen, loesung, antworten, verfahrenName) {
    var v = VERFAHREN[verfahrenName] || VERFAHREN.teilpunkte;
    var zeilen = [], summe = 0, maxSumme = 0;

    fragen.forEach(function (frage, i) {
      var richtig = (loesung[i] || []).slice().sort();
      var gewaehlt = ((antworten && antworten[i]) || []).slice().sort();
      var e = v.punkte(frage, richtig, gewaehlt);
      summe += e.punkte;
      maxSumme += e.max;
      zeilen.push({
        nr: i + 1,
        text: frage.text,
        anzahl: frage.anzahl,
        richtig: richtig,
        gewaehlt: gewaehlt,
        punkte: e.punkte,
        max: e.max,
        hinweis: e.hinweis
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

  /* Die Optionen einer Aufgabe als Buchstaben - a, b, c ... So steht es
     auch auf dem Bildschirm des Teilnehmers, und so lässt es sich in der
     Tabelle lesen. */
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
