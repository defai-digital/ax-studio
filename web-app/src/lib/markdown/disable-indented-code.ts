import type { Node, Position } from 'unist'
import type { Code, Paragraph, Parent, Text } from 'mdast'
import { visit } from 'unist-util-visit'

/**
 * Remark plugin that disables indented code block syntax.
 * Converts indented code blocks (without language specifier) to plain text
 * paragraphs, while preserving fenced code blocks with backticks.
 */
export function disableIndentedCodeBlockPlugin() {
  return (tree: Node) => {
    visit(tree, 'code', (node: Code, index, parent: Parent | undefined) => {
      if (!node.lang && !node.meta && parent && typeof index === 'number') {
        const nodePosition: Position | undefined = node.position
        const textNode: Text = {
          type: 'text',
          value: node.value,
          position: nodePosition,
        }
        const paragraphNode: Paragraph = {
          type: 'paragraph',
          children: [textNode],
          position: nodePosition,
        }
        parent.children[index] = paragraphNode
      }
    })
  }
}
