/* global http, RELAY_KEY, RELAY_VALUE, MAESTRO_RELAY */
// Maestro runScript (runs in the Maestro CLI's JS engine on the host, not on the device):
// publish one value for the other device's flow. Nothing is printed; a failure names the key only.
const relay = typeof MAESTRO_RELAY !== 'undefined' && MAESTRO_RELAY ? MAESTRO_RELAY : 'http://127.0.0.1:4311';
const r = http.post(relay + '/v/' + encodeURIComponent(RELAY_KEY), { body: String(RELAY_VALUE) });
if (!r.ok) throw new Error('relay refused ' + RELAY_KEY + ' (is relay/server.mjs running?)');
