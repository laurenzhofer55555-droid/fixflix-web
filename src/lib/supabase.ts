interface SupabaseConfig {
  url: string
  key: string
}

/** Null when unconfigured — callers then fall back to the ASP.NET API. */
export function supabaseConfig(): SupabaseConfig | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/+$/, '')
  const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  return url && key ? { url, key } : null
}

/** A database function refused the call; `message` is its error name, e.g. "rate_limited". */
export class RpcError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * Calls one of the three database functions the anon key is allowed to use
 * (see supabase/schema.sql). Tables are not reachable from the browser at all.
 */
export async function supabaseRpc<T = unknown>(
  fn: 'get_challenge' | 'submit_lead' | 'log_event',
  args: Record<string, unknown>,
  keepalive = false,
): Promise<T> {
  const config = supabaseConfig()
  if (!config) throw new Error('Supabase is not configured')

  const response = await fetch(`${config.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: config.key,
      // Legacy anon keys are JWTs and double as bearer token; the newer
      // sb_publishable_… keys must only be sent in `apikey`.
      ...(config.key.startsWith('eyJ') ? { Authorization: `Bearer ${config.key}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    keepalive,
  })

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: unknown } | null
    throw new RpcError(response.status, typeof body?.message === 'string' ? body.message : 'unknown')
  }

  // Functions returning void answer with an empty body.
  return (await response.json().catch(() => null)) as T
}
