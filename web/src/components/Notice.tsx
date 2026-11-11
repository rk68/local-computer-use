type Props = { message: string; onDismiss: () => void };

export function Notice({ message, onDismiss }: Props) {
  const connectionIssue = /connection.*interrupt|cannot reach|failed to fetch|networkerror|network error/i.test(message);
  return <div className="error app-notice" role="alert">
    <span className="notice-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="8" /><path d="M12 7.5v5" strokeLinecap="round" /><circle cx="12" cy="16" r=".75" fill="currentColor" stroke="none" /></svg></span>
    <div className="notice-copy"><strong>{connectionIssue ? 'Connection interrupted' : 'Something needs attention'}</strong><p>{message}</p></div>
    <button className="icon-button notice-dismiss" aria-label="Dismiss notice" title="Dismiss notice" onClick={onDismiss}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" strokeLinecap="round" /></svg></button>
  </div>;
}
