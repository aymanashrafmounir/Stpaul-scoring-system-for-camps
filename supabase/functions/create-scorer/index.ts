import { createClient, type AuthError } from "npm:@supabase/supabase-js@2.95.0";

type ScorerRequest = {
  username: string;
  password: string;
  displayName: string;
  eventId: string;
  bonusLimit: number;
};

class RequestError extends Error {
  constructor(public status: number, public code: string, public requestId?: string) {
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
  const configuredValue = Deno.env.get(name);
  if (!configuredValue) throw new Error(`Missing required environment variable: ${name}`);
  return configuredValue;
}

function normalizeOrigin(origin: string): string {
  const normalizedOrigin = origin.replace(/\/$/, "");
  if (normalizedOrigin === "*") throw new Error("FIRST_PARTY_ORIGIN cannot be a wildcard");
  return normalizedOrigin;
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
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || normalizeOrigin(requestOrigin) !== allowedOrigin) {
    throw new RequestError(403, "ORIGIN_NOT_ALLOWED");
  }
  return requestOrigin;
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new RequestError(401, "AUTHENTICATION_REQUIRED");
  return match[1];
}

function requestObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(400, "INVALID_REQUEST");
  }
  return value as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new RequestError(400, "INVALID_REQUEST");
  return value;
}

function parseScorerRequest(value: unknown): ScorerRequest {
  const body = requestObject(value);
  const username = requiredString(body, "username").trim().toLowerCase();
  const password = requiredString(body, "password");
  const displayName = requiredString(body, "display_name").trim();
  const eventId = requiredString(body, "event_id");
  const bonusLimit = body.bonus_limit;
  validateScorerFields({ username, password, displayName, eventId, bonusLimit });
  return { username, password, displayName, eventId, bonusLimit: bonusLimit as number };
}

function validateScorerFields(fields: Omit<ScorerRequest, "bonusLimit"> & { bonusLimit: unknown }): void {
  const { username, password, displayName, eventId, bonusLimit } = fields;
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) throw new RequestError(422, "INVALID_USERNAME");
  if (password.length < 8 || password.length > 128) throw new RequestError(422, "INVALID_PASSWORD");
  if (displayName.length < 1 || displayName.length > 80) throw new RequestError(422, "INVALID_DISPLAY_NAME");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) throw new RequestError(422, "INVALID_EVENT_ID");
  if (!Number.isInteger(bonusLimit) || (bonusLimit as number) < 0 || (bonusLimit as number) > 2147483647) throw new RequestError(422, "INVALID_BONUS_LIMIT");
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) throw new RequestError(400, "INVALID_JSON");
    throw error;
  }
}

async function authenticatedAdmin(accessToken: string): Promise<string> {
  const { data, error } = await adminClient.auth.getUser(accessToken);
  if (error || !data.user) throw new RequestError(401, "INVALID_ACCESS_TOKEN");
  const { data: profile, error: profileError } = await adminClient
    .from("profiles").select("user_id").eq("user_id", data.user.id)
    .eq("role", "admin").eq("is_active", true).maybeSingle();
  if (profileError) throw new Error("Unable to verify admin profile");
  if (!profile) throw new RequestError(403, "ADMIN_REQUIRED");
  return data.user.id;
}

async function requireEvent(eventId: string): Promise<void> {
  const { data, error } = await adminClient.from("events").select("id").eq("id", eventId).maybeSingle();
  if (error) throw new Error("Unable to verify event");
  if (!data) throw new RequestError(422, "EVENT_NOT_FOUND");
}

function duplicateEmail(error: AuthError): boolean {
  return error.code === "email_exists" || error.code === "user_already_exists" || /already.*registered|already.*exists/i.test(error.message);
}

async function createAuthUser(scorer: ScorerRequest): Promise<string> {
  const internalEmail = `${scorer.username}@stpaul.local`;
  const { data, error } = await adminClient.auth.admin.createUser({
    email: internalEmail,
    password: scorer.password,
    email_confirm: true,
    user_metadata: { display_name: scorer.displayName },
  });
  if (error && duplicateEmail(error)) throw new RequestError(409, "USERNAME_ALREADY_EXISTS");
  if (error || !data.user) throw new Error("Unable to create Auth user");
  return data.user.id;
}

async function persistScorer(adminId: string, userId: string, scorer: ScorerRequest): Promise<void> {
  const { error } = await adminClient.rpc("complete_scorer_provisioning", {
    p_request: {
      admin_id: adminId,
      user_id: userId,
      username: scorer.username,
      display_name: scorer.displayName,
      event_id: scorer.eventId,
      bonus_limit: scorer.bonusLimit,
    },
  });
  if (error) throw error;
}

async function compensateAuthUser(userId: string, requestId: string, cause: unknown): Promise<never> {
  const { error: cleanupError } = await adminClient.auth.admin.deleteUser(userId);
  if (cleanupError) {
    console.error("Scorer cleanup failed", { requestId, userId, cause, cleanupError });
    throw new RequestError(500, "SCORER_PROVISIONING_CLEANUP_FAILED", requestId);
  }
  console.error("Scorer provisioning rolled back", { requestId, cause });
  throw new RequestError(500, "SCORER_PROVISIONING_FAILED", requestId);
}

async function provisionScorer(request: Request): Promise<Record<string, unknown>> {
  const adminId = await authenticatedAdmin(bearerToken(request));
  const scorer = parseScorerRequest(await parseJson(request));
  await requireEvent(scorer.eventId);
  const userId = await createAuthUser(scorer);
  const requestId = crypto.randomUUID();
  try {
    await persistScorer(adminId, userId, scorer);
  } catch (error) {
    return await compensateAuthUser(userId, requestId, error);
  }
  return { scorer: { user_id: userId, username: scorer.username, display_name: scorer.displayName, event_id: scorer.eventId, bonus_limit: scorer.bonusLimit } };
}

Deno.serve(async (request) => {
  let origin: string;
  try {
    origin = requireAllowedOrigin(request);
  } catch (error) {
    const code = error instanceof RequestError ? error.code : "ORIGIN_NOT_ALLOWED";
    return new Response(JSON.stringify({ error: { code } }), { status: 403, headers: { "Content-Type": "application/json" } });
  }
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return jsonResponse(origin, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
  try {
    return jsonResponse(origin, 201, await provisionScorer(request));
  } catch (error) {
    if (error instanceof RequestError) {
      const body = error.requestId
        ? { error: { code: error.code, request_id: error.requestId } }
        : { error: { code: error.code } };
      return jsonResponse(origin, error.status, body);
    }
    const requestId = crypto.randomUUID();
    console.error("Unhandled scorer provisioning error", { requestId, error });
    return jsonResponse(origin, 500, { error: { code: "INTERNAL_ERROR", request_id: requestId } });
  }
});
