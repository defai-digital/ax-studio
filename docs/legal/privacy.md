# AX Studio Desktop Privacy Notice

Last updated: July 14, 2026

This notice applies to the open-source AX Studio desktop application published
by DEFAI Private Limited. It does not describe other products or services that
may use a similar name or website domain.

## Local workspace data

AX Studio stores threads, messages, projects, settings, memory, downloaded
models, local knowledge indexes, logs, and generated artifacts on the user's
device. AX Studio does not include product analytics or telemetry that sends
conversation content or usage events to DEFAI Private Limited.

Removing AX Studio does not necessarily remove every user-selected data folder
or downloaded model. Users can delete those files using AX Studio's settings or
the operating system's file manager.

## Connected providers and tools

AX Studio can connect to cloud AI providers, OpenAI-compatible endpoints,
Hugging Face, remote model servers, and Model Context Protocol (MCP) servers.
When a user selects one of these services, AX Studio sends the information
required for that request directly to the selected service. Depending on the
workflow, that information may include prompts, conversation context,
attachments, tool inputs, tool results, model identifiers, and authentication
credentials.

Those third parties process data under their own terms and privacy policies.
Users control these connections by adding or removing credentials, enabling or
disabling providers and tools, and choosing local models when data must remain
on the device.

## Credentials

Provider credentials and tokens are stored locally as part of the user's AX
Studio configuration and are used to authenticate requests to the service the
user configured. The HTTPS proxy password uses the operating system credential
store. Users should protect their operating-system account and should revoke a
credential with its provider if they believe it was exposed.

## Updates, downloads, and research

AX Studio connects to GitHub and AX Studio update endpoints to check for and
download application updates. Model and runtime downloads can connect to
Hugging Face, GitHub, or another source selected by the user. Research and web
retrieval features connect to the websites and services needed to complete the
requested workflow. These services may receive normal network information such
as the user's IP address.

## Feedback and AI-content reports

Message ratings and comments are stored locally with the conversation. They are
not automatically sent to DEFAI Private Limited. If a user chooses **Report
inappropriate content**, AX Studio opens a GitHub issue form. Information the
user submits through that form is processed by GitHub and is public. The form
instructs users not to submit secrets, private files, personal information, or
unnecessary harmful content.

## Local API server

AX Studio includes an optional local API server. It binds to the loopback
interface by default. Users who change its host, authentication, or CORS
settings are responsible for understanding the resulting network exposure.

## Children's privacy

AX Studio is a general-purpose professional and developer tool and is not
directed to children. Users must follow applicable law and the terms of their
selected model and service providers.

## Questions and requests

Privacy questions, correction requests, and deletion questions can be submitted
through the [AX Studio issue chooser](https://github.com/defai-digital/ax-studio/issues/new/choose).
Do not include secrets or sensitive personal information in a public issue.

Material changes to this notice will be published in this repository with an
updated revision date.
