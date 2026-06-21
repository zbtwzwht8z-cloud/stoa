"use client";

import {
  AlertTriangle,
  Ban,
  BookMarked,
  BookOpenCheck,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  Download,
  Eraser,
  FileWarning,
  Gauge,
  History,
  Highlighter,
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
import { createTranslator, type Lang } from "@/lib/i18n";
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
  { view: "dashboard", label: "Übersicht", icon: LayoutDashboard },
  { view: "subjects", label: "Klausuren", icon: BookOpenCheck },
  { view: "trainer", label: "Sitzungen", icon: History },
  { view: "search", label: "Suche", icon: Search },
  { view: "mistakes", label: "Fehler", icon: NotebookPen },
  { view: "bookmarks", label: "Lesezeichen", icon: BookMarked },
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedText(
  text: string,
  highlights: string[],
  onHighlightToken?: (token: string) => void
) {
  const activeHighlights = sortUnique(highlights.map((highlight) => highlight.trim()))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);

  if (!activeHighlights.length && !onHighlightToken) {
    return text;
  }

  const parts = activeHighlights.length
    ? text.split(new RegExp(`(${activeHighlights.map(escapeRegExp).join("|")})`, "gi"))
    : [text];

  return parts.map((part, index) => {
    const highlighted = activeHighlights.some(
      (highlight) => highlight.toLowerCase() === part.toLowerCase()
    );

    return highlighted ? (
      <mark className="bg-[#f1d77a] text-text" key={`${part}-${index}`}>
        {part}
      </mark>
    ) : onHighlightToken ? (
      <span key={`${part}-${index}`}>
        {part.split(/(\s+)/).map((token, tokenIndex) =>
          token.trim() ? (
            <span
              className="cursor-text rounded-sm hover:bg-[#f1d77a]/45"
              key={`${token}-${tokenIndex}`}
              onClick={(event) => {
                event.stopPropagation();
                onHighlightToken(token);
              }}
            >
              {token}
            </span>
          ) : (
            token
          )
        )}
      </span>
    ) : (
      part
    );
  });
}

