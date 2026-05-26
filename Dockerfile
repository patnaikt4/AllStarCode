# ──────────────────────────────────────────────────────────────
# Stage 1 – builder
# Installs all deps (Node + Python), builds the Next.js app.
# ──────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

# System libs required by OpenCV and MediaPipe at runtime.
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    libgl1 libglib2.0-0 libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Python deps ──────────────────────────────────────────────
# Use a venv so the whole tree copies cleanly into the runner.
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir \
    -r backend/requirements.txt \
    mediapipe opencv-python-headless

# ── Node deps ─────────────────────────────────────────────────
# Copy lockfiles first so this layer is cached on dep-only changes.
COPY apps/web/package.json apps/web/package-lock.json ./apps/web/
RUN cd apps/web && npm ci

# ── Build ─────────────────────────────────────────────────────
COPY . .
RUN cd apps/web && npm run build


# ──────────────────────────────────────────────────────────────
# Stage 2 – runner
# Minimal image: built Next.js app + Python env + scripts.
# ──────────────────────────────────────────────────────────────
FROM node:20-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    libgl1 libglib2.0-0 libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Python venv from builder (includes mediapipe, opencv, openai, supabase, etc.)
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Next.js built output and runtime dependencies
COPY --from=builder /app/apps/web/.next        ./apps/web/.next
COPY --from=builder /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/next.config.ts ./apps/web/next.config.ts
COPY --from=builder /app/apps/web/tsconfig.json  ./apps/web/tsconfig.json

# Python scripts — the Next.js API spawns these as subprocesses at runtime
COPY --from=builder /app/scripts  ./scripts
COPY --from=builder /app/CvResearch ./CvResearch
COPY --from=builder /app/backend  ./backend

EXPOSE 3000

CMD ["sh", "-c", "cd /app/apps/web && node_modules/.bin/next start"]
