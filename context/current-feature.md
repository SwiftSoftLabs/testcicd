# Current feature: Chat message editing (UI + live update)

**Status:** In progress on `fix/message-edit-ui`

## Goal

Two related fixes to chat message editing:

1. **Edit UI look**: editing a message turns the existing bubble into an editable field in place (same padding/background/border/rounded corners, no separate plain textarea box), auto-growing height as you type.
2. **Live update bug**: after saving an edit, the message didn't update in the UI until a page refresh — `handleSaveEdit` discarded the API response and never told parent state or other clients (via realtime) about the change, unlike delete/reactions which already did this correctly.

## Key files

| Area | Files |
|------|-------|
| Chat message bubble + edit state | `src/components/chat/MessageItem.tsx` |
| Edit state patch + realtime publish | `src/app/(dashboard)/chat/page.tsx` (`applyMessageContent`, `handleEditMessage`) |
| Prop threading | `src/components/chat/ChatWindow.tsx`, `src/components/chat/ThreadPanel.tsx` |

## Verification

- [x] Edit own message → bubble becomes editable in place with matching background/border/rounded corners/padding
- [x] Textarea grows in height as text wraps to more lines
- [ ] Save persists edit, bubble shows "(edited)" immediately (no refresh needed) — needs manual browser check (no test credentials available)
- [ ] Cancel reverts to original content without saving
- [ ] Edit appears live in a second tab/session (confirms realtime publish path)
- [x] `npm run build`
- [x] `npx tsc --noEmit`

## History

- **Task URL deep linking** (merged `d66ae78`) — shareable `/tasks?projectId=&open=` URLs open the correct board/task modal.
