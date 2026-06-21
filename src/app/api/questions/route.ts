import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { questionIndex, questions } from "@/lib/questions";
import { readSession } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await readSession(await cookies());

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const wantsIndex = url.searchParams.get("index") === "true";

  if (wantsIndex) {
    return NextResponse.json(
      { index: questionIndex },
      {
        headers: {
          "Cache-Control": "private, max-age=300, stale-while-revalidate=3600"
        }
      }
    );
  }

  return NextResponse.json(
    { questions },
    {
      headers: {
        "Cache-Control": "private, max-age=300, stale-while-revalidate=3600"
      }
    }
  );
}
