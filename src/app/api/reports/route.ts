import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { QuestionReport } from "@/lib/types";
import { readSession } from "@/lib/server/auth";
import { readReports, updateReports } from "@/lib/server/store";

function id() {
  return `report-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function GET() {
  const user = await readSession(await cookies());

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const reports = await readReports();
  const visible =
    user.role === "admin"
      ? reports
      : reports.filter((report) => report.userId === user.id);

  return NextResponse.json({ reports: visible });
}

export async function POST(request: Request) {
  const user = await readSession(await cookies());

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as Pick<
    QuestionReport,
    "questionId" | "type" | "text"
  >;

  if (!body.questionId || !body.text?.trim()) {
    return NextResponse.json({ error: "Missing report details" }, { status: 400 });
  }

  const report: QuestionReport = {
    id: id(),
    questionId: body.questionId,
    userId: user.id,
    type: body.type || "other",
    text: body.text.trim(),
    status: "open",
    createdAt: new Date().toISOString()
  };

  await updateReports((reports) => {
    reports.unshift(report);
  });

  return NextResponse.json({ report });
}

export async function PATCH(request: Request) {
  const user = await readSession(await cookies());

  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as {
    id?: string;
    status?: QuestionReport["status"];
    resolution?: string;
  };

  let updated: QuestionReport | null = null;

  await updateReports((reports) => {
    const report = reports.find((item) => item.id === body.id);

    if (!report) {
      return;
    }

    report.status = body.status || report.status;
    report.resolution = body.resolution || report.resolution;
    report.resolvedAt =
      report.status === "resolved" ? new Date().toISOString() : undefined;
    updated = report;
  });

  if (!updated) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  return NextResponse.json({ report: updated });
}
