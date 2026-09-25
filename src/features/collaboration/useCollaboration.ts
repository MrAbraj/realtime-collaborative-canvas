import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { type ConnectionMetrics } from "../../components/ConnectionStats";
import {
  connectToRoom,
  type CursorUpdate,
  type GenericElement,
  type ParticipantMetadata,
  type RoomEvent,
  type RoomTransport,
  type TransportMetric,
} from "../../services/webTransport";
import type { CanvasApi, ConnectionDetails, CursorMarker, Participant } from "./types";

const defaultUserName = "Anonymous";
const cursorColors = ["#e45756", "#3a86ff", "#2a9d8f", "#f4a261", "#9b5de5", "#00b4d8"];

function colorForUser(userId: string) {
  let hash = 0;
  for (const character of userId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return cursorColors[hash % cursorColors.length];
}

function randomColor() {
  return cursorColors[Math.floor(Math.random() * cursorColors.length)];
}

function initialMetrics(): ConnectionMetrics {
  return { state: "idle", startedAt: null, bytesSent: 0, bytesReceived: 0, eventStreamBytesReceived: 0, datagramBytesReceived: 0, eventsReceived: 0, remoteElementsReceived: 0, eventsHandled: 0, sceneUpdatesApplied: 0, invalidMessages: 0, coalescedUpdates: 0, lastDispatchMs: null, maxDispatchMs: 0, lastSceneApplyMs: null, maxSceneApplyMs: 0, lastActivityAt: null };
}

export function useCollaboration(serverUrl: string, connection: ConnectionDetails | null) {
  const [localColor] = useState(randomColor);
  const [participants, setParticipants] = useState<Record<string, Participant>>({});
  const [metrics, setMetrics] = useState(initialMetrics);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [canvasApi, setCanvasApi] = useState<CanvasApi | null>(null);
  const canvasApiRef = useRef<CanvasApi | null>(null);
  const [remoteCursors, setRemoteCursors] = useState<Record<string, CursorMarker>>({});
  const metricsRef = useRef(metrics);
  const metricsFrame = useRef<number | null>(null);
  const transportRef = useRef<RoomTransport | null>(null);
  const sentVersions = useRef(new Map<string, number>());
  const remoteQueue = useRef<GenericElement[]>([]);
  const remoteFrame = useRef<number | null>(null);
  const localUserId = useRef<string | null>(null);
  const localPointerDown = useRef(false);
  const incomingUpdate = useRef(false);
  const pendingRemoteIds = useRef(new Set<string>());
  const cursorQueue = useRef(new Map<string, CursorMarker>());
  const cursorFrame = useRef<number | null>(null);

  const updateMetrics = useCallback((update: (current: ConnectionMetrics) => ConnectionMetrics) => {
    const next = update(metricsRef.current);
    metricsRef.current = next;
    setMetrics(next);
  }, []);

  const recordMetric = useCallback((metric: TransportMetric) => {
    const next = { ...metricsRef.current, lastActivityAt: Date.now() };
    if (metric.type === "bytesSent") next.bytesSent += metric.bytes;
    if (metric.type === "bytesReceived") next.bytesReceived += metric.bytes;
    if (metric.type === "eventStreamBytes") next.eventStreamBytesReceived += metric.bytes;
    if (metric.type === "datagramBytes") next.datagramBytesReceived += metric.bytes;
    if (metric.type === "eventReceived") next.eventsReceived += 1;
    if (metric.type === "remoteElementReceived") next.remoteElementsReceived += 1;
    if (metric.type === "eventHandled") next.eventsHandled += 1;
    if (metric.type === "invalidMessage") next.invalidMessages += 1;
    if (metric.type === "dispatch") {
      next.lastDispatchMs = metric.durationMs;
      next.maxDispatchMs = Math.max(next.maxDispatchMs, metric.durationMs);
    }
    if (metric.type === "sceneApplied") {
      next.sceneUpdatesApplied += 1;
      next.lastSceneApplyMs = metric.durationMs;
      next.maxSceneApplyMs = Math.max(next.maxSceneApplyMs, metric.durationMs);
    }
    metricsRef.current = next;
    if (metricsFrame.current === null) {
      metricsFrame.current = requestAnimationFrame(() => {
        metricsFrame.current = null;
        setMetrics(metricsRef.current);
      });
    }
  }, []);

  const addParticipant = useCallback((metadata: ParticipantMetadata) => {
    setParticipants((current) => ({
      ...current,
      [metadata.user_id]: {
        userId: metadata.user_id,
        name: metadata.user_name || defaultUserName,
        avatar: metadata.avatar ?? metadata.user_name?.charAt(0).toUpperCase() ?? "A",
        color: metadata.color ?? randomColor(),
      },
    }));
  }, []);

  const applyRemoteElements = useCallback(() => {
    if (localPointerDown.current || remoteFrame.current !== null) return;
    remoteFrame.current = requestAnimationFrame(() => {
      remoteFrame.current = null;
      if (localPointerDown.current) return;
      const api = canvasApiRef.current;
      const elements = remoteQueue.current.splice(0);
      if (!api || elements.length === 0) return;
      const next = new Map(api.getSceneElementsIncludingDeleted().map((element) => [element.id, element]));
      for (const element of elements) {
        const current = next.get(element.id);
        if (current && current.version > element.version) continue;
        next.set(element.id, element);
        pendingRemoteIds.current.add(element.id);
      }
      const startedAt = performance.now();
      incomingUpdate.current = true;
      api.updateScene({ elements: [...next.values()], captureUpdate: CaptureUpdateAction.NEVER });
      void Promise.resolve().then(() => { incomingUpdate.current = false; });
      recordMetric({ type: "sceneApplied", durationMs: performance.now() - startedAt });
    });
  }, [recordMetric]);

  const queueRemoteElement = useCallback((element: GenericElement) => {
    remoteQueue.current.push(element);
    applyRemoteElements();
  }, [applyRemoteElements]);

  useEffect(() => {
    if (!connection) return;
    let active = true;
    void connectToRoom(
      `${serverUrl.replace(/\/$/, "")}/rooms/${encodeURIComponent(connection.roomName)}`,
      connection.userName,
      connection.userName.charAt(0).toUpperCase(),
      localColor,
      (snapshot) => {
        localUserId.current = snapshot.user_id;
        addParticipant({ user_id: snapshot.user_id, user_name: connection.userName, avatar: connection.userName.charAt(0).toUpperCase(), color: localColor });
        for (const element of snapshot.elements) sentVersions.current.set(element.id, element.version);
        if (canvasApiRef.current) {
          for (const element of snapshot.elements) pendingRemoteIds.current.add(element.id);
          incomingUpdate.current = true;
          canvasApiRef.current.updateScene({ elements: snapshot.elements, captureUpdate: CaptureUpdateAction.NEVER });
          void Promise.resolve().then(() => { incomingUpdate.current = false; });
        }
      },
      (event: RoomEvent) => {
        if ("UserJoined" in event) return addParticipant(event.UserJoined);
        if ("UserLeft" in event) {
          setParticipants((current) => { const next = { ...current }; delete next[event.UserLeft.user_id]; return next; });
          setRemoteCursors((current) => { const next = { ...current }; delete next[event.UserLeft.user_id]; return next; });
          return;
        }
        const { element, user_id: senderUserId } = event.ElementUpdated;
        if (senderUserId === localUserId.current) return;
        const current = canvasApiRef.current?.getSceneElementsIncludingDeleted().find((item) => item.id === element.id);
        if (current && current.version > element.version) return;
        sentVersions.current.set(element.id, Math.max(sentVersions.current.get(element.id) ?? -1, element.version));
        queueRemoteElement(element);
      },
      (cursor: CursorUpdate) => {
        if (cursor.user_id === localUserId.current) return;
        if (cursorQueue.current.has(cursor.user_id)) updateMetrics((current) => ({ ...current, coalescedUpdates: current.coalescedUpdates + 1 }));
        cursorQueue.current.set(cursor.user_id, { ...cursor, color: colorForUser(cursor.user_id), lastSeen: Date.now() });
        if (cursorFrame.current === null) {
          cursorFrame.current = requestAnimationFrame(() => {
            cursorFrame.current = null;
            const next = Object.fromEntries(cursorQueue.current);
            cursorQueue.current.clear();
            setRemoteCursors((current) => ({ ...current, ...next }));
          });
        }
      },
      (error) => { updateMetrics((current) => ({ ...current, state: "error" })); if (active) setConnectionError(error instanceof Error ? error.message : "WebTransport connection failed"); },
      recordMetric,
    ).then((transport) => { if (active) { transportRef.current = transport; updateMetrics((current) => ({ ...current, state: "connected" })); } else transport.close(); })
      .catch((error: unknown) => { updateMetrics((current) => ({ ...current, state: "error" })); if (active) setConnectionError(error instanceof Error ? error.message : "Unable to connect to the room"); });

    return () => {
      active = false;
      transportRef.current?.close();
      transportRef.current = null;
      if (remoteFrame.current !== null) cancelAnimationFrame(remoteFrame.current);
      if (cursorFrame.current !== null) cancelAnimationFrame(cursorFrame.current);
    };
  }, [addParticipant, applyRemoteElements, connection, localColor, queueRemoteElement, recordMetric, serverUrl, updateMetrics]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - 5000;
      setRemoteCursors((current) => Object.fromEntries(Object.entries(current).filter(([, cursor]) => cursor.lastSeen >= cutoff)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const onChange = useCallback((elements: readonly OrderedExcalidrawElement[]) => {
    if (incomingUpdate.current) return;
    for (const element of elements) {
      if (pendingRemoteIds.current.has(element.id)) continue;
      if (sentVersions.current.get(element.id) === element.version) continue;
      sentVersions.current.set(element.id, element.version);
      void transportRef.current?.sendElement(element as GenericElement);
    }
  }, []);

  const onPointerUpdate = useCallback((payload: { pointer: { x: number; y: number }; button: "down" | "up" }) => {
    if (payload.button === "down") pendingRemoteIds.current.clear();
    localPointerDown.current = payload.button === "down";
    void transportRef.current?.sendCursor(payload.pointer.x, payload.pointer.y);
    if (payload.button === "up") applyRemoteElements();
  }, [applyRemoteElements]);

  const setCanvas = useCallback((api: CanvasApi) => {
    canvasApiRef.current = api;
    setCanvasApi(api);
  }, []);

  return { metrics, connectionError, participants, remoteCursors, canvasApi, setCanvasApi: setCanvas, onChange, onPointerUpdate };
}
