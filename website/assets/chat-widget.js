/* FieldGovern — website chat bubble. Asks visitors for their email and posts it to the
   app's public /auth/lead endpoint so the super admin can follow up. Bottom-left so it
   never collides with the trial CTA (bottom-right). Injected via <script defer src="/assets/chat-widget.js">. */
(function () {
  'use strict';
  var API = 'https://app.fieldgovern.com/api/v1/auth/lead';

  function init() {
    if (document.getElementById('fg-chat')) return;
    var css = ''
      + '#fg-chat{position:fixed;left:18px;bottom:22px;z-index:97;font-family:Inter,system-ui,sans-serif}'
      + '#fg-chat .fg-c-btn{width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;font-size:1.5rem;'
      + 'color:#fff;background:linear-gradient(135deg,#0ea5e9,#7c3aed);box-shadow:0 10px 26px rgba(14,165,233,.4)}'
      + '#fg-chat .fg-c-box{display:none;width:280px;margin-bottom:12px;background:#fff;color:#1e293b;border:1px solid #e2e8f0;'
      + 'border-radius:16px;box-shadow:0 16px 40px rgba(15,23,42,.18);padding:14px}'
      + '#fg-chat.open .fg-c-box{display:block}'
      + '#fg-chat .fg-c-box p{margin:0 0 8px;font-size:.82rem;line-height:1.4}'
      + '#fg-chat .fg-c-box strong{font-size:.92rem}'
      + '#fg-chat input{width:100%;box-sizing:border-box;margin-bottom:8px;padding:8px 10px;border:1px solid #cbd5e1;'
      + 'border-radius:8px;font-size:.85rem}'
      + '#fg-chat .fg-c-go{width:100%;padding:9px;border:none;border-radius:8px;color:#fff;font-weight:600;cursor:pointer;'
      + 'background:linear-gradient(135deg,#0ea5e9,#7c3aed)}'
      + '#fg-chat .fg-c-err{color:#dc2626}'
      + '@media(max-width:640px){#fg-chat{left:12px;bottom:14px}#fg-chat .fg-c-box{width:250px}}';
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

    var w = document.createElement('div'); w.id = 'fg-chat';
    w.innerHTML =
      '<div class="fg-c-box" role="dialog" aria-label="Chat with FieldGovern">'
      + '<p><strong>&#128075; New to FieldGovern?</strong></p>'
      + '<div class="fg-c-body"><p>Share your email and we’ll help you get started with a free trial.</p>'
      + '<form novalidate><input type="email" name="email" placeholder="Email *" required autocomplete="email"/>'
      + '<input type="text" name="name" placeholder="Name (optional)" autocomplete="name"/>'
      + '<input type="tel" name="phone" placeholder="Phone (optional)" autocomplete="tel"/>'
      + '<p class="fg-c-err" hidden></p><button class="fg-c-go" type="submit">Get in touch</button></form></div></div>'
      + '<button class="fg-c-btn" type="button" aria-label="Chat with us">&#128172;</button>';
    document.body.appendChild(w);

    w.querySelector('.fg-c-btn').addEventListener('click', function () { w.classList.toggle('open'); });
    var form = w.querySelector('form'), err = w.querySelector('.fg-c-err');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var f = form.elements, email = f.email.value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { err.textContent = 'Please enter a valid email.'; err.hidden = false; return; }
      err.hidden = true;
      var btn = form.querySelector('button'); btn.disabled = true; btn.textContent = 'Sending…';
      fetch(API, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, name: f.name.value.trim() || null, phone: f.phone.value.trim() || null,
          source: 'website_chat', message: 'Page: ' + location.pathname })
      }).then(function (r) {
        if (!r.ok) throw new Error();
        w.querySelector('.fg-c-body').innerHTML = '<p>Thanks! We’ll reach out on ' + email.replace(/[<>&"]/g, '') + ' shortly.</p>';
      }).catch(function () {
        err.textContent = 'Could not send. Please try again.'; err.hidden = false;
        btn.disabled = false; btn.textContent = 'Get in touch';
      });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
