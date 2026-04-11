
import { it, expect } from 'vitest'
import { AssistantExtension } from './assistant';
import { ExtensionTypeEnum } from '../extension';
import { Assistant } from '../../types';

class TestAssistantExtension extends AssistantExtension {
  constructor() {
    super('', 'test-assistant-extension', 'Test Assistant Extension', true, 'test', '1.0.0')
  }

  onLoad(): void {}

  onUnload(): void {}

  async createAssistant(_assistant: Assistant): Promise<void> {}

  async deleteAssistant(_assistant: Assistant): Promise<void> {}

  async getAssistants(): Promise<Assistant[]> {
    return []
  }
}

it('should return the correct type', () => {
  const extension = new TestAssistantExtension();
  expect(extension.type()).toBe(ExtensionTypeEnum.Assistant);
});
