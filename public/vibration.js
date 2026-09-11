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

  function playAlertTone() {
    try {
      const AudioContext = scope.AudioContext || scope.webkitAudioContext;
      if (!AudioContext) return false;
      const context = new AudioContext();
      const now = context.currentTime;
      [0, 0.22, 0.44].forEach((offset, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = index === 2 ? 880 : 660;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.16);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.17);
      });
      window.setTimeout(() => context.close().catch(() => {}), 1200);
      return true;
    } catch {
      return false;
    }
  }

  function signalOnce(identity) {
    const key = `${STORAGE_PREFIX}signal:${String(identity || "").slice(0, 180)}`;
    if (!identity) return { signaled: false, reason: "invalid" };
    const store = storage();
    if (store?.getItem(key) === "1") return { signaled: false, reason: "duplicate" };
    const vibrated = activate();
    const sounded = playAlertTone();
    if (vibrated || sounded) store?.setItem(key, "1");
    return { signaled: vibrated || sounded, vibrated, sounded, reason: vibrated || sounded ? "ok" : "blocked" };
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

  scope.SenhaHubVibration = { activate, enable, notifyOnce, playAlertTone, signalOnce, supported, vibrateOnce };
})(window);
