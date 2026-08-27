#!/usr/bin/env python3
"""
Email-to-Gmail IMAP Migration Script

Copies all emails (all folders/labels) from a Gmail or Apple (iCloud) account
to a Gmail account, with deduplication, progress tracking, and checkpoint/resume
support.

Usage:
    python gmail_migrate.py                                      # Gmail → Gmail
    python gmail_migrate.py --src-provider apple                 # Apple → Gmail
    python gmail_migrate.py --dry-run                            # list folders & counts
    python gmail_migrate.py --folders INBOX --limit 5            # test run
"""

import argparse
import email
import json
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from imapclient import IMAPClient
from tqdm import tqdm

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Provider-specific IMAP settings
PROVIDERS = {
    "gmail": {
        "host": "imap.gmail.com",
        "port": 993,
        "skip_folders": {
            "[Gmail]/All Mail",
            "[Gmail]/Spam",
            "[Gmail]/Trash",
        },
    },
    "apple": {
        "host": "imap.mail.me.com",
        "port": 993,
        "skip_folders": {
            "Deleted Messages",
            "Junk",
            "Notes",
        },
    },
}

# Destination is always Gmail
DST_PROVIDER = PROVIDERS["gmail"]

# Map source folder names → destination (Gmail) folder names.
# Folders not listed here are copied with their original name.
FOLDER_MAP_APPLE_TO_GMAIL = {
    "Sent Messages": "[Gmail]/Sent Mail",
    "Drafts":        "[Gmail]/Drafts",
    "Archive":       "[Gmail]/All Mail",
}

BATCH_SIZE = 50          # messages fetched per batch
BATCH_DELAY_SEC = 0.5    # pause between batches to respect rate limits
MAX_RETRIES = 3          # retries on transient IMAP errors
RETRY_BACKOFF_BASE = 2   # exponential backoff base (seconds)

PROGRESS_FILE = "migration_progress.json"
ERROR_LOG_FILE = "migration_errors.log"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

log = logging.getLogger("gmail_migrate")


def setup_logging() -> None:
    """Configure console + file logging."""
    log.setLevel(logging.DEBUG)

    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter("%(levelname)s  %(message)s"))
    log.addHandler(console)

    fh = logging.FileHandler(ERROR_LOG_FILE, encoding="utf-8")
    fh.setLevel(logging.WARNING)
    fh.setFormatter(
        logging.Formatter("%(asctime)s  %(levelname)s  %(message)s")
    )
    log.addHandler(fh)


# ---------------------------------------------------------------------------
# Checkpoint / Resume
# ---------------------------------------------------------------------------

def load_progress() -> dict:
    """Load migration checkpoint from disk."""
    if Path(PROGRESS_FILE).exists():
        with open(PROGRESS_FILE, "r") as f:
            return json.load(f)
    return {"completed_folders": [], "current_folder": None, "done_uids": {}}


def save_progress(progress: dict) -> None:
    """Persist migration checkpoint to disk."""
    with open(PROGRESS_FILE, "w") as f:
        json.dump(progress, f, indent=2)


# ---------------------------------------------------------------------------
# IMAP helpers
# ---------------------------------------------------------------------------

def connect(email_addr: str, app_password: str, host: str, port: int) -> IMAPClient:
    """Connect and authenticate to an IMAP server."""
    client = IMAPClient(host, port=port, ssl=True)
    client.login(email_addr, app_password)
    log.info("Connected to %s (%s)", email_addr, host)
    return client


def reconnect(email_addr: str, app_password: str, host: str, port: int) -> IMAPClient:
    """Reconnect after a dropped connection."""
    log.warning("Reconnecting to %s …", email_addr)
    return connect(email_addr, app_password, host, port)


def list_folders(client: IMAPClient, skip_folders: set[str]) -> list[str]:
    """Return a sorted list of folder names, filtering out skip_folders."""
    folders = []
    for flags, delimiter, name in client.list_folders():
        # Some servers return bytes for names
        if isinstance(name, bytes):
            name = name.decode("utf-8")
        if name in skip_folders:
            log.debug("Skipping folder: %s", name)
            continue
        # Skip \Noselect folders (virtual containers)
        flag_strs = {f.decode() if isinstance(f, bytes) else f for f in flags}
        if "\\Noselect" in flag_strs:
            log.debug("Skipping non-selectable folder: %s", name)
            continue
        folders.append(name)
    return sorted(folders)


