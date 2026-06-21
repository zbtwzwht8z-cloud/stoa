import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { StoredProgress } from "@/lib/types";
import { readSession } from "@/lib/server/auth";
import { emptyProgress, readProgress, writeProgress } from "@/lib/server/store";

export async function GET() {
  const user = await readSession(await cookies());

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const progress = (await readProgress(user.id)) || emptyProgress();

  return NextResponse.json({ progress });
}

export async function POST(request: Request) {
  const user = await readSession(await cookies());

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { progress?: StoredProgress };
  const progress = body.progress || emptyProgress();

  progress.updatedAt = new Date().toISOString();

  await writeProgress(user.id, progress);

  return NextResponse.json({ progress });
}
