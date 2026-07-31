import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/AppLayout';

const Dashboard = lazy(() => import('@/pages/Dashboard'));
const Companies = lazy(() => import('@/pages/Companies'));
const Consulting = lazy(() => import('@/pages/Consulting'));
const AppDevelopment = lazy(() => import('@/pages/AppDevelopment'));
const Social = lazy(() => import('@/pages/Social'));
const Events = lazy(() => import('@/pages/Events'));
const EventForm = lazy(() => import('@/pages/EventForm'));
const EventDetail = lazy(() => import('@/pages/EventDetail'));
const Resources = lazy(() => import('@/pages/Resources'));
const Messages = lazy(() => import('@/pages/Messages'));
const Templates = lazy(() => import('@/pages/Templates'));
const Analytics = lazy(() => import('@/pages/Analytics'));
const Settings = lazy(() => import('@/pages/Settings'));

function PageFallback() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-slate-400">
      Loading...
    </div>
  );
}

const page = (Component: React.ComponentType) => (
  <Suspense fallback={<PageFallback />}>
    <Component />
  </Suspense>
);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={page(Dashboard)} />
          <Route path="/companies" element={page(Companies)} />
          <Route path="/consulting" element={page(Consulting)} />
          <Route path="/app-development" element={page(AppDevelopment)} />
          {/* Static segments before the dynamic one, so /events/new is never
              read as an event id. */}
          <Route path="/events" element={page(Events)} />
          <Route path="/events/new" element={page(EventForm)} />
          <Route path="/events/:id" element={page(EventDetail)} />
          <Route path="/events/:id/edit" element={page(EventForm)} />
          <Route path="/social" element={page(Social)} />
          <Route path="/resources" element={page(Resources)} />
          <Route path="/messages" element={page(Messages)} />
          <Route path="/templates" element={page(Templates)} />
          <Route path="/analytics" element={page(Analytics)} />
          <Route path="/settings" element={page(Settings)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
