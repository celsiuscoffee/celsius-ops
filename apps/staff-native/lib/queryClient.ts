import { QueryClient } from "@tanstack/react-query";

// Single app-wide react-query client. Lives in its own module (not inline in
// _layout) so the auth flow can import it and clear() the cache on login/logout,
// otherwise the previous user's cached data (payslips, memos, sales, etc.) keeps
// showing after switching accounts until each query's staleTime expires.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});
