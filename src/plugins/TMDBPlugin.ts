import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export class TMDBPlugin implements AgentPlugin {
  name = "TMDB";

  // Result-count caps — adjust here to affect all methods uniformly
  private static readonly MAX_SEARCH_RESULTS = 10;
  private static readonly MAX_CAST = 15;
  private static readonly MAX_TRENDING = 20;
  private static readonly MAX_PERSON_CAST_CREDITS = 20;
  private static readonly MAX_PERSON_CREW_CREDITS = 10;

  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.TMDB_API_KEY ?? "";
  }

  // API key is sent via Authorization header only — never added to query params
  // so it is never captured in debug logs (see tmdbFetch).
  private static imgUrl(path: string | null | undefined, size = "w500"): string | null {
    return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
  }

  getSystemPromptFragment(): string {
    return `You have access to The Movie Database (TMDB) to look up information about movies and film/TV industry people.
Use search_movies to find movies by title or keywords, then get_movie_details for full info.
Use get_movie_credits to find cast and crew, get_movie_recommendations for similar films, and get_trending_movies to see what's popular.
Only use search_person or get_person_details when the conversation is explicitly about someone's film or TV career (e.g. "what movies has X been in?", "who directed X?"). Do NOT use these tools when a person is mentioned in a non-entertainment context.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "search_movies",
        description:
          "Search The Movie Database for movies matching a query. Returns a list of results with titles, release dates, overviews, and IDs.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The movie title or search terms.",
            },
            year: {
              type: "number",
              description: "Optional. Filter results by release year.",
            },
            page: {
              type: "number",
              description: "Optional. Page number for pagination (default: 1).",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_movie_details",
        description:
          "Get detailed information about a specific movie by its TMDB ID. Includes overview, genres, runtime, ratings, budget, revenue, and more.",
        parameters: {
          type: "object",
          properties: {
            movie_id: {
              type: "number",
              description: "The TMDB movie ID.",
            },
          },
          required: ["movie_id"],
        },
      },
      {
        name: "get_movie_credits",
        description:
          "Get the cast and crew for a movie by its TMDB ID. Returns top-billed actors and key crew members (director, writer, etc.).",
        parameters: {
          type: "object",
          properties: {
            movie_id: {
              type: "number",
              description: "The TMDB movie ID.",
            },
          },
          required: ["movie_id"],
        },
      },
      {
        name: "get_movie_recommendations",
        description:
          "Get a list of movies recommended based on a given movie. Useful for finding similar films.",
        parameters: {
          type: "object",
          properties: {
            movie_id: {
              type: "number",
              description: "The TMDB movie ID to base recommendations on.",
            },
            page: {
              type: "number",
              description: "Optional. Page number for pagination (default: 1).",
            },
          },
          required: ["movie_id"],
        },
      },
      {
        name: "search_person",
        description:
          "Search The Movie Database for actors, directors, or other crew members by name. Only use this when the user is explicitly asking about someone's film or TV career. Returns a list of matching people with their known-for credits.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The person's name to search for.",
            },
            page: {
              type: "number",
              description: "Optional. Page number for pagination (default: 1).",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_person_details",
        description:
          "Get detailed information about a specific person by their TMDB ID. Includes biography, birthday, birthplace, and their full movie credits.",
        parameters: {
          type: "object",
          properties: {
            person_id: {
              type: "number",
              description: "The TMDB person ID.",
            },
          },
          required: ["person_id"],
        },
      },
      {
        name: "get_trending_movies",
        description:
          "Get a list of trending movies from TMDB. Can filter by time window (day or week).",
        parameters: {
          type: "object",
          properties: {
            time_window: {
              type: "string",
              enum: ["day", "week"],
              description:
                "The time window for trending: 'day' for today's trends, 'week' for this week's. Defaults to 'week'.",
            },
          },
          required: [],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.apiKey) {
      return { error: "TMDB_API_KEY is not set. Please configure the API key." };
    }

    const dispatch: Record<string, () => Promise<unknown>> = {
      search_movies: () => {
        const query = args.query as string | undefined;
        if (!query || query.trim() === "") {
          return Promise.resolve({ error: "query is required and must be a non-empty string." });
        }
        return this.searchMovies(query, args.year as number | undefined, args.page as number | undefined);
      },
      get_movie_details: () => {
        if (args.movie_id == null) return Promise.resolve({ error: "movie_id is required." });
        return this.getMovieDetails(args.movie_id as number);
      },
      get_movie_credits: () => {
        if (args.movie_id == null) return Promise.resolve({ error: "movie_id is required." });
        return this.getMovieCredits(args.movie_id as number);
      },
      get_movie_recommendations: () => {
        if (args.movie_id == null) return Promise.resolve({ error: "movie_id is required." });
        return this.getMovieRecommendations(args.movie_id as number, args.page as number | undefined);
      },
      get_trending_movies: () =>
        this.getTrendingMovies((args.time_window as "day" | "week" | undefined) ?? "week"),
      search_person: () => {
        const query = args.query as string | undefined;
        if (!query || query.trim() === "") {
          return Promise.resolve({ error: "query is required and must be a non-empty string." });
        }
        return this.searchPerson(query, args.page as number | undefined);
      },
      get_person_details: () => {
        if (args.person_id == null) return Promise.resolve({ error: "person_id is required." });
        return this.getPersonDetails(args.person_id as number);
      },
    };

    const handler = dispatch[name];
    if (!handler) return undefined;

    try {
      return await handler();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("TMDB", `Tool ${name} failed: ${message}`);
      return { error: message };
    }
  }

  // ---------------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------------

  private async tmdbFetch(path: string, params: Record<string, string | number> = {}): Promise<unknown> {
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    // API key is in the Authorization header — not in query params — so it
    // never appears in the debug log below.
    logger.debug("TMDB", `GET ${url.pathname}${url.search}`);

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`TMDB API error ${res.status}: ${text}`);
    }

    return res.json();
  }

  private async searchMovies(query: string, year?: number, page = 1) {
    const params: Record<string, string | number> = { query, page };
    if (year) params.year = year;

    const data = await this.tmdbFetch("/search/movie", params) as Record<string, unknown>;

    return {
      total_results: data.total_results,
      total_pages: data.total_pages,
      page: data.page,
      results: ((data.results as any[]) ?? []).slice(0, TMDBPlugin.MAX_SEARCH_RESULTS).map((m) => ({
        id: m.id,
        title: m.title,
        original_title: m.original_title,
        release_date: m.release_date,
        overview: m.overview,
        vote_average: m.vote_average,
        vote_count: m.vote_count,
        popularity: m.popularity,
        genre_ids: m.genre_ids,
        poster_url: TMDBPlugin.imgUrl(m.poster_path),
      })),
    };
  }

  private async getMovieDetails(movieId: number) {
    const data = await this.tmdbFetch(`/movie/${movieId}`) as Record<string, unknown>;

    return {
      id: data.id,
      title: data.title,
      original_title: data.original_title,
      tagline: data.tagline,
      overview: data.overview,
      release_date: data.release_date,
      runtime: data.runtime,
      status: data.status,
      genres: ((data.genres as any[]) ?? []).map((g) => g.name),
      vote_average: data.vote_average,
      vote_count: data.vote_count,
      popularity: data.popularity,
      budget: data.budget,
      revenue: data.revenue,
      original_language: data.original_language,
      production_companies: ((data.production_companies as any[]) ?? []).map((c) => c.name),
      production_countries: ((data.production_countries as any[]) ?? []).map((c) => c.name),
      spoken_languages: ((data.spoken_languages as any[]) ?? []).map((l) => l.english_name),
      homepage: data.homepage,
      imdb_id: data.imdb_id,
      poster_url: TMDBPlugin.imgUrl(data.poster_path as string | null),
      backdrop_url: TMDBPlugin.imgUrl(data.backdrop_path as string | null, "w1280"),
    };
  }

  private async getMovieCredits(movieId: number) {
    const data = await this.tmdbFetch(`/movie/${movieId}/credits`) as Record<string, unknown>;

    const topCast = ((data.cast as any[]) ?? []).slice(0, TMDBPlugin.MAX_CAST).map((p) => ({
      name: p.name,
      character: p.character,
      order: p.order,
    }));

    const keyCrew = ((data.crew as any[]) ?? [])
      .filter((p) => ["Director", "Writer", "Screenplay", "Story", "Producer", "Executive Producer"].includes(p.job))
      .map((p) => ({
        name: p.name,
        job: p.job,
        department: p.department,
      }));

    return {
      movie_id: movieId,
      cast: topCast,
      crew: keyCrew,
    };
  }

  private async getMovieRecommendations(movieId: number, page = 1) {
    const data = await this.tmdbFetch(`/movie/${movieId}/recommendations`, { page }) as Record<string, unknown>;

    return {
      total_results: data.total_results,
      total_pages: data.total_pages,
      page: data.page,
      results: ((data.results as any[]) ?? []).slice(0, TMDBPlugin.MAX_SEARCH_RESULTS).map((m) => ({
        id: m.id,
        title: m.title,
        release_date: m.release_date,
        overview: m.overview,
        vote_average: m.vote_average,
        popularity: m.popularity,
        poster_url: TMDBPlugin.imgUrl(m.poster_path),
      })),
    };
  }

  private async getTrendingMovies(timeWindow: "day" | "week") {
    const data = await this.tmdbFetch(`/trending/movie/${timeWindow}`) as Record<string, unknown>;

    return {
      time_window: timeWindow,
      results: ((data.results as any[]) ?? []).slice(0, TMDBPlugin.MAX_TRENDING).map((m) => ({
        id: m.id,
        title: m.title,
        release_date: m.release_date,
        overview: m.overview,
        vote_average: m.vote_average,
        popularity: m.popularity,
        media_type: m.media_type,
        poster_url: TMDBPlugin.imgUrl(m.poster_path),
      })),
    };
  }

  private async searchPerson(query: string, page = 1) {
    const data = await this.tmdbFetch("/search/person", { query, page }) as Record<string, unknown>;

    return {
      total_results: data.total_results,
      total_pages: data.total_pages,
      page: data.page,
      results: ((data.results as any[]) ?? []).slice(0, TMDBPlugin.MAX_SEARCH_RESULTS).map((p) => ({
        id: p.id,
        name: p.name,
        known_for_department: p.known_for_department,
        popularity: p.popularity,
        profile_url: TMDBPlugin.imgUrl(p.profile_path, "w185"),
        known_for: ((p.known_for as any[]) ?? []).slice(0, 3).map((m) => ({
          id: m.id,
          title: m.title ?? m.name,
          media_type: m.media_type,
          release_date: m.release_date ?? m.first_air_date,
          poster_url: TMDBPlugin.imgUrl(m.poster_path),
        })),
      })),
    };
  }

  private async getPersonDetails(personId: number) {
    const [details, credits] = await Promise.all([
      this.tmdbFetch(`/person/${personId}`),
      this.tmdbFetch(`/person/${personId}/movie_credits`),
    ]) as [Record<string, unknown>, Record<string, unknown>];

    const castCredits = ((credits.cast as any[]) ?? [])
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, TMDBPlugin.MAX_PERSON_CAST_CREDITS)
      .map((m) => ({
        id: m.id,
        title: m.title,
        character: m.character,
        release_date: m.release_date,
      }));

    const crewCredits = ((credits.crew as any[]) ?? [])
      .filter((m) => ["Director", "Writer", "Screenplay"].includes(m.job))
      .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, TMDBPlugin.MAX_PERSON_CREW_CREDITS)
      .map((m) => ({
        id: m.id,
        title: m.title,
        job: m.job,
        release_date: m.release_date,
      }));

    return {
      id: details.id,
      name: details.name,
      known_for_department: details.known_for_department,
      biography: details.biography,
      birthday: details.birthday,
      deathday: details.deathday,
      place_of_birth: details.place_of_birth,
      popularity: details.popularity,
      also_known_as: details.also_known_as,
      profile_url: TMDBPlugin.imgUrl(details.profile_path as string | null, "w185"),
      cast_credits: castCredits,
      crew_credits: crewCredits,
    };
  }
}
