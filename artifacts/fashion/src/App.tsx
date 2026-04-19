import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Fashion Site</h1>
          <p className="mt-2 text-sm text-gray-600">Your site will appear here once you upload your code.</p>
        </div>
      </div>
    </QueryClientProvider>
  );
}
