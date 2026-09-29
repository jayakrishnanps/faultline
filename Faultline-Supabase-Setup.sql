-- FAULTLINE | Supabase initial migration | 2026-09-26
-- Validation: 51 checks passed on PostgreSQL 18.3 through PGlite, with Supabase
-- auth.users/auth.uid()/roles simulated. Not executed in your hosted project.
-- Run this ENTIRE file once in a NEW Supabase project's SQL Editor as postgres.
-- No placeholder values, extensions, passwords, API keys, or paid features needed.
-- This transaction creates tables; it does not create a Supabase project, configure
-- GitHub OAuth, install a GitHub App, schedule a worker, or perform source analysis.
-- A second run intentionally fails without changing the existing database.
-- Do NOT delete existing tables to make this script run in an existing application.
--
-- CLIENT CONTRACT
-- authenticated: read own active installation/repository data; no direct writes.
-- anon: read explicitly published, sanitized public_demo_reports only.
-- service_role: trusted server writes and worker RPCs; NEVER use in a browser.
-- Browser mutations go through authenticated Next.js endpoints, which must check
-- ownership before using the administrative Supabase client (it bypasses RLS).
-- profiles.github_user_id must be set by the server from verified GitHub identity,
-- never copied from editable auth.users.raw_user_meta_data.
--
-- GRAPH CONTRACT
-- A graph_snapshot belongs to one repository + immutable commit SHA + index version.
-- source_files/dependency_edges are editable only while snapshot.status='indexing'.
-- Set status='ready' only after writing/validating the entire snapshot. Ready
-- snapshots cannot be updated. Failed/incomplete snapshots can be retried in place.
-- Analyses retain both head and baseline snapshot IDs. Base evidence and head
-- evidence are separate; never invent paths by combining edges across revisions.
-- Analysis nodes/paths copy report metadata so old reports survive file changes.
-- Test associations are evidence/heuristics, NOT measured test coverage.
-- Score calculation, JSON evidence validation, and latest-head checks are server jobs.
--
-- JOB CONTRACT
-- Verify GitHub's RAW BODY signature in Next.js BEFORE calling record_webhook_and_job.
-- That RPC atomically stores the delivery and its optional deduplicated job.
-- claim_job returns a job with lease_token; pass that token to heartbeat_job and
-- finish_job. Expired workers cannot heartbeat/finish a newer worker's lease.
-- Repeated webhook delivery returns the same job; use retry_job for failed work.
-- after() or another server invocation must actually run the worker. SQL does not
-- automatically execute HTTP requests or wake jobs when next_attempt_at arrives.
-- Before report/comment publication, server must verify current PR head and lease.
-- GitHub comment create/update is an external side effect: serialize per PR in the
-- server and recover by bot author + hidden marker if comment creation was interrupted.
--
-- All timestamps use timestamptz; GitHub numeric IDs use bigint; internal IDs use UUID.
-- No raw source code, raw webhook body, access tokens, or private keys are stored.
-- Keep JSON fields to sanitized structural metadata and bounded error descriptions.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

create schema faultline_private;
revoke all on schema faultline_private from public, anon, authenticated;
grant usage on schema faultline_private to authenticated, anon, service_role;

