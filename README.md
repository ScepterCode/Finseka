# Association Ledger

:

---

_1. Product Name_

- FinSeka*

_Tagline: Keep your association money simple and clear_

_2. Who it’s for_

Financial Secretaries of churches, clubs, associations, town unions.

People who aren’t super techy but need to track dues, contributions, and expenses without Excel wahala.

_3. Design Vibe_

- _Theme_: Apple-like + Material UI. Clean, lots of white/cream space

- _Colors_: Wine `#722F37` as primary, Muted Blue `#4A6FA5` as accent, Soft Cream `#FDFBF7` background, Green `#2E7D32` for "good/paid"

- _Goal_: Not too colorful. Big buttons. Clear labels. Guides everywhere so no one gets lost.

_4. Core Structure - Sidebar Navigation_

Collapsible left sidebar:

1. _Dashboard_

2. _Members_

3. _Dues_

4. _Contributions_

5. _Ledger_

6. _Settings & Admin_

_5. Key Features Breakdown_

_A. DASHBOARD_

First thing you see. At a glance.

- _Balance in Hand_: Total money in organization purse

- _Total Being Owed_: Sum of all unpaid dues

- _Active Contributions_: "Mom's burial - 45/60 people paid"

- _Dues Health_: Pie chart - Paid vs Not Paid this month

- _Recent Activity_: "Chinedu paid Jan + Feb dues", "New expense added"

_B. MEMBERS_

- _Add Member_: Name, Phone, Branch/Chapter. Starts with 1 default group

- _Branches/Chapters_: Can add more later. Ex: "Umuahia Branch", "Aba Branch"

- _Member Profile_: Click a member to see all their payments, what they owe, history

_C. DUES_

Set and track regular payments.

- _Set Dues_: Create as many as you want.

Ex: "Monthly Dues - ₦1000", "Development Levy - ₦5000 yearly", "Daily Contribution - ₦200"

- _Frequency_: Daily, Weekly, Monthly, Yearly, Custom

- _Track Payments_: Click any due → See 2 lists: `Paid` and `Not Paid` + `Overdue`

- _Edit_: Mark half payment, full year payment, add notes

_D. CONTRIBUTIONS_

For one-off things that "come up".

- _Create Contribution_: Name, Reason, Target Amount, Due Date, Select Members

Ex: "For Sister Ada’s Mom Burial - ₦2000 per person - Due March 30 - Select 60 people"

- _Track_: Tap contribution → See who paid, who didn’t, how much collected vs target

- _Auto reminders_ for due date

_E. LEDGER_

This is where you track money that entered and left the org purse.

- _Income_: From dues, contributions, donations

- _Expense_: "Bought chairs for ₦50,000", "Hall rent for event ₦20,000"

- _Balance_: Auto calculate Income - Expense

- _Reports_: See by month, by year. See who is owing overall

Money paid for dues and contribution should show up here and labeled appropriately

With sort by custom date and time (by default 7 days, 2 weeks, 1 month

_F. SETTINGS & ADMIN_

- _Create Login Accounts_: President, Treasurer, etc. Role-based access

- _Roles_: Admin can edit everything. Viewer can only see

- _Organization Info_: Name, Logo

_6. User Flow Example_

1. FinSec logs in → Sees Dashboard: "₦120,000 in hand. ₦45,000 being owed"

2. Clicks _Dues_ → Clicks "March Monthly Dues" → Sees 40 paid, 10 not paid

3. Clicks _Contributions_ → Creates "New Projector" → Selects 50 members

4. End of month → Goes to _Ledger_ → Adds "Spent ₦80,000 on projector" → Balance updates

_7. Tech Notes for Dev_

- _Mobile first_ - Most will use phone

- _Offline first_ if possible, then sync

- _Simple language_ on all buttons. No jargon

- _Color coding_: Green = Paid/Good, Red = Overdue, Wine = Primary buttons

_8. What NOT to include_

No accounting jargon. No "debit/credit". No ghostwriting 😅 Just: Paid, Not Paid, Owing, In Hand.

---

First build a landing page that leads into the product, use realastic Nigerian scenario images of the tool at use

Agitate the pain and offer the relief that is finseka, no more reconciliation of accounts, pure trnaoerency and accountability

## Stack

- TanStack Start (React 19) + Vite, Tailwind and shadcn/ui
- Supabase: Postgres with row-level security, Auth (email and Google), Storage
- Hosted on Vercel

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
cp .env.example .env   # then fill in your Supabase values
npm run dev
```

## Database

Schema changes live in `supabase/migrations` and are applied in filename order.
Money records are add-only: payments are cancelled and ledger lines reversed, never edited or deleted.
