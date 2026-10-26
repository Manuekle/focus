#!/usr/bin/env python3
"""Defensive repository inventory helper for AI security reviews.

Prints candidate files/lines related to auth, APIs, webhooks, execution,
AI tools, secrets, queues, RAG, and observability. It does not modify files.
"""

from __future__ import annotations
import argparse
import os
import re
from pathlib import Path

PATTERNS = {
    "auth": re.compile(r"auth|session|jwt|oauth|rbac|abac|permission", re.I),
    "webhook": re.compile(r"webhook|signature|idempotenc|event[_ -]?id", re.I),
    "execution": re.compile(r"exec\(|spawn\(|subprocess|shell=True|child_process|docker|sandbox", re.I),
    "ai_tools": re.compile(r"tool[_ -]?call|tools?\s*=|function[_ -]?call|agent|model|llm", re.I),
    "secrets": re.compile(r"secret|api[_ -]?key|access[_ -]?token|private[_ -]?key", re.I),
    "queue": re.compile(r"queue|worker|bullmq|rabbitmq|sqs|kafka|temporal", re.I),
    "rag": re.compile(r"embedding|vector|pgvector|rag|retriev|chunk", re.I),
    "observability": re.compile(r"trace|telemetry|audit|metric|logger|logging", re.I),
}

SKIP_DIRS = {".git", "node_modules", ".next", "dist", "build", "vendor", ".venv", "venv"}
TEXT_EXTS = {".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".kt", ".rb", ".php", ".cs", ".json", ".yaml", ".yml", ".toml", ".env", ".md"}


def iter_files(root: Path):
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            path = Path(base) / name
            if path.suffix.lower() in TEXT_EXTS or name.startswith(".env"):
                yield path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("--max-per-category", type=int, default=40)
    args = parser.parse_args()

    root = Path(args.root).resolve()
    hits = {k: [] for k in PATTERNS}

    for path in iter_files(root):
        try:
            text = path.read_text("utf-8", errors="ignore")
        except OSError:
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            for category, pattern in PATTERNS.items():
                if len(hits[category]) < args.max_per_category and pattern.search(line):
                    hits[category].append((path.relative_to(root), lineno, line.strip()[:180]))

    for category, rows in hits.items():
        print(f"\n## {category} ({len(rows)})")
        for path, lineno, line in rows:
            print(f"{path}:{lineno}: {line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