def map_folder_name(folder: str, folder_map: dict[str, str]) -> str:
    """Map a source folder name to the destination folder name."""
    return folder_map.get(folder, folder)


def ensure_folder_exists(client: IMAPClient, folder: str) -> None:
    """Create the folder on destination if it doesn't already exist."""
    try:
        client.select_folder(folder, readonly=True)
        client.close_folder()
    except Exception:
        try:
            client.create_folder(folder)
            log.info("Created destination folder: %s", folder)
        except Exception as exc:
            # Folder might already exist but just not be selectable in the
            # same way — log and continue.
            log.debug("Could not create folder %s: %s", folder, exc)


def get_message_id(raw_message: bytes) -> str | None:
    """Extract the Message-ID header from a raw email."""
    try:
        msg = email.message_from_bytes(raw_message)
        return msg.get("Message-ID", "").strip()
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Migration logic
# ---------------------------------------------------------------------------

def migrate_folder(
    src: IMAPClient,
    dst: IMAPClient,
    folder: str,
    progress: dict,
    seen_ids: set[str],
    limit: int | None = None,
    src_email: str = "",
    src_password: str = "",
    dst_email: str = "",
    dst_password: str = "",
    src_provider: dict | None = None,
    dst_provider: dict | None = None,
    folder_map: dict[str, str] | None = None,
) -> tuple[int, int, int]:
    """
    Migrate all messages from one folder.

    Returns (copied, skipped_dup, errors).
    """
    src_provider = src_provider or DST_PROVIDER
    dst_provider = dst_provider or DST_PROVIDER
    folder_map = folder_map or {}

    # Determine destination folder name (may differ from source)
    dst_folder = map_folder_name(folder, folder_map)
    copied = 0
    skipped_dup = 0
    errors = 0

    # Select source folder read-only
    try:
        src.select_folder(folder, readonly=True)
    except Exception as exc:
        log.error("Cannot select source folder '%s': %s", folder, exc)
        return copied, skipped_dup, 1

    # Ensure destination folder exists (may have a different name)
    ensure_folder_exists(dst, dst_folder)
    if dst_folder != folder:
        log.info("  %s → %s (folder mapped)", folder, dst_folder)

    # Get all UIDs in the source folder
    uids = src.search("ALL")
    if not uids:
        log.info("  %s: empty, skipping", folder)
        return copied, skipped_dup, errors

    # Filter out already-done UIDs (from checkpoint)
    done_uids_key = folder
    done_uids = set(progress["done_uids"].get(done_uids_key, []))
    remaining_uids = [u for u in uids if u not in done_uids]

    if limit is not None:
        remaining_uids = remaining_uids[:limit]

    total = len(remaining_uids)
    if total == 0:
        log.info("  %s: all %d messages already migrated", folder, len(uids))
        return copied, skipped_dup, errors

    log.info(
        "  %s: %d messages to migrate (%d already done)",
        folder,
        total,
        len(done_uids),
    )

    # Process in batches
    pbar = tqdm(total=total, desc=f"  {folder}", unit="msg", leave=True)

    for batch_start in range(0, total, BATCH_SIZE):
        batch_uids = remaining_uids[batch_start : batch_start + BATCH_SIZE]

        # Fetch with retries
        fetched = None
        for attempt in range(MAX_RETRIES):
            try:
                fetched = src.fetch(
                    batch_uids, ["RFC822", "FLAGS", "INTERNALDATE"]
                )
                break
            except Exception as exc:
                wait = RETRY_BACKOFF_BASE ** (attempt + 1)
                log.warning(
                    "Fetch error (attempt %d/%d) in '%s': %s — retrying in %ds",
                    attempt + 1,
                    MAX_RETRIES,
                    folder,
                    exc,
                    wait,
                )
                time.sleep(wait)
                # Try reconnecting source
                try:
                    src = connect(src_email, src_password,
                                  src_provider["host"], src_provider["port"])
                    src.select_folder(folder, readonly=True)
                except Exception:
                    pass

        if fetched is None:
            log.error(
                "Failed to fetch batch starting at UID %s in '%s' after %d retries",
                batch_uids[0],
                folder,
                MAX_RETRIES,
            )
            errors += len(batch_uids)
            pbar.update(len(batch_uids))
            continue

        for uid in batch_uids:
            if uid not in fetched:
                log.warning("UID %s not in fetch results for '%s'", uid, folder)
                errors += 1
                pbar.update(1)
                continue

            data = fetched[uid]
            raw = data.get(b"RFC822", data.get("RFC822"))
            flags = data.get(b"FLAGS", data.get("FLAGS", ()))
            internal_date = data.get(
                b"INTERNALDATE", data.get("INTERNALDATE")
            )

            if raw is None:
                log.warning("No RFC822 data for UID %s in '%s'", uid, folder)
                errors += 1
                pbar.update(1)
                continue

            # Deduplicate by Message-ID
            msg_id = get_message_id(raw)
            if msg_id and msg_id in seen_ids:
                skipped_dup += 1
                done_uids.add(uid)
                pbar.update(1)
                continue
            if msg_id:
                seen_ids.add(msg_id)

            # Clean flags — remove Gmail-internal flags that can't be set
            clean_flags = [
                f
                for f in flags
                if f not in (b"\\Recent",) and not f.startswith(b"\\")
                or f in (b"\\Seen", b"\\Flagged", b"\\Answered", b"\\Draft")
            ]

            # Append to destination with retries
            appended = False
            for attempt in range(MAX_RETRIES):
                try:
                    dst.append(
                        dst_folder,
                        raw,
                        flags=clean_flags,
                        msg_time=internal_date,
                    )
                    appended = True
                    break
                except Exception as exc:
                    wait = RETRY_BACKOFF_BASE ** (attempt + 1)
                    log.warning(
                        "Append error (attempt %d/%d) UID %s in '%s': %s — retrying in %ds",
                        attempt + 1,
                        MAX_RETRIES,
                        uid,
                        dst_folder,
                        exc,
                        wait,
                    )
                    time.sleep(wait)
                    try:
                        dst = connect(dst_email, dst_password,
                                      dst_provider["host"], dst_provider["port"])
                    except Exception:
                        pass

            if appended:
                copied += 1
                done_uids.add(uid)
            else:
                log.error(
                    "Failed to append UID %s in '%s' after %d retries",
                    uid,
                    folder,
                    MAX_RETRIES,
                )
                errors += 1

            pbar.update(1)

        # Checkpoint after each batch
        progress["done_uids"][done_uids_key] = list(done_uids)
        progress["current_folder"] = folder
        save_progress(progress)

        # Rate-limit pause
        time.sleep(BATCH_DELAY_SEC)

    pbar.close()
    return copied, skipped_dup, errors


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate emails from a Gmail or Apple (iCloud) account to Gmail via IMAP."
    )

    # --- Provider ---
    parser.add_argument(
        "--src-provider",
        choices=list(PROVIDERS.keys()),
        default="gmail",
        help="Source email provider: 'gmail' (default) or 'apple' (iCloud).",
    )

    # --- Credential arguments (override .env) ---
    parser.add_argument(
        "--src-email",
        help="Source email address (overrides SOURCE_EMAIL in .env).",
    )
    parser.add_argument(
        "--src-password",
        help="Source App Password (overrides SOURCE_APP_PASSWORD in .env).",
    )
    parser.add_argument(
        "--dst-email",
        help="Destination Gmail address (overrides DEST_EMAIL in .env).",
    )
    parser.add_argument(
        "--dst-password",
        help="Destination Gmail App Password (overrides DEST_APP_PASSWORD in .env).",
    )

    # --- Migration options ---
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List folders and message counts without copying anything.",
    )
    parser.add_argument(
        "--folders",
        nargs="+",
        help="Only migrate these specific folders (e.g., INBOX '[Gmail]/Sent Mail').",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max messages to copy per folder (for testing).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=BATCH_SIZE,
        help=f"Messages per batch (default: {BATCH_SIZE}).",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=BATCH_DELAY_SEC,
        help=f"Seconds to pause between batches (default: {BATCH_DELAY_SEC}).",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Ignore existing checkpoint and start fresh.",
    )
    return parser.parse_args()


