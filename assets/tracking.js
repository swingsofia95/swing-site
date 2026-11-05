/* SWING — analytics & ads tracking, shared by swingsofia.com and menu.swingsofia.com.
   ------------------------------------------------------------------------------
   Paste the IDs below and commit. Until both are filled in, this file does nothing at all
   (no cookie bar, no requests). Loaded by both sites as
   <script src="https://swingsofia.com/assets/tracking.js" defer></script>

   What it does once an ID is set (per site, see SITES below):
   • menu.swingsofia.com — no cookie bar; the Meta Pixel loads on visit; no Google Analytics.
   • swingsofia.com — a small cookie bar (EN/BG); the Meta Pixel and Google Analytics load only
     after OK. The choice is remembered for 180 days on .swingsofia.com.
   • Events: PageView everywhere; ViewContent "Bar menu" on the menu site (that's the
     retargeting audience); Contact when someone taps a phone number; a "menu_click" when
     someone opens the menu from the homepage.
   • Honours the browser's Global Privacy Control signal as a "no".
   ------------------------------------------------------------------------------ */
(function () {
  var CONFIG = {
    metaPixelId: '2666180403597236',   // SWING website pixel  — Meta Events Manager → Data sources → your pixel → Settings
    ga4Id: ''          // e.g. 'G-XXXXXXXXXX'      — Google Analytics → Admin → Data streams → Measurement ID
  };
  // Per-site behaviour (owner's decision, 2026-11-06).
  var SITES = {
    menu: { bar: false, pixelOnLoad: true,  ga: false },
    site: { bar: true,  pixelOnLoad: false, ga: true }
  };
  if (!CONFIG.metaPixelId && !CONFIG.ga4Id) return;
  if (!/^https?:$/.test(location.protocol)) return;

  var host = location.hostname;
  var isMenu = host.indexOf('menu.') === 0;
  var MODE = isMenu ? SITES.menu : SITES.site;
  var cookieDomain = host.replace(/^(menu|www)\./, '');
  var KEY = 'swing_consent';

  function getConsent() { var m = document.cookie.match(new RegExp('(?:^|; )' + KEY + '=(yes|no)')); return m ? m[1] : null; }
  function setConsent(v) {
    var base = KEY + '=' + v + '; max-age=' + (180 * 86400) + '; path=/; SameSite=Lax; Secure';
    document.cookie = base + '; domain=.' + cookieDomain;
    if (getConsent() !== v) document.cookie = base; // fallback (localhost etc.)
  }

  var lang = (document.documentElement.lang || '').toLowerCase().indexOf('bg') === 0 ||
             (!document.documentElement.lang && (navigator.language || '').toLowerCase().indexOf('bg') === 0) ? 'bg' : 'en';
  var T = {
    en: { text: 'We use cookies for analytics and to show you our gigs on Instagram & Facebook.', ok: 'OK', no: 'No thanks', privacy: 'Privacy' },
    bg: { text: 'Използваме бисквитки за статистика и за да ти показваме концертите ни в Instagram и Facebook.', ok: 'Добре', no: 'Не, благодаря', privacy: 'Поверителност' }
  };

  function loadMeta() {
    if (!CONFIG.metaPixelId) return;
    /* Meta Pixel base code */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', CONFIG.metaPixelId);
    window.fbq('track', 'PageView');
    if (isMenu) window.fbq('track', 'ViewContent', { content_name: 'Bar menu', content_category: 'menu' });
  }

  function loadGA() {
    if (!CONFIG.ga4Id || !MODE.ga) return;
    var s = document.createElement('script'); s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(CONFIG.ga4Id);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', CONFIG.ga4Id, { cookie_domain: cookieDomain });
    if (isMenu) window.gtag('event', 'view_menu');
  }

  function trackClicks() {
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
      if (!a) return;
      var h = a.getAttribute('href') || '';
      if (h.indexOf('tel:') === 0) {
        if (window.fbq) window.fbq('track', 'Contact', { content_name: 'phone' });
        if (window.gtag) window.gtag('event', 'call_click');
      } else if (!isMenu && /menu\.swingsofia\.com/.test(h)) {
        if (window.fbq) window.fbq('trackCustom', 'MenuClick');
        if (window.gtag) window.gtag('event', 'menu_click');
      }
    }, true);
  }

  function start() { loadMeta(); loadGA(); trackClicks(); }

  function showBar() {
    var t = T[lang];
    var bar = document.createElement('div');
    bar.setAttribute('role', 'dialog'); bar.setAttribute('aria-label', 'Cookies');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#FFFCF1;color:#660033;border-top:3px solid #F63719;' +
      'padding:12px max(16px,env(safe-area-inset-left,0px)) calc(12px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-right,0px));' +
      'display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 16px;font:500 14px/1.35 "Barlow Condensed","Oswald",Arial,sans-serif;box-shadow:0 -4px 16px rgba(0,0,0,.25)';
    var txt = document.createElement('span'); txt.textContent = t.text + ' '; txt.style.cssText = 'max-width:52ch;flex:1 1 280px';
    var pl = document.createElement('a'); pl.href = 'https://swingsofia.com/privacy.html'; pl.textContent = t.privacy; pl.style.cssText = 'color:#660033;text-decoration:underline;text-underline-offset:3px';
    txt.appendChild(pl);
    function btn(label, primary) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = label;
      b.style.cssText = 'cursor:pointer;min-height:40px;padding:0 18px;border-radius:999px;font:700 15px/1 "Barlow Condensed","Oswald",Arial,sans-serif;letter-spacing:.06em;text-transform:uppercase;' +
        (primary ? 'background:#660033;color:#FFFCF1;border:2px solid #660033' : 'background:transparent;color:#660033;border:2px solid #660033');
      return b;
    }
    var ok = btn(t.ok, true), no = btn(t.no, false);
    ok.addEventListener('click', function () { setConsent('yes'); bar.parentNode.removeChild(bar); start(); });
    no.addEventListener('click', function () { setConsent('no'); bar.parentNode.removeChild(bar); });
    var wrap = document.createElement('span'); wrap.style.cssText = 'display:flex;gap:8px;flex:0 0 auto';
    wrap.appendChild(ok); wrap.appendChild(no);
    bar.appendChild(txt); bar.appendChild(wrap);
    document.body.appendChild(bar);
  }

  if (!MODE.bar) {                       // menu: no bar, Pixel on visit
    if (MODE.pixelOnLoad) { loadMeta(); trackClicks(); }
    return;
  }
  var c = getConsent();                  // homepage: everything behind the bar
  if (c === 'yes') start();
  else if (c === 'no') return;
  else if (navigator.globalPrivacyControl) setConsent('no');
  else if (document.body) showBar();
  else document.addEventListener('DOMContentLoaded', showBar);
})();
