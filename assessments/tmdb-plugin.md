# TMDBPlugin Assessment

## Module Overview

TMDBPlugin gives agents access to The Movie Database (TMDB) API. It enables movie searches, detailed movie lookups, cast and crew retrieval, similar-film recommendations, trending-movie listings, and person-career lookups. It exists so agents can answer entertainment-domain questions — "who directed X?", "what movies is Y known for?", "what's trending this week?" — with structured, machine-readable data from an authoritative source.

The plugin is API-key authenticated. All HTTP requests are routed through a single private `tmdbFetch` helper that attaches the Bearer token, enforces a 10-second timeout, and throws on non-2xx responses.

## Interface / Exports

```typescript
export class TMDBPlugin implements AgentPlugin
```

**Constructor**

```typescript
constructor(apiKey?: string)
```

Accepts an optional API key. Falls back to `process.env.TMDB_API_KEY`. If neither is provided the key is an empty string, and every `executeTool` call returns `{ error: "TMDB_API_KEY is not set..." }` without making any network request.

**Implemented AgentPlugin hooks**

| Hook | Behaviour |
|---|---|
| `getSystemPromptFragment()` | Describes the 7 available tools and instructs the LLM to restrict person lookups to explicit film/TV career questions |
| `getTools()` | Returns 7 tool definitions (see below) |
| `executeTool(name, args)` | Dispatches to the matching private method; returns `{ error }` immediately if no API key |

**Tools exposed**

| Tool name | Key parameters | Purpose |
|---|---|---|
| `search_movies` | `query` (req), `year`, `page` | Text search against TMDB movie index |
| `get_movie_details` | `movie_id` (req) | Full metadata for one movie |
| `get_movie_credits` | `movie_id` (req) | Top 15 cast + filtered key crew |
| `get_movie_recommendations` | `movie_id` (req), `page` | Similar films based on a seed movie |
| `get_trending_movies` | `time_window` (`"day"` or `"week"`, optional) | Trending movies; defaults to `"week"` |
| `search_person` | `query` (req), `page` | Search for actors/directors by name |
| `get_person_details` | `person_id` (req) | Biography + top cast/crew movie credits |

## Configuration

- **`TMDB_API_KEY` environment variable**: Required for any tool call. Read at construction time via `process.env.TMDB_API_KEY` if no key is passed to the constructor.
- **`TMDB_BASE_URL`**: `https://api.themoviedb.org/3` — hardcoded module-level constant.
- **`TMDB_IMAGE_BASE`**: `https://image.tmdb.org/t/p` — hardcoded module-level constant, used to build image URLs.
- **Network timeout**: 10 seconds (`AbortSignal.timeout(10_000)`) on every request.
- **No external npm packages**: Uses native `fetch`.

## Data Flow

```
LLM calls search_movies { query: "Blade Runner", year: 1982 }
  → executeTool("search_movies", args)
    → apiKey check (early return { error } if missing)
    → searchMovies("Blade Runner", 1982, 1)
      → tmdbFetch("/search/movie", { query, year, page })
        → build URL with searchParams
        → fetch with Bearer auth + 10s timeout
        → throw if !res.ok
        → return res.json()
      → map first 10 results to { id, title, ..., poster_url }
      → return { total_results, total_pages, page, results[] }
```

For `get_person_details`, two requests are fired concurrently:

```
tmdbFetch(`/person/${personId}`) and tmdbFetch(`/person/${personId}/movie_credits`)
  → Promise.all([details, credits])
  → merge and return
```

## Code Paths

### Missing API key

`executeTool` checks `this.apiKey` as the very first step. If falsy, it returns `{ error: "TMDB_API_KEY is not set. Please configure the API key." }` without calling any private method. This is the only guard; individual private methods do not re-check.

### `search_movies`

Calls `tmdbFetch("/search/movie", { query, page, [year] })`. Maps the first 10 results from `data.results`, adding a constructed `poster_url` via `imgUrl`. Passes `year` only if provided (the parameter is omitted rather than sent as `undefined`).

### `get_movie_details`

Single call to `/movie/${movieId}`. Maps all scalar fields directly. Arrays (`genres`, `production_companies`, `production_countries`, `spoken_languages`) are mapped to name/string arrays. Builds both `poster_url` (w500) and `backdrop_url` (w1280).

### `get_movie_credits`

Single call to `/movie/${movieId}/credits`. Slices cast to 15 entries. Filters crew to jobs in: `["Director", "Writer", "Screenplay", "Story", "Producer", "Executive Producer"]`. Returns `{ movie_id, cast, crew }`.

