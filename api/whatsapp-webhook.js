const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  /* Confirmamos que el mensaje viene realmente de Twilio, no de un tercero */
  const twilioSignature = req.headers['x-twilio-signature'];
  const url = `https://${req.headers.host}${req.url}`;
  const esValido = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    twilioSignature,
    url,
    req.body
  );

  if (!esValido) {
    res.status(403).send('Firma inválida');
    return;
  }

  const from = (req.body.From || '').replace('whatsapp:', '');
  const mensajeEntrante = req.body.Body || '';

  /* Buscamos en el directorio central a qué producto pertenece este teléfono */
  const { data: entrada } = await supabase
    .from('directorio')
    .select('producto')
    .eq('telefono', from)
    .maybeSingle();

  let respuesta;
  if (!entrada) {
    respuesta =
      'Hola 👋 No encontramos tu número registrado en ningún producto de Escalia Digital. Si eres cliente de Barbería TPV, escríbenos con el correo que usaste para registrarte.';
  } else if (entrada.producto === 'barberia_tpv') {
    respuesta = `¡Hola! 👋 Soy el asistente técnico de Barbería TPV (todavía en pruebas). Recibimos tu mensaje: "${mensajeEntrante}". Muy pronto podré ayudarte a resolver problemas de tu cuenta automáticamente.`;
  } else {
    respuesta = 'Hola, tu número está registrado pero todavía no sé atender ese producto.';
  }

  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(respuesta);

  res.setHeader('Content-Type', 'text/xml');
  res.status(200).send(twiml.toString());
};
