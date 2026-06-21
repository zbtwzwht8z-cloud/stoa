import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { publicUsers, readSession } from "@/lib/server/auth";
import { readAllProgress, readReports, readUsers } from "@/lib/server/store";

export async function GET() {
  const user = await readSession(await cookies());

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await publicUsers();
  const userIds = users.map((entry) => entry.id);

  if (user.role === "admin") {
    const [managedUsers, reports, progress] = await Promise.all([
      readUsers(),
      readReports(),
      readAllProgress(userIds)
    ]);

    return NextResponse.json(
      {
        exportedAt: new Date().toISOString(),
        progress,
        reports,
        users: users
      },
      {
        headers: {
          "Content-Disposition": 'attachment; filename="mcq-trainer-export.json"'
        }
      }
    );
  }

  const [reports, progressByUser] = await Promise.all([
    readReports(),
    readAllProgress([user.id])
  ]);

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      progress: progressByUser[user.id] || null,
      reports: reports.filter((report) => report.userId === user.id)
    },
    {
      headers: {
        "Content-Disposition": 'attachment; filename="mcq-trainer-export.json"'
      }
    }
  );
}
