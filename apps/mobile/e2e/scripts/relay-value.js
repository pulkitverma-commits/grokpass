/* global http, output, RELAY_KEY, MAESTRO_RELAY */
// Maestro runScript: read one value the other device published (scripts/relay-put.js) into
// `output.value`. Generic counterpart of relay-get.js, which is specific to the room link (it
// rewrites the scheme). Used by 11 for the safety number, which is meant to be compared and is
// not a secret. Nothing is printed; a failure names the key only.
const relay = typeof MAESTRO_RELAY !== 'undefined' && MAESTRO_RELAY ? MAESTRO_RELAY : 'http://127.0.0.1:4311';
const r = http.get(relay + '/v/' + encodeURIComponent(RELAY_KEY));
if (!r.ok) throw new Error('no ' + RELAY_KEY + ' on the relay: run the device-a half first');
output.value = r.body;
