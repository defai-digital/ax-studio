export function sanitize(name: string): string {
  const result = name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
  return result || 'agent'
}

export function validateTeamAgentNames(
  agents: Array<{ name: string }>
): string | null {
  const seen = new Map<string, string>()
  for (const agent of agents) {
    const sanitized = sanitize(agent.name)
    const existing = seen.get(sanitized)
    if (existing !== undefined) {
      return `Agent names "${existing}" and "${agent.name}" conflict after sanitization (both become "${sanitized}"). Use distinct names.`
    }
    seen.set(sanitized, agent.name)
  }
  return null
}
