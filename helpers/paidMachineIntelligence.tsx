import { nanoid } from "nanoid";
import { db } from "./db";
import { buildMachineIntelligence } from "./machineIntelligence";
import { mppStore } from "./mppStore";
import { recordAgentFunnelEvent } from "./agentFunnel";

export const machinePrices = {
  hidden_chain: 0.50,
  alpha: 0.75,
  opportunity: 1.00,
  global_brief: 2.50,
  deep_research: 5.00,
} as const;

export type MachineMode = keyof typeof machinePrices;

type Challenge = {
  id: string;
  realm: string;
  method: "stripe";
  intent: "charge";
  request: {
    amount: string;
    currency: "usd";
    methodDetails: {
      networkId: string;
      paymentMethodTypes: string[];
    };
  };
  description: string;
  expires: string;
};

type Receipt = {
  method: "stripe";
  status: "success";
  timestamp: string;
  reference: string;
};

type ChallengeRecord = {
  type: "shadowgraph:mpp-challenge";
  status: "issued" | "paid";
  mode: MachineMode;
  priceUsd: number;
  challenge: Challenge;
  receipt?: Receipt;
  intelligence?: unknown;
};

/** A payment credential as defined by MPP: the echoed challenge plus a method-specific payload (Stripe: a shared payment token). */
type Credential = { challenge: Record<string, unknown> & { id: string; request: unknown }; payload: { spt: string } };

/** Transport-independent outcome of one paid call. */
type Settlement =
  | { kind: "challenge"; challenge: Challenge; failure?: "mismatch" | "verification"; detail?: string }
  | { kind: "paid"; challengeId: string; requestId: string; priceUsd: number; intelligence: unknown; receipt: Receipt };

export type PaidMachineResult =
  | { kind: "challenge"; response: Response }
  | {
      kind: "paid";
      requestId: string;
      priceUsd: number;
      intelligence: unknown;
      receiptHeader: string;
    };

const STRIPE_PREVIEW_VERSION = "2026-07-29.preview";
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const STRIPE_NETWORK_ID = "profile_61VXQLSu7HO8tv9aIA6VXQLSU1AFRq2EiUxRz5TMu3lQ";

/** MCP binding of MPP (https://mpp.dev/protocol/transports/mcp). */
export const MCP_CREDENTIAL_KEY = "org.paymentauth/credential";
export const MCP_RECEIPT_KEY = "org.paymentauth/receipt";
export const MCP_PAYMENT_REQUIRED = -32042;
export const MCP_PAYMENT_VERIFICATION_FAILED = -32043;

function b64urlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function b64urlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function authParam(name: string, value: string) {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `${name}="${escaped}"`;
}

function challengeHeader(challenge: Challenge) {
  const encodedRequest = b64urlEncode(stable(challenge.request));
  const values = [
    authParam("id", challenge.id),
    authParam("realm", challenge.realm),
    authParam("method", challenge.method),
    authParam("intent", challenge.intent),
    authParam("request", encodedRequest),
    authParam("description", challenge.description),
    authParam("expires", challenge.expires),
  ];
  return `Payment ${values.join(", ")}`;
}

function problemResponse(challenge: Challenge, detail?: string) {
  return new Response(JSON.stringify({
    type: "https://paymentauth.org/problems/payment-required",
    title: "Payment Required",
    status: 402,
    detail: detail ?? `Payment is required (${challenge.description}).`,
    hint: "Fulfill the Payment challenge and retry the identical request with Authorization: Payment <credential>.",
    challengeId: challenge.id,
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/problem+json",
      "Cache-Control": "no-store",
      "x-runtime-status": "402",
      "x-runtime-www-authenticate": challengeHeader(challenge),
    },
  });
}

function channelForEndpoint(endpoint: string): "mcp" | "a2a" | "rest" {
  if (endpoint.includes("/mcp")) return "mcp";
  if (endpoint.includes("/a2a")) return "a2a";
  return "rest";
}

/** Issue and store a fresh challenge. `record` = count it in the funnel (replacement challenges after a failed payment are not counted twice). */
async function issueChallenge(request: Request, mode: MachineMode, endpoint: string, record = true): Promise<Challenge> {
  const priceUsd = machinePrices[mode];
  const id = nanoid(32);
  const challenge: Challenge = {
    id,
    realm: new URL(request.url).host,
    method: "stripe",
    intent: "charge",
    request: {
      amount: String(Math.round(priceUsd * 100)),
      currency: "usd",
      methodDetails: {
        networkId: STRIPE_NETWORK_ID,
        paymentMethodTypes: ["card", "link"],
      },
    },
    description: `ShadowGraph ${mode} intelligence`,
    expires: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
  };
  await mppStore.put(`challenge:${id}`, {
    type: "shadowgraph:mpp-challenge",
    status: "issued",
    mode,
    priceUsd,
    challenge,
  } satisfies ChallengeRecord);
  if (record) {
    await recordAgentFunnelEvent({
      eventType: "challenge",
      channel: channelForEndpoint(endpoint),
      mode,
      priceUsd,
      userAgent: request.headers.get("user-agent"),
      request,
    });
  }
  return challenge;
}

