"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReceivedWebhookEvent } from "@/lib/event-store";

type EventsResponse = {
  events: ReceivedWebhookEvent[];
  webhookSecretConfigured: boolean;
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));
}

export default function Home() {
  const [events, setEvents] = useState<ReceivedWebhookEvent[]>([]);
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const refreshEvents = useCallback(async () => {
    try {
      const response = await fetch("/api/events", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(
          response.status === 401
            ? "Dashboard authentication expired. Reload and sign in again."
            : `Could not load events (HTTP ${response.status}).`,
        );
      }

      const result = (await response.json()) as EventsResponse;
      setEvents(result.events);
      setSecretConfigured(result.webhookSecretConfigured);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setEndpoint(`${window.location.origin}/api/webhook`);
    void refreshEvents();
    const interval = window.setInterval(() => void refreshEvents(), 2500);
    return () => window.clearInterval(interval);
  }, [refreshEvents]);

  const eventCount = useMemo(() => events.length.toString().padStart(2, "0"), [events.length]);

  async function copyEndpoint() {
    if (!endpoint) return;
    await navigator.clipboard.writeText(endpoint);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function clearEvents() {
    if (!window.confirm("Clear all captured events from this app instance?")) return;
    const response = await fetch("/api/events", { method: "DELETE" });
    if (!response.ok) {
      setError(`Could not clear events (HTTP ${response.status}).`);
      return;
    }
    await refreshEvents();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Anli Demo Tester home">
          <span className="brand-mark">A</span>
          <span>
            <strong>anli</strong>
            <small>DEMO TESTER</small>
          </span>
        </a>
        <div className="topbar-right">
          <span className="live-dot" />
          LOCAL RECEIVER
          <span className="topbar-divider" />
          <span>WEBHOOK LAB / 01</span>
        </div>
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow"><span /> INTEGRATION WORKSPACE</p>
          <h1>Webhook <em>inbox.</em></h1>
          <p className="hero-description">
            Inspect Anli hotel events as they arrive. Signatures are verified
            before events enter this inbox.
          </p>
        </div>
        <div className="hero-stamp" aria-hidden="true">
          <span>ANLI</span>
          <strong>↗</strong>
        </div>
      </section>

      <section className="setup-card" aria-labelledby="endpoint-title">
        <div className="setup-heading">
          <div className="section-icon">01</div>
          <div>
            <p className="eyebrow">RECEIVER ENDPOINT</p>
            <h2 id="endpoint-title">Point Anli at this inbox</h2>
          </div>
          <span className={`status-pill ${secretConfigured ? "status-ready" : "status-warning"}`}>
            <span />
            {secretConfigured ? "SIGNATURE CHECK ON" : "SECRET NOT CONFIGURED"}
          </span>
        </div>

        <div className="endpoint-row">
          <span className="method-chip">POST</span>
          <code>{endpoint || "Loading endpoint…"}</code>
          <button className="copy-button" onClick={copyEndpoint} disabled={!endpoint}>
            {copied ? "COPIED" : "COPY URL"}
          </button>
        </div>

        <div className="setup-notes">
          <div>
            <span className="note-number">A</span>
            <p>Expose this app through a trusted HTTPS tunnel for Anli to reach it.</p>
          </div>
          <div>
            <span className="note-number">B</span>
            <p>
              Configure the hotel webhook URL above, use <b>POST</b>, and use
              the same secret as <code>ANLI_WEBHOOK_SECRET</code>.
            </p>
          </div>
          <div>
            <span className="note-number">C</span>
            <p>
              Send a test event from Anli. A successful delivery appears here
              with a verified signature.
            </p>
          </div>
        </div>

        {!secretConfigured && (
          <div className="inline-warning">
            Add <code>ANLI_WEBHOOK_SECRET</code> to <code>.env.local</code> and
            restart the app. Signed notifications are rejected until it is set.
          </div>
        )}
      </section>

      <section className="inbox-section" aria-labelledby="inbox-title">
        <div className="inbox-heading">
          <div className="inbox-title-wrap">
            <div className="section-icon">02</div>
            <div>
              <p className="eyebrow">CAPTURED NOTIFICATIONS</p>
              <h2 id="inbox-title">Event inbox <span>{eventCount}</span></h2>
            </div>
          </div>
          <div className="inbox-actions">
            <span className="refresh-indicator"><i /> AUTO-REFRESH 2.5S</span>
            <button className="clear-button" onClick={clearEvents} disabled={events.length === 0}>
              CLEAR INBOX
            </button>
            <button className="icon-button" onClick={() => void refreshEvents()} aria-label="Refresh events">
              ↻
            </button>
          </div>
        </div>

        {error && <div className="error-banner" role="alert">{error}</div>}

        {loading ? (
          <div className="empty-state"><span className="loader" /> Loading inbox…</div>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⌁</div>
            <strong>No events received yet</strong>
            <p>Configure the hotel webhook in Anli, then send a test event.</p>
            <span>Waiting for a signed notification <i /></span>
          </div>
        ) : (
          <div className="event-list">
            {events.map((item) => (
              <details className="event-card" key={item.id}>
                <summary>
                  <span className="event-type">{item.payload.eventType}</span>
                  <span className="event-summary">
                    <strong>Hotel {item.payload.hotelId}</strong>
                    <span>{item.method} · received {formatTime(item.receivedAt)}</span>
                  </span>
                  <span className="verified-badge"><span /> SIGNATURE VERIFIED</span>
                  <span className="expand-mark">+</span>
                </summary>
                <div className="event-details">
                  <div className="event-meta">
                    <span>EVENT TIME <b>{item.payload.timestamp}</b></span>
                    <span>EVENT HEADER <b>{item.payload.event}</b></span>
                    <span>RECEIVED <b>{item.receivedAt}</b></span>
                  </div>
                  <pre>{JSON.stringify(item.payload, null, 2)}</pre>
                </div>
              </details>
            ))}
          </div>
        )}
        <p className="retention-note">
          In-memory demo inbox · up to 100 events · cleared when the server restarts
        </p>
      </section>

      <footer className="footer">
        <span>ANLI INTEGRATION TOOLS</span>
        <span>Events are accepted only after HMAC-SHA256 verification.</span>
      </footer>
    </main>
  );
}
