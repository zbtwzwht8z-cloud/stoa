import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ManagedTrainerUser, QuestionReport, StoredProgress } from "@/lib/types";

// Per-key storage schema (was a single blob under STATE_KEY):
//   stoa:users             → JSON ManagedTrainerUser[]
//   stoa:reports           → JSON QuestionReport[]
//   stoa:progress:{userId} → JSON StoredProgress
//
// Each key is read/written independently, so concurrent users answering
// questions no longer clobber each other's progress, and admin user mutations
// don't risk trampling report submissions.

const LEGACY_STATE_KEY = "private-mcq-trainer-state-v1";
const USERS_KEY = "stoa:users";
const REPORTS_KEY = "stoa:reports";
const PROGRESS_KEY_PREFIX = "stoa:progress:";
const LOCAL_STATE_PATH = path.join(process.cwd(), ".local-data", "trainer-state.json");

type TrainerState = {
  progress: Record<string, StoredProgress>;
  reports: QuestionReport[];
  users: ManagedTrainerUser[];
};

function progressKey(userId: string) {
  return `${PROGRESS_KEY_PREFIX}${userId}`;
}

function kvUrl() {
  return (
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ""
  ).replace(/\/$/, "");
}

function kvToken() {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
}

function hasKv() {
  return Boolean(kvUrl() && kvToken());
}

async function kvGet<T>(key: string): Promise<T | null> {
  if (!hasKv()) {
    return null;
  }

  const response = await fetch(`${kvUrl()}/get/${key}`, {
    headers: { Authorization: `Bearer ${kvToken()}` },
    cache: "no-store"
  });

  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as { result: unknown };

  if (body.result === null || body.result === undefined) {
    return null;
  }

  return typeof body.result === "string"
    ? (JSON.parse(body.result) as T)
    : (body.result as T);
}

