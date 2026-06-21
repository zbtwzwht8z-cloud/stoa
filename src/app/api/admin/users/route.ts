import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { ManagedTrainerUser, TrainerUser } from "@/lib/types";
import {
  getConfiguredUsers,
  getRuntimeUsers,
  hashPassword,
  readSession,
  type ConfiguredUser
} from "@/lib/server/auth";
import { updateUsers } from "@/lib/server/store";

const MAX_USER_ID_LENGTH = 64;
const MAX_NAME_LENGTH = 100;
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

type JsonObject = Record<string, unknown>;
type MutationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

class RequestValidationError extends Error {}

// updateState is read-modify-write, so serialize admin mutations in this instance.
let mutationQueue: Promise<void> = Promise.resolve();

function normalizeUserId(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function loginKey(value: string) {
  return value.trim().toLowerCase();
}

function userIdKey(value: string) {
  return normalizeUserId(value) || loginKey(value);
}

function publicUser(user: ManagedTrainerUser): TrainerUser {
  const { password: _password, ...safeUser } = user;

  return safeUser;
}

function validationError(message: string): never {
  throw new RequestValidationError(message);
}

async function readJsonObject(request: Request): Promise<JsonObject> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return validationError("Request body must be valid JSON");
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return validationError("Request body must be a JSON object");
  }

  return body as JsonObject;
}

function validateName(value: unknown) {
  if (typeof value !== "string") {
    return validationError("Name must be a string");
  }

  const name = value.trim();

  if (!name) {
    return validationError("Name is required");
  }

  if (name.length > MAX_NAME_LENGTH) {
    return validationError(`Name must be ${MAX_NAME_LENGTH} characters or fewer`);
  }

  if (CONTROL_CHARACTERS.test(name)) {
    return validationError("Name cannot contain control characters");
  }

  return name;
}

function validateUserId(value: unknown) {
  if (typeof value !== "string") {
    return validationError("User ID must be a string");
  }

  const userId = normalizeUserId(value);

  if (!userId) {
    return validationError("User ID must contain at least one letter or number");
  }

  if (userId.length > MAX_USER_ID_LENGTH) {
    return validationError(
      `User ID must be ${MAX_USER_ID_LENGTH} characters or fewer after normalization`
    );
  }

  return userId;
}

function validatePassword(value: unknown) {
  if (typeof value !== "string") {
    return validationError("Password must be a string");
  }

  if (value.length < MIN_PASSWORD_LENGTH) {
    return validationError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    );
  }

  if (value.length > MAX_PASSWORD_LENGTH) {
    return validationError(
      `Password must be ${MAX_PASSWORD_LENGTH} characters or fewer`
    );
  }

  if (!value.trim() || CONTROL_CHARACTERS.test(value)) {
    return validationError("Password cannot be blank or contain control characters");
  }

  return value;
}

function validateRole(value: unknown): TrainerUser["role"] {
  if (value !== "admin" && value !== "member") {
    return validationError('Role must be either "admin" or "member"');
  }

  return value;
}