### `get_movie_recommendations`

Calls `/movie/${movieId}/recommendations` with pagination. Slices to 10. Same shape as `search_movies` results but without `vote_count` or `genre_ids`.

### `get_trending_movies`

Calls `/trending/movie/${timeWindow}`. `timeWindow` defaults to `"week"` in `executeTool` if not supplied. Returns up to 20 results including `media_type` (which TMDB includes on trending endpoints).

### `search_person`

Calls `/search/person`. Maps first 10 results. For each person, includes up to 3 `known_for` credits, normalising `title ?? name` and `release_date ?? first_air_date` to handle both movies and TV.

### `get_person_details`

Fires two requests concurrently with `Promise.all`. Cast credits are sorted by `popularity` descending, sliced to 20. Crew credits are filtered to `["Director", "Writer", "Screenplay"]` only, sorted by popularity, sliced to 10.

### HTTP error in `tmdbFetch`

If the response status is not OK, `tmdbFetch` reads the response body as text (catching if that also fails) and throws `new Error("TMDB API error ${status}: ${text}")`. This throw propagates back through `executeTool` uncaught — the error surfaces to the `BaseAgent` which catches it at the plugin dispatch level and emits an `"error"` event.

## Helper Functions / Internals

### `private async tmdbFetch(path, params)`

Central HTTP helper. Builds a full URL from `TMDB_BASE_URL + path` and a params record. Attaches `Authorization: Bearer <apiKey>` and `Accept: application/json`. Logs the path+query at debug level. Throws on non-2xx. Returns parsed JSON.

### `function imgUrl(path, size = "w500")`

Module-level (not a class method). Accepts a nullable TMDB poster/backdrop path string. Returns a full CDN URL (`TMDB_IMAGE_BASE/size/path`) or `null` if path is falsy. Used throughout all mapping functions.

## Error Handling

| Scenario | Handling |
|---|---|
| Missing API key | Returns `{ error }` object, no network call |
| Non-2xx HTTP response | `tmdbFetch` throws; error propagates to `BaseAgent` |
| Network timeout (>10s) | `AbortSignal.timeout` causes fetch to reject; propagates as throw |
| `res.text()` fails during error reporting | `.catch(() => res.statusText)` falls back to status text |
| Unknown tool name | `executeTool` returns `undefined` implicitly |

Errors from `tmdbFetch` are not caught inside `executeTool`, meaning they reach `BaseAgent.act()`'s try-catch, which logs them and emits the `"error"` event. There is no retry logic.

## Integration Context

TMDBPlugin is registered in the **info sub-agent** (`src/agents/sub-agents/createInfoAgent.ts`), alongside `WeatherPlugin` and `NotesPlugin`. The info agent is a `HeadlessAgent` with the persona "information retrieval specialist."

The info sub-agent is surfaced to the main orchestrator as a `SubAgentPlugin` tool. Call chain:

```
User → CortexAgent
  → SubAgentPlugin.executeTool("info_agent", { task })
    → HeadlessAgent.ask(task)
      → TMDBPlugin.executeTool("search_movies" | ..., args)
```

No other module imports TMDBPlugin.

## Observations / Notes

- **Prompt-level scope restriction**: The system prompt fragment explicitly tells the LLM not to call `search_person` or `get_person_details` when a person is mentioned in a non-entertainment context. This is a soft control — the model can still call those tools if it chooses, and there is no runtime enforcement of that rule.
- **Result slicing**: `search_movies` and similar methods hard-slice to 10 results client-side even though TMDB paginates server-side. If the caller wants page 2, they must pass `page: 2`, but they will still only see 10 results per page.
- **`get_person_details` makes 2 concurrent requests**: This is efficient but means both requests must succeed; if either fails the entire call throws.
- **Crew credits in `getPersonDetails` are more restrictive than `getMovieCredits`**: `getMovieCredits` includes `"Story"`, `"Producer"`, and `"Executive Producer"`, while `getPersonDetails` only includes `"Director"`, `"Writer"`, `"Screenplay"`. This asymmetry is silent.
- **`media_type` only appears in trending results**: Other endpoints do not include it. This is correct API behaviour but the inconsistency in response shapes across tools means callers must handle the field conditionally.
- **No caching**: Every tool call makes a fresh network request. For frequently-repeated queries (e.g., movie details called after a search) this results in redundant API usage.
- **API key is stored as a plain string on the instance**: It is not treated as a secret beyond being kept private. It will appear in any heap snapshot or serialisation of the object.
