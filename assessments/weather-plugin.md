# WeatherPlugin Assessment

## Module Overview

WeatherPlugin gives agents the ability to look up current weather conditions for any named location. It requires no API key — it uses Open-Meteo, a free and open weather API. The plugin performs a two-step network sequence: first it geocodes the location name to coordinates using Open-Meteo's geocoding API, then it fetches current weather data for those coordinates from the forecast API. The resulting response is a structured object with human-readable values (e.g., `"14°C"`, `"15 km/h"`) derived by combining numeric readings with their unit strings.

A module-level WMO weather code lookup table translates numeric condition codes (as defined by the World Meteorological Organization) into plain-English descriptions.

## Interface / Exports

```typescript
export class WeatherPlugin implements AgentPlugin
```

**Constructor**

No constructor is defined; the default no-arg constructor is used.

**Implemented AgentPlugin hooks**

| Hook | Returns |
|---|---|
| `getSystemPromptFragment()` | Brief instruction to use `get_weather` when the user asks about weather, temperature, or conditions |
| `getTools()` | One tool definition: `get_weather` |
| `executeTool(name, args)` | Delegates `get_weather` to `this.getWeather(args.location)` |

**Tool: `get_weather`**

- **Parameter**: `location` (string, required) — city name or place, e.g. `"Toronto"`, `"London, UK"`.
- **Returns**: A structured object with location metadata and current conditions (see Data Flow).

## Configuration

- **No API key required**: Open-Meteo is a public API.
- **No environment variables** are read by this plugin.
- **No constructor options**.
- **Network timeouts**: 10 seconds (`AbortSignal.timeout(10_000)`) on both the geocoding and weather fetch calls.
- **`WMO_DESCRIPTIONS` constant** (module-level `Record<number, string>`): Maps WMO weather codes to English descriptions. Covers codes 0–99 for the conditions defined by Open-Meteo's documentation.

## Data Flow

```
LLM calls get_weather { location: "Toronto" }
  → executeTool("get_weather", { location: "Toronto" })
    → getWeather("Toronto")

      Step 1 — Geocoding:
        GET https://geocoding-api.open-meteo.com/v1/search
          ?name=Toronto&count=1&language=en&format=json
        → if !res.ok → throw Error("Geocoding failed: <status>")
        → if no results → return { error: 'Location "Toronto" not found.' }
        → extract { latitude, longitude, name, country, timezone } from results[0]

      Step 2 — Current weather:
        GET https://api.open-meteo.com/v1/forecast
          ?latitude=...&longitude=...
          &current=temperature_2m,relative_humidity_2m,apparent_temperature,
                   precipitation,weather_code,wind_speed_10m,
                   wind_direction_10m,surface_pressure
          &timezone=<timezone>&forecast_days=1
        → if !res.ok → throw Error("Weather fetch failed: <status>")
        → combine numeric values with unit strings from current_units

      Return:
        {
          location, latitude, longitude, timezone,
          conditions,       // WMO_DESCRIPTIONS lookup
          temperature,      // e.g. "14°C"
          feels_like,
          humidity,
          precipitation,
          wind_speed,
          wind_direction,   // e.g. "270°"
          pressure,
        }
```

## Code Paths

### Happy path

1. `executeTool` receives `name === "get_weather"` and calls `getWeather(args.location)`.
2. A debug log entry is written.
3. The geocoding URL is built with `location` as the `name` parameter, requesting only 1 result.
4. Geocoding response is fetched with a 10-second timeout. Throws if non-2xx.
5. If `geoData.results` is empty or absent, returns `{ error: 'Location "..." not found.' }` — this is the only soft-error path.
6. The first geocoding result provides `latitude`, `longitude`, `name`, `country`, and `timezone`.
7. The weather URL is built requesting 8 current fields. `timezone` is passed through from the geocoding result; if absent it falls back to `"auto"`.
8. Weather response is fetched with a 10-second timeout. Throws if non-2xx.
9. Each numeric value in `weatherData.current` is concatenated with its corresponding unit string from `weatherData.current_units`.
10. `weather_code` is looked up in `WMO_DESCRIPTIONS`; falls back to `"Code ${code}"` if not found.
11. The structured result object is returned.

