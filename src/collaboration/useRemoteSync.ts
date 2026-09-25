import { useCallback, useRef, useState } from "react";
import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import type { CursorMarker } from "./types";
import type { CursorUpdate, GenericElement } from "../webtransport/types";

export const cursorColors = [
  "#e45756",
  "#3a86ff",
  "#2a9d8f",
  "#f4a261",
  "#9b5de5",
  "#00b4d8",
];

export const colorForUser = (userId: string) => {
  let hash = 0;

  for (const character of userId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return cursorColors[hash % cursorColors.length];
};

interface RemoteSyncOptions {
  canvasApiRef: React.RefObject<ExcalidrawImperativeAPI | null>;
  localUserIdRef: React.RefObject<string | null>;
  localPointerDownRef: React.RefObject<boolean>;
  incomingUpdateRef: React.RefObject<boolean>;
  onSceneApplied: (durationMs: number) => void;
}

export const useRemoteSync = (options: RemoteSyncOptions) => {
  const {
    canvasApiRef,
    localUserIdRef,
    localPointerDownRef,
    incomingUpdateRef,
    onSceneApplied,
  } = options;
  const [remoteCursors, setRemoteCursors] = useState<
    Record<string, CursorMarker>
  >({});

  const sentVersions = useRef(new Map<string, number>());
  const pendingRemoteIds = useRef(new Set<string>());

  const remoteQueue = useRef<GenericElement[]>([]);
  const remoteFrame = useRef<number | null>(null);

  const cursorQueue = useRef(new Map<string, CursorMarker>());
  const cursorFrame = useRef<number | null>(null);

  const applyRemoteElements = useCallback(() => {
    if (
      localPointerDownRef.current ||
      remoteFrame.current !== null ||
      remoteQueue.current.length === 0
    ) {
      return;
    }

    remoteFrame.current = requestAnimationFrame(() => {
      remoteFrame.current = null;

      if (localPointerDownRef.current || remoteQueue.current.length === 0) {
        return;
      }

      const api = canvasApiRef.current;

      if (!api) {
        return;
      }

      const elements = remoteQueue.current.splice(0);

      const scene = new Map(
        api
          .getSceneElementsIncludingDeleted()
          .map((element) => [element.id, element]),
      );

      for (const element of elements) {
        const current = scene.get(element.id);

        if (current && current.version > element.version) {
          continue;
        }

        scene.set(element.id, element);
        pendingRemoteIds.current.add(element.id);
      }

      const startedAt = performance.now();

      incomingUpdateRef.current = true;

      api.updateScene({
        elements: [...scene.values()],
        captureUpdate: CaptureUpdateAction.NEVER,
      });

      queueMicrotask(() => {
        incomingUpdateRef.current = false;
        pendingRemoteIds.current.clear();
      });

      onSceneApplied(performance.now() - startedAt);
    });
  }, [canvasApiRef, incomingUpdateRef, localPointerDownRef, onSceneApplied]);

  const receiveElement = useCallback(
    (element: GenericElement) => {
      remoteQueue.current.push(element);
      applyRemoteElements();
    },
    [applyRemoteElements],
  );

  const receiveCursor = useCallback(
    (cursor: CursorUpdate) => {
      if (cursor.user_id === localUserIdRef.current) {
        return;
      }

      cursorQueue.current.set(cursor.user_id, {
        ...cursor,
        name: cursor.name,
        color: colorForUser(cursor.user_id),
        lastSeen: Date.now(),
      });

      if (cursorFrame.current !== null) {
        return;
      }

      cursorFrame.current = requestAnimationFrame(() => {
        cursorFrame.current = null;

        const next = Object.fromEntries(cursorQueue.current);

        cursorQueue.current.clear();

        setRemoteCursors((current) => ({
          ...current,
          ...next,
        }));
      });
    },
    [localUserIdRef],
  );

  const shouldSendElement = useCallback((element: GenericElement) => {
    if (pendingRemoteIds.current.has(element.id)) {
      return false;
    }

    if (sentVersions.current.get(element.id) === element.version) {
      return false;
    }

    sentVersions.current.set(element.id, element.version);

    return true;
  }, []);

  const receiveRemoteVersion = useCallback((element: GenericElement) => {
    sentVersions.current.set(
      element.id,
      Math.max(sentVersions.current.get(element.id) ?? -1, element.version),
    );
  }, []);

  const setSnapshotVersions = useCallback((elements: GenericElement[]) => {
    for (const element of elements) {
      sentVersions.current.set(element.id, element.version);
      pendingRemoteIds.current.add(element.id);
    }
  }, []);

  const clearPendingRemote = useCallback(() => {
    pendingRemoteIds.current.clear();
  }, []);

  const isNewerElement = useCallback(
    (element: GenericElement) => {
      const current = canvasApiRef.current
        ?.getSceneElementsIncludingDeleted()
        .find((item) => item.id === element.id);

      return !current || current.version <= element.version;
    },
    [canvasApiRef],
  );

  const removeCursor = useCallback((userId: string) => {
    cursorQueue.current.delete(userId);

    setRemoteCursors((current) => {
      if (!current[userId]) {
        return current;
      }

      const next = { ...current };
      delete next[userId];

      return next;
    });
  }, []);

  const removeExpiredCursors = useCallback(() => {
    const cutoff = Date.now() - 5000;

    setRemoteCursors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([, cursor]) => cursor.lastSeen >= cutoff,
        ),
      ),
    );
  }, []);

  const clear = useCallback(() => {
    if (remoteFrame.current !== null) {
      cancelAnimationFrame(remoteFrame.current);
      remoteFrame.current = null;
    }

    if (cursorFrame.current !== null) {
      cancelAnimationFrame(cursorFrame.current);
      cursorFrame.current = null;
    }

    remoteQueue.current.length = 0;
    cursorQueue.current.clear();

    sentVersions.current.clear();
    pendingRemoteIds.current.clear();

    setRemoteCursors({});
  }, []);

  return {
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
  };
};