def main() -> None:
    setup_logging()
    args = parse_args()

    # Update globals from args
    global BATCH_SIZE, BATCH_DELAY_SEC
    BATCH_SIZE = args.batch_size
    BATCH_DELAY_SEC = args.delay

    # Resolve provider configs
    src_provider = PROVIDERS[args.src_provider]
    dst_provider = DST_PROVIDER  # always Gmail
    log.info("Source provider: %s (%s)", args.src_provider, src_provider["host"])
    log.info("Destination provider: gmail (%s)", dst_provider["host"])

    # Determine folder mapping
    if args.src_provider == "apple":
        folder_map = FOLDER_MAP_APPLE_TO_GMAIL
    else:
        folder_map = {}  # gmail → gmail, no mapping needed

    # Load credentials — CLI args take precedence over .env
    load_dotenv()
    src_email = args.src_email or os.getenv("SOURCE_EMAIL")
    src_password = args.src_password or os.getenv("SOURCE_APP_PASSWORD")
    dst_email = args.dst_email or os.getenv("DEST_EMAIL")
    dst_password = args.dst_password or os.getenv("DEST_APP_PASSWORD")

    missing = []
    if not src_email:
        missing.append("--src-email / SOURCE_EMAIL")
    if not src_password:
        missing.append("--src-password / SOURCE_APP_PASSWORD")
    if not dst_email:
        missing.append("--dst-email / DEST_EMAIL")
    if not dst_password:
        missing.append("--dst-password / DEST_APP_PASSWORD")
    if missing:
        log.error(
            "Missing credentials: %s\n"
            "Provide via CLI flags or in a .env file (see .env.example).",
            ", ".join(missing),
        )
        sys.exit(1)

    # Connect to both accounts
    log.info("Connecting to source: %s", src_email)
    src = connect(src_email, src_password, src_provider["host"], src_provider["port"])

    log.info("Connecting to destination: %s", dst_email)
    dst = connect(dst_email, dst_password, dst_provider["host"], dst_provider["port"])

    # Discover folders
    folders = list_folders(src, src_provider["skip_folders"])
    if args.folders:
        folders = [f for f in folders if f in args.folders]
        if not folders:
            log.error("None of the specified folders were found on source.")
            sys.exit(1)

    log.info("Folders to migrate: %d", len(folders))

    # --- Dry run ---
    if args.dry_run:
        log.info("")
        log.info("=== DRY RUN — no emails will be copied ===")
        log.info("")
        total_messages = 0
        for folder in folders:
            dst_folder = map_folder_name(folder, folder_map)
            mapping_note = f" → {dst_folder}" if dst_folder != folder else ""
            try:
                info = src.select_folder(folder, readonly=True)
                count = info.get(b"EXISTS", info.get("EXISTS", "?"))
                log.info("  %-40s  %s messages%s", folder, count, mapping_note)
                if isinstance(count, int):
                    total_messages += count
            except Exception as exc:
                log.warning("  %-40s  ERROR: %s", folder, exc)
        log.info("")
        log.info("Total: ~%d messages (some may be duplicates across labels)", total_messages)
        src.logout()
        dst.logout()
        return

    # --- Full migration ---
    progress = load_progress() if not args.reset else {
        "completed_folders": [],
        "current_folder": None,
        "done_uids": {},
    }
    seen_ids: set[str] = set()

    total_copied = 0
    total_skipped = 0
    total_errors = 0
    start_time = time.time()

    log.info("")
    log.info("=== Starting migration ===")
    log.info("")

    for folder in folders:
        if folder in progress["completed_folders"]:
            log.info("  %s: already completed, skipping", folder)
            continue

        copied, skipped, errs = migrate_folder(
            src,
            dst,
            folder,
            progress,
            seen_ids,
            limit=args.limit,
            src_email=src_email,
            src_password=src_password,
            dst_email=dst_email,
            dst_password=dst_password,
            src_provider=src_provider,
            dst_provider=dst_provider,
            folder_map=folder_map,
        )

        total_copied += copied
        total_skipped += skipped
        total_errors += errs

        # Mark folder complete
        progress["completed_folders"].append(folder)
        progress["current_folder"] = None
        save_progress(progress)

    elapsed = time.time() - start_time
    elapsed_str = time.strftime("%H:%M:%S", time.gmtime(elapsed))

    log.info("")
    log.info("=== Migration complete ===")
    log.info("  Copied:            %d", total_copied)
    log.info("  Skipped (dupes):   %d", total_skipped)
    log.info("  Errors:            %d", total_errors)
    log.info("  Elapsed:           %s", elapsed_str)

    if total_errors > 0:
        log.warning("  Check %s for error details.", ERROR_LOG_FILE)

    # Clean up
    try:
        src.logout()
    except Exception:
        pass
    try:
        dst.logout()
    except Exception:
        pass


if __name__ == "__main__":
    main()
