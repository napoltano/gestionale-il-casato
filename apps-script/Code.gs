/**
 * il Casato · Sala e Prenotazioni — server su Google Sheets.
 * Pubblicare come App web: Esegui come "Me", Accesso "Chiunque".
 * @OnlyCurrentDoc
 */
const SCRIPT_VERSION = 3;
const ARCHIVE_SHEET = 'Archivio';
// Dopo quanti giorni i documenti passano nel foglio Archivio (restano leggibili per le statistiche).
const KEEP_DAYS = { orders: 3, bills: 7, reservations: 45 };
const BACKUP_DAYS = 30;
const DATA_SHEET = 'Dati';
const USERS_SHEET = 'Utenti';
const DATA_HEAD = ['collezione', 'id', 'json', 'aggiornato', 'eliminato', 'da'];
const USERS_HEAD = ['id', 'nome', 'email', 'sale', 'impronta', 'ruolo', 'registrato', 'titolare'];
// Chi può scrivere ogni collezione. Ordini e conti li scrivono camerieri, gestori e amministratori;
// pizzaiolo, cuoco e barista possono solo segnare i piatti fatti (controllato in pizzaOnly_).
const WRITERS = {
  maps: ['gestore', 'admin'], reservations: ['gestore', 'admin'], settings: ['admin'], menu: ['admin'],
  orders: ['cameriere', 'gestore', 'admin'], bills: ['cameriere', 'gestore', 'admin']
};
const STATION_ROLES = ['pizzaiolo', 'cuoco', 'barista'];
const ROLES = ['pending', 'cameriere', 'pizzaiolo', 'cuoco', 'barista', 'gestore', 'admin'];
const LEVEL = { pending: 0, cameriere: 1, pizzaiolo: 1, cuoco: 1, barista: 1, gestore: 2, admin: 3 };
const TOKEN_DAYS = 60;
const HASH_ROUNDS = 300;

/** Esegui questa funzione dall'editor per fare subito un backup su Drive (la prima volta chiede l'autorizzazione). */
function backupAdesso() {
  backup_(today_());
  Logger.log(prop_('LAST_BACKUP'));
}

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
    if (a === 'publicMenu') return out_(publicMenu_());
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
    if (a === 'query') return out_(query_(me, req));
    if (a === 'status') return out_(status_(me));
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
  const c = CacheService.getScriptCache();
  let s = c.get('SECRET');
  if (s) return s;
  const p = PropertiesService.getScriptProperties();
  s = p.getProperty('SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SECRET', s); }
  c.put('SECRET', s, 21600);
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
  const c = CacheService.getScriptCache(), hit = c.get('USERS');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  const list = readUsers_();
  try { c.put('USERS', JSON.stringify(list), 120); } catch (e) {}
  return list;
}
function usersChanged_() { CacheService.getScriptCache().remove('USERS'); }
function readUsers_() {
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
function role_(u) { return u.owner ? 'admin' : u.role; }
function level_(u) { return LEVEL[role_(u)] || 0; }
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
    const users = readUsers_();
    if (users.some(function (u) { return u.email === email; })) return { ok: false, code: 'already-exists', message: 'Esiste già un account con questa email: accedi.' };
    const first = users.length === 0;
    const salt = Utilities.getUuid();
    const u = { id: 'u' + Utilities.getUuid().replace(/-/g, '').slice(0, 16), name: name, email: email, salt: salt, hash: hash_(salt, pass),
      role: first ? 'admin' : 'pending', createdAt: Date.now(), owner: first };
    sheet_(USERS_SHEET, USERS_HEAD).appendRow([u.id, u.name, u.email, u.salt, u.hash, u.role, u.createdAt, u.owner]);
    usersChanged_();
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
  me = readUsers_().filter(function (x) { return x.id === me.id; })[0] || me;
  if (hash_(me.salt, String(req.old || '')) !== me.hash) return { ok: false, code: 'invalid-credential', message: 'La password attuale non è corretta.' };
  const p = String(req.password || '');
  if (p.length < 8) return { ok: false, code: 'invalid-argument', message: 'La nuova password deve avere almeno 8 caratteri.' };
  const salt = Utilities.getUuid();
  sheet_(USERS_SHEET, USERS_HEAD).getRange(me.row, 4, 1, 2).setValues([[salt, hash_(salt, p)]]);
  usersChanged_();
  return { ok: true };
}

