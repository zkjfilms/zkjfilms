# Supabase Database Backups

## Problem

The site's Supabase Postgres database holds real business-critical data — bookings with Stripe payment references, signed contracts, client leads and contact info, gallery metadata, and scheduling data — with no backup strategy. The project is on Supabase's Free tier, which retains some automatic backups internally but does not offer self-service restore; recovering from a mistake (a bad migration, an accidental delete, application-level corruption) would require contacting Supabase support with no guaranteed turnaround, or losing data outright.

## Goal

A free, low-maintenance daily backup of the entire database to storage the project already controls, with a documented, tested manual restore procedure — without taking on a recurring Supabase Pro subscription.

## Design

### Architecture

A new scheduled GitHub Actions workflow, `.github/workflows/backup-database.yml`, runs once daily. Each run:

1. Installs `postgresql-client` (for `pg_dump`) and the AWS CLI (R2 is S3-compatible, so `aws s3 cp` works against R2's endpoint the same way `lib/r2.ts` uses the S3 SDK elsewhere in this project — just via CLI in a workflow context, not app code).
2. Runs `pg_dump -Fc` (custom format — compressed, supports selective restore via `pg_restore`) against Supabase's direct Postgres connection string, dumping the entire database. No table is special-cased or excluded (including `rate_limit_hits`, which is ephemeral but costs nothing extra to include) — a full dump is simplest and safest.
3. Uploads the dump to a new, dedicated R2 bucket, `zkjfilms-db-backups` — kept separate from the existing `zk-client-galleries` (private client photos) and `zkjfilms-public` (public images/videos) buckets, since a database dump contains a different class of sensitive data (client PII: names, emails, phone numbers, contract details) and gets its own narrowly-scoped API token, not shared with any other credential.

This mirrors the existing `.github/workflows/sync-google-calendar.yml` pattern (a scheduled GitHub Actions workflow) but runs the dump directly in the workflow rather than hitting an app API route on Vercel — `pg_dump` is a native binary tool a GitHub Actions runner (a full Ubuntu VM) handles naturally; Vercel's serverless functions are a poor fit for it and would add unnecessary constraints (execution time limits, no straightforward way to install `postgresql-client`).

**`.github/workflows/backup-database.yml`:**

```yaml
name: Database Backup

on:
  schedule:
    - cron: "17 9 * * *" # ~3-4am America/Chicago daily (not exactly on the hour, since GitHub notes top-of-hour schedules are more likely to be delayed)
  workflow_dispatch: {}

permissions: {}

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Install postgresql-client
        # Supabase provisions Postgres 17; pg_dump refuses to dump from a
        # newer-major-version server than itself, and ubuntu-latest's apt
        # default installs client 16 — so this pins the version explicitly
        # via the official PGDG repo instead.
        run: |
          sudo install -d /usr/share/postgresql-common/pgdg
          curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
            | sudo tee /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc >/dev/null
          echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
            | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
          sudo apt-get update && sudo apt-get install --yes postgresql-client-17

      - name: Dump database
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
        run: pg_dump -Fc --no-owner --no-acl "$SUPABASE_DB_URL" -f backup.dump

      - name: Verify dump integrity
        run: pg_restore --list backup.dump > /dev/null && [ -s backup.dump ]

      - name: Upload to R2
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_BACKUP_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_BACKUP_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: auto
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
        run: |
          TIMESTAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
          aws s3 cp backup.dump "s3://zkjfilms-db-backups/backups/${TIMESTAMP}.dump" \
            --endpoint-url "$R2_ENDPOINT"
```

`workflow_dispatch: {}` lets the backup be triggered manually from the GitHub Actions UI (e.g., right before a risky migration), not just on the daily schedule. No "install AWS CLI" step is needed — `ubuntu-latest` ships AWS CLI v2 preinstalled, and re-running its installer against an existing install fails without an explicit `--update` flag. `AWS_DEFAULT_REGION: auto` is set because the AWS CLI's S3 client requires a resolvable region even against R2's custom `--endpoint-url`; `auto` is Cloudflare's documented value for this. The "Verify dump integrity" step confirms the archive is non-empty and `pg_restore`-readable before it's trusted and uploaded, catching a truncated or corrupted dump early — matching this project's existing `sync-google-calendar.yml` habit of not trusting an apparently-successful step at face value. `permissions: {}` drops the job's default `GITHUB_TOKEN` scope, which this job never uses but which is worth eliminating on principle given the job holds a full-database credential and a storage write key.

`--no-owner --no-acl` on both dump and restore avoids failures from Supabase-managed role/ACL differences between the source and a potential restore target (a fresh Supabase project has different internal role names than the original).

### Retention and storage

- **Lifecycle rule** on the `zkjfilms-db-backups` bucket (configured once, manually, in the Cloudflare dashboard — not custom code in the workflow): auto-delete objects older than 30 days. R2's native lifecycle-rule feature handles pruning; the workflow itself has no cleanup logic to write or maintain.
- **Naming:** `backups/<YYYY-MM-DDTHHMMSSZ>.dump`, one object **per run** (not per day) — a manual `workflow_dispatch` trigger (e.g. right before a risky migration) must never silently overwrite that day's scheduled backup at the same key, since R2 object versioning is off by default.
- 30 days balances real recovery value (catches a mistake noticed weeks later) against storage cost, which is trivial at this data volume either way — changing it later is a one-field edit in the dashboard, not a code change.

### Restore procedure

Deliberately manual, not automated — an automated restore path is a bigger footgun than a documented manual command for a solo-operator site, and restores should never happen without a human directly and consciously initiating them.

```bash
# 1. List the bucket to find the object you want (one per run, not per
#    day, so there isn't a single predictable key), then download it
#    (replace <timestamp> and <account-id>; the account ID isn't secret
#    — see next.config.ts's CSP img-src comment).
aws s3 ls s3://zkjfilms-db-backups/backups/ \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com
aws s3 cp s3://zkjfilms-db-backups/backups/<timestamp>.dump ./backup.dump \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com

# 2. Restore into a target database (the original project for disaster
#    recovery, or a fresh scratch Supabase project to test the restore
#    or stand up a copy).
pg_restore --clean --if-exists --no-owner --no-acl \
  -d "<target-connection-string>" backup.dump
```

`--clean --if-exists` drops existing objects before recreating them, so a restore into the same project cleanly overwrites rather than erroring on already-existing tables.

### Secrets

Four new GitHub Actions repo secrets (Settings → Secrets and variables → Actions), none of which ever appear in code or logs:

- `SUPABASE_DB_URL` — the **Session pooler** connection string from Supabase's dashboard (Project Settings → Database → Connection string), specifically — not the Direct connection (its host is IPv6-only on free-tier projects, and GitHub Actions runners have no IPv6 connectivity, so it fails with an opaque "Network is unreachable" error) and not the Transaction pooler (`pg_dump` needs a stable session, which transaction-mode pooling doesn't provide).
- `R2_BACKUP_ACCESS_KEY_ID` / `R2_BACKUP_SECRET_ACCESS_KEY` — a new R2 API token scoped to Object Read & Write on only the `zkjfilms-db-backups` bucket, following the same least-privilege pattern the project already uses for its public-image bucket's token (`R2_PUBLIC_ACCESS_KEY_ID`/`R2_PUBLIC_SECRET_ACCESS_KEY` in `.env.example`).
- `R2_ENDPOINT` — same value/pattern as the app's existing `R2_ENDPOINT` (`https://<account-id>.r2.cloudflarestorage.com`), added separately here since GitHub Actions secrets are a distinct store from Vercel's env vars.

