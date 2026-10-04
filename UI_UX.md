# UI_UX.md

> Tinix Inbox UI/UX specification.  
> This document defines the visual and interaction rules for user-facing Tinix Inbox surfaces.  
> It is intentionally framework-agnostic. Codex must map these rules onto the existing Tinix design system and component library.

---

## 1. Product Design Goal

Tinix Inbox is an **AI-assisted omnichannel customer conversation workspace**.

The interface should make this workflow immediately understandable:

```text
See conversation
→ understand customer/channel/context
→ know whether AI or human is responsible
→ reply or take over
→ perform business action
→ continue conversation safely
```

The experience should feel:

- operational;
- fast;
- calm;
- information-dense without feeling crowded;
- trustworthy;
- consistent;
- professional;
- easy to scan for long periods.

Avoid decorative design that competes with messages or operational status.

Tinix Inbox is not a social-media feed and not a marketing landing page.

---

## 2. Relationship to the Existing Tinix Design System

The repository's established Tinix design system has priority for:

- color tokens;
- typography;
- spacing;
- radii;
- shadows;
- components;
- motion;
- light/dark mode;
- icon library.

Do not create a separate Inbox-only visual language when an existing Tinix component or token can be reused.

This document defines:

- structure;
- hierarchy;
- interaction;
- states;
- Inbox-specific behavior.

When an existing Tinix component conflicts with a requirement here, preserve the global Tinix component unless the Inbox requirement is necessary for usability or correctness.

---

## 3. Core UX Principles

### 3.1. Conversation first

The current customer conversation is the primary object.

Do not let:

- dashboards;
- AI panels;
- CRM widgets;
- automation controls;
- provider details

visually dominate the active message thread.

---

### 3.2. AI state must always be understandable

At any time, an operator should be able to answer:

```text
Is AI active?
Is a human in control?
Will the next customer message be auto-replied?
Who owns this conversation?
```

Never hide AI/human ownership behind a settings screen.

---

### 3.3. Channel differences must be visible but not disruptive

Users need to know whether the conversation is from:

- Facebook;
- Instagram;
- Zalo;
- TikTok Shop;
- Shopee;
- future providers.

Use a compact channel identity element.

Do not redesign the entire conversation UI per provider.

---

### 3.4. Show only capabilities that actually exist

If a provider cannot:

- send files;
- show read receipts;
- send typing indicators;
- reply to a message;
- send a specific media type,

do not show an enabled control that will fail later.

Use capability-driven UI.

---

### 3.5. Fail visibly and recoverably

Sending failure, expired credentials, disconnected channels, AI failure, or synchronization problems must not disappear silently.

A user should know:

```text
what failed
what was preserved
whether retry is automatic
what action is required
```

---

## 4. App Information Architecture

Target product structure:

```text
Tinix Inbox

├── Conversations
├── Contacts
├── Channels
├── AI Agent
└── Settings
```

Future optional areas may include:

```text
Automation
Analytics
Orders
Teams
```

Do not add future sections until the underlying functionality exists.

---

## 5. Primary Navigation

Use the existing Tinix app shell/navigation if available.

Recommended Inbox navigation order:

```text
Conversations
Contacts
Channels
AI Agent
Settings
```

Primary navigation should not expose low-level architecture terms such as:

```text
Message Gateway
ConversationProvider
Outbox
Webhook Events
Chatwoot API Channel
```

Those belong in developer/admin diagnostics, not normal product navigation.

---

## 6. Conversations Page Layout

Recommended desktop layout:

```text
┌───────────────────────────────────────────────────────────────┐
│ App navigation                                                │
├──────────────┬──────────────────────────────┬─────────────────┤
│ Conversation │ Active conversation          │ Context /       │
│ list         │                              │ customer panel  │
│              │ Message history              │                 │
│              │                              │ profile         │
│              │                              │ channel         │
│              │                              │ AI state        │
│              │                              │ assignment      │
│              │                              │ business data   │
│              │                              │                 │
│              │ Composer                     │                 │
└──────────────┴──────────────────────────────┴─────────────────┘
```