async function kvSet(key: string, value: unknown): Promise<boolean> {
  if (!hasKv()) {
    return false;
  }

  const response = await fetch(`${kvUrl()}/set/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(value),
    cache: "no-store"
  });

  return response.ok;
}

// Pipeline: POST array of commands, get array of results.
async function kvPipeline<T = unknown>(
  commands: Array<[string, ...string[]]>
): Promise<Array<{ result: T }>> {
  if (!hasKv() || !commands.length) {
    return [];
  }

  const response = await fetch(kvUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${kvToken()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(commands),
    cache: "no-store"
  });

  if (!response.ok) {
    return [];
  }

  return (await response.json()) as Array<{ result: T }>;
}

// --- Local file fallback (mirrors the whole blob) ---

async function readLocalFile(): Promise<TrainerState | null> {
  try {
    const raw = await readFile(LOCAL_STATE_PATH, "utf8");
    return JSON.parse(raw) as TrainerState;
  } catch {
    return null;
  }
}

async function writeLocalFile(state: TrainerState) {
  await mkdir(path.dirname(LOCAL_STATE_PATH), { recursive: true });
  await writeFile(LOCAL_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

// --- Migration from legacy single-blob key ---

let migrationPromise: Promise<void> | null = null;

async function migrateFromLegacy() {
  if (migrationPromise) {
    return migrationPromise;
  }

  migrationPromise = (async () => {
    // Check if new keys already exist (already migrated).
    const existingUsers = await kvGet<ManagedTrainerUser[]>(USERS_KEY);
    if (existingUsers !== null) {
      return;
    }

    // Read legacy blob.
    const legacy = await kvGet<TrainerState>(LEGACY_STATE_KEY);
    const source = legacy || (await readLocalFile());

    if (!source) {
      return;
    }

    // Write each piece independently.
    await Promise.all([
      kvSet(USERS_KEY, source.users || []),
      kvSet(REPORTS_KEY, source.reports || []),
      ...Object.entries(source.progress || {}).map(([userId, progress]) =>
        kvSet(progressKey(userId), progress)
      )
    ]);
  })();

  return migrationPromise;
}

// --- Users ---

export async function readUsers(): Promise<ManagedTrainerUser[]> {
  if (hasKv()) {
    await migrateFromLegacy();
    const users = await kvGet<ManagedTrainerUser[]>(USERS_KEY);
    if (users) {
      return users;
    }
    return [];
  }

  const local = await readLocalFile();
  return local?.users || [];
}

export async function writeUsers(users: ManagedTrainerUser[]) {
  if (hasKv()) {
    await kvSet(USERS_KEY, users);
    return;
  }

  const local = (await readLocalFile()) || {
    progress: {},
    reports: [],
    users: []
  };
  local.users = users;
  await writeLocalFile(local);
}

export async function updateUsers<T>(
  mutator: (users: ManagedTrainerUser[]) => T | Promise<T>
): Promise<T> {
  const users = await readUsers();
  const result = await mutator(users);
  await writeUsers(users);
  return result;
}

// --- Progress ---

export async function readProgress(userId: string): Promise<StoredProgress | null> {
  if (hasKv()) {
    await migrateFromLegacy();
    return kvGet<StoredProgress>(progressKey(userId));
  }

  const local = await readLocalFile();
  return local?.progress?.[userId] || null;
}

export async function writeProgress(userId: string, progress: StoredProgress) {
  if (hasKv()) {
    await kvSet(progressKey(userId), progress);
    return;
  }

  const local = (await readLocalFile()) || {
    progress: {},
    reports: [],
    users: []
  };
  local.progress[userId] = progress;
  await writeLocalFile(local);
}

export async function readAllProgress(
  userIds: string[]
): Promise<Record<string, StoredProgress>> {
  if (!userIds.length) {
    return {};
  }

  if (hasKv()) {
    await migrateFromLegacy();
    const commands = userIds.map((userId) => ["GET", progressKey(userId)] as [string, string]);
    const results = await kvPipeline<unknown>(commands);
    const progress: Record<string, StoredProgress> = {};

    results.forEach((entry, index) => {
      const raw = entry.result;
      if (raw === null || raw === undefined) {
        return;
      }
      const value =
        typeof raw === "string" ? (JSON.parse(raw) as StoredProgress) : (raw as StoredProgress);
      progress[userIds[index]] = value;
    });

    return progress;
  }

  const local = await readLocalFile();
  const progress: Record<string, StoredProgress> = {};
  for (const userId of userIds) {
    const entry = local?.progress?.[userId];
    if (entry) {
      progress[userId] = entry;
    }
  }
  return progress;
}

// --- Reports ---

export async function readReports(): Promise<QuestionReport[]> {
  if (hasKv()) {
    await migrateFromLegacy();
    const reports = await kvGet<QuestionReport[]>(REPORTS_KEY);
    return reports || [];
  }

  const local = await readLocalFile();
  return local?.reports || [];
}

export async function writeReports(reports: QuestionReport[]) {
  if (hasKv()) {
    await kvSet(REPORTS_KEY, reports);
    return;
  }

  const local = (await readLocalFile()) || {
    progress: {},
    reports: [],
    users: []
  };
  local.reports = reports;
  await writeLocalFile(local);
}

export async function updateReports<T>(
  mutator: (reports: QuestionReport[]) => T | Promise<T>
): Promise<T> {
  const reports = await readReports();
  const result = await mutator(reports);
  await writeReports(reports);
  return result;
}

// --- Full state (export/admin only) ---

export async function readFullState(userIds: string[]): Promise<TrainerState> {
  const [users, reports, progress] = await Promise.all([
    readUsers(),
    readReports(),
    readAllProgress(userIds)
  ]);

  return { users, reports, progress };
}

// --- Backward-compatible helpers ---

export function emptyProgress(): StoredProgress {
  return {
    answers: {},
    bookmarks: [],
    bookmarkFolders: [
      {
        id: "default",
        name: "Gespeichert",
        color: "#216e62",
        questionIds: [],
        createdAt: new Date().toISOString()
      }
    ],
    activeFolderId: "default",
    sessionLog: []
  };
}
