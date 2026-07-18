/**
 * Funnel analytics — pressell → quiz → VSL
 * - Multi-user totals: CounterAPI (namespace growthyoutube_funnel)
 * - IP + localização: ipwho.is (quando o navegador permitir)
 * - Log detalhado: localStorage (este navegador) + fila remota opcional
 * - Meta / TikTok custom events quando disponíveis
 */
(function (global) {
  'use strict';

  var NS = 'growthyoutube_funnel';
  var COUNTER_BASE = 'https://api.counterapi.dev/v1';
  var LOCAL_KEY = 'grow_funnel_events_v1';
  var SESSION_KEY = 'grow_funnel_session_v1';
  var GEO_KEY = 'grow_funnel_geo_v1';
  var VISITORS_KEY = 'grow_funnel_visitors_v1';
  var MAX_LOCAL = 3000;
  var MAX_VISITORS = 500;

  var geoCache = null;
  var geoPromise = null;
  var onceFlags = {};

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
      ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'rtkcid', 'ttclid'].forEach(function (k) {
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

  function readVisitors() {
    try {
      var raw = localStorage.getItem(VISITORS_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      return [];
    }
  }

  function writeVisitors(arr) {
    try {
      localStorage.setItem(VISITORS_KEY, JSON.stringify(arr.slice(-MAX_VISITORS)));
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
      .then(function (r) {
        if (!r.ok) return { count: 0 };
        return r.json();
      })
      .then(function (j) { return Number(j && j.count) || 0; })
      .catch(function () { return 0; });
  }

  /** IP + cidade/país (ipwho.is — HTTPS, sem API key) */
  function fetchGeo() {
    if (geoCache) return Promise.resolve(geoCache);
    try {
      var cached = sessionStorage.getItem(GEO_KEY);
      if (cached) {
        geoCache = JSON.parse(cached);
        return Promise.resolve(geoCache);
      }
    } catch (e) {}

    if (geoPromise) return geoPromise;

    geoPromise = fetch('https://ipwho.is/', { method: 'GET', credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || j.success === false) {
          geoCache = { ip: null, city: null, region: null, country: null, country_code: null };
        } else {
          geoCache = {
            ip: j.ip || null,
            city: j.city || null,
            region: j.region || j.region_code || null,
            country: j.country || null,
            country_code: j.country_code || null,
            lat: j.latitude != null ? j.latitude : null,
            lon: j.longitude != null ? j.longitude : null,
            isp: (j.connection && j.connection.isp) || j.isp || null
          };
        }
        try { sessionStorage.setItem(GEO_KEY, JSON.stringify(geoCache)); } catch (e) {}
        return geoCache;
      })
      .catch(function () {
        geoCache = { ip: null, city: null, region: null, country: null, country_code: null };
        return geoCache;
      });

    return geoPromise;
  }

  function upsertVisitor(payload) {
    var list = readVisitors();
    var sid = payload.sessionId;
    var found = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].sessionId === sid) { found = list[i]; break; }
    }
    if (!found) {
      found = {
        sessionId: sid,
        firstSeen: payload.iso,
        lastSeen: payload.iso,
        ip: payload.ip || null,
        city: payload.city || null,
        region: payload.region || null,
        country: payload.country || null,
        country_code: payload.country_code || null,
        events: [],
        pages: {},
        fromPressell: false,
        reachedQuiz: false,
        continuedPressell: false,
        utm: payload.utm || {}
      };
      list.push(found);
    }
    found.lastSeen = payload.iso;
    if (payload.ip) found.ip = payload.ip;
    if (payload.city) found.city = payload.city;
    if (payload.region) found.region = payload.region;
    if (payload.country) found.country = payload.country;
    if (payload.country_code) found.country_code = payload.country_code;
    found.events.push(payload.event);
    if (found.events.length > 40) found.events = found.events.slice(-40);
    found.pages[payload.event] = (found.pages[payload.event] || 0) + 1;

    if (payload.event === 'pressell_view') found.fromPressell = true;
    if (payload.event === 'pressell_continue') found.continuedPressell = true;
    if (payload.event === 'quiz_pageview' || payload.event === 'quiz_from_pressell') found.reachedQuiz = true;
    if (payload.utm && Object.keys(payload.utm).length) found.utm = payload.utm;

    writeVisitors(list);
  }

  function onceKey(eventName) {
    return 'once_' + eventName;
  }

  function dayKey(ts) {
    var d = new Date(ts || Date.now());
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, '0');
    var day = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function hourKey(ts) {
    var d = new Date(ts || Date.now());
    var y = d.getUTCFullYear();
    var m = String(d.getUTCMonth() + 1).padStart(2, '0');
    var day = String(d.getUTCDate()).padStart(2, '0');
    var h = String(d.getUTCHours()).padStart(2, '0');
    return y + '-' + m + '-' + day + 'T' + h;
  }

  /**
   * track(eventName, props)
   * props.once === true → só 1x por sessão (ideal para pageviews)
   */
  function track(eventName, props) {
    props = props || {};
    var sessionId = getSessionId();

    if (props.once) {
      var ok = onceKey(eventName);
      try {
        if (sessionStorage.getItem(ok) === '1') return null;
        sessionStorage.setItem(ok, '1');
      } catch (e) {
        if (onceFlags[ok]) return null;
        onceFlags[ok] = true;
      }
    }

    var base = {
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
      referrer: document.referrer || '',
      userAgent: (navigator.userAgent || '').slice(0, 180),
      language: navigator.language || null,
      ip: null,
      city: null,
      region: null,
      country: null,
      country_code: null
    };

    // Enriquecer com geo (async) e gravar
    function commit(payload) {
      var arr = readLocal();
      arr.push(payload);
      writeLocal(arr);
      upsertVisitor(payload);

      // Multi-user counters (total + por dia + por hora UTC)
      var dk = dayKey(payload.ts);
      var hk = hourKey(payload.ts);
      bumpCounter(eventName);
      bumpCounter(eventName + '_' + dk);
      bumpCounter(eventName + '_h_' + hk.replace(/[-:T]/g, ''));
      if (props.step != null) bumpCounter('step_' + props.step + '_' + eventName);
      if (props.answer) bumpCounter('answer_' + props.answer);
      if (props.path) bumpCounter(props.path);

      // Região multi-usuário (quando geo já estiver disponível)
      if (payload.country_code) {
        bumpCounter('country_' + String(payload.country_code).toLowerCase());
        bumpCounter('country_' + String(payload.country_code).toLowerCase() + '_' + dk);
      }
      if (payload.region) {
        var reg = safeKey(payload.region).slice(0, 24);
        bumpCounter('region_' + reg);
        bumpCounter('region_' + reg + '_' + dk);
      }
      if (payload.city) {
        var city = safeKey(payload.city).slice(0, 24);
        bumpCounter('city_' + city);
      }

      // Meta
      try {
        if (typeof global.fbq === 'function') {
          global.fbq('trackCustom', eventName, {
            step: props.step,
            label: props.label,
            answer: props.answer,
            city: payload.city,
            country: payload.country_code
          });
        }
      } catch (e) {}

      // TikTok
      try {
        if (global.ttq && typeof global.ttq.track === 'function') {
          global.ttq.track(eventName);
        }
      } catch (e) {}

      return payload;
    }

    // Se já temos geo em cache, grava completo de uma vez
    if (geoCache) {
      base.ip = geoCache.ip;
      base.city = geoCache.city;
      base.region = geoCache.region;
      base.country = geoCache.country;
      base.country_code = geoCache.country_code;
      return commit(base);
    }

    // Grava rápido sem geo, depois atualiza o último evento + visitor
    commit(base);

    fetchGeo().then(function (g) {
      if (!g) return;
      var arr = readLocal();
      for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i].sessionId === sessionId && arr[i].event === eventName && !arr[i].ip) {
          arr[i].ip = g.ip;
          arr[i].city = g.city;
          arr[i].region = g.region;
          arr[i].country = g.country;
          arr[i].country_code = g.country_code;
          writeLocal(arr);
          upsertVisitor(arr[i]);
          // contadores de região (só quando geo chega)
          var dk = dayKey(arr[i].ts);
          if (g.country_code) {
            bumpCounter('country_' + String(g.country_code).toLowerCase());
            bumpCounter('country_' + String(g.country_code).toLowerCase() + '_' + dk);
          }
          if (g.region) {
            var reg = safeKey(g.region).slice(0, 24);
            bumpCounter('region_' + reg);
            bumpCounter('region_' + reg + '_' + dk);
          }
          if (g.city) bumpCounter('city_' + safeKey(g.city).slice(0, 24));
          break;
        }
      }
    });

    return base;
  }

  /** Filtra eventos locais por janela de tempo */
  function filterEvents(opts) {
    opts = opts || {};
    var all = readLocal();
    var now = Date.now();
    var from = opts.from != null ? opts.from : 0;
    var to = opts.to != null ? opts.to : now;
    if (opts.hours != null) {
      from = now - Number(opts.hours) * 3600 * 1000;
      to = now;
    }
    if (opts.day) {
      // day = 'YYYY-MM-DD' em UTC
      from = Date.parse(opts.day + 'T00:00:00.000Z');
      to = Date.parse(opts.day + 'T23:59:59.999Z');
    }
    return all.filter(function (e) {
      var t = e.ts || Date.parse(e.iso) || 0;
      return t >= from && t <= to;
    });
  }

  /** Análise de funil a partir de eventos locais (por sessão → etapa máxima) */
  function analyzeDropoff(events) {
    var order = [
      'pressell_view',
      'pressell_continue',
      'quiz_from_pressell',
      'quiz_pageview',
      'step_view_0',
      'step_click_0',
      'step_view_1',
      'step_answer_1',
      'step_view_2',
      'step_answer_2',
      'step_view_3',
      'step_answer_3',
      'step_view_4',
      'step_answer_4',
      'step_view_5',
      'vsl_click',
      'vsl_pageview'
    ];
    var labels = {};
    (api.FUNNEL || []).forEach(function (f) { labels[f.key] = f.label; });

    var sessions = {};
    events.forEach(function (e) {
      var sid = e.sessionId || 'unknown';
      if (!sessions[sid]) sessions[sid] = { maxIdx: -1, events: {}, geo: {} };
      var idx = order.indexOf(e.event);
      if (idx > sessions[sid].maxIdx) sessions[sid].maxIdx = idx;
      sessions[sid].events[e.event] = true;
      if (e.country_code || e.region || e.city || e.ip) {
        sessions[sid].geo = {
          ip: e.ip || sessions[sid].geo.ip,
          city: e.city || sessions[sid].geo.city,
          region: e.region || sessions[sid].geo.region,
          country: e.country || sessions[sid].geo.country,
          country_code: e.country_code || sessions[sid].geo.country_code
        };
      }
    });

    var reached = order.map(function () { return 0; });
    var stoppedAt = order.map(function () { return 0; });
    var sidList = Object.keys(sessions);
    sidList.forEach(function (sid) {
      var max = sessions[sid].maxIdx;
      if (max < 0) return;
      for (var i = 0; i <= max; i++) reached[i] += 1;
      stoppedAt[max] += 1;
    });

    var steps = order.map(function (key, i) {
      var count = reached[i];
      var prev = i === 0 ? count : reached[i - 1];
      var drop = i === 0 ? 0 : Math.max(0, prev - count);
      var dropPct = prev > 0 && i > 0 ? Math.round((drop / prev) * 1000) / 10 : 0;
      return {
        key: key,
        label: labels[key] || key,
        count: count,
        drop: drop,
        dropPct: dropPct,
        stoppedHere: stoppedAt[i]
      };
    });

    // Maior queda
    var worst = null;
    steps.forEach(function (s, i) {
      if (i === 0) return;
      if (!worst || s.dropPct > worst.dropPct) worst = s;
    });

    // Regiões
    var byRegion = {};
    var byCountry = {};
    sidList.forEach(function (sid) {
      var g = sessions[sid].geo || {};
      var r = g.region || 'Desconhecida';
      var c = g.country_code || g.country || '??';
      byRegion[r] = (byRegion[r] || 0) + 1;
      byCountry[c] = (byCountry[c] || 0) + 1;
    });

    return {
      sessions: sidList.length,
      steps: steps,
      worstDrop: worst,
      byRegion: byRegion,
      byCountry: byCountry,
      sessionDetails: sidList.map(function (sid) {
        return {
          sessionId: sid,
          maxStep: order[sessions[sid].maxIdx] || null,
          maxLabel: labels[order[sessions[sid].maxIdx]] || order[sessions[sid].maxIdx] || null,
          geo: sessions[sid].geo
        };
      })
    };
  }

  // Warm geo early
  try { fetchGeo(); } catch (e) {}

  var api = {
    NS: NS,
    track: track,
    fetchGeo: fetchGeo,
    getSessionId: getSessionId,
    getLocalEvents: readLocal,
    getVisitors: readVisitors,
    filterEvents: filterEvents,
    analyzeDropoff: analyzeDropoff,
    dayKey: dayKey,
    clearLocalEvents: function () {
      try {
        localStorage.removeItem(LOCAL_KEY);
        localStorage.removeItem(VISITORS_KEY);
      } catch (e) {}
    },
    fetchCounter: fetchCounter,
    fetchMany: function (names) {
      return Promise.all(names.map(function (n) {
        return fetchCounter(n).then(function (c) { return { name: n, count: c }; });
      }));
    },
    /** Funil completo: pressell → quiz → VSL */
    FUNNEL: [
      { key: 'pressell_view', label: '1. Abriu a pressell (/asuhdwa)', step: -1 },
      { key: 'pressell_continue', label: '2. Clicou CONTINUE na pressell', step: -1 },
      { key: 'quiz_from_pressell', label: '3. Chegou no quiz vindo da pressell', step: 0 },
      { key: 'quiz_pageview', label: '4. Abriu o quiz (total)', step: 0 },
      { key: 'step_view_0', label: '5. Viu intro do quiz', step: 0 },
      { key: 'step_click_0', label: '6. Clicou START', step: 0 },
      { key: 'step_view_1', label: '7. Viu avaliação 1', step: 1 },
      { key: 'step_answer_1', label: '8. Respondeu avaliação 1', step: 1 },
      { key: 'step_view_2', label: '9. Viu avaliação 2', step: 2 },
      { key: 'step_answer_2', label: '10. Respondeu avaliação 2', step: 2 },
      { key: 'step_view_3', label: '11. Viu avaliação 3', step: 3 },
      { key: 'step_answer_3', label: '12. Respondeu avaliação 3', step: 3 },
      { key: 'step_view_4', label: '13. Viu avaliação 4', step: 4 },
      { key: 'step_answer_4', label: '14. Respondeu avaliação 4', step: 4 },
      { key: 'step_view_5', label: '15. Tela final Congratulations', step: 5 },
      { key: 'vsl_click', label: '16. Clicou WATCH THE VIDEO', step: 5 },
      { key: 'vsl_pageview', label: '17. Abriu a VSL', step: 6 }
    ],
    PRESELL_KEYS: [
      { key: 'pressell_view', label: 'Visitas na pressell' },
      { key: 'pressell_continue', label: 'Clicou CONTINUE' },
      { key: 'pressell_decline', label: 'Clicou Leave' },
      { key: 'quiz_from_pressell', label: 'Chegou no quiz via pressell' },
      { key: 'quiz_pageview', label: 'Aberturas do quiz (todas)' }
    ],
    ANSWER_KEYS: [
      { key: 'answer_angry', label: 'Angry' },
      { key: 'answer_neutral', label: 'Neutral' },
      { key: 'answer_love', label: 'Love it' },
      { key: 'answer_no', label: 'No' },
      { key: 'answer_maybe', label: 'Maybe' },
      { key: 'answer_yes', label: 'Yes' },
      { key: 'answer_si', label: 'SÍ' },
      { key: 'answer_no_es', label: 'NO' }
    ]
  };

  global.GrowFunnel = api;
})(window);
