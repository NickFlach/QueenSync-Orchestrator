import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import ExecutionLog from "@/pages/logs";

const queryClient = new QueryClient();

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
        <Route path="/logs" component={ExecutionLog} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
