# Association Ledger

:

---

*1. Product Name*

* FinSeka*

_Tagline: Keep your association money simple and clear_

*2. Who it’s for*

Financial Secretaries of churches, clubs, associations, town unions.

People who aren’t super techy but need to track dues, contributions, and expenses without Excel wahala.

*3. Design Vibe*

- *Theme*: Apple-like + Material UI. Clean, lots of white/cream space

- *Colors*: Wine `#722F37` as primary, Muted Blue `#4A6FA5` as accent, Soft Cream `#FDFBF7` background, Green `#2E7D32` for "good/paid"

- *Goal*: Not too colorful. Big buttons. Clear labels. Guides everywhere so no one gets lost.

*4. Core Structure - Sidebar Navigation*

Collapsible left sidebar:

1. *Dashboard*

2. *Members*

3. *Dues*

4. *Contributions*

5. *Ledger*

6. *Settings & Admin*

*5. Key Features Breakdown*

*A. DASHBOARD*

First thing you see. At a glance.

- *Balance in Hand*: Total money in organization purse

- *Total Being Owed*: Sum of all unpaid dues

- *Active Contributions*: "Mom's burial - 45/60 people paid"

- *Dues Health*: Pie chart - Paid vs Not Paid this month

- *Recent Activity*: "Chinedu paid Jan + Feb dues", "New expense added"

*B. MEMBERS*

- *Add Member*: Name, Phone, Branch/Chapter. Starts with 1 default group

- *Branches/Chapters*: Can add more later. Ex: "Umuahia Branch", "Aba Branch"

- *Member Profile*: Click a member to see all their payments, what they owe, history

*C. DUES*

Set and track regular payments.

- *Set Dues*: Create as many as you want.

 Ex: "Monthly Dues - ₦1000", "Development Levy - ₦5000 yearly", "Daily Contribution - ₦200"

- *Frequency*: Daily, Weekly, Monthly, Yearly, Custom

- *Track Payments*: Click any due → See 2 lists: `Paid` and `Not Paid` + `Overdue`

- *Edit*: Mark half payment, full year payment, add notes

*D. CONTRIBUTIONS*

For one-off things that "come up".

- *Create Contribution*: Name, Reason, Target Amount, Due Date, Select Members

 Ex: "For Sister Ada’s Mom Burial - ₦2000 per person - Due March 30 - Select 60 people"

- *Track*: Tap contribution → See who paid, who didn’t, how much collected vs target

- *Auto reminders* for due date

*E. LEDGER*

This is where you track money that entered and left the org purse.

- *Income*: From dues, contributions, donations

- *Expense*: "Bought chairs for ₦50,000", "Hall rent for event ₦20,000"

- *Balance*: Auto calculate Income - Expense

- *Reports*: See by month, by year. See who is owing overall

Money paid for dues and contribution should show up here and labeled appropriately 

With  sort by custom date and time (by default 7 days, 2 weeks, 1 month 

*F. SETTINGS & ADMIN*

- *Create Login Accounts*: President, Treasurer, etc. Role-based access

- *Roles*: Admin can edit everything. Viewer can only see

- *Organization Info*: Name, Logo

*6. User Flow Example*

1. FinSec logs in → Sees Dashboard: "₦120,000 in hand. ₦45,000 being owed"

2. Clicks *Dues* → Clicks "March Monthly Dues" → Sees 40 paid, 10 not paid

3. Clicks *Contributions* → Creates "New Projector" → Selects 50 members

4. End of month → Goes to *Ledger* → Adds "Spent ₦80,000 on projector" → Balance updates

*7. Tech Notes for Dev*

- *Mobile first* - Most will use phone

- *Offline first* if possible, then sync

- *Simple language* on all buttons. No jargon

- *Color coding*: Green = Paid/Good, Red = Overdue, Wine = Primary buttons

*8. What NOT to include*

No accounting jargon. No "debit/credit". No ghostwriting 😅 Just: Paid, Not Paid, Owing, In Hand.

---

First build a landing page that leads into the product, use realastic Nigerian scenario images of the tool at use 

Agitate the pain and offer the relief that is finseka, no more reconciliation of accounts, pure trnaoerency and accountability

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://finseka.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9ae67be7-f76c-4a10-a922-b628fbde4633).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