Preferred behavior:

- conversation list remains stable while navigating messages;
- active thread owns the largest usable width;
- context panel may collapse;
- list and context panel should be resizable only if the existing Tinix shell already supports it or the implementation remains simple and reliable.

---

## 7. Conversation List

Each row should communicate, in scan order:

1. avatar or recognizable contact placeholder;
2. customer/display name;
3. channel indicator;
4. last-message preview;
5. time;
6. unread state;
7. assignment/ownership when useful;
8. AI/human mode when operationally important.

Avoid showing every piece of metadata in the row.

### 7.1. Row states

Support:

```text
default
hover
selected
unread
failed/sync warning
```

Unread should have more than a color-only distinction.

Possible non-color cues:

- stronger type weight;
- unread count;
- indicator dot;
- row emphasis.

### 7.2. Last-message preview

Use one compact line when possible.

For non-text content:

```text
[Image]
[Video]
[File]
[Sticker]
[Order]
```

Do not dump raw provider payload text.

### 7.3. Time

Use compact relative time for recent messages when consistent with Tinix patterns.

Examples:

```text
2m
18m
3h
Yesterday
Sep 27
```

Full timestamp may appear in tooltip/details.

---

## 8. Conversation Filters

Useful initial filters:

```text
All
Unread
Mine
Unassigned
AI handling
Human handling
Resolved
```

Additional filters:

```text
Channel
Team
Assignee
Status
Label
Date
```

Do not launch with an overloaded filter builder unless needed.

Selected filters must be visible and removable.

Persist filters only when consistent with Tinix preference behavior.

---

## 9. Search

Conversation search should make it clear what is searchable.

Potential scope:

```text
contact name
phone/email if available
message text
external/provider identifiers where useful
```

Do not imply full-text search capabilities that the backend cannot support.

Search state must survive ordinary list refreshes.

Provide clear no-result state.

---

## 10. Active Conversation Header

The header should show:

```text
Customer identity
Channel
Conversation status
Assignee / owner
AI / Human state
Primary actions
```

Avoid an action-heavy toolbar.

Primary operational actions:

```text
Assign
Take Over / Resume AI
Resolve / Reopen
More
```

Channel icon should be recognizable but visually secondary to the customer name.

---

## 11. AI / Human Control

This is one of the most important Tinix Inbox UI elements.

### 11.1. State labels

Use human-readable states:

```text
AI Active
Human Active
Hybrid
AI Paused
```

Avoid exposing internal enum names.

### 11.2. Primary controls

If AI owns the conversation:

```text
Take Over
```

If a human owns the conversation:

```text
Resume AI
```

If paused:

```text
Resume AI
```

If hybrid:

```text
AI Assist On
```

Exact copy may be localized, but the ownership transition must be unambiguous.

### 11.3. Confirmation behavior

Do not require confirmation for every routine takeover if the action is reversible and obvious.

Require confirmation when an action has a significant consequence, for example:

- enabling auto-reply across many conversations;
- changing workspace-wide AI policy;
- disconnecting a provider;
- deleting a connection.

### 11.4. In-flight AI response

If AI is generating and the human takes over:

- UI immediately shows Human Active;
- any pending AI reply should be shown as cancelled/skipped if surfaced;
- do not let stale UI imply AI will still send.

---

## 12. Message Timeline

Messages must be easy to distinguish by:

```text
customer
human agent
AI agent
system/activity
private/internal note
```

Do not rely on color alone.

### 12.1. Customer messages

Show:

- content;
- attachment;
- timestamp;
- delivery/read information only when known and relevant.

### 12.2. Human agent messages

Show agent identity when useful.

If the current user sent the message, identity can be visually lighter but should remain auditable.

### 12.3. AI messages

