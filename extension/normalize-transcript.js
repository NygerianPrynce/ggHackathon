/**
 * Voice transcripts often spell numbers as words — normalize to digits for forms.
 * Safe for extension background + side panel (plain script, no imports).
 */
(function () {
  "use strict";

  var ORDINALS = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
    eleventh: 11,
    twelfth: 12,
    thirteenth: 13,
    fourteenth: 14,
    fifteenth: 15,
    sixteenth: 16,
    seventeenth: 17,
    eighteenth: 18,
    nineteenth: 19,
    twentieth: 20,
    thirtieth: 30,
    fortieth: 40,
  };

  var ONES = {
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
  };

  var TENS = {
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
  };

  function wordToNum(w) {
    if (!w) return null;
    var k = String(w).toLowerCase();
    if (ONES.hasOwnProperty(k)) return ONES[k];
    if (TENS.hasOwnProperty(k)) return TENS[k];
    return null;
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function normalizeSpokenNumbersToDigits(text) {
    if (text == null || typeof text !== "string") return text;
    var s = text.replace(/\s+/g, " ").trim();
    if (!s) return s;

    var t;
    var k;
    var a;
    var b;

    /* Ordinals: "third" → 3, "first" → 1, etc. */
    for (k in ORDINALS) {
      if (!Object.prototype.hasOwnProperty.call(ORDINALS, k)) continue;
      s = s.replace(new RegExp("\\b" + k + "\\b", "gi"), String(ORDINALS[k]));
    }

    /* "one oh one" → 101, "two oh five" → 205 */
    s = s.replace(
      /\b(one|two|three|four|five|six|seven|eight|nine)\s+oh\s+(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\b/gi,
      function (_m, w1, w2) {
        a = wordToNum(w1);
        b = wordToNum(w2);
        if (a == null || b == null) return _m;
        return String(a) + "0" + String(b);
      }
    );

    /* Compound tens + ones: "twenty three" → 23 */
    for (t in TENS) {
      if (!Object.prototype.hasOwnProperty.call(TENS, t)) continue;
      for (k in ONES) {
        if (!Object.prototype.hasOwnProperty.call(ONES, k)) continue;
        if (k === "ten" && t !== "twenty") continue;
        var re = new RegExp("\\b" + t + "\\s+" + k + "\\b", "gi");
        s = s.replace(re, String(TENS[t] + ONES[k]));
      }
    }

    /* Lone tens: "twenty" → 20 */
    for (t in TENS) {
      if (!Object.prototype.hasOwnProperty.call(TENS, t)) continue;
      s = s.replace(new RegExp("\\b" + t + "\\b", "gi"), String(TENS[t]));
    }

    /* Remaining 0–19 */
    for (k in ONES) {
      if (!Object.prototype.hasOwnProperty.call(ONES, k)) continue;
      s = s.replace(new RegExp("\\b" + k + "\\b", "gi"), String(ONES[k]));
    }

    return s;
  }

  var g = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : window;
  g.normalizeSpokenNumbersToDigits = normalizeSpokenNumbersToDigits;
})();
