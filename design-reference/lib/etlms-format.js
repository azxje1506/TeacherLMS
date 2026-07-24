/* English Tutor LMS — pure formatting helpers (RC2 + i18n)
 *
 * Presentation-only converters: currency, times, dates and period labels.
 * These read the live regional configuration from ETLMS.i18n.regional (with
 * safe fallbacks if i18n is not loaded) so changing a Settings preference
 * updates every formatted value across the app on the next render.
 */
(function (root) {
  var ETLMS = (root.ETLMS = root.ETLMS || {});
  var C = function () { return ETLMS.constants; };

  var EM = '—'; // em dash — the shared "no value" placeholder

  function reg() { return (ETLMS.i18n && ETLMS.i18n.regional) || { dateFormat: 'DD/MM/YYYY', timeFormat: '24h', currency: 'VND', numberFormat: 'comma' }; }
  function monthsShort() { return (ETLMS.i18n && ETLMS.i18n.months) ? ETLMS.i18n.months('short') : C().MONTHS_SHORT; }
  function monthsFull() { return (ETLMS.i18n && ETLMS.i18n.months) ? ETLMS.i18n.months('full') : C().MONTHS_FULL; }

  /* Group an integer/decimal string per the chosen number format.
   * 'comma' -> 1,234,567.89   'dot' -> 1.234.567,89 */
  function groupNumber(numStr, style) {
    var neg = numStr.charAt(0) === '-'; if (neg) numStr = numStr.slice(1);
    var parts = numStr.split('.'), intp = parts[0], frac = parts[1] || '';
    var gsep = style === 'dot' ? '.' : ',';
    var dsep = style === 'dot' ? ',' : '.';
    intp = intp.replace(/\B(?=(\d{3})+(?!\d))/g, gsep);
    var out = frac ? intp + dsep + frac : intp;
    return (neg ? '-' : '') + out;
  }

  ETLMS.format = {
    /**
     * Format a money amount stored in VND, honouring the currency + number
     * format preferences. VND -> "1,500,000đ"; USD -> "$60.00" (fixed demo rate).
     */
    vnd: function (n) {
      var r = reg();
      var amt = Number(n) || 0;
      if (r.currency === 'USD') {
        var rate = (ETLMS.i18n && ETLMS.i18n.RATE_VND_PER_USD) || 25000;
        var usd = (amt / rate).toFixed(2);
        return '$' + groupNumber(usd, r.numberFormat);
      }
      return groupNumber(String(Math.round(amt)), r.numberFormat) + 'đ';
    },

    /** Grouped integer/decimal per the number-format preference (no currency). */
    number: function (n, decimals) {
      var r = reg();
      var v = decimals != null ? Number(n).toFixed(decimals) : String(Math.round(Number(n) || 0));
      return groupNumber(v, r.numberFormat);
    },

    /**
     * Format a 24h "HH:MM" per the time-format preference.
     * 24h -> "16:30"; 12h -> "4:30 PM". Em dash for malformed input.
     */
    time12: function (hhmm) {
      if (!hhmm) return EM;
      var p = String(hhmm).split(':').map(Number), h = p[0], m = p[1];
      if (!isFinite(h) || !isFinite(m)) return EM;
      if (reg().timeFormat === '24h') {
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      }
      var ap = h < 12 ? 'AM' : 'PM';
      var hh = h % 12; if (hh === 0) hh = 12;
      return hh + ':' + String(m).padStart(2, '0') + ' ' + ap;
    },

    addMinutes: function (hhmm, min) {
      var p = String(hhmm).split(':').map(Number);
      if (!isFinite(p[0]) || !isFinite(p[1])) return hhmm;
      var tot = p[0] * 60 + p[1] + Number(min || 0);
      tot = ((tot % 1440) + 1440) % 1440;
      var H = Math.floor(tot / 60), M = tot % 60;
      return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0');
    },

    /** Local "YYYY-MM-DD" (avoids the UTC shift of toISOString). */
    iso: function (d) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    },

    /** Month key -> localized short label, e.g. "2026-07" -> "Jul" / "Th7". */
    monthShort: function (mo) {
      if (!mo) return EM;
      return monthsShort()[Number(mo.split('-')[1]) - 1] || EM;
    },

    /** Month key -> localized full label, e.g. "2026-07" -> "July 2026" / "Tháng 7 2026". */
    monthLabel: function (mo) {
      if (!mo) return EM;
      var a = mo.split('-').map(Number);
      return (monthsFull()[a[1] - 1] || EM) + ' ' + a[0];
    },

    /**
     * ISO date -> numeric label per the date-format preference.
     * DD/MM/YYYY -> "10/07/2026"; MM/DD/YYYY -> "07/10/2026"; YYYY/MM/DD -> "2026/07/10".
     */
    dateLabel: function (iso) {
      if (!iso) return EM;
      var d = new Date(iso + 'T00:00:00');
      if (isNaN(d)) return EM;
      var DD = String(d.getDate()).padStart(2, '0');
      var MM = String(d.getMonth() + 1).padStart(2, '0');
      var YYYY = d.getFullYear();
      switch (reg().dateFormat) {
        case 'MM/DD/YYYY': return MM + '/' + DD + '/' + YYYY;
        case 'YYYY/MM/DD': return YYYY + '/' + MM + '/' + DD;
        case 'DD/MM/YYYY':
        default: return DD + '/' + MM + '/' + YYYY;
      }
    }
  };
})(window);