### Location not found

After geocoding, if `geoData.results?.length` is falsy, the function returns `{ error: 'Location "..." not found.' }` early. The weather request is never made.

### HTTP errors

Both fetch calls check `res.ok` and throw a descriptive `Error` on failure. These throws propagate uncaught through `executeTool` to `BaseAgent`'s tick-level error handler.

### Unknown tool name

If `executeTool` is called with a name other than `"get_weather"`, the function returns `undefined` implicitly.

### Unknown WMO code

`WMO_DESCRIPTIONS[c.weather_code] ?? \`Code ${c.weather_code}\`` — if the API returns a code not in the local table, the fallback string includes the numeric code so the LLM receives something meaningful.

## Helper Functions / Internals

### `WMO_DESCRIPTIONS` (module-level constant)

A plain object mapping WMO integer codes to English description strings. Covers the full set of codes used by Open-Meteo: clear sky (0), varying cloud cover (1–3), fog (45, 48), drizzle (51–55), rain (61–65), snow (71–77), showers (80–82, 85–86), and thunderstorms (95, 96, 99). Not a class member; shared across all instances.

### `private async getWeather(location: string)`

The sole implementation method. Performs both HTTP requests sequentially (geocode then weather), maps the response, and returns the result object. Not exported.

## Error Handling

| Scenario | Handling |
|---|---|
| Location not found by geocoder | Returns `{ error }` object (soft error, no throw) |
| Geocoding API non-2xx | Throws `Error("Geocoding failed: <status>")` |
| Weather API non-2xx | Throws `Error("Weather fetch failed: <status>")` |
| Network timeout (>10s, either call) | `AbortSignal.timeout` causes fetch to reject; propagates as throw |
| Unknown WMO code | Falls back to `"Code ${code}"` string |
| Unknown tool name | Returns `undefined` silently |

Throws propagate to `BaseAgent.act()`'s catch block, which logs and emits an `"error"` event. There is no retry logic.

## Integration Context

WeatherPlugin is registered in the **info sub-agent** (`src/agents/sub-agents/createInfoAgent.ts`), alongside `TMDBPlugin` and `NotesPlugin`. The info agent is a `HeadlessAgent` with the persona "information retrieval specialist."

Call chain:

```
User → CortexAgent
  → SubAgentPlugin.executeTool("info_agent", { task })
    → HeadlessAgent.ask(task)
      → WeatherPlugin.executeTool("get_weather", { location })
```

No other module imports WeatherPlugin.

## Observations / Notes

- **Sequential network calls**: Geocoding and weather fetching are done in two separate sequential `await` calls, not concurrently. While the dependency is real (coordinates are needed before the weather call), the total wall-clock time is the sum of both latencies (up to 20 seconds in the worst case).
- **Only the first geocoding result is used**: If the location name is ambiguous (e.g., `"Springfield"`), the geocoder's top-ranked result is used with no disambiguation. The `name` and `country` fields in the response let the LLM identify what was actually resolved.
- **`wind_direction` formatting difference**: All other fields combine the numeric value with the unit from `current_units` (e.g., `"14°C"`). Wind direction hard-codes the `°` symbol (`${c.wind_direction_10m}°`) rather than reading from `u.wind_direction_10m`. If the API ever changes or extends its units object, this field will behave differently from the others.
- **`forecast_days=1` is set but only current data is requested**: The `forecast_days` parameter is included in the weather request but only `current` fields are fetched. This is consistent with the tool's stated purpose (current conditions) but means hourly or daily forecast data is never returned even though the API supports it.
- **No caching**: Each call makes two fresh network requests. Repeated queries for the same city within a short time window will trigger duplicate geocoding lookups.
- **Units are locale-independent**: The response uses the API's default metric units (°C, km/h, hPa, mm). There is no option to request imperial units.
