/*
 * Huecos libres de la agenda (cálculo determinista, SIN IA).
 * El asistente de WhatsApp solo conversa: los huecos salen de aquí.
 *
 * Reglas (las mismas que usa la agenda de la app):
 *  - Horario: profiles.horario[díaSemana] = {a:'10:00',c:'20:00'}; null/ausente en ese día = cerrado.
 *    Si el negocio no ha definido horario (null) → 9:00–21:00 todos los días.
 *  - Las horas de inicio se ofrecen cada SLOT minutos (30).
 *  - Una cita ocupa [inicio, inicio+duración). Las citas 'cancelled' no ocupan.
 *  - Por profesional: solo cuentan las citas de ese profesional. Citas sin
 *    profesional (negocio individual) ocupan al único profesional.
 *  - Un hueco vale si el servicio termina antes del cierre y no se solapa con ninguna cita.
 *  - Si el día es hoy, no se ofrecen horas pasadas (+ margen en minutos).
 */
const SLOT = 30, DEF_S = 9 * 60, DEF_E = 21 * 60;

const aMin = (hhmm) => { const [h, m] = String(hhmm).split(':'); return (+h) * 60 + (+m || 0); };
const aHHMM = (min) => String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');

function horarioDia(horario, fecha) {
  if (!horario || typeof horario !== 'object') return { s: DEF_S, e: DEF_E };
  const d = horario[new Date(fecha + 'T12:00:00').getDay()];
  if (!d || !d.a || !d.c) return null;
  const s = aMin(d.a), e = aMin(d.c);
  return e > s ? { s, e } : null;
}

/**
 * @param {object} p
 *  fecha 'YYYY-MM-DD' · duracion minutos del servicio · horario (profiles.horario)
 *  citas [{start_time:'HH:MM:SS', duration_minutes, status, barbero}]
 *  profesional (nombre o null) · ahora {fecha:'YYYY-MM-DD', min:minutosDelDía} · margen minutos
 * @returns {string[]} horas 'HH:MM' libres
 */
function huecosLibres({ fecha, duracion, horario, citas = [], profesional = null, ahora = null, margen = 0 }) {
  const dur = Math.max(5, Math.min(480, Number(duracion) || 30));
  const h = horarioDia(horario, fecha);
  if (!h) return [];
  const ocupadas = citas
    .filter(c => c.status !== 'cancelled')
    .filter(c => !profesional || !c.barbero || c.barbero === profesional)
    .map(c => { const s = aMin(c.start_time); return [s, s + (Number(c.duration_minutes) || SLOT)]; });
  const minimo = ahora && ahora.fecha === fecha ? ahora.min + margen : -1;
  const out = [];
  for (let s = h.s; s + dur <= h.e; s += SLOT) {
    if (s < minimo) continue;
    const e = s + dur;
    if (ocupadas.some(([a, b]) => s < b && e > a)) continue;
    out.push(aHHMM(s));
  }
  return out;
}

/* ── Bloqueos de tiempo (cita médica, descanso, vacaciones…) ─────────────────────────────
 * Un bloqueo = {fecha, fecha_fin, hora_desde|null, hora_hasta|null, profesional|null, motivo}.
 * Sin horas = todo el día. Con horas = esas horas cada día del rango. profesional null = todo el negocio.
 * Se convierten en "citas" ficticias para que huecosLibres las trate como ocupado.
 */
const sumaDiasISO = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function bloqueosComoCitas(bloqueos, fecha) {
  return (bloqueos || [])
    .filter(b => b && b.fecha <= fecha && b.fecha_fin >= fecha)
    .map(b => {
      const todoDia = !b.hora_desde || !b.hora_hasta;
      const s = todoDia ? 0 : aMin(b.hora_desde), e = todoDia ? 24 * 60 : aMin(b.hora_hasta);
      return { start_time: aHHMM(s) + ':00', duration_minutes: Math.max(1, e - s), status: 'scheduled', barbero: b.profesional || null, bloqueo: true, motivo: b.motivo || null };
    });
}

/* Mapa fecha -> citas ficticias para un rango (tope de días para no pasarse) */
function bloqueosPorDia(bloqueos, desde, hasta) {
  const out = {};
  for (let f = desde, i = 0; f <= hasta && i < 70; f = sumaDiasISO(f, 1), i++) {
    const c = bloqueosComoCitas(bloqueos, f);
    if (c.length) out[f] = c;
  }
  return out;
}

module.exports = { huecosLibres, horarioDia, SLOT, bloqueosComoCitas, bloqueosPorDia };
