"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import CrowdingStrip from "@/components/CrowdingStrip";
import DelayRangeBar from "@/components/DelayRangeBar";
import type { StatusResponse } from "@/lib/types";

// Leaflet touches `window` at module load time, which crashes during
// Next.js's server-side render pass. `ssr: false` defers it to the client
// entirely — the one Next.js-specific wrinkle a plain Vite SPA didn't have.
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

const POLL_MS = 15_000;

// Offline fallback (PS2_README §2.6: "no signal underground... cache the
// current journey... or say plainly that it is stale"). This does both:
// the last successful response is cached here, and shown with an explicit
// staleness label when a fetch fails rather than going blank.
const CACHE_KEY = "ps2-last-status";

function saveToCache(status: StatusResponse) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ status, savedAt: new Date().toISOString() }));
  } catch {
    // private browsing / storage disabled — offline fallback just won't be available
  }
}

function loadFromCache(): { status: StatusResponse; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}

export default function Page() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staleSince, setStaleSince] = useState<string | null>(null);
  // Demo-only: lets the offline path be shown without physically killing the
  // phone's network mid-demo. Labelled in the UI just like the mock
  // disruption injectors.
  const [simulateOffline, setSimulateOffline] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((err) => {
        console.warn("Service worker registration failed:", err);
      });
    }
  }, []);

  const fallBackToCache = useCallback((err: unknown) => {
    const cached = loadFromCache();
    if (cached) {
      setStatus(cached.status);
      setStaleSince(cached.savedAt);
      setError(null);
    } else {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const refresh = useCallback(async () => {
    if (simulateOffline) {
      fallBackToCache(new Error("Signal simulated offline"));
      return;
    }
    try {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data: StatusResponse = await res.json();
      setStatus(data);
      setStaleSince(null);
      setError(null);
      saveToCache(data);
    } catch (err) {
      // Network failed — likely underground. Fall back to the last cached
      // journey instead of a blank/error screen.
      fallBackToCache(err);
    }
  }, [simulateOffline, fallBackToCache]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const inject = async (severity: 1 | 2) => {
    await fetch("/api/mock/inject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        severity,
        stationCodes: ["EW6", "EW7"],
        freeMRTShuttle: severity === 2 ? "EW6-EW7" : undefined,
        // Phrasing matches LTA's real notice format (verified against
        // LTA_DataMall_API_User_Guide.pdf Annex C) so the demo actually
        // exercises the regex delay-extractor, not the status fallback.
        message:
          severity === 2
            ? "Additional travelling time of 30 minutes between Kembangan and Eunos stations towards Raffles Place due to a signal fault."
            : "Additional travelling time of 8 minutes between Kembangan and Eunos stations due to a signal fault.",
      }),
    });
    refresh();
  };

  const clearMock = async () => {
    await fetch("/api/mock/clear", { method: "POST" });
    refresh();
  };

  if (error && !status) {
    return (
      <div className="screen calm">
        <p className="headline">Can&apos;t reach the server</p>
        <p className="subtext">{error}</p>
        <p className="subtext" style={{ fontSize: "0.8rem", marginTop: 12 }}>
          No cached journey to fall back on yet — this only happens on a first
          visit with no signal.
        </p>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="screen calm">
        <p className="subtext">Loading…</p>
      </div>
    );
  }

  const { decision, journey, source, stats, crowding, crowdingBaseline, liveFeed } = status;

  return (
    <div className={`screen ${decision.interrupt ? "alert" : "calm"}`}>
      <div className="app-header">
        Commuter Companion for Rachel · Tampines → Raffles Place, EWL
      </div>
      {/* Always-present live region: announces a disruption to screen-reader
          users the moment the decision flips, without changing the layout.
          Stays quiet on normal days (constant text = no re-announcement),
          which is the whole point of Rachel's persona. */}
      <p className="sr-only" role="status" aria-live="polite">
        {decision.interrupt ? decision.message : "Normal service — no action needed."}
      </p>
      {staleSince && (
        <div className="stale-banner" role="status">
          Signal lost — showing your update from {minutesAgo(staleSince)} min ago
        </div>
      )}
      {/* The server itself couldn't reach the real LTA feed on its last poll
          (e.g. no/invalid DATAMALL_ACCOUNT_KEY) and fell back to an empty
          "no disruption" feed — that fallback is otherwise indistinguishable
          from a genuinely calm day. Only meaningful outside a mock demo:
          state.ts always reports liveFeed.lastPollError as null while a mock
          disruption is active. */}
      {liveFeed.lastPollError && (
        <div className="feed-error-banner" role="status" title={liveFeed.lastPollError}>
          Can&apos;t reach the live LTA feed — this is not a confirmed &quot;no
          disruption,&quot; just no data
        </div>
      )}
      <div className={`status-card${decision.interrupt ? "" : " calm-variant"}`}>
        {decision.interrupt && source === "mock" && (
          <span className="demo-tag">Simulated disruption — demo only</span>
        )}
        {decision.interrupt ? (
          <>
            <span className="kicker">This crosses her buffer — here&apos;s what to do</span>
            <h1 className="action">{decision.message}</h1>
            <p className="meta">
              Leave home {journey.departAt} → desk by {journey.arriveByDeadline} · slack was{" "}
              {decision.slackMinutes} min
            </p>
            <p className="meta">
              {decision.delaySource === "message-text"
                ? "Delay read from the notice text"
                : decision.delaySource === "llm-advice"
                  ? "No duration stated — estimated by AI from the notice's context"
                  : "Notice didn't state a duration — used a fallback estimate"}
            </p>
          </>
        ) : (
          <>
            <span className="kicker">Silent by design — nothing needs her attention</span>
            <h1 className="action">Good morning, Rachel</h1>
            <p className="meta">{decision.message}</p>
            <p className="meta">
              She has {decision.slackMinutes} min of buffer today — this app only speaks up if a
              delay would eat into that.
            </p>
            <p className="meta">
              Checked {stats.totalChecks}× today · interrupted {stats.interruptsFired}×
            </p>
          </>
        )}
        {decision.predictedDelayRange && (
          <DelayRangeBar
            low={decision.predictedDelayRange.low}
            high={decision.predictedDelayRange.high}
            point={decision.predictedDelayMinutes}
          />
        )}
        <CrowdingStrip stations={journey.stations} crowding={crowding} crowdingBaseline={crowdingBaseline} />
      </div>
      <div className="map-wrap">
        <MapView
          stations={journey.stations}
          affectedStationCodes={decision.affectedStationCodes}
          commitStationCode={decision.commitStation?.code}
          walk={journey.walk}
        />
      </div>
      <DemoPanel
        onInject={inject}
        onClear={clearMock}
        source={source}
        simulateOffline={simulateOffline}
        onToggleOffline={() => setSimulateOffline((v) => !v)}
      />
    </div>
  );
}

function DemoPanel({
  onInject,
  onClear,
  source,
  simulateOffline,
  onToggleOffline,
}: {
  onInject: (severity: 1 | 2) => void;
  onClear: () => void;
  source: "live" | "mock";
  simulateOffline: boolean;
  onToggleOffline: () => void;
}) {
  return (
    <div className="demo-panel">
      <p className="demo-panel-label">
        Testing controls — the real app runs on live data alone, no buttons needed
      </p>
      <div className="demo-panel-buttons">
        <button onClick={() => onInject(1)}>Inject minor delay</button>
        <button className="primary" onClick={() => onInject(2)}>
          Inject major disruption
        </button>
        {source === "mock" && <button onClick={onClear}>Clear</button>}
        <button onClick={onToggleOffline}>
          {simulateOffline ? "Restore signal" : "Simulate signal loss"}
        </button>
      </div>
    </div>
  );
}
