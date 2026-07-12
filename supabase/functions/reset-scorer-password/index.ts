import { createClient } from "npm:@supabase/supabase-js@2.95.0";

class RequestError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

const supabaseUrl = requiredEnvironment("SUPABASE_URL");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const allowedOrigin = normalizeOrigin(requiredEnvironment("FIRST_PARTY_ORIGIN"));
const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeOrigin(origin: string): string {
  const normalized = origin.replace(/\/$/, "");
  if (normalized === "*") throw new Error("FIRST_PARTY_ORIGIN cannot be a wildcard");
  return normalized;
}

function corsHeaders(origin: string): HeadersInit {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
}

function jsonResponse(origin: string, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function requireAllowedOrigin(request: Request): string {
  const origin = request.headers.get("origin");
  if (!origin || normalizeOrigin(origin) !== allowedOrigin) {
    throw new RequestError(403, "ORIGIN_NOT_ALLOWED");
  }
  return origin;
}

function bearerToken(request: Request): string {
  const match = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new RequestError(401, "AUTHENTICATION_REQUIRED");
  return match[1];
}

async function authenticatedAdmin(token: string): Promise<void> {
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) throw new RequestError(401, "INVALID_ACCESS_TOKEN");
  const { data: profile, error: profileError } = await adminClient
    .from("profiles")
    .select("user_id")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .eq("is_active", true)
    .maybeSingle();
  if (profileError) throw new Error("Unable to verify admin profile");
  if (!profile) throw new RequestError(403, "ADMIN_REQUIRED");
}

async function parseRequest(request: Request): Promise<{ scorerId: string; newPassword: string }> {
  let value: unknown;
  try {
    value = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new RequestError(400, "INVALID_JSON");
    throw error;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, "INVALID_REQUEST");
  }
  const body = value as Record<string, unknown>;
  const scorerId = body.scorer_id;
  const newPassword = body.new_password;
  if (typeof scorerId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(scorerId)) {
    throw new RequestError(422, "INVALID_SCORER_ID");
  }
  if (typeof newPassword !== "string" || newPassword.length < 8 || newPassword.length > 128) {
    throw new RequestError(422, "INVALID_PASSWORD");
  }
  return { scorerId, newPassword };
}

async function resetPassword(request: Request): Promise<Record<string, unknown>> {
  await authenticatedAdmin(bearerToken(request));
  const { scorerId, newPassword } = await parseRequest(request);
  const { data: scorer, error: scorerError } = await adminClient
    .from("profiles")
    .select("user_id")
    .eq("user_id", scorerId)
    .eq("role", "scorer")
    .maybeSingle();
  if (scorerError) throw new Error("Unable to verify scorer profile");
  if (!scorer) throw new RequestError(404, "SCORER_NOT_FOUND");
  const { error } = await adminClient.auth.admin.updateUserById(scorerId, { password: newPassword });
  if (error) throw new Error("Unable to reset scorer password");
  return { scorer: { user_id: scorerId, password_reset: true } };
}

Deno.serve(async (request) => {
  let origin: string;
  try {
    origin = requireAllowedOrigin(request);
  } catch {
    return new Response(JSON.stringify({ error: { code: "ORIGIN_NOT_ALLOWED" } }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return jsonResponse(origin, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
  try {
    return jsonResponse(origin, 200, await resetPassword(request));
  } catch (error) {
    if (error instanceof RequestError) {
      return jsonResponse(origin, error.status, { error: { code: error.code } });
    }
    const requestId = crypto.randomUUID();
    console.error("Unhandled scorer password reset error", { requestId, error });
    return jsonResponse(origin, 500, { error: { code: "INTERNAL_ERROR", request_id: requestId } });
  }
});
