type CircuitState = {
  failures: number
  lastFailure: number
  state: 'closed' | 'open' | 'half-open'
}

const FAILURE_THRESHOLD = 2
const RESET_TIMEOUT_MS = 30000

export class AgentHealthMonitor {
  private circuits: Map<string, CircuitState> = new Map()

  shouldCall(agentId: string): boolean {
    const circuit = this.circuits.get(agentId)
    if (!circuit || circuit.state === 'closed') return true

    if (circuit.state === 'open') {
      if (Date.now() - circuit.lastFailure > RESET_TIMEOUT_MS) {
        // Allow one probe. Stay 'open' so concurrent calls are blocked.
        // If the probe succeeds, recordSuccess() will close the circuit.
        // If it fails, recordFailure() keeps it open with a fresh timer.
        return true
      }
      return false
    }

    // half-open state should not normally be reached (we removed the transition above),
    // but handle it defensively by allowing a call
    return true
  }

  recordSuccess(agentId: string): void {
    const circuit = this.circuits.get(agentId)
    if (circuit) {
      circuit.failures = 0
      circuit.state = 'closed'
    }
  }

  recordFailure(agentId: string): void {
    const circuit = this.circuits.get(agentId) ?? {
      failures: 0,
      lastFailure: 0,
      state: 'closed' as const,
    }
    circuit.failures++
    circuit.lastFailure = Date.now()
    if (circuit.failures >= FAILURE_THRESHOLD) {
      circuit.state = 'open'
    }
    this.circuits.set(agentId, circuit)
  }

  getStatus(agentId: string): 'healthy' | 'degraded' | 'unavailable' {
    const circuit = this.circuits.get(agentId)
    if (!circuit || circuit.state === 'closed') return 'healthy'
    if (circuit.state === 'half-open') return 'degraded'
    return 'unavailable'
  }
}
