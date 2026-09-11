import { getUser, getSettings, handleAuthCallback, oauthLogin, logout, onAuthChange, AUTH_EVENTS } from '@netlify/identity';

const $ = id => document.getElementById(id);
const nativeFetch = window.fetch.bind(window);
let authorized = false;
let initialized = false;
let checking = false;
const messages = {
  authentication_required: 'Inicia sesión con tu cuenta de Google autorizada.',
  invalid_session: 'Tu sesión venció. Vuelve a ingresar con Google.',
  account_not_authorized: 'Este correo no tiene acceso. Solicita su autorización al administrador.',
  review_auth_not_configured: 'El acceso del equipo todavía está en configuración.',
  identity_unavailable: 'No pudimos verificar tu sesión. Intenta nuevamente.',
};

function lock(message) {
  authorized = false;
  document.documentElement.classList.add('review-locked');
  $('review-auth-message').textContent = message;
  // Clear the loaded workspace and any open dialogs after loss of access.
  // A new successful login reloads the clean document.
  if (initialized) {
    document.querySelector('main.container').replaceChildren();
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    document.querySelectorAll('.help-overlay.open').forEach(d => d.classList.remove('open'));
  }
}

async function checkAccess() {
  const response = await nativeFetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(messages[data.error] || 'No se pudo verificar el acceso. Intenta nuevamente.');
  if (typeof data.user?.email !== 'string') throw new Error('No se pudo verificar el acceso.');
  return data.user;
}

// All existing fetch callers keep working with the SDK-managed same-origin
// cookie. No tokens in URLs, DOM attributes, API responses or manual storage.
window.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : input, location.href);
  const isReviewApi = url.origin === location.origin && url.pathname.startsWith('/api/');
  if (!isReviewApi) return nativeFetch(input, init);
  if (!authorized) throw new Error('Inicia sesión para acceder.');
  const response = await nativeFetch(input, { ...init, credentials: 'same-origin', cache: 'no-store' });
  if ([401, 403].includes(response.status)) {
    const data = await response.clone().json().catch(() => ({}));
    if (['authentication_required', 'invalid_session', 'account_not_authorized'].includes(data.error)) {
      lock(messages[data.error]);
      throw new Error(messages[data.error]);
    }
  }
  return response;
};

async function signOut() {
  lock('Cerrando sesión…');
  try { await logout(); } finally { location.replace('/'); }
}

async function start() {
  $('review-signout').onclick = signOut;
  $('review-switch-account').onclick = signOut;
  $('review-google-login').onclick = async () => {
    $('review-google-login').disabled = true;
    $('review-auth-message').textContent = 'Conectando con Google…';
    try {
      // Avoid retaining another account when retrying after denied access.
      await logout();
      oauthLogin('google');
    } catch (error) {
      // oauthLogin intentionally throws after initiating browser navigation.
      if (error.message !== 'Redirecting to OAuth provider') {
        lock('No se pudo iniciar sesión. Intenta nuevamente.');
        $('review-google-login').disabled = false;
      }
    }
  };
  try {
    await handleAuthCallback();
    const settings = await getSettings();
    if (!settings.providers.google) throw new Error('El acceso con Google todavía no está habilitado.');
    $('review-google-login').disabled = false;
    const user = await getUser();
    if (!user) { lock(messages.authentication_required); return false; }
    $('review-switch-account').hidden = false;
    const verified = await checkAccess();
    authorized = true;
    initialized = true;
    $('review-user-email').textContent = verified.email;
    document.documentElement.classList.remove('review-locked');
    return true;
  } catch (error) {
    lock(error.message?.startsWith('El acceso') || Object.values(messages).includes(error.message)
      ? error.message : 'El acceso con Google todavía no está disponible. Intenta nuevamente más tarde.');
    return false;
  }
}

onAuthChange(event => {
  if (event === AUTH_EVENTS.LOGOUT && authorized) lock(messages.authentication_required);
});
async function recheck() {
  if (!authorized || checking || document.hidden) return;
  checking = true;
  try { await getUser(); await checkAccess(); }
  catch (error) { lock(error.message); }
  finally { checking = false; }
}
document.addEventListener('visibilitychange', recheck);
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
setInterval(recheck, 60000);
window.reviewAuthReady = start();
