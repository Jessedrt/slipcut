-- Telegram webhook de-duplication. Serverless retries and cold starts mean the
-- same update_id can arrive twice; one row per handled update.
create table if not exists desk_updates (
  update_id bigint primary key,
  seen_at timestamptz not null default now()
);
