import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { CursorMarker, Participant } from "../../collaboration/types";
import styles from "./RemoteCursors.module.css";

interface RemoteCursorsProps {
  cursors: Record<string, CursorMarker>;
  participants: Record<string, Participant>;
  api: ExcalidrawImperativeAPI | null;
}

export const RemoteCursors = (props: RemoteCursorsProps) => {
  const { cursors, participants, api } = props;

  if (!api) {
    return null;
  }

  const { scrollX, scrollY, zoom } = api.getAppState();
  const zoomValue = zoom.value;

  return (
    <div className={styles.overlay}>
      {Object.values(cursors).map((cursor) => {
        const participant = participants[cursor.user_id] ?? {
          userId: cursor.user_id,
          name: cursor.name,
          avatar: cursor.name[0]?.toUpperCase(),
          color: cursor.color,
        };

        const left = (cursor.x + scrollX) * zoomValue;
        const top = (cursor.y + scrollY) * zoomValue;

        return (
          <div
            key={cursor.user_id}
            className={styles.cursor}
            style={{ left, top }}
          >
            <div
              className={styles.pointer}
              style={{ borderTop: `14px solid ${participant.color}` }}
            />

            <div
              className={styles.name}
              style={{ background: participant.color }}
            >
              {participant.name}
            </div>
          </div>
        );
      })}
    </div>
  );
};
