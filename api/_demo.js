/*
 * Demo de agente para un negocio de demostración (tabla `demos`).
 * SIN estado en el servidor: el navegador devuelve el historial y las citas de prueba en cada mensaje.
 * Nada se guarda en las agendas reales; las citas son de mentira.
 */
const { correrAgente, historialCompacto } = require('./_agente.js');
const { herramientas, instrucciones } = require('./_agente_citas.js');
const { huecosLibres } = require('./_huecos.js');
const { ahoraMadrid } = require('./_asistente.js');

const MAX_MENSAJE = 500, MAX_HIST = 12, MAX_CITAS = 20, MAX_MSG_DIA = 60;
const sumaDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function limpiarHistorial(h) {
  if (!Array.isArray(h)) return [];
  const out = h.filter(x => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string').slice(-MAX_HIST).map(x => ({ role: x.role, content: x.content.slice(0, 1500) }));
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}
function limpiarCitas(c) {
  if (!Array.isArray(c)) return [];
  return c.slice(0, MAX_CITAS).filter(x => x && /^\d{4}-\d{2}-\d{2}$/.test(x.appointment_date) && /^\d{2}:\d{2}/.test(x.start_time)).map(x => ({
    id: String(x.id || '').slice(0, 12), appointment_date: x.appointment_date, start_time: x.start_time, duration_minutes: Math.min(480, Math.max(5, +x.duration_minutes || 30)),
    status: x.status === 'cancelled' ? 'cancelled' : 'scheduled', barbero: x.barbero ? String(x.barbero).slice(0, 40) : null, service: String(x.service || '').slice(0, 60)
  }));
}
const idCita = () => Math.random().toString(16).slice(2, 10);

function negocioDeDemo(demo) {
  const c = demo.config || {};
  const info = (Array.isArray(c.faq) ? c.faq : []).slice(0, 15).map(f => `- ${String(f.p || '').slice(0, 150)}: ${String(f.r || '').slice(0, 400)}`).join('\n');
  return {
    nombre: demo.nombre, horario: c.horario || null, equipo: (c.equipo || []).slice(0, 10), info: [c.descripcion, info].filter(Boolean).join('\n'),
    servicios: (c.servicios || []).slice(0, 30).map(s => ({ nombre: String(s.nombre), precio: Number(s.precio) || 0, duracion_min: Math.min(480, Math.max(5, Number(s.duracion_min) || 30)) }))
  };
}

async function atenderDemo({ demo, mensaje, historial, citas, llm, ahora = ahoraMadrid() }) {
  const texto = String(mensaje || '').slice(0, MAX_MENSAJE).trim();
  if (!texto) return { error: 'mensaje vacío' };
  const negocio = negocioDeDemo(demo);
  let misCitas = limpiarCitas(citas);
  const tope = sumaDias(ahora.fecha, 61);
  const ctx = {
    ahora, negocio, telefono: 'demo', nombreCliente: 'Cliente demo',
    citasDia: f => misCitas.filter(c => c.appointment_date === f && c.status !== 'cancelled'),
    citasCliente: () => misCitas.filter(c => c.status === 'scheduled'),
    crearCita: async (c) => {
      if (c.appointment_date > tope || misCitas.length >= MAX_CITAS) return { ok: false, motivo: 'no se pudo guardar' };
      const libres = huecosLibres({ fecha: c.appointment_date, duracion: c.duration_minutes, horario: negocio.horario, citas: misCitas.filter(x => x.appointment_date === c.appointment_date && x.status !== 'cancelled'), profesional: c.barbero, ahora });
      if (!libres.includes(c.start_time.slice(0, 5))) return { ok: false, motivo: 'justo se acaba de ocupar ese hueco' };
      misCitas.push({ id: idCita(), appointment_date: c.appointment_date, start_time: c.start_time, duration_minutes: c.duration_minutes, status: 'scheduled', barbero: c.barbero, service: c.service });
      return { ok: true };
    },
    cancelarCita: async (id) => { const c = misCitas.find(x => x.id === id); if (!c) return { ok: false }; c.status = 'cancelled'; return { ok: true }; },
    avisarDueno: async () => ({ ok: true })
  };
  const sistema = instrucciones(ctx) + '\nNota: esto es una DEMOSTRACIÓN para el dueño del negocio; las citas son de prueba.';
  const r = await correrAgente({ llm, sistema, herramientas, ctx, historial: limpiarHistorial(historial), mensajeUsuario: texto });
  return { respuesta: r.texto || 'Perdona, no te he entendido. ¿Puedes repetirlo?', historial: historialCompacto(r.mensajes), citas: misCitas };
}

/* Controla caducidad, interruptor y tope diario. Devuelve {ok} o {error,status}. */
async function permitir(db, demo, hoy) {
  if (!demo || !demo.activa) return { error: 'Esta demostración no está disponible.', status: 404 };
  if (new Date(demo.expira_at).getTime() < Date.now()) return { error: 'Esta demostración ha caducado.', status: 410 };
  const usados = demo.dia === hoy ? demo.mensajes_dia : 0;
  if (usados >= MAX_MSG_DIA) return { error: 'Se alcanzó el límite de mensajes de hoy para esta demostración.', status: 429 };
  await db.from('demos').update({ dia: hoy, mensajes_dia: usados + 1 }).eq('codigo', demo.codigo);
  return { ok: true };
}

module.exports = { atenderDemo, permitir, negocioDeDemo, limpiarHistorial, limpiarCitas, MAX_MSG_DIA };
