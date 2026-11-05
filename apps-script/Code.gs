/**
 * il Casato · Sala e Prenotazioni — server su Google Sheets.
 * Pubblicare come App web: Esegui come "Me", Accesso "Chiunque".
 * @OnlyCurrentDoc
 */
const SCRIPT_VERSION = 1;
const DATA_SHEET = 'Dati';
const USERS_SHEET = 'Utenti';
const DATA_HEAD = ['collezione', 'id', 'json', 'aggiornato', 'eliminato', 'da'];
const USERS_HEAD = ['id', 'nome', 'email', 'sale', 'impronta', 'ruolo', 'registrato', 'titolare'];
const COLLECTIONS = { maps: 'gestore', reservations: 'gestore', settings: 'admin' };
const ROLES = ['pending', 'cameriere', 'gestore', 'admin'];
const LEVEL = { pending: 0, cameriere: 1, gestore: 2, admin: 3 };
const TOKEN_DAYS = 60;
const HASH_ROUNDS = 300;

/* ---------- ingresso ---------- */
function doGet() {
  return out_({ ok: true, app: 'il-casato', version: SCRIPT_VERSION });
}

function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return out_({ ok: false, code: 'invalid-argument', message: 'Richiesta non valida' }); }
  try {
    const a = String(req.action || '');
    if (a === 'register') return out_(register_(req));
    if (a === 'login') return out_(login_(req));
    const me = auth_(req.token);
    if (!me) return out_({ ok: false, code: 'unauthenticated', message: 'Accesso scaduto: entra di nuovo.' });
    if (a === 'me') return out_({ ok: true, me: pub_(me) });
    if (a === 'pull') return out_(pull_(me, req));
    if (a === 'write') return out_(write_(me, req));
    if (a === 'changePassword') return out_(changePassword_(me, req));
    if (a === 'users') return out_(users_(me));
    if (a === 'setRole') return out_(setRole_(me, req));
    if (a === 'resetPassword') return out_(resetPassword_(me, req));
    if (a === 'deleteUser') return out_(deleteUser_(me, req));
    return out_({ ok: false, code: 'invalid-argument', message: 'Azione sconosciuta' });
  } catch (err) {
    return out_({ ok: false, code: 'internal', message: String(err && err.message || err) });
  }
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- fogli ---------- */
function sheet_(name, head) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function rows_(sh, width) {
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, width).getValues();
}

/* ---------- sicurezza ---------- */
function secret_() {
  const p = PropertiesService.getScriptProperties();
  let s = p.getProperty('SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SECRET', s); }
  return s;
}
function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function hash_(salt, password) {
  let h = salt + '|' + password;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + h, Utilities.Charset.UTF_8));
  }
  return h;
}
function sign_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_())).replace(/=+$/, '');
}
function token_(uid) {
  const payload = uid + '.' + (Date.now() + TOKEN_DAYS * 864e5);
  return payload + '.' + sign_(payload);
}
function auth_(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const payload = parts[0] + '.' + parts[1];
  if (sign_(payload) !== parts[2]) return null;
  if (Number(parts[1]) < Date.now()) return null;
  return findUser_(function (u) { return u.id === parts[0]; });
}

/* ---------- utenti ---------- */
function allUsers_() {
  const sh = sheet_(USERS_SHEET, USERS_HEAD);
  return rows_(sh, USERS_HEAD.length).map(function (r, i) {
    return { row: i + 2, id: String(r[0]), name: String(r[1]), email: String(r[2]).toLowerCase(), salt: String(r[3]),
      hash: String(r[4]), role: ROLES.indexOf(String(r[5])) >= 0 ? String(r[5]) : 'pending', createdAt: Number(r[6]) || 0, owner: r[7] === true || r[7] === 'TRUE' };
  }).filter(function (u) { return u.id; });
}
function findUser_(fn) {
  const list = allUsers_();
  for (let i = 0; i < list.length; i++) if (fn(list[i])) return list[i];
  return null;
}
function pub_(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.owner ? 'admin' : u.role, owner: u.owner, createdAt: u.createdAt };
}
function level_(u) { return LEVEL[u.owner ? 'admin' : u.role] || 0; }
function cleanEmail_(e) { return String(e || '').trim().toLowerCase(); }

