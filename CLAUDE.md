# Stoa - Claude Handover

This file is the complete handover for the Stoa project. Read it before editing.
It intentionally contains no passwords, API keys, Redis tokens, or source-site
credentials. Do not add secrets to this file or commit them to Git.

## 1. Project Goal

Stoa is a private medical-school MCQ trainer for a small friend group. The
question bank is bundled locally and includes question comments/corrections as
post-answer notes. The app is deployed through GitHub and Vercel and uses
Upstash Redis for persistent progress and managed users.

The user wants a calm, dense study utility. They strongly dislike generic AI
SaaS styling, marketing copy inside the app, oversized cards, decorative glass,
and bulky navigation.

Primary requested work:

1. Admins can add, edit, disable, reset passwords for, and remove users.
2. Typography and spacing follow one strict design system.
3. Remove the Weak spots/Weak topics dashboard panel.
4. Replace Subjects and Trainer organization with semester-first papers,
   solved state, and latest score per paper.
5. Remove the synced/cache status pills from the app header.
6. Build intentional iPhone/mobile UX, not a stacked desktop layout.

## 2. Workspace And Deployment

- Local workspace: `/Users/bebo/Documents/DocsDocs`
- Git branch: `main`
- Git remote: `https://github.com/zbtwzwht8z-cloud/stoa.git`
- Vercel project: `stoa`
- Known production domain: `https://stoa-silk.vercel.app`
- Last pushed commit: `627217e Add Stoa design system and harden admin users`
- The Vercel project auto-deploys pushes to `main`.

The GitHub repository appeared public in the setup screenshots. The question
bank is stored in the repository, so make the repository private if the group
does not want the bank publicly downloadable.

## 3. Current Git State

The pushed commit contains:

- The initial complete trainer app.
- `DESIGN.md`.
- Tailwind and shadcn-style UI primitives.
- `/styleguide`.
- Hardened admin-user API behavior.
- Redis/Upstash environment aliases in the storage layer.

There is additional local work that is NOT committed or pushed. Do not discard
it. At handover time, `git status --short` is:

```text
 M src/app/layout.tsx
 M src/app/styleguide/page.tsx
 D src/app/styleguide/styleguide.css
 D src/app/styleguide/styleguide.module.css
 M src/components/TrainerApp.tsx
 M src/components/ui/patterns.tsx
 M src/lib/types.ts
 M tailwind.config.ts
?? src/app/design-system.css
?? src/components/PapersView.tsx
?? src/lib/papers.ts
?? CLAUDE_HANDOVER.md
```

The uncommitted work is the first real app-screen refactor: Subjects has become
Papers. It currently passes both:

```bash
npm run lint
npm run build
```

It was browser-tested at 1280px desktop and 390x844 iPhone dimensions with no
horizontal overflow. Semester switching works. Starting a paper starts every
question in that paper rather than applying the old 40-question limit. A test
with an SS 25 Allgemeinmedizin paper started all 38 questions.

## 4. Tech Stack

- Next.js 16.2.9, App Router
- React 18.3
- TypeScript
- Tailwind CSS 3.4 with preflight disabled
- shadcn-style local primitives, not the full shadcn CLI installation
- `class-variance-authority`, `clsx`, `tailwind-merge`
- Lucide React icons
- Vercel serverless deployment
- Upstash Redis through Vercel Marketplace

Commands:

```bash
npm install
npm run dev
npm run lint
npm run build
```

Local URL:

```text
http://localhost:3000
```

Styleguide:

```text
http://localhost:3000/styleguide
```

## 5. Important Files

```text
src/app/page.tsx                       Root app route
src/app/layout.tsx                     Metadata and global CSS imports
src/app/globals.css                    3,000+ lines of legacy app/landing CSS
src/app/design-system.css              New shared Tailwind directives/tokens
src/app/styleguide/page.tsx            Approved component styleguide
src/components/TrainerApp.tsx          Main 2,000+ line client app
src/components/StoaLanding.tsx         Existing marketing/login page
src/components/PapersView.tsx          New uncommitted Papers screen
src/components/ui/*                    Approved local UI primitives
src/lib/types.ts                       Question, progress, session, user types
src/lib/semesters.ts                   Semester parsing and sorting
src/lib/papers.ts                      New uncommitted paper grouping logic
src/lib/stats.ts                       Progress and leaderboard statistics
src/lib/server/auth.ts                 User config and signed sessions
src/lib/server/store.ts                Local JSON or Redis state persistence
src/app/api/admin/users/route.ts        Hardened admin user API
src/app/api/progress/route.ts           Per-user progress sync
src/app/api/questions/route.ts          Returns the full question bank
data/questions.json                    Bundled 18.8 MB question bank
scripts/export-docsdocs.mjs             Authorized source exporter
scripts/import-questions.mjs            CSV/JSON importer
public/sw.js                            Production service worker
public/manifest.webmanifest             PWA metadata
```

