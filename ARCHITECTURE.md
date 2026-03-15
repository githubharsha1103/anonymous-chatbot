# Anonymous Chatbot Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    TELEGRAM BOT API                                          │
│                              (via Telegraf Framework)                                        │
└─────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      src/index.ts                                            │
│  ┌──────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              ExtraTelegraf (Bot Class)                                │  │
│  │  • waitQueue: User[]        • premiumQueue: User[]        • Mutex (concurrency)   │  │
│  │  • Bot initialization       • Command registration        • Event registration    │  │
│  └──────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     COMMAND LAYER                                            │
│                                        src/Commands/                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │   start.ts   │  │   next.ts    │  │  search.ts   │  │    end.ts    │  │  premium.ts  │ │
│  │  (onboarding)│  │ (find match) │  │ (search user)│  │(leave chat)  │  │ (Stars pay)  │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  help.ts     │  │ report.ts    │  │ referral.ts  │  │  settings.ts │  │adminaccess.ts│ │
│  │  (help cmd)  │  │(report user) │  │(referral sys)│  │(user prefs) │  │ (admin menu) │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                                      │
│  │   ping.ts    │  │ reengagement.ts│ │getgroupid.ts │                                     │
│  │  (health)    │  │(user召回)      │  │(group info)  │                                     │
│  └──────────────┘  └──────────────┘  └──────────────┘                                      │
└─────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      EVENT LAYER                                              │
│                                        src/Events/                                            │
│  ┌──────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              textMessage.ts                                          │  │
│  │  • Message handling      • Broadcast system     • Payment processing                │  │
│  │  • URL detection         • Admin queries        • User activity tracking            │  │
│  │  • Poll blocking         • Chat state management                                  │  │
│  └──────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     UTILITY LAYER                                            │
│                                        src/Utils/                                             │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │  commandHandler  │  │   eventHandler   │  │   chatFlow.ts   │  │  actionHandler  │   │
│  │  (command loader) │  │  (event loader)  │  │  (chat logic)   │  │  (user actions) │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │   setupFlow.ts   │  │  starsPayments   │  │  telegramError   │  │   adminAuth.ts   │   │
│  │ (onboarding flow)│  │  (Telegram Stars)│  │   Handler.ts     │  │  (admin check)   │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ envValidator.ts  │  │  telegramUi.ts   │  │                  │  │                  │   │
│  │ (env validation) │  │   (UI helpers)   │  │                  │  │                  │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     STORAGE LAYER                                            │
│                                        src/storage/                                          │
│  ┌──────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                                   db.ts                                              │  │
│  │  • MongoDB connection     • User collection      • Chat sessions                    │  │
│  │  • JSON file fallback     • Queue management     • Admin logs                       │  │
│  │  • Mutex for concurrency  • Transaction support                                   │  │
│  └──────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                              Collections                                              │  │
│  │  • users          • chats        • reports       • referrals                         │  │
│  │  • admin_logs     • settings     • payments      • analytics                         │  │
│  └──────────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     ADMIN LAYER                                              │
│                                        src/admin/                                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │   dashboard.ts   │  │ queueMonitor.ts  │  │revenueAnalytics.ts│ │  adminLogs.ts   │   │
│  │  (health metrics)│  │  (queue viewer)  │  │  (payment stats)  │  │  (audit logs)   │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘   │
│  ┌──────────────────┐  ┌────────────────────────────────────────────────────────────────┐  │
│  │moderationSettings│  │                     index.ts (callback registration)          │  │
│  │ (auto-moderation)│  │                                                                  │  │
│  └──────────────────┘  └────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    │                         │                         │
                    ▼                         ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                     SERVER LAYER                                              │
│                                        src/server/                                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐                          │
│  │  webServer.ts    │  │  cleanup.ts      │  │adminCommands.ts │                          │
│  │  (Express API)   │  │ (session cleanup) │  │ (admin cmds)     │                          │
│  │  • Webhook      │  │ • Inactive chats  │  │                  │                          │
│  │  • Health check │  │ • Queue cleanup   │  │                  │                          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘                          │
└─────────────────────────────────────────────┬───────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    EXTERNAL SERVICES                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐       │
│  │  Telegram API    │  │  MongoDB Atlas  │  │  Telegram Stars │  │  Webhook URL    │       │
│  │  (Bot API)       │  │  (Database)      │  │  (Payments)     │  │  (Production)   │       │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Component Description

