CREATE TABLE USERS (
  id            TEXT NOT NULL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  email         TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE POSTS (
  id         TEXT NOT NULL PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES USERS(id),
  content    TEXT NOT NULL,
  image_url  TEXT,
  latitude   REAL,
  longitude  REAL,
  status     TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE POST_EVALUATIONS (
  id              TEXT NOT NULL PRIMARY KEY,
  post_id         TEXT NOT NULL REFERENCES POSTS(id),
  user_id         TEXT NOT NULL REFERENCES USERS(id),
  evaluation_type TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE(post_id, user_id)
);

CREATE TABLE NOTIFICATIONS (
  id           TEXT NOT NULL PRIMARY KEY,
  sender_id    TEXT NOT NULL REFERENCES USERS(id),
  recipient_id TEXT NOT NULL REFERENCES USERS(id),
  status       TEXT NOT NULL,
  sent_at      TEXT NOT NULL
);

CREATE TABLE CONNECTIONS (
  id           TEXT NOT NULL PRIMARY KEY,
  requester_id TEXT NOT NULL REFERENCES USERS(id),
  recipient_id TEXT NOT NULL REFERENCES USERS(id),
  status       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  responded_at TEXT,
  UNIQUE(requester_id, recipient_id)
);

CREATE TABLE REFRESH_TOKENS (
  id         TEXT    NOT NULL PRIMARY KEY,
  user_id    TEXT    NOT NULL REFERENCES USERS(id),
  token_hash TEXT    NOT NULL UNIQUE,
  expires_at TEXT    NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);

CREATE TABLE STRUCTURES (
  id        TEXT NOT NULL PRIMARY KEY,
  name      TEXT NOT NULL,
  type      TEXT NOT NULL,
  latitude  REAL NOT NULL,
  longitude REAL NOT NULL
);

CREATE INDEX idx_posts_user_id           ON POSTS(user_id);
CREATE INDEX idx_post_evals_post_id      ON POST_EVALUATIONS(post_id);
CREATE INDEX idx_notifications_recipient ON NOTIFICATIONS(recipient_id);
CREATE INDEX idx_connections_requester   ON CONNECTIONS(requester_id);
CREATE INDEX idx_connections_recipient   ON CONNECTIONS(recipient_id);
CREATE INDEX idx_refresh_tokens_user_id  ON REFRESH_TOKENS(user_id);
CREATE INDEX idx_refresh_tokens_hash     ON REFRESH_TOKENS(token_hash);