create table public.faultline_schema_version (
  version integer primary key check (version > 0),
  description text not null,
  installed_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  github_user_id bigint unique check (github_user_id > 0),
  github_login text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.github_installations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  github_installation_id bigint not null unique check (github_installation_id > 0),
  github_account_id bigint not null check (github_account_id > 0),
  account_login text not null check (length(account_login) between 1 and 100),
  account_type text not null check (account_type in ('User','Organization')),
  repository_selection text not null default 'selected'
    check (repository_selection in ('selected','all')),
  permissions jsonb not null default '{}'::jsonb check (jsonb_typeof(permissions)='object'),
  suspended_at timestamptz,
  deleted_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index github_installations_user_idx on public.github_installations(user_id);

create table public.repositories (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.github_installations(id) on delete cascade,
  github_repository_id bigint not null unique check (github_repository_id > 0),
  owner text not null,
  name text not null,
  default_branch text not null default 'main',
  private boolean not null default true,
  html_url text,
  access_removed_at timestamptz,
  index_status text not null default 'not_indexed'
    check (index_status in ('not_indexed','queued','indexing','ready','partial','failed','too_large')),
  last_indexed_sha text check (last_indexed_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  last_indexed_at timestamptz,
  last_error text check (length(last_error) <= 2000),
  -- Settings are changed via authenticated server endpoints, not direct client writes.
  traversal_depth smallint not null default 4 check (traversal_depth between 1 and 12),
  max_source_files integer not null default 300 check (max_source_files between 1 and 1000),
  max_changed_files integer not null default 100 check (max_changed_files between 1 and 500),
  max_file_bytes integer not null default 256000 check (max_file_bytes between 1024 and 1048576),
  max_total_source_bytes integer not null default 10485760
    check (max_total_source_bytes between 1024 and 52428800),
  sensitive_path_rules jsonb not null
    default '["**/auth/**","**/payments/**","**/middleware.*","**/proxy.*","**/migrations/**"]'::jsonb
    check (jsonb_typeof(sensitive_path_rules)='array'),
  configuration_version integer not null default 1 check (configuration_version > 0),
  ai_enabled boolean not null default false,
  ai_private_metadata_opt_in boolean not null default false,
  ai_score_threshold smallint not null default 50 check (ai_score_threshold between 0 and 100),
  is_public_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, installation_id),
  check (not is_public_demo or not private),
  check (not (private and ai_enabled) or ai_private_metadata_opt_in)
);
create index repositories_installation_idx on public.repositories(installation_id);

create table public.graph_snapshots (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories(id) on delete cascade,
  commit_sha text not null check (commit_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  -- index_version includes parser/resolver/classification configuration changes.
  index_version text not null default 'v1',
  status text not null default 'indexing' check (status in ('indexing','ready','failed')),
  files_total integer not null default 0 check (files_total >= 0),
  files_parsed integer not null default 0 check (files_parsed >= 0),
  files_failed integer not null default 0 check (files_failed >= 0),
  files_skipped integer not null default 0 check (files_skipped >= 0),
  imports_resolved integer not null default 0 check (imports_resolved >= 0),
  imports_unresolved integer not null default 0 check (imports_unresolved >= 0),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings)='array'),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (repository_id, commit_sha, index_version),
  unique (id, repository_id),
  check (files_parsed + files_failed + files_skipped <= files_total),
  check (status <> 'ready' or completed_at is not null)
);