AI-generated messages must be distinguishable from human messages.

Use a compact AI label/icon such as:

```text
AI
```

or agent identity.

Do not use excessive glowing, gradients, animated AI effects, or novelty visuals in the operational timeline.

### 12.4. System/activity events

System events should be visually quieter than messages.

Examples:

```text
Assigned to Minh
AI paused
Conversation resolved
Channel reconnected
```

They should not look like customer-facing messages.

### 12.5. Private notes

Private notes must be visually unmistakable.

Requirements:

- explicit "Internal note" or equivalent label;
- visually distinct container;
- never visually identical to customer reply;
- composer mode must clearly indicate when writing a private note.

Prevent accidental customer send from an internal-note context.

---

## 13. Message Grouping

Group consecutive messages from the same sender when close in time.

Do not repeat avatar/name/timestamp excessively.

Break grouping when:

- sender changes;
- a significant time gap occurs;
- system activity appears;
- message ownership context changes.

---

## 14. Message Status

Only show status the provider actually supports.

Possible statuses:

```text
Sending
Sent
Delivered
Read
Failed
```

If delivery/read is unsupported:

- do not fabricate it;
- do not show permanent "Sent" as if it meant "Read".

Failed messages should have:

```text
Failed
Retry
Details
```

where supported.

Do not lose the unsent content.

---

## 15. Composer

The composer is a critical control.

Minimum capabilities:

```text
text input
send
attachment where supported
private note mode if enabled
```

Potential future capabilities:

```text
templates
saved replies
AI suggestions
emoji
reply-to-message
product/order insertion
```

Do not add them before backend support exists.

### 15.1. Composer state

Composer should reflect:

- current mode: Reply / Internal note;
- current channel;
- provider capability limitations;
- whether user can send;
- AI/human ownership if it affects permission.

### 15.2. Send behavior

Expected:

- Enter sends only if consistent with existing Tinix convention;
- Shift+Enter creates newline;
- disable accidental repeated submission while send is in flight;
- preserve draft if send fails.

### 15.3. Disabled composer

If sending is unavailable, show the reason.

Examples:

```text
Channel disconnected
Permission expired
Conversation is read-only
This provider does not allow replies in the current state
```

Do not show a disabled composer with no explanation.

---

## 16. AI Assistance in Composer

AI assistance should support the operator, not obstruct them.

Possible actions:

```text
Suggest reply
Rewrite
Shorten
Change tone
Translate
Summarize conversation
```

AI-generated drafts should not send automatically from a human-assist flow unless explicitly configured.

Clearly distinguish:

```text
Generate draft
```

from:

```text
Enable AI auto-reply
```

These are different product concepts.

---

## 17. Customer Context Panel

The right/context panel may contain:

```text
Customer profile
Channel identity
Conversation owner
AI status
Contact attributes
Labels
Notes
Order/customer data
Connection health when relevant
```

Use sections with clear hierarchy.

Do not turn the context panel into a full CRM on the first version.

Prioritize information needed to answer the conversation.

---

## 18. Contact Identity

Do not imply cross-channel identity merge unless Tinix has verified the merge.

A Facebook contact and Zalo contact with the same name should not automatically appear as one person.

If multiple identities are linked, make the source clear.

Possible structure:

```text
Customer
Nguyen Van A

Connected identities
Facebook · ...
Zalo · ...
```

Only show merged identity when the backend has a trusted link.

---

## 19. Channels Page

The Channels page should focus on connection management.

Each connection card/row should show:

```text
provider
account/page/shop/OA name
connection status
last successful sync/event
AI enabled/disabled
actions
```

Statuses may include:

```text
Connected
Needs attention
Expired
Revoked
Disabled
Connecting
```

Avoid exposing raw tokens/scopes in the main UI.

Advanced diagnostics may expose sanitized technical detail.

---

## 20. Connect Channel Flow

Recommended flow:

