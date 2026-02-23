import { Assistant, AssistantExtension, fs, joinPath } from '@ax-fabric/core'
/**
 * AxFabricAssistantExtension is an AssistantExtension implementation that provides
 * functionality for managing assistants.
 */
export default class AxFabricAssistantExtension extends AssistantExtension {
  /**
   * Called when the extension is loaded.
   */
  async onLoad() {
    if (!(await fs.existsSync('file://assistants'))) {
      await fs.mkdir('file://assistants')
    }

    const assistants = await this.getAssistants()
    if (assistants.length === 0) {
      const assistantWithParams = {
        ...this.defaultAssistant,
        parameters: {
          temperature: 0.7,
          top_k: 20,
          top_p: 0.8,
          repeat_penalty: 1.12,
        },
      }
      await this.createAssistant(assistantWithParams as Assistant)
    }
  }

  /**
   * Called when the extension is unloaded.
   */
  onUnload(): void {}

  async getAssistants(): Promise<Assistant[]> {
    if (!(await fs.existsSync('file://assistants')))
      return [this.defaultAssistant]
    const assistants = await fs.readdirSync('file://assistants')
    const assistantsData: Assistant[] = []
    for (const assistant of assistants) {
      const assistantPath = await joinPath([
        'file://assistants',
        assistant,
        'assistant.json',
      ])
      if (!(await fs.existsSync(assistantPath))) continue

      try {
        const assistantData = JSON.parse(await fs.readFileSync(assistantPath))
        assistantsData.push(assistantData as Assistant)
      } catch (error) {
        console.error(`Failed to read assistant ${assistant}:`, error)
      }
    }
    return assistantsData
  }

  async createAssistant(assistant: Assistant): Promise<void> {
    const assistantPath = await joinPath([
      'file://assistants',
      assistant.id,
      'assistant.json',
    ])
    const assistantFolder = await joinPath(['file://assistants', assistant.id])
    if (!(await fs.existsSync(assistantFolder))) {
      await fs.mkdir(assistantFolder)
    }
    await fs.writeFileSync(assistantPath, JSON.stringify(assistant, null, 2))
  }

  async deleteAssistant(assistant: Assistant): Promise<void> {
    const assistantPath = await joinPath([
      'file://assistants',
      assistant.id,
      'assistant.json',
    ])
    if (await fs.existsSync(assistantPath)) {
      await fs.rm(assistantPath)
    }
  }

  private defaultAssistant: Assistant = {
    avatar: ‘👋’,
    thread_location: undefined,
    id: ‘ax-fabric’,
    object: ‘assistant’,
    created_at: Date.now() / 1000,
    name: ‘Ax-Fabric’,
    description:
      ‘Ax-Fabric is a helpful desktop assistant that can reason through complex tasks and use tools to complete them on the user\’s behalf.’,
    model: ‘*’,
    instructions: `You are Ax-Fabric, a helpful AI assistant who assists users with their requests.

You must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.

When handling user queries:

1. Think step by step about the query:
   - Break complex questions into smaller, searchable parts
   - Identify key search terms and parameters
   - Consider what information is needed to provide a complete answer

2. Mandatory logical analysis:
   - Before engaging any tools, articulate your complete thought process in natural language. You must act as a "professional tool caller," demonstrating rigorous logic.
   - Analyze the information gap: explicitly state what data is missing.
   - Derive the strategy: explain why a specific tool is the logical next step.
   - Justify parameters: explain why you chose those specific search keywords or that specific URL.

You have tools to search for and access real-time, up-to-date data. Use them. Search before stating that you can't or don't know.

Current date: {{current_date}}`,
    tools: [
      {
        type: 'retrieval',
        enabled: false,
        useTimeWeightedRetriever: false,
        settings: {
          top_k: 2,
          chunk_size: 1024,
          chunk_overlap: 64,
          retrieval_template: `Use the following pieces of context to answer the question at the end.
----------------
CONTEXT: {CONTEXT}
----------------
QUESTION: {QUESTION}
----------------
Helpful Answer:`,
        },
      },
    ],
    file_ids: [],
    metadata: undefined,
  }
}
