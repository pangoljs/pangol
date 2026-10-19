CREATE TABLE app_users (
  id uuid PRIMARY KEY,
  issuer text NOT NULL,
  subject text NOT NULL,
  UNIQUE (issuer, subject)
);
CREATE TABLE posts (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES app_users(id),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  internal_note text NOT NULL DEFAULT 'server-only'
);
CREATE INDEX posts_owner_id ON posts(owner_id);
CREATE TABLE post_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  post_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES app_users(id),
  action text NOT NULL CHECK (action = 'created')
);
