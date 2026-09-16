(function exposeSenhaHubVibration(scope) {
  const STORAGE_PREFIX = "senhaHubVibration:";

  function storage() {
    try {
      return scope.localStorage;
    } catch {
      return null;
    }
  }

  function supported() {
    return typeof scope.navigator?.vibrate === "function";
  }

  function activate() {
    if (!supported()) return false;
    try {
      return scope.navigator.vibrate([80, 50, 80]) !== false;
    } catch {
      return false;
    }
  }

  function wasSent(store, key) {
    try {
      return store?.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function markSent(store, key) {
    try {
      store?.setItem(key, "1");
    } catch {
      // A vibração não deve falhar só porque o armazenamento está bloqueado.
    }
  }

  function vibrateOnce(identity, pattern = [220, 90, 220, 90, 420]) {
    const key = `${STORAGE_PREFIX}${String(identity || "").slice(0, 180)}`;
    if (!identity || !supported()) return { vibrated: false, reason: "unsupported" };
    const store = storage();
    if (wasSent(store, key)) return { vibrated: false, reason: "duplicate" };
    try {
      const result = scope.navigator.vibrate(pattern);
      if (result !== false) markSent(store, key);
      return { vibrated: result !== false, reason: result === false ? "blocked" : "ok" };
    } catch {
      return { vibrated: false, reason: "blocked" };
    }
  }

  scope.SenhaHubVibration = { activate, supported, vibrateOnce };
})(window);