```text
Choose provider
→ explain requirements
→ authenticate/authorize
→ select account/page/shop/OA if needed
→ verify connection
→ configure AI mode
→ finish
```

Before redirecting to external authorization, explain what is required.

After callback, provide explicit success/failure.

Do not leave users at an ambiguous blank state after OAuth.

---

## 21. Connection Error UX

Examples:

### Expired token

```text
Connection expired
Reconnect to continue receiving and sending messages.
[Reconnect]
```

### Permission revoked

```text
Permissions were revoked
Tinix can no longer send messages for this channel.
[Reconnect]
```

### Provider outage

```text
Provider temporarily unavailable
Messages are queued and will be retried automatically.
```

Only promise queue/retry if the backend actually guarantees it.

---

## 22. AI Agent Page

The initial AI Agent page should configure behavior, not expose low-level model plumbing unless needed.

Recommended sections:

```text
Status
Auto-reply mode
Knowledge source
Tone/instructions
Handoff rules
Business tools
Model/provider advanced settings
```

Separate workspace-wide defaults from per-channel overrides.

Make override inheritance visible:

```text
Workspace default
Channel override
Conversation override
```

---

## 23. Handoff Rules UI

Examples of user-configurable rules:

```text
Pause AI when human replies
Pause AI when assigned to human
Escalate on selected intents
Require human for selected topics
Resume AI only manually
```

Do not expose rules that the backend cannot enforce atomically.

Explain high-impact automation in plain language.

---

## 24. Contacts Page

Initial Contacts page:

```text
Name
Primary identity
Channels
Last conversation
Last activity
Labels
```

Contact detail may include:

```text
Profile
Channel identities
Conversation history
Attributes
Notes
Business data
```

Avoid duplicating the full active conversation experience inside Contacts.

Link back to relevant conversations.

---

## 25. Status and Severity Language

Use clear neutral severity levels.

Recommended:

```text
Healthy
Needs attention
Degraded
Disconnected
Failed
```

Avoid dramatic wording for recoverable operational conditions.

Use icons/text plus color.

---

## 26. Color Usage

Reuse Tinix tokens.

Semantic use:

```text
success
warning
error
information
neutral
```

Do not assign custom arbitrary colors directly to provider states if tokens exist.

Provider brand colors may be used sparingly in channel icons/badges, but should not dominate page structure.

AI should not automatically get a neon/purple gradient visual identity.

---

## 27. Typography

Reuse Tinix typography scale.

General hierarchy:

```text
Page title
Section title
Conversation/customer title
Body/message content
Metadata
Caption/status
```

Message text must remain comfortably readable.

Avoid very small metadata text.

Do not use all-caps for routine status labels.

---

## 28. Spacing and Density

Tinix Inbox is an operational product, so density should be moderately compact.

Avoid:

- oversized cards;
- excessive whitespace;
- giant page titles;
- marketing-style hero spacing;
- enormous buttons.

Use compact but touch-safe controls.

The message timeline should maximize useful vertical space.

---

## 29. Borders, Radius, Shadows

Reuse Tinix component tokens.

General guidance:

- subtle separation over heavy borders;
- minimal shadow layers;
- no excessive glassmorphism;
- no decorative glow;
- no nested card-on-card-on-card layouts unless structurally necessary.

Conversation areas should feel stable and quiet.

---

## 30. Icons

Use the repository's existing icon library.

Requirements:

- consistent style and stroke;
- icon-only buttons need accessible labels/tooltips;
- do not mix several icon libraries casually;
- provider logos/icons should remain recognizable.

Avoid decorative icons with no functional meaning.

---

## 31. Empty States

Every major screen should have a useful empty state.

### No conversations

Explain the likely next step:

```text
No conversations yet.
Connect a channel or wait for the first customer message.
```

### No channels

```text
Connect your first messaging channel.
```

### No search result

```text
No conversations match these filters.
```

