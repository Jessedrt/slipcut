create table if not exists pending_reviews (
  token text primary key,
  chat_id text not null,
  title text not null,
  picks_json text not null
);
