/* English Tutor LMS — pure calculation helpers (RC2)
 *
 * Small, dependency-free functions shared by scheduling, billing and the
 * performance views. Extracting them removes a duplicated string-hash (it was
 * defined twice, once for mock data and once for attendance) and keeps the
 * business arithmetic testable outside the component.
 */
(function (root) {
  var ETLMS = (root.ETLMS = root.ETLMS || {});

  ETLMS.calc = {
    /**
     * Deterministic 32-bit string hash (×31 rolling). Seeds all reproducible
     * mock variation so the demo is identical across reloads.
     * @param {string} s
     * @returns {number} unsigned 32-bit integer
     */
    hash: function (s) {
      var h = 0;
      s = String(s == null ? '' : s);
      for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return h;
    },

    /**
     * Do two [start, duration] ranges (24h "HH:MM" + minutes) intersect?
     * Used to flag scheduling clashes.
     * @param {string} aStart @param {number} aDur
     * @param {string} bStart @param {number} bDur
     * @returns {boolean}
     */
    overlaps: function (aStart, aDur, bStart, bDur) {
      var m = function (t) { var p = String(t).split(':').map(Number); return p[0] * 60 + p[1]; };
      var as = m(aStart), ae = as + Number(aDur || 0), bs = m(bStart), be = bs + Number(bDur || 0);
      return as < be && bs < ae;
    },

    /**
     * Amount actually collected for a billing record. Partially Paid counts as
     * half the fee (see CLAUDE.md revenue rules).
     * @param {Billing} b
     * @returns {number} VND collected (0 if unpaid or missing)
     */
    paidAmount: function (b) {
      if (!b) return 0;
      return b.status === 'Paid' ? b.fee : b.status === 'Partially Paid' ? Math.round(b.fee / 2) : 0;
    },

    /**
     * Coaching label for an average skill score.
     * @param {number} avg  1..5
     * @returns {string}
     */
    perfLabel: function (avg) {
      return avg >= 4.5 ? 'Excellent' : avg >= 3.8 ? 'Strong' : avg >= 3.0 ? 'Good' : avg >= 2.2 ? 'Developing' : 'Needs support';
    },

    /**
     * Themed colour band matching perfLabel().
     * @param {number} avg  1..5
     * @returns {string} a CSS var() reference
     */
    perfColor: function (avg) {
      return avg >= 3.8 ? 'var(--green)' : avg >= 3.0 ? 'var(--sky)' : avg >= 2.2 ? 'var(--amber)' : 'var(--accent)';
    }
  };

  /* Safe localStorage wrapper — collapses the try/catch boilerplate that was
   * repeated ~8 times in the component (private-mode / SSR throw on access). */
  ETLMS.storage = {
    /** @param {string} key @param {string} [fallback] @returns {?string} */
    get: function (key, fallback) {
      try { var v = localStorage.getItem(key); return v == null ? (fallback == null ? null : fallback) : v; }
      catch (_) { return fallback == null ? null : fallback; }
    },
    /** @param {string} key @param {*} fallback @returns {*} parsed JSON or fallback */
    getJSON: function (key, fallback) {
      try { var v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
      catch (_) { return fallback; }
    },
    /** @param {string} key @returns {boolean} true iff stored value is "1" */
    getBool: function (key) {
      try { return localStorage.getItem(key) === '1'; } catch (_) { return false; }
    },
    /** @param {string} key @param {string|object} val  objects are JSON-stringified */
    set: function (key, val) {
      try { localStorage.setItem(key, typeof val === 'string' ? val : JSON.stringify(val)); } catch (_) {}
    }
  };

  /* Reusable field validators — return an error string or '' (falsy = valid).
   * Replaces the duplicated inline checks across validateStudent/Parent/Class. */
  ETLMS.validate = {
    /** @param {*} v @param {string} label @returns {string} error or '' */
    required: function (v, label) {
      return (v == null || String(v).trim() === '') ? (label + ' is required') : '';
    },
    /** @param {string} v @param {number} n min length @param {string} [msg] @returns {string} */
    minLen: function (v, n, msg) {
      return (String(v || '').trim().length < n) ? (msg || ('Must be at least ' + n + ' characters')) : '';
    },
    /** Requires 3+ consecutive digits. @param {string} v @returns {string} */
    phone: function (v) {
      if (!v || !String(v).trim()) return 'Phone is required';
      return /\d{3}/.test(v) ? '' : 'Enter a valid phone number';
    },
    /** Optional field: empty is valid. @param {string} v @returns {string} */
    email: function (v) {
      if (!v) return '';
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? '' : 'Enter a valid email';
    },
    /** @param {string} iso ISO date @param {string} label @returns {string} */
    notFuture: function (iso, label) {
      if (!iso) return label + ' is required';
      return new Date(iso) > new Date() ? (label + ' cannot be in the future') : '';
    },
    /** @param {*} v @param {string} [msg] @returns {string} error unless v is a number >= 0 */
    nonNegNumber: function (v, msg) {
      return (v === '' || v == null || isNaN(Number(v)) || Number(v) < 0) ? (msg || 'Enter a valid number') : '';
    }
  };
})(window);
