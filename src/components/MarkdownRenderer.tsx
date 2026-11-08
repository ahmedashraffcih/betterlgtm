import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** The Markdown parser and its plugins, loaded on demand (see `Markdown`). */
export default function MarkdownRenderer({ text }: { text: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>;
}
