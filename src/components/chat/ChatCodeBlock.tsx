"use client";

import React, { useCallback, useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/cjs/styles/prism";

const flatHighlighterStyle = Object.fromEntries(
  Object.entries(vscDarkPlus).map(([key, value]) => [
    key,
    {
      ...(typeof value === "object" && value !== null ? value : {}),
      background: "transparent",
      backgroundColor: "transparent",
    },
  ]),
);

function useCopyWithFeedback() {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, []);

  return { copied, copy };
}

/** Slim top bar — label on the left, copy on the right. Content below gets full width. */
export function ChatBlockHeader({
  label,
  icon = "code",
  text,
  copyTitle = "Copy",
}: {
  label: string;
  icon?: string;
  text: string;
  copyTitle?: string;
}) {
  const { copied, copy } = useCopyWithFeedback();

  return (
    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 sm:px-3 sm:py-2 border-b border-white/8 bg-white/[0.04] shrink-0">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="material-symbols-outlined text-[14px] text-text-secondary/60 shrink-0">
          {icon}
        </span>
        <span className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wide text-text-secondary/75 truncate">
          {label}
        </span>
      </div>
      <button
        type="button"
        onClick={() => copy(text)}
        className={`cursor-pointer flex items-center gap-1 shrink-0 rounded-md px-2 py-1 text-[11px] font-medium transition-all duration-200 active:scale-95 ${
          copied
            ? "bg-emerald-500/15 text-emerald-400"
            : "text-text-secondary hover:bg-white/8 hover:text-white"
        }`}
        title={copied ? "Copied!" : copyTitle}
        aria-label={copied ? "Copied" : copyTitle}
      >
        <span
          className={`material-symbols-outlined text-[15px] transition-transform duration-200 ${
            copied ? "scale-110" : ""
          }`}
        >
          {copied ? "check" : "content_copy"}
        </span>
        <span className="tabular-nums">{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}

interface ChatCodeBlockProps {
  language?: string;
  children: string;
  compact?: boolean;
}

function formatLanguageLabel(language?: string): string {
  if (!language) return "Code";
  if (language === "markdown") return "Markdown";
  return language;
}

function CodeBlockShell({
  code,
  language,
  compact,
  children,
}: {
  code: string;
  language?: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex flex-col rounded-lg border border-border-dark bg-background-dark overflow-hidden ${
        compact ? "my-2" : "my-3"
      }`}
    >
      <ChatBlockHeader
        label={formatLanguageLabel(language)}
        icon={language === "markdown" ? "article" : "code"}
        text={code}
        copyTitle={`Copy ${formatLanguageLabel(language).toLowerCase()}`}
      />
      <div className="overflow-x-auto [-webkit-overflow-scrolling:touch]">{children}</div>
    </div>
  );
}

export function ChatCodeBlock({ language, children, compact }: ChatCodeBlockProps) {
  const code = children.replace(/\n$/, "");

  if (language) {
    return (
      <CodeBlockShell code={code} language={language} compact={compact}>
        <SyntaxHighlighter
          style={flatHighlighterStyle}
          language={language}
          PreTag="div"
          wrapLongLines
          customStyle={{
            margin: 0,
            padding: compact ? "0.625rem 0.75rem" : "0.75rem 1rem",
            background: "transparent",
            fontSize: compact ? "0.75rem" : undefined,
          }}
          codeTagProps={{
            className: "font-mono text-xs sm:text-sm leading-relaxed",
          }}
        >
          {code}
        </SyntaxHighlighter>
      </CodeBlockShell>
    );
  }

  return (
    <CodeBlockShell code={code} compact={compact}>
      <pre className="m-0">
        <code className="block whitespace-pre-wrap break-words px-3 py-2.5 sm:px-4 sm:py-3 font-mono text-xs sm:text-sm leading-relaxed text-text-secondary">
          {code}
        </code>
      </pre>
    </CodeBlockShell>
  );
}

export function ChatInlineCode({
  children,
  compact,
  ...props
}: React.ComponentPropsWithoutRef<"code"> & { compact?: boolean }) {
  return (
    <code
      className={`bg-white/10 px-1 py-0.5 rounded text-pink-400 font-mono ${
        compact ? "text-[12px]" : "text-[13px]"
      }`}
      {...props}
    >
      {children}
    </code>
  );
}

type HastText = { type: "text"; value: string };
type HastElement = {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children?: Array<HastElement | HastText | { type: string }>;
};

function classNameValue(properties?: Record<string, unknown>): string {
  const className = properties?.className;
  if (typeof className === "string") return className;
  if (Array.isArray(className)) return className.filter((part) => typeof part === "string").join(" ");
  return "";
}

function textFromHastNode(node: HastElement | HastText): string {
  if (node.type === "text") return node.value;
  return (node.children ?? []).map((child) => {
    if (child.type === "text" && "value" in child) return child.value;
    if (child.type === "element" && "tagName" in child) {
      return textFromHastNode(child as HastElement);
    }
    return "";
  }).join("");
}

/** Extract fenced code block content from a hast `pre` node. */
export function extractCodeFromPreNode(node?: HastElement): { text: string; language?: string } | null {
  if (!node || node.type !== "element" || node.tagName !== "pre") return null;

  const codeChild = (node.children ?? []).find(
    (child): child is HastElement =>
      child.type === "element" && "tagName" in child && child.tagName === "code",
  );
  if (!codeChild) return null;

  const text = textFromHastNode(codeChild).replace(/\n$/, "");
  const language = /language-(\w+)/.exec(classNameValue(codeChild.properties))?.[1];

  return { text, language };
}

export function buildChatCodeComponents(compact?: boolean) {
  return {
    pre({
      node,
      children,
    }: {
      node?: HastElement;
      children?: React.ReactNode;
    }) {
      const extracted = extractCodeFromPreNode(node);
      if (extracted) {
        return (
          <ChatCodeBlock language={extracted.language} compact={compact}>
            {extracted.text}
          </ChatCodeBlock>
        );
      }

      return <>{children}</>;
    },
    code({
      children,
      ...props
    }: React.ComponentPropsWithoutRef<"code"> & { children?: React.ReactNode }) {
      return (
        <ChatInlineCode compact={compact} {...props}>
          {children}
        </ChatInlineCode>
      );
    },
  };
}

/** @deprecated Use buildChatCodeComponents — react-markdown v10 no longer passes `inline`. */
export function buildChatCodeRenderer(compact?: boolean) {
  return buildChatCodeComponents(compact).code;
}

/** Markdown preview card with header bar + scrollable rendered body. */
export function ChatMarkdownPreviewCard({
  content,
  children,
}: {
  content: string;
  children: React.ReactNode;
}) {
  return (
    <div className="not-prose my-2 sm:my-3 -mx-1 sm:mx-0 flex flex-col rounded-lg border border-white/10 bg-background-dark/40 overflow-hidden">
      <ChatBlockHeader
        label="Markdown"
        icon="article"
        text={content}
        copyTitle="Copy markdown"
      />
      <div className="px-3 py-3 sm:px-5 sm:py-4 max-h-[min(70vh,480px)] overflow-y-auto overflow-x-hidden">
        {children}
      </div>
    </div>
  );
}
