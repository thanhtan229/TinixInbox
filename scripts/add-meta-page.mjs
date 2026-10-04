import { ENV } from '../src/config/env.ts';
const token = process.env.META_TEST_PAGE_TOKEN;
if (!token) throw new Error('Set META_TEST_PAGE_TOKEN in the environment; do not put tokens in source or command arguments.');
const response = await fetch(`http://${ENV.HOST}:${ENV.PORT}/api/channels/connect-meta`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(ENV.TINIX_OPERATOR_TOKEN ? { Authorization: `Bearer ${ENV.TINIX_OPERATOR_TOKEN}` } : {}) },
  body: JSON.stringify({ token }), signal: AbortSignal.timeout(60000),
});
const result = await response.json();
console.log({ status: response.status, success: result.success === true, connectionId: result.connection?.id });
if (!response.ok || !result.success) process.exitCode = 1;
