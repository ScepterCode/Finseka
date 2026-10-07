import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Wallet,
  Users,
  CalendarCheck,
  HeartHandshake,
  BookOpen,
  ShieldCheck,
  Check,
  X,
  ArrowRight,
  MessageCircle,
  Smartphone,
  Headphones,
  CloudCheck,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { SUPPORT_WHATSAPP_DISPLAY, supportLink } from "@/lib/support";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

import heroImg from "@/assets/hero-finsec.jpg";
import painImg from "@/assets/pain-paper-chaos.jpg";
import meetingImg from "@/assets/meeting-transparency.jpg";
import phoneImg from "@/assets/phone-in-hand.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FinSeka — The digital record book for association money" },
      {
        name: "description",
        content:
          "Record dues, contributions and expenses in seconds. FinSeka is the record book for churches, clubs, associations and town unions that writes itself, balances itself and never fades. 30 days free, no card needed.",
      },
      { property: "og:title", content: "FinSeka — The digital record book for association money" },
      {
        property: "og:description",
        content:
          "Your digital record book that writes itself, balances itself, and never fades. Built for Nigerian associations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <Nav />
      <main>
        <Hero />
        <Pain />
        <Relief />
        <Chairman />
        <Features />
        <Transparency />
        <HowItWorks />
        <RealPeople />
        <Pricing />
        <FinalCta />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}

function Logo() {
  return (
    <a href="#top" className="flex items-center gap-2.5">
      <BrandMark />
      <span className="font-display text-xl font-semibold tracking-tight">FinSeka</span>
    </a>
  );
}

