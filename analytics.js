/**
 * Funnel analytics — Tools Cash (pressell -> step01 -> step02 -> step03 -> vsl -> checkout)
 * Grava cada evento direto no Supabase (funnel_track_insert), com geo quando disponível.
 * Mesma tabela/base do funil growthyoutube, distinguida pela coluna "funnel".
 */
(function (global) {
  'use strict';

  var FUNNEL = 'toolscash';
  var SUPABASE_URL = 'https://jcojgbuqjhakpqvesesy.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_fAEOmXtXvFzMwBRY2nqzmw_5JSoemtW';
  var SESSION_KEY = 'toolscash_session_v1';
  var GEO_KEY = 'toolscash_geo_v1';

  var geoCache = null;
  var geoPromise = null;

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
            country_code: j.country_code || null
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

  function mergeGeo(payload, g) {
    var out = {};
    for (var k in payload) out[k] = payload[k];
    if (g) {
      out.ip = g.ip;
      out.city = g.city;
      out.region = g.region;
      out.country = g.country;
      out.country_code = g.country_code;
    }
    return out;
  }

  function sendToSupabase(payload) {
    try {
      fetch(SUPABASE_URL + '/rest/v1/rpc/funnel_track_insert', {
        method: 'POST',
        mode: 'cors',
        keepalive: true,
        credentials: 'omit',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: 'Bearer ' + SUPABASE_ANON_KEY
        },
        body: JSON.stringify({
          p_event: payload.event,
          p_ts: payload.ts,
          p_funnel: FUNNEL,
          p_session_id: payload.sessionId,
          p_page: payload.page,
          p_step: payload.step,
          p_label: payload.label,
          p_answer: payload.answer,
          p_earn: payload.earn,
          p_balance: payload.balance,
          p_path: payload.path,
          p_utm: payload.utm,
          p_screen: payload.screen,
          p_referrer: payload.referrer,
          p_user_agent: payload.userAgent,
          p_language: payload.language,
          p_ip: payload.ip,
          p_city: payload.city,
          p_region: payload.region,
          p_country: payload.country,
          p_country_code: payload.country_code
        })
      }).catch(function () {});
    } catch (e) {}
  }

  var onceFlags = {};

  /**
   * track(eventName, props)
   * props.once === true -> só 1x por sessão (ideal para pageviews)
   */
  function track(eventName, props) {
    props = props || {};
    var sessionId = getSessionId();

    if (props.once) {
      var ok = 'once_' + eventName;
      try {
        if (sessionStorage.getItem(ok) === '1') return;
        sessionStorage.setItem(ok, '1');
      } catch (e) {
        if (onceFlags[ok]) return;
        onceFlags[ok] = true;
      }
    }

    var base = {
      event: eventName,
      ts: Date.now(),
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

    function afterGeo(g) {
      var payload = g ? mergeGeo(base, g) : base;
      sendToSupabase(payload);

      try {
        if (typeof global.fbq === 'function') {
          global.fbq('trackCustom', eventName, {
            step: props.step,
            label: props.label,
            city: payload.city,
            country: payload.country_code
          });
        }
      } catch (e) {}

      try {
        if (global.ttq && typeof global.ttq.track === 'function') {
          global.ttq.track(eventName);
        }
      } catch (e) {}
    }

    if (geoCache) {
      afterGeo(geoCache);
    } else {
      fetchGeo().then(afterGeo);
    }
  }

  // Warm geo early
  try { fetchGeo(); } catch (e) {}

  global.ToolsCashFunnel = {
    FUNNEL: FUNNEL,
    track: track,
    getSessionId: getSessionId,
    /** Funil completo: pressell -> steps -> VSL -> checkout */
    STEPS: [
      { key: 'pressell_view', label: '1. Abriu a página (Congratulations)', step: -1 },
      { key: 'pressell_continue', label: '2. Clicou Start now', step: -1 },
      { key: 'step01_view', label: '3. Viu o Step 1', step: 0 },
      { key: 'step01_popup_open', label: '4. Abriu o anúncio no Step 1', step: 0 },
      { key: 'step01_next', label: '5. Avançou pro Step 2', step: 0 },
      { key: 'step02_view', label: '6. Viu o Step 2', step: 1 },
      { key: 'step02_popup_open', label: '7. Abriu o anúncio no Step 2', step: 1 },
      { key: 'step02_next', label: '8. Avançou pro Step 3', step: 1 },
      { key: 'step03_view', label: '9. Viu o Step 3', step: 2 },
      { key: 'step03_popup_open', label: '10. Abriu o anúncio no Step 3', step: 2 },
      { key: 'step03_next', label: '11. Avançou pra VSL', step: 2 },
      { key: 'vsl_pageview', label: '12. Abriu a VSL', step: 3 },
      { key: 'cta_access_reveal', label: '13. Botão ACCESS NOW apareceu', step: 3 },
      { key: 'cta_access_click', label: '14. Clicou ACCESS NOW (checkout)', step: 3 }
    ]
  };
})(window);
