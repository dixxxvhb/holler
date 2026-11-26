#!/bin/bash
# Builds supabase/gamesN-check.sql (N = 3 or 4, default 4): a dry run of gamesN.sql plus its checks, aborted at the end.
cd "$(dirname "$0")/.." && n=${1:-4} && {
  echo "-- Dry run: games$n.sql + games$n-tests.sql. Built by scripts/build-check.sh $n; aborts at the end on purpose."
  echo "-- Run: ssh pc \"pwsh -NoProfile -File C:/Users/bowle/bin/pc-run.ps1 holler-sql games$n-check.sql\". Expect \"GAMES$n CHECK PASSED\"."
  echo 'begin;'; cat supabase/games$n.sql supabase/games$n-tests.sql; } > supabase/games$n-check.sql
