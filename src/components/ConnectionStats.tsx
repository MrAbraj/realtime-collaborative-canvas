import { useEffect, useState, type CSSProperties } from "react";

export type ConnectionMetrics = {
  state: "idle" | "connecting" | "connected" | "error" | "closed";
  startedAt: number | null;
  bytesSent: number;
  bytesReceived: number;
  eventStreamBytesReceived: number;
  datagramBytesReceived: number;
  // Event & Dispatch processing breakdown
  eventsReceived: number;
  eventsHandled: number;
  sceneUpdatesApplied: number;
  coalescedUpdates: number;
  invalidMessages: number;
  // Latencies
  lastSceneApplyMs: number | null;
  maxSceneApplyMs: number;
};

type ConnectionStatsProps = {
  metrics: ConnectionMetrics;
  // Optional callback/transport instance to send ping datagrams
  sendPing?: (pingPayload: { type: "ping"; timestamp: number }) => void;
  // Pass in ping pong response latency calculated externally if available
  networkRttMs?: number | null;
};

const panelStyle: CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 16,
  zIndex: 50,
  width: 260,
  padding: 12,
  border: "1px solid rgba(0, 0, 0, 0.12)",
  borderRadius: 10,
  background: "rgba(255, 255, 255, 0.96)",
  boxShadow: "0 8px 28px rgba(0, 0, 0, 0.14)",
  color: "#333",
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: 12,
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Metric({ label, value, valueColor }: { label: string; value: string | number; valueColor?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "2px 0" }}>
      <span style={{ color: "#666" }}>{label}</span>
      <strong style={{ fontFamily: "monospace", color: valueColor || "#333" }}>{value}</strong>
    </div>
  );
}

export default function ConnectionStats({ metrics }: ConnectionStatsProps) {
  const [now, setNow] = useState(() => performance.now());
  const [mainThreadLagMs, setMainThreadLagMs] = useState(0);

  // 1. Refresh throughput clock
  useEffect(() => {
    const timer = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  // 2. Main Thread Throttling Detector (macrotask lag tracking)
  useEffect(() => {
    let animationFrameId: number;
    let lastTick = performance.now();

    const checkThreadLag = () => {
      const currentTick = performance.now();
      const delta = currentTick - lastTick;
      const lag = Math.max(0, delta - 16.67); // Excess delay above 60fps frame target
      
      setMainThreadLagMs((prev) => prev * 0.8 + lag * 0.2); // Smooth out jitter
      lastTick = currentTick;
      animationFrameId = requestAnimationFrame(checkThreadLag);
    };

    animationFrameId = requestAnimationFrame(checkThreadLag);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  const elapsedSeconds = metrics.startedAt ? Math.max((now - metrics.startedAt) / 1000, 0.001) : 0;
  const totalBytes = metrics.bytesSent + metrics.bytesReceived;
  const throughput = metrics.startedAt ? `${formatBytes(totalBytes / elapsedSeconds)}/s` : "-";

  const statusColor =
    metrics.state === "connected"
      ? "#2a9d8f"
      : metrics.state === "error"
      ? "#e45756"
      : "#f4a261";

  // Classify Thread Throttling
  const getThrottlingStatus = (lagMs: number) => {
    if (lagMs > 30) return { label: `Heavy (${lagMs.toFixed(0)}ms)`, color: "#e45756" };
    if (lagMs > 10) return { label: `Moderate (${lagMs.toFixed(0)}ms)`, color: "#f4a261" };
    return { label: `None (${lagMs.toFixed(1)}ms)`, color: "#2a9d8f" };
  };

  const throttling = getThrottlingStatus(mainThreadLagMs);

  return (
    <details style={panelStyle}>
      <summary style={{ cursor: "pointer", fontWeight: 700, color: statusColor, userSelect: "none" }}>
        WebTransport: {metrics.state.toUpperCase()}
      </summary>

      <div style={{ marginTop: 8 }}>
        {/* Network & Transfer Metrics */}
        <Metric label="Throughput" value={throughput} />
        <Metric label="Bytes Out / In" value={`${formatBytes(metrics.bytesSent)} / ${formatBytes(metrics.bytesReceived)}`} />
        
        <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "6px 0" }} />
        
        {/* Transport Stream Metrics */}
        <Metric label="Datagram Bytes" value={formatBytes(metrics.datagramBytesReceived)} />
        <Metric label="Stream Bytes" value={formatBytes(metrics.eventStreamBytesReceived)} />

        <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "6px 0" }} />

        <Metric
          label="Scene Apply Latency"
          value={metrics.lastSceneApplyMs === null ? "-" : `${metrics.lastSceneApplyMs.toFixed(1)} ms`}
        />
        <Metric label="Max Scene Apply" value={`${metrics.maxSceneApplyMs.toFixed(1)} ms`} />

        <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "6px 0" }} />

        {/* Pipeline & Processing Statistics */}
        <Metric label="Signals Received" value={metrics.eventsReceived} />
        <Metric label="Events Dispatched" value={metrics.eventsHandled} />
        <Metric label="Scene Redraws" value={metrics.sceneUpdatesApplied} />
        <Metric label="Coalesced Cursors" value={metrics.coalescedUpdates} />
        
        {/* Thread Health */}
        <Metric label="Thread Throttling" value={throttling.label} valueColor={throttling.color} />

        {metrics.invalidMessages > 0 && (
          <div style={{ marginTop: 4 }}>
            <Metric label="Invalid Messages" value={metrics.invalidMessages} valueColor="#e45756" />
          </div>
        )}
      </div>
    </details>
  );
}