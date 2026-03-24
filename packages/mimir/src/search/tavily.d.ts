// Ambient type declarations for @tavily/core (optional dependency)
declare module '@tavily/core' {
  interface TavilySearchResult {
    title?: string;
    url?: string;
    content?: string;
    score?: number;
  }

  interface TavilySearchResponse {
    results: TavilySearchResult[];
    query?: string;
    answer?: string;
  }

  interface TavilySearchOptions {
    searchDepth?: 'basic' | 'advanced';
    topic?: 'general' | 'news' | 'finance';
    maxResults?: number;
    includeAnswer?: boolean | 'basic' | 'advanced';
    includeRawContent?: boolean | 'markdown' | 'text';
    includeImages?: boolean;
    timeRange?: 'day' | 'week' | 'month' | 'year';
    includeDomains?: string[];
    excludeDomains?: string[];
  }

  interface TavilyClient {
    search(query: string, options?: TavilySearchOptions): Promise<TavilySearchResponse>;
  }

  interface TavilyConfig {
    apiKey: string;
    projectId?: string;
  }

  export function tavily(config: TavilyConfig): TavilyClient;
}