Do not use large illustrations if they distract from an operational app unless Tinix already uses that pattern.

---

## 32. Loading States

Prefer stable skeletons or lightweight progress states.

Avoid full-screen spinners for local panel refreshes.

Keep layout dimensions stable while loading.

Message sending should show local pending state rather than blocking the full conversation.

---

## 33. Error States

Errors should state:

```text
What happened
What is affected
Whether retry is automatic
What the user can do
```

Bad:

```text
Something went wrong.
```

Better:

```text
Could not load this conversation.
Your connection is still active.
[Retry]
```

Do not show raw stack traces or provider payloads to normal users.

---

## 34. Toasts and Notifications

Use toasts for transient confirmations:

```text
Connection updated
AI resumed
Conversation assigned
```

Do not rely on toasts for critical persistent failures.

Persistent operational problems belong inline or in a status surface.

Avoid excessive success toasts for routine actions like every sent message.

---

## 35. Dialogs

Use dialogs only when necessary.

Good use cases:

- disconnect channel;
- destructive delete;
- high-impact global AI setting;
- reauthorization consequences.

Do not use modal dialogs for routine navigation or simple filter actions.

Focus must be trapped correctly.

Escape/cancel behavior must be safe.

---

## 36. Destructive Actions

Use explicit labels.

Prefer:

```text
Disconnect channel
Delete connection
Remove integration
```

over vague:

```text
Confirm
Continue
```

Explain consequences.

If deletion does not delete historical conversations, say so.

If it does, say so clearly.

---

## 37. Responsive Design

### Desktop

Primary target for operator Inbox.

Use 2–3 pane layout where space permits.

### Tablet

Collapse context panel first.

Conversation list may remain visible depending on width.

### Mobile

Use sequential navigation:

```text
Conversation list
→ active conversation
→ customer/context detail
```

Do not squeeze three desktop panes into a mobile screen.

Composer must remain usable above software keyboard.

---

## 38. Minimum Viewport Behavior

At narrow widths:

1. hide optional context;
2. reduce metadata;
3. preserve message content;
4. preserve ownership status;
5. preserve composer;
6. preserve navigation back to conversation list.

Critical controls must not disappear into inaccessible overflow.

---

## 39. Keyboard Interaction

Where consistent with Tinix:

```text
Up/Down or j/k
→ navigate list only if intentionally implemented

Enter
→ open selected conversation

Esc
→ close menus/dialogs

Cmd/Ctrl+K
→ global/search only if Tinix already uses it
```

Do not invent keyboard shortcuts without discoverability.

Composer shortcuts must be predictable.

---

## 40. Accessibility

Target WCAG 2.1 AA behavior where practical.

Requirements:

- semantic headings;
- accessible names;
- keyboard navigation;
- visible focus;
- sufficient contrast;
- non-color status cues;
- proper dialog semantics;
- status announcements where necessary;
- alt/labels for relevant media;
- reduced-motion respect when Tinix supports it.

Do not use tiny low-contrast metadata that becomes unreadable.

---

## 41. Localization

Do not hardcode user-facing copy if Tinix has an i18n system.

Prepare layouts for text expansion.

Avoid designs that depend on English label length.

Dates/times should respect the user's locale/timezone according to existing Tinix behavior.

---

## 42. Dark Mode

If Tinix supports dark mode, every Inbox surface must use design tokens.

Do not hardcode light backgrounds or dark text.

Check:

- message bubbles;
- selected rows;
- unread state;
- provider badges;
- error/warning states;
- private notes;
- composer;
- disabled controls.

---

## 43. Realtime UX

When new messages arrive:

- update the relevant conversation;
- increment unread counts appropriately;
- avoid stealing focus;
- do not jump scroll position if the operator is reading older history.

If the operator is at the bottom of the active thread:

- new messages may auto-follow.

If scrolled upward:

- show a "New messages" affordance instead of forcibly jumping.

---

