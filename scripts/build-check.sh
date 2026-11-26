#!/bin/bash
# Builds supabase/games3-check.sql: a dry run of games3.sql plus its end-to-end checks, aborted at the end.
cd "$(dirname "$0")/.." && {
  echo '-- Dry run: games3.sql + games3-tests.sql. Built by scripts/build-check.sh; aborts at the end on purpose.'
  echo '-- Run: ssh pc "pwsh -NoProfile -File C:/Users/bowle/bin/pc-run.ps1 holler-sql games3-check.sql". Expect "GAMES3 CHECK PASSED".'
  echo 'begin;'; cat supabase/games3.sql supabase/games3-tests.sql; } > supabase/games3-check.sql
