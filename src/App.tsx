import { lazy, Suspense } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';

const WorkTracker = lazy(() => import('@/pages/WorkTracker'));
const Events = lazy(() => import('@/pages/Events'));
const EventForm = lazy(() => import('@/pages/EventForm'));
const EventDetail = lazy(() => import('@/pages/EventDetail'));
const Social = lazy(() => import('@/pages/Social'));
const Resources = lazy(() => import('@/pages/Resources'));
const Messages = lazy(() => import('@/pages/Messages'));
const Templates = lazy(() => import('@/pages/Templates'));
const Settings = lazy(() => import('@/pages/Settings'));

function PageFallback() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-slate-400">
      Loading...
    </div>
  );
}

// Boundary outside Suspense, and keyed per page below, so a crash on one
// screen does not stick when you navigate to another.
const page = (Component: React.ComponentType) => (
  <ErrorBoundary>
    <Suspense fallback={<PageFallback />}>
      <Component />
    </Suspense>
  </ErrorBoundary>
);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          {/* Work Tracker is the landing page. */}
          <Route path="/" element={<Navigate to="/work-tracker" replace />} />
          <Route path="/work-tracker" element={page(WorkTracker)} />

          {/* Old Daily Work Log paths, kept so bookmarks do not break. The
              module spec asked for these as next.config.js redirects; this is
              a Vite SPA with react-router, so they are routes. The module
              lived at /daily, not /daily-logs — both are covered. */}
          <Route path="/daily" element={<Navigate to="/work-tracker" replace />} />
          <Route path="/daily/*" element={<Navigate to="/work-tracker" replace />} />
          <Route path="/daily-logs" element={<Navigate to="/work-tracker" replace />} />
          <Route path="/daily-logs/*" element={<Navigate to="/work-tracker" replace />} />
          <Route path="/events" element={page(Events)} />
          <Route path="/events/new" element={page(EventForm)} />
          <Route path="/events/:id" element={page(EventDetail)} />
          <Route path="/events/:id/edit" element={page(EventForm)} />
          <Route path="/social" element={page(Social)} />
          <Route path="/resources" element={page(Resources)} />
          <Route path="/messages" element={page(Messages)} />
          <Route path="/templates" element={page(Templates)} />
          <Route path="/settings" element={page(Settings)} />
          <Route path="*" element={<Navigate to="/work-tracker" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
