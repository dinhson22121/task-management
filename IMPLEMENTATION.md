# Task Pool Manager — Implementation Spec

This is a build spec for a CLI coding agent. It covers the full backend + the corner notification-popup widget already agreed in the mockups. Implement top to bottom; each section has an acceptance checklist.

## 1. What this app does

- Desktop app (Windows / macOS) plus mobile, one shared backend.
- The user creates **pools** (name + max ticket capacity + default deadline-warning lead time).
- Tickets are added to a pool by **pasting a Jira issue URL** — the backend resolves title, description, and deadline via the Jira API.
- If a pool is at capacity, adding a new ticket is rejected until the user removes one.
- As a ticket's deadline approaches (configurable lead time, up to 120 minutes), it flips to a **Warning** state.
- Once the deadline passes, the ticket flips to **Overdue** and the client keeps showing a **continuous, repeating** red warning until the ticket is removed or its deadline is updated.
- A small **corner notification popup** (bottom-right, sketch-free "cute flat mascot" avatar) surfaces these events, and doubles as a quick-access menu: hover reveals Settings / Ticket list / Add ticket buttons.

## 2. Tech stack

| Layer | Choice |
|---|---|
| Language/runtime | Node.js 20+, TypeScript |
| API framework | Express (or Fastify) |
| ORM / DB | Prisma + SQLite (single file, single-writer — see §4 note) |
| Real-time | Socket.IO |
| Background jobs | `node-cron`, in-process |
| Auth | JWT (app users) + OAuth2 (Jira) |
| Client shell | Not covered here — backend is REST + Socket.IO, client-agnostic |

> SQLite is single-writer/single-file — fine for one server per team. If you need multiple horizontally-scaled API instances later, swap to libSQL/Turso or Postgres; the Prisma layer makes that mostly a config change.

## 3. Repo structure

```
task-pool-backend/
  prisma/
    schema.prisma
  src/
    server.ts                # express app + http server + socket.io bootstrap
    routes/
      pools.ts
      tickets.ts
      integrations.ts
      users.ts
    services/
      jiraClient.ts           # resolves a Jira URL -> {title, description, deadline}
      poolService.ts           # capacity-check + create/remove ticket logic (transactional)
      deadlineScanner.ts        # node-cron job, emits Socket.IO events
      notificationProviders/
        index.ts                # registry / factory
        slackNotifier.ts
        teamsNotifier.ts
    sockets/
      index.ts                 # io.on('connection', ...), room joins
    middleware/
      auth.ts
    types.ts
  .env.example
  package.json
  tsconfig.json
```

## 4. Data model (Prisma schema)

```prisma
// prisma/schema.prisma
datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL") // e.g. "file:./dev.db"
}

generator client {
  provider = "prisma-client-js"
}

model User {
  id                          String   @id @default(uuid())
  email                       String   @unique
  displayName                 String
  defaultWarningLeadMinutes   Int      @default(60) // 1-120, enforce in app code
  createdAt                   DateTime @default(now())
  pools                       Pool[]
  integrationConnections      IntegrationConnection[]
}

model Pool {
  id        String   @id @default(uuid())
  ownerId   String
  owner     User     @relation(fields: [ownerId], references: [id])
  name      String
  capacity  Int
  createdAt DateTime @default(now())
  tickets   Ticket[]
}

model Ticket {
  id                  String   @id @default(uuid())
  poolId              String
  pool                Pool     @relation(fields: [poolId], references: [id], onDelete: Cascade)
  jiraKey             String
  jiraUrl             String
  title               String
  description         String?
  deadline            DateTime
  warningLeadMinutes  Int?     // per-ticket override, 1-120
  status              String   @default("Normal") // Normal | Warning | Overdue
  addedAt             DateTime @default(now())

  @@unique([poolId, jiraKey])
  @@index([deadline])
}

model IntegrationConnection {
  id                     String    @id @default(uuid())
  userId                 String
  user                   User      @relation(fields: [userId], references: [id])
  provider               String    // 'jira' | 'notifier'
  authTokenEncrypted     Bytes
  refreshTokenEncrypted  Bytes?
  expiresAt              DateTime?

  @@unique([userId, provider])
}

model NotificationEvent {
  id        String   @id @default(uuid())
  ticketId  String
  type      String   // Warning | Overdue | CapacityBlocked
  sentAt    DateTime @default(now())
  channel   String   // push | chat | email
}
```

**Acceptance:** `npx prisma migrate dev` runs clean; `sqlite3 dev.db .schema` shows all five tables with the indexes/uniques above.

