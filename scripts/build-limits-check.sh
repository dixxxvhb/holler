#!/bin/bash
# Builds supabase/limits-check.sql: a dry run of limits.sql plus its checks, aborted at the end on purpose.
cd "$(dirname "$0")/.." && {
  echo "-- Dry run: limits.sql + limits-tests.sql. Built by scripts/build-limits-check.sh; aborts at the end on purpose."
  echo "-- Run: ssh pc \"pwsh -NoProfile -File C:/Users/bowle/bin/pc-run.ps1 holler-sql limits-check.sql\". Expect \"LIMITS CHECK PASSED\"."
  echo 'begin;'; cat supabase/limits.sql supabase/limits-tests.sql; } > supabase/limits-check.sql
