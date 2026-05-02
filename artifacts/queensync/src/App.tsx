import { useEffect } from "react";
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

import Overview from "@/pages/overview";
import ArmsRegistry from "@/pages/arms";
import TasksRouter from "@/pages/tasks";
import SignalsIngestion from "@/pages/signals";
import MemoryGate from "@/pages/memory";
import ResonanceFields from "@/pages/resonance";
import Adapters from "@/pages/adapters";
import Hologram from "@/pages/hologram";
import ExecutionLog from "@/pages/logs";
import Operations from "@/pages/operations";
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

function Router() {
  return (
    <Shell>
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
