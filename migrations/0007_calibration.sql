-- Self-calibration: remember what the desk predicted, then score it against
-- what actually landed. `desk_predictions` is the training set for the Platt
-- scaler applied to every probability the bot prints.
create table if not exists desk_predictions (
  id serial primary key,
  code text not null,
  pick_key text not null,
  family text not null default '',
  league text not null default '',
  sport text not null default '',
  odds real,
  market_p real,
  model_p real,
  final_p real not null,
  result text,
  created_at timestamptz not null default now()
);

create index if not exists desk_predictions_code_idx on desk_predictions (code);
create index if not exists desk_predictions_result_idx on desk_predictions (result);
create unique index if not exists desk_predictions_uniq on desk_predictions (code, pick_key);

-- Telegram webhook de-duplication. Serverless retries and cold starts mean the
-- same update_id can arrive twice; one row per handled update.
create table if not exists desk_updates (
  update_id bigint primary key,
  seen_at timestamptz not null default now()
);