function hasOwn(body: JsonObject, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function parseCreateInput(body: JsonObject) {
  const name = validateName(body.name);
  const password = validatePassword(body.password);
  const idSource = hasOwn(body, "id") ? body.id : name;

  return {
    id: validateUserId(idSource),
    name,
    password,
    role: hasOwn(body, "role") ? validateRole(body.role) : "member"
  } satisfies Pick<ManagedTrainerUser, "id" | "name" | "password" | "role">;
}

function parseUpdateInput(body: JsonObject) {
  if (!hasOwn(body, "id")) {
    return validationError("User ID is required");
  }

  const id = validateUserId(body.id);
  const changes: Partial<
    Pick<ManagedTrainerUser, "name" | "password" | "role" | "disabled">
  > = {};

  if (hasOwn(body, "name")) {
    changes.name = validateName(body.name);
  }

  if (hasOwn(body, "password")) {
    changes.password = validatePassword(body.password);
  }

  if (hasOwn(body, "role")) {
    changes.role = validateRole(body.role);
  }

  if (hasOwn(body, "disabled")) {
    if (typeof body.disabled !== "boolean") {
      return validationError("Disabled must be a boolean");
    }

    changes.disabled = body.disabled;
  }

  if (Object.keys(changes).length === 0) {
    return validationError("Provide at least one user field to update");
  }

  return { id, changes };
}

function identityConflict(
  candidate: Pick<TrainerUser, "id" | "name">,
  users: Array<Pick<TrainerUser, "id" | "name">>
) {
  const existingKeys = new Set<string>();

  for (const user of users) {
    existingKeys.add(loginKey(user.id));
    existingKeys.add(userIdKey(user.id));
    existingKeys.add(loginKey(user.name));
  }

  if (
    existingKeys.has(loginKey(candidate.id)) ||
    existingKeys.has(userIdKey(candidate.id))
  ) {
    return "User ID is already in use";
  }

  if (existingKeys.has(loginKey(candidate.name))) {
    return "User name is already in use";
  }

  return null;
}

function findUserById<T extends Pick<TrainerUser, "id">>(users: T[], id: string) {
  return users.find((item) => userIdKey(item.id) === id);
}

function hasEnabledAdmin(
  configuredUsers: ConfiguredUser[],
  managedUsers: ManagedTrainerUser[]
) {
  const configuredIds = new Set(configuredUsers.map((item) => item.id));
  const runtimeManagedUsers = managedUsers.filter(
    (item) => !configuredIds.has(item.id)
  );

  return [...configuredUsers, ...runtimeManagedUsers].some(
    (item) => item.role === "admin" && !item.disabled
  );
}

function mutationError(error: string, status: number): MutationResult<never> {
  return { ok: false, error, status };
}

async function serializeMutation<T>(operation: () => Promise<T>) {
  const result = mutationQueue.then(operation, operation);

  mutationQueue = result.then(
    () => undefined,
    () => undefined
  );

  return result;
}

function invalidRequestResponse(error: unknown) {
  if (error instanceof RequestValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  throw error;
}

async function requireAdmin() {
  const user = await readSession(await cookies());

  return user?.role === "admin" ? user : null;
}

export async function GET() {
  const user = await requireAdmin();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = (await getRuntimeUsers()).map(publicUser);

  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const user = await requireAdmin();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: ReturnType<typeof parseCreateInput>;

  try {
    input = parseCreateInput(await readJsonObject(request));
  } catch (error) {
    return invalidRequestResponse(error);
  }

  const configuredUsers = getConfiguredUsers();
  const newUser: ManagedTrainerUser = {
    ...input,
    password: hashPassword(input.password),
    disabled: false,
    managed: true,
    createdAt: new Date().toISOString()
  };

  const result = await serializeMutation(() =>
    updateUsers<MutationResult<ManagedTrainerUser>>((users) => {
      const conflict = identityConflict(newUser, [
        ...configuredUsers,
        ...users
      ]);

      if (conflict) {
        return mutationError(conflict, 409);
      }

      users.push(newUser);

      return { ok: true, value: newUser };
    })
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({ user: publicUser(result.value) }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await requireAdmin();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let input: ReturnType<typeof parseUpdateInput>;

  try {
    input = parseUpdateInput(await readJsonObject(request));
  } catch (error) {
    return invalidRequestResponse(error);
  }

  const configuredUsers = getConfiguredUsers();

  if (findUserById(configuredUsers, input.id)) {
    return NextResponse.json(
      { error: "Configured users cannot be edited here" },
      { status: 403 }
    );
  }

  const result = await serializeMutation(() =>
    updateUsers<MutationResult<ManagedTrainerUser>>((users) => {
      const targetIndex = users.findIndex(
        (item) => userIdKey(item.id) === input.id
      );

      if (targetIndex === -1) {
        return mutationError("Managed user not found", 404);
      }

      const target = users[targetIndex];
      const isCurrentUser = userIdKey(target.id) === userIdKey(user.id);

      if (isCurrentUser && input.changes.disabled === true) {
        return mutationError("You cannot disable your own account", 409);
      }

      if (isCurrentUser && input.changes.role === "member") {
        return mutationError("You cannot demote your own admin account", 409);
      }

      const changes = input.changes.password
        ? { ...input.changes, password: hashPassword(input.changes.password) }
        : input.changes;

      const updatedUser: ManagedTrainerUser = {
        ...target,
        ...changes
      };
      const otherUsers = users.filter((_, index) => index !== targetIndex);
      const conflict = identityConflict(updatedUser, [
        ...configuredUsers,
        ...otherUsers
      ]);

      if (conflict) {
        return mutationError(conflict, 409);
      }

      const nextUsers = [...users];

      nextUsers[targetIndex] = updatedUser;

      if (!hasEnabledAdmin(configuredUsers, nextUsers)) {
        return mutationError("At least one enabled admin account is required", 409);
      }

      users.length = 0;
      users.push(...nextUsers);

      return { ok: true, value: updatedUser };
    })
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({ user: publicUser(result.value) });
}

export async function DELETE(request: Request) {
  const user = await requireAdmin();
  const rawId = new URL(request.url).searchParams.get("id");

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let id: string;

  try {
    id = validateUserId(rawId);
  } catch (error) {
    if (rawId === null) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    return invalidRequestResponse(error);
  }

  if (userIdKey(user.id) === id) {
    return NextResponse.json(
      { error: "You cannot delete your own account" },
      { status: 409 }
    );
  }

  const configuredUsers = getConfiguredUsers();

  if (findUserById(configuredUsers, id)) {
    return NextResponse.json(
      { error: "Configured users cannot be deleted here" },
      { status: 403 }
    );
  }

  const result = await serializeMutation(() =>
    updateUsers<MutationResult<true>>((users) => {
      const targetIndex = users.findIndex(
        (item) => userIdKey(item.id) === id
      );

      if (targetIndex === -1) {
        return mutationError("Managed user not found", 404);
      }

      const nextUsers = users.filter((_, index) => index !== targetIndex);

      if (!hasEnabledAdmin(configuredUsers, nextUsers)) {
        return mutationError("At least one enabled admin account is required", 409);
      }

      users.length = 0;
      users.push(...nextUsers);

      return { ok: true, value: true };
    })
  );

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status }
    );
  }

  return NextResponse.json({ ok: true });
}