## 6. Question Data

The bundled file is approximately 18.8 MB and contains 14,774 questions across
43 subjects. The app also tracks roughly 11,660 preserved notes/comments and
184 image questions.

Core `Question` fields:

```ts
type Question = {
  id: string;
  subject: string;
  topic: string;
  source?: string;
  stem: string;
  imageUrl?: string;
  choices: { id: string; text: string }[];
  answer: string;
  explanation?: string;
  notes?: string[];
  tags?: string[];
  difficulty?: "easy" | "medium" | "hard";
};
```

`notes` is important. It contains source comments such as amended answers,
corrections, and clarifications. Preserve these and show them after an answer,
not before it.

Question source regeneration is available with:

```bash
DOCSDOCS_USER="..." DOCSDOCS_PASSWORD="..." npm run export:docsdocs
```

Do not hardcode source credentials. They were provided interactively but must
remain outside Git.

## 7. Authentication And Users

Vercel environment variables:

```text
APP_SECRET
TRAINER_USERS
```

`TRAINER_USERS` is a JSON array:

```json
[
  {
    "id": "admin-id",
    "name": "Admin Name",
    "password": "use-a-real-secret-outside-git",
    "role": "admin"
  },
  {
    "id": "member-id",
    "name": "Member Name",
    "password": "use-a-real-secret-outside-git",
    "role": "member"
  }
]
```

Roles are `admin` and `member`.

If no auth environment variables are present locally, the development fallback
is `admin / admin123`. This is development-only behavior.

Session behavior:

- Cookie name: `trainer_session`
- HMAC signed with `APP_SECRET`
- Session lifetime: 14 days
- Users can sign in by ID or display name, case-insensitive

There are two user sources:

1. Configured users from `TRAINER_USERS`.
2. Managed users stored in Redis state.

Configured users are intentionally immutable through the admin API. Managed
users can be created, renamed, password-reset, promoted/demoted, disabled, and
deleted.

The pushed admin route already validates:

- ID/name/password/role input
- Duplicate IDs and duplicate login names
- Minimum password length of 8
- Self-delete, self-disable, and self-demotion
- At least one enabled admin
- Configured users cannot be changed through the managed-user API

Important limitation: passwords are currently stored as plain strings in the
Vercel environment or Redis state. Proper password hashing requires coordinated
changes in `auth.ts`, the admin route, import/export, and migration behavior.

## 8. Redis Persistence