## 44. Optimistic UI

Use optimistic behavior only when failure recovery is clear.

Good candidate:

```text
sending message appears immediately as Pending
```

On failure:

```text
Pending → Failed
[Retry]
```

Do not mark a message "Sent" before Tinix/provider confirmation if the backend distinguishes these states.

---

## 45. Conversation Pagination

Do not load unbounded history.

Use:

```text
initial recent window
→ load older messages
```

Preserve scroll position when prepending older messages.

Avoid duplicate messages during realtime + pagination merging.

---

## 46. Provider-Specific UX

Provider differences should be represented as capabilities, not separate page designs.

Examples:

### Facebook / Instagram
May expose specific reply/media features only when supported.

### Zalo
Show OA identity where useful.

### TikTok Shop / Shopee
Commerce context may be shown in the customer/context panel.

Do not assume order data exists for every conversation.

---

## 47. Commerce Context

For commerce channels, optional context can include:

```text
recent order
order status
product
store/shop identity
```

This information is secondary to the conversation.

Do not insert a large order-management application into the message pane.

Use compact cards/details and deep-link to the proper business action if needed.

---

## 48. Provider Health

Connection health should be visible on the Channels page and surfaced in the conversation only when it affects the active user action.

Example:

```text
Zalo connection needs attention.
Replies cannot be sent until reconnected.
```

Do not display global infrastructure noise inside every conversation.

---

## 49. Admin / Diagnostics

Advanced diagnostics may include:

```text
provider account ID
connection ID
last webhook
last successful send
last error code
token expiry time
queue state
correlation ID
```

Keep this behind an admin/developer surface.

Do not show raw secrets.

Do not expose internal stack traces.

---

## 50. Native Tinix Inbox vs Chatwoot UI

### Early validation phase

Using Chatwoot UI for operator validation is acceptable.

Tinix may expose:

```text
Channel connections
AI state
health
internal link to Chatwoot
```

for development/internal use.

### Native Inbox phase

Once Tinix native Inbox is enabled:

- user-facing UI should call Tinix backend;
- frontend should not depend directly on Chatwoot APIs;
- Chatwoot implementation details should be hidden.

This preserves the ability to replace Chatwoot later.

---

## 51. Design of AI Identity

AI must feel like a system capability, not a character unless the product later intentionally supports named agents.

Preferred:

```text
AI Agent
Tinix AI
AI
```

Avoid anthropomorphic avatars by default.

AI messages should be auditable but visually compatible with human replies.

---

## 52. Trust and Transparency

The UI should not make uncertain system state appear certain.

Examples:

If a provider does not support read receipts:

Do not show:

```text
Read
```

If a message is queued:

Show:

```text
Queued
```

not:

```text
Sent
```

If a channel permission is unverified:

Show:

```text
Needs verification
```

not:

```text
Connected
```

---

## 53. Copy Style

UI copy should be:

- concise;
- direct;
- neutral;
- operational;
- action-oriented.

Prefer:

```text
Reconnect channel
Retry message
Take over
Resume AI
Assign conversation
```

Avoid:

```text
Something amazing happened!
Oopsie!
Let AI work its magic!
```

Avoid jargon unless the surface is explicitly developer/admin oriented.

---

## 54. Confirmation Copy

For important actions, explain the consequence before the button.

Example:

```text
Disconnect Zalo OA?

Tinix will stop receiving and sending messages for this account.
Existing conversation history will remain available.

[Cancel] [Disconnect]
```

Do not use confirmation dialogs that only repeat the button label.

---

## 55. Connection Setup Copy

Before OAuth/authorization:

```text
Connect Zalo OA

Tinix will request permission to receive and send supported customer messages for the selected Official Account.

[Continue]
```

After success:

```text
Connected
Tinix is ready to receive messages.
```

If additional platform approval is still pending, do not say fully connected.

---

## 56. Handoff Copy Examples

AI currently replying:

