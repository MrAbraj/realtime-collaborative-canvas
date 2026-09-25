import type { Participant } from "../../collaboration/types";
import styles from "./ParticipantList.module.css";

interface ParticipantListProps {
  participants: Record<string, Participant>;
  open: boolean;
  onToggle: () => void;
}

export const ParticipantList = (props: ParticipantListProps) => {
  const { participants, open, onToggle } = props;
  const list = Object.values(participants);

  return (
    <div className={styles.container}>
      <button onClick={onToggle} className={styles.toggleButton}>
        <span className={styles.avatars}>
          {list.slice(0, 3).map((participant) => (
            <span
              key={participant.userId}
              title={participant.name}
              className={styles.avatar}
              style={{ background: participant.color }}
            >
              {participant.name.charAt(0).toUpperCase()}
            </span>
          ))}
        </span>

        <span className={styles.count}>
          {list.length > 3 ? `+${list.length - 3}` : ""}⌄
        </span>
      </button>

      {open && (
        <div className={styles.list}>
          {list.map((participant) => (
            <div key={participant.userId} className={styles.participant}>
              <span
                className={styles.participantAvatar}
                style={{ background: participant.color }}
              >
                {participant.name.charAt(0).toUpperCase()}
              </span>

              <span className={styles.participantName}>{participant.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
