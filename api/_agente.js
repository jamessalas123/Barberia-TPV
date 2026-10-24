/*
 * Motor de agentes (común a todos los agentes de la caja digital).
 * Un agente = una IA que decide + herramientas reales que ejecutamos nosotros + límites.
 *
 * La IA NUNCA toca datos directamente: solo puede pedir llamar a herramientas definidas aquí,
 * y cada herramienta recibe un contexto (ctx) ya limitado a UN negocio y UN cliente.
 *
 * Formato de mensajes = el de la API de Anthropic (bloques text / tool_use / tool_result).
 * `llm` es una función ({system, messages, tools}) => {content:[bloques]}: real (api/_llm.js) o simulada (tests).
 */
const MAX_PASOS = 6;

const defsParaLLM = (herramientas) => Object.values(herramientas).map(({ name, description, input_schema }) => ({ name, description, input_schema }));
const textoDe = (content) => (content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();

async function correrAgente({ llm, sistema, herramientas, ctx, historial = [], mensajeUsuario, maxPasos = MAX_PASOS, registrar = null }) {
  const mensajes = [...historial, { role: 'user', content: mensajeUsuario }];
  const defs = defsParaLLM(herramientas);
  for (let paso = 0; paso < maxPasos; paso++) {
    const r = await llm({ system: sistema, messages: mensajes, tools: defs });
    mensajes.push({ role: 'assistant', content: r.content });
    const usos = (r.content || []).filter(b => b.type === 'tool_use');
    if (!usos.length) return { texto: textoDe(r.content), mensajes, pasos: paso + 1 };
    const resultados = [];
    for (const u of usos) {
      const h = herramientas[u.name];
      let res;
      if (!h) res = { error: 'herramienta desconocida' };
      else {
        try { res = await h.ejecutar(u.input || {}, ctx); }
        catch (e) { res = { error: 'fallo interno' }; console.error('[agente] herramienta', u.name, e && e.message); }
      }
      if (registrar) { try { await registrar({ herramienta: u.name, args: u.input, resultado: res }); } catch (e) { /* el registro no debe romper la respuesta */ } }
      resultados.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(res) });
    }
    mensajes.push({ role: 'user', content: resultados });
  }
  return { texto: 'Perdona, me he liado un poco. ¿Me lo puedes decir de otra forma, o escribir PERSONA?', mensajes, excedido: true };
}

/* Solo guardamos el texto de la conversación (sin rastros de herramientas), y solo las últimas N entradas. */
function historialCompacto(mensajes, n = 12) {
  const out = [];
  for (const m of mensajes) {
    if (typeof m.content === 'string') out.push({ role: m.role, content: m.content });
    else if (m.role === 'assistant') { const t = textoDe(m.content); if (t) out.push({ role: 'assistant', content: t }); }
  }
  // La API exige que empiece por 'user' y alterne; recortamos desde un 'user'.
  let r = out.slice(-n);
  while (r.length && r[0].role !== 'user') r.shift();
  return r;
}

module.exports = { correrAgente, historialCompacto, textoDe, MAX_PASOS };
