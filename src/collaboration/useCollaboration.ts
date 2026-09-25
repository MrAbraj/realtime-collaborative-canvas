import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type {
  ConnectionDetails,
  ConnectionMetrics,
  Participant,
} from "./types";
import type {
  GenericElement,
  ParticipantMetadata,
  RoomEvent,
  RoomTransport,
  TransportMetric,
} from "../webtransport/types";
import { connectToRoom } from "../webtransport/client";
import { cursorColors, useRemoteSync } from "./useRemoteSync";

const defaultUserName = "Anonymous";

const createMetrics = (): ConnectionMetrics => {
  return {
    state: "idle",
    startedAt: null,
    bytesSent: 0,
    bytesReceived: 0,
    eventStreamBytesReceived: 0,
    datagramBytesReceived: 0,
    eventsReceived: 0,
    invalidMessages: 0,
    sceneUpdatesApplied: 0,
    lastSceneApplyMs: null,
    maxSceneApplyMs: 0,
  };
};

const randomColor = () => {
  return cursorColors[Math.floor(Math.random() * cursorColors.length)];
};

export const useCollaboration = (
  serverUrl: string,
  connection: ConnectionDetails | null,
) => {
  const [localColor] = useState(randomColor);
  const [participants, setParticipants] = useState<Record<string, Participant>>(
    {},
  );
  const [metrics, setMetrics] = useState(createMetrics);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [canvasApi, setCanvasApiState] =
    useState<ExcalidrawImperativeAPI | null>(null);

  const canvasApiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const transportRef = useRef<RoomTransport | null>(null);
  const metricsRef = useRef(metrics);

  const localUserIdRef = useRef<string | null>(null);
  const localPointerDownRef = useRef(false);
  const incomingUpdateRef = useRef(false);

  const updateMetrics = useCallback(
    (update: (current: ConnectionMetrics) => ConnectionMetrics) => {
      const next = update(metricsRef.current);

      metricsRef.current = next;
      setMetrics(next);
    },
    [],
  );

  const recordMetric = useCallback(
    (metric: TransportMetric) => {
      updateMetrics((current) => {
        const next = {
          ...current,
        };

        switch (metric.type) {
          case "bytesSent":
            next.bytesSent += metric.bytes;
            break;

          case "bytesReceived":
            next.bytesReceived += metric.bytes;
            break;

          case "eventStreamBytes":
            next.eventStreamBytesReceived += metric.bytes;
            break;

          case "datagramBytes":
            next.datagramBytesReceived += metric.bytes;
            break;

          case "eventReceived":
            next.eventsReceived++;
            break;

          case "invalidMessage":
            next.invalidMessages++;
            break;

          case "sceneApplied":
            next.sceneUpdatesApplied++;
            next.lastSceneApplyMs = metric.durationMs;
            next.maxSceneApplyMs = Math.max(
              next.maxSceneApplyMs,
              metric.durationMs,
            );
            break;
        }

        return next;
      });
    },
    [updateMetrics],
  );

  const {
    colorForUser,
    remoteCursors,
    receiveElement,
    receiveCursor,
    applyRemoteElements,
    shouldSendElement,
    receiveRemoteVersion,
    setSnapshotVersions,
    clearPendingRemote,
    isNewerElement,
    removeCursor,
    removeExpiredCursors,
    clear,
  } = useRemoteSync({
    canvasApiRef,
    localUserIdRef,
    localPointerDownRef,
    incomingUpdateRef,
    onSceneApplied: useCallback(
      (durationMs: number) => {
        recordMetric({
          type: "sceneApplied",
          durationMs,
        });
      },
      [recordMetric],
    ),
  });

  const addParticipant = useCallback((metadata: ParticipantMetadata) => {
    setParticipants((current) => ({
      ...current,
      [metadata.user_id]: {
        userId: metadata.user_id,
        name: metadata.user_name || defaultUserName,
        avatar:
          metadata.avatar ?? metadata.user_name?.charAt(0).toUpperCase() ?? "A",
        color: metadata.color ?? colorForUser(metadata.user_id),
      },
    }));
  }, [colorForUser]);

  const removeParticipant = useCallback(
    (userId: string) => {
      setParticipants((current) => {
        const next = { ...current };
        delete next[userId];
        return next;
      });

      removeCursor(userId);
    },
    [removeCursor],
  );

  const handleSnapshot = useCallback(
    (snapshot: { user_id: string; elements: GenericElement[] }) => {
      localUserIdRef.current = snapshot.user_id;

      addParticipant({
        user_id: snapshot.user_id,
        user_name: connection?.userName ?? defaultUserName,
        avatar: connection?.userName?.charAt(0).toUpperCase() ?? "A",
        color: localColor,
      });

      setSnapshotVersions(snapshot.elements);

      const api = canvasApiRef.current;

      if (!api) {
        return;
      }

      incomingUpdateRef.current = true;

      api.updateScene({
        elements: snapshot.elements,
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      queueMicrotask(() => {
        incomingUpdateRef.current = false;
        clearPendingRemote();
      });
    },
    [
      addParticipant,
      connection?.userName,
      localColor,
      setSnapshotVersions,
      clearPendingRemote,
    ],
  );

  const handleRoomEvent = useCallback(
    (event: RoomEvent) => {
      if ("UserJoined" in event) {
        addParticipant(event.UserJoined);
        return;
      }

      if ("UserLeft" in event) {
        removeParticipant(event.UserLeft.user_id);
        return;
      }

      const { element, user_id: senderUserId } = event.ElementUpdated;

      if (senderUserId === localUserIdRef.current) {
        return;
      }

      if (!isNewerElement(element)) {
        return;
      }

      receiveRemoteVersion(element);
      receiveElement(element);
    },
    [
      addParticipant,
      removeParticipant,
      isNewerElement,
      receiveRemoteVersion,
      receiveElement,
    ],
  );

  const handleConnectionError = useCallback(
    (error: unknown) => {
      updateMetrics((current) => ({
        ...current,
        state: "error",
      }));

      setConnectionError(
        error instanceof Error
          ? error.message
          : "WebTransport connection failed",
      );
    },
    [updateMetrics],
  );

  useEffect(() => {
    if (!connection) {
      return;
    }

    let active = true;

    const roomUrl = `${serverUrl.replace(/\/$/, "")}/rooms/${encodeURIComponent(
      connection.roomName,
    )}`;

    updateMetrics((current) => ({
      ...current,
      state: "connecting",
      startedAt: Date.now(),
    }));

    connectToRoom({
      url: roomUrl,
      userName: connection.userName,
      avatar: connection.userName.charAt(0).toUpperCase(),
      color: localColor,
      onSnapshot: handleSnapshot,
      onEvent: handleRoomEvent,
      onCursor: receiveCursor,
      onError: handleConnectionError,
      onMetric: recordMetric,
    })
      .then((transport) => {
        if (!active) {
          transport.close();
          return;
        }

        transportRef.current = transport;

        updateMetrics((current) => ({
          ...current,
          state: "connected",
        }));
      })
      .catch(handleConnectionError);

    return () => {
      active = false;

      transportRef.current?.close();
      transportRef.current = null;

      clear();

      localUserIdRef.current = null;
      localPointerDownRef.current = false;
      incomingUpdateRef.current = false;
    };
  }, [
    connection,
    serverUrl,
    localColor,
    handleSnapshot,
    handleRoomEvent,
    receiveCursor,
    handleConnectionError,
    recordMetric,
    updateMetrics,
    clear,
  ]);

  useEffect(() => {
    const timer = window.setInterval(removeExpiredCursors, 10000);

    return () => {
      window.clearInterval(timer);
    };
  }, [removeExpiredCursors]);

  const onChange = useCallback(
    (elements: readonly OrderedExcalidrawElement[]) => {
      if (incomingUpdateRef.current) {
        return;
      }

      const transport = transportRef.current;

      if (!transport) {
        return;
      }

      for (const element of elements) {
        const genericElement = element as GenericElement;

        if (!shouldSendElement(genericElement)) {
          continue;
        }

        void transport.sendElement(genericElement);
      }
    },
    [shouldSendElement],
  );

  const onPointerUpdate = useCallback(
    (payload: { pointer: { x: number; y: number }; button: "down" | "up" }) => {
      localPointerDownRef.current = payload.button === "down";

      void transportRef.current?.sendCursor(
        payload.pointer.x,
        payload.pointer.y,
      );

      if (payload.button === "up") {
        applyRemoteElements();
      }
    },
    [applyRemoteElements],
  );

  const setCanvasApi = useCallback((api: ExcalidrawImperativeAPI) => {
    canvasApiRef.current = api;
    setCanvasApiState(api);
  }, []);

  return {
    metrics,
    connectionError,
    participants,
    remoteCursors: remoteCursors,
    canvasApi,
    setCanvasApi,
    onChange,
    onPointerUpdate,
  };
};
