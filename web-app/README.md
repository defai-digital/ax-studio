# Ax-Fabric Web App

The frontend for the Ax-Fabric AI desktop application, built with **React 19**, **Vite**, and **Tailwind CSS 4**. It serves as the primary user interface for chatting with AI models, managing extensions, and configuring system settings.

## Architecture

The web app is a Single Page Application (SPA) that interacts with the native system via the **Tauri IPC bridge** and the **Ax-Fabric Core SDK**.

### Key Technologies

- **Framework**: [React 19](https://react.dev/) (Concurrent rendering, Server Components patterns)
- **Routing**: [TanStack Router](https://tanstack.com/router) (Type-safe, file-based routing)
- **State Management**: [Zustand 5](https://zustand-demo.pmnd.rs/) (Persistent stores for settings, chat history, and models)
- **AI Integration**: [Vercel AI SDK](https://sdk.vercel.ai/) (Unified interface for streaming and provider management)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) (Accessible primitives)
- **Icons**: [Lucide React](https://lucide.dev/) & [Tabler Icons](https://tabler-icons.io/)

## Project Structure

```
src/
├── components/        # Reusable UI primitives (buttons, inputs, modals)
├── containers/        # Feature-specific layouts and complex components
│   ├── chat/          # Chat interface, message lists, input area
│   ├── settings/      # Configuration panels (General, Models, MCP, etc.)
│   └── sidebar/       # Navigation and thread management
├── hooks/             # Custom hooks (useModel, useChat, useFileSystem)
├── lib/               # Business logic and utility functions
│   ├── ModelFactory.ts # Logic for instantiating different AI providers
│   └── ServiceHub.ts   # Central registry for application services
├── providers/         # React Context providers (Theme, I18n, Toast)
├── routes/            # TanStack Router directory (file-based routing)
├── stores/            # Zustand store definitions (useAppStore, useThreadStore)
├── types/             # TypeScript interfaces and type definitions
└── locales/           # Multi-language translation files (JSON)
```

## Development

### Setup

Ensure you have the root dependencies installed and the `core` package built:

```bash
# From the project root
make install-and-build
```

### Running the Web App

You can run the web app in two modes:

1.  **Tauri Mode (Recommended)**: Runs inside the native window with full system access.
    ```bash
    yarn dev:tauri
    ```
2.  **Browser Mode**: Runs in a standard web browser (useful for UI/CSS debugging).
    ```bash
    yarn dev:web
    ```
    *Note: System-level APIs (file I/O, native plugins) will be mocked or unavailable in Browser Mode.*

## Features & Advanced Tools

### Personalization
The web app offers deep personalization options to tailor the AI experience:
- **Themes**: Support for Light, Dark, and System themes.
- **Accent Colors**: Custom color pickers for UI accents.
- **Typography**: Adjustable font sizes for readability.
- **Internationalization**: Full support for multiple languages via `react-i18next`.

### Advanced Interaction
- **Voice (STT/TTS)**: Integrated Speech-to-Text and Text-to-Speech capabilities for hands-free interaction.
- **Token Management**: Real-time token counting and speed indicators (tokens per second) to monitor model performance and costs.
- **Markdown & Code**: Rich rendering of Markdown, including Math (KaTeX), Diagrams (Mermaid), and syntax highlighting (Shiki).

## Coding Standards

- **Type Safety**: Avoid `any`. Define interfaces in `src/types/` or co-locate them with components.
- **Component Patterns**: Use functional components with hooks. Prefer composition over inheritance.
- **Styling**: Use Tailwind utility classes. For complex components, use `class-variance-authority` (CVA).
- **Internationalization**: All user-facing strings must use `t()` from `react-i18next`. Add keys to `src/locales/en.json` first.

## Integration with Core & Tauri

The web app communicates with the backend via `globalThis.core.api`. Most calls are abstracted through services in `src/lib/` or custom hooks in `src/hooks/`.

Example of calling a Tauri command:
```typescript
import { invoke } from '@tauri-apps/api/core';

const result = await invoke('get_app_config');
```

Example of using a Core SDK event:
```typescript
import { events } from '@ax-fabric/core';

events.on('message:sent', (data) => {
  console.log('Message sent:', data);
});
```
