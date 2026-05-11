import { GameRoom } from './GameRoom';

export { GameRoom };

export interface Env {
  GAME_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  STRIPE_SECRET_KEY?: string;
  APP_URL?: string;
  AI_API_KEY?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade → route to the singleton GameRoom Durable Object
    if (url.pathname === '/ws') {
      const id = env.GAME_ROOM.idFromName('main');
      const room = env.GAME_ROOM.get(id);
      return room.fetch(request);
    }

    // Health check
    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok' });
    }

    // Stripe checkout session creation
    if (url.pathname === '/api/stripe/create-checkout-session' && request.method === 'POST') {
      return handleStripeCheckout(request, env);
    }

    // Serve static assets (pre-built Vite SPA)
    const assetResponse = await env.ASSETS.fetch(request);
    // SPA fallback: unknown paths get index.html for client-side routing
    if (assetResponse.status === 404) {
      return env.ASSETS.fetch(new Request(new URL('/', request.url).toString()));
    }
    return assetResponse;
  },
};

async function handleStripeCheckout(request: Request, env: Env): Promise<Response> {
  if (!env.STRIPE_SECRET_KEY) {
    return Response.json({ error: 'Stripe not configured' }, { status: 500 });
  }

  try {
    const body = await request.json<{ userId?: string }>();
    const userId = body.userId ?? '';
    const appUrl = env.APP_URL || 'https://3-little-worms.workers.dev';

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'payment_method_types[]': 'card',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': '1000 Neon Coins',
        'line_items[0][price_data][product_data][description]': 'Currency for 3 Little Worms shop',
        'line_items[0][price_data][unit_amount]': '500',
        'line_items[0][quantity]': '1',
        mode: 'payment',
        success_url: `${appUrl}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}?payment=cancelled`,
        'metadata[userId]': userId,
      }),
    });

    const session = await stripeRes.json<{ url?: string; error?: { message: string } }>();
    if (!stripeRes.ok) {
      throw new Error(session.error?.message || 'Stripe API error');
    }

    return Response.json({ url: session.url });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
