'use client';

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildChatCodeComponents, ChatMarkdownPreviewCard } from '@/components/chat/ChatCodeBlock';
import { isBareOpeningFence } from '@/lib/chat/fencedMarkdown';

interface MessageContentProps {
  content: string;
  compact?: boolean;
  mentionLabels?: Record<string, string> | null;
}

function MentionChip({ children, variant }: { children: React.ReactNode; variant: 'user' | 'special' | 'channel' }) {
  const styles = {
    user: 'bg-[#1d2f4d] text-[#7db3ff] border-[#1e3a5f]',
    special: 'bg-[#3d2e14] text-[#f0c674] border-[#5c4a1f]',
    channel: 'bg-purple-500/15 text-purple-300 border-purple-500/25',
  };
  return (
    <span
      className={`inline rounded px-1 py-px text-[0.92em] font-medium border ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

function classifyMention(part: string): 'user' | 'special' | 'channel' | null {
  if (/^@(here|channel|everyone)$/i.test(part)) return 'special';
  if (/^@[\w][\w.-]*$/.test(part)) return 'user';
  if (/^#[\w-]+$/.test(part)) return 'channel';
  return null;
}

function buildParagraphRenderer(className: string, processMentions = false) {
  // Always use div — react-markdown may nest block code (div/pre) inside paragraph nodes.
  return ({ children }: { children?: React.ReactNode }) => {
    const content = processMentions
      ? React.Children.map(children, (child) =>
          typeof child === "string" ? parseInlineTokens(child) : child,
        )
      : children;

    return <div className={className}>{content}</div>;
  };
}

interface ContentSegment {
  type: "markdown" | "markdownPreview";
  content: string;
}

function parseInlineTokens(text: string): React.ReactNode[] {
  const parts = text.split(/(@[\w][\w.-]*|@[\w-]+|#[\w-]+)/g);
  return parts.map((part, i) => {
    const kind = classifyMention(part);
    if (kind) {
      return (
        <MentionChip key={i} variant={kind}>
          {part}
        </MentionChip>
      );
    }
    return part;
  });
}

function isMarkdownPreviewOpener(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "```markdown" || isBareOpeningFence(line);
}

// Scan forward to find the line index of the closing ``` for a ```markdown block.
// Named code blocks (```python etc.) open a depth level; their closing ``` doesn't
// count as a candidate for the outer fence. Plain ``` at ground level (depth 0) ARE
// candidates — we record each one and return the LAST candidate found.
function findMarkdownPreviewEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let lastCandidate = -1;

  for (let i = startIndex; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^```\S/.test(trimmed)) {
      depth++;
    } else if (/^```\s*$/.test(trimmed)) {
      if (depth > 0) {
        depth--;
      } else {
        lastCandidate = i;
        depth++;
      }
    }
  }

  return lastCandidate;
}

function parseContentSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let currentMarkdown = "";

  while (i < lines.length) {
    const line = lines[i];

    if (isMarkdownPreviewOpener(line)) {
      if (currentMarkdown) {
        segments.push({ type: "markdown", content: currentMarkdown });
        currentMarkdown = "";
      }

      const contentStart = i + 1;
      const closingIndex = findMarkdownPreviewEnd(lines, contentStart);

      if (closingIndex === -1) {
        segments.push({
          type: "markdownPreview",
          content: lines.slice(contentStart).join("\n"),
        });
        i = lines.length;
      } else {
        segments.push({
          type: "markdownPreview",
          content: lines.slice(contentStart, closingIndex).join("\n"),
        });
        i = closingIndex + 1;
      }
    } else {
      currentMarkdown += line + "\n";
      i++;
    }
  }

  if (currentMarkdown) {
    segments.push({ type: "markdown", content: currentMarkdown });
  }

  return segments;
}