create table public.source_files (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null,
  snapshot_id uuid not null,
  path text not null check (length(path) between 1 and 4096 and left(path,1) <> '/'),
  language text not null default 'typescript'
    check (language in ('typescript','javascript','json','other')),
  file_type text not null default 'module'
    check (file_type in ('module','page','api_route','layout','middleware','test','config','job','other')),
  content_sha text not null check (content_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  size_bytes integer not null default 0 check (size_bytes >= 0),
  is_entry_point boolean not null default false,
  is_test boolean not null default false,
  route_path text,
  parse_status text not null default 'parsed' check (parse_status in ('parsed','failed','skipped')),
  parse_error text check (length(parse_error) <= 2000),
  -- Cache syntax, not source: specifier, edge type, source line, type-only flag.
  imports jsonb not null default '[]'::jsonb check (jsonb_typeof(imports)='array'),
  unresolved_imports jsonb not null default '[]'::jsonb check (jsonb_typeof(unresolved_imports)='array'),
  exported_names jsonb not null default '[]'::jsonb check (jsonb_typeof(exported_names)='array'),
  created_at timestamptz not null default now(),
  unique (snapshot_id, path),
  unique (id, snapshot_id, repository_id),
  foreign key (snapshot_id, repository_id)
    references public.graph_snapshots(id, repository_id) on delete cascade
);
create index source_files_cache_idx on public.source_files(repository_id, content_sha);

create table public.dependency_edges (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null,
  snapshot_id uuid not null,
  from_file_id uuid not null,
  to_file_id uuid not null,
  edge_type text not null default 'static_import'
    check (edge_type in ('static_import','dynamic_import','re_export','require')),
  is_type_only boolean not null default false,
  source_line integer not null default 1 check (source_line > 0),
  import_specifier text not null,
  unique (snapshot_id, from_file_id, to_file_id, edge_type, source_line, is_type_only),
  foreign key (snapshot_id, repository_id)
    references public.graph_snapshots(id, repository_id) on delete cascade,
  foreign key (from_file_id, snapshot_id, repository_id)
    references public.source_files(id, snapshot_id, repository_id) on delete cascade,
  foreign key (to_file_id, snapshot_id, repository_id)
    references public.source_files(id, snapshot_id, repository_id) on delete cascade
);
create index dependency_edges_reverse_idx on public.dependency_edges(snapshot_id, to_file_id);
create index dependency_edges_from_fk_idx on public.dependency_edges(from_file_id, snapshot_id, repository_id);
create index dependency_edges_to_fk_idx on public.dependency_edges(to_file_id, snapshot_id, repository_id);

create table public.pull_requests (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null references public.repositories(id) on delete cascade,
  github_pr_number integer not null check (github_pr_number > 0),
  title text not null,
  author_login text not null,
  head_sha text not null check (head_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  base_sha text not null check (base_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  head_ref text,
  base_ref text,
  head_repository_full_name text,
  state text not null default 'open' check (state in ('open','closed','merged')),
  draft boolean not null default false,
  html_url text not null,
  opened_at timestamptz not null default now(),
  github_updated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (repository_id, github_pr_number),
  unique (id, repository_id)
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  repository_id uuid not null,
  pull_request_id uuid not null,
  head_sha text not null check (head_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  base_sha text not null check (base_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  comparison_base_sha text check (comparison_base_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  analyzer_version text not null default 'v1',
  configuration_version integer not null default 1 check (configuration_version > 0),
  -- Exact settings actually used; do not read today's settings when displaying history.
  settings_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(settings_snapshot)='object'),
  head_snapshot_id uuid,
  base_snapshot_id uuid,
  status text not null default 'queued'
    check (status in ('queued','indexing','analyzing','complete','partial','failed','superseded','cancelled')),
  stage text not null default 'queued',
  progress smallint not null default 0 check (progress between 0 and 100),
  publishing_status text not null default 'pending'
    check (publishing_status in ('pending','publishing','published','failed','skipped')),
  impact_score smallint check (impact_score between 0 and 100),
  changed_count integer not null default 0 check (changed_count >= 0),
  direct_count integer not null default 0 check (direct_count >= 0),
  indirect_count integer not null default 0 check (indirect_count >= 0),
  reachable_count integer not null default 0 check (reachable_count >= 0),
  entry_point_count integer not null default 0 check (entry_point_count >= 0),
  test_count integer not null default 0 check (test_count >= 0),
  test_gap_count integer not null default 0 check (test_gap_count >= 0),
  files_total integer not null default 0 check (files_total >= 0),
  files_parsed integer not null default 0 check (files_parsed >= 0),
  files_failed integer not null default 0 check (files_failed >= 0),
  imports_resolved integer not null default 0 check (imports_resolved >= 0),
  imports_unresolved integer not null default 0 check (imports_unresolved >= 0),
  traversal_truncated boolean not null default false,
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings)='array'),
  previous_analysis_id uuid,
  delta jsonb not null default '{}'::jsonb check (jsonb_typeof(delta)='object'),
  error_code text,
  error_message text check (length(error_message) <= 2000),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pull_request_id, head_sha, base_sha, analyzer_version, configuration_version),
  unique (id, repository_id),
  unique (id, pull_request_id, repository_id),
  foreign key (pull_request_id, repository_id)
    references public.pull_requests(id, repository_id) on delete cascade,
  foreign key (head_snapshot_id, repository_id)
    references public.graph_snapshots(id, repository_id) deferrable initially deferred,
  foreign key (base_snapshot_id, repository_id)
    references public.graph_snapshots(id, repository_id) deferrable initially deferred,
  foreign key (previous_analysis_id, pull_request_id, repository_id)
    references public.analyses(id, pull_request_id, repository_id) deferrable initially deferred,
  check (previous_analysis_id is distinct from id),
  check (files_parsed + files_failed <= files_total),
  check (test_gap_count <= entry_point_count),
  check (status not in ('complete','partial') or
    (completed_at is not null and impact_score is not null and head_snapshot_id is not null))
);
create index analyses_repository_time_idx on public.analyses(repository_id, created_at desc);
create index analyses_pr_history_idx on public.analyses(pull_request_id, created_at desc);
create index analyses_head_snapshot_idx on public.analyses(head_snapshot_id, repository_id);
create index analyses_base_snapshot_idx on public.analyses(base_snapshot_id, repository_id);
create index analyses_previous_idx on public.analyses(previous_analysis_id, pull_request_id, repository_id);

create table public.analysis_changes (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null,
  repository_id uuid not null,
  path text not null,
  previous_path text,
  change_type text not null check (change_type in ('added','modified','removed','renamed','copied','changed','unchanged')),
  additions integer not null default 0 check (additions >= 0),
  deletions integer not null default 0 check (deletions >= 0),
  is_supported boolean not null default true,
  skip_reason text,
  unique (analysis_id, path),
  foreign key (analysis_id, repository_id) references public.analyses(id, repository_id) on delete cascade,
  check (change_type <> 'renamed' or previous_path is not null)
);

create table public.analysis_nodes (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null,
  repository_id uuid not null,
  graph_side text not null default 'head' check (graph_side in ('head','base')),
  path text not null check (length(path) between 1 and 4096),
  file_type text not null,
  distance smallint not null check (distance between 0 and 100),
  is_changed boolean not null default false,
  is_entry_point boolean not null default false,
  is_test boolean not null default false,
  is_sensitive boolean not null default false,
  route_path text,
  owners text[] not null default '{}',
  reason text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  unique (analysis_id, graph_side, path),
  unique (id, analysis_id, repository_id),
  foreign key (analysis_id, repository_id) references public.analyses(id, repository_id) on delete cascade
);

create table public.impact_paths (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null,
  repository_id uuid not null,
  target_node_id uuid not null,
  graph_side text not null default 'head' check (graph_side in ('head','base')),
  path_type text not null default 'shortest' check (path_type in ('shortest','entry_point','test','sensitive')),
  -- JSON array of filenames, ordered changed-file -> target; no raw source.
  path_json jsonb not null check (jsonb_typeof(path_json)='array' and jsonb_array_length(path_json) > 0),
  path_length integer generated always as (jsonb_array_length(path_json)-1) stored,
  evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence)='array'),
  unique (analysis_id, target_node_id, path_type),
  foreign key (analysis_id, repository_id) references public.analyses(id, repository_id) on delete cascade,
  foreign key (target_node_id, analysis_id, repository_id)
    references public.analysis_nodes(id, analysis_id, repository_id) on delete cascade
);
create index impact_paths_target_idx on public.impact_paths(target_node_id, analysis_id, repository_id);

