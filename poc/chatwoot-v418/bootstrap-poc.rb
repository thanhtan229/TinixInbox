require 'fileutils'
require 'json'
require 'net/http'
require 'securerandom'
require 'uri'

API_BASE = 'http://127.0.0.1:3000'.freeze
CALLBACK_URL = 'http://callback-receiver:3181/webhooks/chatwoot'.freeze
STATE_DIR = '/poc-state'.freeze
CREDENTIALS_DIR = '/poc-credentials'.freeze
ACCOUNT_NAME = 'Tinix Inbox V2 POC'.freeze

def ensure_user(email:, name:)
  user = User.find_or_initialize_by(provider: 'email', uid: email)
  if user.new_record?
    user.name = name
    user.email = email
    user.password = "Aa!#{SecureRandom.hex(32)}"
    user.confirmed_at = Time.current
    user.save!
  end
  user
end

def api_request(method, path, token:, body: nil)
  uri = URI.join(API_BASE, path)
  request_class = Net::HTTP.const_get(method.to_s.capitalize)
  request = request_class.new(uri)
  request['api_access_token'] = token
  request['Content-Type'] = 'application/json'
  request.body = JSON.generate(body) if body
  http = Net::HTTP.new(uri.host, uri.port, nil)
  http.open_timeout = 5
  http.read_timeout = 15
  response = http.start { |connection| connection.request(request) }
  unless response.is_a?(Net::HTTPSuccess)
    raise "Chatwoot API #{method.to_s.upcase} #{path} returned HTTP #{response.code}: #{response.body.to_s[0, 1000]}"
  end
  return {} if response.body.to_s.empty?

  JSON.parse(response.body)
end

def api_object(response, key)
  candidate = response[key] || response.dig('payload', key) || response.dig('data', key)
  return candidate if candidate.is_a?(Hash)

  candidate = response['payload'] || response['data']
  candidate.is_a?(Hash) ? candidate : response
end

def secure_write(path, contents)
  temporary_path = "#{path}.tmp"
  File.write(temporary_path, contents, mode: 'w', perm: 0o600)
  File.rename(temporary_path, path)
end

if File.exist?(File.join(STATE_DIR, 'bootstrap.json'))
  abort 'POC already bootstrapped; remove the isolated poc_config volume before rerunning.'
end

admin = ensure_user(email: 'poc-admin@tinix.test', name: 'Tinix POC Service Admin')
agent = ensure_user(email: 'poc-agent@tinix.test', name: 'Tinix POC Human Agent')
account = Account.find_by(name: ACCOUNT_NAME) || Account.create!(name: ACCOUNT_NAME)
AccountUser.find_or_create_by!(account: account, user: admin) { |membership| membership.role = :administrator }
AccountUser.find_or_create_by!(account: account, user: agent) { |membership| membership.role = :agent }

admin_token = admin.access_token.token
agent_token = agent.access_token.token
inboxes = []
2.times do |index|
  connection_name = "Tinix POC Connection #{index + 1}"
  response = api_request(
    :post,
    "/api/v1/accounts/#{account.id}/inboxes",
    token: admin_token,
    body: {
      name: connection_name,
      channel: { type: 'api', webhook_url: CALLBACK_URL },
    }
  )
  inbox = api_object(response, 'inbox')
  inbox_id = inbox['id'] || inbox.dig('inbox', 'id')
  raise "Chatwoot did not return an inbox ID for #{connection_name}" unless inbox_id

  api_request(
    :post,
    "/api/v1/accounts/#{account.id}/inbox_members",
    token: admin_token,
    body: { inbox_id: inbox_id, user_ids: [agent.id] }
  )

  contact_response = api_request(
    :post,
    "/api/v1/accounts/#{account.id}/contacts",
    token: admin_token,
    body: {
      name: "Synthetic Contact #{index + 1}",
      identifier: "poc:connection-#{index + 1}:external-user-42",
      inbox_id: inbox_id,
      source_id: 'same-external-user-42',
      custom_attributes: { poc_only: true },
    }
  )
  contact = api_object(contact_response, 'contact')
  contact_id = contact['id']
  raise "Chatwoot did not return a contact ID for #{connection_name}" unless contact_id

  contact_inbox_response = api_request(
    :post,
    "/api/v1/accounts/#{account.id}/contacts/#{contact_id}/contact_inboxes",
    token: admin_token,
    body: { inbox_id: inbox_id, source_id: 'same-external-user-42' }
  )
  inboxes << {
    id: inbox_id,
    name: connection_name,
    contactId: contact_id,
    contactInboxId: nil,
    contactInboxIdExposedByApi: contact_inbox_response.key?('id'),
    sourceId: 'same-external-user-42',
  }
end

inbox_list = api_request(:get, "/api/v1/accounts/#{account.id}/inboxes", token: admin_token)
api_inboxes = inbox_list['payload'] || []
inboxes.each do |inbox|
  api_inbox = api_inboxes.find { |item| item['id'].to_s == inbox[:id].to_s }
  raise "Chatwoot API did not return inbox #{inbox[:id]}" unless api_inbox

  callback_secret = api_inbox['secret']
  raise "Chatwoot API did not expose a callback secret for inbox #{inbox[:id]}" if callback_secret.to_s.empty?

  inbox[:identifier] = api_inbox['inbox_identifier']
  inbox[:callbackSecret] = callback_secret
  inbox[:callbackSecretReturnedByApi] = true
  inbox[:webhookUrl] = api_inbox['webhook_url']
end

config = {
  accountId: account.id,
  allowedInboxIds: inboxes.map { |inbox| inbox[:id].to_s },
  secretsByInbox: inboxes.to_h { |inbox| [inbox[:id].to_s, inbox[:callbackSecret]] },
}
credentials = { adminToken: admin_token, agentToken: agent_token }
summary = {
  accountId: account.id,
  adminUserId: admin.id,
  agentUserId: agent.id,
  inboxes: inboxes.map { |inbox| inbox.except(:callbackSecret) },
}

FileUtils.mkdir_p(STATE_DIR)
FileUtils.mkdir_p(CREDENTIALS_DIR)
secure_write(File.join(STATE_DIR, 'receiver-config.json'), JSON.generate(config))
secure_write(File.join(CREDENTIALS_DIR, 'credentials.json'), JSON.generate(credentials))
secure_write(File.join(STATE_DIR, 'bootstrap.json'), JSON.pretty_generate(summary))
puts JSON.pretty_generate(summary)
