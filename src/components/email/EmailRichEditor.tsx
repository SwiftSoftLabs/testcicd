"use client";

import React, {
  useRef,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useCallback,
  useState,
} from "react";

export type EmailRichEditorHandle = {
  getHtml: () => string;
  focus: () => void;
  /** Replace entire editor document (e.g. AI rewrite). */
  replaceHtml: (html: string) => void;
};

interface EmailRichEditorProps {
  /** Reset inner HTML when this key changes (e.g. draft id or reply source). */
  resetKey: string | number;
  initialHtml: string;
  placeholder?: string;
  /** Toolbar flush with body (no outer card border) — use when wrapped by compose shell */
  embedded?: boolean;
  className?: string;
  disabled?: boolean;
}

function exec(cmd: string, value?: string) {
  try {
    document.execCommand(cmd, false, value);
  } catch {
    /* noop */
  }
}

const FONT_OPTIONS = [
  { label: "Sans Serif", value: "Arial" },
  { label: "Serif", value: "Georgia" },
  { label: "Monospace", value: "Courier New" },
];

const EmailRichEditor = forwardRef<EmailRichEditorHandle, EmailRichEditorProps>(
  function EmailRichEditor(
    { resetKey, initialHtml, placeholder, embedded = false, className = "", disabled = false },
    ref,
  ) {
    const divRef = useRef<HTMLDivElement>(null);
    const colorInputRef = useRef<HTMLInputElement>(null);
    const [fmt, setFmt] = useState({
      bold: false,
      italic: false,
      underline: false,
    });

    const refreshFormat = useCallback(() => {
      if (typeof document === "undefined" || !divRef.current) return;
      try {
        const anchor = document.getSelection()?.anchorNode;
        if (!anchor || !divRef.current.contains(anchor)) return;
        setFmt({
          bold: document.queryCommandState("bold"),
          italic: document.queryCommandState("italic"),
          underline: document.queryCommandState("underline"),
        });
      } catch {
        /* queryCommandState can throw outside editable context */
      }
    }, []);

    useImperativeHandle(ref, () => ({
      getHtml: () => divRef.current?.innerHTML?.trim() || "",
      focus: () => divRef.current?.focus(),
      replaceHtml: (html: string) => {
        const el = divRef.current;
        if (!el) return;
        const next = html.trim() || "<p></p>";
        el.innerHTML = next;
      },
    }));

    useEffect(() => {
      const el = divRef.current;
      if (!el) return;
      el.innerHTML = initialHtml || "";
    }, [resetKey, initialHtml]);

    useEffect(() => {
      document.addEventListener("selectionchange", refreshFormat);
      return () =>
        document.removeEventListener("selectionchange", refreshFormat);
    }, [refreshFormat]);

    const run = (cmd: string, value?: string) => {
      if (disabled) return;
      divRef.current?.focus();
      exec(cmd, value);
      requestAnimationFrame(refreshFormat);
    };

    const toolBtn = (
      icon: string,
      title: string,
      cmd: string,
      value?: string,
      active?: boolean,
    ) => (
      <button
        type="button"
        title={title}
        onMouseDown={(e) => e.preventDefault()}
        disabled={disabled}
        onClick={() => run(cmd, value)}
        className={`p-2 rounded-lg transition-colors ${
          active
            ? "text-primary bg-primary/15 hover:bg-primary/20"
            : disabled ? "text-text-secondary opacity-45" : "text-text-secondary hover:text-main hover:bg-white/10"
        } disabled:cursor-not-allowed`}
      >
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </button>
    );

    const shell = embedded
      ? `flex flex-col overflow-hidden rounded-none bg-transparent border-0 ${className}`
      : `flex flex-col rounded-xl border border-border-dark bg-surface-dark/50 overflow-hidden ${className}`;

    return (
      <div className={shell}>
        <div
          className={`flex flex-wrap items-center gap-0.5 px-3 py-2 border-b border-border-dark ${
            embedded
              ? "border-t border-border-dark bg-background-dark/25"
              : "bg-background-dark/40"
          }`}
        >
          {toolBtn("undo", "Undo", "undo")}
          {toolBtn("redo", "Redo", "redo")}
          <div className="w-px h-5 bg-border-dark mx-1 self-center shrink-0" />

          <label className="sr-only">Font family</label>
          <select
            title="Font"
            defaultValue={FONT_OPTIONS[0].value}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => {
              if (disabled) return;
              divRef.current?.focus();
              exec("styleWithCSS", "true");
              exec("fontName", e.target.value);
            }}
            disabled={disabled}
            className="max-w-29 h-9 rounded-lg border border-border-dark bg-surface-highlight text-xs font-semibold text-main px-2 mr-1 focus:ring-2 focus:ring-primary/35 focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
          >
            {FONT_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>

          {toolBtn("format_bold", "Bold", "bold", undefined, fmt.bold)}
          {toolBtn("format_italic", "Italic", "italic", undefined, fmt.italic)}
          {toolBtn(
            "format_underlined",
            "Underline",
            "underline",
            undefined,
            fmt.underline,
          )}
          <div className="relative flex items-center">
            <button
              type="button"
              title="Text color"
              onMouseDown={(e) => e.preventDefault()}
              disabled={disabled}
              onClick={() => { if (!disabled) colorInputRef.current?.click(); }}
              className="p-2 rounded-lg text-text-secondary hover:text-main hover:bg-white/10 transition-colors disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
            >
              <span className="material-symbols-outlined text-[20px]">
                format_color_text
              </span>
            </button>
            <input
              ref={colorInputRef}
              type="color"
              className="absolute w-px h-px opacity-0 pointer-events-none"
              defaultValue="#6bb6ff"
              disabled={disabled}
              onChange={(e) => run("foreColor", e.target.value)}
            />
          </div>

          <div className="w-px h-5 bg-border-dark mx-1 self-center shrink-0" />
          {toolBtn("format_align_left", "Align left", "justifyLeft")}
          {toolBtn("format_align_center", "Align center", "justifyCenter")}
          {toolBtn("format_align_right", "Align right", "justifyRight")}
          <div className="w-px h-5 bg-border-dark mx-1 self-center shrink-0" />
          {toolBtn(
            "format_list_bulleted",
            "Bullet list",
            "insertUnorderedList",
          )}
          {toolBtn(
            "format_list_numbered",
            "Numbered list",
            "insertOrderedList",
          )}
          <div className="w-px h-5 bg-border-dark mx-1 self-center shrink-0" />
          <button
            type="button"
            title="Link"
            onMouseDown={(e) => e.preventDefault()}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              const url =
                typeof window !== "undefined"
                  ? window.prompt("Link URL")
                  : null;
              if (url) run("createLink", url);
            }}
            className="p-2 rounded-lg text-text-secondary hover:text-main hover:bg-white/10 transition-colors disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
          >
            <span className="material-symbols-outlined text-[20px]">link</span>
          </button>
          <button
            type="button"
            title="Image"
            onMouseDown={(e) => e.preventDefault()}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              const url =
                typeof window !== "undefined"
                  ? window.prompt("Image URL")
                  : null;
              if (url) run("insertImage", url);
            }}
            className="p-2 rounded-lg text-text-secondary hover:text-main hover:bg-white/10 transition-colors disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
          >
            <span className="material-symbols-outlined text-[20px]">image</span>
          </button>
          <button
            type="button"
            title="Insert emoji"
            onMouseDown={(e) => e.preventDefault()}
            disabled={disabled}
            onClick={() => {
              if (disabled) return;
              const em =
                typeof window !== "undefined"
                  ? window.prompt("Paste an emoji")
                  : null;
              if (em) document.execCommand("insertText", false, em);
            }}
            className="p-2 rounded-lg text-text-secondary hover:text-main hover:bg-white/10 transition-colors disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
          >
            <span className="material-symbols-outlined text-[20px]">
              sentiment_satisfied
            </span>
          </button>
        </div>

        <div className="relative min-h-[min(420px,55vh)] max-h-[min(520px,calc(100vh-22rem))] overflow-y-auto custom-scrollbar">
          <div
            ref={divRef}
            role="textbox"
            aria-multiline
            contentEditable={!disabled}
            suppressContentEditableWarning
            data-placeholder={placeholder || ""}
            onKeyUp={refreshFormat}
            onMouseUp={refreshFormat}
            onPointerDown={() => {
              if (disabled) return;
              if (!divRef.current?.textContent?.trim()) {
                divRef.current?.focus();
              }
            }}
            className="compose-editor min-h-[min(380px,calc(55vh-2rem))] w-full px-5 py-4 text-[15px] leading-relaxed text-main outline-none prose prose-invert prose-sm max-w-none [&_a]:text-primary [&:empty:before]:content-[attr(data-placeholder)] [&:empty:before]:text-text-secondary/45 data-[disabled=true]:cursor-not-allowed data-[disabled=true]:opacity-70"
            data-disabled={disabled}
            onInput={() => {}}
          />
        </div>
      </div>
    );
  },
);

export default EmailRichEditor;
