# Contributing to Ax-Fabric Extensions

Ax-Fabric extensions are self-contained modules that add features to the application (e.g., chat persistence, model downloading, specific AI assistants). Extensions are written in TypeScript and leverage the `@ax-fabric/core` SDK.

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
import { BaseExtension } from '@ax-fabric/core';

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

## Build & Publish Flow

The extension build process involves:
1.  **TypeScript Compilation**: Transpiles `.ts` to `.js`.
2.  **Bundling**: Uses [Rolldown](https://rolldown.rs/) to bundle code into a single `dist/index.js` file.
3.  **Packing**: `npm pack` creates a `.tgz` file (e.g., `ax-fabric-hello-world-v1.0.0.tgz`).
4.  **Publishing**: The `.tgz` is moved to the root `pre-install/` directory, where the main app can load it on startup.

### Makefile Helpers
Use the root `Makefile` to build all extensions at once:
```bash
make build-extensions
```

## Best Practices

- **Resource Management**: Always clean up event listeners and timers in `onUnload()`.
- **Async Operations**: All extension hooks (`onLoad`, `onUnload`) are `async`. Use `await` for I/O.
- **Isolation**: Don't rely on other extensions unless strictly necessary. Communicate via events.
- **Testing**: Add a `test/` directory and use Vitest to verify extension logic in isolation.

## Common Issues

- **Extension Not Loading**: Check the browser console (Ctrl+Shift+I) for errors during `onLoad()`.
- **Typing Errors**: Ensure `@ax-fabric/core` is correctly linked in your `package.json`.
- **Stale Builds**: Run `make clean` to remove old `.tgz` files before rebuilding.
