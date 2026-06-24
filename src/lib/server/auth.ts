import { createHmac, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import type { ReadonlyRequestCookies } from "next/dist/server/web/spec-extension/adapters/request-cookies";
import type { ManagedTrainerUser, TrainerUser } from "@/lib/types";
import { readUsers, writeUsers } from "@/lib/server/store";

export type ConfiguredUser = ManagedTrainerUser & {
  managed?: boolean;
};

const COOKIE_NAME = "trainer_session";
const SESSION_DAYS = 14;
const HASH_PREFIX = "scrypt$";

// Hard ban list (compared case-insensitively against id and name). Banned
// accounts are filtered out of the runtime user list, so they cannot log in,
// don't show up in the admin panel, and any existing session is invalidated —
// regardless of whether they come from TRAINER_USERS or the KV store. Remove an
// entry here to lift the ban.
const BANNED_LOGINS = new Set(["alaaaala"]);

function isBanned(user: { id: string; name: string }) {
  return (
    BANNED_LOGINS.has(user.id.trim().toLowerCase()) ||
    BANNED_LOGINS.has(user.name.trim().toLowerCase())
  );
}

function secret() {
  return process.env.APP_SECRET || process.env.TRAINER_PASSWORD || "local-dev-secret";
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function equal(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

// --- Password hashing (scrypt) ---

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${HASH_PREFIX}${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith(HASH_PREFIX)) {
    const withoutPrefix = stored.slice(HASH_PREFIX.length);
    const separator = withoutPrefix.indexOf("$");
    if (separator === -1) {
      return false;
    }
    const salt = withoutPrefix.slice(0, separator);
    const hash = withoutPrefix.slice(separator + 1);
    const test = scryptSync(password, salt, 64).toString("hex");
    return equal(hash, test);
  }

  // Legacy plaintext password — compare directly.
  return equal(password, stored);
}

export function isPasswordHashed(stored: string): boolean {
  return stored.startsWith(HASH_PREFIX);
}

export function getConfiguredUsers(): ConfiguredUser[] {
  if (process.env.TRAINER_USERS) {
    try {
      const parsed = JSON.parse(process.env.TRAINER_USERS) as ConfiguredUser[];

      return parsed.map((user) => ({
        id: user.id || user.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: user.name,
        password: user.password,
        role: user.role || "member"
      }));
    } catch {
      throw new Error("TRAINER_USERS must be valid JSON");
    }
  }

  if (process.env.TRAINER_USER && process.env.TRAINER_PASSWORD) {
    return [
      {
        id: process.env.TRAINER_USER,
        name: process.env.TRAINER_USER,
        password: process.env.TRAINER_PASSWORD,
        role: "admin"
      }
    ];
  }

  return [
    {
      id: "admin",
      name: "admin",
      password: "admin123",
      role: "admin"
    }
  ];
}

function publicUser(user: ConfiguredUser): TrainerUser {
  const { password: _password, ...safeUser } = user;

  return safeUser;
}

export async function getRuntimeUsers(): Promise<ConfiguredUser[]> {
  const configured = getConfiguredUsers().map((user) => ({
    ...user,
    managed: false
  }));
  const configuredIds = new Set(configured.map((user) => user.id));
  const managed = (await readUsers())
    .filter((user) => !configuredIds.has(user.id))
    .map((user) => ({
      ...user,
      managed: true
    }));

  return [...configured, ...managed].filter((user) => !isBanned(user));
}

export async function publicUsers() {
  return (await getRuntimeUsers()).map(publicUser);
}

export async function findUser(name: string) {
  const normalized = name.trim().toLowerCase();

  return (await getRuntimeUsers()).find(
    (user) =>
      user.id.toLowerCase() === normalized || user.name.toLowerCase() === normalized
  );
}

export async function verifyUser(name: string, password: string) {
  const user = await findUser(name);

  if (!user || user.disabled || !verifyPassword(password, user.password)) {
    return null;
  }

  // Auto-upgrade legacy plaintext passwords to scrypt hashes on first login.
  if (user.managed && !isPasswordHashed(user.password)) {
    const hashed = hashPassword(password);
    const managed = await readUsers();
    const index = managed.findIndex((entry) => entry.id === user.id);

    if (index !== -1) {
      managed[index] = { ...managed[index], password: hashed };
      await writeUsers(managed);
    }
  }

  return publicUser(user);
}

export function createSession(userId: string) {
  const payload = base64Url(
    JSON.stringify({
      userId,
      exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
    })
  );

  return `${payload}.${sign(payload)}`;
}

export async function readSession(cookies: ReadonlyRequestCookies) {
  const raw = cookies.get(COOKIE_NAME)?.value;

  if (!raw) {
    return null;
  }

  const [payload, signature] = raw.split(".");

  if (!payload || !signature || !equal(signature, sign(payload))) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      userId: string;
      exp: number;
    };

    if (!session.userId || session.exp < Date.now()) {
      return null;
    }

    return (
      (await publicUsers()).find(
        (user) => user.id === session.userId && !user.disabled
      ) || null
    );
  } catch {
    return null;
  }
}

export const authCookie = {
  name: COOKIE_NAME,
  options: {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60
  }
};
