export type IntegrationField = {
  key: string
  label: string
  type: 'password' | 'text' | 'url'
  placeholder: string
  docsUrl?: string
}

export type Integration = {
  id: string
  name: string
  description: string
  icon: string
  category: 'development' | 'project-management' | 'communication' | 'productivity'
  mcpPackage: string
  mcpCommand: string
  mcpArgs: string[]
  authType?: 'token' | 'oauth2'
  fields: IntegrationField[]
}

export const INTEGRATIONS: Integration[] = [
  {
    id: 'github',
    name: 'GitHub',
    description: 'Access repositories, issues, pull requests, and code search.',
    icon: '/icons/integrations/github.svg',
    category: 'development',
    mcpPackage: '@modelcontextprotocol/server-github',
    mcpCommand: 'npx',
    mcpArgs: ['-y', '@modelcontextprotocol/server-github'],
    fields: [
      {
        key: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal Access Token',
        type: 'password',
        placeholder: 'ghp_xxxxxxxxxxxx',
        docsUrl: 'https://github.com/settings/tokens',
      },
    ],
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Manage issues, projects, and teams in Linear.',
    icon: '/icons/integrations/linear.svg',
    category: 'project-management',
    mcpPackage: 'linear-mcp-server',
    mcpCommand: 'npx',
    mcpArgs: ['-y', 'linear-mcp-server'],
    fields: [
      {
        key: 'LINEAR_API_KEY',
        label: 'API Key',
        type: 'password',
        placeholder: 'lin_api_xxxxxxxxxxxx',
        docsUrl: 'https://linear.app/settings/api',
      },
    ],
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search and read pages, databases, and content in Notion.',
    icon: '/icons/integrations/notion.svg',
    category: 'productivity',
    mcpPackage: '@notionhq/notion-mcp-server',
    mcpCommand: 'npx',
    mcpArgs: ['-y', '@notionhq/notion-mcp-server'],
    fields: [
      {
        key: 'NOTION_TOKEN',
        label: 'Internal Integration Token',
        type: 'password',
        placeholder: 'ntn_xxxxxxxxxxxx',
        docsUrl: 'https://www.notion.so/profile/integrations',
      },
    ],
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Read and send messages, manage channels in Slack.',
    icon: '/icons/integrations/slack.svg',
    category: 'communication',
    mcpPackage: '@modelcontextprotocol/server-slack',
    mcpCommand: 'npx',
    mcpArgs: ['-y', '@modelcontextprotocol/server-slack'],
    fields: [
      {
        key: 'SLACK_BOT_TOKEN',
        label: 'Bot User OAuth Token',
        type: 'password',
        placeholder: 'xoxb-xxxxxxxxxxxx',
        docsUrl: 'https://api.slack.com/apps',
      },
    ],
  },
  {
    id: 'jira',
    name: 'Jira',
    description: 'Manage issues, sprints, and projects in Atlassian Jira.',
    icon: '/icons/integrations/jira.svg',
    category: 'project-management',
    mcpPackage: '@aashari/mcp-server-atlassian-jira',
    mcpCommand: 'npx',
    mcpArgs: ['-y', '@aashari/mcp-server-atlassian-jira'],
    fields: [
      {
        key: 'ATLASSIAN_SITE_NAME',
        label: 'Atlassian Site Name',
        type: 'text',
        placeholder: 'your-org (from your-org.atlassian.net)',
      },
      {
        key: 'ATLASSIAN_USER_EMAIL',
        label: 'Email Address',
        type: 'text',
        placeholder: 'you@company.com',
      },
      {
        key: 'ATLASSIAN_API_TOKEN',
        label: 'API Token',
        type: 'password',
        placeholder: 'xxxxxxxxxxxxxxxx',
        docsUrl: 'https://id.atlassian.com/manage-profile/security/api-tokens',
      },
    ],
  },
  {
    id: 'gitlab',
    name: 'GitLab',
    description: 'Access repositories, merge requests, issues, and pipelines.',
    icon: '/icons/integrations/gitlab.svg',
    category: 'development',
    mcpPackage: '@modelcontextprotocol/server-gitlab',
    mcpCommand: 'npx',
    mcpArgs: ['-y', '@modelcontextprotocol/server-gitlab'],
    fields: [
      {
        key: 'GITLAB_PERSONAL_ACCESS_TOKEN',
        label: 'Personal Access Token',
        type: 'password',
        placeholder: 'glpat-xxxxxxxxxxxx',
        docsUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
      },
      {
        key: 'GITLAB_API_URL',
        label: 'API URL (optional, for self-hosted)',
        type: 'url',
        placeholder: 'https://gitlab.com/api/v4',
      },
    ],
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Query errors, view issues, and debug stack traces from Sentry.',
    icon: '/icons/integrations/sentry.svg',
    category: 'development',
    mcpPackage: '@sentry/mcp-server',
    mcpCommand: 'npx',
    mcpArgs: ['-y', '@sentry/mcp-server'],
    fields: [
      {
        key: 'SENTRY_ACCESS_TOKEN',
        label: 'Auth Token',
        type: 'password',
        placeholder: 'sntrys_xxxxxxxxxxxx',
        docsUrl: 'https://sentry.io/settings/account/api/auth-tokens/',
      },
    ],
  },
  {
    id: 'todoist',
    name: 'Todoist',
    description: 'Manage tasks, projects, and labels in Todoist.',
    icon: '/icons/integrations/todoist.svg',
    category: 'productivity',
    mcpPackage: 'todoist-mcp-server',
    mcpCommand: 'npx',
    mcpArgs: ['-y', 'todoist-mcp-server'],
    fields: [
      {
        key: 'TODOIST_API_TOKEN',
        label: 'API Token',
        type: 'password',
        placeholder: 'xxxxxxxxxxxx',
        docsUrl: 'https://app.todoist.com/app/settings/integrations/developer',
      },
    ],
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Query databases, inspect schemas, and explore tables.',
    icon: '/icons/integrations/postgres.svg',
    category: 'development',
    mcpPackage: '@modelcontextprotocol/server-postgres',
    mcpCommand: 'npx',
    mcpArgs: ['-y', '@modelcontextprotocol/server-postgres'],
    fields: [
      {
        key: 'POSTGRES_CONNECTION_STRING',
        label: 'Connection String',
        type: 'password',
        placeholder: 'postgresql://user:pass@host:5432/dbname',
      },
    ],
  },
  {
    id: 'google-workspace',
    name: 'Google Workspace',
    description: 'Access Google Drive, Gmail, Calendar, Docs, and Sheets.',
    icon: '/icons/integrations/google.svg',
    category: 'productivity',
    mcpPackage: 'google-workspace-mcp',
    mcpCommand: 'npx',
    mcpArgs: ['-y', 'google-workspace-mcp', 'serve'],
    authType: 'oauth2',
    fields: [
      {
        key: 'client_id',
        label: 'Google Cloud Client ID',
        type: 'text',
        placeholder: 'xxxx.apps.googleusercontent.com',
        docsUrl: 'https://console.cloud.google.com/apis/credentials',
      },
      {
        key: 'client_secret',
        label: 'Client Secret',
        type: 'password',
        placeholder: 'GOCSPX-xxxxxxxxxxxx',
      },
    ],
  },
]

export function getIntegration(id: string): Integration | undefined {
  return INTEGRATIONS.find((i) => i.id === id)
}
