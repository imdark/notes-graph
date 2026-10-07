# Agent push to phones

When a device run asks its starter something (a question, or permission for
a tool), the server pushes it to that person's phones through Firebase Cloud
Messaging. The Android notification answers it in place:

- **Permission:** Allow · Deny · Deny with note (typed reply goes to the agent)
- **Question:** up to two choices as buttons · Reply (every choice offered as a chip)
- **Tap:** opens a full view that reads the question back from the server, with
  the whole tool input, a note field, and Allow / Allow all / Deny.

Answering anywhere (web, another phone) clears the notification on the others.

On a locked phone the notification only says that an agent is waiting; the
question and tool input stay hidden, and every answer button asks for the
phone to be unlocked first (Android 12+). The full view also honours the
app's own lock (Settings → Security), so nothing is allowed from a phone
someone has just picked up.

## On the Mac running the device runner

The run's own MCP server (`workflow/deploy/agent_mcp.py` in the `wf` repo)
also shows each question on the Mac that runs it, through a small helper app,
"NotesGraph Agent" (`ask_notifier.swift`, built with `swiftc` into
`~/Library/Caches/wf/ask-notifier/` on first use). Like the phone:

- **Notification:** Allow · Deny for a permission, Reply for a question
- **Click:** a dialog with the whole question: the tool input, a note or
  answer box, and Allow / Deny, or Send plus a button per choice. **Later**
  puts the notification back.

The answer goes to the same `/answer` endpoint, so it only works when the
runner's token is the starter's own. Answering elsewhere takes the Mac's
notification and dialog away. macOS asks once whether NotesGraph Agent may
send notifications; if that is refused (System Settings → Notifications),
or there is no `swiftc`, the run falls back to a plain notification that
can't be answered. `NG_NOTIFY=0` turns both off.

## Pieces

| Where | What |
| --- | --- |
| `server/src/plugins/inventory/push.ts` | Builds and sends the FCM data message; drops dead tokens |
| `server/src/plugins/inventory/jobs.ts` | Pushes on `ask`, clears on `answer` (fire-and-forget) |
| `POST /api/inventory/push-tokens` (`/remove`) | A phone registers / unregisters its FCM token for the signed-in user |
| `android/.../push/` | FCM service, notification, action receiver, question screen, authed HTTP |
| `android/src/agent-push-glue.ts` | Registers with every signed-in server; sign-out unregisters (`app.tsx`) |

## Turning it on

Push is off until both halves have a real Firebase project:

1. Create a Firebase project and add an Android app with package
   `app.notesgraph.pro`. Download its `google-services.json` into
   `packages/frontend/apps/android/App/app/` (git-ignored; the committed
   `.bak` is a placeholder that builds but gets no token), and update the
   release secret CI uses for it.
2. In the same project: Project settings → Service accounts → Generate new
   private key. Give the whole JSON to the server as
   `NOTESGRAPH_FCM_SERVICE_ACCOUNT` (or the `inventory.fcmServiceAccount`
   config). Empty means no push; questions still wait in the app.
3. Rebuild the APK; on first launch while signed in it asks for the
   notification permission and registers.
