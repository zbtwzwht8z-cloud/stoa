"use client";

import {
  AlertTriangle,
  BookMarked,
  BookOpenCheck,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  FileWarning,
  Gauge,
  History,
  Import,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  NotebookPen,
  Play,
  RotateCcw,
  Search,
  Shield,
  Timer,
  Trash2,
  Upload,
  UserPlus,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import PapersView from "@/components/PapersView";
import StoaLanding from "@/components/StoaLanding";
import {
  Button,
  Field,
  Input,
  List,
  ListRow,
  Select,
  Stat,
  cn
} from "@/components/ui";
import {
  CURRICULUM_SEMESTERS,
  UNASSIGNED_SEMESTER,
  semesterForSubject
} from "@/lib/curriculum";
import { buildCurriculum } from "@/lib/papers";
import { compareTopicBySemester, questionSemesterKey } from "@/lib/semesters";
import {
  LANG_STORAGE_KEY,
  createTranslator,
  type Lang
} from "@/lib/i18n";
import type {
  BookmarkFolder,
  LeaderboardEntry,
  Question,
  QuestionMetrics,
  QuestionReport,
  PaperSummary,
  StoredAnswer,
  StoredProgress,
  StudySessionLog,
  TrainerUser
} from "@/lib/types";
import { progressStats, subjectStats } from "@/lib/stats";

type TrainerAppProps = {
  questionMetrics: QuestionMetrics;
};

type View =
  | "dashboard"
  | "subjects"
  | "trainer"
  | "sessions"
  | "search"
  | "mistakes"
  | "bookmarks"
  | "admin";
type SessionMode = "study" | "exam" | "review";
type Pool = "all" | "unanswered" | "wrong" | "bookmarked";
type SessionOrder = "latest" | "oldest" | "subject" | "random";
type ReportType = QuestionReport["type"];

const STORAGE_KEY = "private-mcq-trainer-progress-v2";
const LEGACY_STORAGE_KEY = "private-mcq-trainer-progress";
const LOCAL_SW_CLEANUP_KEY = "stoa-local-service-worker-cleaned";
const DEFAULT_COUNT = 40;

const navItems: Array<{
  view: View;
  label: string;
  icon: typeof LayoutDashboard;
  admin?: boolean;
}> = [
  { view: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { view: "subjects", label: "Papers", icon: BookOpenCheck },
  { view: "trainer", label: "Trainer", icon: Play },
  { view: "sessions", label: "Sessions", icon: History },
  { view: "search", label: "Search", icon: Search },
  { view: "mistakes", label: "Mistakes", icon: NotebookPen },
  { view: "bookmarks", label: "Bookmarks", icon: BookMarked },
  { view: "admin", label: "Admin", icon: Shield, admin: true }
];

function now() {
  return new Date().toISOString();
}

function id(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function clean(value: string) {
  return value.toLowerCase().trim();
}

function sortUnique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function formatPercent(value: number) {
  return `${Math.round(Number.isFinite(value) ? value : 0)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function shuffleItems<T>(items: T[]) {
  const result = [...items];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }

  return result;
}

function orderQuestions(items: Question[], order: SessionOrder) {
  if (order === "random") {
    return shuffleItems(items);
  }

  return [...items].sort((left, right) => {
    const leftSemester = questionSemesterKey(left);
    const rightSemester = questionSemesterKey(right);

    if (order === "subject") {
      const subject = left.subject.localeCompare(right.subject);

      if (subject) {
        return subject;
      }

      return compareTopicBySemester(left.topic, right.topic);
    }

    const semester = compareTopicBySemester(left.topic, right.topic);

    if (semester) {
      return order === "oldest" ? -semester : semester;
    }

    return order === "oldest"
      ? leftSemester.localeCompare(rightSemester)
      : rightSemester.localeCompare(leftSemester);
  });
}

function defaultFolder(): BookmarkFolder {
  return {
    id: "default",
    name: "Saved",
    color: "#216e62",
    questionIds: [],
    createdAt: now()
  };
}

function emptyProgress(): StoredProgress {
  return {
    answers: {},
    bookmarks: [],
    bookmarkFolders: [defaultFolder()],
    activeFolderId: "default",
    sessionLog: []
  };
}

function normalizeProgress(progress?: StoredProgress | null): StoredProgress {
  const base = progress || emptyProgress();
  const folders =
    base.bookmarkFolders && base.bookmarkFolders.length
      ? base.bookmarkFolders
      : [defaultFolder()];
  const legacyBookmarks = Array.isArray(base.bookmarks) ? base.bookmarks : [];
  const firstFolder = folders[0] || defaultFolder();
  const folderIds = new Set(firstFolder.questionIds || []);

  for (const questionId of legacyBookmarks) {
    folderIds.add(questionId);
  }

  return {
    answers: base.answers || {},
    bookmarks: Array.from(
      new Set([
        ...legacyBookmarks,
        ...folders.flatMap((folder) => folder.questionIds || [])
      ])
    ),
    bookmarkFolders: [
      {
        ...firstFolder,
        questionIds: Array.from(folderIds)
      },
      ...folders.slice(1).map((folder) => ({
        ...folder,
        questionIds: Array.from(new Set(folder.questionIds || []))
      }))
    ],
    activeFolderId: base.activeFolderId || folders[0]?.id || "default",
    sessionLog: Array.isArray(base.sessionLog) ? base.sessionLog : [],
    updatedAt: base.updatedAt
  };
}

function loadLocalProgress() {
  if (typeof window === "undefined") {
    return emptyProgress();
  }

  const raw =
    window.localStorage.getItem(STORAGE_KEY) ||
    window.localStorage.getItem(LEGACY_STORAGE_KEY);

  if (!raw) {
    return emptyProgress();
  }

  try {
    return normalizeProgress(JSON.parse(raw) as StoredProgress);
  } catch {
    return emptyProgress();
  }
}

function questionText(question: Question) {
  return clean(
    [
      question.stem,
      question.subject,
      question.topic,
      question.source,
      question.modelAnswer,
      ...(question.tags || []),
      ...(question.notes || []),
      ...question.choices.map((choice) => choice.text)
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function proxiedImage(src?: string) {
  return src ? `/api/image?src=${encodeURIComponent(src)}` : undefined;
}

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));

    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export default function TrainerApp({ questionMetrics }: TrainerAppProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsReady, setQuestionsReady] = useState(false);
  const [questionsError, setQuestionsError] = useState("");
  const [view, setView] = useState<View>("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const [lang, setLang] = useState<Lang>("en");
  const [user, setUser] = useState<TrainerUser | null>(null);
  const [users, setUsers] = useState<TrainerUser[]>([]);
  const [devLogin, setDevLogin] = useState<null | { username: string; password: string }>(
    null
  );
  const [loginName, setLoginName] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [progress, setProgress] = useState<StoredProgress>(() => loadLocalProgress());
  const [ready, setReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"local" | "syncing" | "synced" | "offline">(
    "local"
  );
  const [online, setOnline] = useState(true);
  const [offlineReady, setOfflineReady] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [reports, setReports] = useState<QuestionReport[]>([]);
  const [adminState, setAdminState] = useState<null | {
    progressUsers: number;
    openReports: number;
    storage: string;
  }>(null);

  const [selectedSemester, setSelectedSemester] = useState("all");
  const [papersSemester, setPapersSemester] = useState("");
  const [selectedSubject, setSelectedSubject] = useState("Allgemeinmedizin");
  const [selectedTopic, setSelectedTopic] = useState("all");
  const [query, setQuery] = useState("");
  const [pool, setPool] = useState<Pool>("all");
  const [mode, setMode] = useState<SessionMode>("study");
  const [sessionOrder, setSessionOrder] = useState<SessionOrder>("latest");
  const [sessionCount, setSessionCount] = useState(DEFAULT_COUNT);
  const [sessionIds, setSessionIds] = useState<string[]>([]);
  const [activeSessionLogId, setActiveSessionLogId] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [examAnswers, setExamAnswers] = useState<Record<string, string>>({});
  const [examFinished, setExamFinished] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState(now());
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [selectedMistakeIds, setSelectedMistakeIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [newFolderName, setNewFolderName] = useState("");
  const [reportType, setReportType] = useState<ReportType>("wrong-answer");
  const [reportText, setReportText] = useState("");
  const [newUserName, setNewUserName] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<TrainerUser["role"]>("member");
  const [editingPasswords, setEditingPasswords] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [queueOpen, setQueueOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stemRef = useRef<HTMLDivElement>(null);

  const questionById = useMemo(
    () => new Map(questions.map((question) => [question.id, question])),
    [questions]
  );
  const t = useMemo(() => createTranslator(lang), [lang]);
  const semesters = useMemo(() => {
    const present = new Set(
      questions.map((question) => semesterForSubject(question.subject).key)
    );
    const ordered = CURRICULUM_SEMESTERS.filter((semester) => present.has(semester.key));

    return present.has(UNASSIGNED_SEMESTER.key)
      ? [...ordered, UNASSIGNED_SEMESTER]
      : ordered;
  }, [questions]);
  const selectedSemesterLabel =
    selectedSemester === "all"
      ? "All semesters"
      : semesters.find((semester) => semester.key === selectedSemester)?.label ||
        "Selected semester";
  const semesterQuestions = useMemo(
    () =>
      selectedSemester === "all"
        ? questions
        : questions.filter(
            (question) => semesterForSubject(question.subject).key === selectedSemester
          ),
    [questions, selectedSemester]
  );
  const subjects = useMemo(
    () => sortUnique(semesterQuestions.map((question) => question.subject)),
    [semesterQuestions]
  );
  const topics = useMemo(
    () =>
      sortUnique(
        semesterQuestions
          .filter(
            (question) =>
              selectedSubject === "all" || question.subject === selectedSubject
          )
          .map((question) => question.topic)
      ).sort(compareTopicBySemester),
    [semesterQuestions, selectedSubject]
  );
  const stats = useMemo(() => progressStats(progress, questions), [progress, questions]);
  const subjectsSummary = useMemo(
    () => subjectStats(progress, semesterQuestions),
    [progress, semesterQuestions]
  );
  const folders = progress.bookmarkFolders || [defaultFolder()];
  const activeFolder =
    folders.find((folder) => folder.id === progress.activeFolderId) || folders[0];
  const bookmarkedIds = useMemo(
    () => new Set(folders.flatMap((folder) => folder.questionIds || [])),
    [folders]
  );

  const filteredPool = useMemo(() => {
    const normalizedQuery = clean(query);

    return semesterQuestions.filter((question) => {
      const answer = progress.answers[question.id];

      if (selectedSubject !== "all" && question.subject !== selectedSubject) {
        return false;
      }

      if (selectedTopic !== "all" && question.topic !== selectedTopic) {
        return false;
      }

      if (normalizedQuery && !questionText(question).includes(normalizedQuery)) {
        return false;
      }

      if (pool === "unanswered" && answer) {
        return false;
      }

      if (pool === "wrong" && (!answer || answer.correct !== false)) {
        return false;
      }

      if (pool === "bookmarked" && !bookmarkedIds.has(question.id)) {
        return false;
      }

      return true;
    });
  }, [
    bookmarkedIds,
    pool,
    progress.answers,
    query,
    semesterQuestions,
    selectedSubject,
    selectedTopic
  ]);

  const sessionQuestions = useMemo(() => {
    const ids = sessionIds.length
      ? sessionIds
      : filteredPool.slice(0, DEFAULT_COUNT).map((question) => question.id);

    return ids
      .map((questionId) => questionById.get(questionId))
      .filter((question): question is Question => Boolean(question));
  }, [filteredPool, questionById, sessionIds]);

  const activeQuestion = sessionQuestions[activeIndex] || sessionQuestions[0];
  const activeStoredAnswer = activeQuestion
    ? progress.answers[activeQuestion.id]
    : undefined;
  const activeExamAnswer = activeQuestion ? examAnswers[activeQuestion.id] : undefined;
  const selectedAnswer =
    mode === "exam" && !examFinished ? activeExamAnswer : activeStoredAnswer?.selected;
  const shouldReveal = mode !== "exam" || examFinished;

  const searchResults = useMemo(() => {
    const normalized = clean(searchQuery);

    if (normalized.length < 2) {
      return [];
    }

    return questions
      .filter((question) => questionText(question).includes(normalized))
      .slice(0, 80);
  }, [questions, searchQuery]);

  const missedQuestions = useMemo(
    () =>
      Object.entries(progress.answers)
        .filter(([, answer]) => answer.correct === false)
        .map(([questionId, answer]) => ({
          question: questionById.get(questionId),
          answer
        }))
        .filter(
          (item): item is { question: Question; answer: StoredAnswer } =>
            Boolean(item.question)
        )
        .sort(
          (left, right) =>
            new Date(right.answer.answeredAt).getTime() -
            new Date(left.answer.answeredAt).getTime()
        ),
    [progress.answers, questionById]
  );
  const sessionLogs = useMemo(() => progress.sessionLog || [], [progress.sessionLog]);
  const curriculum = useMemo(
    () => buildCurriculum(questions, progress),
    [progress, questions]
  );
  const selectedSession =
    sessionLogs.find((session) => session.id === selectedSessionId) ||
    sessionLogs[0] ||
    null;

  useEffect(() => {
    if (selectedSubject !== "all" && !subjects.includes(selectedSubject)) {
      setSelectedSubject(subjects[0] || "all");
    }
  }, [selectedSubject, subjects]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);

    setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);

    if ("serviceWorker" in navigator) {
      const isLocalhost = ["localhost", "127.0.0.1"].includes(
        window.location.hostname
      );

      if (isLocalhost) {
        const clearLocalWorker = async () => {
          const registrations = await navigator.serviceWorker.getRegistrations();

          await Promise.all(
            registrations.map((registration) => registration.unregister())
          );

          if ("caches" in window) {
            const cacheKeys = await caches.keys();
            await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
          }

          setOfflineReady(false);

          if (
            navigator.serviceWorker.controller &&
            !window.sessionStorage.getItem(LOCAL_SW_CLEANUP_KEY)
          ) {
            window.sessionStorage.setItem(LOCAL_SW_CLEANUP_KEY, "true");
            window.location.reload();
          }
        };

        clearLocalWorker().catch(() => setOfflineReady(false));
      } else {
        window.sessionStorage.removeItem(LOCAL_SW_CLEANUP_KEY);
        navigator.serviceWorker
          .register("/sw.js")
          .then(() => setOfflineReady(true))
          .catch(() => setOfflineReady(false));
      }
    }

    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    jsonFetch<{
      user: TrainerUser | null;
      users: TrainerUser[];
      devLogin: null | { username: string; password: string };
    }>("/api/auth/me")
      .then((data) => {
        setUser(data.user);
        setUsers(data.users);
        setDevLogin(data.devLogin);

        if (!data.user) {
          setReady(true);
          return;
        }

        return loadProgressFromServer();
      })
      .catch(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) {
      setQuestions([]);
      setQuestionsReady(false);
      setQuestionsError("");
      return;
    }

    void loadQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  }, [progress]);

  useEffect(() => {
    if (!ready || !user) {
      return;
    }

    if (syncTimer.current) {
      clearTimeout(syncTimer.current);
    }

    syncTimer.current = setTimeout(() => {
      setSyncStatus("syncing");
      jsonFetch<{ progress: StoredProgress }>("/api/progress", {
        method: "POST",
        body: JSON.stringify({ progress })
      })
        .then(() => {
          setSyncStatus("synced");
          refreshLeaderboard();
        })
        .catch(() => setSyncStatus("offline"));
    }, 650);

    return () => {
      if (syncTimer.current) {
        clearTimeout(syncTimer.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, ready, user?.id]);

  useEffect(() => {
    if (!user) {
      return;
    }

    refreshReports();
    refreshLeaderboard();

    if (user.role === "admin") {
      refreshAdmin();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (user?.role === "admin" && view === "admin") {
      refreshAdmin();
      refreshReports();
      refreshUsers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, user?.role]);

  async function loadProgressFromServer() {
    try {
      const data = await jsonFetch<{ progress: StoredProgress }>("/api/progress");
      setProgress(normalizeProgress(data.progress));
      setSyncStatus("synced");
    } catch {
      setProgress(loadLocalProgress());
      setSyncStatus("offline");
    } finally {
      setReady(true);
    }
  }

  async function loadQuestions() {
    setQuestionsReady(false);
    setQuestionsError("");

    try {
      const data = await jsonFetch<{ questions: Question[] }>("/api/questions");
      setQuestions(data.questions);
    } catch (error) {
      setQuestionsError(
        error instanceof Error ? error.message : "Could not load questions"
      );
    } finally {
      setQuestionsReady(true);
    }
  }

  function refreshLeaderboard() {
    jsonFetch<{ leaderboard: LeaderboardEntry[] }>("/api/leaderboard")
      .then((data) => setLeaderboard(data.leaderboard))
      .catch(() => undefined);
  }

  function refreshReports() {
    jsonFetch<{ reports: QuestionReport[] }>("/api/reports")
      .then((data) => setReports(data.reports))
      .catch(() => undefined);
  }

  function refreshAdmin() {
    jsonFetch<{
      progressUsers: number;
      openReports: number;
      storage: string;
    }>("/api/admin/state")
      .then(setAdminState)
      .catch(() => undefined);
  }

  useEffect(() => {
    if (!navOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setNavOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [navOpen]);

  useEffect(() => {
    setReportOpen(false);

    if (view === "trainer" && sessionIds.length) {
      stemRef.current?.scrollIntoView({ block: "start" });
    }
  }, [activeIndex, sessionIds.length, view]);

  useEffect(() => {
    const stored = window.localStorage.getItem(LANG_STORAGE_KEY);

    if (stored === "en" || stored === "de") {
      setLang(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(LANG_STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  function endSession() {
    setSessionIds([]);
    setActiveSessionLogId(null);
    setActiveIndex(0);
    setExamAnswers({});
    setExamFinished(false);
    setQueueOpen(false);
    setReportOpen(false);
  }

  function patchProgress(updater: (current: StoredProgress) => StoredProgress) {
    setProgress((current) => normalizeProgress(updater(normalizeProgress(current))));
  }

  function sessionLabel(nextMode = mode, nextPool = pool) {
    const parts = [
      selectedSemesterLabel,
      selectedSubject === "all" ? "All subjects" : selectedSubject,
      selectedTopic === "all" ? null : selectedTopic,
      nextPool === "all" ? null : nextPool
    ].filter(Boolean);

    return `${nextMode} · ${parts.join(" / ")}`;
  }

  function startSessionFromIds(
    ids: string[],
    nextMode: SessionMode,
    label: string,
    source?: StudySessionLog["source"]
  ) {
    const sessionId = id("session");
    const startedAt = now();

    setMode(nextMode);
    setSessionIds(ids);
    setActiveIndex(0);
    setExamAnswers({});
    setExamFinished(false);
    setSessionStartedAt(startedAt);
    setActiveSessionLogId(sessionId);
    setView("trainer");

    patchProgress((current) => ({
      ...current,
      sessionLog: [
        {
          id: sessionId,
          mode: nextMode,
          label,
          questionIds: ids,
          answered: 0,
          correct: 0,
          mistakeQuestionIds: [],
          startedAt,
          finishedAt: startedAt,
          source
        },
        ...(current.sessionLog || [])
      ].slice(0, 80)
    }));
  }

  function startSession(nextMode = mode, nextPool = pool) {
    const base = filteredPool.filter((question) => {
      if (nextPool === "all") {
        return true;
      }

      const answer = progress.answers[question.id];

      if (nextPool === "unanswered") {
        return !answer;
      }

      if (nextPool === "wrong") {
        return answer?.correct === false;
      }

      return bookmarkedIds.has(question.id);
    });
    const ordered = orderQuestions(base, sessionOrder);
    const picked = ordered
      .slice(0, Math.min(sessionCount || DEFAULT_COUNT, ordered.length))
      .map((question) => question.id);

    setPool(nextPool);
    startSessionFromIds(picked, nextMode, sessionLabel(nextMode, nextPool), {
      semester: selectedSemesterLabel,
      subject: selectedSubject === "all" ? "All subjects" : selectedSubject,
      topic: selectedTopic === "all" ? "All topics" : selectedTopic,
      pool: nextPool,
      order: sessionOrder
    });
  }

  function startPaper(paper: PaperSummary, nextMode: "study" | "exam") {
    setSelectedSemester("all");
    setSelectedSubject(paper.subject);
    setSelectedTopic("all");
    setPool("all");
    startSessionFromIds(
      paper.questionIds,
      nextMode,
      [paper.semesterLabel, paper.subject, paper.examTerm].filter(Boolean).join(" · "),
      {
        paperKey: paper.key,
        semester: paper.semesterLabel,
        subject: paper.subject,
        topic: paper.examTerm,
        pool: "all",
        order: "paper"
      }
    );
  }

  function startPapers(papers: PaperSummary[], nextMode: "study" | "exam") {
    if (!papers.length) {
      return;
    }

    const ids = Array.from(new Set(papers.flatMap((paper) => paper.questionIds)));

    if (!ids.length) {
      return;
    }

    setSelectedSemester("all");
    setSelectedTopic("all");
    setPool("all");

    const single = papers.length === 1 ? papers[0] : null;
    const label = single
      ? [single.semesterLabel, single.subject, single.examTerm]
          .filter(Boolean)
          .join(" · ")
      : `${papers.length} papers`;

    startSessionFromIds(ids, nextMode, label, {
      paperKey: single?.key,
      semester: single?.semesterLabel || "Multiple",
      subject: single ? single.subject : `${papers.length} papers`,
      topic: single ? single.examTerm : `${ids.length} questions`,
      pool: "all",
      order: "paper"
    });
  }

  function recordAnswer(question: Question, selected: string, answerMode = mode) {
    patchProgress((current) => {
      const previous = current.answers[question.id];
      const answer: StoredAnswer = {
        selected,
        correct: selected === question.answer,
        attempts: (previous?.attempts || 0) + 1,
        answeredAt: now(),
        mode: answerMode === "exam" ? "exam" : "study",
        confidence: previous?.confidence
      };

      const nextProgress = {
        ...current,
        answers: {
          ...current.answers,
          [question.id]: answer
        }
      };

      if (!activeSessionLogId) {
        return nextProgress;
      }

      return updateSessionLog(nextProgress, activeSessionLogId);
    });
  }

  // Reveals a freeText question's model answer. There is no choice to grade,
  // so correct stays undefined: it counts as answered but never as a mistake.
  function revealFreeText(question: Question) {
    patchProgress((current) => {
      const previous = current.answers[question.id];
      const answer: StoredAnswer = {
        attempts: (previous?.attempts || 0) + 1,
        answeredAt: now(),
        mode: mode === "exam" ? "exam" : "study",
        confidence: previous?.confidence
      };

      const nextProgress = {
        ...current,
        answers: {
          ...current.answers,
          [question.id]: answer
        }
      };

      if (!activeSessionLogId) {
        return nextProgress;
      }

      return updateSessionLog(nextProgress, activeSessionLogId);
    });
  }

  function updateSessionLog(progressState: StoredProgress, sessionId: string) {
    const sessionLog = progressState.sessionLog || [];
    const target = sessionLog.find((session) => session.id === sessionId);

    if (!target) {
      return progressState;
    }

    const startedAt = new Date(target.startedAt).getTime();
    const answeredIds = target.questionIds.filter((questionId) => {
      const answeredAt = progressState.answers[questionId]?.answeredAt;

      return answeredAt && new Date(answeredAt).getTime() >= startedAt;
    });
    // freeText reveals (correct === undefined) are answered but ungraded:
    // excluded from both the correct and mistake counts below.
    const gradedIds = answeredIds.filter(
      (questionId) => progressState.answers[questionId]?.correct !== undefined
    );
    const mistakeQuestionIds = gradedIds.filter(
      (questionId) => progressState.answers[questionId]?.correct === false
    );
    const correct = gradedIds.length - mistakeQuestionIds.length;

    return {
      ...progressState,
      sessionLog: sessionLog.map((session) =>
        session.id === sessionId
          ? {
              ...session,
              answered: answeredIds.length,
              correct,
              mistakeQuestionIds,
              finishedAt: now()
            }
          : session
      )
    };
  }

  function answerQuestion(question: Question, selected: string) {
    if (mode === "exam" && !examFinished) {
      setExamAnswers((current) => ({
        ...current,
        [question.id]: selected
      }));
      return;
    }

    recordAnswer(question, selected);
  }

  function finishExam() {
    const answeredIds = Object.keys(examAnswers);
    const correct = answeredIds.filter(
      (questionId) => examAnswers[questionId] === questionById.get(questionId)?.answer
    ).length;
    const mistakeQuestionIds = answeredIds.filter(
      (questionId) => examAnswers[questionId] !== questionById.get(questionId)?.answer
    );

    patchProgress((current) => {
      const answers = { ...current.answers };

      for (const questionId of answeredIds) {
        const question = questionById.get(questionId);

        if (!question) {
          continue;
        }

        const previous = answers[questionId];
        answers[questionId] = {
          selected: examAnswers[questionId],
          correct: examAnswers[questionId] === question.answer,
          attempts: (previous?.attempts || 0) + 1,
          answeredAt: now(),
          mode: "exam",
          confidence: previous?.confidence
        };
      }

      const sessionLog = current.sessionLog || [];
      const nextProgress = {
        ...current,
        answers
      };

      if (!activeSessionLogId) {
        const log: StudySessionLog = {
          id: id("session"),
          mode: "exam",
          label: sessionLabel("exam", pool),
          questionIds: sessionQuestions.map((question) => question.id),
          answered: answeredIds.length,
          correct,
          mistakeQuestionIds,
          startedAt: sessionStartedAt,
          finishedAt: now()
        };

        return {
          ...nextProgress,
          sessionLog: [log, ...sessionLog].slice(0, 80)
        };
      }

      return {
        ...nextProgress,
        sessionLog: sessionLog.map((session) =>
          session.id === activeSessionLogId
            ? {
                ...session,
                answered: answeredIds.length,
                correct,
                mistakeQuestionIds,
                finishedAt: now()
              }
            : session
        )
      };
    });

    setExamFinished(true);
  }

  function setConfidence(questionId: string, confidence: StoredAnswer["confidence"]) {
    patchProgress((current) => {
      const answer = current.answers[questionId];

      if (!answer) {
        return current;
      }

      return {
        ...current,
        answers: {
          ...current.answers,
          [questionId]: {
            ...answer,
            confidence
          }
        }
      };
    });
  }

  function toggleBookmark(questionId: string) {
    patchProgress((current) => {
      const folders = current.bookmarkFolders?.length
        ? [...current.bookmarkFolders]
        : [defaultFolder()];
      const folderIndex = Math.max(
        folders.findIndex((folder) => folder.id === current.activeFolderId),
        0
      );
      const folder = folders[folderIndex];
      const ids = new Set(folder.questionIds || []);

      if (ids.has(questionId)) {
        ids.delete(questionId);
      } else {
        ids.add(questionId);
      }

      folders[folderIndex] = {
        ...folder,
        questionIds: Array.from(ids)
      };

      return {
        ...current,
        bookmarkFolders: folders,
        bookmarks: Array.from(new Set(folders.flatMap((item) => item.questionIds)))
      };
    });
  }

  function createFolder() {
    if (!newFolderName.trim()) {
      return;
    }

    const folder: BookmarkFolder = {
      id: id("folder"),
      name: newFolderName.trim(),
      color: ["#216e62", "#315d9f", "#8f4d38", "#6f5b9d"][
        folders.length % 4
      ],
      questionIds: [],
      createdAt: now()
    };

    patchProgress((current) => ({
      ...current,
      bookmarkFolders: [...(current.bookmarkFolders || []), folder],
      activeFolderId: folder.id
    }));
    setNewFolderName("");
  }

  function clearCurrentAnswer() {
    if (!activeQuestion) {
      return;
    }

    patchProgress((current) => {
      const { [activeQuestion.id]: _removed, ...answers } = current.answers;

      return {
        ...current,
        answers
      };
    });
  }

  async function submitReport(questionId: string) {
    if (!reportText.trim()) {
      return;
    }

    await jsonFetch<{ report: QuestionReport }>("/api/reports", {
      method: "POST",
      body: JSON.stringify({
        questionId,
        type: reportType,
        text: reportText
      })
    });
    setReportText("");
    setReportType("wrong-answer");
    setNotice("Report sent");
    refreshReports();
    if (user?.role === "admin") {
      refreshAdmin();
    }
  }

  async function resolveReport(reportId: string) {
    await jsonFetch<{ report: QuestionReport }>("/api/reports", {
      method: "PATCH",
      body: JSON.stringify({
        id: reportId,
        status: "resolved",
        resolution: "Reviewed"
      })
    });
    refreshReports();
    refreshAdmin();
  }

  function refreshUsers() {
    jsonFetch<{ users: TrainerUser[] }>("/api/admin/users")
      .then((data) => setUsers(data.users))
      .catch(() => undefined);
  }

  async function createUser() {
    const name = newUserName.trim();

    if (!name || newUserPassword.length < 8) {
      setNotice("Name and a password of at least 8 characters are required");
      return;
    }

    try {
      await jsonFetch("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name,
          password: newUserPassword,
          role: newUserRole
        })
      });
      setNewUserName("");
      setNewUserPassword("");
      setNewUserRole("member");
      setNotice("User added");
      refreshUsers();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not add user");
    }
  }

  async function patchUser(
    userId: string,
    changes: Record<string, unknown>,
    successMessage: string
  ) {
    try {
      await jsonFetch("/api/admin/users", {
        method: "PATCH",
        body: JSON.stringify({ id: userId, ...changes })
      });
      setNotice(successMessage);
      refreshUsers();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Update failed");
    }
  }

  function renameUser(userId: string, currentName: string) {
    const next = window.prompt("New name", currentName);

    if (next === null) {
      return;
    }

    const name = next.trim();

    if (!name || name === currentName) {
      return;
    }

    patchUser(userId, { name }, "User renamed");
  }

  function resetUserPassword(userId: string) {
    const password = (editingPasswords[userId] || "").trim();

    if (password.length < 8) {
      setNotice("New password must be at least 8 characters");
      return;
    }

    patchUser(userId, { password }, "Password reset").then(() =>
      setEditingPasswords((current) => {
        const { [userId]: _removed, ...rest } = current;

        return rest;
      })
    );
  }

  async function removeUser(userId: string, name: string) {
    if (!window.confirm(`Remove ${name}? This cannot be undone.`)) {
      return;
    }

    try {
      await jsonFetch(`/api/admin/users?id=${encodeURIComponent(userId)}`, {
        method: "DELETE"
      });
      setNotice("User removed");
      refreshUsers();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not remove user");
    }
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setAuthError("");

    try {
      const data = await jsonFetch<{ user: TrainerUser }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          username: loginName,
          password: loginPassword
        })
      });

      setUser(data.user);
      await loadProgressFromServer();
      refreshLeaderboard();
      refreshReports();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Login failed");
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setView("dashboard");
  }

  async function exportState() {
    const response = await fetch("/api/state/export");
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "mcq-trainer-export.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importState(file: File) {
    const text = await file.text();
    const parsed = JSON.parse(text) as { progress?: StoredProgress } & StoredProgress;
    const importedProgress = parsed.progress || parsed;
    const data = await jsonFetch<{ progress: StoredProgress }>("/api/state/import", {
      method: "POST",
      body: JSON.stringify({ progress: importedProgress })
    });

    setProgress(normalizeProgress(data.progress));
    setNotice("Progress imported");
  }

  function jumpToQuestion(questionId: string) {
    setSessionIds([questionId]);
    setActiveIndex(0);
    setMode("study");
    setExamFinished(false);
    setView("trainer");
  }

  if (user && questionsError) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-bg px-6 font-sans text-body text-text">
        <AlertTriangle className="text-danger" size={28} aria-hidden="true" />
        <p className="m-0 text-body text-text-muted">{questionsError}</p>
        <Button onClick={loadQuestions} variant="secondary">
          Try again
        </Button>
      </main>
    );
  }

  if (user && (!ready || !questionsReady)) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-bg px-6 font-sans text-body text-text">
        <Gauge className="text-text-subtle" size={28} aria-hidden="true" />
        <p className="m-0 text-body text-text-muted">
          {ready ? "Loading question bank" : "Loading trainer"}
        </p>
      </main>
    );
  }

  if (!user) {
    return (
      <StoaLanding
        questionMetrics={questionMetrics}
        loginName={loginName}
        loginPassword={loginPassword}
        authError={authError}
        devLogin={devLogin}
        lang={lang}
        onLangChange={setLang}
        t={t}
        onLoginNameChange={setLoginName}
        onLoginPasswordChange={setLoginPassword}
        onLogin={login}
      />
    );
  }

  const sidebarContent = (
    <>
      <div className="flex items-center justify-between border-b border-border pb-4">
        <strong className="text-h3 font-semibold">Stoa</strong>
        <Button
          aria-label="Close navigation"
          className="px-2 md:hidden"
          onClick={() => setNavOpen(false)}
          variant="ghost"
        >
          <X size={18} aria-hidden="true" />
        </Button>
      </div>

      <nav aria-label="Main navigation" className="grid gap-1">
        {navItems
          .filter((item) => !item.admin || user.role === "admin")
          .map((item) => {
            const Icon = item.icon;
            const active = view === item.view;

            return (
              <Button
                aria-current={active ? "page" : undefined}
                className={cn(
                  "w-full justify-start",
                  active &&
                    "bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] text-accent"
                )}
                key={item.view}
                onClick={() => {
                  setView(item.view);
                  setNavOpen(false);
                }}
                variant="ghost"
              >
                <Icon size={18} aria-hidden="true" />
                <span>{t(`nav.${item.view}`)}</span>
              </Button>
            );
          })}
      </nav>

      <div className="mt-auto flex items-center justify-between gap-4 border-t border-border pt-4">
        <div className="grid min-w-0 gap-1">
          <strong className="truncate text-body-sm font-medium">{user.name}</strong>
          <span className="text-label text-text-subtle">{user.role}</span>
        </div>
        <Button aria-label="Log out" className="px-3" onClick={logout} variant="ghost">
          <LogOut size={17} aria-hidden="true" />
        </Button>
      </div>
    </>
  );

  return (
    <main className="flex h-[100dvh] overflow-hidden bg-bg font-sans text-body text-text">
      <aside className="hidden h-full w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border bg-surface p-6 md:flex">
        {sidebarContent}
      </aside>

      {navOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/40"
            onClick={() => setNavOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col gap-6 overflow-y-auto border-r border-border bg-surface p-6">
            {sidebarContent}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-bg/90 px-6 py-4 backdrop-blur lg:px-8">
          <Button
            aria-label="Open navigation"
            className="px-2 md:hidden"
            onClick={() => setNavOpen(true)}
            variant="ghost"
          >
            <Menu size={20} aria-hidden="true" />
          </Button>
          <h1 className="m-0 text-h2 font-semibold">{t(`nav.${view}`)}</h1>
          <div
            aria-label="Language"
            className="ml-auto flex rounded border border-border bg-surface p-1"
            role="group"
          >
            {(["en", "de"] as const).map((option) => (
              <Button
                aria-pressed={lang === option}
                className={cn(
                  "px-3 uppercase",
                  lang === option && "bg-surface-muted text-text"
                )}
                key={option}
                onClick={() => setLang(option)}
                variant={lang === option ? "secondary" : "ghost"}
              >
                {option}
              </Button>
            ))}
          </div>
        </header>

        {notice ? (
          <div
            className="mx-6 mt-4 flex items-center justify-between gap-4 rounded border border-border bg-surface px-4 py-3 text-body-sm text-text lg:mx-8"
            role="status"
          >
            <span>{notice}</span>
            <Button
              aria-label="Dismiss"
              className="px-2"
              onClick={() => setNotice("")}
              variant="ghost"
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        <div className="min-w-0 flex-1 p-6 lg:p-8">
          {view === "dashboard" ? renderDashboard() : null}
          {view === "subjects" ? renderSubjects() : null}
          {view === "trainer" ? renderTrainer() : null}
          {view === "sessions" ? renderSessions() : null}
          {view === "search" ? renderSearch() : null}
          {view === "mistakes" ? renderMistakes() : null}
          {view === "bookmarks" ? renderBookmarks() : null}
          {view === "admin" ? renderAdmin() : null}
        </div>
      </div>
    </main>
  );

  function renderDashboard() {
    const latestMistakeSession = sessionLogs.find(
      (session) => session.mistakeQuestionIds?.length
    );
    const activeLeaders = leaderboard.filter((entry) => entry.weeklyAnswered > 0);
    const coverage = questions.length
      ? (stats.answered / questions.length) * 100
      : 0;
    const recentSessions = sessionLogs.slice(0, 4);

    return (
      <div className="mx-auto grid max-w-content gap-8">
        <section className="grid grid-cols-2 gap-x-6 gap-y-8 border-b border-border pb-6 sm:grid-cols-4 sm:gap-x-10">
          <Stat label={t("stat.answered")} value={formatNumber(stats.answered)} />
          <Stat label={t("stat.accuracy")} value={formatPercent(stats.accuracy)} />
          <Stat label={t("stat.mistakes")} value={formatNumber(stats.missed)} />
          <Stat
            label={t("stat.coverage")}
            value={`${coverage < 1 && coverage > 0 ? "<1" : Math.round(coverage)}%`}
          />
        </section>

        <section className="grid gap-4">
          <h2 className="m-0 text-h3 font-semibold">{t("dashboard.start")}</h2>
          <div className="flex flex-wrap gap-4">
            <Button onClick={() => setView("trainer")} variant="primary">
              <Play size={18} aria-hidden="true" />
              {t("dashboard.custom")}
            </Button>
            <Button
              onClick={() =>
                latestMistakeSession
                  ? reviewSessionMistakes(latestMistakeSession)
                  : startSession("review", "wrong")
              }
              variant="secondary"
            >
              <ListChecks size={18} aria-hidden="true" />
              {t("dashboard.review")}
            </Button>
            <Button onClick={() => setView("subjects")} variant="secondary">
              <BookOpenCheck size={18} aria-hidden="true" />
              {t("dashboard.papers")}
            </Button>
          </div>
          <p className="m-0 text-body-sm text-text-muted">
            {formatNumber(stats.answered)} of {formatNumber(questions.length)}{" "}
            questions answered · {sessionLogs.length} saved{" "}
            {sessionLogs.length === 1 ? "session" : "sessions"}
          </p>
        </section>

        {recentSessions.length ? (
          <section className="grid gap-3">
            <h2 className="m-0 text-h3 font-semibold">{t("dashboard.recent")}</h2>
            <div className="divide-y divide-border border-y border-border">
              {recentSessions.map((session) => (
                <button
                  className="flex w-full items-center justify-between gap-4 px-1 py-4 text-left transition-colors hover:bg-surface-muted"
                  key={session.id}
                  onClick={() => {
                    setSelectedSessionId(session.id);
                    setSelectedMistakeIds(session.mistakeQuestionIds || []);
                    setView("sessions");
                  }}
                  type="button"
                >
                  <span className="min-w-0 truncate text-body font-medium text-text">
                    {session.label}
                  </span>
                  <span className="shrink-0 text-body-sm text-text-muted">
                    {session.answered
                      ? `${Math.round((session.correct / session.answered) * 100)}%`
                      : "—"}{" "}
                    · {new Date(session.finishedAt).toLocaleDateString()}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {activeLeaders.length ? (
          <section className="grid gap-3">
            <h2 className="m-0 text-h3 font-semibold">{t("dashboard.week")}</h2>
            <List>
              {activeLeaders.slice(0, 8).map((entry, index) => (
                <ListRow
                  key={entry.userId}
                  meta={
                    <>
                      <span>{entry.weeklyAnswered} answered</span>
                      <span>{entry.accuracy}% accuracy</span>
                    </>
                  }
                  title={`${index + 1}. ${entry.name}`}
                />
              ))}
            </List>
          </section>
        ) : null}
      </div>
    );
  }

  function renderSubjects() {
    return (
      <PapersView
        mode={mode === "exam" ? "exam" : "study"}
        onModeChange={setMode}
        onSemesterChange={setPapersSemester}
        onStartPaper={startPaper}
        onStartPapers={startPapers}
        selectedSemester={papersSemester}
        semesters={curriculum}
        t={t}
      />
    );
  }

  function renderTrainer() {
    if (!sessionIds.length) {
      return (
        <div className="mx-auto grid max-w-content gap-6">
          <p className="m-0 max-w-[640px] text-body text-text-muted">
            Set filters and start a custom session, or open Papers to start a full
            exam paper.
          </p>
          {renderSessionBuilder()}
        </div>
      );
    }

    const total = sessionQuestions.length;
    const activeSession = sessionLogs.find(
      (session) => session.id === activeSessionLogId
    );
    const goPrev = () => setActiveIndex((current) => Math.max(0, current - 1));
    const goNext = () =>
      setActiveIndex((current) => Math.min(total - 1, current + 1));

    return (
      <div className="mx-auto grid max-w-content gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              aria-label="End session"
              className="px-2"
              onClick={endSession}
              variant="ghost"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </Button>
            <div className="min-w-0">
              <p className="m-0 truncate text-body font-medium">
                {activeSession?.label || "Session"}
              </p>
              <p className="m-0 text-body-sm text-text-muted">
                {total ? activeIndex + 1 : 0} of {total}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button className="px-3" onClick={() => setQueueOpen(true)} variant="ghost">
              <ListChecks size={18} aria-hidden="true" />
              <span>Queue</span>
            </Button>
            {mode === "exam" && !examFinished ? (
              <Button onClick={finishExam} variant="primary">
                <Timer size={16} aria-hidden="true" />
                Finish
              </Button>
            ) : null}
          </div>
        </div>

        {activeQuestion ? renderQuestion(activeQuestion) : renderEmptyQuestion()}

        <div
          className="sticky bottom-0 z-10 -mx-6 flex items-center justify-between gap-3 border-t border-border bg-bg/95 px-6 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          <Button disabled={activeIndex === 0} onClick={goPrev} variant="secondary">
            <ChevronLeft size={18} aria-hidden="true" />
            <span>Previous</span>
          </Button>
          <span className="text-body-sm text-text-muted">
            {total ? activeIndex + 1 : 0} / {total}
          </span>
          <Button
            disabled={activeIndex >= total - 1}
            onClick={goNext}
            variant="secondary"
          >
            <span>Next</span>
            <ChevronRight size={18} aria-hidden="true" />
          </Button>
        </div>

        {queueOpen ? renderQueueDrawer() : null}
      </div>
    );
  }

  function renderQueueDrawer() {
    return (
      <div className="fixed inset-0 z-40">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-black/40"
          onClick={() => setQueueOpen(false)}
        />
        <aside
          aria-label="Question queue"
          className="absolute inset-y-0 right-0 flex w-80 max-w-[85%] flex-col border-l border-border bg-surface"
        >
          <div className="flex items-center justify-between border-b border-border p-4">
            <strong className="text-body font-semibold">Queue</strong>
            <Button
              aria-label="Close queue"
              className="px-2"
              onClick={() => setQueueOpen(false)}
              variant="ghost"
            >
              <X size={18} aria-hidden="true" />
            </Button>
          </div>
          <div className="grid gap-1 overflow-y-auto p-3">
            {sessionQuestions.map((question, index) => {
              const answered =
                mode === "exam" && !examFinished
                  ? Boolean(examAnswers[question.id])
                  : Boolean(progress.answers[question.id]);
              const missed =
                mode !== "exam" || examFinished
                  ? progress.answers[question.id]?.correct === false
                  : false;
              const active = index === activeIndex;

              return (
                <button
                  className={cn(
                    "flex items-center gap-3 rounded px-3 py-2 text-left text-body-sm transition-colors hover:bg-surface-muted",
                    active &&
                      "bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))] text-accent"
                  )}
                  key={question.id}
                  onClick={() => {
                    setActiveIndex(index);
                    setQueueOpen(false);
                  }}
                  type="button"
                >
                  <span className="w-6 shrink-0 tabular-nums text-text-subtle">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{question.topic}</span>
                  {missed ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
                  ) : answered ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                  ) : null}
                </button>
              );
            })}
          </div>
        </aside>
      </div>
    );
  }

  function renderQuestion(question: Question) {
    if (question.kind === "freeText") {
      return renderFreeTextQuestion(question);
    }

    const storedAnswer = progress.answers[question.id];
    const currentSelected =
      mode === "exam" && !examFinished ? examAnswers[question.id] : storedAnswer?.selected;
    const revealed = mode === "exam" ? examFinished : Boolean(currentSelected);
    const image = proxiedImage(question.imageUrl);
    const isBookmarked = bookmarkedIds.has(question.id);
    const isCorrect = currentSelected === question.answer;
    const stats = question.stats;
    const statTotal = stats
      ? stats.choices.reduce((sum, choice) => sum + choice.count, 0)
      : 0;
    const statByChoice = new Map(
      (stats?.choices || []).map((choice) => [choice.id, choice.count])
    );
    const correctPct =
      stats && statTotal ? Math.round((stats.correct / statTotal) * 100) : null;

    return (
      <article className="grid gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1">
            <span className="text-label text-text-subtle">{question.subject}</span>
            <strong className="text-body font-medium">{question.topic}</strong>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              className="px-3"
              onClick={() => toggleBookmark(question.id)}
              variant="ghost"
            >
              {isBookmarked ? (
                <BookmarkCheck size={18} aria-hidden="true" />
              ) : (
                <Bookmark size={18} aria-hidden="true" />
              )}
              <span>{isBookmarked ? "Saved" : "Save"}</span>
            </Button>
            <Button
              className="px-3"
              onClick={() => setReportOpen((current) => !current)}
              variant="ghost"
            >
              <FileWarning size={18} aria-hidden="true" />
              <span>Report</span>
            </Button>
          </div>
        </div>

        <div className="grid gap-4" ref={stemRef}>
          <p className="m-0 whitespace-pre-line text-body leading-relaxed text-text">
            {question.stem}
          </p>
          {image ? (
            <img alt="" className="max-h-96 rounded border border-border" loading="lazy" src={image} />
          ) : null}
        </div>

        <div className="grid gap-2">
          {question.choices.map((choice) => {
            const selected = currentSelected === choice.id;
            const correct = question.answer === choice.id;

            return (
              <button
                className={cn(
                  "flex w-full items-center gap-3 rounded border border-border bg-surface px-4 py-3 text-left text-body transition-colors hover:bg-surface-muted",
                  selected && !revealed && "border-accent",
                  revealed &&
                    correct &&
                    "border-accent bg-[color-mix(in_srgb,var(--accent)_10%,var(--surface))]",
                  revealed &&
                    selected &&
                    !correct &&
                    "border-danger bg-[color-mix(in_srgb,var(--danger)_10%,var(--surface))]"
                )}
                key={choice.id}
                onClick={() => answerQuestion(question, choice.id)}
                type="button"
              >
                <span className="w-5 shrink-0 font-medium text-text-muted">
                  {choice.id}
                </span>
                <span className="min-w-0 flex-1">{choice.text}</span>
                {revealed && statTotal ? (
                  <span className="shrink-0 tabular-nums text-body-sm text-text-subtle">
                    {Math.round(((statByChoice.get(choice.id) || 0) / statTotal) * 100)}%
                  </span>
                ) : null}
                {revealed && correct ? (
                  <Check className="shrink-0 text-accent" size={18} aria-hidden="true" />
                ) : null}
                {revealed && selected && !correct ? (
                  <X className="shrink-0 text-danger" size={18} aria-hidden="true" />
                ) : null}
              </button>
            );
          })}
        </div>

        {currentSelected && revealed ? (
          <section className="grid gap-3 rounded border border-border bg-surface-muted p-4">
            <div className="flex items-center gap-2">
              {isCorrect ? (
                <Check className="text-accent" size={18} aria-hidden="true" />
              ) : (
                <AlertTriangle className="text-danger" size={18} aria-hidden="true" />
              )}
              <strong className="text-body font-medium">
                {isCorrect ? "Correct" : "Marked for review"}
              </strong>
            </div>

            {correctPct !== null && stats ? (
              <p className="m-0 text-body-sm text-text-muted">
                {correctPct}% answered this correctly · {formatNumber(stats.answered)}{" "}
                attempts
              </p>
            ) : null}

            {question.explanation ? (
              <p className="m-0 whitespace-pre-line text-body-sm text-text">
                {question.explanation}
              </p>
            ) : null}

            {question.notes?.length ? (
              <div className="grid gap-2 border-t border-border pt-3">
                <strong className="text-body-sm font-medium text-text-muted">
                  Comments and corrections
                </strong>
                {question.notes.map((note, index) => (
                  <p
                    className="m-0 whitespace-pre-line text-body-sm text-text"
                    key={`${question.id}-note-${index}`}
                  >
                    {note}
                  </p>
                ))}
              </div>
            ) : null}

            {storedAnswer ? (
              <div aria-label="Confidence" className="flex flex-wrap gap-2 pt-1">
                {(
                  [
                    ["low", "Guessed"],
                    ["medium", "Unsure"],
                    ["high", "Knew it"]
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    className="px-3"
                    key={value}
                    onClick={() => setConfidence(question.id, value)}
                    variant={storedAnswer.confidence === value ? "secondary" : "ghost"}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {mode === "exam" && !examFinished && currentSelected ? (
          <section className="flex items-center gap-2 rounded border border-border bg-surface-muted p-4 text-body-sm text-text-muted">
            <Timer size={18} aria-hidden="true" />
            <span>Exam mode keeps feedback hidden until you finish the session.</span>
          </section>
        ) : null}

        {reportOpen ? (
          <section className="grid gap-3 rounded border border-border bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <Select
                onChange={(event) => setReportType(event.target.value as ReportType)}
                value={reportType}
              >
                <option value="wrong-answer">Wrong answer</option>
                <option value="typo">Typo</option>
                <option value="unclear">Unclear</option>
                <option value="other">Other</option>
              </Select>
              <Input
                onChange={(event) => setReportText(event.target.value)}
                placeholder="Correction, typo, or note for admins"
                value={reportText}
              />
            </div>
            <div className="flex gap-2">
              <Button
                disabled={!reportText.trim()}
                onClick={async () => {
                  await submitReport(question.id);
                  setReportOpen(false);
                }}
                variant="primary"
              >
                <Upload size={17} aria-hidden="true" />
                Send
              </Button>
              <Button onClick={() => setReportOpen(false)} variant="ghost">
                Cancel
              </Button>
            </div>
          </section>
        ) : null}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-body-sm text-text-muted">
          <span>{question.source || question.subject}</span>
          <Button
            className="px-3"
            disabled={!storedAnswer}
            onClick={clearCurrentAnswer}
            variant="ghost"
          >
            <RotateCcw size={17} aria-hidden="true" />
            <span>Clear answer</span>
          </Button>
        </footer>
      </article>
    );
  }

  function renderFreeTextQuestion(question: Question) {
    const storedAnswer = progress.answers[question.id];
    const revealed = mode !== "exam" || examFinished;
    const image = proxiedImage(question.imageUrl);
    const isBookmarked = bookmarkedIds.has(question.id);

    return (
      <article className="grid gap-5">
        <div className="flex items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1">
            <span className="text-label text-text-subtle">{question.subject}</span>
            <strong className="text-body font-medium">{question.topic}</strong>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              className="px-3"
              onClick={() => toggleBookmark(question.id)}
              variant="ghost"
            >
              {isBookmarked ? (
                <BookmarkCheck size={18} aria-hidden="true" />
              ) : (
                <Bookmark size={18} aria-hidden="true" />
              )}
              <span>{isBookmarked ? "Saved" : "Save"}</span>
            </Button>
            <Button
              className="px-3"
              onClick={() => setReportOpen((current) => !current)}
              variant="ghost"
            >
              <FileWarning size={18} aria-hidden="true" />
              <span>Report</span>
            </Button>
          </div>
        </div>

        <div className="grid gap-4" ref={stemRef}>
          <span className="inline-flex w-fit items-center rounded border border-border px-2 py-0.5 text-label text-text-subtle">
            Free response
          </span>
          <p className="m-0 whitespace-pre-line text-body leading-relaxed text-text">
            {question.stem}
          </p>
          {image ? (
            <img alt="" className="max-h-96 rounded border border-border" loading="lazy" src={image} />
          ) : null}
        </div>

        {!storedAnswer ? (
          <Button onClick={() => revealFreeText(question)} variant="primary">
            Show answer
          </Button>
        ) : !revealed ? (
          <section className="flex items-center gap-2 rounded border border-border bg-surface-muted p-4 text-body-sm text-text-muted">
            <Timer size={18} aria-hidden="true" />
            <span>The model answer is hidden until you finish the exam.</span>
          </section>
        ) : (
          <section className="grid gap-3 rounded border border-border bg-surface-muted p-4">
            <strong className="text-body font-medium">Model answer</strong>
            <p className="m-0 whitespace-pre-line text-body-sm text-text">
              {question.modelAnswer}
            </p>

            {question.explanation ? (
              <p className="m-0 whitespace-pre-line border-t border-border pt-3 text-body-sm text-text">
                {question.explanation}
              </p>
            ) : null}

            {question.notes?.length ? (
              <div className="grid gap-2 border-t border-border pt-3">
                <strong className="text-body-sm font-medium text-text-muted">
                  Comments and corrections
                </strong>
                {question.notes.map((note, index) => (
                  <p
                    className="m-0 whitespace-pre-line text-body-sm text-text"
                    key={`${question.id}-note-${index}`}
                  >
                    {note}
                  </p>
                ))}
              </div>
            ) : null}

            <div aria-label="Confidence" className="flex flex-wrap gap-2 pt-1">
              {(
                [
                  ["low", "Guessed"],
                  ["medium", "Unsure"],
                  ["high", "Knew it"]
                ] as const
              ).map(([value, label]) => (
                <Button
                  className="px-3"
                  key={value}
                  onClick={() => setConfidence(question.id, value)}
                  variant={storedAnswer.confidence === value ? "secondary" : "ghost"}
                >
                  {label}
                </Button>
              ))}
            </div>
          </section>
        )}

        {reportOpen ? (
          <section className="grid gap-3 rounded border border-border bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <Select
                onChange={(event) => setReportType(event.target.value as ReportType)}
                value={reportType}
              >
                <option value="wrong-answer">Wrong answer</option>
                <option value="typo">Typo</option>
                <option value="unclear">Unclear</option>
                <option value="other">Other</option>
              </Select>
              <Input
                onChange={(event) => setReportText(event.target.value)}
                placeholder="Correction, typo, or note for admins"
                value={reportText}
              />
            </div>
            <div className="flex gap-2">
              <Button
                disabled={!reportText.trim()}
                onClick={async () => {
                  await submitReport(question.id);
                  setReportOpen(false);
                }}
                variant="primary"
              >
                <Upload size={17} aria-hidden="true" />
                Send
              </Button>
              <Button onClick={() => setReportOpen(false)} variant="ghost">
                Cancel
              </Button>
            </div>
          </section>
        ) : null}

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-body-sm text-text-muted">
          <span>{question.source || question.subject}</span>
          <Button
            className="px-3"
            disabled={!storedAnswer}
            onClick={clearCurrentAnswer}
            variant="ghost"
          >
            <RotateCcw size={17} aria-hidden="true" />
            <span>Clear answer</span>
          </Button>
        </footer>
      </article>
    );
  }

  function reviewSessionMistakes(session: StudySessionLog, ids = session.mistakeQuestionIds || []) {
    const uniqueIds = Array.from(new Set(ids)).filter((questionId) =>
      questionById.has(questionId)
    );

    if (!uniqueIds.length) {
      setNotice("No mistakes saved for that session");
      return;
    }

    startSessionFromIds(uniqueIds, "review", `Mistakes · ${session.label}`, {
      ...session.source,
      pool: "session mistakes"
    });
  }

  function replaySession(session: StudySessionLog) {
    const ids = session.questionIds.filter((questionId) => questionById.has(questionId));

    if (!ids.length) {
      setNotice("That session has no available questions");
      return;
    }

    startSessionFromIds(ids, session.mode, `Replay · ${session.label}`, session.source);
  }

  function renderSessions() {
    const activeSession = selectedSession;
    const mistakeIds = activeSession?.mistakeQuestionIds || [];
    const selectedIds = selectedMistakeIds.length ? selectedMistakeIds : mistakeIds;

    return (
      <div className="mx-auto grid max-w-content gap-8 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <section className="grid content-start gap-3">
          <h2 className="m-0 text-h3 font-semibold">
            {sessionLogs.length} saved{" "}
            {sessionLogs.length === 1 ? "session" : "sessions"}
          </h2>
          {sessionLogs.length ? (
            <div className="divide-y divide-border border-y border-border">
              {sessionLogs.map((session) => {
                const active = activeSession?.id === session.id;

                return (
                  <button
                    className={cn(
                      "grid w-full gap-1.5 py-4 pl-3 pr-3 text-left transition-colors hover:bg-surface-muted",
                      active &&
                        "bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))]"
                    )}
                    key={session.id}
                    onClick={() => {
                      setSelectedSessionId(session.id);
                      setSelectedMistakeIds(session.mistakeQuestionIds || []);
                    }}
                    type="button"
                  >
                    <span className="truncate text-body font-medium text-text">
                      {session.label}
                    </span>
                    <span className="text-body-sm text-text-muted">
                      {new Date(session.finishedAt).toLocaleDateString()} ·{" "}
                      {session.correct}/{session.answered} correct ·{" "}
                      {session.mistakeQuestionIds?.length || 0} mistakes
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="m-0 border-y border-border py-4 text-body text-text-muted">
              Start a session and it will appear here.
            </p>
          )}
        </section>

        <section className="grid content-start gap-5">
          {activeSession ? (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
                <h2 className="m-0 min-w-0 text-h3 font-semibold">
                  {activeSession.label}
                </h2>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => replaySession(activeSession)} variant="secondary">
                    <Play size={17} aria-hidden="true" />
                    Replay all
                  </Button>
                  <Button
                    disabled={!mistakeIds.length}
                    onClick={() => reviewSessionMistakes(activeSession, selectedIds)}
                    variant="primary"
                  >
                    <ListChecks size={17} aria-hidden="true" />
                    Solve selected
                  </Button>
                </div>
              </div>

              <section className="grid grid-cols-3 gap-x-8 gap-y-4">
                <Stat label="Questions" value={activeSession.questionIds.length} />
                <Stat label="Answered" value={activeSession.answered} />
                <Stat
                  label="Mistakes"
                  value={activeSession.mistakeQuestionIds?.length || 0}
                />
              </section>

              {mistakeIds.length ? (
                <div className="divide-y divide-border border-y border-border">
                  {mistakeIds.map((questionId) => {
                    const question = questionById.get(questionId);

                    if (!question) {
                      return null;
                    }

                    const checked = selectedIds.includes(questionId);

                    return (
                      <label
                        className="flex cursor-pointer items-start gap-3 py-4"
                        key={questionId}
                      >
                        <input
                          checked={checked}
                          className="mt-1 h-4 min-h-0 w-4 shrink-0 rounded border border-border accent-accent"
                          onChange={(event) => {
                            setSelectedMistakeIds((current) => {
                              const base = current.length ? current : mistakeIds;

                              return event.target.checked
                                ? Array.from(new Set([...base, questionId]))
                                : base.filter((id) => id !== questionId);
                            });
                          }}
                          type="checkbox"
                        />
                        <span className="grid min-w-0 gap-1">
                          <span className="text-label text-text-subtle">
                            {question.subject} · {question.topic}
                          </span>
                          <span className="line-clamp-2 text-body-sm text-text">
                            {question.stem}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="m-0 border-y border-border py-4 text-body text-text-muted">
                  No mistakes in this session. Replay it or pick another.
                </p>
              )}
            </>
          ) : (
            <p className="m-0 border-y border-border py-4 text-body text-text-muted">
              Select a session to review its mistakes.
            </p>
          )}
        </section>
      </div>
    );
  }

  function renderSearch() {
    const tooShort = clean(searchQuery).length < 2;

    return (
      <div className="mx-auto grid max-w-content gap-5">
        <Field htmlFor="search-input" label="Search questions, answers, and comments">
          <Input
            id="search-input"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Type at least 2 letters"
            value={searchQuery}
          />
        </Field>
        {searchResults.length ? (
          <div className="divide-y divide-border border-y border-border">
            {searchResults.map((question) => (
              <button
                className="grid w-full gap-1 py-3 text-left transition-colors hover:bg-surface-muted"
                key={question.id}
                onClick={() => jumpToQuestion(question.id)}
                type="button"
              >
                <span className="text-label text-text-subtle">
                  {question.subject} · {question.topic}
                </span>
                <span className="line-clamp-2 text-body-sm text-text">
                  {question.stem}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 text-body text-text-muted">
            {tooShort ? "Type at least 2 letters to search." : "No matches found."}
          </p>
        )}
      </div>
    );
  }

  function renderMistakes() {
    return (
      <div className="mx-auto grid max-w-content gap-4">
        <h2 className="m-0 text-h3 font-semibold">
          {missedQuestions.length} {missedQuestions.length === 1 ? "question" : "questions"}{" "}
          to fix
        </h2>
        {missedQuestions.length ? (
          <div className="divide-y divide-border border-y border-border">
            {missedQuestions.slice(0, 200).map(({ question, answer }) => (
              <button
                className="grid w-full gap-1 py-3 text-left transition-colors hover:bg-surface-muted"
                key={question.id}
                onClick={() => jumpToQuestion(question.id)}
                type="button"
              >
                <span className="text-label text-text-subtle">
                  {question.subject} · {question.topic}
                </span>
                <span className="line-clamp-2 text-body-sm text-text">
                  {question.stem}
                </span>
                <span className="text-label text-text-subtle">
                  Picked {answer.selected}, correct {question.answer}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 border-y border-border py-4 text-body text-text-muted">
            No mistakes yet. They show up here after you miss a question.
          </p>
        )}
      </div>
    );
  }

  function renderBookmarks() {
    const folderQuestions = (activeFolder?.questionIds || [])
      .map((questionId) => questionById.get(questionId))
      .filter((question): question is Question => Boolean(question));

    return (
      <div className="mx-auto grid max-w-content gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <section className="grid content-start gap-3">
          <h2 className="m-0 text-h3 font-semibold">
            {folders.length} {folders.length === 1 ? "folder" : "folders"}
          </h2>
          <div className="divide-y divide-border border-y border-border">
            {folders.map((folder) => {
              const active = folder.id === activeFolder?.id;

              return (
                <button
                  className={cn(
                    "flex w-full items-center justify-between gap-3 py-3 pl-3 pr-3 text-left transition-colors hover:bg-surface-muted",
                    active &&
                      "bg-[color-mix(in_srgb,var(--accent)_8%,var(--surface))]"
                  )}
                  key={folder.id}
                  onClick={() =>
                    patchProgress((current) => ({
                      ...current,
                      activeFolderId: folder.id
                    }))
                  }
                  type="button"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: folder.color }}
                    />
                    <span className="truncate text-body font-medium text-text">
                      {folder.name}
                    </span>
                  </span>
                  <span className="text-label text-text-subtle">
                    {folder.questionIds.length}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Input
              onChange={(event) => setNewFolderName(event.target.value)}
              placeholder="New folder"
              value={newFolderName}
            />
            <Button onClick={createFolder} variant="secondary">
              Add
            </Button>
          </div>
        </section>
        <section className="grid content-start gap-3">
          {folderQuestions.length ? (
            <div className="divide-y divide-border border-y border-border">
              {folderQuestions.map((question) => (
                <button
                  className="grid w-full gap-1 py-3 text-left transition-colors hover:bg-surface-muted"
                  key={question.id}
                  onClick={() => jumpToQuestion(question.id)}
                  type="button"
                >
                  <span className="text-label text-text-subtle">
                    {question.subject} · {question.topic}
                  </span>
                  <span className="line-clamp-2 text-body-sm text-text">
                    {question.stem}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="m-0 border-y border-border py-4 text-body text-text-muted">
              No saved questions in this folder yet.
            </p>
          )}
        </section>
      </div>
    );
  }

  function renderAdmin() {
    if (!user || user.role !== "admin") {
      return null;
    }

    const openReports = reports.filter((report) => report.status === "open");

    return (
      <div className="mx-auto grid max-w-content gap-8">
        <section className="grid grid-cols-2 gap-x-8 gap-y-6 border-b border-border pb-6 sm:grid-cols-4">
          <Stat label="Users" value={users.length} />
          <Stat label="Synced users" value={adminState?.progressUsers || 0} />
          <Stat label="Open reports" value={openReports.length} />
          <Stat label="Storage" value={adminState?.storage || "—"} />
        </section>

        <section className="grid gap-4">
          <h2 className="m-0 text-h3 font-semibold">Add user</h2>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto] sm:items-end">
            <Field htmlFor="new-user-name" label="Name">
              <Input
                id="new-user-name"
                onChange={(event) => setNewUserName(event.target.value)}
                placeholder="Display name"
                value={newUserName}
              />
            </Field>
            <Field htmlFor="new-user-password" label="Password">
              <Input
                id="new-user-password"
                onChange={(event) => setNewUserPassword(event.target.value)}
                placeholder="At least 8 characters"
                type="password"
                value={newUserPassword}
              />
            </Field>
            <Field htmlFor="new-user-role" label="Role">
              <Select
                id="new-user-role"
                onChange={(event) =>
                  setNewUserRole(event.target.value as TrainerUser["role"])
                }
                value={newUserRole}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </Select>
            </Field>
            <Button onClick={createUser} variant="primary">
              <UserPlus size={18} aria-hidden="true" />
              Add
            </Button>
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="m-0 text-h3 font-semibold">Users</h2>
          <div className="divide-y divide-border border-y border-border">
            {users.map((account) => {
              const locked = !account.managed;
              const isSelf = account.id === user.id;

              return (
                <div className="grid gap-3 py-3" key={account.id}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="grid min-w-0 gap-1">
                      <span className="text-body font-medium text-text">
                        {account.name}
                        {account.disabled ? (
                          <span className="text-text-subtle"> · disabled</span>
                        ) : null}
                      </span>
                      <span className="text-label text-text-subtle">
                        {account.id} · {account.role}
                        {locked ? " · configured" : ""}
                      </span>
                    </div>
                    {locked ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-label text-text-subtle">
                        Locked
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Select
                          aria-label={`Role for ${account.name}`}
                          disabled={isSelf}
                          onChange={(event) =>
                            patchUser(
                              account.id,
                              { role: event.target.value },
                              "Role updated"
                            )
                          }
                          value={account.role}
                        >
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </Select>
                        <Button
                          disabled={isSelf}
                          onClick={() =>
                            patchUser(
                              account.id,
                              { disabled: !account.disabled },
                              account.disabled ? "User enabled" : "User disabled"
                            )
                          }
                          variant="ghost"
                        >
                          {account.disabled ? "Enable" : "Disable"}
                        </Button>
                        <Button
                          onClick={() => renameUser(account.id, account.name)}
                          variant="ghost"
                        >
                          Rename
                        </Button>
                        <Button
                          aria-label={`Remove ${account.name}`}
                          className="px-3"
                          disabled={isSelf}
                          onClick={() => removeUser(account.id, account.name)}
                          variant="ghost"
                        >
                          <Trash2 size={17} aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </div>
                  {locked ? null : (
                    <div className="flex gap-2">
                      <Input
                        aria-label={`New password for ${account.name}`}
                        onChange={(event) =>
                          setEditingPasswords((current) => ({
                            ...current,
                            [account.id]: event.target.value
                          }))
                        }
                        placeholder="New password"
                        type="password"
                        value={editingPasswords[account.id] || ""}
                      />
                      <Button
                        onClick={() => resetUserPassword(account.id)}
                        variant="secondary"
                      >
                        <KeyRound size={17} aria-hidden="true" />
                        Reset
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="m-0 text-h3 font-semibold">Data</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={exportState} variant="secondary">
              <Download size={18} aria-hidden="true" />
              Export state
            </Button>
            <label className="inline-flex h-control cursor-pointer items-center gap-2 rounded border border-border bg-surface px-4 text-body-sm font-medium text-text transition-colors hover:bg-surface-muted">
              <Import size={18} aria-hidden="true" />
              Import my progress
              <input
                accept="application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    importState(file).catch((error) =>
                      setNotice(error instanceof Error ? error.message : "Import failed")
                    );
                  }
                }}
                type="file"
              />
            </label>
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="m-0 text-h3 font-semibold">
            {openReports.length} open {openReports.length === 1 ? "report" : "reports"}
          </h2>
          {reports.length ? (
            <List>
              {reports.map((report) => {
                const question = questionById.get(report.questionId);

                return (
                  <ListRow
                    action={
                      <Button
                        disabled={report.status === "resolved"}
                        onClick={() => resolveReport(report.id)}
                        variant="ghost"
                      >
                        Resolve
                      </Button>
                    }
                    detail={report.text}
                    key={report.id}
                    meta={
                      <>
                        <span>{report.type}</span>
                        <span>{report.status}</span>
                        <span>{report.userId}</span>
                      </>
                    }
                    title={question?.topic || report.questionId}
                  />
                );
              })}
            </List>
          ) : (
            <p className="m-0 border-y border-border py-4 text-body text-text-muted">
              No reports yet.
            </p>
          )}
        </section>
      </div>
    );
  }

  function renderSegmented<T extends string>(
    options: ReadonlyArray<readonly [T, string]>,
    value: T,
    onChange: (next: T) => void
  ) {
    return (
      <div className="flex rounded border border-border bg-surface p-1">
        {options.map(([optionValue, label]) => {
          const active = value === optionValue;

          return (
            <Button
              aria-pressed={active}
              className={cn("flex-1", active && "bg-surface-muted text-text")}
              key={optionValue}
              onClick={() => onChange(optionValue)}
              variant={active ? "secondary" : "ghost"}
            >
              {label}
            </Button>
          );
        })}
      </div>
    );
  }

  function renderSessionBuilder() {
    const startCount = filteredPool.length
      ? Math.min(sessionCount || DEFAULT_COUNT, filteredPool.length)
      : 0;

    return (
      <div className="grid max-w-content gap-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="builder-semester" label="Semester">
            <Select
              id="builder-semester"
              onChange={(event) => {
                setSelectedSemester(event.target.value);
                setSelectedTopic("all");
              }}
              value={selectedSemester}
            >
              <option value="all">All semesters</option>
              {semesters.map((semester) => (
                <option key={semester.key} value={semester.key}>
                  {semester.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="builder-subject" label="Subject">
            <Select
              id="builder-subject"
              onChange={(event) => {
                setSelectedSubject(event.target.value);
                setSelectedTopic("all");
              }}
              value={selectedSubject}
            >
              <option value="all">All subjects</option>
              {subjects.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="builder-topic" label="Topic / exam">
            <Select
              id="builder-topic"
              onChange={(event) => setSelectedTopic(event.target.value)}
              value={selectedTopic}
            >
              <option value="all">All topics</option>
              {topics.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="builder-search" label="Search inside session">
            <Input
              id="builder-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Optional filter"
              value={query}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <span className="text-body-sm font-medium text-text">Mode</span>
            {renderSegmented(
              [
                ["study", "Study"],
                ["exam", "Exam"],
                ["review", "Review"]
              ] as const,
              mode,
              setMode
            )}
          </div>
          <div className="grid gap-2">
            <span className="text-body-sm font-medium text-text">Pool</span>
            {renderSegmented(
              [
                ["all", "All"],
                ["unanswered", "New"],
                ["wrong", "Wrong"],
                ["bookmarked", "Saved"]
              ] as const,
              pool,
              setPool
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="builder-count" label="Count">
            <Input
              id="builder-count"
              max={500}
              min={1}
              onChange={(event) => setSessionCount(Number(event.target.value))}
              type="number"
              value={sessionCount}
            />
          </Field>
          <Field htmlFor="builder-order" label="Order">
            <Select
              id="builder-order"
              onChange={(event) => setSessionOrder(event.target.value as SessionOrder)}
              value={sessionOrder}
            >
              <option value="latest">Newest exam</option>
              <option value="oldest">Oldest exam</option>
              <option value="subject">By subject</option>
              <option value="random">Shuffle</option>
            </Select>
          </Field>
        </div>

        <div>
          <Button disabled={!startCount} onClick={() => startSession()} variant="primary">
            <Play size={18} aria-hidden="true" />
            Start {startCount}
          </Button>
        </div>
      </div>
    );
  }
}

function titleForView(view: View) {
  const titles: Record<View, string> = {
    dashboard: "Dashboard",
    subjects: "Papers",
    trainer: "Trainer",
    search: "Search",
    sessions: "Sessions",
    mistakes: "Mistakes",
    bookmarks: "Bookmarks",
    admin: "Admin"
  };

  return titles[view];
}

function renderEmptyQuestion() {
  return (
    <div className="grid justify-items-start gap-2 border-y border-border py-8">
      <ClipboardList className="text-text-subtle" size={28} aria-hidden="true" />
      <h2 className="m-0 text-h3 font-semibold">No matching questions</h2>
      <p className="m-0 text-body text-text-muted">
        Adjust filters or start a broader session.
      </p>
    </div>
  );
}