```text
AI Active
Tinix AI may automatically reply to new customer messages.

[Take Over]
```

Human takeover:

```text
Human Active
Automatic AI replies are paused for this conversation.

[Resume AI]
```

Hybrid:

```text
AI Assist
AI can suggest replies, but a human sends them.
```

---

## 57. Message Failure Copy Examples

Retryable:

```text
Message not sent yet.
Tinix will retry automatically.
```

Permanent:

```text
Message could not be sent.
The channel permission may have expired.
[Reconnect channel]
```

Unknown:

```text
Delivery status unavailable.
Check connection health before retrying.
```

Only use these when they match backend truth.

---

## 58. Channel Capability UX

If a feature is unsupported, choose one:

### Hide
Use when the user gains nothing from knowing about it.

### Disable with explanation
Use when users reasonably expect the feature.

Example:

```text
Attach file
Unavailable for this channel
```

Do not let a click fail after the user composes content.

---

## 59. Status Badges

Badges should be compact and meaningful.

Good:

```text
AI Active
Human
Unread
Needs attention
Zalo
TikTok Shop
```

Avoid badge overload.

Do not place five badges beside every contact by default.

---

## 60. Tables

Use tables for structured management surfaces such as:

```text
Channels
Contacts
Teams
```

Requirements:

- sensible column widths;
- sortable only where backend supports sorting;
- loading/empty states;
- stable row actions;
- avoid horizontal scrolling where a simpler layout works.

Conversation list is not a conventional data table.

---

## 61. Forms

Forms should:

- group related settings;
- show labels persistently;
- provide inline validation;
- preserve entered data after recoverable error;
- indicate required fields;
- avoid placeholder-only labels.

For advanced provider settings, use progressive disclosure.

---

## 62. Settings Hierarchy

Recommended:

```text
Inbox Settings
├── General
├── AI
├── Notifications
├── Channels
└── Advanced
```

Do not duplicate the same setting in several places without explaining scope/override.

---

## 63. Scope and Inheritance

When settings can exist at several levels, display scope.

Example:

```text
Workspace default: AI auto-reply on
Zalo OA A: uses workspace default
Shopee Shop B: AI auto-reply off
Conversation: Human takeover
```

Users must understand which setting currently wins.

---

## 64. Permissions

If Tinix introduces roles:

- hide actions the user cannot use where appropriate;
- disabled controls may explain missing permission;
- do not rely only on frontend enforcement;
- avoid exposing admin-only connection credentials/details.

Permission-denied copy should be clear and non-alarming.

---

## 65. Notifications

Potential notifications:

```text
new assigned conversation
human takeover requested
channel disconnected
message permanently failed
provider permission expiring
```

Do not create notification fatigue for routine successful message traffic.

---

## 66. Motion

Use motion sparingly.

Allowed:

- normal menu/dialog transitions;
- subtle list updates;
- pending send state.

Avoid:

- animated AI gradients;
- constant pulsing status;
- decorative background motion;
- dramatic message entrance animation.

Respect reduced-motion preferences where supported.

---

## 67. Performance Perception

The UI should feel immediate even when external APIs are slow.

Use local states such as:

```text
Connecting…
Sending…
Refreshing…
Queued…
```

Do not freeze unrelated parts of the application during a provider operation.

---

## 68. Destructive Data Rules

Do not make "Disconnect" and "Delete history" the same action unless product requirements explicitly say so.

Prefer separate concepts:

```text
Disable connection
Disconnect provider
Delete connection configuration
Delete historical data
```

Explain what each action preserves/removes.

---

## 69. Auditability

Operators should be able to distinguish:

```text
customer message
human reply
AI reply
internal note
system state change
```

This is required for operational trust.

Do not visually collapse AI and human actions into an indistinguishable stream.

---

## 70. Recommended V1 Screen Set

For the first native Tinix Inbox release, prioritize:

