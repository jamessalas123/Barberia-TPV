/*
 * Adaptadores de IA. Solo este archivo sabe con qué modelo se habla.
 * - crearLLMAnthropic: API real de Anthropic (requiere ANTHROPIC_API_KEY). SIN PROBAR contra la API real todavía.
 * - crearLLMSimulado: respuestas guiadas para las pruebas (no usa red).
 */
function crearLLMAnthropic({ apiKey, modelo = 'claude-haiku-5-5', maxTokens = 600, timeoutMs = 20000 }) {
  return async ({ system, messages, tools }) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelo, max_tokens: maxTokens, system, messages, tools }),
        signal: ctl.signal
      });
      if (!r.ok) throw new Error('IA ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const j = await r.json();
      return { content: j.content || [], stop_reason: j.stop_reason, usage: j.usage };
    } finally { clearTimeout(t); }
  };
}

/* guion: array de respuestas (cada una es {content:[...]} o una función (peticion)=>{content}) */
function crearLLMSimulado(guion) {
  let i = 0;
  const llm = async (peticion) => {
    const g = guion[i++];
    if (!g) throw new Error('el guion simulado se quedó sin respuestas');
    return typeof g === 'function' ? g(peticion) : g;
  };
  llm.llamadas = () => i;
  return llm;
}

module.exports = { crearLLMAnthropic, crearLLMSimulado };
