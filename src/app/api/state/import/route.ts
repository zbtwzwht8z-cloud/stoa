import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { StoredProgress } from "@/lib/types";
import { readSession } from "@/lib/server/auth";
import { writeProgress } from "@/lib/server/store";

export async function POST(request: Request) {
  const user = await readSession(await cookies());

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { progress?: StoredProgress };

  if (!body.progress?.answers) {
    return NextResponse.json({ error: "Import file missing progress" }, { status: 400 });
  }

  body.progress.updatedAt = new Date().toISOString();

  await writeProgress(user.id, body.progress);

  return NextResponse.json({ progress: body.progress });
}