function Nav() {
  return (
    <header
      id="top"
      className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md"
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#problem" className="transition-colors hover:text-foreground">
            The problem
          </a>
          <a href="#features" className="transition-colors hover:text-foreground">
            What you get
          </a>
          <a href="#how" className="transition-colors hover:text-foreground">
            How it works
          </a>
          <a href="#pricing" className="transition-colors hover:text-foreground">
            Pricing
          </a>
          <a href="#faq" className="transition-colors hover:text-foreground">
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            to="/auth"
            className="text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Sign in
          </Link>
          <Link
            to="/auth"
            className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-transform hover:scale-[1.02]"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="pointer-events-none absolute -top-32 -right-24 size-96 rounded-full bg-primary-soft blur-3xl" />
      <div className="pointer-events-none absolute top-40 -left-32 size-80 rounded-full bg-accent-soft blur-3xl" />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-5 py-14 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-24">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 text-xs font-semibold text-primary shadow-soft">
            <span className="size-1.5 rounded-full bg-success" />
            For churches, clubs, associations & town unions
          </span>
          <h1 className="mt-5 font-display text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
            Your digital record book that writes itself, balances itself, and never fades.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Record dues, contributions, and expenses in seconds. Income minus expense calculates on
            its own. Open the app any time — the balance is already there. No exercise book. No
            WhatsApp screenshots. No “I’ll bring the book next meeting.”
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/auth"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-4 text-base font-semibold text-primary-foreground shadow-lift transition-transform hover:scale-[1.02]"
            >
              Start your free 30 days — no card needed <ArrowRight className="size-4" aria-hidden />
            </Link>
            <a
              href="#how"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-7 py-4 text-base font-semibold text-foreground shadow-soft transition-colors hover:bg-secondary"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 max-w-xl text-sm text-muted-foreground">
            Works on any Android or iPhone. Add it to your home screen straight from your browser
            and use it like a normal app. Built for people who’ve never used accounting software.
            24/7 helpline if you ever get stuck.
          </p>
        </div>

        <div className="relative">
          <img
            src={heroImg}
            alt="A Nigerian financial secretary recording member dues on his phone in a church hall"
            width={1408}
            height={1056}
            className="w-full rounded-3xl object-cover shadow-lift"
          />
          <div className="absolute -bottom-6 left-4 w-[15rem] rounded-2xl border border-border bg-card p-4 shadow-lift sm:left-auto sm:-right-6">
            <p className="text-xs font-medium text-muted-foreground">Balance in hand</p>
            <p className="mt-1 font-display text-2xl font-semibold text-primary">₦120,000</p>
            <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-success">
              <Check className="size-3.5" aria-hidden /> 40 members paid March dues
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const painPoints = [
  "Receipts scattered across three exercise books, biro ink fading small small.",
  "Somebody swears he paid February. Nobody can prove otherwise. You take the blame.",
  "Month-end reconciliation keeps you awake till 2 a.m., calculator in one hand, phone torch in the other.",
  "Contribution for the school building project closes and you still don’t know who paid and who didn’t.",
  "Records live in a WhatsApp chat on somebody’s phone. Or a file nobody can open again.",
  "New secretary takes over and the old records simply… vanish. You start from zero. Or worse, from suspicion.",
];

function Pain() {
  return (
    <section id="problem" className="border-y border-border bg-secondary/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
        <img
          src={painImg}
          alt="A stressed association secretary at night trying to reconcile paper receipts and a handwritten ledger"
          width={1200}
          height={912}
          loading="lazy"
          className="w-full rounded-3xl object-cover shadow-lift"
        />
        <div>
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            The midnight wahala
          </p>
          <h2 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
            Being Financial Secretary shouldn’t cost you your sleep, your reputation, or your peace
            of mind.
          </h2>
          <p className="mt-4 text-muted-foreground">
            You collect the money. You keep the record. And the moment one figure doesn’t match,
            your name is the one on everybody’s mouth.
          </p>
          <ul className="mt-7 space-y-3.5">
            {painPoints.map((point) => (
              <li key={point} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-destructive/10 text-destructive">
                  <X className="size-3.5" aria-hidden />
                </span>
                <span className="text-[0.975rem] leading-relaxed text-foreground/85">{point}</span>
              </li>
            ))}
          </ul>
          <p className="mt-7 text-muted-foreground">
            And if you’re the President or Chairman? You can’t even tell the house how much is in
            the account without calling the FinSec, waiting three days, and sitting down to pore
            over books. You’re leading blind.
          </p>
        </div>
      </div>
    </section>
  );
}

const relief = [
  {
    title: "No more reconciliation",
    body: "Every due, every contribution, every expense enters the ledger the moment it happens. Income minus expense calculates itself. You open the app; the balance is already there. Always.",
  },
  {
    title: "Pure transparency",
    body: "Any member with viewer access sees the same figures you see. No hidden corner. No “trust me, I’ll show you later.” The record speaks before anybody opens their mouth.",
  },
  {
    title: "One-minute handover",
    body: "Every entry carries who, what, how much, when. New secretary logs in and the full history is there. No missing pages. No “the old book is at my village.”",
  },
];

function Relief() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">The relief</p>
        <h2 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
          FinSeka is your digital recordkeeper that never sleeps, never loses a page, and never lets
          anybody point accusing fingers at you.
        </h2>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {relief.map((item) => (
          <div
            key={item.title}
            className="rounded-3xl border border-border bg-card p-7 shadow-soft"
          >
            <span className="grid size-10 place-items-center rounded-full bg-success-soft text-success">
              <Check className="size-5" aria-hidden />
            </span>
            <h3 className="mt-5 text-lg font-semibold">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

const chairmanSees = [
  "See the balance.",
  "See who’s owing.",
  "See which event brought the most money.",
  "See the three members who haven’t paid since March.",
];

function Chairman() {
  return (
    <section className="border-y border-border bg-secondary/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:py-24">
        <div>
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            For the Chairman’s seat
          </p>
          <h2 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
            Know your association’s true financial state in ten seconds. No phone call. No meeting.
          </h2>
          <p className="mt-4 text-muted-foreground">
            You don’t need to sit with the FinSec and reconcile. The system does it in perpetuity.
            You walk into every meeting already knowing the numbers, so you can make decisions — not
            just ask questions.
          </p>
          <p className="mt-4 font-medium">
            Spot the patterns. Reward the consistent. Follow up the defaulters before the AGM, not
            during it.
          </p>
        </div>
        <div className="rounded-3xl border border-border bg-card p-7 shadow-soft">
          <p className="font-display text-lg font-semibold">Open FinSeka.</p>
          <ul className="mt-5 space-y-3.5">
            {chairmanSees.map((line) => (
              <li key={line} className="flex items-start gap-3">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                  <Check className="size-3.5" aria-hidden />
                </span>
                <span className="leading-relaxed">{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

const features = [
  {
    icon: Wallet,
    title: "Dashboard",
    body: "Balance in hand. Total being owed. Dues health. Recent activity. The first thing you see when you open the app. No digging.",
  },
  {
    icon: Users,
    title: "Members",
    body: "Name, phone, branch. Tap any member to see everything they’ve paid and everything they owe. One screen. Full history.",
  },
  {
    icon: CalendarCheck,
    title: "Dues",
    body: "Monthly dues, development levy, weekly contribution — whatever your association agreed. Two clear lists: Paid and Not Paid. No ambiguity.",
  },
  {
    icon: HeartHandshake,
    title: "Contributions",
    body: "For the things that come up: a child dedication, a hospital project, a new generator. Pick members, set a target, track who’s paid and who’s yet to.",
  },
  {
    icon: BookOpen,
    title: "Ledger",
    body: "Money in. Money out. Running balance. Sort by 7 days, 2 weeks, 1 month, or your own dates. The book balances itself.",
  },
  {
    icon: ShieldCheck,
    title: "Settings & Admin",
    body: "Create accounts for President, Treasurer, and committee members. Admin edits. Viewer only looks. You control who sees what.",
  },
];

function Features() {
  return (
    <section id="features" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">What you get</p>
        <h2 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
          Six simple screens. Nothing extra to confuse anybody.
        </h2>
      </div>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, body }) => (
          <div key={title} className="rounded-3xl border border-border bg-card p-7 shadow-soft">
            <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary">
              <Icon className="size-5" aria-hidden />
            </span>
            <h3 className="mt-5 text-lg font-semibold">{title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Transparency() {
  return (
    <section className="border-y border-border bg-secondary/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 lg:grid-cols-2 lg:items-center lg:py-24">
        <div className="order-2 lg:order-1">
          <p className="text-sm font-semibold tracking-widest text-accent uppercase">Meeting day</p>
          <h2 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
            Read your report with your chest.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Open FinSeka in front of the house. Project it. Show what entered. Show what left. Show
            who’s owing. Show what’s remaining for the building fund.
          </p>
          <p className="mt-4 text-muted-foreground">
            Questions and answers finish in five minutes. No shouting. No “bring the book.” No
            “let’s reconvene next week to verify.”
          </p>
          <p className="mt-4 font-medium">
            You close the meeting. People clap. Your name stays clean.
          </p>
          <dl className="mt-8 grid grid-cols-2 gap-4">
            {[
              { k: "In hand", v: "₦120,000", tone: "text-primary" },
              { k: "Being owed", v: "₦45,000", tone: "text-destructive" },
              { k: "Paid this month", v: "40 of 52", tone: "text-success" },
              { k: "Building fund", v: "45 / 60 paid", tone: "text-accent" },
            ].map((stat) => (
              <div
                key={stat.k}
                className="rounded-2xl border border-border bg-card px-5 py-4 shadow-soft"
              >
                <dt className="text-xs font-medium text-muted-foreground">{stat.k}</dt>
                <dd className={`mt-1 font-display text-xl font-semibold ${stat.tone}`}>{stat.v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="order-1 grid gap-4 lg:order-2">
          <img
            src={meetingImg}
            alt="A town union meeting where the financial secretary presents figures from a tablet"
            width={1408}
            height={912}
            loading="lazy"
            className="w-full rounded-3xl object-cover shadow-lift"
          />
          <img
            src={phoneImg}
            alt="Close-up of the FinSeka dashboard on a phone showing paid dues after church service"
            width={1200}
            height={1200}
            loading="lazy"
            className="hidden h-56 w-full rounded-3xl object-cover object-center shadow-lift sm:block"
          />
        </div>
      </div>
    </section>
  );
}

const steps = [
  {
    n: "1",
    t: "Add your members",
    b: "Name, phone, branch. One default group is already waiting for you. Type them in or add them one by one as they come.",
  },
  {
    n: "2",
    t: "Set your dues",
    b: "Monthly, weekly, yearly, per-project. Whatever your constitution says. FinSeka follows your rules, not the other way round.",
  },
  {
    n: "3",
    t: "Mark payments",
    b: "Money enters? Tap the name. Half payment? Write the amount. Add a note. Done. Two seconds.",
  },
  {
    n: "4",
    t: "Watch the balance keep itself",
    b: "Add expenses as they happen. The ledger subtracts, balances, and files everything automatically. You just… live your life.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
      <p className="text-sm font-semibold tracking-widest text-primary uppercase">How it works</p>
      <h2 className="mt-3 max-w-2xl font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
        Four steps. Ten minutes. Your association is sorted.
      </h2>
      <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s) => (
          <li key={s.n} className="rounded-3xl border border-border bg-card p-7 shadow-soft">
            <span className="grid size-10 place-items-center rounded-full bg-wine-gradient font-display text-base font-semibold text-primary-foreground">
              {s.n}
            </span>
            <h3 className="mt-5 text-lg font-semibold">{s.t}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.b}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

const realPeople = [
  {
    icon: Smartphone,
    title: "It’s an app on your phone.",
    body: "Open FinSeka in your phone’s browser and add it to your home screen. It sits there like WhatsApp or your banking app. No laptop required. No internet café.",
  },
  {
    icon: Headphones,
    title: "24/7 helpline.",
    body: "Stuck at 11 p.m.? Confused on a Sunday morning? Message us on WhatsApp. Talk to a real human. We pick up. Every time.",
    link: { href: supportLink(), label: `WhatsApp ${SUPPORT_WHATSAPP_DISPLAY}` },
  },
  {
    icon: CloudCheck,
    title: "Your records can’t be torn, flooded, eaten by rats, or “misplaced.”",
    body: "They live safe in the cloud. Backed up, with every change recorded. Even if your phone falls into a gutter, your records are still there when you log in from another device.",
  },
];

function RealPeople() {
  return (
    <section className="border-y border-border bg-secondary/60">
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-widest text-accent uppercase">
            Built for real people
          </p>
          <h2 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
            You don’t need to be “tech-savvy.” You just need to know how to tap a screen.
          </h2>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {realPeople.map(({ icon: Icon, title, body, link }) => (
            <div key={title} className="rounded-3xl border border-border bg-card p-7 shadow-soft">
              <span className="grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary">
                <Icon className="size-5" aria-hidden />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              {link && (
                <a
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-soft transition-transform hover:scale-[1.02]"
                >
                  <MessageCircle className="size-4" aria-hidden /> {link.label}
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// Prices must match what the app charges: pro_monthly_price() (launch, locked for a first year of
// Pro) and pro_standard_price() in the database, 1 to 12 months at once.
const freeIncludes = [
  "All six screens",
  "Unlimited members & entries",
  "Viewer access for your executives",
  "24/7 helpline",
];
const proIncludes = [
  "Everything stays unlocked: record, download and print",
  "Unlimited history — your records never expire",
  "Reports by date range, ready to print or download for the AGM",
  "As many admin and viewer accounts as you need",
  "Pay by bank transfer or card",
];

function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">Pricing</p>
        <h2 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
          Start free. Pay small when you’re ready. No hidden charges.
        </h2>
        <p className="mt-4 text-muted-foreground">
          No card needed to start. No surprises. Nothing renews by itself.
        </p>
      </div>
      <div className="mt-10 grid gap-5 lg:grid-cols-2">
        <div className="flex flex-col rounded-3xl border border-border bg-card p-7 shadow-soft">
          <h3 className="font-display text-xl font-semibold">FinSeka Free</h3>
          <p className="mt-3">
            <span className="font-display text-4xl font-semibold">₦0</span>{" "}
            <span className="text-muted-foreground">for 30 days</span>
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            Everything in FinSeka Pro. Full access. No card. No commitment.
          </p>
          <PlanList items={freeIncludes} />
          <div className="mt-auto pt-8">
            <Link
              to="/auth"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border bg-card px-7 py-3.5 text-base font-semibold shadow-soft transition-colors hover:bg-secondary"
            >
              Start my free 30 days
            </Link>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              After 30 days, go Pro to keep recording. Your data stays either way.
            </p>
          </div>
        </div>

        <div className="flex flex-col rounded-3xl border-2 border-primary bg-card p-7 shadow-lift">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-display text-xl font-semibold">FinSeka Pro</h3>
            <span className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
              One plan for everybody
            </span>
          </div>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
            <s className="font-display text-2xl text-muted-foreground" aria-label="was ₦7,000">
              ₦7,000
            </s>
            <span className="font-display text-4xl font-semibold">₦5,000</span>
            <span className="text-muted-foreground">/ month</span>
          </p>
          <p className="mt-2 text-sm font-semibold text-primary">
            Launch price — save ₦2,000 every month.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Lock in ₦5,000 a month for your first 12 months of Pro. After that, the standard price
            (₦7,000) applies. That’s ₦24,000 saved in your first year.
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            For your whole association — every member, every admin. Pay for 1 month or up to a year
            at once: <s>₦84,000</s> ₦60,000 for 12 months.
          </p>
          <PlanList items={proIncludes} />
          <div className="mt-auto pt-8">
            <Link
              to="/auth"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary px-7 py-3.5 text-base font-semibold text-primary-foreground shadow-lift transition-transform hover:scale-[1.02]"
            >
              Start free, then go Pro <ArrowRight className="size-4" aria-hidden />
            </Link>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              Paying during your trial doesn’t shorten it: Pro starts when the free 30 days end.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PlanList({ items }: { items: string[] }) {
  return (
    <ul className="mt-6 space-y-3">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-3 text-sm">
          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function FinalCta() {
  return (
    <section id="start" className="mx-auto max-w-6xl px-5 pb-16 lg:pb-24">
      <div className="relative overflow-hidden rounded-4xl bg-wine-gradient px-7 py-14 text-center shadow-lift sm:px-14">
        <div className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-primary-foreground/10 blur-2xl" />
        <h2 className="relative font-display text-3xl leading-tight font-semibold tracking-tight text-balance text-primary-foreground sm:text-4xl">
          Stop reconciling at midnight. Start showing clear records that make your name respected.
        </h2>
        <p className="relative mx-auto mt-4 max-w-2xl text-primary-foreground/80">
          Set up your association in ten minutes. Let FinSeka keep the books while you keep the
          trust of your people. Thirty days. Completely free. No card. No commitment. Just clarity.
        </p>
        <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/auth"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-card px-8 py-4 text-base font-semibold text-primary shadow-lift transition-transform hover:scale-[1.02]"
          >
            Start my free 30 days now <ArrowRight className="size-4" aria-hidden />
          </Link>
          <a
            href={supportLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-primary-foreground/30 px-8 py-4 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10"
          >
            <MessageCircle className="size-4" aria-hidden /> Talk to a real human on WhatsApp
          </a>
        </div>
        <p className="relative mt-6 text-sm text-primary-foreground/70">
          Works on any phone · Add it to your home screen like a normal app · 24/7 helpline · No
          card needed
        </p>
      </div>
    </section>
  );
}

const faqs = [
  { q: "Do I need a card to start?", a: "No. Zero. You sign up and start." },
  {
    q: "What if I’m not good with phones?",
    a: `FinSeka was built for you. Big buttons. Clear labels. And if you get stuck, message our 24/7 helpline on WhatsApp (${SUPPORT_WHATSAPP_DISPLAY}). A real person picks up.`,
  },
  {
    q: "Can my members see the records?",
    a: "You decide. Give them “viewer” access — they see the numbers but can’t change anything.",
  },
  {
    q: "What happens to my data if I don’t pay after 30 days?",
    a: "Your data stays safe and you can still see all of it. You just can’t add new entries, download or print until you go Pro. Nothing is deleted.",
  },
  {
    q: "Is this only for alumni groups?",
    a: "No. Any association, union, club, cooperative, church committee, or group that collects money from members. If people pay dues, FinSeka fits.",
  },
  {
    q: "Can I use it on my phone?",
    a: "Yes. Open FinSeka in your phone’s browser and add it to your home screen, and it works like a normal app. No laptop needed.",
  },
];

function Faq() {
  return (
    <section id="faq" className="border-t border-border bg-secondary/60">
      <div className="mx-auto max-w-3xl px-5 py-16 lg:py-24">
        <p className="text-sm font-semibold tracking-widest text-primary uppercase">FAQ</p>
        <h2 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
          Questions people ask us
        </h2>
        <Accordion type="single" collapsible className="mt-8">
          {faqs.map((f) => (
            <AccordionItem key={f.q} value={f.q}>
              <AccordionTrigger className="text-left text-base">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">{f.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Logo />
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            The digital record book for association money. Built for Nigerian churches, clubs,
            associations and town unions.
          </p>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground sm:text-right">
          <a
            href={supportLink()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 font-semibold text-foreground hover:text-primary"
          >
            <MessageCircle className="size-4" aria-hidden /> Customer care on WhatsApp:{" "}
            {SUPPORT_WHATSAPP_DISPLAY}
          </a>
          <p>© {new Date().getFullYear()} FinSeka. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
