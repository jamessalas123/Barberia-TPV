/*
 * Lectura segura de la web de un negocio (para rellenar una demo).
 * Protecciones: solo http/https, nada de IPs privadas ni localhost (también tras redirecciones),
 * tiempo y tamaño máximos, solo HTML. Devuelve texto plano recortado.
 */
const dns = require('dns').promises;
const net = require('net');

const MAX_BYTES = 1500000, TIMEOUT_MS = 8000, MAX_REDIR = 3, MAX_TEXTO = 14000;

function ipPrivada(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:') ;
}

async function validarUrl(u, resolver = dns.lookup) {
  let url;
  try { url = new URL(u); } catch (e) { throw new Error('La dirección no es válida.'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('Solo se admiten direcciones http o https.');
  if (url.username || url.password) throw new Error('La dirección no es válida.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) throw new Error('Esa dirección no está permitida.');
  if (net.isIP(host)) { if (ipPrivada(host)) throw new Error('Esa dirección no está permitida.'); return url; }
  const res = await resolver(host, { all: true });
  if (!res.length || res.some(r => ipPrivada(r.address))) throw new Error('Esa dirección no está permitida.');
  return url;
}

function aTexto(html) {
  let t = String(html);
  const titulo = (t.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  const desc = (t.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '';
  t = t.replace(/<(script|style|noscript|svg|iframe|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&euro;/g, '€').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&[a-z]+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return [titulo.trim(), desc.trim(), t].filter(Boolean).join('\n');
}

async function descargar(u, { resolver, fetchFn = fetch } = {}) {
  let actual = await validarUrl(u, resolver);
  for (let i = 0; i <= MAX_REDIR; i++) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let r;
    try { r = await fetchFn(actual.toString(), { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; EscaliaBot/1.0)', Accept: 'text/html' } }); }
    catch (e) { throw new Error('No se pudo abrir la web.'); } finally { clearTimeout(t); }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { actual = await validarUrl(new URL(r.headers.get('location'), actual).toString(), resolver); continue; }
    if (!r.ok) throw new Error('La web respondió con un error (' + r.status + ').');
    if (!/text\/html|application\/xhtml/i.test(r.headers.get('content-type') || '')) throw new Error('Esa dirección no es una página web.');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('La página es demasiado grande.');
    return { url: actual, html: buf.toString('utf8') };
  }
  throw new Error('Demasiadas redirecciones.');
}

/* Enlaces internos útiles (servicios, precios, horarios, contacto) */
function enlacesUtiles(html, base, max = 2) {
  const out = [];
  const re = /<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi; let m;
  while ((m = re.exec(html)) && out.length < max) {
    const txt = (m[2].replace(/<[^>]+>/g, ' ') + ' ' + m[1]).toLowerCase();
    if (!/servicio|tarifa|precio|contact|horario|carta|menu|tratamiento/.test(txt)) continue;
    try { const u = new URL(m[1], base); if (u.hostname === base.hostname && /^https?:$/.test(u.protocol) && u.href !== base.href && !out.includes(u.href)) out.push(u.href); } catch (e) { /* enlace roto */ }
  }
  return out;
}

async function leerWeb(u, opts = {}) {
  const home = await descargar(u, opts);
  let texto = aTexto(home.html);
  for (const l of enlacesUtiles(home.html, home.url)) {
    if (texto.length > MAX_TEXTO) break;
    try { const p = await descargar(l, opts); texto += '\n---\n' + aTexto(p.html); } catch (e) { /* subpágina no disponible: seguimos */ }
  }
  return { url: home.url.toString(), texto: texto.slice(0, MAX_TEXTO) };
}

module.exports = { leerWeb, validarUrl, aTexto, ipPrivada, enlacesUtiles };
