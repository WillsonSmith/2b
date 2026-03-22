import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Foggy",
  48: "Icy fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Light rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Moderate snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Moderate showers",
  82: "Heavy showers",
  85: "Light snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with light hail",
  99: "Thunderstorm with heavy hail",
};

export class WeatherPlugin implements AgentPlugin {
  name = "Weather";


  getTools(): ToolDefinition[] {
    return [
      {
        name: "get_weather",
        description:
          "Get current weather conditions for a city or location. Returns temperature, wind speed, humidity, and sky conditions. No API key required.",
        parameters: {
          type: "object",
          properties: {
            location: {
              type: "string",
              description:
                "City name or location, e.g. 'Toronto', 'New York', 'London, UK'.",
            },
          },
          required: ["location"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "get_weather") {
      return this.getWeather(args.location);
    }
  }

  private async getWeather(location: string) {
    logger.debug("Weather", `get_weather: "${location}"`);

    // Step 1: Geocode the location
    const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
    geoUrl.searchParams.set("name", location);
    geoUrl.searchParams.set("count", "1");
    geoUrl.searchParams.set("language", "en");
    geoUrl.searchParams.set("format", "json");

    const geoRes = await fetch(geoUrl.toString(), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!geoRes.ok) throw new Error(`Geocoding failed: ${geoRes.status}`);

    const geoData = (await geoRes.json()) as any;
    if (!geoData.results?.length) {
      return { error: `Location "${location}" not found.` };
    }

    const place = geoData.results[0];
    const { latitude, longitude, name, country, timezone } = place;

    // Step 2: Fetch current weather
    const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
    weatherUrl.searchParams.set("latitude", String(latitude));
    weatherUrl.searchParams.set("longitude", String(longitude));
    weatherUrl.searchParams.set(
      "current",
      [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "precipitation",
        "weather_code",
        "wind_speed_10m",
        "wind_direction_10m",
        "surface_pressure",
      ].join(","),
    );
    weatherUrl.searchParams.set("timezone", timezone ?? "auto");
    weatherUrl.searchParams.set("forecast_days", "1");

    const weatherRes = await fetch(weatherUrl.toString(), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!weatherRes.ok) throw new Error(`Weather fetch failed: ${weatherRes.status}`);

    const weatherData = (await weatherRes.json()) as any;
    const c = weatherData.current;
    const u = weatherData.current_units;

    return {
      location: `${name}, ${country}`,
      latitude,
      longitude,
      timezone,
      conditions: WMO_DESCRIPTIONS[c.weather_code as number] ?? `Code ${c.weather_code}`,
      temperature: `${c.temperature_2m}${u.temperature_2m}`,
      feels_like: `${c.apparent_temperature}${u.apparent_temperature}`,
      humidity: `${c.relative_humidity_2m}${u.relative_humidity_2m}`,
      precipitation: `${c.precipitation}${u.precipitation}`,
      wind_speed: `${c.wind_speed_10m}${u.wind_speed_10m}`,
      wind_direction: `${c.wind_direction_10m}°`,
      pressure: `${c.surface_pressure}${u.surface_pressure}`,
    };
  }
}
