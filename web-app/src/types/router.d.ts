/**
 * LLM Router type definitions
 *
 * The router autonomously selects the best model for each user message
 * by sending a lightweight classification request to a user-configured
 * "router model". No manual routing table — the router model decides.
 */

/** A model available for routing (flattened from providers) */
type AvailableModelForRouter = {
  id: string
  provider: string
  displayName: string
}

/** The result of a routing decision */
type RouterResult = {
  /** The chosen model ID */
  modelId: string
  /** The chosen model's provider */
  providerId: string
  /** Short explanation from router (e.g., "code generation task") */
  reason: string
  /** true = router decided, false = used fallback */
  routed: boolean
  /** Why fallback was used (if routed=false) */
  fallbackReason?: string
  /** How long the classification took in ms */
  latencyMs: number
}
