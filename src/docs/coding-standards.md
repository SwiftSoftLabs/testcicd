# Coding Standards

## 🏛️ SWIFT SOFT LABS: Backend Protocol (STRICT)

**CRITICAL**: All development MUST adhere to the `SWIFT_LABS_MANIFEST.md`.
- **Platform**: InsForge
- **Organization & Project**: `SwiftSoftLabs`
- **Isolation Protocol**: This application lives as an isolated schema within the central organizational cluster. **DO NOT** create new standalone projects or databases.
  - **Schema**: `app_onework` (referenced via `NEXT_PUBLIC_DB_SCHEMA`).
  - **Role**: `app_onework_user`. This role has zero visibility into other schemas.
- **Shared Authentication**: Use the shared `auth.users` table provided by the central project. Profiles and user data must use the `{"app_origin": "app_onework"}` metadata field.

## TypeScript

- Strict mode enabled
- No `any` types - use proper typing or `unknown`
- Define interfaces for all props, API responses, and data models
- Use type inference where obvious, explicit types where helpful

## React

- Functional components only (no class components)
- Use hooks for state and side effects
- Keep components focused - one job per component
- Extract reusable logic into custom hooks

## Next.js

- Server components by default
- Only use `'use client'` when needed (interactivity, hooks, browser APIs)
- Use Server Actions for form submissions and simple mutations
- Use API routes when you need:
  - Webhooks (Stripe, GitHub, etc.)
  - File uploads with progress tracking
  - Long-running operations
  - Specific HTTP status codes or headers
  - Endpoints for future mobile/CLI clients
  - Third-party integrations
- Otherwise, fetch data directly in server components
- Dynamic routes for item/collection pages

## Tailwind CSS v4

**CRITICAL**: We are using Tailwind CSS v4, which uses CSS-based configuration.

- **DO NOT** create `tailwind.config.ts` or `tailwind.config.js` files (those are for v3)
- All theme configuration must be done in CSS using the `@theme` directive in `src/app/globals.css`
- Use CSS custom properties for colors, spacing, etc.
- No JavaScript-based config allowed

## File Organization

- Components: `src/components/[feature]/ComponentName.tsx`
- Pages: `src/app/[route]/page.tsx`
- Server Actions: `src/actions/[feature].ts`
- Types: `src/types/[feature].ts`
- Lib/Utils: `src/lib/[utility].ts`
- Database Configuration: `src/lib/insforge/` (Client, Server, Native, Config)
- Database Queries: `src/lib/db.ts` (For Raw SQL / Advanced Queries)

## Naming

- Components: PascalCase (`ItemCard.tsx`)
- Files: Match component name or kebab-case
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Types/Interfaces: PascalCase (no prefix)

## Styling

- Tailwind CSS for all styling
- Use shadcn/ui components where applicable
- No inline styles
- Dark mode first, light mode as option

## Database & Data Fetching

- **NO PRISMA ALLOWED**. We use InsForge directly.
- **Client & Server Components**: Fetch data using the InsForge client wrappers.
  - Server components: `import { createClient } from '@/lib/insforge/server';`
  - Client components: `import { createClient } from '@/lib/insforge/client';`
- **Native Operations**: For specific auth operations (like OAuth redirects and session management), use the native `@insforge/sdk` via `import { insforgeNative } from '@/lib/insforge/native';`.
- **Raw SQL / Advanced Queries**: Use the utility functions in `src/lib/db.ts` (`query`, `buildInsert`, `buildSet`). Always use the `SCHEMA` variable exported from `lib/db.ts` when referencing tables in raw SQL (e.g., `${SCHEMA}.profiles`).
- **Validation**: Validate all inputs with Zod.

## Error Handling

- Use try/catch in Server Actions and API Routes
- Return `{ success, data, error }` pattern from actions
- Display user-friendly error messages via toast
- Proper HTTP status codes in API Routes (e.g., 400 for bad input, 401 for unauthorized, 404 for not found, 500 for server error).

## Code Quality

- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible
