import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase } from '../../src/persistence/db.ts';
import { ChannelConnectionRepository, ConversationLinkRepository } from '../../src/persistence/repositories.ts';
import { ChatwootClient } from '../../src/providers/chatwoot/chatwoot-client.ts';
import { ChatwootConversationProvider } from '../../src/providers/chatwoot/chatwoot-provider.ts';

test('Chatwoot conversation operations use the mapped connection, not the first workspace connection', async () => {
  const db = getDatabase(':memory:');
  const connections = new ChannelConnectionRepository(db);
  const conversations = new ConversationLinkRepository(db);
  const now = new Date().toISOString();

  for (const [id, accountId, inboxId] of [['conn-a', 11, 101], ['conn-b', 22, 202]] as const) {
    connections.create({
      id, workspaceId: 'ws', provider: 'meta', displayName: id, externalAccountId: id,
      status: 'connected', credentialsEncrypted: '{}', credentialVersion: 1, scopes: [], metadata: {},
      chatwootAccountId: accountId, chatwootInboxId: inboxId, createdAt: now, updatedAt: now,
    });
    conversations.create({
      id: `link-${id}`, workspaceId: 'ws', channelConnectionId: id, tinixThreadKey: `thread-${id}`,
      chatwootAccountId: accountId, chatwootInboxId: inboxId, chatwootConversationRef: String(accountId * 10),
      chatwootConversationDisplayId: accountId * 10, state: 'open', createdAt: now, updatedAt: now,
    });
  }

  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    urls.push(String(input));
    requests.push({ url: String(input), method: init?.method || 'GET', body: typeof init?.body === 'string' ? init.body : undefined });
    const body = String(input).includes('/inbox_members/')
      ? { payload: [{ id: 7, name: 'Private Name', available_name: 'Inbox Agent', access_token: 'must-not-leak' }] }
      : String(input).includes('/conversations?inbox_id=202')
        ? { data: { meta: { all_count: 1 }, payload: [{ id: 220, meta: { assignee: { id: 7, available_name: 'Inbox Agent', name: 'Private Name', access_token: 'secret' }, sender: { id: 300, name: 'POC Customer', thumbnail: 'https://chatwoot.test/private-thumbnail' } } }] } }
        : String(input).includes('/conversations?inbox_id=101')
          ? { data: { meta: { all_count: 1 }, payload: [{ id: 110, meta: { sender: { id: 301, name: 'Second POC Customer' } } }] } }
      : String(input).includes('/conversations/220')
        ? { meta: { assignee: { id: 7, name: 'Inbox Agent', access_token: 'secret', pubsub_token: 'secret' } } }
        : { payload: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const provider = new ChatwootConversationProvider(new ChatwootClient({ baseUrl: 'http://chatwoot.test', apiToken: 'test-token' }), connections);
    await provider.listMessages({ workspaceId: 'ws', conversationDisplayId: 220 });
    await provider.updateSupportState({ workspaceId: 'ws', conversationDisplayId: 220, status: 'open' });
    const assignment = await provider.getAssignment({ workspaceId: 'ws', conversationDisplayId: 220 });
    const listInput = {
      workspaceId: 'ws',
      conversations: [
        { conversationLinkId: 'link-conn-b', channelConnectionId: 'conn-b', conversationDisplayId: 220 },
        { conversationLinkId: 'link-conn-a', channelConnectionId: 'conn-a', conversationDisplayId: 110 },
      ],
    };
    const listAssignments = await provider.listConversationSummaries(listInput);
    assert.match(urls[0]!, /accounts\/22\/conversations\/220\/messages$/);
    assert.match(urls[1]!, /accounts\/22\/conversations\/220\/toggle_status$/);
    assert.match(urls[2]!, /accounts\/22\/inbox_members\/202$/);
    assert.match(urls[3]!, /accounts\/22\/conversations\/220$/);
    assert.deepEqual(assignment, { agents: [{ id: 7, name: 'Inbox Agent' }], assignee: { id: 7, name: 'Inbox Agent' } });
    assert.equal(JSON.stringify(assignment).includes('secret'), false);
    assert.deepEqual([...listAssignments.entries()], [
      ['link-conn-b', { assignee: { id: 7, name: 'Inbox Agent' }, contactName: 'POC Customer' }],
      ['link-conn-a', { assignee: null, contactName: 'Second POC Customer' }],
    ]);
    assert.equal(JSON.stringify(listAssignments).includes('private-thumbnail'), false);
    assert.equal(JSON.stringify(listAssignments).includes('secret'), false);
    const requestCount = urls.length;
    const cachedAssignments = await provider.listConversationSummaries(listInput);
    assert.deepEqual([...cachedAssignments.entries()], [...listAssignments.entries()]);
    assert.equal(urls.length, requestCount, 'the short-lived summary cache prevents a Chatwoot list call every UI poll');
    await provider.assignConversation({ workspaceId: 'ws', conversationDisplayId: 220, agentId: 7 });
    await provider.listConversationSummaries(listInput);
    assert.equal(urls.length, requestCount + 2, 'assignment changes invalidate the affected inbox cache');
    assert.match(urls[4]!, /accounts\/22\/conversations\?inbox_id=202&status=all&page=1$/);
    assert.match(urls[5]!, /accounts\/11\/conversations\?inbox_id=101&status=all&page=1$/);
    assert.match(urls[6]!, /accounts\/22\/conversations\/220\/assignments$/);
    assert.match(urls[7]!, /accounts\/22\/conversations\?inbox_id=202&status=all&page=1$/);
    assert.deepEqual(JSON.parse(requests[6]!.body!), { assignee_id: 7 });
    await assert.rejects(provider.listConversationSummaries({
      workspaceId: 'another-workspace',
      conversations: [{ conversationLinkId: 'foreign', channelConnectionId: 'conn-b', conversationDisplayId: 220 }],
    }), /workspace boundary/);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
  }
});
