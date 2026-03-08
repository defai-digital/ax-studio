# Contributing to Ax-Studio Extensions

[← Back to Main Contributing Guide](../CONTRIBUTING.md)

Extensions add specific features to Ax-Studio as self-contained modules.

## Current Extensions

- **`assistant-extension/`**: CRUD operations for AI assistants.
- **`conversational-extension/`**: Logic for managing threads and messages.
- **`download-extension/`**: Downloads models from HuggingFace with progress tracking.
- **`llamacpp-extension/`**: Local model inference via `llama.cpp`.

## Quick Start: "Hello World" Extension

### 1. Create the Directory
```bash
mkdir extensions/hello-world
cd extensions/hello-world
yarn init
```

### 2. Configure `package.json`
Ensure your `package.json` follows this format:
```json
{
  "name": "@ax-fabric/hello-world",
  "version": "1.0.0",
  "main": "dist/index.js",
  "dependencies": {
    "@ax-fabric/core": "../../core/package.tgz"
  },
  "scripts": {
    "build": "rolldown -c rolldown.config.mjs"
  }
}
```

### 3. Implement `src/index.ts`
```typescript
import { Extension } from '@ax-studio/core'

export default class HelloWorld extends BaseExtension {
  async onLoad() {
    console.log('Hello world extension loaded!');
    
    // Register a simple command that can be called from the UI
    this.registerService('greet', {
      sayHi: async (name: string) => `Hello, ${name}!`
    });
  }

  async onUnload() {
    console.log('Hello world extension unloaded');
  }
}
```

### 4. Build and Install
```bash
yarn build
# This creates a .tgz file. Install it in Ax-Fabric via Settings > Extensions.
```

## Common Patterns

### Service Registration
```typescript
async onLoad() {
  this.registerService('myService', {
    doSomething: async () => 'result'
  })
}
```

### Event Handling  
```typescript
async onLoad() {
  this.on('model:loaded', (model) => {
    console.log('Model loaded:', model.id)
  })
}
```

## Extension Lifecycle

1. **Ax-Studio starts** → Discovers extensions
2. **Loading** → Calls `onLoad()` method  
3. **Active** → Extension responds to events
4. **Unloading** → Calls `onUnload()` on shutdown

## Debugging Extensions

```bash
# Check if extension loaded
console.log(window.core.extensions)

# Debug extension events
this.on('*', console.log)

# Check extension services
console.log(window.core.api)
```

## Common Issues

**Extension not loading?**
- Check package.json format: `@ax-studio/extension-name`
- Ensure `onLoad()` doesn't throw errors
- Verify exports in index.ts

**Events not working?**
- Check event name spelling
- Ensure listeners are set up in `onLoad()`

## Best Practices

- Keep extensions focused on one feature
- Use async/await for all operations
- Clean up resources in onUnload()
- Handle errors gracefully
- Don't depend on other extensions

## Dependencies

- **@ax-studio/core** - Core SDK and extension system
- **TypeScript** - Type safety
- **Rolldown** - Bundling