function questionClipboardText(question: Question) {
  const choices = question.choices
    .map((choice, index) => `${index + 1}. ${choice.text}`)
    .join("\n");

  return [question.stem.trim(), choices].filter(Boolean).join("\n\n");
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
    name: "Gespeichert",
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
    const body = await response.json().catch(() => ({ error: "Anfrage fehlgeschlagen" }));

    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export default function TrainerApp({ questionMetrics }: TrainerAppProps) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsReady, setQuestionsReady] = useState(false);
  const [questionsError, setQuestionsError] = useState("");
  const [authChecked, setAuthChecked] = useState(false);
  const [view, setView] = useState<View>("dashboard");
  const [navOpen, setNavOpen] = useState(false);
  const lang: Lang = "de";
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
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});
  const [excludedChoices, setExcludedChoices] = useState<Record<string, string[]>>({});
  const [questionHighlights, setQuestionHighlights] = useState<Record<string, string[]>>(
    {}
  );
  const [highlightMode, setHighlightMode] = useState(false);
  const [examFinished, setExamFinished] = useState(false);
  const [studyFinished, setStudyFinished] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState(now());
  const [papersTab, setPapersTab] = useState<"papers" | "custom">("papers");
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
  const questionContentRef = useRef<HTMLElement>(null);
  const lastChoiceKeyRef = useRef<{
    questionId: string;
    choiceId: string;
    at: number;
  } | null>(null);

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
      ? "Alle Semester"
      : semesters.find((semester) => semester.key === selectedSemester)?.label ||
        "Ausgewähltes Semester";
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
      .catch(() => setReady(true))
      .finally(() => setAuthChecked(true));
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
        error instanceof Error ? error.message : "Fragen konnten nicht geladen werden"
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

  function goToNextQuestion() {
    setActiveIndex((current) => Math.min(sessionQuestions.length - 1, current + 1));
  }

  function selectedChoiceFor(question: Question) {
    if (mode === "exam" && !examFinished) {
      return draftAnswers[question.id] || examAnswers[question.id];
    }

    return progress.answers[question.id]?.selected || draftAnswers[question.id];
  }

  function isChoiceExcluded(questionId: string, choiceId: string) {
    return excludedChoices[questionId]?.includes(choiceId) || false;
  }

  function selectChoice(question: Question, choiceId: string) {
    if (
      question.kind === "freeText" ||
      isChoiceExcluded(question.id, choiceId) ||
      (mode !== "exam" && Boolean(progress.answers[question.id]))
    ) {
      return;
    }

    setDraftAnswers((current) => ({ ...current, [question.id]: choiceId }));
  }

  function submitChoice(question: Question, choiceId?: string) {
    if (question.kind === "freeText") {
      if (progress.answers[question.id]) {
        goToNextQuestion();
      } else {
        revealFreeText(question);
      }
      return;
    }

    if (mode !== "exam" && progress.answers[question.id]) {
      goToNextQuestion();
      return;
    }

    const selected = choiceId || selectedChoiceFor(question);

    if (!selected || isChoiceExcluded(question.id, selected)) {
      return;
    }

    if (
      mode === "exam" &&
      !examFinished &&
      examAnswers[question.id] === selected &&
      !choiceId
    ) {
      goToNextQuestion();
      return;
    }

    if (mode === "exam" && !examFinished) {
      setExamAnswers((current) => ({ ...current, [question.id]: selected }));
    } else {
      recordAnswer(question, selected);
    }
  }

  function toggleExcludedChoice(question: Question, choiceId: string) {
    if (mode !== "exam" && progress.answers[question.id]) {
      return;
    }

    setExcludedChoices((current) => {
      const choices = new Set(current[question.id] || []);

      if (choices.has(choiceId)) {
        choices.delete(choiceId);
      } else {
        choices.add(choiceId);
      }

      return { ...current, [question.id]: Array.from(choices) };
    });

    if (selectedChoiceFor(question) === choiceId) {
      setDraftAnswers((current) => {
        const { [question.id]: _removed, ...remaining } = current;
        return remaining;
      });

      if (mode === "exam" && !examFinished) {
        setExamAnswers((current) => {
          const { [question.id]: _removed, ...remaining } = current;
          return remaining;
        });
      }
    }
  }

  function captureHighlight(questionId: string) {
    if (!highlightMode) {
      return;
    }

    const selection = window.getSelection();
    const root = questionContentRef.current;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const selectedText = selection?.toString().replace(/\s+/g, " ").trim() || "";

    if (!root || !range || !root.contains(range.commonAncestorContainer) || !selectedText) {
      return;
    }

    setQuestionHighlights((current) => ({
      ...current,
      [questionId]: Array.from(new Set([...(current[questionId] || []), selectedText]))
    }));
    selection?.removeAllRanges();
  }

  function highlightToken(questionId: string, token: string) {
    const selectedText = token.replace(
      /^[.,;:!?()[\]{}"'„“‚’]+|[.,;:!?()[\]{}"'„“‚’]+$/g,
      ""
    );

    if (!selectedText) {
      return;
    }

    setQuestionHighlights((current) => ({
      ...current,
      [questionId]: Array.from(new Set([...(current[questionId] || []), selectedText]))
    }));
  }

  function clearQuestionHighlights(questionId: string) {
    setQuestionHighlights((current) => {
      const { [questionId]: _removed, ...remaining } = current;
      return remaining;
    });
  }

  async function copyQuestion(question: Question) {
    const text = questionClipboardText(question);

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }

    setNotice("Frage und Antworten kopiert");
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
    lastChoiceKeyRef.current = null;

    if (view === "trainer" && sessionIds.length) {
      stemRef.current?.scrollIntoView({ block: "start" });
    }
  }, [activeIndex, sessionIds.length, view]);

  useEffect(() => {
    if (view !== "trainer" || queueOpen || reportOpen || studyFinished || !activeQuestion) {
      return;
    }

    const question = activeQuestion;

    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;

      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "arrowright" || key === "n") {
        event.preventDefault();
        goToNextQuestion();
        return;
      }

      if (key === "arrowleft" || key === "p") {
        event.preventDefault();
        setActiveIndex((current) => Math.max(0, current - 1));
        return;
      }

      if (question.kind === "freeText") {
        if (key === "enter" || key === " ") {
          event.preventDefault();
          submitChoice(question);
        }

        return;
      }

      if (key === "enter" || key === " ") {
        event.preventDefault();
        submitChoice(question);
        return;
      }

      const exclusionIndex = "qwert".indexOf(key);

      if (exclusionIndex !== -1 && exclusionIndex < question.choices.length) {
        event.preventDefault();
        toggleExcludedChoice(question, question.choices[exclusionIndex].id);
        return;
      }

      const index = "12345".indexOf(event.key);

      if (index === -1 || index >= question.choices.length) {
        return;
      }

      const choiceId = question.choices[index].id;

      if (isChoiceExcluded(question.id, choiceId)) {
        return;
      }

      event.preventDefault();
      selectChoice(question, choiceId);

      const previous = lastChoiceKeyRef.current;
      const pressedAt = Date.now();

      if (
        !event.repeat &&
        previous?.questionId === question.id &&
        previous.choiceId === choiceId &&
        pressedAt - previous.at <= 400
      ) {
        submitChoice(question, choiceId);
        lastChoiceKeyRef.current = null;
      } else {
        lastChoiceKeyRef.current = {
          questionId: question.id,
          choiceId,
          at: pressedAt
        };
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeQuestion,
    draftAnswers,
    examAnswers,
    examFinished,
    excludedChoices,
    mode,
    progress.answers,
    queueOpen,
    reportOpen,
    sessionQuestions.length,
    studyFinished,
    view
  ]);

  useEffect(() => {
    document.documentElement.lang = "de";
  }, []);

  function endSession() {
    setSessionIds([]);
    setActiveSessionLogId(null);
    setActiveIndex(0);
    setExamAnswers({});
    setDraftAnswers({});
    setExcludedChoices({});
    setQuestionHighlights({});
    setHighlightMode(false);
    setExamFinished(false);
    setStudyFinished(false);
    setQueueOpen(false);
    setReportOpen(false);
  }

  function patchProgress(updater: (current: StoredProgress) => StoredProgress) {
    setProgress((current) => normalizeProgress(updater(normalizeProgress(current))));
  }

  function sessionLabel(nextMode = mode, nextPool = pool) {
    // A readable name describing what the session actually contains, e.g.
    // "Lernen · Allgemeinmedizin · Neue Fragen". Falls back to the semester
    // when no subject is picked.
    const parts = [
      selectedSubject === "all" ? selectedSemesterLabel : selectedSubject,
      selectedTopic === "all" ? null : selectedTopic,
      poolLabel(nextPool)
    ].filter(Boolean);

    return `${modeLabel(nextMode)} · ${parts.join(" · ")}`;
  }

  function modeLabel(value: SessionMode) {
    if (value === "exam") {
      return "Prüfung";
    }

    if (value === "review") {
      return "Wiederholung";
    }

    return "Lernen";
  }

  function poolLabel(value: Pool) {
    const labels: Record<Pool, string | null> = {
      all: null,
      unanswered: "Neue Fragen",
      wrong: "Falsch beantwortet",
      bookmarked: "Gespeichert"
    };

    return labels[value];
  }

  // Builds a descriptive name for a multi-paper session: groups by subject and
  // lists the exam terms, e.g. "Anatomie · WS20/21, SS21" or "Anatomie,
  // Physiologie" for several subjects. Never just "N Klausuren".
  function describePapers(papers: PaperSummary[]) {
    const subjects = Array.from(new Set(papers.map((paper) => paper.subject)));

    if (subjects.length === 1) {
      const terms = papers.map((paper) => paper.examTerm).filter(Boolean);

      return terms.length
        ? `${subjects[0]} · ${terms.join(", ")}`
        : subjects[0];
    }

    if (subjects.length <= 3) {
      return subjects.join(", ");
    }

    return `${subjects.slice(0, 3).join(", ")} +${subjects.length - 3}`;
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
    setDraftAnswers({});
    setExcludedChoices({});
    setQuestionHighlights({});
    setHighlightMode(false);
    setExamFinished(false);
    setStudyFinished(false);
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
      subject: selectedSubject === "all" ? "Alle Fächer" : selectedSubject,
      topic: selectedTopic === "all" ? "Alle Themen" : selectedTopic,
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
      : describePapers(papers);

    startSessionFromIds(ids, nextMode, label, {
      paperKey: single?.key,
      semester: single?.semesterLabel || "Mehrere",
      subject: single ? single.subject : describePapers(papers),
      topic: single ? single.examTerm : `${ids.length} Fragen`,
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
          finishedAt: now(),
          closed: true
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
                finishedAt: now(),
                closed: true
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

    setDraftAnswers((current) => {
      const { [activeQuestion.id]: _removed, ...remaining } = current;
      return remaining;
    });
    setExcludedChoices((current) => {
      const { [activeQuestion.id]: _removed, ...remaining } = current;
      return remaining;
    });

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
    setNotice("Meldung gesendet");
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
        resolution: "Geprüft"
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
      setNotice("Name und ein Passwort mit mindestens 8 Zeichen sind erforderlich");
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
      setNotice("Benutzer hinzugefügt");
      refreshUsers();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Benutzer konnte nicht hinzugefügt werden");
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
      setNotice(error instanceof Error ? error.message : "Aktualisierung fehlgeschlagen");
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

    patchUser(userId, { name }, "Benutzer umbenannt");
  }

  function resetUserPassword(userId: string) {
    const password = (editingPasswords[userId] || "").trim();

    if (password.length < 8) {
      setNotice("Das neue Passwort muss mindestens 8 Zeichen haben");
      return;
    }

    patchUser(userId, { password }, "Passwort zurückgesetzt").then(() =>
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
      setNotice("Benutzer entfernt");
      refreshUsers();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Benutzer konnte nicht entfernt werden");
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
      setAuthError(error instanceof Error ? error.message : "Anmeldung fehlgeschlagen");
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
    setNotice("Fortschritt importiert");
  }

  function jumpToQuestion(questionId: string) {
    setSessionIds([questionId]);
    setActiveIndex(0);
    setMode("study");
    setExamFinished(false);
    setStudyFinished(false);
    setView("trainer");
  }

  if (user && questionsError) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-bg px-6 font-sans text-body text-text">
        <AlertTriangle className="text-danger" size={28} aria-hidden="true" />
        <p className="m-0 text-body text-text-muted">{questionsError}</p>
        <Button onClick={loadQuestions} variant="secondary">
          Erneut versuchen
        </Button>
      </main>
    );
  }

  if (!authChecked || (user && (!ready || !questionsReady))) {
    return (
      <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-4 bg-bg px-6 font-sans text-body text-text">
        <Gauge className="text-text-subtle" size={28} aria-hidden="true" />
        <p className="m-0 text-body text-text-muted">
          {ready && authChecked ? "Fragenkatalog wird geladen" : "Wird geladen"}
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
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full bg-accent" />
          <strong className="text-h3 font-semibold">Stoa</strong>
        </div>
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
          <span className="text-label text-text-subtle">
            {user.role === "admin" ? "Admin" : "Mitglied"}
          </span>
        </div>
        <Button aria-label="Abmelden" className="px-3" onClick={logout} variant="ghost">
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
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-bg/90 px-8 py-5 backdrop-blur lg:px-12">
          <Button
            aria-label="Navigation öffnen"
            className="px-2 md:hidden"
            onClick={() => setNavOpen(true)}
            variant="ghost"
          >
            <Menu size={20} aria-hidden="true" />
          </Button>
          <h1 className="m-0 text-h2 font-semibold">{titleForView(view)}</h1>
        </header>

        {notice ? (
          <div
            className="mx-8 mt-6 flex items-center justify-between gap-4 rounded border border-border bg-surface px-4 py-3 text-body-sm text-text lg:mx-12"
            role="status"
          >
            <span>{notice}</span>
            <Button
              aria-label="Schließen"
              className="px-2"
              onClick={() => setNotice("")}
              variant="ghost"
            >
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        <div className="min-w-0 flex-1 px-8 py-8 lg:px-12 lg:py-10">
          {view === "dashboard" ? renderDashboard() : null}
          {view === "subjects" ? renderSubjects() : null}
          {view === "trainer" ? renderTrainer() : null}
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
          <Stat accent label={t("stat.accuracy")} value={formatPercent(stats.accuracy)} />
          <Stat label={t("stat.mistakes")} value={formatNumber(stats.missed)} />
          <Stat
            label={t("stat.coverage")}
            value={`${coverage < 1 && coverage > 0 ? "<1" : Math.round(coverage)}%`}
          />
        </section>

        <section className="grid gap-4">
          <h2 className="m-0 text-h3 font-semibold">{t("dashboard.start")}</h2>
          <div className="flex flex-wrap gap-4">
            <Button
              onClick={() => {
                setPapersTab("custom");
                setView("subjects");
              }}
              variant="primary"
            >
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
            <Button
              onClick={() => {
                setPapersTab("papers");
                setView("subjects");
              }}
              variant="secondary"
            >
              <BookOpenCheck size={18} aria-hidden="true" />
              {t("dashboard.papers")}
            </Button>
          </div>
          <p className="m-0 text-body-sm text-text-muted">
            {formatNumber(stats.answered)} von {formatNumber(questions.length)} Fragen
            beantwortet · {sessionLogs.length}{" "}
            {sessionLogs.length === 1 ? "Sitzung" : "Sitzungen"}
          </p>
        </section>

        {recentSessions.length ? (
          <section className="grid gap-4">
            <h2 className="m-0 text-h3 font-semibold">{t("dashboard.recent")}</h2>
            <div className="grid gap-4">
              {recentSessions.map((session) => (
                <button
                  className="flex w-full items-center justify-between gap-4 rounded border border-border bg-surface px-4 py-4 text-left transition-colors hover:bg-surface-muted"
                  key={session.id}
                  onClick={() => setView("trainer")}
                  type="button"
                >
                  <span className="min-w-0 truncate text-body font-medium text-text">
                    {session.label}
                  </span>
                  <span className="shrink-0 text-body-sm text-text-muted">
                    {session.answered
                      ? `${Math.round((session.correct / session.answered) * 100)}%`
                      : "—"}{" "}
                    · {new Date(session.finishedAt).toLocaleDateString("de-DE")}
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
                      <span>{entry.weeklyAnswered} beantwortet</span>
                      <span>{entry.accuracy}% Trefferquote</span>
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
        customSessionBuilder={renderSessionBuilder()}
        mode={mode === "exam" ? "exam" : "study"}
        onModeChange={setMode}
        onSemesterChange={setPapersSemester}
        onStartPaper={startPaper}
        onStartPapers={startPapers}
        onTabChange={setPapersTab}
        selectedSemester={papersSemester}
        semesters={curriculum}
        t={t}
        tab={papersTab}
      />
    );
  }

  function resumeSession(session: StudySessionLog) {
    const ids = session.questionIds.filter((questionId) => questionById.has(questionId));

    if (!ids.length) {
      setNotice("Diese Sitzung enthält keine verfügbaren Fragen");
      return;
    }

    const firstUnanswered = ids.findIndex((questionId) => !progress.answers[questionId]);

    setMode(session.mode === "exam" ? "exam" : session.mode === "review" ? "review" : "study");
    setSessionIds(ids);
    setActiveIndex(firstUnanswered === -1 ? 0 : firstUnanswered);
    setExamAnswers({});
    setDraftAnswers({});
    setExcludedChoices({});
    setQuestionHighlights({});
    setHighlightMode(false);
    setExamFinished(false);
    setStudyFinished(false);
    setSessionStartedAt(session.startedAt);
    setActiveSessionLogId(session.id);
    setQueueOpen(false);
    setView("trainer");
  }

  function renderTrainer() {
    if (!sessionIds.length) {
      const latestMistakeSession = sessionLogs.find(
        (session) => session.mistakeQuestionIds?.length
      );
      const openSessions = sessionLogs.filter(isOpenSession);
      const history = sessionLogs.filter((session) => !isOpenSession(session));

      return (
        <div className="mx-auto grid max-w-content gap-8">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
            <p className="m-0 max-w-[480px] text-body text-text-muted">
              Setze eine offene Sitzung fort oder erstelle eine neue über den
              Reiter „Klausuren".
            </p>
            <Button
              onClick={() =>
                latestMistakeSession
                  ? reviewSessionMistakes(latestMistakeSession)
                  : startSession("review", "wrong")
              }
              variant="primary"
            >
              <ListChecks size={18} aria-hidden="true" />
              <span>Fehler wiederholen</span>
            </Button>
          </div>

          {openSessions.length ? (
            <section className="grid gap-4">
              <h2 className="m-0 text-h3 font-semibold">Offene Sitzungen</h2>
              <div className="grid gap-4">
                {openSessions.map((session) => renderSessionCard(session))}
              </div>
            </section>
          ) : null}

          <section className="grid gap-4">
            <h2 className="m-0 text-h3 font-semibold">Verlauf</h2>
            {history.length ? (
              <div className="grid gap-4">
                {history.map((session) => renderSessionCard(session))}
              </div>
            ) : (
              <p className="m-0 rounded border border-border bg-surface px-4 py-6 text-body text-text-muted">
                Noch keine abgeschlossenen Sitzungen. Starte eine über den Reiter
                „Klausuren".
              </p>
            )}
          </section>
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
              aria-label="Sitzung verlassen"
              className="px-2"
              onClick={endSession}
              variant="ghost"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </Button>
            <div className="min-w-0">
              <p className="m-0 truncate text-body font-medium">
                {activeSession?.label || "Sitzung"}
              </p>
              <p className="m-0 text-body-sm text-text-muted">
                {total ? activeIndex + 1 : 0} von {total}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button className="px-3" onClick={() => setQueueOpen(true)} variant="ghost">
              <ListChecks size={18} aria-hidden="true" />
              <span>Übersicht</span>
            </Button>
            {mode === "exam" && !examFinished ? (
              <Button onClick={finishExam} variant="primary">
                <Timer size={16} aria-hidden="true" />
                Abschließen
              </Button>
            ) : null}
            {mode !== "exam" && !studyFinished ? (
              <Button onClick={submitStudySession} variant="primary">
                <Check size={16} aria-hidden="true" />
                Abgeben
              </Button>
            ) : null}
          </div>
        </div>

        {studyFinished
          ? renderStudyResults()
          : activeQuestion
            ? renderQuestion(activeQuestion)
            : renderEmptyQuestion()}

        {!studyFinished ? (
          <div
            className="sticky bottom-0 z-10 -mx-6 flex items-center justify-between gap-3 border-t border-border bg-bg/95 px-6 py-3 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:backdrop-blur-none"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <Button disabled={activeIndex === 0} onClick={goPrev} variant="secondary">
              <ChevronLeft size={18} aria-hidden="true" />
              <span>Zurück</span>
            </Button>
            <span className="text-body-sm text-text-muted">
              {total ? activeIndex + 1 : 0} / {total}
            </span>
            <Button
              disabled={activeIndex >= total - 1}
              onClick={goNext}
              variant="secondary"
            >
              <span>Weiter</span>
              <ChevronRight size={18} aria-hidden="true" />
            </Button>
          </div>
        ) : null}

        {queueOpen ? renderQueueDrawer() : null}
      </div>
    );
  }

  // Submits a study/review session: marks it closed (moves it to history) and
  // shows the score screen.
  function submitStudySession() {
    if (activeSessionLogId) {
      closeSession(activeSessionLogId);
    }

    setStudyFinished(true);
  }

  function renderStudyResults() {
    const activeSession = sessionLogs.find(
      (session) => session.id === activeSessionLogId
    );
    const total = sessionQuestions.length;
    const answered = activeSession?.answered ?? 0;
    const correct = activeSession?.correct ?? 0;
    const mistakeIds = activeSession?.mistakeQuestionIds || [];
    const accuracy = answered ? Math.round((correct / answered) * 100) : 0;

    return (
      <section className="grid gap-5 rounded border border-border bg-surface p-6 text-center">
        <div className="grid gap-1">
          <span className="text-label text-text-subtle">Sitzung abgeschlossen</span>
          <strong className="text-h1 font-semibold text-accent">{accuracy}%</strong>
          <p className="m-0 text-body-sm text-text-muted">
            {correct} von {answered} bewertet richtig · {total} Fragen insgesamt
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button onClick={() => setStudyFinished(false)} variant="secondary">
            <ChevronLeft size={18} aria-hidden="true" />
            <span>Weiter ansehen</span>
          </Button>
          {mistakeIds.length ? (
            <Button
              onClick={() => activeSession && reviewSessionMistakes(activeSession)}
              variant="primary"
            >
              <ListChecks size={18} aria-hidden="true" />
              <span>{mistakeIds.length} Fehler üben</span>
            </Button>
          ) : null}
          <Button onClick={endSession} variant="ghost">
            Sitzung verlassen
          </Button>
        </div>
      </section>
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
          aria-label="Fragenübersicht"
          className="absolute inset-y-0 right-0 flex w-80 max-w-[85%] flex-col border-l border-border bg-surface"
        >
          <div className="flex items-center justify-between border-b border-border p-4">
            <strong className="text-body font-semibold">Übersicht</strong>
            <Button
              aria-label="Übersicht schließen"
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

  function renderQuestionActions(question: Question, isBookmarked: boolean) {
    const hasHighlights = Boolean(questionHighlights[question.id]?.length);

    return (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
        <Button
          aria-label="Frage kopieren"
          className="min-h-[44px] min-w-[44px] px-3"
          onClick={() => void copyQuestion(question)}
          title="Frage kopieren"
          variant="ghost"
        >
          <Copy size={18} aria-hidden="true" />
          <span className="hidden sm:inline">Kopieren</span>
        </Button>
        <Button
          aria-label="Textmarker"
          aria-pressed={highlightMode}
          className="min-h-[44px] min-w-[44px] px-3"
          onClick={() => setHighlightMode((current) => !current)}
          title="Textmarker"
          variant={highlightMode ? "secondary" : "ghost"}
        >
          <Highlighter size={18} aria-hidden="true" />
          <span className="hidden sm:inline">Markieren</span>
        </Button>
        {hasHighlights ? (
          <Button
            aria-label="Markierungen löschen"
            className="min-h-[44px] min-w-[44px] px-2"
            onClick={() => clearQuestionHighlights(question.id)}
            title="Markierungen löschen"
            variant="ghost"
          >
            <Eraser size={18} aria-hidden="true" />
          </Button>
        ) : null}
        <Button
          aria-label={isBookmarked ? "Lesezeichen entfernen" : "Lesezeichen setzen"}
          className="min-h-[44px] min-w-[44px] px-2"
          onClick={() => toggleBookmark(question.id)}
          title={isBookmarked ? "Lesezeichen entfernen" : "Lesezeichen setzen"}
          variant="ghost"
        >
          {isBookmarked ? (
            <BookmarkCheck size={18} aria-hidden="true" />
          ) : (
            <Bookmark size={18} aria-hidden="true" />
          )}
        </Button>
        <Button
          aria-label="Frage melden"
          className="min-h-[44px] min-w-[44px] px-2"
          onClick={() => setReportOpen((current) => !current)}
          title="Frage melden"
          variant="ghost"
        >
          <FileWarning size={18} aria-hidden="true" />
        </Button>
      </div>
    );
  }

  function renderQuestion(question: Question) {
    if (question.kind === "freeText") {
      return renderFreeTextQuestion(question);
    }

    const storedAnswer = progress.answers[question.id];
    const currentSelected = selectedChoiceFor(question);
    const revealed = mode === "exam" ? examFinished : Boolean(storedAnswer);
    const locked = mode !== "exam" && Boolean(storedAnswer);
    const image = proxiedImage(question.imageUrl);
    const isBookmarked = bookmarkedIds.has(question.id);
    const highlights = questionHighlights[question.id] || [];
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
      <article
        className="grid gap-5"
        onMouseUp={() => captureHighlight(question.id)}
        ref={questionContentRef}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1">
            <span className="text-label text-text-subtle">{question.subject}</span>
            <strong className="text-body font-medium">{question.topic}</strong>
          </div>
          {renderQuestionActions(question, isBookmarked)}
        </div>

        <div className="grid gap-4" ref={stemRef}>
          <p className="m-0 whitespace-pre-line text-body leading-relaxed text-text">
            {renderHighlightedText(
              question.stem,
              highlights,
              highlightMode ? (token) => highlightToken(question.id, token) : undefined
            )}
          </p>
          {image ? (
            <img alt="" className="max-h-96 rounded border border-border" loading="lazy" src={image} />
          ) : null}
        </div>

        <div className="grid gap-2">
          {question.choices.map((choice) => {
            const selected = currentSelected === choice.id;
            const correct = question.answer === choice.id;
            const excluded = isChoiceExcluded(question.id, choice.id);

            return (
              <div
                className={cn(
                  "flex w-full items-stretch rounded border border-border bg-surface transition-colors",
                  !locked && !excluded && "hover:bg-surface-muted",
                  locked && !selected && "cursor-default opacity-70",
                  excluded && "bg-surface-muted text-text-subtle",
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
              >
                <button
                  aria-pressed={selected}
                  className={cn(
                    "flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left text-body",
                    highlightMode && "cursor-text select-text"
                  )}
                  disabled={locked || excluded}
                  onClick={() => {
                    if (!highlightMode) {
                      selectChoice(question, choice.id);
                    }
                  }}
                  onDoubleClick={() => {
                    if (!highlightMode) {
                      submitChoice(question, choice.id);
                    }
                  }}
                  type="button"
                >
                  <span className="w-5 shrink-0 font-medium text-text-muted">
                    {choice.id}
                  </span>
                  <span className={cn("min-w-0 flex-1", excluded && "line-through")}>
                    {renderHighlightedText(
                      choice.text,
                      highlights,
                      highlightMode ? (token) => highlightToken(question.id, token) : undefined
                    )}
                  </span>
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
                <button
                  aria-label={`${choice.id} ausschließen`}
                  aria-pressed={excluded}
                  className={cn(
                    "flex w-[44px] min-w-[44px] shrink-0 items-center justify-center border-l border-border text-text-subtle transition-colors hover:bg-surface-muted hover:text-text",
                    excluded && "text-danger"
                  )}
                  disabled={locked}
                  onClick={() => toggleExcludedChoice(question, choice.id)}
                  title={excluded ? "Ausschluss aufheben" : "Antwort ausschließen"}
                  type="button"
                >
                  <Ban size={17} aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>

        {!revealed ? (
          <Button
            disabled={!currentSelected}
            onClick={() => submitChoice(question)}
            variant="primary"
          >
            {mode === "exam" && examAnswers[question.id]
              ? "Weiter"
              : mode === "exam"
                ? "Auswahl bestätigen"
                : "Antwort abgeben"}
          </Button>
        ) : null}

        {currentSelected && revealed ? (
          <section className="grid gap-3 rounded border border-border bg-surface-muted p-4">
            <div className="flex items-center gap-2">
              {isCorrect ? (
                <Check className="text-accent" size={18} aria-hidden="true" />
              ) : (
                <AlertTriangle className="text-danger" size={18} aria-hidden="true" />
              )}
              <strong className="text-body font-medium">
                {isCorrect ? "Richtig" : "Falsch"}
              </strong>
            </div>

            {correctPct !== null && stats ? (
              <p className="m-0 text-body-sm text-text-muted">
                {correctPct}% haben richtig geantwortet · {formatNumber(stats.answered)}{" "}
                Versuche
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
                  Kommentare und Korrekturen
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
              <div aria-label="Selbsteinschätzung" className="flex flex-wrap gap-2 pt-1">
                {(
                  [
                    ["low", "Geraten"],
                    ["medium", "Unsicher"],
                    ["high", "Gewusst"]
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
            <span>Im Prüfungsmodus bleibt das Feedback bis zum Abschluss der Sitzung verborgen.</span>
          </section>
        ) : null}

        {reportOpen ? (
          <section className="grid gap-3 rounded border border-border bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
              <Select
                onChange={(event) => setReportType(event.target.value as ReportType)}
                value={reportType}
              >
                <option value="wrong-answer">Falsche Antwort</option>
                <option value="typo">Tippfehler</option>
                <option value="unclear">Unklar</option>
                <option value="other">Sonstiges</option>
              </Select>
              <Input
                onChange={(event) => setReportText(event.target.value)}
                placeholder="Korrektur, Tippfehler oder Hinweis für Admins"
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
                Senden
              </Button>
              <Button onClick={() => setReportOpen(false)} variant="ghost">
                Abbrechen
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
            <span>Antwort löschen</span>
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
    const highlights = questionHighlights[question.id] || [];

    return (
      <article
        className="grid gap-5"
        onMouseUp={() => captureHighlight(question.id)}
        ref={questionContentRef}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1">
            <span className="text-label text-text-subtle">{question.subject}</span>
            <strong className="text-body font-medium">{question.topic}</strong>
          </div>
          {renderQuestionActions(question, isBookmarked)}
        </div>

        <div className="grid gap-4" ref={stemRef}>
          <span className="inline-flex w-fit items-center rounded border border-border px-2 py-0.5 text-label text-text-subtle">
            Freitext
          </span>
          <p className="m-0 whitespace-pre-line text-body leading-relaxed text-text">
            {renderHighlightedText(
              question.stem,
              highlights,
              highlightMode ? (token) => highlightToken(question.id, token) : undefined
            )}
          </p>
          {image ? (
            <img alt="" className="max-h-96 rounded border border-border" loading="lazy" src={image} />
          ) : null}
        </div>

        {!storedAnswer ? (
          <Button onClick={() => revealFreeText(question)} variant="primary">
            Antwort anzeigen
          </Button>
        ) : !revealed ? (
          <section className="flex items-center gap-2 rounded border border-border bg-surface-muted p-4 text-body-sm text-text-muted">
            <Timer size={18} aria-hidden="true" />
            <span>Die Musterantwort ist bis zum Abschluss der Prüfung verborgen.</span>
          </section>
        ) : (
          <section className="grid gap-3 rounded border border-border bg-surface-muted p-4">
            <strong className="text-body font-medium">Musterantwort</strong>
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
                  Kommentare und Korrekturen
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

            <div aria-label="Selbsteinschätzung" className="flex flex-wrap gap-2 pt-1">
              {(
                [
                  ["low", "Geraten"],
                  ["medium", "Unsicher"],
                  ["high", "Gewusst"]
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
                <option value="wrong-answer">Falsche Antwort</option>
                <option value="typo">Tippfehler</option>
                <option value="unclear">Unklar</option>
                <option value="other">Sonstiges</option>
              </Select>
              <Input
                onChange={(event) => setReportText(event.target.value)}
                placeholder="Korrektur, Tippfehler oder Hinweis für Admins"
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
                Senden
              </Button>
              <Button onClick={() => setReportOpen(false)} variant="ghost">
                Abbrechen
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
            <span>Antwort löschen</span>
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
      setNotice("Für diese Sitzung sind keine Fehler gespeichert");
      return;
    }

    startSessionFromIds(uniqueIds, "review", `Fehler · ${session.label}`, {
      ...session.source,
      pool: "session mistakes"
    });
  }

  function replaySession(session: StudySessionLog) {
    const ids = session.questionIds.filter((questionId) => questionById.has(questionId));

    if (!ids.length) {
      setNotice("Diese Sitzung enthält keine verfügbaren Fragen");
      return;
    }

    startSessionFromIds(ids, session.mode, `Wiederholung · ${session.label}`, session.source);
  }

  // Marks a session as closed: it stays in the history with its stats, but is
  // no longer offered for "Fortsetzen" (resume).
  function closeSession(sessionId: string) {
    patchProgress((current) => ({
      ...current,
      sessionLog: (current.sessionLog || []).map((session) =>
        session.id === sessionId
          ? { ...session, closed: true, finishedAt: now() }
          : session
      )
    }));
  }

  // Deletes a session AND its contribution to stats: any answers that were
  // recorded for this session's questions within its time window are removed,
  // so accuracy/coverage no longer count them.
  function deleteSession(session: StudySessionLog) {
    if (activeSessionLogId === session.id) {
      endSession();
    }

    const startedAt = new Date(session.startedAt).getTime();
    const finishedAt = new Date(session.finishedAt).getTime();
    const questionIds = Array.from(new Set(session.questionIds));

    patchProgress((current) => {
      const answers = { ...current.answers };

      for (const questionId of questionIds) {
        const answeredAt = answers[questionId]?.answeredAt;

        if (!answeredAt) {
          continue;
        }

        const at = new Date(answeredAt).getTime();

        if (at >= startedAt && at <= finishedAt) {
          delete answers[questionId];
        }
      }

      return {
        ...current,
        answers,
        sessionLog: (current.sessionLog || []).filter((entry) => entry.id !== session.id)
      };
    });

    setNotice("Sitzung gelöscht");
  }

  function isOpenSession(session: StudySessionLog) {
    return !session.closed && session.answered < session.questionIds.length;
  }

  function renderSessionCard(session: StudySessionLog) {
    const open = isOpenSession(session);
    const total = session.questionIds.length;
    const mistakes = session.mistakeQuestionIds?.length || 0;
    const graded = session.correct + mistakes;
    const accuracy = graded ? Math.round((session.correct / graded) * 100) : null;

    return (
      <div
        className="grid gap-3 rounded border border-border bg-surface p-4"
        key={session.id}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <span className="truncate text-body font-medium text-text">
              {session.label}
            </span>
            <span className="text-body-sm text-text-muted">
              {new Date(session.finishedAt).toLocaleDateString("de-DE")} ·{" "}
              {session.answered}/{total} beantwortet
              {accuracy !== null ? ` · ${accuracy}% richtig` : ""}
              {mistakes ? ` · ${mistakes} Fehler` : ""}
            </span>
          </div>
          <span
            className={cn(
              "shrink-0 rounded border px-2 py-0.5 text-label",
              open
                ? "border-accent text-accent"
                : "border-border text-text-subtle"
            )}
          >
            {open ? "Offen" : "Abgeschlossen"}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {open ? (
            <Button className="px-3" onClick={() => resumeSession(session)} variant="primary">
              <Play size={16} aria-hidden="true" />
              <span>Fortsetzen</span>
            </Button>
          ) : (
            <Button className="px-3" onClick={() => replaySession(session)} variant="secondary">
              <RotateCcw size={16} aria-hidden="true" />
              <span>Wiederholen</span>
            </Button>
          )}
          {mistakes ? (
            <Button
              className="px-3"
              onClick={() => reviewSessionMistakes(session)}
              variant="secondary"
            >
              <ListChecks size={16} aria-hidden="true" />
              <span>Fehler üben</span>
            </Button>
          ) : null}
          {open ? (
            <Button className="px-3" onClick={() => closeSession(session.id)} variant="ghost">
              <Check size={16} aria-hidden="true" />
              <span>Beenden</span>
            </Button>
          ) : null}
          <Button
            className="px-3 text-danger"
            onClick={() => deleteSession(session)}
            variant="ghost"
          >
            <Trash2 size={16} aria-hidden="true" />
            <span>Löschen</span>
          </Button>
        </div>
      </div>
    );
  }

  function renderSearch() {
    const tooShort = clean(searchQuery).length < 2;

    return (
      <div className="mx-auto grid max-w-content gap-5">
        <Field htmlFor="search-input" label="Fragen, Antworten und Kommentare durchsuchen">
          <Input
            id="search-input"
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Mindestens 2 Buchstaben eingeben"
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
            {tooShort
              ? "Gib mindestens 2 Buchstaben ein, um zu suchen."
              : "Keine Treffer gefunden."}
          </p>
        )}
      </div>
    );
  }

  function renderMistakes() {
    return (
      <div className="mx-auto grid max-w-content gap-4">
        <h2 className="m-0 text-h3 font-semibold">
          {missedQuestions.length}{" "}
          {missedQuestions.length === 1 ? "zu übende Frage" : "zu übende Fragen"}
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
                  Gewählt {answer.selected}, richtig {question.answer}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="m-0 border-y border-border py-4 text-body text-text-muted">
            Noch keine Fehler. Sie erscheinen hier, sobald du eine Frage falsch beantwortest.
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
            {folders.length} {folders.length === 1 ? "Ordner" : "Ordner"}
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
              placeholder="Neuer Ordner"
              value={newFolderName}
            />
            <Button onClick={createFolder} variant="secondary">
              Hinzufügen
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
              Noch keine gespeicherten Fragen in diesem Ordner.
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
          <Stat label="Benutzer" value={users.length} />
          <Stat label="Synchronisiert" value={adminState?.progressUsers || 0} />
          <Stat label="Offene Meldungen" value={openReports.length} />
          <Stat label="Speicher" value={adminState?.storage || "—"} />
        </section>

        <section className="grid gap-4">
          <h2 className="m-0 text-h3 font-semibold">Benutzer hinzufügen</h2>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_8rem_auto] sm:items-end">
            <Field htmlFor="new-user-name" label="Name">
              <Input
                id="new-user-name"
                onChange={(event) => setNewUserName(event.target.value)}
                placeholder="Anzeigename"
                value={newUserName}
              />
            </Field>
            <Field htmlFor="new-user-password" label="Passwort">
              <Input
                id="new-user-password"
                onChange={(event) => setNewUserPassword(event.target.value)}
                placeholder="Mindestens 8 Zeichen"
                type="password"
                value={newUserPassword}
              />
            </Field>
            <Field htmlFor="new-user-role" label="Rolle">
              <Select
                id="new-user-role"
                onChange={(event) =>
                  setNewUserRole(event.target.value as TrainerUser["role"])
                }
                value={newUserRole}
              >
                <option value="member">Mitglied</option>
                <option value="admin">Admin</option>
              </Select>
            </Field>
            <Button onClick={createUser} variant="primary">
              <UserPlus size={18} aria-hidden="true" />
              Hinzufügen
            </Button>
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="m-0 text-h3 font-semibold">Benutzer</h2>
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
                          <span className="text-text-subtle"> · deaktiviert</span>
                        ) : null}
                      </span>
                      <span className="text-label text-text-subtle">
                        {account.id} · {account.role}
                        {locked ? " · konfiguriert" : ""}
                      </span>
                    </div>
                    {locked ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-label text-text-subtle">
                        Gesperrt
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
                          <option value="member">Mitglied</option>
                          <option value="admin">Admin</option>
                        </Select>
                        <Button
                          disabled={isSelf}
                          onClick={() =>
                            patchUser(
                              account.id,
                              { disabled: !account.disabled },
                              account.disabled ? "Benutzer aktiviert" : "Benutzer deaktiviert"
                            )
                          }
                          variant="ghost"
                        >
                          {account.disabled ? "Aktivieren" : "Deaktivieren"}
                        </Button>
                        <Button
                          onClick={() => renameUser(account.id, account.name)}
                          variant="ghost"
                        >
                          Umbenennen
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
                        placeholder="Neues Passwort"
                        type="password"
                        value={editingPasswords[account.id] || ""}
                      />
                      <Button
                        onClick={() => resetUserPassword(account.id)}
                        variant="secondary"
                      >
                        <KeyRound size={17} aria-hidden="true" />
                        Zurücksetzen
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="grid gap-3">
          <h2 className="m-0 text-h3 font-semibold">Daten</h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={exportState} variant="secondary">
              <Download size={18} aria-hidden="true" />
              Status exportieren
            </Button>
            <label className="inline-flex h-control cursor-pointer items-center gap-2 rounded border border-border bg-surface px-4 text-body-sm font-medium text-text transition-colors hover:bg-surface-muted">
              <Import size={18} aria-hidden="true" />
              Fortschritt importieren
              <input
                accept="application/json"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];

                  if (file) {
                    importState(file).catch((error) =>
                      setNotice(error instanceof Error ? error.message : "Import fehlgeschlagen")
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
            {openReports.length} offene{" "}
            {openReports.length === 1 ? "Meldung" : "Meldungen"}
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
                        Erledigt
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
              Noch keine Meldungen.
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
              <option value="all">Alle Semester</option>
              {semesters.map((semester) => (
                <option key={semester.key} value={semester.key}>
                  {semester.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="builder-subject" label="Fach">
            <Select
              id="builder-subject"
              onChange={(event) => {
                setSelectedSubject(event.target.value);
                setSelectedTopic("all");
              }}
              value={selectedSubject}
            >
              <option value="all">Alle Fächer</option>
              {subjects.map((subject) => (
                <option key={subject} value={subject}>
                  {subject}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="builder-topic" label="Thema / Klausur">
            <Select
              id="builder-topic"
              onChange={(event) => setSelectedTopic(event.target.value)}
              value={selectedTopic}
            >
              <option value="all">Alle Themen</option>
              {topics.map((topic) => (
                <option key={topic} value={topic}>
                  {topic}
                </option>
              ))}
            </Select>
          </Field>
          <Field htmlFor="builder-search" label="In Sitzung suchen">
            <Input
              id="builder-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Optionaler Filter"
              value={query}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <span className="text-body-sm font-medium text-text">Modus</span>
            {renderSegmented(
              [
                ["study", "Lernen"],
                ["exam", "Prüfung"],
                ["review", "Wiederholung"]
              ] as const,
              mode,
              setMode
            )}
          </div>
          <div className="grid gap-2">
            <span className="text-body-sm font-medium text-text">Auswahl</span>
            {renderSegmented(
              [
                ["all", "Alle"],
                ["unanswered", "Neu"],
                ["wrong", "Falsch"],
                ["bookmarked", "Gespeichert"]
              ] as const,
              pool,
              setPool
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field htmlFor="builder-count" label="Anzahl">
            <Input
              id="builder-count"
              max={500}
              min={1}
              onChange={(event) => setSessionCount(Number(event.target.value))}
              type="number"
              value={sessionCount}
            />
          </Field>
          <Field htmlFor="builder-order" label="Reihenfolge">
            <Select
              id="builder-order"
              onChange={(event) => setSessionOrder(event.target.value as SessionOrder)}
              value={sessionOrder}
            >
              <option value="latest">Neueste Klausur</option>
              <option value="oldest">Älteste Klausur</option>
              <option value="subject">Nach Fach</option>
              <option value="random">Zufällig</option>
            </Select>
          </Field>
        </div>

        <div>
          <Button
            className="gap-3 px-6"
            disabled={!startCount}
            onClick={() => startSession()}
            variant="primary"
          >
            <Play size={18} aria-hidden="true" />
            <span>{startCount} starten</span>
          </Button>
        </div>
      </div>
    );
  }
}

function titleForView(view: View) {
  const titles: Record<View, string> = {
    dashboard: "Übersicht",
    subjects: "Klausuren",
    trainer: "Sitzungen",
    search: "Suche",
    mistakes: "Fehler",
    bookmarks: "Lesezeichen",
    admin: "Admin"
  };

  return titles[view];
}

function renderEmptyQuestion() {
  return (
    <div className="grid justify-items-start gap-2 border-y border-border py-8">
      <ClipboardList className="text-text-subtle" size={28} aria-hidden="true" />
      <h2 className="m-0 text-h3 font-semibold">Keine passenden Fragen</h2>
      <p className="m-0 text-body text-text-muted">
        Passe die Filter an oder starte eine breitere Sitzung.
      </p>
    </div>
  );
}
