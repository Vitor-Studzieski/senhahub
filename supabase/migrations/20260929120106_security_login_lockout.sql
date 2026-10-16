-- Login protections: short IP burst limits are enforced by the runtime; this
-- RPC atomically records per-account failures and temporary escalating locks.

ALTER TABLE public.login_attempts
  ADD COLUMN IF NOT EXISTS lockout_level integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_failure_at bigint NOT NULL DEFAULT 0;

DO $do$
BEGIN
  IF to_regclass('auth.login_attempts') IS NOT NULL THEN
    ALTER TABLE auth.login_attempts
      ADD COLUMN IF NOT EXISTS lockout_level integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_failure_at timestamptz NOT NULL DEFAULT now();
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.record_login_failure(
  p_attempt_key text,
  p_attempt_limit integer,
  p_window_seconds integer,
  p_base_lock_seconds integer,
  p_max_lock_seconds integer,
  p_lockout_reset_seconds integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_now_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  v_attempt public.login_attempts%ROWTYPE;
  v_count integer;
  v_first_attempt_at bigint;
  v_last_failure_at bigint;
  v_lockout_level integer;
  v_locked_until bigint := 0;
  v_lock_seconds integer;
BEGIN
  IF p_attempt_key IS NULL
    OR char_length(p_attempt_key) < 8
    OR char_length(p_attempt_key) > 240
    OR p_attempt_limit <= 0
    OR p_window_seconds <= 0
    OR p_base_lock_seconds <= 0
    OR p_max_lock_seconds < p_base_lock_seconds
    OR p_max_lock_seconds > 86400
    OR p_lockout_reset_seconds <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.login_attempts (
    attempt_key, count, first_attempt_at, locked_until, lockout_level, last_failure_at, updated_at
  )
  VALUES (p_attempt_key, 0, v_now_ms, 0, 0, 0, v_now)
  ON CONFLICT (attempt_key) DO NOTHING;

  SELECT * INTO v_attempt
  FROM public.login_attempts
  WHERE attempt_key = p_attempt_key
  FOR UPDATE;

  IF v_attempt.locked_until > v_now_ms THEN
    RETURN v_attempt.locked_until;
  END IF;

  v_lockout_level := CASE
    WHEN v_attempt.last_failure_at > 0
      AND v_now_ms - v_attempt.last_failure_at >= p_lockout_reset_seconds * 1000
      THEN 0
    ELSE greatest(0, v_attempt.lockout_level)
  END;

  IF v_attempt.first_attempt_at > 0
    AND v_now_ms >= v_attempt.first_attempt_at
    AND v_now_ms - v_attempt.first_attempt_at < p_window_seconds * 1000 THEN
    v_count := greatest(0, v_attempt.count) + 1;
    v_first_attempt_at := v_attempt.first_attempt_at;
  ELSE
    v_count := 1;
    v_first_attempt_at := v_now_ms;
  END IF;

  IF v_count >= p_attempt_limit THEN
    v_lockout_level := v_lockout_level + 1;
    v_lock_seconds := p_base_lock_seconds;
    FOR i IN 2..v_lockout_level LOOP
      v_lock_seconds := least(p_max_lock_seconds, v_lock_seconds * 2);
      EXIT WHEN v_lock_seconds >= p_max_lock_seconds;
    END LOOP;
    v_locked_until := v_now_ms + (v_lock_seconds * 1000)::bigint;
    v_count := 0;
    v_first_attempt_at := v_now_ms;
  END IF;

  UPDATE public.login_attempts
  SET count = v_count,
      first_attempt_at = v_first_attempt_at,
      locked_until = v_locked_until,
      lockout_level = v_lockout_level,
      last_failure_at = v_now_ms,
      updated_at = v_now
  WHERE attempt_key = p_attempt_key;

  RETURN v_locked_until;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_login_failure(text, integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_login_failure(text, integer, integer, integer, integer, integer)
  TO service_role;

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'senhahub_service') THEN
    GRANT EXECUTE ON FUNCTION public.record_login_failure(text, integer, integer, integer, integer, integer)
      TO senhahub_service;
  END IF;
END
$do$;
