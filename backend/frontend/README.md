# Web client

Next.js 15 (App Router) + TypeScript + Tailwind CSS 4, exported as static files
and served by FastAPI at `/ui`.

## Build

```bash
cd backend/frontend
npm install
npm run build      # writes ./out, which FastAPI serves
```

Then `uvicorn app.main:app --reload` from `backend/` serves the dashboard at
<http://127.0.0.1:8000/ui>.

For UI work with hot reload, run `npm run dev` (port 3000) alongside uvicorn.
API calls are same-origin in production but cross-origin in dev, so sign in
through <http://127.0.0.1:8000/ui/login/> once and keep both on `localhost`.

## Why a static export

`output: "export"` with `basePath: "/ui"` keeps the client on the same origin as
the API. That matters for more than tidiness: the session cookie is HttpOnly and
`SameSite`, so a separate Node origin would need CORS credentials and
`SameSite=None; Secure`, which does not work over plain-HTTP localhost. It also
keeps deployment to a single process.

If `out/` is missing, FastAPI falls back to `../frontend-legacy/` — the original
dependency-free client — so a checkout that has never run `npm` still works.

## Structure

```
src/
├── app/                    routes (App Router)
│   ├── page.tsx            public landing page       → /ui
│   ├── assessment/         participant test          → /ui/assessment
│   ├── login/              sign-in                   → /ui/login
│   └── dashboard/          authenticated shell
│       ├── page.tsx        overview + training
│       ├── history/        assessment report
│       └── collect/        labelled data collection
├── components/
│   ├── ui/                 Button, Input, Card, Modal, Badge, Avatar,
│   │                       Dropdown, Pagination, Alert, Toast, Loading,
│   │                       EmptyState
│   ├── layout/             Sidebar, Navbar, Footer, navigation
│   ├── dashboard/          StatCard, RiskGauge, Charts
│   ├── tables/             DataTable
│   └── assessment/         AssessmentFlow
├── hooks/                  useAuth, useAsync, useTheme, usePursuitTask
├── lib/                    api, types, constants, format, cn
└── styles/                 globals.css (design tokens)
```

## Conventions

- Compose classes with `cn()` (clsx + tailwind-merge) so a caller can override
  any component default through `className`.
- Colour, spacing and radius come from the `@theme` block in `globals.css`.
  Do not hardcode hex values in components.
- Dark mode is class-based; an inline script in the root layout applies the
  stored preference before first paint to avoid a flash.
- No webfont CDN: the app may run offline inside a hospital network, and a
  third-party font request would leak visitor IPs.