Upstash Redis is connected through the Vercel Marketplace. The project has at
least these generated variables:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
KV_URL
KV_REDIS_URL
KV_REST_API_READ_ONLY_TOKEN
```

The app uses:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

It also accepts:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

Never expose their values.

The single Redis key is:

```text
private-mcq-trainer-state-v1
```

Stored state:

```ts
type TrainerState = {
  progress: Record<string, StoredProgress>;
  reports: QuestionReport[];
  users: ManagedTrainerUser[];
};
```

Local fallback storage is:

```text
.local-data/trainer-state.json
```

Known limitation: `updateState` is read-modify-write. The admin route serializes
mutations only inside one serverless instance. True cross-instance atomicity
would require Redis transactions or separate Redis keys.

## 9. Hard Design Rules

These rules were supplied by the user and are not optional.

### Product direction

- This is a study utility, not a marketing product inside authenticated views.
- Optimize for calm, density, legibility, and obvious navigation.
- Prefer plain UI over impressive UI.
- No fake data presented as real data.

### Typography

- One family only: Inter or system UI.
- Allowed sizes only: 12, 13, 14, 16, 18, 22, 26 px.
- Nothing over 28 px on app screens.
- Weights only: 400, 500, 600.
- Body line-height 1.5; heading line-height 1.25.
- Letter spacing is 0.

### Spacing and shape

- Spacing uses only 4, 8, 12, 16, 24, 32, 48 px.
- Page padding 24-32 px.
- Section gap 24 px.
- Cards use 16 or 20 px padding.
- Cards, inputs, and buttons use 8 px radius.
- Pills are only for tags and avatars.

### Semantic colors

Use only these tokens:

```text
bg
surface
surface-muted
border
text
text-muted
text-subtle
accent
accent-foreground
danger
```

Accent green is only for primary actions and the active nav item. Do not use it
as decoration. No gold labels.

### Surfaces

- Flat background, no gradients.
- Cards use one border and no shadow.
- Exactly one shadow token, only for floating menus/popovers.
- Do not wrap every section in a card.
- List rows use hairline dividers, not one card per row.

### Canonical components

- One Button component, variants primary/secondary/ghost, height 36-40 px.
- One Card component.
- One Stat pattern: 13 px muted label plus 22 px/600 value.
- One Nav item pattern.
- One divided List row pattern.
- Add any new pattern to `/styleguide` before using it in a screen.

### Copy

- Plain sentence case.
- No marketing, motivational copy, aphorisms, or exclamation marks.
- `Command Center` becomes `Dashboard`.
- Drop `Private Study Hall`.
- `Choose one clean path.` becomes `Start a session`.
- `Build custom session` becomes `Custom session`.
- `Review latest mistakes` becomes `Review mistakes`.
- Remove repeated colored/all-caps eyebrows.

### Build process

- Theme/styleguide was built and approved.
- Build one screen at a time and pause for review.
- Reuse the approved primitives and semantic tokens.
- Do not add ad hoc colors, spacing, type sizes, radii, or shadows.

## 10. Approved Styleguide Work

The user approved `/styleguide` as much better than the old app.

Pushed files:

```text
DESIGN.md
tailwind.config.ts
postcss.config.mjs
src/components/ui/button.tsx
src/components/ui/card.tsx
src/components/ui/input.tsx
src/components/ui/select.tsx
src/components/ui/patterns.tsx
src/components/ui/utils.ts
src/components/ui/index.ts
src/app/styleguide/page.tsx
```

The uncommitted work moves the Tailwind directives and color variables into:

```text
src/app/design-system.css
```

`layout.tsx` imports it after legacy `globals.css` so approved Tailwind utilities
can override old global element styles. The old styleguide-only CSS files are
deleted locally because their declarations were promoted to the shared layer.

## 11. Current Uncommitted Papers Screen

Internal view ID remains `subjects` to reduce risk, but its visible label and
title are now `Papers`.

New behavior:

- Semesters are sorted newest first.
- Desktop uses a semester navigation rail with paper counts.
- Mobile uses a semester select.
- Each paper row shows subject, source variant when meaningful, question count,
  Not started / x of y / Solved, latest completed score, and a Play action.
- No score displays as an em dash, never fake `0%`.
- Study/Exam mode is selected above the list.
- Starting a paper passes every paper question ID to `startSessionFromIds`.
- New session metadata stores `source.paperKey`.
- Legacy sessions match a paper when all session question IDs belong to it.
- Latest score uses the newest completed matching session.
- The session updater now counts only answers whose timestamp is at or after
  the session start, avoiding contamination from historical answers.

Relevant files:

```text
src/lib/papers.ts
src/components/PapersView.tsx
src/lib/types.ts
src/components/TrainerApp.tsx
```

The clean shell is currently conditional to the Papers view. Other screens keep
the legacy shell until their own review pass. The Papers view was left open at
`http://localhost:3000` for review.

Potential paper-model caveats to inspect:

- Paper key is semester + normalized subject + normalized source.
- Missing source falls back to subject/topic.
- Source labels strip semester text and subject prefixes heuristically.
- A few source naming edge cases may still need cleanup based on real data.
- Computing all paper summaries after every progress change scans the full bank;
  index/caching work may be needed for slower phones.

## 12. What Is Still Missing

### Admin UI

The backend is hardened, but the visible admin user-management interface does
not exist yet. `TrainerApp.tsx` already contains unused state such as:

```text
newUserName
newUserPassword
newUserRole
editingPasswords
```

Implement visible controls in the Admin screen using:

```text
GET    /api/admin/users
POST   /api/admin/users
PATCH  /api/admin/users
DELETE /api/admin/users?id=...
```

Requirements:

- Add managed member/admin.
- Rename managed user.
- Reset managed password.
- Change role safely.
- Disable/re-enable managed user.
- Remove managed user with confirmation.
- Clearly mark configured environment users as locked/read-only.
- Never display stored passwords.
- Use divided rows, not user cards.

### Dashboard

Still legacy. Required changes:

