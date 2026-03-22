import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

function imgUrl(path: string | null | undefined, size = "w500"): string | null {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : null;
}

export class TMDBPlugin implements AgentPlugin {
  name = "TMDB";

  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.TMDB_API_KEY ?? "";
  }

  getSystemPromptFragment(): string {
    return `You have access to The Movie Database (TMDB) to look up information about movies and people.
Use search_movies to find movies by title or keywords, then get_movie_details for full info.
Use get_movie_credits to find cast and crew, get_movie_recommendations for similar films, and get_trending_movies to see what's popular.
Use search_person to find actors or crew members by name, then get_person_details for their biography, birthday, and full filmography.`;
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
          "Search The Movie Database for actors, directors, or other crew members by name. Returns a list of matching people with their known-for credits.",
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

  async executeTool(name: string, args: any): Promise<any> {
    if (!this.apiKey) {
      return { error: "TMDB_API_KEY is not set. Please configure the API key." };
    }

    if (name === "search_movies") {
      return this.searchMovies(args.query, args.year, args.page);
    }

    if (name === "get_movie_details") {
      return this.getMovieDetails(args.movie_id);
    }

    if (name === "get_movie_credits") {
      return this.getMovieCredits(args.movie_id);
    }

    if (name === "get_movie_recommendations") {
      return this.getMovieRecommendations(args.movie_id, args.page);
    }

    if (name === "get_trending_movies") {
      return this.getTrendingMovies(args.time_window ?? "week");
    }

    if (name === "search_person") {
      return this.searchPerson(args.query, args.page);
    }

    if (name === "get_person_details") {
      return this.getPersonDetails(args.person_id);
    }
  }

  // ---------------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------------

  private async tmdbFetch(path: string, params: Record<string, string | number> = {}): Promise<any> {
    const url = new URL(`${TMDB_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

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

    const data = await this.tmdbFetch("/search/movie", params);

    return {
      total_results: data.total_results,
      total_pages: data.total_pages,
      page: data.page,
      results: (data.results ?? []).slice(0, 10).map((m: any) => ({
        id: m.id,
        title: m.title,
        original_title: m.original_title,
        release_date: m.release_date,
        overview: m.overview,
        vote_average: m.vote_average,
        vote_count: m.vote_count,
        popularity: m.popularity,
        genre_ids: m.genre_ids,
        poster_url: imgUrl(m.poster_path),
      })),
    };
  }

  private async getMovieDetails(movieId: number) {
    const data = await this.tmdbFetch(`/movie/${movieId}`);

    return {
      id: data.id,
      title: data.title,
      original_title: data.original_title,
      tagline: data.tagline,
      overview: data.overview,
      release_date: data.release_date,
      runtime: data.runtime,
      status: data.status,
      genres: (data.genres ?? []).map((g: any) => g.name),
      vote_average: data.vote_average,
      vote_count: data.vote_count,
      popularity: data.popularity,
      budget: data.budget,
      revenue: data.revenue,
      original_language: data.original_language,
      production_companies: (data.production_companies ?? []).map((c: any) => c.name),
      production_countries: (data.production_countries ?? []).map((c: any) => c.name),
      spoken_languages: (data.spoken_languages ?? []).map((l: any) => l.english_name),
      homepage: data.homepage,
      imdb_id: data.imdb_id,
      poster_url: imgUrl(data.poster_path),
      backdrop_url: imgUrl(data.backdrop_path, "w1280"),
    };
  }

  private async getMovieCredits(movieId: number) {
    const data = await this.tmdbFetch(`/movie/${movieId}/credits`);

    const topCast = (data.cast ?? []).slice(0, 15).map((p: any) => ({
      name: p.name,
      character: p.character,
      order: p.order,
    }));

    const keyCrew = (data.crew ?? [])
      .filter((p: any) => ["Director", "Writer", "Screenplay", "Story", "Producer", "Executive Producer"].includes(p.job))
      .map((p: any) => ({
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
    const data = await this.tmdbFetch(`/movie/${movieId}/recommendations`, { page });

    return {
      total_results: data.total_results,
      total_pages: data.total_pages,
      page: data.page,
      results: (data.results ?? []).slice(0, 10).map((m: any) => ({
        id: m.id,
        title: m.title,
        release_date: m.release_date,
        overview: m.overview,
        vote_average: m.vote_average,
        popularity: m.popularity,
        poster_url: imgUrl(m.poster_path),
      })),
    };
  }

  private async getTrendingMovies(timeWindow: "day" | "week") {
    const data = await this.tmdbFetch(`/trending/movie/${timeWindow}`);

    return {
      time_window: timeWindow,
      results: (data.results ?? []).slice(0, 20).map((m: any) => ({
        id: m.id,
        title: m.title,
        release_date: m.release_date,
        overview: m.overview,
        vote_average: m.vote_average,
        popularity: m.popularity,
        media_type: m.media_type,
        poster_url: imgUrl(m.poster_path),
      })),
    };
  }

  private async searchPerson(query: string, page = 1) {
    const data = await this.tmdbFetch("/search/person", { query, page });

    return {
      total_results: data.total_results,
      total_pages: data.total_pages,
      page: data.page,
      results: (data.results ?? []).slice(0, 10).map((p: any) => ({
        id: p.id,
        name: p.name,
        known_for_department: p.known_for_department,
        popularity: p.popularity,
        profile_url: imgUrl(p.profile_path, "w185"),
        known_for: (p.known_for ?? []).slice(0, 3).map((m: any) => ({
          id: m.id,
          title: m.title ?? m.name,
          media_type: m.media_type,
          release_date: m.release_date ?? m.first_air_date,
          poster_url: imgUrl(m.poster_path),
        })),
      })),
    };
  }

  private async getPersonDetails(personId: number) {
    const [details, credits] = await Promise.all([
      this.tmdbFetch(`/person/${personId}`),
      this.tmdbFetch(`/person/${personId}/movie_credits`),
    ]);

    const castCredits = (credits.cast ?? [])
      .sort((a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, 20)
      .map((m: any) => ({
        id: m.id,
        title: m.title,
        character: m.character,
        release_date: m.release_date,
      }));

    const crewCredits = (credits.crew ?? [])
      .filter((m: any) => ["Director", "Writer", "Screenplay"].includes(m.job))
      .sort((a: any, b: any) => (b.popularity ?? 0) - (a.popularity ?? 0))
      .slice(0, 10)
      .map((m: any) => ({
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
      profile_url: imgUrl(details.profile_path, "w185"),
      cast_credits: castCredits,
      crew_credits: crewCredits,
    };
  }
}
