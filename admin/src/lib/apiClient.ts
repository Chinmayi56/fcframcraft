// Thin fetch wrapper for the Farm Craft FastAPI backend.
//
// Handles: base URL resolution, JWT bearer auth header injection, JSON
// (de)serialization, and turning FastAPI's error payloads into a single
// `ApiError` with a human-readable message.

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api").replace(/\/+$/, "");

const TOKEN_KEY = "farmcraft_admin_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface FastApiErrorDetail {
  msg?: string;
  loc?: (string | number)[];
}

function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const messages = (detail as FastApiErrorDetail[])
        .map((d) => d.msg)
        .filter((m): m is string => Boolean(m));
      if (messages.length > 0) return messages.join("; ");
    }
  }
  return fallback;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean; // attach Authorization header (default true)
  query?: Record<string, string | number | undefined>;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true, query } = options;

  let url = `${API_BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== "") params.set(key, String(value));
    });
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(
      "Could not reach the Farm Craft backend. Make sure FastAPI is running on http://127.0.0.1:8000 and try again.",
      0
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Some reverse proxies/dev servers return plain-text or HTML errors.
      // Preserve that useful server message instead of throwing a JSON parse error.
      data = text;
    }
  }

  if (!response.ok) {
    const fallback = typeof data === "string" && data.trim()
      ? data.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500)
      : `Request failed with status ${response.status}`;
    const message = extractErrorMessage(data, fallback);
    throw new ApiError(message, response.status);
  }

  if (typeof data === "string") {
    throw new ApiError("The Farm Craft backend returned an invalid non-JSON response.", response.status);
  }
  return data as T;
}
