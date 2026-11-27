// Cross-version adapter for the JSONL session-persistence backend.
//
// DSH 0.2.0-rc.2 exported a constructible class as the default export:
//   new JsonlSessionPersistence(new Context(), { root })
//   ctx.plugin(JsonlSessionPersistence, { root })
// DSH 0.2.2-rc.5 turned it into a cordis plugin ({ name, apply }) with the
// backend reached through `ctx.sessionPersistence` instead:
//   ctx.plugin(JsonlPersistencePlugin, { root })
//   await ctx.sessionPersistence.open(id, 'read')
//
// The e2e harness must run against either seam line, so both shapes are
// detected at runtime — never pinned to a version string (house rule: no
// hard-coded dependency coordinates).

const MODULE = '@deepseek-ai/dsh-session-persistence-jsonl'

/** Load the persistence backend module once and cache it. */
let backendPromise
const loadBackend = () => (backendPromise ??= import(MODULE))

/**
 * Mount the backend into a cordis context regardless of export shape.
 * @param {import('@deepseek-ai/cordis').Context} ctx owning context
 * @param {string} root session storage root
 */
export async function mountJsonlPersistence(ctx, root) {
  const mod = await loadBackend()
  // 0.2.2-rc.5: named plugin object; 0.2.0-rc.2: default-exported class.
  const plugin = (mod.apply && mod.name) ? mod : mod.default
  await ctx.plugin(plugin, { root })
}

/**
 * Read a stored session's events from a FRESH backend over the same root —
 * as close to "restart and reload" as the harness can get without a second
 * agent loop.
 * @param {string} root session storage root
 * @param {string} sessionId session to read
 * @returns {Promise<readonly object[]>} the replayed event log
 */
export async function readStoredEvents(root, sessionId) {
  const { Context } = await import('@deepseek-ai/cordis')
  const ctx = new Context()
  try {
    await mountJsonlPersistence(ctx, root)
    const reader = await ctx.sessionPersistence.open(sessionId, 'read')
    try {
      return (await reader.read(0)).events
    } finally {
      await reader.close()
    }
  } finally {
    await ctx.fiber.dispose()
  }
}
