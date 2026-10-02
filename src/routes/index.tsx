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
  PhoneCall,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

import heroImg from "@/assets/hero-finsec.jpg";
import painImg from "@/assets/pain-paper-chaos.jpg";
import meetingImg from "@/assets/meeting-transparency.jpg";
import phoneImg from "@/assets/phone-in-hand.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FinSeka — Association dues, contributions & ledger made simple" },
      {
        name: "description",
        content:
          "No more reconciliation wahala. FinSeka helps financial secretaries of churches, clubs and town unions track dues, contributions and expenses with full transparency.",
      },
      { property: "og:title", content: "FinSeka — Keep your association money simple and clear" },
      {
        property: "og:description",
        content:
          "Track who paid, who is owing, and every naira that entered or left the purse. Built for Nigerian associations.",
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
        <Features />
        <Transparency />
        <HowItWorks />
        <FinalCta />
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
            Keep your association money simple and clear
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
            Dues, contributions, expenses, balance in hand — all in one place. No Excel wahala, no
            arguing at meetings, no reconciling accounts at midnight.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              to="/auth"
              className="inline-flex items-center justify-center gap-2 rounded-full bg-primary px-7 py-4 text-base font-semibold text-primary-foreground shadow-lift transition-transform hover:scale-[1.02]"
            >
              Start free <ArrowRight className="size-4" aria-hidden />
            </Link>
            <a
              href="#features"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-7 py-4 text-base font-semibold text-foreground shadow-soft transition-colors hover:bg-secondary"
            >
              See how it works
            </a>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Works on any phone. Simple words only — Paid, Not Paid, Owing, In Hand.
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
  "Receipts scattered inside exercise book, biro fading small small.",
  "Somebody swears he paid February — nobody can prove otherwise.",
  "Month end reconciliation that keeps you awake till 2am.",
  "Contribution for the school building project closes and you still don't know who paid.",
  "New secretary takes over and the old records simply vanish.",
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
            Being financial secretary shouldn't cost you your peace
          </h2>
          <p className="mt-4 text-muted-foreground">
            You collect the money, you keep the record, and when one figure doesn't match, your name
            is the one on everybody's mouth.
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
        </div>
      </div>
    </section>
  );
}

const relief = [
  {
    title: "No more reconciliation",
    body: "Every due and contribution payment enters the ledger by itself, labelled properly. Income minus expense calculates on its own.",
  },
  {
    title: "Pure transparency",
    body: "Anybody with viewer access sees the same figures you see. No hidden corner, no 'trust me'.",
  },
  {
    title: "Full accountability",
    body: "Every entry carries who, what, how much and when. Handover to the next secretary takes one minute.",
  },
];

function Relief() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
      <div className="max-w-2xl">
        <p className="text-sm font-semibold tracking-widest text-accent uppercase">The relief</p>
        <h2 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
          FinSeka carries the record-keeping for you
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

const features = [
  {
    icon: Wallet,
    title: "Dashboard",
    body: "Balance in hand, total being owed, dues health and recent activity — the first thing you see.",
  },
  {
    icon: Users,
    title: "Members",
    body: "Name, phone, branch. Tap a member to see everything they have paid and everything they owe.",
  },
  {
    icon: CalendarCheck,
    title: "Dues",
    body: "Monthly dues, development levy, daily contribution. Two clear lists: Paid and Not Paid.",
  },
  {
    icon: HeartHandshake,
    title: "Contributions",
    body: "For things that come up — a child dedication, a hospital project, a new projector. Pick members, set target, track who paid.",
  },
  {
    icon: BookOpen,
    title: "Ledger",
    body: "Money in, money out, balance. Sort by 7 days, 2 weeks, 1 month or your own dates.",
  },
  {
    icon: ShieldCheck,
    title: "Settings & Admin",
    body: "Accounts for President, Treasurer and others. Admin edits, viewer only looks.",
  },
];

function Features() {
  return (
    <section id="features" className="border-y border-border bg-secondary/60">
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold tracking-widest text-primary uppercase">
            What you get
          </p>
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
      </div>
    </section>
  );
}

function Transparency() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
      <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
        <div className="order-2 lg:order-1">
          <p className="text-sm font-semibold tracking-widest text-accent uppercase">Meeting day</p>
          <h2 className="mt-3 font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
            Read your report with your chest
          </h2>
          <p className="mt-4 text-muted-foreground">
            Open FinSeka in front of the house. Show what entered, what left, who is owing and what
            is remaining. Question and answer finishes in five minutes.
          </p>
          <dl className="mt-8 grid grid-cols-2 gap-4">
            {[
              { k: "In hand", v: "₦120,000", tone: "text-primary" },
              { k: "Being owed", v: "₦45,000", tone: "text-destructive" },
              { k: "Paid this month", v: "40 members", tone: "text-success" },
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
    b: "Name, phone, branch. One default group is already waiting.",
  },
  { n: "2", t: "Set your dues", b: "Monthly, weekly, yearly — whatever your association agreed." },
  { n: "3", t: "Mark payments", b: "Tap a name as money enters. Half payment and notes allowed." },
  { n: "4", t: "Show the balance", b: "Add expenses, and the ledger balances itself. That's all." },
];

function HowItWorks() {
  return (
    <section id="how" className="border-y border-border bg-secondary/60">
      <div className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
        <h2 className="max-w-2xl font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
          Four steps and your association is sorted
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
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section id="start" className="mx-auto max-w-6xl px-5 py-16 lg:py-24">
      <div className="relative overflow-hidden rounded-4xl bg-wine-gradient px-7 py-14 text-center shadow-lift sm:px-14">
        <div className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-primary-foreground/10 blur-2xl" />
        <h2 className="relative font-display text-3xl leading-tight font-semibold tracking-tight text-balance text-primary-foreground sm:text-4xl">
          Stop reconciling. Start showing clear records.
        </h2>
        <p className="relative mx-auto mt-4 max-w-xl text-primary-foreground/80">
          Set up your organisation in minutes and let FinSeka keep the record while you keep the
          trust of your people.
        </p>
        <div className="relative mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            to="/auth"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-card px-8 py-4 text-base font-semibold text-primary shadow-lift transition-transform hover:scale-[1.02]"
          >
            Create free account <ArrowRight className="size-4" aria-hidden />
          </Link>
          <a
            href="tel:+2348000000000"
            className="inline-flex items-center justify-center gap-2 rounded-full border border-primary-foreground/30 px-8 py-4 text-base font-semibold text-primary-foreground transition-colors hover:bg-primary-foreground/10"
          >
            <PhoneCall className="size-4" aria-hidden /> Talk to us
          </a>
        </div>
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
            Keep your association money simple and clear. Built for Nigerian churches, clubs,
            associations and town unions.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          © {new Date().getFullYear()} FinSeka. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