## 5. REST API

| Method | Path | Notes |
|---|---|---|
| POST | `/pools` | `{ name, capacity, defaultWarningLeadMinutes }` |
| GET | `/pools/:id` | includes ticket count |
| PATCH | `/pools/:id` | rename / change capacity / lead time |
| GET | `/pools/:id/tickets` | includes computed `status` |
| POST | `/pools/:id/tickets` | `{ jiraUrl }` → `409 { error: "PoolCapacityExceeded", capacity, current }` if full |
| PATCH | `/pools/:id/tickets/:ticketId` | update `deadline` and/or `warningLeadMinutes` |
| DELETE | `/pools/:id/tickets/:ticketId` | also clears Overdue state |
| POST | `/integrations/jira/connect` | starts Jira OAuth |
| POST | `/integrations/notifier/connect` | connects chat/notification provider |
| GET/PATCH | `/users/me/settings` | default lead time (≤120 min) |

**Add-ticket flow (must be implemented exactly like this — it's the core business rule):**

```
1. Parse the Jira issue key out of the pasted URL.
2. Inside a single DB transaction (SQLite BEGIN IMMEDIATE via Prisma interactive tx):
   a. Re-count tickets in the pool.
   b. If count >= pool.capacity -> throw PoolCapacityExceeded (caller returns 409).
   c. Otherwise call the Jira client, map summary/description/duedate, insert the row.
3. Broadcast `TicketAdded` over Socket.IO to the pool's room.
```

The transactional re-count matters: two devices adding at the same time must not both slip through when the pool has exactly one slot left.

**Acceptance:** a script/test that fires two concurrent `POST /pools/:id/tickets` at a pool with 1 slot left results in exactly one 200 and one 409.

## 6. Real-time events (Socket.IO)

Clients connect and join a room per `poolId` (or `userId`). Server emits:

| Event | Payload | When |
|---|---|---|
| `TicketAdded` | `{ ticket }` | after successful add |
| `TicketWarning` | `{ ticketId, deadline, minutesRemaining }` | deadline scanner crosses the lead-time threshold |
| `TicketOverdue` | `{ ticketId, deadline }` | **repeats** every scan tick while unresolved — this is what drives the continuous red banner client-side |
| `TicketResolved` | `{ ticketId }` | ticket removed or deadline pushed forward |
| `PoolCapacityChanged` | `{ poolId, current, capacity }` | ticket added/removed |

## 7. Deadline warning engine

`node-cron` job, every 30s, in `services/deadlineScanner.ts`:

```ts
cron.schedule('*/30 * * * * *', async () => {
  const tickets = await prisma.ticket.findMany({
    where: { status: { not: 'Resolved' } },
    include: { pool: { include: { owner: true } } },
  });
  const now = new Date();

  for (const ticket of tickets) {
    const lead = ticket.warningLeadMinutes ?? ticket.pool.owner.defaultWarningLeadMinutes;

    if (now >= ticket.deadline) {
      if (ticket.status !== 'Overdue') {
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Overdue' } });
      }
      io.to(ticket.poolId).emit('TicketOverdue', { ticketId: ticket.id, deadline: ticket.deadline }); // fires every tick, on purpose
    } else if (now >= new Date(ticket.deadline.getTime() - lead * 60000)) {
      if (ticket.status !== 'Warning') {
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: 'Warning' } });
        io.to(ticket.poolId).emit('TicketWarning', { ticketId: ticket.id, deadline: ticket.deadline });
      }
    }
  }
});
```

**Acceptance:** a ticket with `deadline = now - 1 minute` flips to `Overdue` within one scan tick, and the test harness receives repeated `TicketOverdue` events (not just one).

## 8. Notification providers (pluggable)

```ts
export interface NotificationProvider {
  readonly providerName: string;
  send(event: NotificationEvent, recipient: User): Promise<void>;
}
```

Register concrete providers (`SlackNotifier`, `TeamsNotifier`, ...) in `notificationProviders/index.ts`, resolved per user from `IntegrationConnection.provider`. Core domain/API code must never import a concrete provider directly.

## 9. Frontend widget spec — corner notification popup

This is the small always-on-top widget already validated in the mockup. Build it as a standalone component (Electron overlay window, or embedded widget in the desktop shell) driven by the Socket.IO events above.

**Idle state:** a small avatar (~190×178px footprint) anchored bottom-right of the screen. Flat-vector "cute mascot" art style — bold black outline (~6-8px stroke), flat solid colors, big simple eyes with a single bold pupil (no busy iris/gradient detail), blush dots, simple hair/body blob shapes. Two swappable skins: Anime and Robot, toggled from the demo controls (in the real app this can be a user preference in Settings).

**Idle animation (always running):**
- Squash-and-stretch bounce loop (~1.8s cycle): stretch up, land with squash, small recoil settle.
- A contact shadow beneath the character that shrinks/grows opposite the bounce.
- Continuous eye blink every ~3.4s.
- A couple of orbiting sparkle/dust particles for polish.

**Notification behavior:**
- On `TicketWarning` / `TicketOverdue`, a speech-bubble notification pops up next to the avatar (scale+fade in), showing ticket key + short message, with a small wiggling bell icon.
- While the bubble is visible, the avatar's mouth animates as if "talking" (alternate between closed/open mouth shapes).
- `TicketOverdue` re-triggers the bubble on every server tick — reinforcing the "continuous, doesn't self-dismiss" requirement — until a `TicketResolved` event is received for that ticket.

**Hover quick-actions menu:**
- Hovering the avatar reveals three circular buttons directly above it: ⚙️ Settings, 📋 Ticket list, ➕ Add ticket.
- Buttons fade/slide in on hover, fade out when the mouse leaves **and** no panel is open.

**Click-opened panels** (persist regardless of hover, closed only via the ✕ button or re-clicking the same icon):

- **Settings panel:** Pool selector (dropdown), Pool capacity (number input), Warning lead time (range slider, 1–120 min, live value readout), Notification text size (S/M/L segmented control), Save button with a transient "Saved ✓" toast.
- **Ticket list panel:** compact rows of `key — short title` with a status badge (Normal = neutral gray, Warning = amber, Overdue = red, overdue row gets a subtle red-tinted background).
- **Add ticket panel:** single text input for the Jira URL + "Add to pool" button with a transient "Added ✓" toast, plus a hint line reflecting current capacity (and what happens if it's full — reuse the `PoolCapacityExceeded` message from §5).

Wire all three panels to the real endpoints in §5 — no mock data once the backend is up:
- Settings panel reads/writes `GET/PATCH /users/me/settings` and `PATCH /pools/:id`.
- Ticket list panel reads `GET /pools/:id/tickets` and subscribes to `TicketAdded` / `TicketWarning` / `TicketOverdue` / `TicketResolved` / `PoolCapacityChanged` to stay live.
- Add ticket panel calls `POST /pools/:id/tickets`; on `409 PoolCapacityExceeded`, show the hint text as an inline error instead of a toast.

**Acceptance:** with the backend running, opening the widget's Settings panel shows the real default lead time for the logged-in user; pasting a valid Jira URL in Add ticket creates a real ticket and the Ticket list panel updates without a manual refresh (driven by the `TicketAdded` socket event).

## 10. Environment variables

```
DATABASE_URL="file:./dev.db"
JWT_SECRET=
JIRA_CLIENT_ID=
JIRA_CLIENT_SECRET=
JIRA_OAUTH_REDIRECT_URI=
TOKEN_ENCRYPTION_KEY=      # for encrypting IntegrationConnection tokens at rest
PORT=4000
```

## 11. Build order (do these in sequence)

1. Scaffold repo, `package.json`, TypeScript config, Prisma schema (§4) + migration.
2. Express app skeleton + `/pools` and `/pools/:id/tickets` routes with the transactional capacity check (§5).
3. Socket.IO wiring + room joins (§6).
4. Jira client (`jiraClient.ts`) — parse URL, call Jira REST v3, map fields.
5. Deadline scanner cron job (§7) emitting `TicketWarning` / `TicketOverdue`.
6. Notification provider interface + one stub implementation (§8).
7. Auth middleware (JWT) + Jira OAuth connect flow.
8. Wire the corner widget (§9) to live endpoints/events, replacing all mock data from the earlier HTML mockups.
9. Write the two concurrency tests described in §5 and §7's acceptance checks.

## 12. Testing checklist

- [ ] Two concurrent add-ticket requests at capacity-1 → exactly one succeeds.
- [ ] Ticket with past deadline flips to Overdue within one scan tick and keeps re-emitting `TicketOverdue`.
- [ ] Removing an overdue ticket stops further `TicketOverdue` emissions and fires `TicketResolved`.
- [ ] Updating a ticket's deadline forward clears Overdue/Warning status and fires `TicketResolved`.
- [ ] `PATCH /users/me/settings` rejects `defaultWarningLeadMinutes` outside 1–120.
- [ ] Widget Settings panel round-trips real values from `/users/me/settings`.
