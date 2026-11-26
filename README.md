# Sugihara — R&D Work Order (revision 1.1)

React + Vite frontend prototype, updated from the original project. No server or real authentication is required for this demo.

## Run in VS Code on Windows
1. Extract the ZIP to a new folder (e.g. `rnd-work-order-v2`). Open that exact folder in VS Code. `package.json` must be visible at its root.
2. Open Terminal > New Terminal. Node.js 22 LTS recommended (minimum 20.19).
3. Run `npm install`, then `npm run dev`. Open the URL printed by Vite (usually http://localhost:5173).
4. Run `npm test` for the workflow unit tests, `npm run build` for the production bundle.

## What changed
- Sugihara company logo cropped directly from the supplied CMMS screenshot (55px reference asset; replace with official high-resolution asset when available). Branding text: Sugihara, Production Requester / Department Approver / R&D Receiver / R&D Head. Browser title: R&D Work Order.
- Manual Reference No. separate from unique local Work Order ID (WO-YYYY-NNNN). Existing generated references migrate into the ID field; no orders deleted. Reference numbers can be blank until entered by the requester.
- Mandatory minimum one before-work photo on submission; drafts may be saved without photos. JPEG/PNG/WebP, max 8 MiB, nonempty; MIME/size checks only. After photos optional. Drag/drop, replacement, removal and image enlargement.
- One centered modal, 50vw desktop (max 960px), 85vw at <=1100px, 95vw at <=720px, max height 90dvh, 6px backdrop blur and 38% dimming, fixed header/footer, continuous scroll with no tabs. Before/after side-by-side on desktop, stacked on phones.
- Friendlier editing labels. Requester can use Edit request to change own active Part A, R&D can edit authorised Part B. No cross-role editing. No subjective progress percentage.
- Every saved edit records old/new values, employee, role, time and reason where required. Replaced/removed attachment blobs remain available in history. Newest activity first. Closed records can be reopened by R&D Head with reason.
- Reference-only corrections do not invalidate approval. Material requester changes (scope, classification, dates, priority, photos/documents, etc.) require a reason; if approved, the order returns for reapproval and current planning/completion fields and R&D evidence are reset, with their previous values/files preserved in history. This is a conservative prototype policy to review with R&D. Planning/photo changes after receipt may also require a reason.
- Existing dashboards, board, reporting/CSV, demo roles and local notification view retained. Search and CSV include both IDs.

## Try the workflow
Choose Production Requester; create a request, attach a photo, submit. Switch to Production Manager to approve; switch to R&D Receiver to receive; R&D Head assigns PIC and saves a work plan, then confirms it. Start work, edit and save completion details, record completion, verify if required, switch to original requester and acknowledge. Use Edit request on an open order to test reference correction or a material change with reason. Scroll to Activity History. Closed orders require R&D Head reopening. Existing sample records are legacy examples and have no supplied photos; new submissions and material revisions require a valid before photo.

## Storage and limitations
IndexedDB database name intentionally unchanged (`sugihara-workflow-v1`) for migration compatibility. Existing records on the same browser/origin/port are retained, but the original ZIP cannot contain your local browser data. Back up existing project and important data before replacing files. Keep the same Vite origin to see existing records. Prototype is designed for one active tab; simultaneous tabs may conflict. No central database, real multi-user authentication, secure server-side audit or production notifications. The Notifications view reflects pending actions and recent changes, not a true unread delivery system. Real authentication, PostgreSQL, server-side ID allocation/file validation, robust revision concurrency, and tamper-resistant audit history are future work. Do not use with sensitive production data yet. Demo creation is available to the Production Requester account; the supplied four-account demo models one department approval chain.

## Verification
Nine workflow unit tests passed under Node 22.16. JavaScript/JSX parse checks passed using TypeScript's parser. npm registry DNS unavailable in the creation environment; dependency installation, Vite build and live browser verification could not be completed there. Run them locally before deployment.