/** Accepts a credential object (MCP: native JSON) whose challenge.request may be JSON or base64url JSON (HTTP style). */
export function normalizeCredential(raw: unknown): Credential | null {
  if (!raw || typeof raw !== "object") return null;
  const wire = raw as { challenge?: Record<string, unknown>; payload?: Record<string, unknown> };
  if (!wire.challenge || typeof wire.challenge.id !== "string") return null;
  if (!wire.payload || typeof wire.payload.spt !== "string" || !wire.payload.spt) return null;
  let request: unknown = wire.challenge.request;
  if (typeof request === "string") {
    try { request = JSON.parse(b64urlDecode(request)); } catch { return null; }
  }
  return {
    challenge: { ...wire.challenge, id: wire.challenge.id, request },
    payload: { spt: wire.payload.spt },
  };
}

/** HTTP binding: `Authorization: Payment <base64url(JSON credential)>`. */
export function parseCredentialHeader(header: string): Credential | null {
  const match = header.match(/(?:^|,\s*)Payment\s+([A-Za-z0-9_-]+)/i);
  if (!match?.[1]) return null;
  try {
    return normalizeCredential(JSON.parse(b64urlDecode(match[1])));
  } catch {
    return null;
  }
}

function receiptHeader(receipt: Receipt) {
  return b64urlEncode(JSON.stringify(receipt));
}

function getStripeSecret() {
  return (
    (Reflect.get(process.env, "STRIPE_LIVE_SECRET_KEY_V2") as string | undefined) ??
    (Reflect.get(process.env, "STRIPE_MPP_SECRET_KEY") as string | undefined) ??
    (Reflect.get(process.env, "STRIPE_SECRET_KEY") as string | undefined)
  );
}

async function chargeStripe(secret: string, record: ChallengeRecord, spt: string) {
  const challenge = record.challenge;
  const body = new URLSearchParams({
    amount: challenge.request.amount,
    "automatic_payment_methods[allow_redirects]": "never",
    "automatic_payment_methods[enabled]": "true",
    confirm: "true",
    currency: "usd",
    shared_payment_granted_token: spt,
    "metadata[machine_payment]": "true",
    "metadata[shadowgraph_mode]": record.mode,
    "metadata[challenge_id]": challenge.id,
  });
  const response = await fetch("https://api.stripe.com/v1/payment_intents", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `mpp_${challenge.id}`,
      "Stripe-Version": STRIPE_PREVIEW_VERSION,
    },
    body,
    signal: AbortSignal.timeout(12_000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof json?.error?.message === "string" ? json.error.message : "Stripe payment failed");
  if (json?.status !== "succeeded") throw new Error(`Stripe PaymentIntent status: ${json?.status ?? "unknown"}`);
  return { id: String(json.id) };
}

/**
 * Core of every paid call, independent of the transport (REST / A2A use HTTP 402 headers, MCP uses JSON-RPC errors + _meta).
 * No credential -> new challenge. Valid credential for a stored, unexpired challenge -> Stripe charge (idempotent per challenge).
 */
async function settle(request: Request, mode: MachineMode, endpoint: string, credential: Credential | null): Promise<Settlement> {
  if (!credential) return { kind: "challenge", challenge: await issueChallenge(request, mode, endpoint) };

  const stored = await mppStore.get(`challenge:${credential.challenge.id}`) as ChallengeRecord | null;
  if (!stored || stored.type !== "shadowgraph:mpp-challenge" || stored.mode !== mode) {
    return { kind: "challenge", challenge: await issueChallenge(request, mode, endpoint) };
  }

  if (stored.status === "paid" && stored.receipt) {
    const intelligence = stored.intelligence ?? await buildMachineIntelligence(mode);
    if (stored.intelligence === undefined) {
      await mppStore.put(`challenge:${stored.challenge.id}`, { ...stored, intelligence } satisfies ChallengeRecord);
    }
    return {
      kind: "paid", challengeId: stored.challenge.id, requestId: `sgm_${stored.challenge.id}`,
      priceUsd: stored.priceUsd, intelligence, receipt: stored.receipt,
    };
  }

  if (Date.parse(stored.challenge.expires) <= Date.now()) {
    return { kind: "challenge", challenge: await issueChallenge(request, mode, endpoint) };
  }

  const expected = stored.challenge;
  const received = credential.challenge;
  const valid =
    received.id === expected.id &&
    received.realm === expected.realm &&
    received.method === expected.method &&
    received.intent === expected.intent &&
    received.expires === expected.expires &&
    stable(received.request) === stable(expected.request);
  if (!valid) {
    return { kind: "challenge", challenge: expected, failure: "mismatch", detail: "Payment credential does not match the issued challenge." };
  }

  const stripeSecret = getStripeSecret();
  if (!stripeSecret || (!stripeSecret.startsWith("sk_") && !stripeSecret.startsWith("rk_"))) {
    throw new Error("Stripe payment key is not ready");
  }

  let payment: { id: string };
  try {
    payment = await chargeStripe(stripeSecret, stored, credential.payload.spt);
  } catch {
    await recordAgentFunnelEvent({
      eventType: "payment_failed",
      channel: channelForEndpoint(endpoint),
      mode,
      priceUsd: stored.priceUsd,
      userAgent: request.headers.get("user-agent"),
      request,
    });
    // the old challenge is bound to a Stripe idempotency key, so a retry needs a fresh one
    return {
      kind: "challenge", challenge: await issueChallenge(request, mode, endpoint, false), failure: "verification",
      detail: "Payment verification failed. Retry with a valid Stripe MPP credential for the new challenge.",
    };
  }

  const intelligence = await buildMachineIntelligence(mode);
  const requestId = `sgm_${expected.id}`;
  const receipt: Receipt = {
    method: "stripe",
    status: "success",
    timestamp: new Date().toISOString(),
    reference: payment.id,
  };

  await mppStore.put(`challenge:${expected.id}`, { ...stored, status: "paid", receipt } satisfies ChallengeRecord);

  await db
    .insertInto("machineUsage")
    .values({
      requestId,
      endpoint,
      mode,
      priceUsd: stored.priceUsd,
      paymentMethod: "mpp-stripe",
      userAgent: request.headers.get("user-agent"),
      requestDigest: request.headers.get("content-digest") || request.headers.get("digest"),
    })
    .onConflict((oc) => oc.column("requestId").doNothing())
    .execute();

  await recordAgentFunnelEvent({
    eventType: "paid",
    channel: channelForEndpoint(endpoint),
    mode,
    priceUsd: stored.priceUsd,
    userAgent: request.headers.get("user-agent"),
    request,
  });

  await mppStore.put(`challenge:${expected.id}`, { ...stored, status: "paid", receipt, intelligence } satisfies ChallengeRecord);

  return { kind: "paid", challengeId: expected.id, requestId, priceUsd: stored.priceUsd, intelligence, receipt };
}

