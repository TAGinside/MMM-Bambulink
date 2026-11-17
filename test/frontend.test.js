/* MMM-Bambulink - test des fonctions du front-end.
 *
 * Test isolé, sans navigateur ni MagicMirror : "Module.register" est simulé
 * pour récupérer la définition du module.
 * Lancement : npm test   (ou : node test/frontend.test.js)
 */
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// --- Chargement du module avec un faux "Module.register" -------------------
let def = null;
const source = fs.readFileSync(path.join(__dirname, "..", "MMM-Bambulink.js"), "utf8");
// "Date" est partagé avec le contexte du module pour pouvoir simuler l'horloge.
vm.runInNewContext(source, { Date, Module: { register: (name, d) => { def = d; } } });
assert.ok(def, "module registered");

const instance = Object.assign({}, def, {
  config: JSON.parse(JSON.stringify(def.defaults)),
  temperatureHistory: [],
  lastKnownTemps: { nozzle: null, bed: null, chamber: null }
});

// --- configDeepMerge --------------------------------------------------------
assert.strictEqual(def.configDeepMerge, true);
console.log("PASS  configDeepMerge enabled");

// --- hexToRgba : une composante à 0 reste à 0 -------------------------------
assert.strictEqual(instance.hexToRgba("#000000", 0.5), "rgba(0, 0, 0, 0.5)");
assert.strictEqual(instance.hexToRgba("#ff4d4f", 1), "rgba(255, 77, 79, 1)");
assert.strictEqual(instance.hexToRgba("#0f0", 1), "rgba(0, 255, 0, 1)");
assert.strictEqual(instance.hexToRgba("zzzzzz", 1), "rgba(255, 255, 255, 1)");
console.log("PASS  hexToRgba keeps 0 components");

// --- Historique du graphe : points espacés pour couvrir toute la fenêtre ----
const realNow = Date.now;
let now = 1000000;
Date.now = () => now;
try {
  // Fenêtre de 30 min => un point toutes les 2,5 s au plus.
  for (let i = 0; i < 3600; i++) {          // 1 message par seconde pendant 1 h
    instance.addTemperatureSnapshot({ nozzle_temp: 200 + (i % 10), bed_temp: 60 });
    now += 1000;
  }
  const h = instance.temperatureHistory;
  assert.ok(h.length <= 720, "history capped");
  const span = h[h.length - 1].ts - h[0].ts;
  assert.ok(span >= 29 * 60 * 1000, `history covers the 30 min window (span ${span} ms)`);
  console.log("PASS  graph history spans the whole window");

  // Une valeur absente garde la dernière valeur connue.
  now += 5000;
  instance.addTemperatureSnapshot({ bed_temp: 61 });
  const last = instance.temperatureHistory[instance.temperatureHistory.length - 1];
  assert.strictEqual(last.bed, 61);
  assert.ok(last.nozzle !== null, "nozzle kept");
  console.log("PASS  missing values keep last known temperature");
} finally {
  Date.now = realNow;
}

// --- Temps restant ----------------------------------------------------------
const ctx = { Module: { register: () => {} } };
vm.runInNewContext(source + "\nthis.f = formatMinutesToDHM;", ctx);
assert.strictEqual(ctx.f(1505), "1j 1h 5m");
assert.strictEqual(ctx.f(undefined), "N/A");
console.log("PASS  formatMinutesToDHM");

console.log("\nAll frontend tests passed");
