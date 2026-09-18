/* FieldGovern — live pricing sync.
   Injected on every marketing page via <script defer src="/assets/pricing-sync.js"></script>.
   Fetches the admin's current plan prices from /billing/public-pricing (no auth) and fills any
   element tagged data-fg-price="<tier>.<cycle>" (e.g. "starter.monthly", "growth.annual").
   Exposes window.FG_PRICING (array from the API) and fires "fg:pricing-loaded" so page-specific
   calculators (index.html ROI calc, compare.html plan-picker) can read live numbers.
   If the API is unreachable, the hardcoded text already in each slot is left untouched — every
   page renders correct fallback prices with zero JS, so SEO/crawlers and offline users are fine.
   Static/SEO fallbacks (visible text, JSON-LD) are kept in sync separately by
   backend/scripts/sync_website_prices.py whenever an admin changes a price. */
(function () {
  'use strict';
  var FG_API = 'https://app.fieldgovern.com/api/v1';

  function fmtPrice(n) {
    return '₹' + Number(n).toLocaleString('en-IN');
  }

  function applySlots(plans) {
    var byTier = {};
    plans.forEach(function (p) { byTier[p.tier] = p; });

    var slots = document.querySelectorAll('[data-fg-price]');
    for (var i = 0; i < slots.length; i++) {
      var el = slots[i];
      var key = el.getAttribute('data-fg-price') || '';
      var parts = key.split('.');
      var tier = parts[0], cycle = parts[1] || 'monthly';
      var p = byTier[tier];
      if (!p || !p.billing || !p.billing[cycle]) continue;
      var amount = p.billing[cycle].monthly_effective_inr;
      if (amount === undefined || amount === null) continue;
      el.textContent = fmtPrice(amount);
    }

    window.FG_PRICING = plans;
    try {
      document.dispatchEvent(new CustomEvent('fg:pricing-loaded', { detail: plans }));
    } catch (e) { /* older browsers without CustomEvent constructor — slots are already filled */ }
  }

  fetch(FG_API + '/billing/public-pricing')
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (plans) { if (plans) applySlots(plans); })
    .catch(function () { /* offline/API down — hardcoded fallback text stays as-is */ });
})();
