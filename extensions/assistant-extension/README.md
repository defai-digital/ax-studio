# AX Studio Assistant Extension Template

This package is a starting point for building an AX Studio extension in TypeScript.

## What It Is For

Use this template when you want to create an extension package that integrates with the AX Studio extension system and `@ax-studio/core`.

## Basic Flow

1. Copy this package as the basis for a new extension.
2. Update `package.json` metadata for your extension name and description.
3. Replace the implementation in `src/` with your extension logic.
4. Build the package and install the generated artifact in AX Studio.

## Local Setup

Use Node.js 20+.

Install dependencies:

```bash
npm install
```

Build the distributable package:

```bash
npm run bundle
```

This produces a `.tgz` artifact that can be installed through the app’s extension settings.

## Coding Notes

- extension logic is typically asynchronous
- use `@ax-studio/core` for shared contracts and events
- keep extension code focused on one feature area

Example:

```ts
import { events, MessageEvent, MessageRequest } from '@ax-studio/core'

function onStart(): Promise<any> {
  return events.on(MessageEvent.OnMessageSent, (data: MessageRequest) =>
    this.inference(data)
  )
}
```

See the shared SDK guide in [core/README.md](../../core/README.md).
