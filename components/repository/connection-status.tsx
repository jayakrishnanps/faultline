export function ConnectionStatus() {
  return (
    <section className="connection-status" aria-labelledby="connection-title">
      <div>
        <h2 id="connection-title">GitHub connection unavailable</h2>
        <p id="connection-description" className="muted">Sign-in and GitHub App connection are not implemented. No account or repository list has been loaded.</p>
      </div>
      <button className="button button-unavailable" type="button" disabled aria-describedby="connection-description">Connect GitHub · unavailable</button>
    </section>
  );
}
