# @ax-studio/core

Shared TypeScript SDK for AX Studio.

This package provides shared contracts, browser-facing APIs, and extension-facing building blocks used by the web app and packaged extensions.

## Install / Consume

Within this repository, consumers reference the workspace package directly:

```ts
import * as core from '@ax-studio/core'
```

## Common Commands

From the repository root:

```bash
yarn workspace @ax-studio/core build
yarn workspace @ax-studio/core test
yarn workspace @ax-studio/core test:coverage
```

## Responsibilities

- shared type definitions
- extension system contracts
- browser-facing APIs used across packages
- stable interfaces consumed by the app and extensions

## Contributor Guide

See [CONTRIBUTING.md](./CONTRIBUTING.md) for package-specific development guidance.
