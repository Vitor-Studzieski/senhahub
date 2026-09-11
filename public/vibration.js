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

  async function enable() {
    let permission = scope.Notification?.permission || "unsupported";
    if (permission === "default" && typeof scope.Notification.requestPermission === "function") {
      permission = await scope.Notification.requestPermission();
    }
    return {
      permission,
      vibrated: activate()
    };
  }

  function vibrateOnce(identity, pattern = [220, 90, 220, 90, 420]) {
    const key = `${STORAGE_PREFIX}${String(identity || "").slice(0, 180)}`;
    if (!identity || !supported()) return { vibrated: false, reason: "unsupported" };
    const store = storage();
    if (store?.getItem(key) === "1") return { vibrated: false, reason: "duplicate" };
    try {
      const result = scope.navigator.vibrate(pattern);
      if (result !== false) store?.setItem(key, "1");
      return { vibrated: result !== false, reason: result === false ? "blocked" : "ok" };
    } catch {
      return { vibrated: false, reason: "blocked" };
    }
  }

  async function notifyOnce(identity, input = {}) {
    const key = `${STORAGE_PREFIX}notification:${String(identity || "").slice(0, 160)}`;
    if (!identity || scope.Notification?.permission !== "granted") {
      return { notified: false, reason: "permission" };
    }
    const store = storage();
    if (store?.getItem(key) === "1") return { notified: false, reason: "duplicate" };
    const title = String(input.title || "Senha chamada").slice(0, 80);
    const body = String(input.body || "Dirija-se ao balcão.").slice(0, 180);
    try {
      const registration = await scope.navigator.serviceWorker?.ready;
      if (registration?.showNotification) {
        await registration.showNotification(title, {
          body,
          icon: "/icons/senhahub-192.png",
          badge: "/icons/favicon-32.png",
          tag: `tracking-${identity}`,
          renotify: true,
          requireInteraction: true,
          data: { url: scope.location.href }
        });
      } else {
        new scope.Notification(title, { body });
      }
      store?.setItem(key, "1");
      return { notified: true, reason: "ok" };
    } catch {
      return { notified: false, reason: "blocked" };
    }
  }

  scope.SenhaHubVibration = { activate, enable, notifyOnce, supported, vibrateOnce };
})(window);
