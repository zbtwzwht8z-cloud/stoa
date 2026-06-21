import { BookOpen, LayoutDashboard, Plus } from "lucide-react";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  Input,
  List,
  ListRow,
  NavItem,
  Select,
  Stat
} from "@/components/ui";

export default function StyleguidePage() {
  return (
    <div className="min-h-screen bg-bg font-sans text-body font-normal text-text">
      <main className="mx-auto grid max-w-content gap-6 px-6 py-8">
        <header className="grid gap-2 border-b border-border pb-6">
          <h1 className="m-0 text-h1 font-semibold">Stoa design system</h1>
          <p className="m-0 max-w-[720px] text-body text-text-muted">
            Canonical tokens and components for the study application.
          </p>
        </header>

        <section className="grid gap-4" aria-labelledby="buttons-heading">
          <h2 className="m-0 text-h2 font-semibold" id="buttons-heading">
            Buttons
          </h2>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary">
              <Plus aria-hidden="true" size={16} strokeWidth={2} />
              Start session
            </Button>
            <Button variant="secondary">Review mistakes</Button>
            <Button variant="ghost">Cancel</Button>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="grid content-start gap-4">
            <h2 className="m-0 text-h2 font-semibold">Card</h2>
            <Card>
              <CardHeader>
                <CardTitle>Session settings</CardTitle>
                <CardDescription>
                  Choose the question count and review mode before starting.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button variant="secondary">Review mistakes</Button>
              </CardContent>
            </Card>
          </div>

          <div className="grid content-start gap-4">
            <h2 className="m-0 text-h2 font-semibold">Stats</h2>
            <dl className="m-0 grid grid-cols-2 gap-4">
              <Stat label="Average score" value="—" />
              <Stat label="Sessions completed" value="—" />
            </dl>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div className="grid content-start gap-4">
            <h2 className="m-0 text-h2 font-semibold">Navigation</h2>
            <nav className="grid gap-1" aria-label="Style guide navigation example">
              <NavItem
                active
                href="#navigation"
                icon={<LayoutDashboard size={16} strokeWidth={2} />}
                label="Dashboard"
              />
              <NavItem
                href="#questions"
                icon={<BookOpen size={16} strokeWidth={2} />}
                label="Questions"
              />
            </nav>
          </div>

          <div className="grid content-start gap-4">
            <h2 className="m-0 text-h2 font-semibold">List rows</h2>
            <List>
              <ListRow
                action="Not started"
                detail="Question details appear after import"
                meta={
                  <>
                    <span>Questions —</span>
                    <span>Latest score —</span>
                  </>
                }
                title="Question set"
              />
              <ListRow
                action="No result"
                detail="Session details appear after completion"
                title="Review session"
              />
            </List>
          </div>
        </section>

        <section className="grid gap-4" aria-labelledby="forms-heading">
          <h2 className="m-0 text-h2 font-semibold" id="forms-heading">
            Form controls
          </h2>
          <form className="grid max-w-[720px] grid-cols-1 gap-4 md:grid-cols-2">
            <Field htmlFor="question-search" label="Search questions">
              <Input id="question-search" placeholder="Enter a topic" />
            </Field>
            <Field htmlFor="question-status" label="Question status">
              <Select defaultValue="all" id="question-status">
                <option value="all">All questions</option>
                <option value="unanswered">Unanswered</option>
                <option value="incorrect">Incorrect</option>
              </Select>
            </Field>
            <Checkbox id="include-reviewed" label="Include reviewed questions" />
          </form>
        </section>

        <section className="grid gap-4" aria-labelledby="empty-heading">
          <h2 className="m-0 text-h2 font-semibold" id="empty-heading">
            Empty state
          </h2>
          <EmptyState
            action={<Button variant="ghost">Start one</Button>}
            message="No sessions yet."
          />
        </section>
      </main>
    </div>
  );
}
