/* FieldGovern — sticky "Start 15-day Free Trial" CTA.
   Injected on every marketing page via a single <script defer src="/assets/trial-cta.js"></script>.
   Floating animated pill, bottom-right, persists through scroll, dismissible for the session.
   On pages that already carry a .calc-sticker (compare.html), it stacks above it so the two
   never overlap. Respects prefers-reduced-motion. */
(function () {
  'use strict';
  var KEY = 'fg_trial_cta_dismissed';
  try { if (sessionStorage.getItem(KEY) === '1') return; } catch (e) {}

  var TRIAL_URL = 'https://app.fieldgovern.com/login';

  function init() {
    if (document.getElementById('fg-trial-cta')) return;

    var css = ''
      + '#fg-trial-cta{position:fixed;right:18px;bottom:22px;z-index:96;display:flex;align-items:center;'
      + 'gap:10px;padding:12px 14px 12px 16px;background:linear-gradient(135deg,#0ea5e9,#7c3aed);color:#fff;'
      + 'border-radius:14px;box-shadow:0 12px 32px rgba(14,165,233,.38);max-width:260px;'
      + 'font-family:Inter,system-ui,sans-serif;animation:fgTrialPulse 2.6s ease-in-out infinite}'
      + '#fg-trial-cta a.fg-trial-link{display:flex;align-items:center;gap:10px;text-decoration:none;color:#fff;flex:1}'
      + '#fg-trial-cta .fg-trial-ico{font-size:1.4rem;line-height:1;flex-shrink:0}'
      + '#fg-trial-cta .fg-trial-txt{display:flex;flex-direction:column;line-height:1.2}'
      + '#fg-trial-cta .fg-trial-txt strong{font-size:.92rem;font-weight:800}'
      + '#fg-trial-cta .fg-trial-txt span{font-size:.72rem;opacity:.92}'
      + '#fg-trial-cta button.fg-trial-x{flex-shrink:0;align-self:flex-start;background:rgba(255,255,255,.18);'
      + 'border:none;color:#fff;width:20px;height:20px;border-radius:50%;cursor:pointer;font-size:.8rem;'
      + 'line-height:1;display:flex;align-items:center;justify-content:center;padding:0;transition:background .2s}'
      + '#fg-trial-cta button.fg-trial-x:hover{background:rgba(255,255,255,.35)}'
      + '#fg-trial-cta:hover{box-shadow:0 18px 44px rgba(124,58,237,.5)}'
      + '@keyframes fgTrialPulse{0%,100%{box-shadow:0 12px 32px rgba(14,165,233,.32)}50%{box-shadow:0 14px 42px rgba(124,58,237,.55)}}'
      + '@media(prefers-reduced-motion:reduce){#fg-trial-cta{animation:none}}'
      + '@media(max-width:640px){#fg-trial-cta{right:12px;bottom:14px;max-width:210px;padding:10px 12px}'
      + '#fg-trial-cta .fg-trial-txt strong{font-size:.82rem}#fg-trial-cta .fg-trial-txt span{font-size:.66rem}}';
    var style = document.createElement('style');
    style.id = 'fg-trial-cta-style';
    style.textContent = css;
    document.head.appendChild(style);

    var box = document.createElement('div');
    box.id = 'fg-trial-cta';
    box.setAttribute('role', 'complementary');
    box.innerHTML =
      '<a class="fg-trial-link" href="' + TRIAL_URL + '" aria-label="Start your 15-day free trial">' +
        '<span class="fg-trial-ico" aria-hidden="true">&#9889;</span>' +
        '<span class="fg-trial-txt"><strong>Start 15-day Free Trial</strong>' +
        '<span>All features &middot; no card &rarr;</span></span>' +
      '</a>' +
      '<button class="fg-trial-x" type="button" aria-label="Dismiss">&times;</button>';
    document.body.appendChild(box);

    // Stack above an existing floating sticker (e.g. the compare-page calc sticker).
    var other = document.querySelector('.calc-sticker');
    if (other) box.style.bottom = (other.offsetHeight + 34) + 'px';

    box.querySelector('.fg-trial-x').addEventListener('click', function () {
      try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
      box.parentNode && box.parentNode.removeChild(box);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