function buildMarkdownComponents() {
  const codeComponents = buildChatCodeComponents(false);

  return {
    code: codeComponents.code,
    pre: codeComponents.pre,
    p: buildParagraphRenderer("mb-1 last:mb-0", true),
    a: ({ node, ...props }: any) => (
      <a
        className="text-primary hover:underline"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),
    ul: ({ node, ...props }: any) => (
      <ul className="list-disc pl-5 my-1" {...props} />
    ),
    ol: ({ node, ...props }: any) => (
      <ol className="list-decimal pl-5 my-1" {...props} />
    ),
    blockquote: ({ node, ...props }: any) => (
      <blockquote
        className="border-l-2 border-primary pl-3 my-2 text-text-secondary/80 italic"
        {...props}
      />
    ),
  };
}

function buildPreviewComponents() {
  const codeComponents = buildChatCodeComponents(true);

  return {
    h1: ({ children }: any) => (
      <h1 className="text-xl sm:text-2xl font-bold text-white mb-3 sm:mb-4 pb-2 sm:pb-3 border-b border-white/15 leading-tight">
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-base sm:text-lg font-semibold text-white mt-5 sm:mt-7 mb-2 sm:mb-3 pb-1.5 sm:pb-2 border-b border-white/10 leading-tight">
        {children}
      </h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-sm sm:text-base font-semibold text-white mt-4 sm:mt-5 mb-2 leading-tight">
        {children}
      </h3>
    ),
    h4: ({ children }: any) => (
      <h4 className="text-sm font-semibold text-white/90 mt-3 sm:mt-4 mb-1.5 leading-tight">
        {children}
      </h4>
    ),
    p: buildParagraphRenderer("text-sm text-text-secondary leading-relaxed mb-2 sm:mb-3"),
    ul: ({ children }: any) => (
      <ul className="list-disc pl-4 sm:pl-5 mb-2 sm:mb-3 space-y-1">{children}</ul>
    ),
    ol: ({ children }: any) => (
      <ol className="list-decimal pl-4 sm:pl-5 mb-2 sm:mb-3 space-y-1">{children}</ol>
    ),
    li: ({ children }: any) => (
      <li className="text-sm text-text-secondary leading-relaxed">{children}</li>
    ),
    table: ({ children }: any) => (
      <div className="overflow-x-auto mb-3 sm:mb-4 [-webkit-overflow-scrolling:touch]">
        <table className="w-full text-sm border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }: any) => (
      <thead className="bg-white/6">{children}</thead>
    ),
    tbody: ({ children }: any) => <tbody>{children}</tbody>,
    tr: ({ children }: any) => (
      <tr className="even:bg-white/2 border-b border-white/6 last:border-0">
        {children}
      </tr>
    ),
    th: ({ children }: any) => (
      <th className="text-left px-2 sm:px-3 py-1.5 sm:py-2 text-xs font-semibold text-white border border-white/10 whitespace-nowrap">
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className="px-2 sm:px-3 py-1.5 sm:py-2 text-xs text-text-secondary border border-white/8">
        {children}
      </td>
    ),
    hr: () => <hr className="my-4 sm:my-5 border-white/10" />,
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-2 border-primary pl-3 sm:pl-4 py-0.5 my-2 sm:my-3 text-text-secondary/80 italic">
        {children}
      </blockquote>
    ),
    strong: ({ children }: any) => (
      <strong className="font-semibold text-white/90">{children}</strong>
    ),
    a: ({ node, ...props }: any) => (
      <a
        className="text-primary hover:underline"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      />
    ),
    pre: codeComponents.pre,
    code: codeComponents.code,
  };
}

export const MessageContent: React.FC<MessageContentProps> = ({ content }) => {
  const segments = parseContentSegments(content);
  const chatComponents = buildMarkdownComponents();
  const previewComponents = buildPreviewComponents();

  return (
    <div className="prose prose-invert prose-sm max-w-none text-text-secondary leading-relaxed wrap-break-word">
      {segments.map((segment, index) => {
        if (segment.type === "markdownPreview") {
          return (
            <ChatMarkdownPreviewCard key={index} content={segment.content}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={previewComponents}
              >
                {segment.content}
              </ReactMarkdown>
            </ChatMarkdownPreviewCard>
          );
        }

        return (
          <ReactMarkdown
            key={index}
            remarkPlugins={[remarkGfm]}
            components={chatComponents}
          >
            {segment.content}
          </ReactMarkdown>
        );
      })}
    </div>
  );
};
