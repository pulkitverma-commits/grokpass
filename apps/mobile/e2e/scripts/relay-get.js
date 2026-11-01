/* global http, output, RELAY_KEY, MAESTRO_ROOM_LINK, MAESTRO_RELAY, MAESTRO_UNIVERSAL_LINKS */
// Maestro runScript: resolve the join link for device B. MAESTRO_ROOM_LINK wins when the run
// script passed it; otherwise the value device A published to the relay is used. Simulators do
// not verify Universal Links, so the https form becomes the app scheme unless
// MAESTRO_UNIVERSAL_LINKS=1 (physical devices with verified associations).
const relay = typeof MAESTRO_RELAY !== 'undefined' && MAESTRO_RELAY ? MAESTRO_RELAY : 'http://127.0.0.1:4311';
let link = typeof MAESTRO_ROOM_LINK !== 'undefined' && MAESTRO_ROOM_LINK ? MAESTRO_ROOM_LINK : '';
if (!link) {
  const r = http.get(relay + '/v/' + encodeURIComponent(RELAY_KEY));
  if (!r.ok) throw new Error('no ' + RELAY_KEY + ' on the relay: run 03-create-secret-room on device A first');
  link = r.body;
}
const universal = typeof MAESTRO_UNIVERSAL_LINKS !== 'undefined' && String(MAESTRO_UNIVERSAL_LINKS) === '1';
if (!universal) link = link.replace(/^https:\/\/(www\.)?onepeek\.io\//, 'onepeek://');
output.link = link;
