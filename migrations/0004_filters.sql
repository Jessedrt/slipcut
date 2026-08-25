create table if not exists desk_blocks (
  value text primary key,
  created_at timestamptz not null default now()
);

create table if not exists desk_settings (
  key text primary key,
  value text not null
);
