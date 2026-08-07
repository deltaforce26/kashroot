import { useCallback, useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";

import { clearToken, getToken, setToken, setUnauthorizedHandler } from "./api/client";
import { ToastProvider } from "./components/Toast";
import { AuditLog } from "./views/AuditLog";
import { Expiry } from "./views/Expiry";
import { Flags } from "./views/Flags";
import { Login } from "./views/Login";
import { ReviewQueue } from "./views/ReviewQueue";

export default function App() {
  const [authenticated, setAuthenticated] = useState(() => getToken() !== null);
  const [loginMessage, setLoginMessage] = useState<string | null>(null);

  // Any 401 from any fetch bounces back to the login screen with a message.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setLoginMessage("Session expired or token invalid. Please sign in again.");
      setAuthenticated(false);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const handleLogin = useCallback((token: string) => {
    setToken(token);
    setLoginMessage(null);
    setAuthenticated(true);
  }, []);

  const handleLogout = useCallback(() => {
    clearToken();
    setLoginMessage(null);
    setAuthenticated(false);
  }, []);

  if (!authenticated) {
    return <Login message={loginMessage} onSubmit={handleLogin} />;
  }

  return (
    <ToastProvider>
      <header className="app-header">
        <h1>Kashroot Moderation</h1>
        <nav>
          <NavLink to="/review">Review queue</NavLink>
          <NavLink to="/flags">Flags</NavLink>
          <NavLink to="/expiry">Expiry</NavLink>
          <NavLink to="/audit">Audit log</NavLink>
        </nav>
        <button type="button" className="logout" onClick={handleLogout}>
          Sign out
        </button>
      </header>
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/review" replace />} />
          <Route path="/review" element={<ReviewQueue />} />
          <Route path="/flags" element={<Flags />} />
          <Route path="/expiry" element={<Expiry />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="*" element={<Navigate to="/review" replace />} />
        </Routes>
      </main>
    </ToastProvider>
  );
}
