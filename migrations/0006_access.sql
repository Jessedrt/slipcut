create table if not exists desk_access (
  user_id text primary key,
  username text not null default '',
  role text not null default 'guest'
);
