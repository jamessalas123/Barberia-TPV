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

module.exports = { huecosLibres, horarioDia, SLOT };
