# Project instructions — Sugihara R&D Work Order

Maintain this React + Vite frontend; inspect existing files before editing. Do not recreate it or connect a server until requested. Preserve IndexedDB and data migration. Do not claim tests passed unless run.

## Identity and UI
- Use the supplied Sugihara logo, upper label Sugihara, larger role title Production Requester, R&D Receiver, Department Approver or R&D Head. App/browser title R&D Work Order. Never use the former WorkFlow branding.
- Modern purple #7C3AED, sidebar #241C35, lavender #EDE9FE, canvas #F7F8FC, white cards, text #1E293B. New neutral gray, planned lavender, active blue, monitoring cyan, closed green, rejected/overdue muted rose. Before photos soft rose, after photos soft green. Inter and Lucide; minimal shadows, no gradients.
- One genuine centered modal: desktop min(50vw,960px), tablet 85vw, mobile 95vw, 90dvh max, 6px blur, 38% overlay. Fixed header/footer, one vertical scroll, no tabs/accordions, no navigation, no side drawer. Responsive forms and photo panels.
- Never add subjective work progress percentages or progress bars. Use status and timestamps. Reports may show objective statistical rates.

## Workflow and editing
- Original FR-PR-001 rev0: Part A requester, Part B R&D. Auto unique Work Order ID, separate manual Reference No. Both searchable and included in exports. Preserve existing IDs.
- Draft -> pending department approval -> approved/new incoming -> received -> planned -> in progress -> completion -> verification if required -> requester acknowledgement -> closed. Temporary use/monitoring stay open; overdue is an indicator. Return/correction/reject/rectification paths preserve history.
- At least one valid before photo required to submit. Draft may have none. JPEG/PNG/WebP max 8 MiB, multiple images, thumbnail, replace/remove, enlarge, timestamp and uploader. Supporting PDFs do not substitute for a photo. After photo optional. R&D can add inspection and after photos; requester edits own before photos only.
- Use friendly Edit request/Edit details, not lock icons or aggressive messages. Requester can edit own active Part A; R&D can edit authorised Part B only. Work Order ID and formal approval/verification/ack records not manually editable. R&D Head handles PIC and verification. Closed work needs authorised reopening with reason.
- Every save records field previous/new values, actor, role, timestamp, reason where applicable. Preserve previous attachment blobs, previous submission and workflow records, newest activity first. Do not let users modify audit history. Material changes after approval require reapproval; current plan/completion reset with previous records in history. Reference-only correction does not trigger reapproval. Significant changes require reason. Notify counterpart via prototype action/change view.
- Keep dashboards, search, work board, planning, objective reports and CSV export. Maintain response/lead time and on-time rates based on valid records.

## Quality and future production
Run npm test, npm install, npm run build and verify visually with npm run dev when possible. Test role permissions, approval, mandatory photos, history, migration, and layout. Document limitations. Backend must eventually enforce all permissions, IDs and audit controls; frontend demo is not secure multi-user authentication.
