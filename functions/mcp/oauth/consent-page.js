'use strict';

const { escapeHtml } = require('./respond');

// The consent screen served by GET /authorize. It reuses Firebase Auth exactly
// as the Grand Hall does (compat SDK from the Hosting-reserved /__/firebase/
// path), so there is no parallel login system (design §4, §6). After the user
// signs in and approves, the page POSTs their Firebase ID token plus the
// original OAuth parameters back to /authorize; the server verifies the token,
// confirms app entitlement, and issues the authorization code.
//
// `oauthParams` are echoed back on approval; every reflected value is
// HTML-escaped and re-validated server-side on POST (the page is never trusted).
function renderConsentPage({ appId, appName, clientName, redirectUri, oauthParams }) {
  const safeAppName = escapeHtml(appName || appId);
  const safeClientName = escapeHtml(clientName || 'an MCP client');
  const paramsJson = JSON.stringify(oauthParams).replace(/</g, '\\u003c');
  const safeRedirect = escapeHtml(redirectUri);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connect ${safeAppName} — Olympus</title>
<script defer src="/__/firebase/12.9.0/firebase-app-compat.js"></script>
<script defer src="/__/firebase/12.9.0/firebase-auth-compat.js"></script>
<script defer src="/__/firebase/init.js?useEmulator=true"></script>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0e1a;color:#e0e0e0;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem}
  .card{width:100%;max-width:420px;background:#111827;border:1px solid rgba(255,183,77,.2);
    border-radius:16px;padding:2.25rem 2rem;text-align:center}
  .icon{font-size:2.25rem;margin-bottom:.5rem}
  h1{font-size:1.4rem;letter-spacing:.06em;text-transform:uppercase;margin-bottom:.35rem;
    background:linear-gradient(135deg,#ffd54f,#ffb74d,#ff8a65);-webkit-background-clip:text;
    background-clip:text;-webkit-text-fill-color:transparent}
  .sub{font-size:.9rem;color:#90a4ae;font-style:italic;margin-bottom:1.5rem}
  .grant{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
    border-radius:10px;padding:1rem;margin-bottom:1.5rem;font-size:.9rem;line-height:1.6;text-align:left}
  .grant b{color:#ffd54f}
  .form-group{margin-bottom:.85rem;text-align:left}
  label{display:block;font-size:.72rem;color:#9ca3af;text-transform:uppercase;
    letter-spacing:.08em;margin-bottom:.35rem}
  input{width:100%;padding:.7rem .9rem;font-size:.95rem;color:#e0e0e0;
    background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;outline:none}
  input:focus{border-color:rgba(255,183,77,.5)}
  button{font-family:inherit;cursor:pointer;border:none;border-radius:8px}
  .btn-primary{width:100%;padding:.8rem;margin-top:.5rem;font-size:.95rem;font-weight:600;
    letter-spacing:.06em;text-transform:uppercase;color:#0a0e1a;
    background:linear-gradient(135deg,#ffd54f,#ffb74d,#ff8a65)}
  .btn-primary:disabled{opacity:.6;cursor:not-allowed}
  .btn-google{width:100%;padding:.7rem;margin-top:.75rem;font-size:.9rem;color:#e0e0e0;
    background:transparent;border:1px solid rgba(255,255,255,.15)}
  .row{display:flex;gap:.75rem;margin-top:.5rem}
  .row button{flex:1;padding:.8rem;font-size:.9rem;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
  .btn-deny{background:transparent;border:1px solid rgba(255,255,255,.15);color:#90a4ae}
  .who{font-size:.82rem;color:#6b7280;margin-bottom:1rem}
  .who b{color:#e0e0e0}
  .error{margin-top:1rem;padding:.7rem .9rem;font-size:.85rem;color:#fca5a5;
    background:rgba(220,38,38,.1);border:1px solid rgba(220,38,38,.2);border-radius:8px;font-style:italic}
  .hidden{display:none!important}
</style>
</head>
<body>
<div class="card">
  <div class="icon">&#128273;</div>
  <h1>Connect ${safeAppName}</h1>
  <p class="sub">${safeClientName} wants to connect to Olympus</p>

  <div class="grant">
    This will let the connected client access <b>${safeAppName}</b> in Olympus on your
    behalf, using your granted permissions. You can revoke access at any time.
  </div>

  <!-- Sign-in (shown when logged out) -->
  <div id="signin">
    <form id="login-form" novalidate>
      <div class="form-group">
        <label for="email">Email</label>
        <input id="email" type="email" autocomplete="email" placeholder="your@email.com" required />
      </div>
      <div class="form-group">
        <label for="password">Password</label>
        <input id="password" type="password" autocomplete="current-password" placeholder="Password" required />
      </div>
      <button class="btn-primary" id="signin-btn" type="submit">Sign in</button>
    </form>
    <button class="btn-google" id="google-btn" type="button">Continue with Google</button>
  </div>

  <!-- Approval (shown when logged in) -->
  <div id="approve" class="hidden">
    <p class="who">Signed in as <b id="who-email"></b></p>
    <div class="row">
      <button class="btn-deny" id="deny-btn" type="button">Deny</button>
      <button class="btn-primary" id="approve-btn" type="button" style="margin-top:0">Approve</button>
    </div>
  </div>

  <div class="error hidden" id="error" role="alert"></div>
</div>

<script>
  var OAUTH = JSON.parse('${paramsJson}');
  var REDIRECT_URI = '${safeRedirect}';

  document.addEventListener('DOMContentLoaded', function () {
    var signin = document.getElementById('signin');
    var approve = document.getElementById('approve');
    var whoEmail = document.getElementById('who-email');
    var errorBox = document.getElementById('error');

    function showError(msg) {
      errorBox.textContent = msg;
      errorBox.classList.remove('hidden');
    }

    firebase.auth().onAuthStateChanged(function (user) {
      if (user) {
        signin.classList.add('hidden');
        approve.classList.remove('hidden');
        whoEmail.textContent = user.email || user.uid;
      } else {
        approve.classList.add('hidden');
        signin.classList.remove('hidden');
      }
    });

    document.getElementById('login-form').addEventListener('submit', function (e) {
      e.preventDefault();
      errorBox.classList.add('hidden');
      var email = document.getElementById('email').value.trim();
      var password = document.getElementById('password').value;
      document.getElementById('signin-btn').disabled = true;
      firebase.auth().signInWithEmailAndPassword(email, password).catch(function (err) {
        showError(err.message || 'Sign-in failed.');
        document.getElementById('signin-btn').disabled = false;
      });
    });

    document.getElementById('google-btn').addEventListener('click', function () {
      errorBox.classList.add('hidden');
      var provider = new firebase.auth.GoogleAuthProvider();
      firebase.auth().signInWithPopup(provider).catch(function (err) {
        showError(err.message || 'Google sign-in failed.');
      });
    });

    document.getElementById('deny-btn').addEventListener('click', function () {
      var url = new URL(REDIRECT_URI);
      url.searchParams.set('error', 'access_denied');
      if (OAUTH.state) url.searchParams.set('state', OAUTH.state);
      window.location.href = url.toString();
    });

    document.getElementById('approve-btn').addEventListener('click', function () {
      errorBox.classList.add('hidden');
      var btn = document.getElementById('approve-btn');
      btn.disabled = true;
      var user = firebase.auth().currentUser;
      if (!user) {
        showError('Your session expired. Please sign in again.');
        btn.disabled = false;
        return;
      }
      user.getIdToken().then(function (idToken) {
        var body = Object.assign({ idToken: idToken }, OAUTH);
        return fetch(window.location.pathname, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }).then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      }).then(function (r) {
        if (r.ok && r.data.redirect) {
          window.location.href = r.data.redirect;
        } else {
          showError((r.data && (r.data.error_description || r.data.error)) || 'Authorization failed.');
          btn.disabled = false;
        }
      }).catch(function (err) {
        showError(err.message || 'Authorization failed.');
        btn.disabled = false;
      });
    });
  });
</script>
</body>
</html>`;
}

module.exports = { renderConsentPage };
