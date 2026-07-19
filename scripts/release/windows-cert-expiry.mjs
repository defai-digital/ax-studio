/**
 * Pure Windows code-signing certificate expiry policy.
 *
 * Tiers (checked in order of severity):
 *   expired    — notAfter <= now
 *   fail_soon  — fewer than 30 days remaining (block release)
 *   warn       — fewer than 60 days remaining
 *   notice     — fewer than 90 days remaining
 *   ok         — 90+ days remaining
 */

export const CERT_EXPIRY_TIERS = Object.freeze({
  EXPIRED: 'expired',
  FAIL_SOON: 'fail_soon',
  WARN: 'warn',
  NOTICE: 'notice',
  OK: 'ok',
})

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * @param {string} notAfterIso ISO-8601 timestamp from windows-cert.json
 * @param {number} [nowMs=Date.now()] injectable clock for tests
 * @returns {{
 *   tier: string,
 *   daysRemaining: number | null,
 *   notAfterMs: number | null,
 *   message: string,
 * }}
 */
export function evaluateWindowsCertExpiry(notAfterIso, nowMs = Date.now()) {
  if (typeof notAfterIso !== 'string' || !notAfterIso.trim()) {
    return {
      tier: CERT_EXPIRY_TIERS.EXPIRED,
      daysRemaining: null,
      notAfterMs: null,
      message: 'Windows certificate notAfter is missing or empty',
    }
  }

  const notAfterMs = Date.parse(notAfterIso)
  if (Number.isNaN(notAfterMs)) {
    return {
      tier: CERT_EXPIRY_TIERS.EXPIRED,
      daysRemaining: null,
      notAfterMs: null,
      message: `Windows certificate notAfter must be an ISO-8601 timestamp, got: ${notAfterIso}`,
    }
  }

  const daysRemaining = Math.floor((notAfterMs - nowMs) / DAY_MS)

  if (daysRemaining < 0 || notAfterMs <= nowMs) {
    return {
      tier: CERT_EXPIRY_TIERS.EXPIRED,
      daysRemaining,
      notAfterMs,
      message: `Windows code-signing certificate expired (${notAfterIso}); renew DigiCert / Key Vault cert before release`,
    }
  }

  if (daysRemaining < 30) {
    return {
      tier: CERT_EXPIRY_TIERS.FAIL_SOON,
      daysRemaining,
      notAfterMs,
      message: `Windows code-signing certificate expires in ${daysRemaining} day(s) (${notAfterIso}); renew before release`,
    }
  }

  if (daysRemaining < 60) {
    return {
      tier: CERT_EXPIRY_TIERS.WARN,
      daysRemaining,
      notAfterMs,
      message: `Windows code-signing certificate expires in ${daysRemaining} day(s) (${notAfterIso}); plan DigiCert renewal`,
    }
  }

  if (daysRemaining < 90) {
    return {
      tier: CERT_EXPIRY_TIERS.NOTICE,
      daysRemaining,
      notAfterMs,
      message: `Windows code-signing certificate expires in ${daysRemaining} day(s) (${notAfterIso}); schedule renewal`,
    }
  }

  return {
    tier: CERT_EXPIRY_TIERS.OK,
    daysRemaining,
    notAfterMs,
    message: `Windows code-signing certificate valid for ${daysRemaining} day(s) (until ${notAfterIso})`,
  }
}

/**
 * Emit GitHub Actions annotations when running in CI; otherwise console.warn/log.
 * @param {{ tier: string, message: string }} evaluation
 */
export function reportWindowsCertExpiry(evaluation) {
  const isGha = process.env.GITHUB_ACTIONS === 'true'
  const { tier, message } = evaluation

  if (tier === CERT_EXPIRY_TIERS.EXPIRED || tier === CERT_EXPIRY_TIERS.FAIL_SOON) {
    if (isGha) {
      console.log(`::error title=Windows code-signing cert::${message}`)
    }
    return
  }

  if (tier === CERT_EXPIRY_TIERS.WARN) {
    if (isGha) {
      console.log(`::warning title=Windows code-signing cert::${message}`)
    } else {
      console.warn(`warning: ${message}`)
    }
    return
  }

  if (tier === CERT_EXPIRY_TIERS.NOTICE) {
    if (isGha) {
      console.log(`::notice title=Windows code-signing cert::${message}`)
    } else {
      console.log(`notice: ${message}`)
    }
  }
}

export function applyWindowsCertExpiryPolicy(notAfterIso, nowMs = Date.now()) {
  const evaluation = evaluateWindowsCertExpiry(notAfterIso, nowMs)
  reportWindowsCertExpiry(evaluation)
  return evaluation
}
