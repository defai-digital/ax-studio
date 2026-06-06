/**
 * LLM Router Prompt Builder
 *
 * Builds the system and user prompts for the router model.
 * The router model receives the user's message + list of available models
 * and picks the single best model for the task.
 */

const ROUTER_SYSTEM_PROMPT = `You are an LLM router. Your job is to select the best model for a given user message.

You will receive:
1. A user message (the task to be handled)
2. A list of available models

Based on the task type and your knowledge of each model's strengths, select the single best model. Consider:
- Task type: coding, reasoning, math, creative writing, translation, summarization, general Q&A, analysis, multimodal, etc.
- Model strengths: which models excel at this type of task
- Efficiency: prefer faster/cheaper models for simple tasks, reserve powerful models for complex tasks

Respond with ONLY a JSON object, no markdown, no code fences, no other text:
{"model": "<model_id>", "provider": "<provider_name>", "reason": "<brief reason>"}

The "model" and "provider" values MUST exactly match one of the available models listed.
The "reason" field should be 2-5 words describing the task type (e.g., "code generation", "complex reasoning", "quick factual question").

If you are unsure or the task doesn't clearly favor any model, respond with:
{"model": "default", "provider": "default", "reason": "general task"}`

/**
 * Build the user prompt containing available models and the user's message.
 */
export function buildRouterPrompt(
  userMessage: string,
  availableModels: AvailableModelForRouter[],
  recentContext?: string,
): { system: string; user: string } {
  const modelList = availableModels
    .map((m) => `- ${m.id} (${m.provider}) — ${m.displayName}`)
    .join('\n')

  const contextSection = recentContext
    ? `\nRecent conversation context:\n"""\n${recentContext}\n"""\n`
    : ''

  const user = `Available models:\n${modelList}\n${contextSection}\nUser message:\n"""\n${userMessage}\n"""`

  return { system: ROUTER_SYSTEM_PROMPT, user }
}
