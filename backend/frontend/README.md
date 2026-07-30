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

### Re-run the build after every `git pull`

`out/` is generated, so it is **git-ignored and never arrives with a pull**. A
pull brings the source of a new page; until you rebuild, the server keeps
serving your previous `out/` and the new page simply is not there — no error,
no warning, just a missing menu item. If something you expect is absent:

```bash
cd backend/frontend && npm install && npm run build
```

Restart uvicorn afterwards if `out/` did not exist when it started — the choice
between the real client and the fallback is made once, at startup. Docker users
get this for free: the image builds the client during `docker build`.

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
dependency-free client — so a checkout that has never run `npm` still works. It
carries the same four dashboard tabs, but it is a plain-HTML stand-in, not a
second copy of this UI. The startup log says which one was mounted:

```
Frontend (Next.js build) mounted at /ui from .../frontend/out
Frontend (fallback client)  mounted at /ui from .../frontend-legacy
```

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
│       ├── collect/        labelled data collection
│       └── settings/       mock data, delete dataset, delete model
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
