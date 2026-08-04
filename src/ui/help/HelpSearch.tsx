import { useState, useMemo } from "react";
import Fuse from "fuse.js";

export interface HelpArticle {
  title: string;
  description: string;
  tags: string[];
  slug: string;
  section: string;
}

interface Props {
  articles: HelpArticle[];
}

export default function HelpSearch({ articles }: Props) {
  const [query, setQuery] = useState("");

  const fuse = useMemo(
    () =>
      new Fuse(articles, {
        keys: ["title", "description", "tags"],
        threshold: 0.35,
        minMatchCharLength: 2,
      }),
    [articles]
  );

  const results = query.length >= 2 ? fuse.search(query).map((r) => r.item) : [];
  const isSearching = query.length >= 2;

  return (
    <div className="help-search">
      <div className="help-search-bar">
        <svg className="help-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          placeholder="Search help articles…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="help-search-input"
          aria-label="Search help articles"
        />
        {query && (
          <button
            className="help-search-clear"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      {isSearching && (
        <div className="help-search-results">
          {results.length === 0 ? (
            <p className="help-search-empty">No results for "{query}"</p>
          ) : (
            <ul className="help-search-list">
              {results.map((article) => (
                <li key={article.slug} className="help-search-item">
                  <a href={`/help/${article.slug}`} className="help-search-link">
                    <span className="help-search-title">{article.title}</span>
                    <span className="help-search-desc">{article.description}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
