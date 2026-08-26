interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function LoadingState() {
  return <p className="state state-loading">טוען…</p>;
}

export function EmptyState({ message }: { message: string }) {
  return <p className="state state-empty">{message}</p>;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="state state-error" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          נסה שוב
        </button>
      )}
    </div>
  );
}