/** HTTP binding (REST and A2A): challenge as HTTP 402 + WWW-Authenticate, receipt as Payment-Receipt header. */
export async function authorizeMachineIntelligence(
  request: Request,
  mode: MachineMode,
  endpoint: string,
): Promise<PaidMachineResult> {
  const auth = request.headers.get("authorization");
  // a malformed credential is answered with a fresh challenge, like a missing one
  const credential = auth && /(?:^|,\s*)Payment\s+/i.test(auth) ? parseCredentialHeader(auth) : null;
  const s = await settle(request, mode, endpoint, credential);
  if (s.kind === "challenge") return { kind: "challenge", response: problemResponse(s.challenge, s.detail) };
  return { kind: "paid", requestId: s.requestId, priceUsd: s.priceUsd, intelligence: s.intelligence, receiptHeader: receiptHeader(s.receipt) };
}

export type McpPaidResult =
  | { kind: "error"; code: number; message: string; data: { httpStatus: 402; challenges: Challenge[]; detail?: string } }
  | { kind: "paid"; requestId: string; priceUsd: number; intelligence: unknown; receiptHeader: string; receipt: Receipt & { challengeId: string } };

/**
 * MCP binding of MPP: the challenge is a JSON-RPC error -32042 with error.data.challenges (native JSON, no base64);
 * the client retries tools/call with params._meta["org.paymentauth/credential"]; the receipt comes back in
 * result._meta["org.paymentauth/receipt"]. An `Authorization: Payment` header is still accepted as a fallback.
 */
export async function authorizeMachineIntelligenceMcp(
  request: Request,
  mode: MachineMode,
  endpoint: string,
  meta: unknown,
): Promise<McpPaidResult> {
  const rawMeta = meta && typeof meta === "object" ? (meta as Record<string, unknown>)[MCP_CREDENTIAL_KEY] : undefined;
  let credential: Credential | null = null;
  if (rawMeta !== undefined) {
    credential = normalizeCredential(rawMeta);
    if (!credential) {
      return {
        kind: "error", code: -32602, message: "Malformed payment credential",
        data: { httpStatus: 402, challenges: [await issueChallenge(request, mode, endpoint)], detail: `params._meta["${MCP_CREDENTIAL_KEY}"] must be {challenge, payload: {spt}}.` },
      };
    }
  } else {
    const auth = request.headers.get("authorization");
    if (auth && /(?:^|,\s*)Payment\s+/i.test(auth)) credential = parseCredentialHeader(auth);
  }

  const s = await settle(request, mode, endpoint, credential);
  if (s.kind === "challenge") {
    const failed = s.failure === "verification";
    return {
      kind: "error",
      code: failed ? MCP_PAYMENT_VERIFICATION_FAILED : MCP_PAYMENT_REQUIRED,
      message: failed ? "Payment verification failed" : "Payment Required",
      data: { httpStatus: 402, challenges: [s.challenge], ...(s.detail ? { detail: s.detail } : {}) },
    };
  }
  return {
    kind: "paid", requestId: s.requestId, priceUsd: s.priceUsd, intelligence: s.intelligence,
    receiptHeader: receiptHeader(s.receipt), receipt: { ...s.receipt, challengeId: s.challengeId },
  };
}
