use std::collections::HashMap;

/// Maps integration ID to the environment variable name(s) needed by the MCP server.
pub fn integration_env_keys() -> HashMap<&'static str, Vec<&'static str>> {
    let mut m = HashMap::new();
    m.insert("linear", vec!["LINEAR_API_KEY"]);
    m.insert("notion", vec!["NOTION_TOKEN"]);
    m.insert("slack", vec!["SLACK_BOT_TOKEN"]);
    m.insert(
        "jira",
        vec![
            "ATLASSIAN_API_TOKEN",
            "ATLASSIAN_USER_EMAIL",
            "ATLASSIAN_SITE_NAME",
        ],
    );
    m.insert(
        "gitlab",
        vec!["GITLAB_PERSONAL_ACCESS_TOKEN", "GITLAB_API_URL"],
    );
    m.insert("sentry", vec!["SENTRY_ACCESS_TOKEN"]);
    m.insert("todoist", vec!["TODOIST_API_TOKEN"]);
    m.insert("postgres", vec!["POSTGRES_CONNECTION_STRING"]);
    m.insert("google-workspace", vec![]);
    m
}

/// Google Workspace OAuth scopes.
pub fn google_workspace_scopes() -> &'static str {
    "https://www.googleapis.com/auth/drive \
     https://www.googleapis.com/auth/gmail.modify \
     https://www.googleapis.com/auth/calendar \
     https://www.googleapis.com/auth/documents \
     https://www.googleapis.com/auth/spreadsheets"
}

/// Validation endpoints for each integration.
pub fn integration_validation_url(integration: &str) -> Option<&'static str> {
    match integration {
        "linear" => Some("https://api.linear.app/graphql"),
        "notion" => Some("https://api.notion.com/v1/users/me"),
        "slack" => Some("https://slack.com/api/auth.test"),
        "sentry" => Some("https://sentry.io/api/0/"),
        // Jira, GitLab, Todoist, Postgres URLs are user-provided or have no simple validation
        _ => None,
    }
}