### 1. Conversations
- list;
- filters;
- message timeline;
- reply composer;
- AI/human state;
- take over/resume;
- customer context.

### 2. Channels
- connect;
- reconnect;
- status;
- disable/disconnect;
- AI enabled override.

### 3. Contacts
- basic list;
- contact detail;
- identities;
- conversation history.

### 4. AI Agent
- status;
- auto-reply policy;
- handoff rules;
- knowledge/tools summary.

### 5. Settings
- only required operational settings.

Do not block V1 on analytics, campaign tools, or a workflow builder.

---

## 71. V1 Conversation Acceptance Criteria

A user should be able to:

```text
[ ] see incoming conversations
[ ] identify the source channel
[ ] see unread state
[ ] open a conversation
[ ] read message history
[ ] see who owns the conversation
[ ] know whether AI is active
[ ] take over from AI
[ ] resume AI
[ ] send a reply
[ ] see send failure
[ ] retry when appropriate
[ ] view supported attachments
[ ] see basic customer context
[ ] assign/resolve where backend supports it
```

No critical flow should require opening developer diagnostics.

---

## 72. V1 Channel Acceptance Criteria

A user should be able to:

```text
[ ] see connected channels
[ ] distinguish provider/account
[ ] see health/status
[ ] connect supported providers
[ ] reconnect expired/revoked connections
[ ] disable/disconnect
[ ] understand provider capability limitations
```

Never display a channel as healthy if Tinix knows credentials are invalid.

---

## 73. V1 AI UX Acceptance Criteria

A user should be able to understand:

```text
[ ] whether AI is enabled globally
[ ] whether AI is enabled on this channel
[ ] whether AI currently controls this conversation
[ ] how to take over
[ ] how to resume AI
[ ] whether a visible reply was AI-generated
```

AI automation must never be ambiguous.

---

## 74. Design Anti-Patterns

Avoid:

- giant dashboard cards for every metric;
- gradients everywhere;
- glassmorphism-heavy operational UI;
- excessive rounded floating panels;
- animation for routine status;
- hidden AI ownership;
- invisible provider limitations;
- color-only unread state;
- "magic AI" language;
- technical provider payloads in normal UI;
- direct frontend access to provider/Chatwoot credentials;
- every action opening a modal;
- creating an Inbox-specific second component library.

---

## 75. Implementation Guidance for Codex

Before implementing UI:

1. inspect existing Tinix screens;
2. identify existing:
   - app shell;
   - sidebar/navigation;
   - buttons;
   - inputs;
   - dropdowns;
   - dialogs;
   - tabs;
   - badges;
   - tables;
   - typography;
   - icons;
   - tokens;
3. reuse them;
4. build only missing Inbox-specific components.

Recommended Inbox-specific components may include:

```text
ConversationList
ConversationListItem
ConversationHeader
MessageTimeline
MessageBubble
SystemEvent
InternalNote
MessageComposer
ChannelBadge
OwnershipBadge
HandoffControl
ContactContextPanel
ConnectionStatus
ChannelConnectionCard
```

Names must follow repository conventions.

---

## 76. UI Test Expectations

Where the repository supports UI testing, cover:

- conversation list loading;
- empty state;
- error state;
- unread state;
- open conversation;
- message send pending/success/failure;
- AI/human takeover;
- provider capability disabled state;
- connection expired state;
- private note vs reply;
- responsive layout;
- keyboard/focus behavior for critical controls.

Do not rely only on snapshots for interaction correctness.

---

## 77. Final Design Principle

Tinix Inbox should make a complicated backend feel simple.

The user should not need to understand:

```text
webhooks
Chatwoot
message queues
idempotency
provider tokens
outbox
ConversationProvider
ChannelAdapter
```

They should understand:

```text
Who is the customer?
Where did they message us?
What did they say?
Who is handling it?
Can I reply?
Did the reply go through?
What should happen next?
```

Every design decision should serve those questions.
