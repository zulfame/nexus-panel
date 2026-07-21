import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import "@/App.css";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { BrandingProvider } from "@/context/BrandingContext";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Projects from "@/pages/Projects";
import AddProject from "@/pages/AddProject";
import ProjectDetail from "@/pages/ProjectDetail";
import TerminalPage from "@/pages/TerminalPage";
import Settings from "@/pages/Settings";
import Activity from "@/pages/Activity";
import DesignSystem from "@/pages/DesignSystem";

function Protected({ children }) {
  const { user } = useAuth();
  if (user === null)
    return (
      <div className="flex min-h-screen items-center justify-center bg-background font-mono text-sm text-muted-foreground">
        initializing…
      </div>
    );
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/projects" element={<Protected><Projects /></Protected>} />
      <Route path="/projects/new" element={<Protected><AddProject /></Protected>} />
      <Route path="/projects/:id" element={<Protected><ProjectDetail /></Protected>} />
      <Route path="/terminal" element={<Protected><TerminalPage /></Protected>} />
      <Route path="/activity" element={<Protected><Activity /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/design-system" element={<Protected><DesignSystem /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <BrandingProvider>
          <AuthProvider>
            <AppRoutes />
            <Toaster theme="dark" position="bottom-right" />
          </AuthProvider>
        </BrandingProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
