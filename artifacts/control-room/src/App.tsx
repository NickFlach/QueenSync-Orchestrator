import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ControlRoom } from "@/pages/control-room";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ControlRoom />
    </QueryClientProvider>
  );
}

export default App;
