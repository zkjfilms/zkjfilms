# Supabase Database Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a daily GitHub Actions workflow that dumps the full Supabase Postgres database and uploads it to a dedicated, narrowly-scoped Cloudflare R2 bucket, with a documented, tested manual restore procedure.

**Architecture:** A scheduled GitHub Actions workflow (matching the existing `.github/workflows/sync-google-calendar.yml` pattern) installs `postgresql-client` and the AWS CLI on an Ubuntu runner, runs `pg_dump -Fc` against Supabase's direct Postgres connection string, and uploads the resulting dump to R2 via `aws s3 cp` (R2 is S3-compatible). No application code changes — this is entirely a new workflow file plus manual infrastructure setup (a new R2 bucket, a scoped API token, a lifecycle rule, and GitHub repo secrets) that only you can perform, since it requires access to the Cloudflare and Supabase dashboards.

**Tech Stack:** GitHub Actions (`ubuntu-latest`), `pg_dump`/`pg_restore` (PostgreSQL client tools), AWS CLI (against R2's S3-compatible API).

## Global Constraints

- Workflow file: `.github/workflows/backup-database.yml`, matching the existing `sync-google-calendar.yml`'s structure (`on.schedule` + `on.workflow_dispatch: {}`, `jobs.<id>.runs-on: ubuntu-latest`).
- Dump format: `pg_dump -Fc --no-owner --no-acl` (custom format — compressed, supports selective restore via `pg_restore`; `--no-owner --no-acl` avoids role/ACL mismatches when restoring into a different Supabase project).
- Full database dump — no table is excluded (including `rate_limit_hits`, which is ephemeral but cheap to include; excluding tables adds complexity for no real benefit here).
- Upload target: a **new** R2 bucket named exactly `zkjfilms-db-backups`, object path `backups/<YYYY-MM-DDTHHMMSSZ>.dump` (one per run, not one per day — a manual `workflow_dispatch` run must never silently overwrite that day's scheduled backup) — kept separate from the existing `zk-client-galleries`/`zkjfilms-public` buckets since it holds different sensitive data (client PII) and needs its own scoped credential.
- Four new **GitHub Actions repo secrets** (not `.env.local`, not Vercel env vars — this workflow runs on GitHub's infrastructure, not Vercel's): `SUPABASE_DB_URL`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`, `R2_ENDPOINT`. Do not add these to `.env.example` — that file is explicitly documented (its own header comment) as being for `.env.local`/Vercel env vars, and listing GitHub-only secrets there would mislead a future reader into thinking they belong in Vercel too.
- Retention: 30-day auto-expiry via an R2 bucket lifecycle rule (configured manually in the Cloudflare dashboard — no cleanup code in the workflow).
- `SUPABASE_DB_URL` must be the **session-mode** direct connection string, not the transaction-mode pooler — `pg_dump` needs a stable session.
- This repo has no test framework. The workflow itself has no `tsc`/build/lint surface (it's YAML, not TypeScript) — verification is: trigger it manually, confirm the object lands in R2, and perform one real restore against a scratch Supabase project.

---

### Task 1: Backup workflow, manual setup, and restore verification

**Files:**
- Create: `.github/workflows/backup-database.yml`

**Interfaces:** None — this task has no code interfaces consumed by or produced for other tasks. It's the only task in this plan.

- [ ] **Step 1: Create the workflow file**

```yaml
name: Database Backup

# Daily logical backup of the full Supabase Postgres database, uploaded
# to a dedicated R2 bucket (zkjfilms-db-backups) with a 30-day lifecycle
# rule configured in the Cloudflare dashboard. See
# docs/superpowers/plans/2026-08-14-database-backups.md for the full
# design and setup steps.
#
# SUPABASE_DB_URL must be the Session pooler connection string (port
# 5432, host like aws-0-<region>.pooler.supabase.com) — NOT the Direct
# connection, which is IPv6-only and unreachable from GitHub's runners.
#
# Note: GitHub auto-disables scheduled workflows after 60 days of repo
# inactivity (with an email warning first). If backups stop, check this
# workflow's Actions tab status.
#
# RESTORE (in an emergency — replace <timestamp> and <account-id>; the R2
# account ID is not secret, see next.config.ts's CSP img-src comment,
# which explains the private bucket's account-ID subdomain isn't a
# secret because it's already visible in every signed URL a gallery
# viewer's browser requests):
#
#   Each run uploads to its own timestamped key (not one per day), so
#   list the bucket first to find the object you want:
#
#   aws s3 ls s3://zkjfilms-db-backups/backups/ \
#     --endpoint-url https://<account-id>.r2.cloudflarestorage.com
#
#   aws s3 cp s3://zkjfilms-db-backups/backups/<timestamp>.dump ./backup.dump \
#     --endpoint-url https://<account-id>.r2.cloudflarestorage.com
#   pg_restore --clean --if-exists --no-owner --no-acl \
#     -d "<target-connection-string>" backup.dump
#
on:
  schedule:
    - cron: "17 9 * * *" # ~3-4am America/Chicago daily (not exactly on the hour, since GitHub notes top-of-hour schedules are more likely to be delayed; fixed UTC time, local hour shifts by 1 across DST since cron doesn't follow timezones)
  workflow_dispatch: {}

permissions: {}

jobs:
  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Install postgresql-client
        # Supabase currently provisions Postgres 17. pg_dump refuses to dump
        # from a server whose major version is newer than the client's, and
        # ubuntu-latest's apt default (postgresql-client) installs client 16
        # — so this installs from the official PGDG repo and pins the
        # version explicitly instead. Bump postgresql-client-17 below if the
        # Supabase project's own Postgres major version is ever upgraded (a
        # client older than the server fails the same way) — check the
        # actual version via the Supabase dashboard (Project Settings →
        # Infrastructure, or `SELECT version();`) if backups ever start
        # failing with a "server version mismatch" error.
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
        # Confirms the file is both non-empty and a structurally valid
        # pg_restore-readable archive before it's uploaded and trusted as a
        # real backup, catching a truncated or corrupted dump early (see
        # sync-google-calendar.yml for this repo's equivalent habit of not
        # trusting an apparently-successful step at face value).
        run: pg_restore --list backup.dump > /dev/null && [ -s backup.dump ]

      - name: Upload to R2
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_BACKUP_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_BACKUP_SECRET_ACCESS_KEY }}
          # The AWS CLI's S3 client requires a resolvable region even with a
          # custom --endpoint-url; "auto" is Cloudflare's documented value
          # for R2's S3 compatibility.
          AWS_DEFAULT_REGION: auto
          R2_ENDPOINT: ${{ secrets.R2_ENDPOINT }}
        run: |
          # Timestamped (not just dated) key so a manual workflow_dispatch
          # run — e.g. right before a risky migration — never silently
          # overwrites the same day's scheduled backup (R2 object
          # versioning is off by default).
          TIMESTAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
          aws s3 cp backup.dump "s3://zkjfilms-db-backups/backups/${TIMESTAMP}.dump" \
            --endpoint-url "$R2_ENDPOINT"
