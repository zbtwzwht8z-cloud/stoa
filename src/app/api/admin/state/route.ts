import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicUsers, readSession } from "@/lib/server/auth";
import { readReports, readUsers } from "@/lib/server/store";

export async function GET() {
  const user = await readSession(await cookies());

  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [users, reports, allUsers] = await Promise.all([
    publicUsers(),
    readReports(),
    readUsers()
  ]);

  return NextResponse.json({
    users,
    reports,
    progressUsers: allUsers.length,
    openReports: reports.filter((report) => report.status === "open").length,
    storage: process.env.KV_REST_API_URL ? "Vercel KV / Upstash REST" : "Local file"
  });
}
