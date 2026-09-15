import { beforeEach, expect, it, vi } from 'vitest'
const secrets = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }))
vi.mock('../secure-secret', () => ({
  getSecureSecret: secrets.get,
  setSecureSecret: secrets.set,
}))
beforeEach(() => {
  vi.resetModules()
  secrets.get.mockReset().mockResolvedValue(null)
  secrets.set.mockReset().mockResolvedValue(undefined)
})
function payload(key = 'synthetic-key') {
  return {
    state: {
      providers: [
        {
          provider: 'openai',
          active: true,
          models: [],
          api_key: key,
          settings: [
            {
              key: 'api-key',
              controller_props: { value: key },
              controller_type: 'input',
              title: '',
              description: '',
            },
          ],
        },
      ],
    },
  }
}
it('removes API keys and duplicate input values before local persistence', async () => {
  const storage = await import('../provider-credentials')
  const clean = storage.stripProviderCredentials(payload())
  expect(JSON.stringify(clean)).not.toContain('synthetic-key')
  await storage.persistProviderCredentials()
  expect(secrets.set).toHaveBeenLastCalledWith(
    'model-provider-credentials',
    '{"openai":"synthetic-key"}'
  )
})
it('restores saved keys after restart without putting them in metadata', async () => {
  secrets.get.mockResolvedValue('{"openai":"saved-key"}')
  const storage = await import('../provider-credentials')
  await storage.initializeProviderCredentials()
  const providers = payload().state.providers.map(({ api_key: _, ...p }) => ({
    ...p,
    settings: [],
  }))
  expect(storage.restoreProviderCredentials(providers)[0].api_key).toBe(
    'saved-key'
  )
})
it('migrates legacy credentials and preserves unrelated providers', async () => {
  secrets.get.mockResolvedValue('{"other":"keep"}')
  const storage = await import('../provider-credentials')
  storage.stripProviderCredentials(payload('legacy'))
  await storage.persistProviderCredentials()
  expect(JSON.parse(secrets.set.mock.calls.at(-1)![1])).toEqual({
    other: 'keep',
    openai: 'legacy',
  })
})
it('serializes replacement and clearing of credentials', async () => {
  const storage = await import('../provider-credentials')
  storage.stripProviderCredentials(payload('old'))
  const first = storage.persistProviderCredentials()
  storage.stripProviderCredentials(payload('new'))
  const second = storage.persistProviderCredentials()
  storage.stripProviderCredentials(payload(''))
  await Promise.all([first, second, storage.persistProviderCredentials()])
  expect(JSON.parse(secrets.set.mock.calls.at(-1)![1])).toEqual({ openai: '' })
})
it('does not let blank background snapshots overwrite hydrated credentials', async () => {
  const storage = await import('../provider-credentials')
  storage.stripProviderCredentials(payload('legacy-key'))
  await storage.persistProviderCredentials()
  const metadata = storage.stripProviderCredentials(payload(''), false)
  await storage.persistProviderCredentials()
  expect(JSON.stringify(metadata)).not.toContain('legacy-key')
  expect(JSON.parse(secrets.set.mock.calls.at(-1)![1]).openai).toBe(
    'legacy-key'
  )
})

it('surfaces secure-store failures rather than claiming persistence succeeded', async () => {
  secrets.set.mockRejectedValue(new Error('keychain unavailable'))
  const storage = await import('../provider-credentials')
  storage.stripProviderCredentials(payload())
  await expect(storage.persistProviderCredentials()).rejects.toThrow(
    'keychain unavailable'
  )
})
it('clears the saved key when its provider is deleted', async () => {
  secrets.get.mockResolvedValue('{"openai":"old-key"}')
  const storage = await import('../provider-credentials')
  await storage.clearProviderCredential('openai')
  expect(JSON.parse(secrets.set.mock.calls.at(-1)![1]).openai).toBe('')
})
it('strips valid credentials even alongside malformed legacy entries', async () => {
  const storage = await import('../provider-credentials')
  const data = payload()
  const malformed = {
    state: {
      providers: [
        null,
        ...data.state.providers,
        { provider: 'other', settings: [null, { key: 'api-key' }] },
      ],
    },
  }
  expect(
    JSON.stringify(
      storage.stripProviderCredentials(malformed as unknown as typeof data)
    )
  ).not.toContain('synthetic-key')
})
