#!/bin/sh
# Supabase's free plan pauses a project that sees no activity, and a paused
# project is "Couldn't reach the price store" for every seller. One tiny read
# a day counts as activity. Run daily by launchd (com.likho.keepalive).
cd "$(dirname "$0")/.." || exit 1
set -a; . ./.env; set +a
URL="${SUPABASE_URL:-https://gzplynqqsmkwyrjxprai.supabase.co}"
if curl -fsS -m 30 -o /dev/null "$URL/rest/v1/businesses?select=id&limit=1" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"; then
  echo "$(date '+%F %T') ok"
else
  echo "$(date '+%F %T') FAILED — check the project isn't paused"
fi
