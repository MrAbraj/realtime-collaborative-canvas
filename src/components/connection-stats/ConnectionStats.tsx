import { useEffect, useState } from "react";
import styles from "./ConnectionStats.module.css";
import type { ConnectionMetrics } from "../../collaboration/types";

interface ConnectionStatsProps {
  metrics: ConnectionMetrics;
}

interface MetricProps {
  label: string;
  value: string | number;
  valueColor?: string;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getThrottlingStatus = (lagMs: number) => {
  if (lagMs > 30) {
    return {
      label: `Heavy (${lagMs.toFixed(0)}ms)`,
      className: styles.statusError,
    };
  }

  if (lagMs > 10) {
    return {
      label: `Moderate (${lagMs.toFixed(0)}ms)`,
      className: styles.statusWarning,
    };
  }

  return {
    label: `None (${lagMs.toFixed(1)}ms)`,
    className: styles.statusConnected,
  };
};

const getStatusClass = (state: ConnectionMetrics["state"]) => {
  if (state === "connected") {
    return styles.statusConnected;
  }

  if (state === "error") {
    return styles.statusError;
  }

  return styles.statusWarning;
};

const Metric = (props: MetricProps) => {
  const { label, value, valueColor } = props;
  return (
    <div className={styles.metric}>
      <span className={styles.metricLabel}>{label}</span>
      <strong
        className={styles.metricValue}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </strong>
    </div>
  );
};

export const ConnectionStats = ({ metrics }: ConnectionStatsProps) => {
  const [currentTime, setCurrentTime] = useState(() => performance.now());
  const [mainThreadLagMs, setMainThreadLagMs] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTime(performance.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let animationFrameId: number;
    let lastTick = performance.now();

    const checkThreadLag = () => {
      const currentTick = performance.now();
      const delta = currentTick - lastTick;
      const lag = Math.max(0, delta - 16.67);

      setMainThreadLagMs((previous) => previous * 0.8 + lag * 0.2);

      lastTick = currentTick;
      animationFrameId = requestAnimationFrame(checkThreadLag);
    };

    animationFrameId = requestAnimationFrame(checkThreadLag);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  const elapsedSeconds = metrics.startedAt
    ? Math.max((currentTime - metrics.startedAt) / 1000, 0.001)
    : 0;

  const totalBytes = metrics.bytesSent + metrics.bytesReceived;

  const throughput = metrics.startedAt
    ? `${formatBytes(totalBytes / elapsedSeconds)}/s`
    : "-";

  const throttling = getThrottlingStatus(mainThreadLagMs);
  const statusClass = getStatusClass(metrics.state);

  return (
    <details className={styles.panel}>
      <summary className={`${styles.summary} ${statusClass}`}>
        WebTransport: {metrics.state.toUpperCase()}
      </summary>

      <div className={styles.content}>
        <Metric label="Throughput" value={throughput} />

        <Metric
          label="Bytes Out / In"
          value={`${formatBytes(metrics.bytesSent)} / ${formatBytes(
            metrics.bytesReceived,
          )}`}
        />

        <hr className={styles.divider} />

        <Metric
          label="Datagram Bytes"
          value={formatBytes(metrics.datagramBytesReceived)}
        />

        <Metric
          label="Stream Bytes"
          value={formatBytes(metrics.eventStreamBytesReceived)}
        />

        <hr className={styles.divider} />

        <Metric
          label="Scene Apply Latency"
          value={
            metrics.lastSceneApplyMs === null
              ? "-"
              : `${metrics.lastSceneApplyMs.toFixed(1)} ms`
          }
        />

        <Metric
          label="Max Scene Apply"
          value={`${metrics.maxSceneApplyMs.toFixed(1)} ms`}
        />

        <hr className={styles.divider} />

        <Metric label="Signals Received" value={metrics.eventsReceived} />

        <Metric label="Scene Redraws" value={metrics.sceneUpdatesApplied} />

        <Metric
          label="Thread Throttling"
          value={throttling.label}
          valueColor={undefined}
        />

        {metrics.invalidMessages > 0 && (
          <div className={styles.invalidMessage}>
            <Metric
              label="Invalid Messages"
              value={metrics.invalidMessages}
              valueColor="#e45756"
            />
          </div>
        )}
      </div>
    </details>
  );
};
