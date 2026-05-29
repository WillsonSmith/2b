// Markdown imported as text (Bun's `with { type: "text" }` loader). Used by the
// style-guide starter library to bundle `.md` bodies as strings.
declare module "*.md" {
  const content: string;
  export default content;
}
