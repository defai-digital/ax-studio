// Regression coverage for the ax-engine launch posture's MTP flags.
//
// Context: the posture sends `--disable-ngram-acceleration`, and ax-engine
// demotes its default `--mlx-mtp-policy auto` to `disabled` whenever that flag
// is present (crates/ax-engine-server/src/args/session.rs). Its own client
// contract (docs/CLI.md) additionally states that `auto` does not promote the
// unqualified linear-Qwen Tiel packs, which is what this app serves locally.
// Composing the posture without an explicit policy therefore silently turned
// model MTP off, so the policy flag must always be present.
//
// This file is plain JS (the vitest include pattern is `**/*.test.mjs`); only
// the imported Electron sources are TypeScript.
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', getAppPath: () => '/tmp', on: () => {} },
}))

import { DEFAULT_POSTURE, canonicalPosture } from '../../electron/src/ax-engine/types.ts'
import { buildServeArgs, normalizePosture } from '../../electron/src/ax-engine/server.ts'

const MODEL = 'tiel-coder-35b-axq-mxfp4'

function flagValue(argv, flag) {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}

function posture(partial) {
  return normalizePosture(MODEL, partial)
}

describe('ax-engine MTP posture', () => {
  it('requests native MTP admission by default', () => {
    expect(DEFAULT_POSTURE.mlxMtpPolicy).toBe('required')

    const argv = buildServeArgs('/models/tiel', 31418, posture())
    expect(flagValue(argv, '--mlx-mtp-policy')).toBe('required')
  })

  it('never emits disable-ngram-acceleration without an explicit MTP policy', () => {
    const argv = buildServeArgs('/models/tiel', 31418, posture())

    // The two flags whose combination used to disable MTP by accident.
    expect(argv).toContain('--disable-ngram-acceleration')
    expect(flagValue(argv, '--mlx-mtp-policy')).toBeDefined()
  })

  it('honours an explicit policy override', () => {
    for (const policy of ['auto', 'disabled', 'required']) {
      const argv = buildServeArgs('/m', 31418, posture({ mlxMtpPolicy: policy }))
      expect(flagValue(argv, '--mlx-mtp-policy')).toBe(policy)
    }
  })

  it('keeps the compile-time default posture shape', () => {
    const argv = buildServeArgs('/m', 31418, posture())

    expect(flagValue(argv, '--speculation-profile')).toBe(DEFAULT_POSTURE.speculationProfile)
    expect(flagValue(argv, '--block-size-tokens')).toBe('16')
    // 16384 context / 16 block size, unchanged by this fix.
    expect(flagValue(argv, '--total-blocks')).toBe('1024')
    // Stacking stays opt-out: the posture value is false, so no flag is sent.
    expect(argv).not.toContain('--mlx-mtp-disable-ngram-stacking')
  })

  it('treats the MTP policy as part of posture identity', () => {
    // server.json equality decides whether the sidecar must respawn, so a
    // policy change has to change the canonical posture string.
    const required = canonicalPosture(posture())
    const disabled = canonicalPosture(posture({ mlxMtpPolicy: 'disabled' }))

    expect(required).not.toBe(disabled)
    expect(JSON.parse(required).mlxMtpPolicy).toBe('required')
    expect(JSON.parse(disabled).mlxMtpPolicy).toBe('disabled')
  })
})
