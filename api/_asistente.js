/*
 * Cerebro del asistente de citas por WhatsApp (v1: comandos fijos, SIN IA).
 * Función pura: recibe el mensaje y los datos del negocio y devuelve la respuesta
 * y, si procede, la acción a ejecutar en la base de datos. No toca la red.
 *
 * Comandos: SERVICIOS · HUECOS <servicio> [fecha] · RESERVAR <servicio> <fecha> <hora> [profesional]
 *           MIS CITAS · CANCELAR <código> · PERSONA · (cualquier otra cosa → ayuda)
 * Fechas: hoy, mañana, dd/mm, dd/mm/aaaa. Todas las horas en hora de Madrid.
 */
const { huecosLibres, SLOT } = require('./_huecos.js');

const MAX_DIAS = 60;
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const sumaDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
const bonita = (f) => new Date(f + 'T12:00:00Z').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function ahoraMadrid(fecha = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(fecha).map(x => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, min: (+p.hour) * 60 + (+p.minute) };
}

function parseFecha(tok, hoy) {
  const t = norm(tok);
  if (t === 'hoy') return hoy;
  if (t === 'manana') return sumaDias(hoy, 1);
  const m = t.match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (!m) return null;
  let y = m[3] ? +m[3] : +hoy.slice(0, 4);
  if (y < 100) y += 2000;
  let f = `${y}-${pad(m[2])}-${pad(m[1])}`;
  if (!m[3] && f < hoy) f = `${y + 1}-${pad(m[2])}-${pad(m[1])}`;
  const d = new Date(f + 'T12:00:00Z');
  if (isNaN(d) || ymd(d) !== f) return null;
  return f;
}
const esHora = (t) => /^\d{1,2}[:.]\d{2}$/.test(t);
const normHora = (t) => { const [h, m] = t.split(/[:.]/); return `${pad(+h)}:${m}`; };

function buscarServicio(servicios, tok) {
  if (!tok) return null;
  if (/^\d+$/.test(tok)) return servicios[+tok - 1] || null;
  const t = norm(tok);
  return servicios.find(s => norm(s.nombre).startsWith(t)) || servicios.find(s => norm(s.nombre).includes(t)) || null;
}
const AYUDA = (nombre) => `Hola 👋 Soy el asistente virtual de ${nombre}. Puedo ayudarte con tu cita:\n\n• SERVICIOS – ver lo que ofrecemos\n• HUECOS 1 mañana – horas libres (servicio 1, mañana)\n• RESERVAR 1 mañana 10:30 – reservar\n• MIS CITAS – ver tus próximas citas\n• CANCELAR código – cancelar una cita\n• PERSONA – hablar con una persona`;

function equipoDe(negocio) { return Array.isArray(negocio.equipo) ? negocio.equipo.filter(Boolean) : []; }

/**
 * @param {object} e
 *  texto, telefono (del cliente), nombre (perfil de WhatsApp), ahora ({fecha,min})
 *  negocio: {nombre, horario, equipo:[], servicios:[{id,nombre,precio,duracion_min}]}
 *  citasDia(fecha) -> [{start_time,duration_minutes,status,barbero}]   (todas las del negocio ese día)
 *  citasCliente    -> [{id,appointment_date,start_time,service,barbero,status}] próximas del cliente
 * @returns {{respuesta:string, accion?:object}}
 */
