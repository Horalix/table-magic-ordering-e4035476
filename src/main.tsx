import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import "./index.css";

// Error monitoring — only active when a DSN is configured, so dev/local runs
// are unaffected.
const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (dsn) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
  });
}

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary
    fallback={
      <div className="min-h-screen bg-background flex items-center justify-center px-6 text-center">
        <div>
          <p className="font-serif text-lg font-semibold text-foreground">Something went wrong</p>
          <p className="text-sm text-muted-foreground font-sans mt-1">Please refresh the page.</p>
          <button onClick={() => window.location.reload()} className="mt-4 rounded-full px-6 h-11 bg-primary text-primary-foreground font-sans font-semibold">
            Reload
          </button>
        </div>
      </div>
    }
  >
    <App />
  </Sentry.ErrorBoundary>,
);
