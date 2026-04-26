export function StopButton({ onStop }: { onStop: () => void }) {
  return (
    <div className="stop-area">
      <button className="stop-btn" onClick={onStop}>
        ■ Stop
      </button>
    </div>
  );
}
