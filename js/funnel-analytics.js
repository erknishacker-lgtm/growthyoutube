/**
 * Funnel analytics — quiz steps + VSL handoff
 * - Multi-user aggregates: CounterAPI (namespace growthyoutube_funnel)
 * - Detailed local log: localStorage (this browser)
 * - Meta Pixel custom events when fbq is available
 */
(function (global) {
  'use strict';

  var NS = 'growthyoutube_funnel';
  var COUNTER_BASE = 'https://api.counterapi.dev/v1';
  var LOCAL_KEY = 'grow_funnel_events_v1';
  var SESSION_KEY = 'grow_funnel_session_v1';
  var MAX_LOCAL = 2500;

  function uid() {
    return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function getSessionId() {
    try {
      var id = sessionStorage.getItem(SESSION_KEY);
      if (!id) {
        id = uid();
        sessionStorage.setItem(SESSION_KEY, id);
      }
      return id;
    } catch (e) {
      return uid();
    }
  }

  function getUtms() {
    var out = {};
    try {
      var p = new URLSearchParams(global.location.search);
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'rtkcid'].forEach(function (k) {
        var v = p.get(k);
        if (v) out[k] = v;
      });
    } catch (e) {}
    return out;
  }

  function readLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function writeLocal(arr) {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(arr.slice(-MAX_LOCAL)));
    } catch (e) {}
  }

  function safeKey(name) {
    return String(name || 'event')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 48) || 'event';
  }

  function bumpCounter(name) {
    var key = safeKey(name);
    var url = COUNTER_BASE + '/' + encodeURIComponent(NS) + '/' + encodeURIComponent(key) + '/up?t=' + Date.now();
    try {
      // GET hit (CounterAPI). Image beacon survives page navigation better than POST sendBeacon.
      var img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    } catch (e) {
      try {
        fetch(url, { method: 'GET', mode: 'no-cors', keepalive: true, credentials: 'omit' }).catch(function () {});
      } catch (e2) {}
    }
  }

  function fetchCounter(name) {
    var key = safeKey(name);
    var url = COUNTER_BASE + '/' + encodeURIComponent(NS) + '/' + encodeURIComponent(key) + '/';
    return fetch(url, { method: 'GET' })
      .then(function (r) { return r.ok ? r.json() : { count: 0 }; })
      .then(function (j) { return Number(j && j.count) || 0; })
      .catch(function () { return 0; });
  }

  function track(eventName, props) {
    props = props || {};
    var sessionId = getSessionId();
    var payload = {
      event: eventName,
      ts: Date.now(),
      iso: new Date().toISOString(),
      sessionId: sessionId,
      page: (global.location.pathname || '') + (global.location.search || ''),
      step: props.step != null ? props.step : null,
      label: props.label || null,
      answer: props.answer || null,
      earn: props.earn != null ? props.earn : null,
      balance: props.balance != null ? props.balance : null,
      path: props.path || null,
      utm: getUtms(),
      screen: (global.screen && global.screen.width ? global.screen.width + 'x' + global.screen.height : null),
      referrer: document.referrer || ''
    };

    // Local detail log
    var arr = readLocal();
    arr.push(payload);
    writeLocal(arr);

    // Multi-user aggregate counters
    bumpCounter(eventName);
    if (props.step != null) bumpCounter('step_' + props.step + '_' + eventName);
    if (props.answer) bumpCounter('answer_' + props.answer);
    if (props.path) bumpCounter(props.path);

    // Meta Pixel (optional)
    try {
      if (typeof global.fbq === 'function') {
        global.fbq('trackCustom', eventName, {
          step: props.step,
          label: props.label,
          answer: props.answer,
          earn: props.earn
        });
      }
    } catch (e) {}

    return payload;
  }

  // Public API
  var api = {
    NS: NS,
    track: track,
    getSessionId: getSessionId,
    getLocalEvents: readLocal,
    clearLocalEvents: function () {
      try { localStorage.removeItem(LOCAL_KEY); } catch (e) {}
    },
    fetchCounter: fetchCounter,
    fetchMany: function (names) {
      return Promise.all(names.map(function (n) {
        return fetchCounter(n).then(function (c) { return { name: n, count: c }; });
      }));
    },
    /** Funnel step labels for dashboard */
    FUNNEL: [
      { key: 'quiz_pageview', label: '1. Abriu o quiz', step: 0 },
      { key: 'step_view_0', label: '2. Viu intro (Congratulations)', step: 0 },
      { key: 'step_click_0', label: '3. Clicou START', step: 0 },
      { key: 'step_view_1', label: '4. Viu avaliação 1', step: 1 },
      { key: 'step_answer_1', label: '5. Respondeu avaliação 1', step: 1 },
      { key: 'step_view_2', label: '6. Viu avaliação 2', step: 2 },
      { key: 'step_answer_2', label: '7. Respondeu avaliação 2', step: 2 },
      { key: 'step_view_3', label: '8. Viu avaliação 3', step: 3 },
      { key: 'step_answer_3', label: '9. Respondeu avaliação 3', step: 3 },
      { key: 'step_view_4', label: '10. Viu avaliação 4', step: 4 },
      { key: 'step_answer_4', label: '11. Respondeu avaliação 4', step: 4 },
      { key: 'step_view_5', label: '12. Viu tela Congratulations final', step: 5 },
      { key: 'vsl_click', label: '13. Clicou WATCH THE VIDEO', step: 5 },
      { key: 'vsl_pageview', label: '14. Abriu a VSL', step: 6 }
    ],
    ANSWER_KEYS: [
      { key: 'answer_angry', label: '😡 Angry' },
      { key: 'answer_neutral', label: '😐 Neutral' },
      { key: 'answer_love', label: '😍 Love it' },
      { key: 'answer_no', label: '👎 No' },
      { key: 'answer_maybe', label: '🤔 Maybe' },
      { key: 'answer_yes', label: '👍 Yes' },
      { key: 'answer_si', label: 'SÍ' },
      { key: 'answer_no_es', label: 'NO' }
    ]
  };

  global.GrowFunnel = api;
})(window);
