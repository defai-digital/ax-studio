export function removeReasoningContent(content: string): string {
  content = content.replace(/<think[\s\S]*?<\/think>/gi, '')

  if (content.includes('<|channel|>analysis<|message|>')) {
    const match = content.match(
      /<\|channel\|>analysis<\|message\|>([\s\S]*?)<\|start\|>assistant<\|channel\|>final<\|message\|>/
    )
    if (match?.index !== undefined) {
      const splitIndex = match.index + match[0].length
      content = content.slice(splitIndex).trim()
    }
  }
  return content.trim()
}
