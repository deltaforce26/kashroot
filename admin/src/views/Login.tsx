import { useState, type FormEvent } from "react";

interface LoginProps {
  message: string | null;
  onSubmit: (token: string) => void;
}

/**
 * Token gate. The token is written to sessionStorage and never displayed or
 * logged after entry (password-type input, cleared on submit).
 */
export function Login({ message, onSubmit }: LoginProps) {
  const [token, setTokenValue] = useState("");
  const [validation, setValidation] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) {
      setValidation("Enter your moderator API token.");
      return;
    }
    setTokenValue("");
    onSubmit(trimmed);
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={handleSubmit}>
        <h1>Kashroot Moderation Console</h1>
        <p className="muted">Internal tool. Sign in with your moderator API token.</p>
        {message && (
          <p className="field-error" role="alert">
            {message}
          </p>
        )}
        <label className="note-label">
          Moderator API token
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setTokenValue(e.target.value)}
            autoFocus
          />
        </label>
        {validation && <p className="field-error">{validation}</p>}
        <button type="submit">Sign in</button>
      </form>
    </div>
  );
}