### 1. Entry Point ([`src/index.ts`](src/index.ts))
The main bot initialization file using Telegraf framework. Contains:
- **ExtraTelegraf class**: Extended bot class with queue management
- **waitingQueue**: Regular users waiting for matchmaking
- **premiumQueue**: Premium users with priority matching
- **Mutex**: Concurrency control for thread-safe operations

### 2. Command Layer ([`src/Commands/`](src/Commands/))
User-executable commands:
| Command | Purpose |
|---------|---------|
| [`start.ts`](src/Commands/start.ts) | Onboarding and profile setup |
| [`next.ts`](src/Commands/next.ts) | Find and connect with a random partner |
| [`search.ts`](src/Commands/search.ts) | Search for specific users |
| [`end.ts`](src/Commands/end.ts) | End current chat session |
| [`premium.ts`](src/Commands/premium.ts) | Telegram Stars payment integration |
| [`report.ts`](src/Commands/report.ts) | Report inappropriate users |
| [`referral.ts`](src/Commands/referral.ts) | Referral system |
| [`adminaccess.ts`](src/Commands/adminaccess.ts) | Admin panel access |

### 3. Event Layer ([`src/Events/`](src/Events/))
Event handlers for Telegram updates:
- [`textMessage.ts`](src/Events/textMessage.ts): Handles all text messages, broadcasts, payment notifications

### 4. Utility Layer ([`src/Utils/`](src/Utils/))
Core utilities:
| Module | Purpose |
|--------|---------|
| [`commandHandler.ts`](src/Utils/commandHandler.ts) | Dynamic command loading |
| [`eventHandler.ts`](src/Utils/eventHandler.ts) | Dynamic event registration |
| [`chatFlow.ts`](src/Utils/chatFlow.ts) | Chat state machine logic |
| [`actionHandler.ts`](src/Utils/actionHandler.ts) | User action processing |
| [`setupFlow.ts`](src/Utils/setupFlow.ts) | Onboarding flow |
| [`starsPayments.ts`](src/Utils/starsPayments.ts) | Telegram Stars integration |
| [`telegramErrorHandler.ts`](src/Utils/telegramErrorHandler.ts) | Error handling |
| [`adminAuth.ts`](src/Utils/adminAuth.ts) | Admin authorization |
| [`envValidator.ts`](src/Utils/envValidator.ts) | Environment validation |

### 5. Storage Layer ([`src/storage/db.ts`](src/storage/db.ts))
MongoDB database operations:
- User profile storage
- Chat session management
- Queue management
- Admin logs
- Referral tracking
- Payment records

### 6. Admin Layer ([`src/admin/`](src/admin/))
Admin functionality:
| Module | Purpose |
|--------|---------|
| [`dashboard.ts`](src/admin/dashboard.ts) | Bot health monitoring |
| [`queueMonitor.ts`](src/admin/queueMonitor.ts) | Matchmaking queue viewer |
| [`revenueAnalytics.ts`](src/admin/revenueAnalytics.ts) | Payment analytics |
| [`adminLogs.ts`](src/admin/adminLogs.ts) | Audit logging |
| [`moderationSettings.ts`](src/admin/moderationSettings.ts) | Auto-moderation config |

### 7. Server Layer ([`src/server/`](src/server/))
Express web server:
- [`webServer.ts`](src/server/webServer.ts): Webhook endpoint, API endpoints
- [`cleanup.ts`](src/server/cleanup.ts): Scheduled cleanup tasks

---

## Data Flow

```
User Message → Telegram API → Telegraf Bot → Event Handler
                                              ↓
                                    Command Handler
                                              ↓
                                    ┌─────────┴─────────┐
                                    ↓                   ↓
                              Chat Flow          Action Handler
                                    ↓                   ↓
                                    └─────────┬─────────┘
                                              ↓
                                       Storage (DB)
                                              ↓
                                       Admin Layer
```

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | Telegraf (Telegram Bot API) |
| Language | TypeScript |
| Database | MongoDB |
| Web Server | Express.js |
| Payments | Telegram Stars |
| Testing | Jest |
