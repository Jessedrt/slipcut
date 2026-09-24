create table if not exists telegram_build_drafts (
  chat_id text primary key,
  draft_json text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists telegram_build_drafts_expiry_idx
  on telegram_build_drafts (expires_at);

create table if not exists miniapp_booking_requests (
  telegram_user_id text not null,
  request_id text not null,
  request_hash text not null,
  status text not null default 'pending',
  response_json text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (telegram_user_id, request_id)
);

create index if not exists miniapp_booking_requests_updated_idx
  on miniapp_booking_requests (updated_at desc);
