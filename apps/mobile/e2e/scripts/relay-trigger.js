/* global http, maestro, RELAY_ACTION, MAESTRO_RELAY, MAESTRO_DEVICE */
// Maestro runScript: ask the relay to perform a simulator action Maestro cannot express
// (`screenshot`: a system screenshot on this device; `biometric`: accept the biometric prompt).
// MAESTRO_DEVICE is this device's simulator udid / adb serial, passed by scripts/run-two-device.sh.
const relay = typeof MAESTRO_RELAY !== 'undefined' && MAESTRO_RELAY ? MAESTRO_RELAY : 'http://127.0.0.1:4311';
const device = typeof MAESTRO_DEVICE !== 'undefined' ? String(MAESTRO_DEVICE) : '';
if (!device) throw new Error('MAESTRO_DEVICE is required for ' + RELAY_ACTION);
const r = http.post(relay + '/trigger', {
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: RELAY_ACTION, platform: String(maestro.platform).toLowerCase(), device: device }),
});
if (!r.ok) throw new Error('relay could not perform ' + RELAY_ACTION + ' (status ' + r.status + ')');
