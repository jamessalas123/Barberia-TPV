import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* Un precio de Stripe por país. Cuando tengas el ID del precio en COP,
   ponlo aquí — mientras tanto Colombia sigue bloqueada en el frontend,
   así que este valor no se usa todavía en producción real. */
const PRICE_ID_POR_PAIS = {
  ES: 'price_1TqFsoV05BTdldnGCx2z4O13',
  CO: 'price_1U2G5DV05BTdldnGNFLpu33Z',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  /* Verificamos la sesión real del usuario contra Supabase, en vez de
     confiar en un id que mande el navegador. Así nadie puede activar
     la suscripción de otra cuenta que no sea la suya. */
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) {
    return res.status(401).json({ error: 'Falta la sesión del usuario' });
  }

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Sesión no válida o caducada' });
  }

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;

    /* Buscamos el país del usuario para saber en qué moneda cobrarle */
    const { data: profile } = await supabase
      .from('profiles')
      .select('pais')
      .eq('id', user.id)
      .single();

    const pais = (profile && profile.pais) || 'ES';
    const priceId = PRICE_ID_POR_PAIS[pais] || PRICE_ID_POR_PAIS.ES;

    if (priceId.startsWith('PENDIENTE')) {
      return res.status(400).json({ error: 'Los pagos para este país aún no están disponibles.' });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email,
      allow_promotion_codes: true,
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Error creando sesión de checkout:', err);
    return res.status(500).json({ error: 'No se pudo iniciar el pago. Inténtalo de nuevo.' });
  }
}
