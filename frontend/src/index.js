import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";

// Benign ResizeObserver notification — swallow so it doesn't trigger the CRA dev error overlay.
const _isRoLoop = (msg) => typeof msg === "string" && msg.includes("ResizeObserver loop");
window.addEventListener("error", (e) => {
  if (_isRoLoop(e.message)) {
    e.stopImmediatePropagation();
    e.preventDefault();
  }
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
