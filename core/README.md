# @ax-fabric/core

The Core SDK for the Ax-Fabric AI application framework. This library provides the essential TypeScript interfaces, base classes, and system bridges required to build and extend Ax-Fabric.

## Roles & Responsibilities

1.  **System Bridge**: Exposes native Tauri functionality (File System, OS, Shell) to the frontend via a unified `core.api` object.
2.  **Extension System**: Defines the `Extension` base class and lifecycle hooks (`onLoad`, `onUnload`) for modular feature development.
3.  **Type Definitions**: Serves as the single source of truth for shared data structures (Messages, Threads, Models, Settings).
4.  **Event Bus**: Provides a global event system for communication between the core app and installed extensions.

## Installation

```bash
# In a workspace package (e.g., an extension)
yarn add @ax-fabric/core
```

## Core API Reference

The Core SDK attaches itself to the global scope as `window.core` (in the browser) or `globalThis.core` (in extensions).

### Filesystem API
```typescript
import { fs } from '@ax-fabric/core';

// Read a file from the app data folder
const content = await fs.readFile('settings.json');

// Check if a file exists
const exists = await fs.exists('models/llama3.gguf');
```

### Event System
```typescript
import { events } from '@ax-fabric/core';

// Listen for new messages
events.on('message:received', (msg) => {
  console.log('New message:', msg.text);
});

// Emit a custom event
events.emit('my-extension:action', { status: 'success' });
```

## Service Abstractions

The Core SDK provides abstractions for interacting with Ax-Fabric's specialized backend services.

### AkiDB (Vector Storage)
AkiDB is a specialized vector database service. The Core SDK allows extensions to store and query embeddings.
- **`core.api.akidb.store(vector, metadata)`**: Persist a vector embedding.
- **`core.api.akidb.query(vector, topK)`**: Perform a similarity search.

### Retrieval Service
Handles document ingestion and semantic search orchestration.
- **`core.api.retrieval.ingest(filePath)`**: Processes a local file (PDF, TXT, etc.) into the vector store.
- **`core.api.retrieval.search(query)`**: Returns relevant context chunks for a given natural language query.

## Creating an Extension

All Ax-Fabric extensions must extend the `BaseExtension` class provided by the Core SDK.

```typescript
import { BaseExtension, MessageEvent } from '@ax-fabric/core';

export default class MyCustomExtension extends BaseExtension {
  /**
   * Called when the extension is loaded by the application.
   * Use this to register services, listen to events, or initialize state.
   */
  async onLoad() {
    console.log('MyCustomExtension loaded!');

    this.on(MessageEvent.OnMessageSent, (data) => {
      // Intercept and process outgoing messages
      console.log('Intercepted message:', data.content);
    });
  }

  /**
   * Called when the extension is disabled or the app is shutting down.
   * Perform cleanup here (e.g., unsubscribing from external streams).
   */
  async onUnload() {
    console.log('MyCustomExtension unloaded');
  }
}
```

## Development

### Building the SDK
```bash
# From the root or core/ directory
yarn build
```

The build process uses `tsc` for type generation and `rolldown` for bundling. The output is located in the `dist/` directory.

### Testing
```bash
yarn test
```
Tests are written with `vitest` and cover core logic, event propagation, and utility functions.
