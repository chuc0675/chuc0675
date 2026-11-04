-- Svara: boshlang'ich sxema
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id         INTEGER NOT NULL UNIQUE,
  username      TEXT,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT,
  photo_url     TEXT,
  language      TEXT,
  balance       INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  xp            INTEGER NOT NULL DEFAULT 0,
  games_played  INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  losses        INTEGER NOT NULL DEFAULT 0,
  net_won       INTEGER NOT NULL DEFAULT 0,
  biggest_win   INTEGER NOT NULL DEFAULT 0,
  is_banned     INTEGER NOT NULL DEFAULT 0,
  ban_reason    TEXT,
  last_bonus_at INTEGER,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE rooms (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  is_private  INTEGER NOT NULL DEFAULT 0,
  ante        INTEGER NOT NULL,
  max_players INTEGER NOT NULL,
  fill_bots   INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id),
  status      TEXT NOT NULL DEFAULT 'open',
  created_at  INTEGER NOT NULL,
  closed_at   INTEGER
);

-- Stolga band qilingan chiplar (balansdan ajratilgan). Server qayta ishga tushsa qaytariladi.
CREATE TABLE room_seats (
  room_id   TEXT NOT NULL REFERENCES rooms(id),
  user_id   INTEGER NOT NULL UNIQUE REFERENCES users(id),
  stack     INTEGER NOT NULL CHECK (stack >= 0),
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id)
);

CREATE TABLE games (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id     TEXT NOT NULL REFERENCES rooms(id),
  hand_no     INTEGER NOT NULL,
  ante        INTEGER NOT NULL,
  pot         INTEGER NOT NULL DEFAULT 0,
  result_type TEXT,
  svara_rounds INTEGER NOT NULL DEFAULT 0,
  rules_json  TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX idx_games_room ON games(room_id);

CREATE TABLE game_players (
  game_id      INTEGER NOT NULL REFERENCES games(id),
  seat         INTEGER NOT NULL,
  user_id      INTEGER REFERENCES users(id),
  npc_name     TEXT,
  stack_before INTEGER NOT NULL,
  stack_after  INTEGER NOT NULL,
  delta        INTEGER NOT NULL,
  score        INTEGER,
  cards        TEXT,
  is_winner    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game_id, seat)
);
CREATE INDEX idx_game_players_user ON game_players(user_id);

CREATE TABLE game_actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id     INTEGER NOT NULL REFERENCES games(id),
  seq         INTEGER NOT NULL,
  player_ref  TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id),
  svara_round INTEGER NOT NULL DEFAULT 0,
  type        TEXT NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 0,
  to_amount   INTEGER,
  forced      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_game_actions_game ON game_actions(game_id);

CREATE TABLE transactions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  type            TEXT NOT NULL,      -- signup | bonus | buyin | cashout | refund | admin
  amount          INTEGER NOT NULL,   -- balansga ta'sir (+/-)
  balance_after   INTEGER NOT NULL,
  ref_type        TEXT,
  ref_id          TEXT,
  idempotency_key TEXT UNIQUE,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_transactions_user ON transactions(user_id);

CREATE TABLE reports (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  reporter_id    INTEGER NOT NULL REFERENCES users(id),
  target_user_id INTEGER REFERENCES users(id),
  room_id        TEXT,
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open',
  created_at     INTEGER NOT NULL
);

CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  details    TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_created ON audit_log(created_at);