function users_(me) {
  if (level_(me) < LEVEL.admin) return { ok: false, code: 'permission-denied', message: 'Solo l\'amministratore.' };
  return { ok: true, users: allUsers_().map(pub_) };
}
function target_(me, uid) {
  if (level_(me) < LEVEL.admin) return { err: { ok: false, code: 'permission-denied', message: 'Solo l\'amministratore.' } };
  const u = readUsers_().filter(function (x) { return x.id === uid; })[0];
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
  usersChanged_();
  return { ok: true };
}
function resetPassword_(me, req) {
  const t = target_(me, String(req.uid || '')); if (t.err) return t.err;
  const p = String(req.password || '');
  if (p.length < 8) return { ok: false, code: 'invalid-argument', message: 'La password deve avere almeno 8 caratteri.' };
  const salt = Utilities.getUuid();
  sheet_(USERS_SHEET, USERS_HEAD).getRange(t.u.row, 4, 1, 2).setValues([[salt, hash_(salt, p)]]);
  usersChanged_();
  return { ok: true };
}
function deleteUser_(me, req) {
  const t = target_(me, String(req.uid || '')); if (t.err) return t.err;
  sheet_(USERS_SHEET, USERS_HEAD).deleteRow(t.u.row);
  usersChanged_();
  return { ok: true };
}

/* ---------- dati ---------- */
function version_() {
  const c = CacheService.getScriptCache(), v = c.get('VER');
  if (v !== null && v !== undefined) return Number(v);
  const p = Number(PropertiesService.getScriptProperties().getProperty('VER') || 0);
  c.put('VER', String(p), 21600);
  return p;
}
function setVersion_(v) {
  PropertiesService.getScriptProperties().setProperty('VER', String(v));
  CacheService.getScriptCache().put('VER', String(v), 21600);
}

function pull_(me, req) {
  if (level_(me) < LEVEL.cameriere) return { ok: false, code: 'pending', message: 'Account in attesa di approvazione.', me: pub_(me) };
  const since = Number(req.since || 0), ver = version_();
  const epoch = epoch_();
  if (since && since >= ver) return { ok: true, now: ver, epoch: epoch, docs: [], me: pub_(me) };
  const docs = [];
  rows_(sheet_(DATA_SHEET, DATA_HEAD), DATA_HEAD.length).forEach(function (r) {
    const upd = Number(r[3]) || 0;
    if (upd <= since) return;
    const deleted = r[4] === true || r[4] === 'TRUE';
    let data = null;
    if (!deleted) { try { data = JSON.parse(String(r[2])); } catch (e) { return; } }
    docs.push({ col: String(r[0]), id: String(r[1]), data: data, deleted: deleted, at: upd });
  });
  return { ok: true, now: ver, epoch: epoch, docs: docs, me: pub_(me) };
}