create table public.analysis_test_associations (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null,
  repository_id uuid not null,
  target_node_id uuid not null,
  test_path text not null,
  graph_side text not null default 'head' check (graph_side in ('head','base')),
  association_type text not null check (association_type in ('dependency_path','filename','proximity')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  unique (analysis_id, target_node_id, test_path, association_type),
  foreign key (analysis_id, repository_id) references public.analyses(id, repository_id) on delete cascade,
  foreign key (target_node_id, analysis_id, repository_id)
    references public.analysis_nodes(id, analysis_id, repository_id) on delete cascade
);
create index test_associations_target_idx on public.analysis_test_associations(target_node_id, analysis_id, repository_id);

create table public.analysis_score_factors (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null,
  repository_id uuid not null,
  factor_key text not null,
  label text not null,
  points integer not null check (points between 0 and 100),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  unique (analysis_id, factor_key),
  foreign key (analysis_id, repository_id) references public.analyses(id, repository_id) on delete cascade
);

create table public.webhook_deliveries (
  delivery_id uuid primary key,
  event_type text not null,
  action text,
  -- Minimal allowlisted IDs/action/SHAs only. Not GitHub's entire request body.
  event_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(event_summary)='object'),
  status text not null default 'accepted' check (status in ('accepted','ignored','queued','complete','failed')),
  job_id uuid,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid references public.github_installations(id) on delete cascade,
  repository_id uuid references public.repositories(id) on delete cascade,
  analysis_id uuid,
  job_type text not null check (job_type in ('sync_installation','index_repository','analyze_pr','publish_comment')),
  dedupe_key text not null unique check (length(dedupe_key) between 1 and 500),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  status text not null default 'queued' check (status in ('queued','running','retrying','complete','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 4 check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  worker_id text,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error text check (length(last_error) <= 2000),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (analysis_id, repository_id) references public.analyses(id, repository_id) on delete cascade,
  foreign key (repository_id, installation_id) references public.repositories(id, installation_id) on delete cascade,
  check (job_type = 'sync_installation' or repository_id is not null),
  check (job_type not in ('analyze_pr','publish_comment') or analysis_id is not null),
  check (analysis_id is null or repository_id is not null),
  check ((status='running' and worker_id is not null and lease_token is not null and lease_expires_at is not null)
      or (status<>'running' and worker_id is null and lease_token is null and lease_expires_at is null))
);
create index jobs_due_idx on public.jobs(next_attempt_at, created_at) where status in ('queued','retrying');
create index jobs_lease_idx on public.jobs(lease_expires_at) where status='running';
create index jobs_analysis_idx on public.jobs(analysis_id, repository_id);
create index jobs_repository_idx on public.jobs(repository_id, installation_id);
create index jobs_installation_idx on public.jobs(installation_id);
alter table public.webhook_deliveries add constraint webhook_job_fk
  foreign key (job_id) references public.jobs(id) on delete set null;
create index webhook_deliveries_job_idx on public.webhook_deliveries(job_id);
create index webhook_deliveries_received_idx on public.webhook_deliveries(received_at);

create table public.github_comments (
  pull_request_id uuid primary key,
  repository_id uuid not null,
  github_comment_id bigint unique check (github_comment_id > 0),
  last_analysis_id uuid,
  last_published_head_sha text check (last_published_head_sha ~ '^([0-9a-f]{40}|[0-9a-f]{64})$'),
  body_hash text,
  publish_status text not null default 'pending' check (publish_status in ('pending','publishing','published','failed')),
  last_error text check (length(last_error) <= 2000),
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (pull_request_id, repository_id) references public.pull_requests(id, repository_id) on delete cascade,
  foreign key (last_analysis_id, pull_request_id, repository_id)
    references public.analyses(id, pull_request_id, repository_id) deferrable initially deferred
);
create index github_comments_analysis_idx on public.github_comments(last_analysis_id, pull_request_id, repository_id);

create table public.ai_explanations (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null,
  repository_id uuid not null,
  explanation_version text not null default 'v1',
  status text not null default 'pending' check (status in ('pending','complete','fallback','disabled')),
  provider text not null default 'template' check (provider in ('template','gemini')),
  model text,
  summary text,
  highest_risk_path jsonb check (highest_risk_path is null or jsonb_typeof(highest_risk_path)='array'),
  reviewer_question text,
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (analysis_id, explanation_version),
  foreign key (analysis_id, repository_id) references public.analyses(id, repository_id) on delete cascade
);

create table public.public_demo_reports (
  id uuid primary key default gen_random_uuid(),
  slug uuid not null unique default gen_random_uuid(),
  repository_id uuid not null,
  analysis_id uuid not null unique,
  title text not null,
  -- Server-generated public projection, never an unrestricted private report query.
  report jsonb not null check (jsonb_typeof(report)='object'),
  published_at timestamptz not null default now(),
  revoked_at timestamptz,
  foreign key (analysis_id, repository_id) references public.analyses(id, repository_id) on delete cascade
);
create index public_demo_reports_repository_idx on public.public_demo_reports(repository_id);

-- UPDATE TIMESTAMPS -----------------------------------------------------------
create function faultline_private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
do $$
declare t text;
begin
  foreach t in array array['profiles','github_installations','repositories','pull_requests','analyses','jobs','github_comments','ai_explanations']
  loop
    execute format('create trigger faultline_touch before update on public.%I for each row execute function faultline_private.touch_updated_at()',t);
  end loop;
end $$;

-- AUTH PROFILE: user ID only; verified GitHub identity is attached by the server.
create function faultline_private.create_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;
create trigger faultline_auth_user_created after insert on auth.users
for each row execute function faultline_private.create_profile();
insert into public.profiles(id) select id from auth.users on conflict (id) do nothing;

-- SNAPSHOT IMMUTABILITY -------------------------------------------------------
create function faultline_private.guard_snapshot()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status='ready' then raise exception 'Ready graph snapshots are immutable; create a new index version'; end if;
  if new.repository_id is distinct from old.repository_id or new.commit_sha is distinct from old.commit_sha
     or new.index_version is distinct from old.index_version then
    raise exception 'Snapshot identity cannot be changed';
  end if;
  return new;
end;
$$;
create trigger faultline_snapshot_guard before update on public.graph_snapshots
for each row execute function faultline_private.guard_snapshot();

create function faultline_private.guard_snapshot_child()
returns trigger language plpgsql set search_path = '' as $$
declare sid uuid; s text;
begin
  if tg_op='DELETE' then sid:=old.snapshot_id; else sid:=new.snapshot_id; end if;
  if tg_op='UPDATE' and (new.snapshot_id is distinct from old.snapshot_id or new.repository_id is distinct from old.repository_id) then
    raise exception 'Snapshot membership cannot be changed';
  end if;
  -- Parent lock prevents finalization racing with a child write.
  select status into s from public.graph_snapshots where id=sid for share;
  if found and s<>'indexing' then raise exception 'Only indexing snapshots accept graph mutations'; end if;
  -- No parent during cascaded deletion is allowed; INSERT still has its FK.
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger faultline_file_guard before insert or update or delete on public.source_files
for each row execute function faultline_private.guard_snapshot_child();
create trigger faultline_edge_guard before insert or update or delete on public.dependency_edges
for each row execute function faultline_private.guard_snapshot_child();

-- Reject accidentally attaching the correct repository's WRONG commit to a report.
create function faultline_private.validate_analysis_snapshots()
returns trigger language plpgsql set search_path = '' as $$
declare s public.graph_snapshots;
begin
  if new.head_snapshot_id is not null then
    select * into s from public.graph_snapshots where id=new.head_snapshot_id;
    if found then
      if s.repository_id<>new.repository_id or s.commit_sha<>new.head_sha then
        raise exception 'Head snapshot must match analysis repository and head SHA';
      end if;
      if new.status in ('complete','partial') and s.status<>'ready' then
        raise exception 'Finished analysis requires a ready head snapshot';
      end if;
    end if;
  end if;
  if new.base_snapshot_id is not null then
    select * into s from public.graph_snapshots where id=new.base_snapshot_id;
    if found then
      if s.repository_id<>new.repository_id or s.commit_sha<>coalesce(new.comparison_base_sha,new.base_sha) then
        raise exception 'Baseline snapshot must match comparison base SHA';
      end if;
      if new.status in ('complete','partial') and s.status<>'ready' then
        raise exception 'Finished analysis requires a ready baseline snapshot';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger faultline_analysis_snapshot_check before insert or update on public.analyses
for each row execute function faultline_private.validate_analysis_snapshots();

create function faultline_private.validate_evidence_target()
returns trigger language plpgsql set search_path = '' as $$
declare n public.analysis_nodes;
begin
  select * into n from public.analysis_nodes where id=new.target_node_id;
  if found then
    if n.analysis_id<>new.analysis_id or n.repository_id<>new.repository_id or n.graph_side<>new.graph_side then
      raise exception 'Evidence target must belong to the same analysis, repository and graph side';
    end if;
    if tg_table_name='impact_paths' then
      if jsonb_typeof(new.path_json)<>'array' or jsonb_array_length(new.path_json)<1 then
        raise exception 'An impact path must be a nonempty array';
      end if;
      if exists(select 1 from jsonb_array_elements(new.path_json) as e(value)
        where jsonb_typeof(e.value)<>'string' or length(e.value #>> '{}')=0) then
        raise exception 'Impact path elements must be nonempty filename strings';
      end if;
      if new.path_json->>-1 is distinct from n.path then
        raise exception 'Impact path must end at its target node';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger faultline_path_target_check before insert or update on public.impact_paths
for each row execute function faultline_private.validate_evidence_target();
create trigger faultline_test_target_check before insert or update on public.analysis_test_associations
for each row execute function faultline_private.validate_evidence_target();

-- RLS HELPERS: fixed search paths; trusted server alone writes ownership links.
create function faultline_private.can_read_repository(p_repository_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.repositories r join public.github_installations i on i.id=r.installation_id
    where r.id=p_repository_id and i.user_id=(select auth.uid())
      and i.deleted_at is null and i.suspended_at is null and r.access_removed_at is null
  );
$$;
create function faultline_private.can_read_demo(p_repository_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.repositories r join public.github_installations i on i.id=r.installation_id
    where r.id=p_repository_id and r.is_public_demo and not r.private
      and r.access_removed_at is null and i.deleted_at is null and i.suspended_at is null
  );
$$;

-- Explicitly revoke default Supabase table grants; RLS is not a substitute for grants.
do $$
declare t text;
begin
  foreach t in array array['faultline_schema_version','profiles','github_installations','repositories',
    'graph_snapshots','source_files','dependency_edges','pull_requests','analyses','analysis_changes',
    'analysis_nodes','impact_paths','analysis_test_associations','analysis_score_factors',
    'webhook_deliveries','jobs','github_comments','ai_explanations','public_demo_reports']
  loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    execute format('grant all on table public.%I to service_role',t);
  end loop;
  foreach t in array array['graph_snapshots','source_files','dependency_edges','pull_requests','analyses',
    'analysis_changes','analysis_nodes','impact_paths','analysis_test_associations','analysis_score_factors','github_comments','ai_explanations']
  loop
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy faultline_owner_read on public.%I for select to authenticated using (faultline_private.can_read_repository(repository_id))',t);
  end loop;
end $$;

grant select on public.profiles, public.github_installations, public.repositories to authenticated;
create policy faultline_profile_read on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy faultline_installation_read on public.github_installations for select to authenticated using (user_id=(select auth.uid()));
-- Repository metadata remains visible after revocation for diagnosis; source/report rows do not.
create policy faultline_repository_read on public.repositories for select to authenticated using (
  exists(select 1 from public.github_installations i where i.id=installation_id and i.user_id=(select auth.uid()))
);
grant select on public.public_demo_reports to anon, authenticated;
create policy faultline_public_demo_read on public.public_demo_reports for select to anon, authenticated
using (revoked_at is null and faultline_private.can_read_demo(repository_id));
-- jobs and webhook_deliveries deliberately have NO browser grants/policies.
-- Show sanitized worker diagnostics through an authenticated server endpoint.

-- BACKEND-ONLY TRANSACTIONAL RPCs ---------------------------------------------
create function public.record_webhook_and_job(
  p_delivery_id uuid, p_event_type text, p_action text,
  p_event_summary jsonb, p_job jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare inserted_id uuid; jid uuid;
begin
  insert into public.webhook_deliveries(delivery_id,event_type,action,event_summary)
    values(p_delivery_id,p_event_type,p_action,p_event_summary)
    on conflict(delivery_id) do nothing returning delivery_id into inserted_id;
  if inserted_id is null then
    select job_id into jid from public.webhook_deliveries where delivery_id=p_delivery_id;
    return jsonb_build_object('delivery_is_new',false,'job_id',jid);
  end if;
  if p_job is null then
    update public.webhook_deliveries set status='ignored',processed_at=now() where delivery_id=p_delivery_id;
    return jsonb_build_object('delivery_is_new',true,'job_id',null);
  end if;
  if jsonb_typeof(p_job)<>'object' then raise exception 'p_job must be an object'; end if;
  insert into public.jobs(installation_id,repository_id,analysis_id,job_type,dedupe_key,payload)
    values((p_job->>'installation_id')::uuid,(p_job->>'repository_id')::uuid,(p_job->>'analysis_id')::uuid,
      p_job->>'job_type',p_job->>'dedupe_key',coalesce(p_job->'payload','{}'::jsonb))
    on conflict(dedupe_key) do update set dedupe_key=excluded.dedupe_key
    returning id into jid;
  update public.webhook_deliveries set job_id=jid,status='queued' where delivery_id=p_delivery_id;
  return jsonb_build_object('delivery_is_new',true,'job_id',jid);
end;
$$;

create function public.claim_job(p_worker_id text, p_job_id uuid default null, p_lease_seconds integer default 240)
returns setof public.jobs language plpgsql security definer set search_path = '' as $$
declare jid uuid;
begin
  if p_worker_id is null or length(p_worker_id) not between 1 and 200 then raise exception 'Invalid worker ID'; end if;
  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then raise exception 'Lease must be 15..300 seconds'; end if;
  update public.jobs set status='failed',last_error_code='attempts_exhausted',finished_at=now(),
    worker_id=null,lease_token=null,lease_expires_at=null
    where (p_job_id is null or id=p_job_id) and attempt_count>=max_attempts
      and ((status='running' and lease_expires_at<=now()) or status in ('queued','retrying'));
  select j.id into jid from public.jobs j
    where (p_job_id is null or j.id=p_job_id) and j.attempt_count<j.max_attempts
      and ((j.status in ('queued','retrying') and j.next_attempt_at<=now())
        or (j.status='running' and j.lease_expires_at<=now()))
    order by j.next_attempt_at,j.created_at,j.id for update skip locked limit 1;
  if jid is null then return; end if;
  return query update public.jobs set status='running',attempt_count=attempt_count+1,
    worker_id=p_worker_id,lease_token=gen_random_uuid(),
    lease_expires_at=now()+make_interval(secs=>p_lease_seconds),
    started_at=coalesce(started_at,now()),finished_at=null
    where id=jid returning *;
end;
$$;

create function public.heartbeat_job(p_job_id uuid,p_lease_token uuid,p_lease_seconds integer default 240)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 15 and 300 then raise exception 'Lease must be 15..300 seconds'; end if;
  update public.jobs set lease_expires_at=now()+make_interval(secs=>p_lease_seconds)
    where id=p_job_id and status='running' and lease_token=p_lease_token and lease_expires_at>now();
  return found;
end;
$$;

create function public.finish_job(p_job_id uuid,p_lease_token uuid,p_result text,
  p_error_code text default null,p_error text default null,p_retry_at timestamptz default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare j public.jobs; final_status text;
begin
  if p_result is null or p_result not in ('complete','failed','retrying','cancelled') then raise exception 'Invalid result'; end if;
  select * into j from public.jobs where id=p_job_id and status='running'
    and lease_token=p_lease_token and lease_expires_at>now() for update;
  if not found then return false; end if;
  final_status:=p_result;
  if final_status='retrying' and j.attempt_count>=j.max_attempts then final_status:='failed'; end if;
  update public.jobs set status=final_status,worker_id=null,lease_token=null,lease_expires_at=null,
    last_error_code=p_error_code,last_error=left(p_error,2000),
    next_attempt_at=case when final_status='retrying' then greatest(coalesce(p_retry_at,now()+interval '15 seconds'),now()) else next_attempt_at end,
    finished_at=case when final_status='retrying' then null else now() end
    where id=p_job_id;
  update public.webhook_deliveries set status=case when final_status='complete' then 'complete'
      when final_status='retrying' then 'queued' else 'failed' end,
    processed_at=case when final_status='retrying' then null else now() end where job_id=p_job_id;
  return true;
end;
$$;

create function public.retry_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  -- Server must authenticate requester, authorize repository, enforce a cooldown,
  -- and reset the corresponding failed analysis state before invoking this RPC.
  update public.jobs set status='queued',attempt_count=0,next_attempt_at=now(),
    worker_id=null,lease_token=null,lease_expires_at=null,finished_at=null,
    last_error_code=null,last_error=null
    where id=p_job_id and (status='failed' or (status='running' and lease_expires_at<=now()));
  if not found then return false; end if;
  update public.webhook_deliveries set status='queued',processed_at=null where job_id=p_job_id;
  return true;
end;
$$;

-- Revoke PostgreSQL's default PUBLIC execute privilege on every created function.
revoke all on all functions in schema faultline_private from public, anon, authenticated;
grant execute on function faultline_private.can_read_repository(uuid) to authenticated;
grant execute on function faultline_private.can_read_demo(uuid) to anon, authenticated;
grant execute on all functions in schema faultline_private to service_role;
revoke all on function public.record_webhook_and_job(uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.claim_job(text,uuid,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_job(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.finish_job(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.retry_job(uuid) from public,anon,authenticated;
grant execute on function public.record_webhook_and_job(uuid,text,text,jsonb,jsonb) to service_role;
grant execute on function public.claim_job(text,uuid,integer) to service_role;
grant execute on function public.heartbeat_job(uuid,uuid,integer) to service_role;
grant execute on function public.finish_job(uuid,uuid,text,text,text,timestamptz) to service_role;
grant execute on function public.retry_job(uuid) to service_role;

-- Realtime: small analysis-status updates only; never broadcast the entire graph.
-- Supabase normally creates this publication. Conditional handling also permits a
-- fresh project where publication setup was not completed. No paid feature needed.
do $$
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;
  if not exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables)
     and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='analyses') then
    execute 'alter publication supabase_realtime add table public.analyses';
  end if;
end $$;

insert into public.faultline_schema_version(version,description)
values(1,'Faultline: commit-scoped graphs, immutable snapshots, evidence reports, RLS and leased jobs');
notify pgrst, 'reload schema';
commit;

-- Successful execution returns this confirmation. The SQL Editor may also show
-- "Success. No rows returned" for individual statements; that is normal.
select version, description, installed_at from public.faultline_schema_version;

-- NEXT APPLICATION STEPS (not additional SQL to run):
-- 1. Configure GitHub OAuth in Supabase Auth and the correct redirect allowlist.
-- 2. Use browser publishable key + signed-in session for SELECT / Realtime.
-- 3. Keep Supabase administrative secret and GitHub private key server-side.
-- 4. After server verification, populate profiles.github_user_id and create installation.
-- 5. Index immutable snapshots, then create PR + queued analysis before analysis jobs.
-- 6. record_webhook_and_job p_job keys:
--    job_type, dedupe_key, installation_id, repository_id, analysis_id, payload.
--    IDs are internal UUIDs; GitHub's installation/repository numbers are separate.
--    For ignored events pass p_job=NULL. For installation sync repository_id and
--    analysis_id can be omitted; minimal event_summary identifies the GitHub account.
-- 7. claim_job -> process -> heartbeat as needed -> finish_job with lease token.
-- 8. Read analyses.status + publishing_status separately. Browser listens to analyses.
-- 9. Update changed_count etc with DISTINCT report file counts, not duplicate base/head
--    node counts. reachable_count excludes changed roots. Store partial warnings.
-- 10. Public sharing requires repositories.is_public_demo=true AND private=false AND
--     an explicit sanitized public_demo_reports row. Normal reports remain private.
-- 11. Re-check GitHub access in the server; RLS reflects the last processed access
--     state. Handle installation/repository removals and visibility changes promptly.
-- 12. Retention: retain referenced snapshots for historical reports. To prune an old
--     analysis first clear previous_analysis_id / comment references as appropriate.
--     No automatic deletion/cron is installed. Entire repository deletion cascades.
