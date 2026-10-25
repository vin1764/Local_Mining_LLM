// Entry for the static GitHub Pages build (npm run build:pages).
// Renders the same dashboard as the local app; the AI runs in the browser.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "./styles.css";
import { Route } from "./routes/index";

const Dashboard = Route.options.component!;
const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Dashboard />
    </QueryClientProvider>
  </StrictMode>,
);