function write_(me, req) {
  const ops = Array.isArray(req.ops) ? req.ops : [];
  if (!ops.length) return { ok: true, now: version_() };
  if (ops.length > 100) return { ok: false, code: 'invalid-argument', message: 'Troppe modifiche insieme.' };
  const role = role_(me);
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i], writers = WRITERS[o.col];
    if (!writers) return { ok: false, code: 'invalid-argument', message: 'Collezione non valida.' };
    o.limited = writers.indexOf(role) < 0;
    if (o.limited && !(o.col === 'orders' && STATION_ROLES.indexOf(role) >= 0 && o.op === 'set'))
      return { ok: false, code: 'permission-denied', message: 'Non hai il permesso per questa modifica.' };
    if (!/^[A-Za-z0-9_\-.:@+~]{1,120}$/.test(String(o.id || ''))) return { ok: false, code: 'invalid-argument', message: 'Identificativo non valido.' };
    if (o.op === 'set') {
      o.json = JSON.stringify(o.data || {});
      if (o.json.length > 45000) return { ok: false, code: 'invalid-argument', message: 'Documento troppo grande.' };
    } else if (o.op !== 'delete') return { ok: false, code: 'invalid-argument', message: 'Operazione non valida.' };
  }
  let res;
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const sh = sheet_(DATA_SHEET, DATA_HEAD);
    const n = sh.getLastRow() - 1;
    const keys = n > 0 ? sh.getRange(2, 1, n, 2).getValues() : [];
    const index = {};
    keys.forEach(function (k, i) { index[k[0] + '/' + k[1]] = i + 2; });
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      if (!o.limited) continue;
      const row = index[o.col + '/' + o.id];
      if (!row) return { ok: false, code: 'permission-denied', message: 'Puoi solo segnare i piatti fatti.' };
      const cur = sh.getRange(row, 3, 1, 3).getValues()[0];
      let old = null; try { old = JSON.parse(String(cur[0])); } catch (e) {}
      if (!old || cur[2] === true || cur[2] === 'TRUE' || !pizzaOnly_(old, o.data))
        return { ok: false, code: 'permission-denied', message: 'Puoi solo segnare i piatti fatti.' };
    }
    let ver = Math.max(Date.now(), version_() + 1);
    const appends = [];
    ops.forEach(function (o) {
      const k = o.col + '/' + o.id;
      const row = [o.col, String(o.id), o.op === 'set' ? o.json : '', ver, o.op === 'delete', me.name];
      if (index[k]) sh.getRange(index[k], 1, 1, row.length).setValues([row]);
      else if (o.op === 'set') { appends.push(row); index[k] = -1; }
    });
    if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, DATA_HEAD.length).setValues(appends);
    setVersion_(ver);
    if (ops.some(function (o) { return o.col === 'menu' || o.col === 'settings'; })) CacheService.getScriptCache().remove('PUBMENU');
    res = { ok: true, now: ver };
  } finally { lock.releaseLock(); }
  maintenance_();
  return res;
}

