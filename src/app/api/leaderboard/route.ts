import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { LeaderboardEntry, StoredProgress } from "@/lib/types";
import { publicUsers, readSession } from "@/lib/server/auth";
import { readAllProgress } from "@/lib/server/store";

export async function GET() {
  const user = await readSession(await cookies());

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await publicUsers();
  const userIds = users.map((entry) => entry.id);
  const progressByUser = await readAllProgress(userIds);

  return NextResponse.json({
    leaderboard: leaderboardFromProgress(users, progressByUser)
  });
}

function leaderboardFromProgress(
  users: { id: string; name: string }[],
  progressByUser: Record<string, StoredProgress>
): LeaderboardEntry[] {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return users
    .map((user) => {
      const answers = Object.values(progressByUser[user.id]?.answers || {});
      const graded = answers.filter((answer) => answer.correct !== undefined);
      const correct = graded.filter((answer) => answer.correct).length;
      const weeklyAnswered = answers.filter(
        (answer) => new Date(answer.answeredAt).getTime() >= weekAgo
      ).length;

      return {
        userId: user.id,
        name: user.name,
        answered: answers.length,
        correct,
        accuracy: graded.length ? Math.round((correct / graded.length) * 100) : 0,
        weeklyAnswered
      };
    })
    .sort((left, right) => right.weeklyAnswered - left.weeklyAnswered);
}