- Remove Weak spots entirely.
- Remove synced/cache status pills.
- Rename legacy copy according to design rules.
- Do not render fake zero leaderboard data as meaningful proof.
- Reduce repeated padded cards.

Safe removal details:

- Weak panel is inside `renderDashboard`.
- `syncStatus` is display-only; removing the pill does not remove persistence.
- `online` is display-only.
- `offlineReady` reports service-worker registration only.
- Keep localStorage persistence, progress POST sync, and server progress loading.

### Trainer

Still legacy and is the next logical screen after Papers.

Recommended two-state design:

1. No active session: custom session builder only.
2. Active session: focused question view only.

Do not keep builder, question, and 120-row queue visible in three columns.

Focused trainer requirements:

- Back control, paper name, `3 of 30`, queue icon, finish/end action.
- Queue opens in a drawer/sheet.
- Report form stays collapsed until Report is selected.
- Show subject/semester/source once, not repeatedly.
- Sticky mobile previous/progress/next toolbar above safe area.
- Move focus/scroll to the next question stem after navigation.
- Preserve post-answer notes/corrections.
- Validate zero-question sessions and disable invalid Start actions.

### Sessions

Session-history JSX exists, but its main classes are effectively unstyled.
Checkboxes are also affected by the old global input width rule. Build divided
rows, labeled metadata, mistake selection, and review-selected-mistakes action.

### Mobile Navigation

The Papers view has a temporary clean mobile drawer trigger. Other screens still
use the old incomplete off-canvas rail. Final mobile navigation should include:

- Bottom navigation for main destinations or another intentionally mobile
  pattern.
- Accessible More sheet for secondary screens/admin/logout.
- Backdrop, close action, Escape handling, focus containment, and scroll lock.
- `viewport-fit=cover`, safe-area insets, and `100dvh` sizing.
- Minimum 16 px input text on iPhone to prevent zoom.

### Landing/Login

The current unauthenticated landing page contradicts the approved rules: giant
hero type, gradients, glass effects, fake product metrics, and animations. It
should eventually become a compact login-first utility page, but do not mix that
work into another screen's review.

## 13. Performance Risks

The largest known mobile performance problem is data volume:

- `/api/questions` returns the full 18.8 MB bank after login.
- 14,774 questions are filtered and summarized in the client.
- Progress changes can recompute global stats and paper summaries.
- Progress is serialized to localStorage synchronously.
- A second full serialization is scheduled for server upload.
- The leaderboard is refreshed after answer changes.
- Legacy landing CSS includes expensive gradients, noise, blur, large shadows,
  and infinite animations.

Recommended later work:

- Build question indexes once.
- Split/paginate the question payload or send lightweight metadata first.
- Defer or debounce broad search.
- Avoid recomputing unrelated stats on every answer.
- Move persistence off the immediate interaction path.
- Remove legacy ambient animation/effects as each screen is rebuilt.

## 14. Verification Notes

Current uncommitted code passes:

```bash
npm run lint
npm run build
```

Browser checks completed:

- Desktop Papers layout at 1280 px.
- iPhone Papers layout at 390x844.
- No horizontal overflow.
- Semester select changes the visible paper set.
- Play starts the full selected paper.
- Desktop and mobile navigation controls are reachable.

A stale Next.js development-server error referenced the deleted old styleguide
CSS files until the dev server was restarted. The current production build is
clean; this was a stale webpack cache/log issue, not a build failure.

## 15. Recommended Immediate Sequence

1. Run `git status` and inspect all uncommitted Papers changes. Do not reset or
   discard them.
2. Run `npm run lint` and `npm run build` again after any edits.
3. Review Papers locally. Fix only real paper-label/data edge cases.
4. Commit and push Papers only when it is accepted.
5. Build the focused Trainer screen using the approved primitives.
6. Build Admin user management.
7. Rebuild Dashboard and remove Weak spots plus sync/cache pills.
8. Rebuild Sessions/mistake-review flow.
9. Finish shared iPhone navigation and safe-area behavior.
10. Replace the legacy landing/login page last.

## 16. Collaboration Notes

- The user wants direct execution, not abstract proposals.
- Keep explanations short and non-technical unless exact deployment steps are
  needed.
- Do not expose or repeat credentials.
- Do not rewrite unrelated code or discard the current dirty worktree.
- Verify each screen on desktop and iPhone before presenting it.
- Respect the one-screen-at-a-time review process from the approved design rules.