### Failure visibility

GitHub's built-in workflow-failure email notification (sent automatically to the repo's watchers on any failed scheduled run) is sufficient for a single daily job on a solo-operator project — no extra alerting tooling needed. GitHub also auto-disables scheduled workflows after 60 days of repo inactivity (with a warning email first) — worth knowing for a portfolio site that could go quiet for a couple of months.

### Manual setup (outside this codebase, done once before the workflow can run)

1. **Create the R2 bucket:** Cloudflare dashboard → R2 Object Storage → Create bucket → name it `zkjfilms-db-backups`. Leave it private (no public access) — this bucket will hold sensitive client PII.
2. **Add a lifecycle rule:** on the new bucket, Settings → Object lifecycle rules → add a rule deleting objects older than 30 days.
3. **Create a scoped API token:** R2 → Manage API tokens → Create API token → permissions: Object Read & Write, scoped to only the `zkjfilms-db-backups` bucket. Save the Access Key ID and Secret Access Key.
4. **Get the Session pooler database connection string:** Supabase dashboard → Project Settings → Database → Connection string → select the **Session pooler** option specifically (not Direct connection, not Transaction pooler — see the Secrets section above for why).
5. **Add all four secrets** to the GitHub repo: Settings → Secrets and variables → Actions → New repository secret, one each for `SUPABASE_DB_URL`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`, `R2_ENDPOINT`.

### Out of scope

- Automated restore/disaster-recovery orchestration — restores stay a manual, deliberate command.
- Cross-region replication of backups.
- Backing up R2 object storage itself (the photos/videos) — a separate, lower-priority concern, since that data is far less write-heavy and less prone to silent corruption than a live transactional database. Can be revisited separately if ever needed.
- Upgrading to Supabase Pro for native backups/PITR — explicitly deferred in favor of the free, self-managed approach.

## Testing / Verification

- Trigger the workflow manually via `workflow_dispatch` (GitHub Actions UI → "Run workflow") rather than waiting for the schedule, and confirm it completes successfully.
- Confirm the dump object actually lands in `zkjfilms-db-backups` at the expected `backups/<timestamp>.dump` path (via the Cloudflare dashboard's bucket browser, or `aws s3 ls`).
- **Perform one real restore test** against a fresh scratch Supabase project (not the production one) — download the dump, run the restore command, and spot-check that a few known rows (e.g., a specific booking or gallery) exist correctly in the restored database. This is the only way to know the backup is actually restorable, not just present in storage.
- Confirm the lifecycle rule is active on the bucket (Cloudflare dashboard) and understand its effect will only be visible after 30 days of accumulated backups.
- Confirm no secrets appear in workflow run logs (GitHub automatically redacts registered secrets from log output, but worth a visual check on the first real run).
