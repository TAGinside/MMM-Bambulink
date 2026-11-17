/* MMM-Bambulink - test des rapports MQTT incrémentaux.
 *
 * Test isolé, sans imprimante ni MagicMirror : les modules "node_helper"
 * et "mqtt" sont remplacés par des simulations.
 * Lancement : npm test   (ou : node test/incremental.test.js)
 */
"use strict";
const assert = require("assert");
const Module = require("module");
const EventEmitter = require("events");

// --- Mocks -----------------------------------------------------------------
const clients = [];
const mocks = {
  node_helper: { create: (def) => def },
  mqtt: {
    connect: () => {
      const c = new EventEmitter();
      c.connected = true;
      c.subscribe = (t, cb) => cb && cb(null);
      c.publish = () => {};
      c.end = () => { c.connected = false; };
      clients.push(c);
      return c;
    }
  }
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (Object.prototype.hasOwnProperty.call(mocks, req)) return mocks[req];
  return origLoad.call(this, req, ...rest);
};

const path = require("path");
const helper = require(process.argv[2] || path.join(__dirname, "..", "node_helper.js"));
const sent = [];
helper.sendSocketNotification = (n, p) => sent.push({ n, p });
helper.log = () => {}; // logs du helper masqués pendant le test
helper.start();

const config = { ip: "1.2.3.4", accessCode: "x", serial: "SN1", pushallInterval: 0 };
helper.socketNotificationReceived("BAMBULINK_CONFIG", { identifier: "m1", config });
const client = clients[clients.length - 1];
const emit = (obj) => client.emit("message", "device/SN1/report", Buffer.from(JSON.stringify(obj)));
const lastStatus = () => sent.filter((s) => s.n === "BAMBULINK_STATUS").pop().p;

// --- Full report -----------------------------------------------------------
const full = { print: {
  command: "push_status", gcode_state: "RUNNING", subtask_name: "Benchy",
  mc_percent: 20, layer_num: 12, total_layer_num: 120, mc_remaining_time: 42,
  nozzle_temper: 219.5, nozzle_target_temper: 220, bed_temper: 59.8, bed_target_temper: 60,
  spd_lvl: 2, wifi_signal: "-50dBm",
  ams: { tray_now: "1", ams: [
    { id: "0", humidity_raw: "35", temp: "24.1", tray: [
      { id: "0", tray_type: "PLA", tray_color: "FF0000FF" },
      { id: "1", tray_type: "PETG", tray_color: "00FF00FF" },
      { id: "2", tray_type: "ABS", tray_color: "0000FFFF" },
      { id: "3", tray_type: "TPU", tray_color: "FFFFFFFF" } ] },
    { id: "1", humidity_raw: "40", temp: "25.0", tray: [
      { id: "0", tray_type: "PLA", tray_color: "000000FF" } ] } ] }
} };
emit(full);
const before = JSON.parse(JSON.stringify(lastStatus()));
assert.strictEqual(before.progress, 20);
assert.strictEqual(before.ams_units.length, 2);

// --- Partial report: only mc_percent ----------------------------------------
emit({ print: { mc_percent: 50 } });
const after = lastStatus();
assert.strictEqual(after.progress, 50, "progress updated");
for (const k of Object.keys(before)) {
  if (k === "progress") continue;
  assert.deepStrictEqual(after[k], before[k], `field ${k} preserved`);
}
assert.strictEqual(after.nozzle_temp, 219.5);
assert.strictEqual(after.bed_temp, 59.8);
assert.strictEqual(after.layer_num, 12);
assert.strictEqual(after.subtask_name, "Benchy");
assert.strictEqual(after.ams_tray_type, "PETG");
console.log("PASS  full + {mc_percent:50} -> progress 50, everything else unchanged");

// --- Partial AMS update: one tray of AMS 2 only -----------------------------
emit({ print: { ams: { ams: [ { id: "1", tray: [ { id: "0", tray_color: "FFFF00FF" } ] } ] } } });
let st = lastStatus();
assert.strictEqual(st.ams_units.length, 2, "both AMS units kept");
assert.strictEqual(st.ams_units[0].slots.length, 4, "AMS 1 trays kept");
assert.strictEqual(st.ams_units[1].slots[0].tray_color, "FFFF00FF", "color updated");
assert.strictEqual(st.ams_units[1].slots[0].tray_type, "PLA", "type kept");
assert.strictEqual(st.ams_units[0].humidity, "35");
assert.strictEqual(st.progress, 50);
console.log("PASS  partial AMS update merged by id");

// --- Emptied slot (tray reduced to its id) ----------------------------------
emit({ print: { ams: { ams: [ { id: "0", tray: [ { id: "2" } ] } ] } } });
st = lastStatus();
assert.strictEqual(st.ams_units[0].slots[2].tray_type, "Vide");
assert.strictEqual(st.ams_units[0].slots[2].tray_color, null);
assert.strictEqual(st.ams_units[0].slots[1].tray_type, "PETG");
console.log("PASS  emptied slot (id only) replaces old tray");

// --- Non-id arrays replaced (e.g. hms cleared) ------------------------------
emit({ print: { hms: [ { attr: 1, code: 2 } ] } });
emit({ print: { hms: [] } });
assert.deepStrictEqual(helper.sessions.m1.printCache.hms, []);
console.log("PASS  arrays without id are replaced");

// --- Prototype pollution guard ----------------------------------------------
client.emit("message", "t", Buffer.from('{"print":{"__proto__":{"polluted":1}}}'));
assert.strictEqual({}.polluted, undefined);
console.log("PASS  __proto__ key ignored");

// --- Cache reset on openSession ---------------------------------------------
helper.socketNotificationReceived("BAMBULINK_CONFIG", { identifier: "m1", config });
const c2 = clients[clients.length - 1];
c2.emit("message", "t", Buffer.from(JSON.stringify({ print: { mc_percent: 70 } })));
st = lastStatus();
assert.strictEqual(st.progress, 70);
assert.strictEqual(st.nozzle_temp, undefined, "cache reset on reopen");
assert.strictEqual(st.ams_units.length, 0);
console.log("PASS  cache reset when session reopened");

// --- Sessions isolated ------------------------------------------------------
helper.socketNotificationReceived("BAMBULINK_CONFIG", { identifier: "m2", config: Object.assign({}, config, { serial: "SN2" }) });
const c3 = clients[clients.length - 1];
c3.emit("message", "t", Buffer.from(JSON.stringify({ print: { nozzle_temper: 30 } })));
st = lastStatus();
assert.strictEqual(st.identifier, "m2");
assert.strictEqual(st.progress, undefined);
assert.strictEqual(helper.sessions.m1.printCache.nozzle_temper, undefined);
console.log("PASS  per-instance caches are independent");

helper.stop();
console.log("\nAll tests passed");
