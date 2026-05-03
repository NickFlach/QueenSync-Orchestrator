import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/Shell";
import NotFound from "@/pages/not-found";

// Code-split every route so the auth screen + first paint don't pay for
// the entire app. Each page becomes its own chunk that loads on demand.
const Overview = lazy(() => import("@/pages/overview"));
const ArmsRegistry = lazy(() => import("@/pages/arms"));
const TasksRouter = lazy(() => import("@/pages/tasks"));
const SignalsIngestion = lazy(() => import("@/pages/signals"));
const MemoryGate = lazy(() => import("@/pages/memory"));
const ResonanceFields = lazy(() => import("@/pages/resonance"));
const Adapters = lazy(() => import("@/pages/adapters"));
const Hologram = lazy(() => import("@/pages/hologram"));
const ExecutionLog = lazy(() => import("@/pages/logs"));
const Operations = lazy(() => import("@/pages/operations"));

import { AuthProvider, useAuth } from "@/lib/auth";
import { LoginScreen } from "@/components/login-screen";

let pendingAuthRefresh: (() => void) | null = null;

function isUnauthorized(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 401 || status === 403;
}

function maybeTriggerAuthRefresh(err: unknown) {
  if (isUnauthorized(err) && pendingAuthRefresh) {
    pendingAuthRefresh();
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (err) => maybeTriggerAuthRefresh(err),
  }),
  mutationCache: new MutationCache({
    onError: (err) => maybeTriggerAuthRefresh(err),
  }),
  defaultOptions: {
    queries: {
      // Most data is also pushed via the WebSocket, so cached values are
      // fresh-enough to avoid hammering the server on every component mount
      // / route switch. Per-page `refetchInterval` settings still take over
      // for true polling cadence.
      staleTime: 5_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function AuthRefreshBridge() {
  const { refresh } = useAuth();
  useEffect(() => {
    pendingAuthRefresh = () => {
      void refresh();
    };
    return () => {
      pendingAuthRefresh = null;
    };
  }, [refresh]);
  return null;
}

function RouteFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center text-muted-foreground font-mono text-xs uppercase tracking-widest">
      Loading…
    </div>
  );
}

function Router() {
  return (
    <Shell>
      <Suspense fallback={<RouteFallback />}>
        <Switch>
          <Route path="/" component={Overview} />
          <Route path="/arms" component={ArmsRegistry} />
          <Route path="/tasks" component={TasksRouter} />
          <Route path="/signals" component={SignalsIngestion} />
          <Route path="/memory" component={MemoryGate} />
          <Route path="/resonance" component={ResonanceFields} />
          <Route path="/adapters" component={Adapters} />
          <Route path="/hologram" component={Hologram} />
          <Route path="/operations" component={Operations} />
          <Route path="/logs" component={ExecutionLog} />
          <Route component={NotFound} />
        </Switch>
      </Suspense>
    </Shell>
  );
}

function Gate() {
  const { session, loading } = useAuth();

  if (loading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground font-mono text-xs uppercase tracking-widest">
        Connecting…
      </div>
    );
  }

  // No auth configured server-side → fully open demo mode.
  if (!session.authConfigured) {
    return <Router />;
  }

  // Auth configured but not signed in → show login screen.
  if (!session.role) {
    return <LoginScreen />;
  }

  return <Router />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AuthRefreshBridge />
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Gate />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
