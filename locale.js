'use strict';

const ERLocale = (() => {
  const root = document.documentElement;
  const requested = new URLSearchParams(location.search).get('lang');
  let override = ['en', 'zh'].includes(requested) ? requested : null;
  const preferred = navigator.languages?.[0] || navigator.language || 'en';
  const initial = override ?? (/^zh(?:-|$)/i.test(preferred) ? 'zh' : 'en');
  const htmlLanguage = language => language === 'zh' ? 'zh-CN' : 'en';

  if (root.lang !== htmlLanguage(initial)) {
    // Keep the initial HTML out of view until its text has been translated.
    root.style.visibility = 'hidden';
    window.addEventListener('load', () => root.style.removeProperty('visibility'), { once: true });
  }

  function apply(language) {
    root.lang = htmlLanguage(language);
    if (override) {
      for (const link of document.querySelectorAll('.cases a')) {
        const target = new URL(link.href);
        target.searchParams.set('lang', override);
        link.href = target.href;
      }
    }
    root.style.removeProperty('visibility');
  }

  function select(language) {
    override = language;
    const target = new URL(location.href);
    target.searchParams.set('lang', language);
    try {
      history.replaceState(history.state, '', target.href);
    } catch {
      // Local file URLs can restrict history updates.
    }
  }

  return { initial, apply, select };
})();
