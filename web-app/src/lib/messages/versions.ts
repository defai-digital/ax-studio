import { ThreadMessage } from '@ax-studio/core'

/**
 * Response-version metadata, stored under ThreadMessage.metadata. A "version
 * group" is a set of messages occupying the same conversational slot —
 * alternate assistant attempts produced by Regenerate, keyed by the id of the
 * user message they respond to. Exactly one message per group is active
 * (visible) at a time; superseded attempts stay in storage so the user can
 * switch back, instead of being deleted.
 *
 * Messages without a versionGroupId are always visible — every thread
 * created before this feature, and every message never regenerated, is
 * completely unaffected.
 */
export type VersionMeta = {
  versionGroupId?: string
  versionIndex?: number
  isActiveVersion?: boolean
}

export function getVersionMeta(message: ThreadMessage): VersionMeta {
  return (message.metadata ?? {}) as VersionMeta
}

/** The subset of messages that should currently be shown to the user. */
export function selectVisibleMessages(
  messages: ThreadMessage[]
): ThreadMessage[] {
  return messages.filter((m) => {
    const meta = getVersionMeta(m)
    if (!meta.versionGroupId) return true
    return meta.isActiveVersion === true
  })
}

export type VersionInfo = { groupId: string; position: number; total: number }

/**
 * For every grouped message, compute its 1-based position among its sibling
 * versions and the total sibling count — e.g. `{ position: 2, total: 3 }` to
 * render "2 / 3". Ungrouped messages, and groups with only one surviving
 * index, are omitted (nothing to switch between).
 */
export function getVersionInfoByMessageId(
  messages: ThreadMessage[]
): Map<string, VersionInfo> {
  const byGroup = new Map<string, ThreadMessage[]>()
  for (const m of messages) {
    const groupId = getVersionMeta(m).versionGroupId
    if (!groupId) continue
    const bucket = byGroup.get(groupId)
    if (bucket) bucket.push(m)
    else byGroup.set(groupId, [m])
  }

  const result = new Map<string, VersionInfo>()
  for (const [groupId, groupMessages] of byGroup) {
    const indices = Array.from(
      new Set(
        groupMessages
          .map((m) => getVersionMeta(m).versionIndex)
          .filter((v): v is number => typeof v === 'number')
      )
    ).sort((a, b) => a - b)
    if (indices.length < 2) continue

    for (const m of groupMessages) {
      const versionIndex = getVersionMeta(m).versionIndex
      if (typeof versionIndex !== 'number') continue
      const position = indices.indexOf(versionIndex) + 1
      result.set(m.id, { groupId, position, total: indices.length })
    }
  }
  return result
}