function register_(req) {
  const name = String(req.name || '').trim().slice(0, 80);
  const email = cleanEmail_(req.email);
  const pass = String(req.password || '');
  if (!name) return { ok: false, code: 'invalid-argument', message: 'Scrivi nome e cognome.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, code: 'invalid-argument', message: 'L\'email non è valida.' };
  if (pass.length < 8) return { ok: false, code: 'invalid-argument', message: 'La password deve avere almeno 8 caratteri.' };
  const lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    const users = allUsers_();
    if (users.some(function (u) { return u.email === email; })) return { ok: false, code: 'already-exists', message: 'Esiste già un account con questa email: accedi.' };
    const first = users.length === 0;
    const salt = Utilities.getUuid();
    const u = { id: 'u' + Utilities.getUuid().replace(/-/g, '').slice(0, 16), name: name, email: email, salt: salt, hash: hash_(salt, pass),
      role: first ? 'admin' : 'pending', createdAt: Date.now(), owner: first };
    sheet_(USERS_SHEET, USERS_HEAD).appendRow([u.id, u.name, u.email, u.salt, u.hash, u.role, u.createdAt, u.owner]);
    return { ok: true, token: token_(u.id), me: pub_(u) };
  } finally { lock.releaseLock(); }
}

function login_(req) {
  const email = cleanEmail_(req.email);
  const cache = CacheService.getScriptCache(), key = 'fail:' + email;
  const fails = Number(cache.get(key) || 0);
  if (fails >= 10) return { ok: false, code: 'too-many-requests', message: 'Troppi tentativi: riprova tra 15 minuti.' };
  const u = findUser_(function (x) { return x.email === email; });
  if (!u || hash_(u.salt, String(req.password || '')) !== u.hash) {
    cache.put(key, String(fails + 1), 900);
    return { ok: false, code: 'invalid-credential', message: 'Email o password non corretti.' };
  }
  cache.remove(key);
  return { ok: true, token: token_(u.id), me: pub_(u) };
}

function changePassword_(me, req) {
  if (hash_(me.salt, String(req.old || '')) !== me.hash) return { ok: false, code: 'invalid-credential', message: 'La password attuale non è corretta.' };
  const p = String(req.password || '');
  if (p.length < 8) return { ok: false, code: 'invalid-argument', message: 'La nuova password deve avere almeno 8 caratteri.' };
  const salt = Utilities.getUuid();
  sheet_(USERS_SHEET, USERS_HEAD).getRange(me.row, 4, 1, 2).setValues([[salt, hash_(salt, p)]]);
  return { ok: true };
}

function users_(me) {
  if (level_(me) < LEVEL.admin) return { ok: false, code: 'permission-denied', message: 'Solo l\'amministratore.' };
  return { ok: true, users: allUsers_().map(pub_) };
}
function target_(me, uid) {
  if (level_(me) < LEVEL.admin) return { err: { ok: false, code: 'permission-denied', message: 'Solo l\'amministratore.' } };
  const u = findUser_(function (x) { return x.id === uid; });
  if (!u) return { err: { ok: false, code: 'not-found', message: 'Utente non trovato.' } };
  if (u.owner) return { err: { ok: false, code: 'permission-denied', message: 'Il titolare non si può modificare.' } };
  if (u.id === me.id) return { err: { ok: false, code: 'permission-denied', message: 'Non puoi cambiare il tuo ruolo.' } };
  return { u: u };
}
function setRole_(me, req) {
  const t = target_(me, String(req.uid || '')); if (t.err) return t.err;
  const role = String(req.role || '');
  if (ROLES.indexOf(role) < 0) return { ok: false, code: 'invalid-argument', message: 'Ruolo non valido.' };
  sheet_(USERS_SHEET, USERS_HEAD).getRange(t.u.row, 6).setValue(role);
  return { ok: true };
}
function resetPassword_(me, req) {
  const t = target_(me, String(req.uid || '')); if (t.err) return t.err;
  const p = String(req.password || '');
  if (p.length < 8) return { ok: false, code: 'invalid-argument', message: 'La password deve avere almeno 8 caratteri.' };
  const salt = Utilities.getUuid();
  sheet_(USERS_SHEET, USERS_HEAD).getRange(t.u.row, 4, 1, 2).setValues([[salt, hash_(salt, p)]]);
  return { ok: true };
}
function deleteUser_(me, req) {
  const t = target_(me, String(req.uid || '')); if (t.err) return t.err;
  sheet_(USERS_SHEET, USERS_HEAD).deleteRow(t.u.row);
  return { ok: true };
}

