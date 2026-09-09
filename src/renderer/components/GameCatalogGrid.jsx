import React, { useMemo } from 'react';
import { filterGameCatalog, gameMark } from '../lib/games.js';
import { GameIcon, hasGameIcon } from './icons.jsx';

export default function GameCatalogGrid({
  catalog,
  selected,
  onSelect,
  query,
  onQueryChange,
  className = '',
}) {
  const visible = useMemo(() => filterGameCatalog(catalog, query), [catalog, query]);

  function activate(name) {
    onSelect(name);
  }

  return (
    <div className={className}>
      <div className="field game-search-field">
        <input
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search games…"
          aria-label="Search games"
        />
      </div>
      {visible.length === 0 ? (
        <div className="game-search-empty">No games match that search.</div>
      ) : (
        visible.map((group) => (
          <div className="game-group" key={group.category}>
            <div className="game-group-label">{group.category}</div>
            <div className="game-grid">
              {group.games.map((game) => (
                <div
                  key={game}
                  role="button"
                  tabIndex={0}
                  className={`game-card ${selected === game ? 'selected' : ''}`}
                  onClick={() => activate(game)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      activate(game);
                    }
                  }}
                >
                  <div className={`game-icon ${hasGameIcon(game) ? 'game-icon-svg' : ''}`}>
                    {hasGameIcon(game) ? <GameIcon game={game} /> : gameMark(game)}
                  </div>
                  <div className="game-name">{game}</div>
                  <div className="game-cat">{group.category}</div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
