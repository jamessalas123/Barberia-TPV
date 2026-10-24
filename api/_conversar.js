/*
 * Conversación natural SIN IA (reglas): entiende frases como
 *   "quiero una cita mañana por la tarde", "¿qué horas tenéis el viernes?", "a las 5 con Pedro", "cancela mi cita".
 * Va rellenando datos poco a poco (servicio, día, hora, profesional) y pide confirmación antes de reservar/cancelar.
 * Función pura: recibe el texto y el estado anterior, devuelve respuesta, acción (si procede) y estado nuevo.
 */
const { huecosLibres, horarioDia } = require('./_huecos.js');

const MAX_DIAS = 60;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/(\d)[:.](\d)/g, '$1\u0001$2')           // protege 10:30 y 10.30
  .replace(/[¿?¡!.,;:()"“”]/g, ' ').replace(/\u0001/g, ':').replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (min) => pad(Math.floor(min / 60)) + ':' + pad(min % 60);
const aMin = (h) => { const [a, b] = String(h).split(':'); return (+a) * 60 + (+b || 0); };
const sumaDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const bonita = (f) => new Date(f + 'T12:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const DIAS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

/* ── Extracción de datos del texto ─────────────────────────── */
function extraerFecha(t, hoy) {
  // t ya normalizado y sin "por la mañana"
  if (/\bpasado manana\b/.test(t)) return sumaDias(hoy, 2);
  if (/\bmanana\b/.test(t)) return sumaDias(hoy, 1);
  if (/\bhoy\b/.test(t)) return hoy;
  for (const [n, d] of Object.entries(DIAS)) {
    if (new RegExp('\\b' + n + '\\b').test(t)) {
      const dow = new Date(hoy + 'T12:00:00Z').getUTCDay();
      let k = (d - dow + 7) % 7; if (k === 0) k = 7;
      if (/\bproximo\b|\bque viene\b/.test(t) && k < 7 && new Date(sumaDias(hoy, k) + 'T12:00:00Z').getUTCDay() === d && k <= 7 - 0) { /* "el próximo lunes" = el siguiente lunes */ }
      return sumaDias(hoy, k);
    }
  }
  let m = t.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (m) {
    let y = m[3] ? +m[3] : +hoy.slice(0, 4); if (y < 100) y += 2000;
    let f = `${y}-${pad(m[2])}-${pad(m[1])}`;
    if (!m[3] && f < hoy) f = `${y + 1}-${pad(m[2])}-${pad(m[1])}`;
    return new Date(f + 'T12:00:00Z').toISOString().slice(0, 10) === f ? f : null;
  }
  m = t.match(/\b(?:el dia|el|dia)\s+(\d{1,2})\b(?!\s*(?:h|horas|:))/);
  if (m && +m[1] >= 1 && +m[1] <= 31) {
    const [y0, mo0] = [+hoy.slice(0, 4), +hoy.slice(5, 7)];
    for (let i = 0; i < 3; i++) {
      const d0 = new Date(Date.UTC(y0, mo0 - 1 + i, +m[1], 12));
      const f = d0.toISOString().slice(0, 10);
      if (d0.getUTCDate() === +m[1] && f >= hoy) return f;
    }
  }
  return null;
}

function extraerHora(t) {
  let m = t.match(/\b(\d{1,2})[:.](\d{2})\b/);
  if (m) { let h = +m[1]; const mi = +m[2]; if (h <= 24 && mi < 60) return ajusteTarde(h, mi, t); }
  m = t.match(/\b(?:a )?las? (\d{1,2})(?: y (media|cuarto)| menos cuarto)?(?!\s*(?:de|d)\s*\d)/);
  if (m) {
    let h = +m[1]; let mi = 0;
    if (m[2] === 'media') mi = 30; else if (m[2] === 'cuarto') mi = 15; else if (/menos cuarto/.test(m[0])) { h -= 1; mi = 45; }
    if (h <= 24) return ajusteTarde(h, mi, t);
  }
  m = t.match(/\b(\d{1,2})\s?(?:h|hs|horas)\b/);
  if (m && +m[1] <= 24) return ajusteTarde(+m[1], 0, t);
  if (/\bmediodia\b/.test(t)) return '12:00';
  return null;
}
function ajusteTarde(h, mi, t) {
  if (/de la tarde|de la noche|\bpm\b/.test(t) && h < 12) h += 12;
  else if (!/de la manana|\bam\b/.test(t) && h >= 1 && h <= 8) h += 12; // en un negocio, "a las 5" = 17:00
  return h <= 24 ? pad(h % 24) + ':' + pad(mi) : null;
}

function extraerFranja(t) {
  const f = {};
  if (/por la tarde|de tarde|en la tarde|\btarde\b/.test(t)) f.desde = '15:00';
  if (/por la manana|de manana|en la manana/.test(t)) f.hasta = '14:00';
  if (/por la noche|de noche/.test(t)) f.desde = '19:00';
  let m = t.match(/despues de las? (\d{1,2})(?:[:.](\d{2}))?/);
  if (m) { let h = +m[1]; if (h >= 1 && h <= 8) h += 12; f.desde = hhmm(h * 60 + (+m[2] || 0)); }
  m = t.match(/antes de las? (\d{1,2})(?:[:.](\d{2}))?/);
  if (m) { let h = +m[1]; if (h >= 1 && h <= 8) h += 12; f.hasta = hhmm(h * 60 + (+m[2] || 0)); }
  return f;
}

function extraerServicio(t, servicios) {
  const num = t.match(/\b(?:la|el|numero|servicio|opcion)\s+(\d)\b(?!\s*(?:de|d)\b)/);
  if (num && +num[1] >= 1 && +num[1] <= servicios.length && !/\bdia\b/.test(t.slice(Math.max(0, num.index - 4), num.index + 2))) return { i: +num[1] - 1 };
  const hits = [];
  servicios.forEach((s, i) => {
    const n = norm(s.nombre);
    if (!n) return;
    if (t.includes(n)) { hits.push(i); return; }
    const palabras = n.split(' ').filter(w => w.length >= 5);
    if (palabras.some(w => new RegExp('\\b' + w.slice(0, Math.max(5, w.length - 2))).test(t))) hits.push(i);
  });
  return hits.length === 1 ? { i: hits[0] } : hits.length > 1 ? { ambiguo: hits } : null;
}
function extraerProfesional(t, equipo) {
  const hits = equipo.filter(p => new RegExp('\\b' + norm(p).replace(/[^a-z0-9 ]/g, '') + '\\b').test(t));
  return hits.length === 1 ? hits[0] : null;
}

const SI = /^(si|sii+|vale|ok|okay|okey|dale|claro|perfecto|confirmo|confirmado|de acuerdo|correcto|eso es|adelante|por favor|si por favor|si gracias|si confirmo)( .*)?$/;
const NO = /^(no|nop|mejor no|nada|olvidalo|déjalo|dejalo|cancela eso|no gracias)( .*)?$/;

function intencion(t) {
  if (/\b(persona|humano|hablar con alguien|hablar con el|encargad[oa]|dueno|dueña)\b/.test(t)) return 'persona';
  if (/\b(cancel|anul|borra)/.test(t) && !/\b(cuando|cuanto)\b/.test(t)) return 'cancelar';
  if (/\b(mis citas|mi cita|que citas|cuando tengo|tengo cita|tengo alguna cita|cita tengo|proxima cita)\b/.test(t)) return 'mis_citas';
  if (/\b(servicios|precios?|tarifas?|cuanto (cuesta|vale|cobran|es)|que (ofrecen|ofrecéis|ofreceis|hacen|haceis|tienen|tenéis|teneis)|carta)\b/.test(t)) return 'servicios';
  if (/\b(tienes|teneis|tienen|hay|queda|quedan|tendrias|tendriais) (alguna |algun |una )?(cita|hueco|hora|libre)/.test(t)) return 'huecos';
  if (/\b(horas?|huecos?|hueco|disponib|libres?|que hay|cuando (puedo|podria|tienen|tenéis)|a que hora|que horarios?)\b/.test(t)) return 'huecos';
  if (/\b(cita|citas|reserv\w*|agend\w*|apunt\w*|necesito|quiero|quisiera|pedir|podria|puedo|hora para|turno)\b/.test(t)) return 'reservar';
  if (/^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|ey|saludos|que tal)\b/.test(t)) return 'saludo';
  if (/^(gracias|muchas gracias|ok gracias|genial gracias|vale gracias)\b/.test(t)) return 'gracias';
  return null;
}

/* ── Conversación ───────────────────────────────────────────── */
function conversar({ texto, estado, ctx }) {
  const { ahora, negocio } = ctx;
  const hoy = ahora.fecha;
  const nom = negocio.nombre || 'el negocio';
  const servicios = negocio.servicios || [];
  const equipo = (negocio.equipo || []).filter(Boolean);
  const citasCliente = (ctx.citasCliente || []).filter(c => c.status === 'scheduled');
  let t = norm(texto);
  const t2 = t.replace(/\b(por|de|en) la manana\b/g, ' ').replace(/\s+/g, ' ');
  const e = Object.assign({}, estado || {});
  const R = (respuesta, nuevo, accion) => ({ respuesta, accion, estado: nuevo === undefined ? null : nuevo });

  /* Confirmaciones pendientes */
  if (e.confirmar === 'reservar' && SI.test(t)) {
    const c = e.cita;
    return R(`Reservado ✅\n${c.service} · ${bonita(c.appointment_date)} a las ${c.start_time.slice(0, 5)}${c.barbero ? ' con ' + c.barbero : ''}.\nSi no puedes venir, avísame y la cancelo.`, null, { tipo: 'crear', cita: { ...c, client_name: ctx.nombreCliente || 'Cliente WhatsApp', notes: 'wa:' + ctx.telefono } });
  }
  if (e.confirmar === 'cancelar' && SI.test(t)) {
    const c = citasCliente.find(x => x.id === e.id);
    if (!c) return R('No encuentro esa cita. Escribe "mis citas" para verlas.', null);
    return R(`Hecho ✅ He cancelado tu cita del ${bonita(c.appointment_date)} a las ${c.start_time.slice(0, 5)}.`, null, { tipo: 'cancelar', id: c.id });
  }
  if (e.confirmar && NO.test(t)) return R('Vale, no hago nada. ¿Te ayudo con otra cosa?', null);

  let intent = intencion(t2);
  const fecha = extraerFecha(t2, hoy);
  const hora = extraerHora(t2);
  const franja = extraerFranja(t2);
  const sv = servicios.length ? extraerServicio(t2, servicios) : null;
  const prof = extraerProfesional(t2, equipo);
  const hayDatos = fecha || hora || sv || prof || franja.desde || franja.hasta;
  if (!intent && !estado && [fecha, hora, sv && sv.i !== undefined].filter(Boolean).length >= 2) intent = 'reservar';

  if (intent === 'persona') return R(`De momento no puedo avisar a una persona desde aquí. Contacta directamente con ${nom}. Gracias por tu paciencia 🙏`, null);
  if (intent === 'gracias' && !estado) return R('¡A ti! Aquí estoy para lo que necesites 😊', null);
  if (intent === 'servicios') {
    if (!servicios.length) return R('Aún no hay servicios configurados.', null);
    return R('Esto es lo que ofrecemos:\n' + servicios.map(s => `• ${s.nombre} · ${s.duracion_min || 30} min · ${Number(s.precio)} €`).join('\n') + '\n\n¿Quieres que te busque hueco?', null);
  }
  if (intent === 'mis_citas') {
    if (!citasCliente.length) return R('Ahora mismo no tienes citas próximas. ¿Quieres pedir una?', null);
    return R('Tus próximas citas:\n' + citasCliente.map(c => `• ${bonita(c.appointment_date)} a las ${c.start_time.slice(0, 5)}${c.service ? ' · ' + c.service : ''}${c.barbero ? ' con ' + c.barbero : ''}`).join('\n'), null);
  }
  if (intent === 'cancelar') {
    let c = citasCliente;
    if (fecha) c = c.filter(x => x.appointment_date === fecha);
    if (!c.length) return R(fecha ? 'No tienes ninguna cita ese día.' : 'No tienes citas próximas que cancelar.', null);
    if (c.length > 1) return R('¿Cuál quieres cancelar? Dime el día:\n' + c.map(x => `• ${bonita(x.appointment_date)} a las ${x.start_time.slice(0, 5)}`).join('\n'), { confirmar: 'cancelar_cual' });
    return R(`¿Cancelo tu cita del ${bonita(c[0].appointment_date)} a las ${c[0].start_time.slice(0, 5)}${c[0].service ? ' (' + c[0].service + ')' : ''}? Responde SÍ para confirmar.`, { confirmar: 'cancelar', id: c[0].id, ts: Date.now() });
  }
  if (e.confirmar === 'cancelar_cual' && fecha) {
    const c = citasCliente.filter(x => x.appointment_date === fecha);
    if (c.length === 1) return R(`¿Cancelo tu cita del ${bonita(c[0].appointment_date)} a las ${c[0].start_time.slice(0, 5)}? Responde SÍ para confirmar.`, { confirmar: 'cancelar', id: c[0].id, ts: Date.now() });
  }

  /* Reservar / ver huecos: vamos completando datos */
  const enCurso = e.intent === 'reservar' && estado && !e.confirmar;
  if (intent === 'huecos' || intent === 'reservar' || (enCurso && hayDatos) || (e.confirmar === 'reservar' && hayDatos)) {
    const d = (e.confirmar === 'reservar' || enCurso) ? { ...e, confirmar: undefined, cita: undefined } : { };
    d.intent = 'reservar';
    if (sv && sv.i !== undefined) d.servicio = servicios[sv.i].nombre;
    if (fecha) d.fecha = fecha;
    if (hora) { d.hora = hora; }
    if (franja.desde || franja.hasta) { d.desde = franja.desde; d.hasta = franja.hasta; if (!hora) delete d.hora; }
    if (prof) d.profesional = prof;
    if (intent === 'huecos' && !hora) delete d.hora;
    if (hora) { delete d.desde; delete d.hasta; }

    if (!servicios.length) return R('Aún no hay servicios configurados.', null);
    // servicio
    let serv = servicios.find(s => s.nombre === d.servicio);
    if (!serv && servicios.length === 1) { serv = servicios[0]; d.servicio = serv.nombre; }
    if (!serv) {
      const lista = servicios.map(s => `• ${s.nombre} (${s.duracion_min || 30} min)`).join('\n');
      return R(`¡Claro! ¿Qué servicio quieres?\n${lista}`, { ...d, ts: Date.now() });
    }
    // día
    if (!d.fecha) return R(`Perfecto, ${serv.nombre}. ¿Para qué día? (por ejemplo: mañana, el viernes o el 28)`, { ...d, ts: Date.now() });
    if (d.fecha < hoy) return R('Esa fecha ya pasó. ¿Para qué día la quieres?', { ...d, fecha: undefined, ts: Date.now() });
    if (d.fecha > sumaDias(hoy, MAX_DIAS)) return R(`Solo puedo reservar con hasta ${MAX_DIAS} días de antelación. ¿Para qué otro día?`, { ...d, fecha: undefined, ts: Date.now() });
    if (horarioDia(negocio.horario, d.fecha) === null) return R(`El ${bonita(d.fecha)} estamos cerrados. ¿Probamos otro día?`, { ...d, fecha: undefined, ts: Date.now() });

    if (equipo.length === 1) d.profesional = equipo[0];
    const dur = serv.duracion_min || 30;
    const citas = ctx.citasDia(d.fecha);
    const calc = (p) => huecosLibres({ fecha: d.fecha, duracion: dur, horario: negocio.horario, citas, profesional: p, ahora });
    const pros = equipo.length ? (d.profesional ? [d.profesional] : equipo) : [null];
    const lo = d.desde ? aMin(d.desde) : -1, hi = d.hasta ? aMin(d.hasta) : 1440;
    const filtrar = (hs) => hs.filter(h => aMin(h) >= lo && aMin(h) <= hi);

    if (!d.hora) {
      const lineas = pros.map(p => ({ p, hs: filtrar(calc(p)) }));
      if (!lineas.some(l => l.hs.length)) {
        const todo = pros.some(p => calc(p).length);
        return R(`${todo ? 'En esa franja' : 'Ese día'} no me quedan huecos para ${serv.nombre}. ¿Probamos otro ${todo ? 'horario' : 'día'}?`, { ...d, fecha: todo ? d.fecha : undefined, desde: undefined, hasta: undefined, ts: Date.now() });
      }
      const txt = lineas.filter(l => l.hs.length).map(l => `${l.p ? l.p + ': ' : ''}${l.hs.slice(0, 12).join(', ')}${l.hs.length > 12 ? '…' : ''}`).join('\n');
      return R(`${serv.nombre} (${dur} min) · ${bonita(d.fecha)}\nHoras libres:\n${txt}\n\n¿A qué hora te viene bien${equipo.length > 1 && !d.profesional ? ' y con quién' : ''}?`, { ...d, ts: Date.now() });
    }
    // hay hora
    if (equipo.length > 1 && !d.profesional) {
      const libres = equipo.filter(p => calc(p).includes(d.hora));
      if (!libres.length) {
        const alt = [...new Set(equipo.flatMap(p => filtrar(calc(p))))].sort().slice(0, 12);
        return R(`A las ${d.hora} no hay hueco ese día. ${alt.length ? 'Tengo libres: ' + alt.join(', ') + '. ¿Cuál prefieres?' : 'No quedan huecos. ¿Probamos otro día?'}`, { ...d, hora: undefined, ts: Date.now() });
      }
      if (libres.length === 1) d.profesional = libres[0];
      else return R(`A las ${d.hora} puedo con ${libres.join(' o ')}. ¿Con quién prefieres?`, { ...d, ts: Date.now() });
    }
    const p = equipo.length ? d.profesional : null;
    if (!calc(p).includes(d.hora)) {
      const alt = filtrar(calc(p)).slice(0, 12);
      return R(`A las ${d.hora}${p ? ' con ' + p : ''} no está libre. ${alt.length ? 'Tengo libres: ' + alt.join(', ') + '. ¿Cuál prefieres?' : 'No quedan huecos. ¿Probamos otro día?'}`, { ...d, hora: undefined, ts: Date.now() });
    }
    const cita = { barbero: p, service: serv.nombre, appointment_date: d.fecha, start_time: d.hora + ':00', duration_minutes: dur, status: 'scheduled' };
    return R(`¿Te reservo ${serv.nombre} el ${bonita(d.fecha)} a las ${d.hora}${p ? ' con ' + p : ''}? Responde SÍ para confirmar.`, { ...d, intent: 'reservar', confirmar: 'reservar', cita, ts: Date.now() });
  }

  if (intent === 'saludo') return R(`¡Hola! 👋 Soy el asistente virtual de ${nom}. Puedo ayudarte a pedir cita, ver horas libres, consultar tus citas o cancelarlas. Escríbeme con tus palabras, por ejemplo: "quiero una cita mañana por la tarde". ¿Qué necesitas?`, null);
  return R(`No estoy seguro de haberte entendido 🙈 Puedo ayudarte con:\n• Pedir una cita ("quiero una cita el viernes")\n• Ver horas libres ("¿qué horas hay mañana?")\n• Ver o cancelar tus citas\n• Ver servicios y precios\nSi prefieres hablar con una persona, contacta directamente con ${nom}.`, null);
}

module.exports = { conversar, extraerFecha, extraerHora, extraerFranja, norm };
