const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function loadVibration({ vibrate = () => true } = {}) {
  const values = new Map();
  const context = {
    window: {
      navigator: { vibrate },
      localStorage: {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, value)
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "vibration.js"), "utf8"), context);
  return context.window.SenhaHubVibration;
}

test("vibra uma vez por chamada e ignora polling repetido", () => {
  let calls = 0;
  const vibration = loadVibration({ vibrate: () => { calls += 1; return true; } });
  assert.equal(vibration.vibrateOnce("token:2026-09-10T12:00:00Z").reason, "ok");
  assert.equal(vibration.vibrateOnce("token:2026-09-10T12:00:00Z").reason, "duplicate");
  assert.equal(calls, 1);
});

test("não marca a chamada como entregue quando o navegador bloqueia vibração", () => {
  let calls = 0;
  const vibration = loadVibration({ vibrate: () => { calls += 1; return false; } });
  assert.equal(vibration.vibrateOnce("token:blocked").reason, "blocked");
  assert.equal(vibration.vibrateOnce("token:blocked").reason, "blocked");
  assert.equal(calls, 2);
});

test("continua vibrando quando o armazenamento local está bloqueado", () => {
  let calls = 0;
  const context = {
    window: {
      navigator: { vibrate: () => { calls += 1; return true; } },
      localStorage: {
        getItem: () => { throw new Error("storage blocked"); },
        setItem: () => { throw new Error("storage blocked"); }
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "public", "vibration.js"), "utf8"), context);
  const vibration = context.window.SenhaHubVibration;
  assert.equal(vibration.vibrateOnce("token:storage-blocked").reason, "ok");
  assert.equal(calls, 1);
});
