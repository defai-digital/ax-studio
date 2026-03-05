import type { OrchestrationType } from '@/types/agent-team'

export interface TemplateAgent {
  name: string
  role: string
  goal: string
  instructions: string
  tool_scope?: { mode: 'all' | 'include' | 'exclude'; tool_keys: string[] }
  max_steps?: number
  max_result_tokens?: number
  timeout?: { total_ms?: number; step_ms?: number }
  optional?: boolean
}

export interface TeamTemplate {
  name: string
  description: string
  orchestration: OrchestrationType
  orchestrator_instructions?: string
  token_budget?: number
  parallel_stagger_ms?: number
  agents: TemplateAgent[]
}

export const TEMPLATES: TeamTemplate[] = [
  {
    name: 'Research & Report',
    description:
      'A researcher gathers information, then a writer produces a structured report.',
    orchestration: { mode: 'sequential' },
    token_budget: 80000,
    agents: [
      {
        name: 'Researcher',
        role: 'Senior Research Analyst',
        goal: 'Find and verify information from multiple sources',
        instructions:
          'Search thoroughly, cross-reference sources, provide comprehensive findings with citations. Structure: Key Findings, Sources, Confidence Level.',
        tool_scope: {
          mode: 'include',
          tool_keys: ['exa::search', 'exa::get_contents'],
        },
        max_steps: 15,
        max_result_tokens: 6000,
        timeout: { total_ms: 180000 },
      },
      {
        name: 'Writer',
        role: 'Technical Writer',
        goal: 'Produce clear, well-structured reports',
        instructions:
          'Transform research findings into clear, well-organized reports with proper headings, executive summary, and conclusions. Cite sources.',
        max_steps: 5,
        max_result_tokens: 8000,
      },
    ],
  },
  {
    name: 'Code Review',
    description:
      'Three reviewers analyze code in parallel: quality, security, and performance.',
    orchestration: { mode: 'parallel' },
    token_budget: 60000,
    parallel_stagger_ms: 200,
    agents: [
      {
        name: 'Quality Reviewer',
        role: 'Code Quality Reviewer',
        goal: 'Find bugs, logic errors, and code quality issues',
        instructions:
          'Review for correctness, readability, naming, error handling, potential bugs. Rate severity: Critical/Major/Minor/Suggestion.',
        max_steps: 5,
        max_result_tokens: 4000,
      },
      {
        name: 'Security Auditor',
        role: 'Security Analyst',
        goal: 'Identify security vulnerabilities and OWASP risks',
        instructions:
          'Audit for injection, XSS, auth issues, OWASP Top 10. Rate severity: Critical/High/Medium/Low.',
        max_steps: 5,
        max_result_tokens: 4000,
      },
      {
        name: 'Performance Reviewer',
        role: 'Performance Engineer',
        goal: 'Identify performance bottlenecks and optimization opportunities',
        instructions:
          'Analyze for unnecessary allocations, N+1 queries, missing indexes, blocking operations. Rate impact: High/Medium/Low.',
        max_steps: 5,
        max_result_tokens: 4000,
      },
    ],
  },
  {
    name: 'Debate',
    description:
      'Two agents argue for and against a proposition, then a moderator synthesizes.',
    orchestration: { mode: 'sequential' },
    token_budget: 40000,
    agents: [
      {
        name: 'Proponent',
        role: 'Advocate',
        goal: 'Build the strongest possible case FOR the proposition',
        instructions:
          'Argue in favor. Present evidence, reasoning, rebuttals. Be persuasive but honest. Structure: Thesis, Key Arguments (3-5), Evidence, Anticipated Counterarguments.',
        max_steps: 3,
        max_result_tokens: 4000,
      },
      {
        name: 'Opponent',
        role: 'Critic',
        goal: 'Build the strongest possible case AGAINST the proposition',
        instructions:
          'Argue against. Challenge assumptions, present counterevidence, identify weaknesses. Structure: Counter-Thesis, Rebuttals, Independent Arguments Against, Evidence.',
        max_steps: 3,
        max_result_tokens: 4000,
      },
      {
        name: 'Moderator',
        role: 'Neutral Moderator',
        goal: 'Synthesize both perspectives into a balanced analysis',
        instructions:
          'Summarize both sides fairly. Identify strongest points, areas of agreement. Structure: Summary of Each Side, Points of Agreement, Key Differences, Balanced Conclusion.',
        max_steps: 3,
        max_result_tokens: 5000,
      },
    ],
  },
  {
    name: 'Content Pipeline',
    description:
      'A researcher, writer, and editor collaborate sequentially to produce polished content.',
    orchestration: { mode: 'sequential' },
    token_budget: 60000,
    agents: [
      {
        name: 'Researcher',
        role: 'Content Researcher',
        goal: 'Gather facts, statistics, and expert quotes on the topic',
        instructions:
          'Research thoroughly. Find statistics, expert opinions, real-world examples. Output format: Facts & Stats, Expert Quotes, Real-World Examples, Suggested Angles.',
        tool_scope: {
          mode: 'include',
          tool_keys: ['exa::search', 'exa::get_contents'],
        },
        max_steps: 10,
        max_result_tokens: 5000,
      },
      {
        name: 'Writer',
        role: 'Content Writer',
        goal: 'Write engaging, well-structured content',
        instructions:
          'Write a compelling article using research. Use clear structure, engaging hooks, smooth transitions. Include citations.',
        max_steps: 5,
        max_result_tokens: 6000,
      },
      {
        name: 'Editor',
        role: 'Copy Editor',
        goal: 'Polish content for grammar, clarity, and flow',
        instructions:
          'Edit for grammar, clarity, conciseness, flow. Fix awkward phrasing. Ensure consistent tone. Return final polished version. Do NOT rewrite substantially.',
        max_steps: 3,
        max_result_tokens: 6000,
      },
    ],
  },
  {
    name: 'Iterative Refiner',
    description:
      'A drafter produces content and a critic evaluates it, iterating until quality threshold is met.',
    orchestration: {
      mode: 'evaluator-optimizer',
      max_iterations: 3,
      quality_threshold:
        'The output is well-structured, accurate, complete, and ready for the intended audience.',
    },
    token_budget: 80000,
    agents: [
      {
        name: 'Drafter',
        role: 'Content Creator',
        goal: 'Produce high-quality output and incorporate feedback',
        instructions:
          'Create the requested content. If you receive evaluator feedback, carefully address each point and improve your output. Mark what you changed in each iteration.',
        max_steps: 5,
        max_result_tokens: 6000,
      },
      {
        name: 'Critic',
        role: 'Quality Evaluator',
        goal: 'Evaluate output quality and provide actionable feedback',
        instructions:
          "Evaluate the output against quality criteria. Score each criterion 1-5. If any criterion scores below 4, provide specific, actionable feedback for improvement. If all criteria score 4+, respond with 'APPROVED' and a brief summary of strengths.",
        max_steps: 3,
        max_result_tokens: 3000,
      },
    ],
  },
]