/* ---------- dati ---------- */
function version_() { return Number(PropertiesService.getScriptProperties().getProperty('VER') || 0); }

function pull_(me, req) {
  if (level_(me) < LEVEL.cameriere) return { ok: false, code: 'pending', message: 'Account in attesa di approvazione.', me: pub_(me) };
  const since = Number(req.since || 0), ver = version_();
  if (since && since >= ver) return { ok: true, now: ver, docs: [], me: pub_(me) };
  const docs = [];
  rows_(sheet_(DATA_SHEET, DATA_HEAD), DATA_HEAD.length).forEach(function (r) {
    const upd = Number(r[3]) || 0;
    if (upd <= since) return;
    const deleted = r[4] === true || r[4] === 'TRUE';
    let data = null;
    if (!deleted) { try { data = JSON.parse(String(r[2])); } catch (e) { return; } }
    docs.push({ col: String(r[0]), id: String(r[1]), data: data, deleted: deleted, at: upd });
  });
  return { ok: true, now: ver, docs: docs, me: pub_(me) };
}

function write_(me, req) {
  const ops = Array.isArray(req.ops) ? req.ops : [];
  if (!ops.length) return { ok: true, now: version_() };
  if (ops.length > 100) return { ok: false, code: 'invalid-argument', message: 'Troppe modifiche insieme.' };
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i], need = COLLECTIONS[o.col];
    if (!need) return { ok: false, code: 'invalid-argument', message: 'Collezione non valida.' };
    if (level_(me) < LEVEL[need]) return { ok: false, code: 'permission-denied', message: 'Non hai il permesso per questa modifica.' };
    if (!/^[A-Za-z0-9_\-.:@+~]{1,120}$/.test(String(o.id || ''))) return { ok: false, code: 'invalid-argument', message: 'Identificativo non valido.' };
    if (o.op === 'set') {
      o.json = JSON.stringify(o.data || {});
      if (o.json.length > 45000) return { ok: false, code: 'invalid-argument', message: 'Documento troppo grande.' };
    } else if (o.op !== 'delete') return { ok: false, code: 'invalid-argument', message: 'Operazione non valida.' };
  }
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const sh = sheet_(DATA_SHEET, DATA_HEAD);
    const n = sh.getLastRow() - 1;
    const keys = n > 0 ? sh.getRange(2, 1, n, 2).getValues() : [];
    const index = {};
    keys.forEach(function (k, i) { index[k[0] + '/' + k[1]] = i + 2; });
    let ver = Math.max(Date.now(), version_() + 1);
    const appends = [];
    ops.forEach(function (o) {
      const k = o.col + '/' + o.id;
      const row = [o.col, String(o.id), o.op === 'set' ? o.json : '', ver, o.op === 'delete', me.name];
      if (index[k]) sh.getRange(index[k], 1, 1, row.length).setValues([row]);
      else if (o.op === 'set') { appends.push(row); index[k] = -1; }
    });
    if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, DATA_HEAD.length).setValues(appends);
    PropertiesService.getScriptProperties().setProperty('VER', String(ver));
    return { ok: true, now: ver };
  } finally { lock.releaseLock(); }
}
