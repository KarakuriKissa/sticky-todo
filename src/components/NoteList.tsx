import { useAppStore } from '../store/appStore';
interface Props {
  onNew: () => void;
}

export function NoteList({ onNew }: Props) {
  const { filteredNotes, openNote, deleteNote, categories } = useAppStore();
  const notes = filteredNotes();

  const catName = (id: string | null) => {
    if (!id) return '';
    return categories.find((c) => c.id === id)?.name ?? '';
  };

  return (
    <div className="note-list">
      {notes.length === 0 && (
        <div className="note-list-empty">
          <p>付箋がありません</p>
          <button className="btn-primary" onClick={onNew}>＋ 新規作成</button>
        </div>
      )}
      {notes.map((note) => (
        <div
          key={note.id}
          className="note-card"
          style={{ borderLeft: `4px solid ${note.color}` }}
          onDoubleClick={() => openNote(note)}
        >
          <div className="note-card-title">{note.title || '（無題）'}</div>
          <div className="note-card-meta">
            {catName(note.category_id) && (
              <span className="note-card-cat">{catName(note.category_id)}</span>
            )}
            <span className="note-card-date">
              {new Date(note.updated_at).toLocaleDateString('ja-JP')}
            </span>
          </div>
          <button
            className="note-card-del"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm(`「${note.title}」を削除しますか？`)) deleteNote(note.id);
            }}
            title="削除"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
