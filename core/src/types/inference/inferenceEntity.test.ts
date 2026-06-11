

import { describe, it, expect } from 'vitest'
import {
  ChatCompletionMessage,
  ChatCompletionRole,
  ChatCompletionMessageContentItem,
  ChatCompletionMessageContentType,
  isValidContentItem,
  validateMessageContent,
  ChatCompletionMessageContent
} from './inferenceEntity';

describe('ChatCompletionMessage', () => {
  it('should accept string content', () => {
    const message: ChatCompletionMessage = {
      content: 'Hello, world!',
      role: ChatCompletionRole.System,
    };

    expect(message.content).toBe('Hello, world!');
    expect(message.role).toBe(ChatCompletionRole.System);
  });

  it('should accept array content with valid items', () => {
    const content: ChatCompletionMessageContent = [
      { type: ChatCompletionMessageContentType.Text, text: 'Hello' },
      { type: ChatCompletionMessageContentType.Image, image_url: { url: 'http://example.com/image.jpg' } }
    ];

    const message: ChatCompletionMessage = {
      content,
      role: ChatCompletionRole.User,
    };

    expect(validateMessageContent(message.content)).toBe(true);
    expect(message.role).toBe(ChatCompletionRole.User);
  });
});

describe('isValidContentItem', () => {
  it('should validate text content item', () => {
    const item: ChatCompletionMessageContentItem = {
      type: ChatCompletionMessageContentType.Text,
      text: 'Hello world'
    };

    expect(isValidContentItem(item)).toBe(true);
  });

  it('should validate image content item', () => {
    const item: ChatCompletionMessageContentItem = {
      type: ChatCompletionMessageContentType.Image,
      image_url: { url: 'http://example.com/image.jpg' }
    };

    expect(isValidContentItem(item)).toBe(true);
  });

  it('should validate doc content item', () => {
    const item: ChatCompletionMessageContentItem = {
      type: ChatCompletionMessageContentType.Doc,
      doc_url: { url: 'http://example.com/doc.pdf' }
    };

    expect(isValidContentItem(item)).toBe(true);
  });

  it('should reject invalid text item', () => {
    const invalidItem = {
      type: ChatCompletionMessageContentType.Text,
      text: 123 // wrong type
    };

    expect(isValidContentItem(invalidItem)).toBe(false);
  });

  it('should reject invalid image item', () => {
    const invalidItem = {
      type: ChatCompletionMessageContentType.Image,
      image_url: 'not an object' // wrong structure
    };

    expect(isValidContentItem(invalidItem)).toBe(false);
  });

  it('should reject invalid doc item', () => {
    const invalidItem = {
      type: ChatCompletionMessageContentType.Doc,
      doc_url: { url: null } // null url
    };

    expect(isValidContentItem(invalidItem)).toBe(false);
  });

  it('should reject unknown type', () => {
    const invalidItem = {
      type: 'unknown',
      text: 'test'
    };

    expect(isValidContentItem(invalidItem)).toBe(false);
  });

  it('should reject non-objects', () => {
    expect(isValidContentItem(null)).toBe(false);
    expect(isValidContentItem('string')).toBe(false);
    expect(isValidContentItem(123)).toBe(false);
  });
});

describe('validateMessageContent', () => {
  it('should validate string content', () => {
    expect(validateMessageContent('Hello world')).toBe(true);
    expect(validateMessageContent('')).toBe(true);
  });

  it('should validate array content with valid items', () => {
    const validContent: ChatCompletionMessageContent = [
      { type: ChatCompletionMessageContentType.Text, text: 'Hello' },
      { type: ChatCompletionMessageContentType.Image, image_url: { url: 'http://example.com/image.jpg' } },
      { type: ChatCompletionMessageContentType.Doc, doc_url: { url: 'http://example.com/doc.pdf' } }
    ];

    expect(validateMessageContent(validContent)).toBe(true);
  });

  it('should reject array content with invalid items', () => {
    const invalidContent = [
      { type: ChatCompletionMessageContentType.Text, text: 'Hello' },
      { type: 'invalid', text: 'bad' } // invalid type
    ];

    expect(validateMessageContent(invalidContent)).toBe(false);
  });

  it('should reject non-string non-array content', () => {
    expect(validateMessageContent(null)).toBe(false);
    expect(validateMessageContent(123)).toBe(false);
    expect(validateMessageContent({})).toBe(false);
  });

  it('should reject empty array', () => {
    expect(validateMessageContent([])).toBe(false);
  });
});

describe('isValidContentItem edge cases', () => {
  it('should return false for null input', () => {
    expect(isValidContentItem(null)).toBe(false);
  });

  it('should return false for undefined input', () => {
    expect(isValidContentItem(undefined)).toBe(false);
  });

  it('should return false for number input', () => {
    expect(isValidContentItem(42)).toBe(false);
  });

  it('should return false for string input', () => {
    expect(isValidContentItem('not an object')).toBe(false);
  });

  it('should return true for valid item with extra properties', () => {
    const item = {
      type: ChatCompletionMessageContentType.Text,
      text: 'Hello',
      extra: 'should be ignored',
      anotherExtra: 123,
    };

    expect(isValidContentItem(item)).toBe(true);
  });
});

describe('validateMessageContent edge cases', () => {
  it('should return false for null (not string or array)', () => {
    expect(validateMessageContent(null as unknown as ChatCompletionMessageContent)).toBe(false);
  });

  it('should return true for array with a single valid content item', () => {
    const singleItem: ChatCompletionMessageContent = [
      { type: ChatCompletionMessageContentType.Text, text: 'single item' },
    ];

    expect(validateMessageContent(singleItem)).toBe(true);
  });
});
