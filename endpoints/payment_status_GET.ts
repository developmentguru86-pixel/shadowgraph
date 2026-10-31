export async function handle() {
  const secret =
    (Reflect.get(process.env, "STRIPE_LIVE_SECRET_KEY_V2") as string | undefined) ??
    (Reflect.get(process.env, "STRIPE_MPP_SECRET_KEY") as string | undefined) ??
    (Reflect.get(process.env, "STRIPE_SECRET_KEY") as string | undefined);
  if (!secret) {
    return new Response(JSON.stringify({
      connected: false,
      mode: "missing",
      mppReady: false,
      message: "Stripe secret is not connected.",
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  const mode = secret.startsWith("sk_live_")
    ? "live"
    : secret.startsWith("sk_test_")
      ? "test"
      : secret.startsWith("rk_")
        ? "restricted"
        : "invalid";

  if (mode === "invalid") {
    return new Response(JSON.stringify({
      connected: true,
      mode,
      mppReady: false,
      message: "Connected value is not a Stripe secret/restricted key.",
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }

  try {
    const response = await fetch("https://api.stripe.com/v1/account", {
      headers: {
        Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return new Response(JSON.stringify({
        connected: true,
        mode,
        mppReady: false,
        message: "Stripe rejected the connected key.",
      }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    }
    return new Response(JSON.stringify({
      connected: true,
      mode,
      mppReady: true,
      message: "Stripe key authenticated successfully.",
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return new Response(JSON.stringify({
      connected: true,
      mode,
      mppReady: false,
      message: "Stripe validation request failed.",
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}