/* ---------- pizzeria ---------- */
function canon_(v) {
  if (Array.isArray(v)) return '[' + v.map(canon_).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(function (k) { return v[k] !== undefined; })
    .map(function (k) { return JSON.stringify(k) + ':' + canon_(v[k]); }).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
// Vero se tra il vecchio e il nuovo ordine cambiano solo i campi "pizza fatta".
function pizzaOnly_(oldD, newD) {
  const strip = function (d) {
    const c = JSON.parse(JSON.stringify(d || {}));
    (c.items || []).forEach(function (it) { delete it.doneQty; delete it.doneAt; delete it.doneBy; });
    return c;
  };
  return canon_(strip(oldD)) === canon_(strip(newD));
}

/* ---------- archivio, backup, menu pubblico ---------- */
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k); }
function setProp_(k, v) { PropertiesService.getScriptProperties().setProperty(k, v); }
function epoch_() {
  const c = CacheService.getScriptCache(), v = c.get('EPOCH');
  if (v !== null && v !== undefined) return Number(v);
  const p = Number(prop_('EPOCH') || 0);
  c.put('EPOCH', String(p), 21600);
  return p;
}
function today_() { return Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd'); }
function minusDays_(day, n) {
  const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
// Una volta al giorno, alla prima modifica: archivia i dati vecchi e salva un backup su Drive.
function maintenance_() {
  const day = today_(), c = CacheService.getScriptCache();
  if (c.get('MAINT') === day) return;
  if (prop_('MAINT_DAY') === day) { c.put('MAINT', day, 21600); return; }
  setProp_('MAINT_DAY', day); c.put('MAINT', day, 21600);
  try { archive_(day); setProp_('ARCHIVE_ERR', ''); } catch (e) { setProp_('ARCHIVE_ERR', String(e && e.message || e)); }
  try { backup_(day); setProp_('BACKUP_ERR', ''); } catch (e) { setProp_('BACKUP_ERR', String(e && e.message || e)); }
}
function archive_(day) {
  const lock = LockService.getScriptLock(); lock.waitLock(25000);
  try {
    const sh = sheet_(DATA_SHEET, DATA_HEAD), n = sh.getLastRow() - 1;
    if (n <= 0) return;
    const rows = sh.getRange(2, 1, n, DATA_HEAD.length).getValues(), now = Date.now();
    const keep = [], move = [];
    let purged = 0;
    rows.forEach(function (r) {
      const col = String(r[0]), deleted = r[4] === true || r[4] === 'TRUE';
      if (deleted) { if (now - Number(r[3]) > 7 * 864e5) { purged++; return; } keep.push(r); return; }
      const days = KEEP_DAYS[col];
      if (!days) { keep.push(r); return; }
      let d = null; try { d = JSON.parse(String(r[2])).date; } catch (e) {}
      if (d && d < minusDays_(day, days)) move.push(r); else keep.push(r);
    });
    if (!move.length && !purged) return;
    if (move.length) { const ar = sheet_(ARCHIVE_SHEET, DATA_HEAD); ar.getRange(ar.getLastRow() + 1, 1, move.length, DATA_HEAD.length).setValues(move); }
    sh.getRange(2, 1, n, DATA_HEAD.length).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, DATA_HEAD.length).setValues(keep);
    const ep = Date.now();
    setProp_('EPOCH', String(ep)); CacheService.getScriptCache().put('EPOCH', String(ep), 21600);
    setVersion_(Math.max(ep, version_() + 1));
    setProp_('LAST_ARCHIVE', JSON.stringify({ at: ep, moved: move.length, purged: purged }));
  } finally { lock.releaseLock(); }
}
function allDocs_() {
  const out = { maps: {}, res: {}, settings: {}, menu: {}, orders: {}, bills: {} };
  [ARCHIVE_SHEET, DATA_SHEET].forEach(function (name) {
    const sh = SpreadsheetApp.getActive().getSheetByName(name); if (!sh) return;
    rows_(sh, DATA_HEAD.length).forEach(function (r) {
      if (r[4] === true || r[4] === 'TRUE') return;
      let d; try { d = JSON.parse(String(r[2])); } catch (e) { return; }
      const col = String(r[0]), id = String(r[1]);
      if (col === 'reservations') out.res[id] = Object.assign({ id: id }, d);
      else if (col === 'settings') { if (id === 'main') out.settings = d; }
      else if (out[col]) out[col][id] = d;
    });
  });
  return out;
}
// Backup con il servizio avanzato Drive (v3) e il permesso "drive.file":
// lo script vede solo la cartella e i file che crea lui, non il resto del tuo Drive.
function backupFolder_() {
  const fid = prop_('BACKUP_FOLDER');
  if (fid) { try { const f = Drive.Files.get(fid, { fields: 'id,trashed' }); if (!f.trashed) return fid; } catch (e) {} }
  const f = Drive.Files.create({ name: 'il Casato · Backup', mimeType: 'application/vnd.google-apps.folder' });
  setProp_('BACKUP_FOLDER', f.id);
  return f.id;
}
function backup_(day) {
  const fid = backupFolder_();
  const name = 'backup-il-casato-' + day + '.json', json = JSON.stringify(allDocs_());
  const list = Drive.Files.list({ q: "'" + fid + "' in parents and trashed = false", fields: 'files(id,name,createdTime)', pageSize: 200 }).files || [];
  const limit = Date.now() - BACKUP_DAYS * 864e5;
  list.forEach(function (f) { if (f.name === name || new Date(f.createdTime).getTime() < limit) Drive.Files.update({ trashed: true }, f.id); });
  Drive.Files.create({ name: name, parents: [fid], mimeType: 'application/json' }, Utilities.newBlob(json, 'application/json', name));
  setProp_('LAST_BACKUP', JSON.stringify({ at: Date.now(), name: name, size: json.length }));
}
function query_(me, req) {
  if (level_(me) < LEVEL.cameriere) return { ok: false, code: 'permission-denied', message: 'Account in attesa di approvazione.' };
  const col = String(req.col || ''), from = String(req.from || ''), to = String(req.to || '9999');
  if (['reservations', 'bills', 'orders'].indexOf(col) < 0) return { ok: false, code: 'invalid-argument', message: 'Collezione non valida.' };
  const found = {};
  [ARCHIVE_SHEET, DATA_SHEET].forEach(function (name) {
    const sh = SpreadsheetApp.getActive().getSheetByName(name); if (!sh) return;
    rows_(sh, DATA_HEAD.length).forEach(function (r) {
      if (String(r[0]) !== col) return;
      const id = String(r[1]);
      if (r[4] === true || r[4] === 'TRUE') { delete found[id]; return; }
      let d; try { d = JSON.parse(String(r[2])); } catch (e) { return; }
      if (d && d.date >= from && d.date <= to) found[id] = Object.assign({ id: id }, d); else delete found[id];
    });
  });
  return { ok: true, docs: Object.keys(found).slice(0, 5000).map(function (k) { return found[k]; }) };
}
function status_(me) {
  if (level_(me) < LEVEL.admin) return { ok: false, code: 'permission-denied', message: 'Solo l\'amministratore.' };
  const parse = function (k) { try { return JSON.parse(prop_(k) || 'null'); } catch (e) { return null; } };
  let folderUrl = '';
  try { const fid = prop_('BACKUP_FOLDER'); if (fid) folderUrl = 'https://drive.google.com/drive/folders/' + fid; } catch (e) {}
  const ar = SpreadsheetApp.getActive().getSheetByName(ARCHIVE_SHEET);
  return { ok: true, version: SCRIPT_VERSION, lastBackup: parse('LAST_BACKUP'), lastArchive: parse('LAST_ARCHIVE'),
    backupErr: prop_('BACKUP_ERR') || '', archiveErr: prop_('ARCHIVE_ERR') || '', folderUrl: folderUrl,
    rows: Math.max(0, sheet_(DATA_SHEET, DATA_HEAD).getLastRow() - 1), archiveRows: ar ? Math.max(0, ar.getLastRow() - 1) : 0 };
}
function publicMenu_() {
  const c = CacheService.getScriptCache(), hit = c.get('PUBMENU');
  if (hit) return JSON.parse(hit);
  const dishes = [], extras = []; let settings = {};
  rows_(sheet_(DATA_SHEET, DATA_HEAD), DATA_HEAD.length).forEach(function (r) {
    if (r[4] === true || r[4] === 'TRUE') return;
    const col = String(r[0]);
    if (col !== 'menu' && !(col === 'settings' && String(r[1]) === 'main')) return;
    let d; try { d = JSON.parse(String(r[2])); } catch (e) { return; }
    if (col === 'settings') { settings = d; return; }
    if (d.kind === 'extra') extras.push({ name: d.name, price: d.price, cats: d.cats || [] });
    else dishes.push({ name: d.name, cat: d.cat, price: d.price, ingredients: d.ingredients || [], desc: d.desc || '',
      allergens: d.allergens || [], available: d.available !== false, pos: d.pos || 0 });
  });
  const res = { ok: true, restaurant: settings.restaurant || 'il Casato', cover: Number(settings.coverPrice || 0), dishes: dishes, extras: extras };
  try { c.put('PUBMENU', JSON.stringify(res), 120); } catch (e) {}
  return res;
}
