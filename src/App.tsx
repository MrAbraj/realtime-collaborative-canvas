import { useState, type FormEvent } from "react";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { ConnectionStats } from "./components/connection-stats/ConnectionStats";
import { JoinRoomDialog } from "./components/join-room-dialog/JoinRoomDialog";
import { ParticipantList } from "./components/participant-list/ParticipantList";
import { RemoteCursors } from "./components/remote-cursors/RemoteCursors";
import { useCollaboration } from "./collaboration/useCollaboration";
import styles from "./App.module.css";

const serverUrl =
  import.meta.env.VITE_WEBTRANSPORT_SERVER_URL ?? "https://localhost:4433";

export const App = () => {
  const [roomForm, setRoomForm] = useState({
    roomName: "test",
    userName: "Anonymous",
  });
  const [connection, setConnection] = useState<{
    roomName: string;
    userName: string;
  } | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const collaboration = useCollaboration(serverUrl, connection);

  const submitRoom = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const roomName = roomForm.roomName.trim();
    const userName = roomForm.userName.trim();
    if (roomName && userName) setConnection({ roomName, userName });
  };

  return (
    <div className={styles.container}>
      <RemoteCursors
        cursors={collaboration.remoteCursors}
        participants={collaboration.participants}
        api={collaboration.canvasApi}
      />
      {connection && Object.keys(collaboration.participants).length > 0 && (
        <ParticipantList
          participants={collaboration.participants}
          open={participantsOpen}
          onToggle={() => setParticipantsOpen((open) => !open)}
        />
      )}
      {collaboration.connectionError && (
        <div className={styles.connectionError}>
          {collaboration.connectionError}
        </div>
      )}
      <Excalidraw
        isCollaborating
        onChange={collaboration.onChange}
        onPointerUpdate={collaboration.onPointerUpdate}
        excalidrawAPI={collaboration.setCanvasApi}
      />
      {connection && <ConnectionStats metrics={collaboration.metrics} />}
      {!connection && (
        <JoinRoomDialog
          roomName={roomForm.roomName}
          userName={roomForm.userName}
          onRoomNameChange={(roomName) =>
            setRoomForm((current) => ({ ...current, roomName }))
          }
          onUserNameChange={(userName) =>
            setRoomForm((current) => ({ ...current, userName }))
          }
          onSubmit={submitRoom}
        />
      )}
    </div>
  );
};
