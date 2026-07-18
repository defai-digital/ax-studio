import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  Channel: class MockChannel<T> {
    onmessage?: (event: T) => void
  },
  invoke: mocks.invoke,
}))

import { createMlxIpcFetch } from '../mlx-ipc-fetch'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createMlxIpcFetch', () => {
  it('does not expose parse exception details in the response body', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchFn = createMlxIpcFetch()

    const response = await fetchFn('http://localhost/v1/chat/completions', {
      method: 'POST',
      body: '{',
    })

    await expect(response.json()).resolves.toEqual({
      error: 'mlx fetch could not parse request body',
    })
    expect(response.status).toBe(400)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('forwards MLX stream deltas before the done event', async () => {
    const done = deferred<void>()

    mocks.invoke.mockImplementation(async (command: string, args: any) => {
      if (command === 'mlx_load_model') return undefined
      if (command === 'mlx_chat_stream') {
        args.onEvent.onmessage({
          type: 'start',
          model_id: 'test-model',
          prompt_token_count: 3,
        })
        args.onEvent.onmessage({ type: 'delta', text: 'hello' })
        await done.promise
        args.onEvent.onmessage({
          type: 'done',
          prompt_token_count: 3,
          output_token_count: 1,
          finish_reason: 'stop',
          elapsed_ms: 25,
        })
        return undefined
      }
      throw new Error(`unexpected command ${command}`)
    })

    const fetchFn = createMlxIpcFetch()
    const response = await fetchFn('http://localhost/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'test-model',
        stream: true,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    })

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let streamed = ''

    for (let i = 0; i < 3 && !streamed.includes('hello'); i++) {
      const read = await reader.read()
      expect(read.done).toBe(false)
      streamed += decoder.decode(read.value)
    }

    expect(streamed).toContain('hello')

    done.resolve()
    await reader.cancel()
  })

  it('maps OpenAI chat params onto mlx_chat_completion IPC args', async () => {
    mocks.invoke.mockImplementation(async (command: string, args: any) => {
      if (command === 'mlx_load_model') {
        expect(args).toEqual({ modelId: 'mlx-community/Qwen3-4B-4bit' })
        return undefined
      }
      if (command === 'mlx_chat_completion') {
        expect(args).toEqual({
          modelId: 'mlx-community/Qwen3-4B-4bit',
          messages: [{ role: 'user', content: 'hi' }],
          params: {
            max_output_tokens: 128,
            temperature: 0.2,
            top_p: 0.9,
            top_k: 40,
            repetition_penalty: 1.1,
            seed: 7,
            stop: ['END'],
          },
        })
        return {
          id: 'mlx-1',
          object: 'chat.completion',
          created: 1,
          model: 'mlx-community/Qwen3-4B-4bit',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }
      }
      throw new Error(`unexpected command ${command}`)
    })

    const fetchFn = createMlxIpcFetch()
    const response = await fetchFn('http://localhost/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'mlx-community/Qwen3-4B-4bit',
        stream: false,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 128,
        temperature: 0.2,
        top_p: 0.9,
        top_k: 40,
        frequency_penalty: 0.1,
        seed: 7,
        stop: 'END',
      }),
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      object: 'chat.completion',
      choices: [{ message: { content: 'ok' } }],
    })
    expect(mocks.invoke).toHaveBeenCalledWith(
      'mlx_load_model',
      expect.objectContaining({ modelId: 'mlx-community/Qwen3-4B-4bit' })
    )
    expect(mocks.invoke).toHaveBeenCalledWith(
      'mlx_chat_completion',
      expect.any(Object)
    )
  })

  it('accepts a POST Request object without a separate init argument', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'mlx_load_model') return undefined
      if (command === 'mlx_chat_completion') {
        return {
          id: 'mlx-request-input',
          object: 'chat.completion',
          created: 1,
          model: 'test-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
          },
        }
      }
      throw new Error(`unexpected command ${command}`)
    })

    const fetchFn = createMlxIpcFetch()
    const response = await fetchFn(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      })
    )

    expect(response.status).toBe(200)
    expect(mocks.invoke).toHaveBeenCalledWith('mlx_load_model', {
      modelId: 'test-model',
    })
    expect(mocks.invoke).toHaveBeenCalledWith('mlx_chat_completion', {
      modelId: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      params: {},
    })
  })
})