function procesar({ texto, telefono, nombre, ahora, negocio, citasDia, citasCliente = [] }) {
  const nom = negocio.nombre || 'el negocio';
  const servicios = (negocio.servicios || []);
  const equipo = equipoDe(negocio);
  const tokens = String(texto || '').trim().split(/\s+/).filter(Boolean);
  const cmd = norm(tokens[0]);
  const args = tokens.slice(1);
  const hoy = ahora.fecha;

  if (cmd === 'persona') return { respuesta: `De momento no puedo avisar a una persona desde aquí. Contacta directamente con ${nom}. Gracias por tu paciencia 🙏` };

  if (cmd === 'servicios') {
    if (!servicios.length) return { respuesta: 'Aún no hay servicios configurados.' };
    return { respuesta: 'Servicios:\n' + servicios.map((s, i) => `${i + 1}. ${s.nombre} · ${s.duracion_min || 30} min · ${Number(s.precio)} €`).join('\n') };
  }

  if (cmd === 'mis' || cmd === 'citas') {
    const prox = citasCliente.filter(c => c.status === 'scheduled');
    if (!prox.length) return { respuesta: 'No tienes citas próximas.' };
    return { respuesta: 'Tus citas:\n' + prox.map(c => `• ${bonita(c.appointment_date)} ${c.start_time.slice(0, 5)}${c.service ? ' · ' + c.service : ''}${c.barbero ? ' · ' + c.barbero : ''} (cancelar: CANCELAR ${c.id.slice(0, 4)})`).join('\n') };
  }

  if (cmd === 'cancelar') {
    const cod = norm(args[0]);
    if (!cod || cod.length < 4) return { respuesta: 'Dime el código de la cita, por ejemplo: CANCELAR a1b2. Lo ves escribiendo MIS CITAS.' };
    const c = citasCliente.filter(x => x.status === 'scheduled' && x.id.toLowerCase().startsWith(cod));
    if (c.length !== 1) return { respuesta: 'No encuentro esa cita entre las tuyas. Escribe MIS CITAS para ver los códigos.' };
    return { respuesta: `Hecho ✅ He cancelado tu cita del ${bonita(c[0].appointment_date)} a las ${c[0].start_time.slice(0, 5)}.`, accion: { tipo: 'cancelar', id: c[0].id } };
  }

  if (cmd === 'huecos' || cmd === 'reservar') {
    const reservar = cmd === 'reservar';
    if (!servicios.length) return { respuesta: 'Aún no hay servicios configurados.' };
    const serv = buscarServicio(servicios, args[0]);
    if (!serv) return { respuesta: `No reconozco el servicio. Escribe SERVICIOS para ver la lista y usa su número, por ejemplo: ${reservar ? 'RESERVAR 1 mañana 10:30' : 'HUECOS 1 mañana'}.` };
    const resto = args.slice(1);
    let fecha = hoy, hora = null, prof = null;
    const sobrantes = [];
    for (const t of resto) {
      if (esHora(t)) hora = normHora(t);
      else if (parseFecha(t, hoy)) fecha = parseFecha(t, hoy);
      else sobrantes.push(t);
    }
    if (reservar && !hora) return { respuesta: 'Indica la hora, por ejemplo: RESERVAR 1 mañana 10:30. Mira las horas con HUECOS.' };
    if (sobrantes.length) {
      const q = norm(sobrantes.join(' '));
      prof = equipo.find(p => norm(p).startsWith(q)) || null;
      if (!prof) return { respuesta: `No reconozco "${sobrantes.join(' ')}". ${equipo.length ? 'Profesionales: ' + equipo.join(', ') + '.' : ''}` };
    }
    if (fecha < hoy) return { respuesta: 'Esa fecha ya pasó. Prueba con hoy, mañana o una fecha como 25/10.' };
    if (fecha > sumaDias(hoy, MAX_DIAS)) return { respuesta: `Solo se puede reservar con hasta ${MAX_DIAS} días de antelación.` };
    const dur = serv.duracion_min || 30;
    const citas = citasDia(fecha);
    const pros = equipo.length ? (prof ? [prof] : equipo) : [null];
    const calc = (p) => huecosLibres({ fecha, duracion: dur, horario: negocio.horario, citas, profesional: p, ahora });

    if (!reservar) {
      const lineas = pros.map(p => { const h = calc(p); return `${p ? p + ': ' : ''}${h.length ? h.slice(0, 14).join(', ') + (h.length > 14 ? '…' : '') : 'sin huecos'}`; });
      const hay = pros.some(p => calc(p).length);
      return { respuesta: `${serv.nombre} (${dur} min) · ${bonita(fecha)}\n${lineas.join('\n')}${hay ? '\n\nPara reservar: RESERVAR ' + (servicios.indexOf(serv) + 1) + ' ' + (fecha === hoy ? 'hoy' : fecha.slice(8) + '/' + fecha.slice(5, 7)) + ' <hora>' + (equipo.length > 1 ? ' <profesional>' : '') : ''}` };
    }
    if (equipo.length > 1 && !prof) return { respuesta: `¿Con quién? Añade el nombre: ${equipo.join(', ')}. Ej: RESERVAR ${servicios.indexOf(serv) + 1} ${fecha === hoy ? 'hoy' : fecha.slice(8) + '/' + fecha.slice(5, 7)} ${hora} ${equipo[0]}` };
    const p = equipo.length ? (prof || equipo[0]) : null;
    if (!calc(p).includes(hora)) {
      const h = calc(p);
      return { respuesta: `Esa hora no está libre. ${h.length ? 'Horas libres: ' + h.slice(0, 14).join(', ') + '.' : 'No quedan huecos ese día.'}` };
    }
    return {
      respuesta: `Reservado ✅\n${serv.nombre} · ${bonita(fecha)} a las ${hora}${p ? ' con ' + p : ''}.\nSi no puedes venir, escribe MIS CITAS y cancélala.`,
      accion: { tipo: 'crear', cita: { client_name: nombre || 'Cliente WhatsApp', barbero: p, service: serv.nombre, appointment_date: fecha, start_time: hora + ':00', duration_minutes: dur, status: 'scheduled', notes: 'wa:' + telefono } }
    };
  }

  return { respuesta: AYUDA(nom) };
}

module.exports = { procesar, ahoraMadrid, parseFecha, SLOT };
