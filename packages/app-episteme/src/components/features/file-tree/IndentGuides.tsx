interface IndentGuidesProps {
  depth: number;
}

export function IndentGuides({ depth }: IndentGuidesProps) {
  return (
    <>
      {Array.from({ length: depth }, (_, i) => (
        <span key={i} className="file-tree-guide-line" />
      ))}
    </>
  );
}