```

Note: this file went through one review round after initial implementation (removing an AWS-CLI-install step that conflicts with `ubuntu-latest`'s preinstalled CLI, pinning the Postgres client version to match Supabase's server, adding the R2 region env var, and the other fixes reflected in the YAML above) — the block shown here is the final, correct version to create; it already reflects that round, so implementing it exactly as written needs no further changes from that review.

- [ ] **Step 2: Commit the workflow file**

```bash
git add .github/workflows/backup-database.yml
git commit -m "Add scheduled Supabase database backup workflow"
```

- [ ] **Step 3: Manual setup — create the R2 bucket and lifecycle rule**

These steps happen in the Cloudflare dashboard, not in this codebase. They must be done before the workflow can succeed, but they can happen in any order relative to Steps 1-2 above.

1. Cloudflare dashboard → **R2 Object Storage** → **Create bucket**. Name it exactly `zkjfilms-db-backups`. Leave it private (no public access) — it will hold sensitive client PII (names, emails, phone numbers, contract details).
2. On the new bucket: **Settings** → **Object lifecycle rules** → add a rule that deletes objects older than **30 days**.

- [ ] **Step 4: Manual setup — create a scoped R2 API token**

1. Cloudflare dashboard → **R2** → **Manage API tokens** → **Create API token**.
2. Permissions: **Object Read & Write**, scoped to only the `zkjfilms-db-backups` bucket (not "Apply to all buckets") — matching the least-privilege pattern this project already uses for its public-image bucket's token (`R2_PUBLIC_ACCESS_KEY_ID`/`R2_PUBLIC_SECRET_ACCESS_KEY` in `.env.example`).
3. Save the resulting **Access Key ID** and **Secret Access Key** — you'll need both in Step 6.

- [ ] **Step 5: Manual setup — get the Supabase Session pooler connection string**

1. Supabase dashboard → your project → **Project Settings** → **Database** → **Connection string**.
2. Supabase offers three options here: **Direct connection**, **Transaction pooler**, and **Session pooler**. Select **Session pooler** specifically (host looks like `aws-0-<region>.pooler.supabase.com`, port 5432) — not Direct connection (its host is IPv6-only on free-tier projects, and GitHub Actions runners have no IPv6 connectivity, so it fails with an opaque "Network is unreachable" error) and not the Transaction pooler (`pg_dump` needs a stable session, which transaction-mode pooling doesn't provide).
3. Copy the full connection string (it includes your database password inline — treat it as a secret, same as any other credential in this project).

- [ ] **Step 6: Manual setup — add the four GitHub Actions secrets**

1. GitHub → this repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
2. Add each of these four, one at a time:
   - `SUPABASE_DB_URL` — the connection string from Step 5.
   - `R2_BACKUP_ACCESS_KEY_ID` — the Access Key ID from Step 4.
   - `R2_BACKUP_SECRET_ACCESS_KEY` — the Secret Access Key from Step 4.
   - `R2_ENDPOINT` — `https://<your-r2-account-id>.r2.cloudflarestorage.com` (same account ID already visible in your `.env.local`'s existing `R2_ENDPOINT` value — this is the same Cloudflare account, just a different bucket).

