const WEATHER_CONFIG = Object.freeze({
  city: "Pompéia, SP",
  latitude: -22.10883,
  longitude: -50.17208,
  timezone: "America/Sao_Paulo"
});

const WEATHER_TIMEOUT_MS = 5000;

function weatherUrl() {
  const query = new URLSearchParams({
    latitude: String(WEATHER_CONFIG.latitude),
    longitude: String(WEATHER_CONFIG.longitude),
    current: "temperature_2m,weather_code",
    temperature_unit: "celsius",
    timezone: WEATHER_CONFIG.timezone
  });
  return `https://api.open-meteo.com/v1/forecast?${query}`;
}

async function fetchCurrentWeather() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS);

  try {
    const response = await fetch(weatherUrl(), {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    const current = payload.current;

    if (!response.ok || !current || !Number.isFinite(Number(current.temperature_2m))) {
      throw new Error("Clima indisponível.");
    }

    return { current, city: WEATHER_CONFIG.city };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { fetchCurrentWeather, WEATHER_CONFIG };