- [ ] **Step 7: Trigger the workflow manually and confirm it succeeds**

1. GitHub → this repo → **Actions** tab → **Database Backup** workflow (left sidebar) → **Run workflow** button → confirm.
2. Wait for the run to complete. Confirm every step shows a green checkmark, and specifically confirm no secret values appear in the log output for any step (GitHub auto-redacts registered secrets from logs, but do a visual scan of the "Dump database" and "Upload to R2" steps' output on this first run to be sure).

Expected: the workflow run succeeds end-to-end.

- [ ] **Step 8: Confirm the dump object landed in R2**

Cloudflare dashboard → R2 → `zkjfilms-db-backups` bucket → confirm an object exists at `backups/<timestamp>.dump` (e.g. `backups/2026-08-15T090000Z.dump`) with a non-zero size. Note there's one object per run (not per day) — if you've triggered the workflow more than once, you'll see multiple objects; pick the most recent for this check.

- [ ] **Step 9: Perform one real restore test against a scratch Supabase project**

This is the only way to know the backup is actually restorable, not merely present in storage — do not skip this step.

1. Create a new, throwaway Supabase project (free tier is fine) — do **not** restore into the production project for this test.
2. Get that scratch project's own Session pooler connection string (same process as Step 5, for the new project).
3. On your local machine (or any machine with `awscli` and `postgresql-client` installed), download the dump (list the bucket first if you're not sure of the exact timestamp):
   ```bash
   aws s3 ls s3://zkjfilms-db-backups/backups/ \
     --endpoint-url https://<your-r2-account-id>.r2.cloudflarestorage.com
   aws s3 cp s3://zkjfilms-db-backups/backups/<timestamp>.dump ./backup.dump \
     --endpoint-url https://<your-r2-account-id>.r2.cloudflarestorage.com
   ```
   (Use your local R2 credentials or the same backup token from Step 4 — either works for a read.)
4. Restore it into the scratch project:
   ```bash
   pg_restore --clean --if-exists --no-owner --no-acl \
     -d "<scratch-project-connection-string>" backup.dump
   ```
5. Connect to the scratch project (Supabase dashboard's Table Editor, or `psql`) and spot-check that a handful of known tables and rows exist correctly — e.g., confirm the `galleries`, `bookings`, and `leads` tables are present and contain the same row counts as production.
6. Once confirmed, delete the scratch Supabase project (it's no longer needed and just holds a stale copy of real client data otherwise).

Expected: the restored scratch database contains real, correct data matching production at the time of the dump.

- [ ] **Step 10: Confirm the workflow will run on its own schedule**

No action needed here beyond what's already committed — the `on.schedule` cron trigger in the workflow file (added in Step 1) means no further setup is required for daily runs to happen automatically going forward. This step exists only as a reminder to check back in ~24 hours (or check the Actions tab's run history) to confirm the first scheduled (non-manual) run also succeeds, since a manually-triggered run (Step 7) and a cron-triggered run share the same code path but are worth confirming both work in practice.
